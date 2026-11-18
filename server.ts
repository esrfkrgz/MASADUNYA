import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  type FunctionDeclaration,
  GoogleGenAI,
  ThinkingLevel,
  Type,
} from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const DEFAULT_MODEL_NAME = 'gemini-4-hydrogen';
const ANYTHINKLLM_BASE_URL = process.env.ANYTHINKLLM_BASE_URL || 'http://localhost:3001/api/v1/openai';
const ANYTHINKLLM_API_KEY = process.env.ANYTHINKLLM_API_KEY || '';
const ANYTHINKLLM_MODEL = process.env.ANYTHINKLLM_MODEL || 'gpt-4o';

function normalizeAnyThinkBaseUrl(baseUrl: string): string {
  let base = (baseUrl || '').trim().replace(/\/+$/, '');
  for (const suffix of ['/chat/completions', '/models']) {
    if (base.endsWith(suffix)) {
      base = base.slice(0, base.length - suffix.length);
      break;
    }
  }
  return base;
}

function anyThinkUrl(baseUrl: string, resource: 'chat/completions' | 'models'): string {
  const base = normalizeAnyThinkBaseUrl(baseUrl);
  if (base.endsWith('/v1') || base.includes('/api/')) {
    return `${base}/${resource}`;
  }
  return `${base}/v1/${resource}`;
}

function stripReasoningText(raw: string): string {
  return raw
    .replace(/<think(?:ing)?[\s\S]*?<\/think(?:ing)?>/gi, '')
    .replace(/<think(?:ing)?[\s\S]*$/gi, '')
    .replace(/<\/think(?:ing)?>/gi, '')
    .trim();
}

function coerceNarrativeChoice(raw: unknown): { label: string; actionPrompt: string; kind: string } {
  const record = (raw ?? {}) as Record<string, unknown>;
  const label =
    typeof record.label === 'string'
      ? record.label.trim()
      : typeof record.text === 'string'
        ? record.text.trim()
        : typeof record.title === 'string'
          ? record.title.trim()
          : '';
  const actionCandidate =
    typeof record.actionPrompt === 'string'
      ? record.actionPrompt.trim()
      : typeof record.prompt === 'string'
        ? record.prompt.trim()
        : typeof record.action === 'string' && record.action.includes(' ')
          ? record.action.trim()
          : '';
  const actionPrompt = actionCandidate || label;
  const kind = typeof record.kind === 'string' ? record.kind : 'observe';
  return { label, actionPrompt, kind };
}

function pickNarrativeFields(parsed: Record<string, unknown> | null): {
  speaker: string;
  role: 'narrator' | 'dialogue';
  text: string;
  choices: unknown[];
} {
  if (!parsed) return { speaker: '', role: 'narrator', text: '', choices: [] };
  const nested =
    parsed.narrative && typeof parsed.narrative === 'object' && !Array.isArray(parsed.narrative)
      ? (parsed.narrative as Record<string, unknown>)
      : parsed;
  const speaker = typeof nested.speaker === 'string' ? nested.speaker.trim() : '';
  const role: 'narrator' | 'dialogue' = nested.role === 'dialogue' ? 'dialogue' : 'narrator';
  const textParts = [
    typeof nested.text === 'string' ? nested.text.trim() : '',
    typeof nested.details === 'string' ? nested.details.trim() : '',
    typeof nested.description === 'string' ? nested.description.trim() : '',
  ].filter(Boolean);
  const choices = Array.isArray(nested.choices)
    ? nested.choices
    : Array.isArray(parsed.choices)
      ? parsed.choices
      : [];
  return { speaker, role, text: textParts.join('\n\n'), choices };
}

function readableNarrativeText(raw: string): string {
  return stripReasoningText(raw)
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/^\s*\{[\s\S]*\}\s*$/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}function extractJsonObject(raw: string): Record<string, unknown> | null {
  if (!raw) return null;
  let text = stripReasoningText(raw).replace(/```json/gi, '```');
  const fenced = text.match(/```([\s\S]*?)```/);
  if (fenced) text = fenced[1];
  try {
    const direct = JSON.parse(text) as unknown;
    if (direct && typeof direct === 'object' && !Array.isArray(direct)) {
      return direct as Record<string, unknown>;
    }
  } catch {
    // govde duz JSON degil; asagida suslu parantez taramasi yapilir
  }
  const start = text.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1)) as Record<string, unknown>;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

const ALLOWED_MODELS = new Set([
  'gemini-4-hydrogen',
  'gemini-3.1-flash-lite',
  'gemini-4-argon',
  'gemini-4-carbon',
  'gemini-2.5-pro',
  'gemini-2.5-flash',
  'gemini-2.0-flash',
  'gemini-2.5-flash-lite',
  'gemini-2.5-thinking',
  'gemini-1.5-pro',
  'gemini-1.5-flash',
  'gemini-1.5-flash-8b',
  'gemini-2.0-flash-lite',
  'gemini-3-pro',
  'gemini-3-flash',
  'gemini-3-flash-lite',
  'gemini-3.7-flash',
  'gemini-3.7-flash-lite',
  'gemini-3.8-flash',
  'gemini-3.8-flash-lite',
]);

function resolveModelName(requested?: string): string {
  if (requested && ALLOWED_MODELS.has(requested)) {
    return requested;
  }
  return DEFAULT_MODEL_NAME;
}

function resolveThinkingLevel(model: string, mode?: string): ThinkingLevel | undefined {
  if (model === 'gemini-3.1-flash-lite') {
    if (mode === 'deep') return ThinkingLevel.MEDIUM;
    if (mode === 'balanced') return ThinkingLevel.LOW;
    return ThinkingLevel.MINIMAL;
  }
  if (model.startsWith('gemini-3') || model.startsWith('gemini-4')) {
    if (mode === 'deep') return ThinkingLevel.HIGH;
    if (mode === 'balanced') return ThinkingLevel.MEDIUM;
    return ThinkingLevel.LOW;
  }
  return undefined;
}

function getAiClient(requestedApiKey?: string): GoogleGenAI {
  const apiKey = requestedApiKey || process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      'GEMINI_API_KEY tanımlı değil. Lütfen AI Studio Settings > Secrets panelinden API anahtarınızı ekleyin.'
    );
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

const ENGINE_TOOL_DECLARATIONS: FunctionDeclaration[] = [
  {
    name: 'inspect_self_and_surroundings',
    description:
      'Eşrefin üzerini, ceplerini, eşyalarını, hafıza durumunu, yerdeki izleri, çevreyi, ağaç tepesinden görüşü veya yerleşimdeki söylentileri/sorunları Algı zarıyla inceler.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        focus: {
          type: Type.STRING,
          enum: ['self_and_pockets', 'tracks_and_area', 'climb_vantage', 'listen_rumors'],
          description:
            'self_and_pockets: üst-baş, cep, eşya ve hafıza yoklama; tracks_and_area: arazi ve iz inceleme; climb_vantage: ağaç/tepeye tırmanıp etrafı görme; listen_rumors: yerleşimde söylenti ve yerel havayı dinleme.',
        },
        note: {
          type: Type.STRING,
          description: 'Oyuncunun özellikle incelemek istediği detay.',
        },
      },
      required: ['focus'],
    },
  },
  {
    name: 'travel_direction',
    description:
      'Eşrefi açık arazide belirli bir ana veya ara yöne doğru yürütür; zaman, yorgunluk, hava durumu ve olası yeni karşılaşmaları motor üzerinden işler.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        direction: {
          type: Type.STRING,
          enum: [
            'Kuzey',
            'Güney',
            'Doğu',
            'Batı',
            'Kuzeydoğu',
            'Kuzeybatı',
            'Güneydoğu',
            'Güneybatı',
          ],
          description: 'İlerlenecek yön.',
        },
        pace: {
          type: Type.STRING,
          enum: ['stealth', 'normal', 'forced'],
          description: 'stealth: gizlice/sessizce; normal: olağan tempo; forced: hızlı/zorlu yürüyüş.',
        },
      },
      required: ['direction'],
    },
  },
  {
    name: 'travel_to_settlement',
    description:
      'Eşrefi bilinen bir yerleşime, köye, kaleye veya bölgeye doğru yola çıkarır.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        settlementName: {
          type: Type.STRING,
          description: 'Hedef yerleşimin adı (ör. Gümüş Köprü, Külköy, Sis Geçidi).',
        },
        pace: {
          type: Type.STRING,
          enum: ['stealth', 'normal', 'forced'],
          description: 'Yolculuk temposu.',
        },
      },
      required: ['settlementName'],
    },
  },
  {
    name: 'interact_npc_or_group',
    description:
      'Yakındaki bir yoldaş, NPC, yerleşim sakini veya gezgin grupla konuşur, flört eder, ikna/cazibe dener, yüzleşir ya da ticaret/yardım iletişimi kurar.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        targetName: {
          type: Type.STRING,
          description: 'Konuşulacak kişi veya gezgin grubun adı (belirsizse boş bırakılabilir).',
        },
        tone: {
          type: Type.STRING,
          enum: [
            'talk',
            'flirt_or_romance',
            'seduce_or_charm',
            'confront_or_test',
            'escort_aid',
            'greet_trade',
          ],
          description: 'Etkileşim tonu ve niyeti.',
        },
      },
      required: ['tone'],
    },
  },
  {
    name: 'combat_or_shadow_action',
    description:
      'Pusu kurma, çatışma, fiziksel güç kullanma, erzak çalma, haraç kesme veya esir alma gibi riskli/saldırgan eylemleri zarla çözümler.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        intent: {
          type: Type.STRING,
          enum: ['ambush_group', 'skirmish', 'steal_supplies', 'extort', 'capture_captive'],
          description: 'Çatışma veya gölge eyleminin türü.',
        },
        targetName: {
          type: Type.STRING,
          description: 'Hedef grup veya kişi adı (varsa).',
        },
      },
      required: ['intent'],
    },
  },
  {
    name: 'use_inventory_or_eat',
    description:
      'Eşrefin çantasındaki kuru erzağı, şifalı dağ kekiğini, panzehiri veya meşaleyi kullanır.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        item: {
          type: Type.STRING,
          enum: ['rations', 'healing_herb', 'antidote_vial', 'torch_bundle'],
          description: 'Kullanılacak eşya.',
        },
      },
      required: ['item'],
    },
  },
  {
    name: 'camp_forage_or_aid',
    description:
      'Kamp kurup dinlenmeyi, ormanda/bölgede avlanıp çalışmayı veya bir yerleşimin aktif sorununu çözmeye yardım etmeyi yürütür.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        activity: {
          type: Type.STRING,
          enum: ['rest_camp', 'forage_or_work', 'help_settlement_problem'],
          description: 'Yapılacak kamp, iş veya yardım faaliyeti.',
        },
        problemHint: {
          type: Type.STRING,
          description: 'Yerleşimdeki belirli bir soruna müdahale ediliyorsa kısa ipucu.',
        },
      },
      required: ['activity'],
    },
  },
  {
    name: 'free_roleplay_action',
    description:
      'Diğer mekanik araçların kapsamına girmeyen yaratıcı rol yapma hareketleri için kullanılır (ör. ağaca bez bağlamak, kılıcı bilemek, suya bakmak, sessizce beklemek).',
    parameters: {
      type: Type.OBJECT,
      properties: {
        physicalEffort: {
          type: Type.STRING,
          enum: ['none', 'light', 'moderate'],
          description: 'Eylemin harcadığı fiziksel efor.',
        },
        advanceOneHour: {
          type: Type.BOOLEAN,
          description: 'Eylem anlamlı bir süre alıyorsa saati 1 saat ilerlet.',
        },
        summary: {
          type: Type.STRING,
          description: 'Eylemin kısa Türkçe özeti.',
        },
      },
      required: ['physicalEffort', 'summary'],
    },
  },
];

const PLANNER_SYSTEM_INSTRUCTION = `Sen "Sisli Doğu Atlası" karanlık fantezi masaüstü RPG dünyasının Oyun Motoru Yöneticisisin.
Ana karakter Eşref: 18 yaşında, 185 cm boyunda, esmer, atletik ve karizmatik bir gençtir; hafıza kaybı nedeniyle yalnızca adını hatırlamaktadır.

GÖREVİN (ADIM 1 - ARAÇ ÇAĞIRMA):
- Oyuncunun yazdığı eylemi (karmaşık veya çok aşamalı olsa bile) dikkatle analiz et ve mevcut oyun bağlamına göre doğru motor araçlarını çağır.
- ÖNEMLİ: Tek bir cümlede birden fazla aşama varsa birden fazla araç çağırabilirsin. Örneğin:
  * "Yosunlardaki izleri inceleyip izlerin yönüne gizlice yürüyorum" -> Önce inspect_self_and_surroundings(tracks_and_area) çağır, motordan gerçek yön sonucunu aldıktan sonra ikinci adımda travel_direction çağır.
  * "Erzak yiyip güneye yürüyorum" -> use_inventory_or_eat(rations) ve travel_direction(Güney) çağır.
- Dünya kuralları dışındaki imkânsız şeyler (büyüyle uçmak, ejderha çağırmak vb.) için sahte başarı üretme; free_roleplay_action ile gerçekçi sınırlar içinde değerlendir.
- Her turda mutlaka en az bir uygun aracı çağır; araç sonucu olmadan rastgele olay uydurma.
- Araç çağrıları tamamlandığında ek araç gerekmiyorsa kısa bir "Hazır" notu bırakabilirsin.`;

const NARRATOR_SYSTEM_INSTRUCTION = `Sen "Sisli Doğu Atlası" masaüstü RPG oyununun baş anlatıcısı ve NPC sesisin.
Ana karakter Eşref (18 yaşında, 185 cm, esmer, atletik, karizmatik; hafıza kaybı yaşıyor).

KESİN KURALLAR:
1. YALNIZCA motor tarafından doğrulanmış [KESİN MOTOR SONUÇLARI] ve [DÜNYA BAĞLAMI] içindeki gerçek olaylara sadık kal. Olmayan eşya, gümüş, NPC, yerleşim veya zar başarısı uydurma.
2. Eğer motor başarısız bir zar, yaralanma, reddedilme veya "etrafta kimse yok" sonucu döndürdüyse bunu sahneye dürüstçe ve atmosferik biçimde yansıt.
3. ASLA "G4", "G5", "H4", "mazgal", "karesi" gibi teknik harita/ızgara kodları kullanma! Mekânları yalnızca atmosferik arazi dokusu, doğa unsurları, yönler (kuzey, güneybatı vb.) veya gerçek yerleşim adlarıyla anlat.
4. Dil: Akıcı, edebi ama gereksiz uzatmadan 2–4 cümlelik sürükleyici Türkçe.
5. Eğer bir NPC veya gezgin grup doğrudan Eşref'e karşılık verdiyse role="dialogue", speaker="<Kişi/Grup Adı>" seç ve tırnak içi veya doğrudan konuşma üslubuyla yaz; aksi hâlde role="narrator", speaker="Anlatıcı" kullan.
6. Her yanıtın sonunda Eşref'in o anki durumuna ve çevresine uygun TAM 4 ADET kısa, çeşitli devam seçeneği (choices) üret.`;

const NARRATIVE_RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    speaker: {
      type: Type.STRING,
      description: 'Anlatıcı ("Anlatıcı") veya doğrudan konuşan NPC/grup adı.',
    },
    role: {
      type: Type.STRING,
      enum: ['narrator', 'dialogue'],
      description: 'Sahne anlatımı için narrator, NPC konuşması için dialogue.',
    },
    text: {
      type: Type.STRING,
      description: '2-4 cümlelik akıcı, motor sonuçlarıyla %100 tutarlı Türkçe anlatı veya diyalog.',
    },
    choices: {
      type: Type.ARRAY,
      description: 'Sonraki hamle için 4 adet kısa ve anlamlı eylem önerisi.',
      items: {
        type: Type.OBJECT,
        properties: {
          label: {
            type: Type.STRING,
            description: 'Butonda görünecek kısa etiket (3-7 kelime).',
          },
          actionPrompt: {
            type: Type.STRING,
            description: 'Seçildiğinde Eşref ağzından gönderilecek birinci tekil şahıs cümlesi.',
          },
          kind: {
            type: Type.STRING,
            enum: ['observe', 'talk', 'action', 'risk', 'travel', 'rest'],
            description: 'Seçenek kategorisi.',
          },
        },
        required: ['label', 'actionPrompt', 'kind'],
      },
    },
  },
  required: ['speaker', 'role', 'text', 'choices'],
};

interface StepRequestBody {
  apiKey?: string;
  mode?: 'plan' | 'finalize';
  model?: string;
  thinkingMode?: string;
  turnContents?: unknown[];
  playerActionText?: string;
  chosenOptionKind?: string;
  contextSnapshotText?: string;
  historyText?: string;
  engineFacts?: string[];
  preferredRole?: 'narrator' | 'dialogue';
  preferredSpeaker?: string;
}

function extractGeminiError(err: unknown): { status: number; message: string } {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes('GEMINI_API_KEY tanımlı değil')) {
    return { status: 500, message: msg };
  }
  if (msg.includes('API_KEY_INVALID') || msg.includes('PERMISSION_DENIED') || msg.includes('403')) {
    return {
      status: 403,
      message:
        'Gemini API anahtarı geçersiz veya yetkisiz. Lütfen Settings > Secrets panelinden anahtarınızı kontrol edin.',
    };
  }
  if (msg.includes('RESOURCE_EXHAUSTED') || msg.includes('429')) {
    const isZeroQuota = msg.includes('limit: 0') || msg.includes('Quota exceeded');
    return {
      status: 429,
      message: isZeroQuota
        ? 'Seçili model için API anahtarının kotası dolu veya faturalandırma limiti 0 görünüyor. Settings > Secrets panelinden faturalandırmalı bir anahtar seçebilir ya da Ayarlar bölümünden farklı bir model (örn. Gemini 3.1 Flash Lite) deneyebilirsiniz.'
        : 'Gemini API istek kotası geçici olarak doldu. Biraz bekleyip tekrar deneyin veya Settings > Secrets üzerinden anahtarınızı kontrol edin.',
    };
  }
  return {
    status: 502,
    message: `Yapay zeka anlatıcısına bağlanırken hata oluştu: ${msg}`,
  };
}

async function generateWithRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const isTransient = msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED') || msg.includes('503');
    const isHardZeroQuota = msg.includes('limit: 0');
    if (isTransient && !isHardZeroQuota) {
      await new Promise((r) => setTimeout(r, 1200));
      return await fn();
    }
    throw err;
  }
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  app.post('/api/narrative/anythinkllm/models', async (req, res) => {
    try {
      const body = (req.body ?? {}) as { baseUrl?: string; apiKey?: string };
      const baseUrl = body.baseUrl || ANYTHINKLLM_BASE_URL;
      const apiKey = body.apiKey || ANYTHINKLLM_API_KEY;
      const url = anyThinkUrl(baseUrl, 'models');

      const response = await fetch(url, {
        headers: {
          Accept: 'application/json',
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        },
      });
      const text = await response.text();

      if (!response.ok) {
        res.status(502).json({
          error: `Model listesi alınamadı (HTTP ${response.status}). Adres: ${url}. Yanıt: ${text.slice(0, 400)}`,
        });
        return;
      }

      let data: unknown = null;
      try {
        data = JSON.parse(text);
      } catch {
        res.status(502).json({
          error: `Model listesi JSON değil. Adres: ${url}. Yanıt: ${text.slice(0, 400)}`,
        });
        return;
      }

      const container = data as { data?: unknown; models?: unknown };
      const list: unknown[] = Array.isArray(container?.data)
        ? (container.data as unknown[])
        : Array.isArray(container?.models)
          ? (container.models as unknown[])
          : Array.isArray(data)
            ? (data as unknown[])
            : [];

      const models = list
        .map((item) => {
          if (typeof item === 'string') return { id: item, name: item };
          const record = (item ?? {}) as Record<string, unknown>;
          const id =
            typeof record.id === 'string'
              ? record.id
              : typeof record.slug === 'string'
                ? record.slug
                : typeof record.model === 'string'
                  ? record.model
                  : '';
          const name = typeof record.name === 'string' ? record.name : id;
          return { id, name: name || id };
        })
        .filter((item) => item.id);

      res.json({ models, endpoint: url });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(502).json({ error: `Model listesi alınamadı: ${msg}` });
    }
  });  app.post('/api/narrative/anythinkllm', async (req, res) => {
    try {
      const body = (req.body ?? {}) as {
        baseUrl?: string;
        apiKey?: string;
        model?: string;
        messages?: Array<{ role: string; content: string }>;
        contextSnapshotText?: string;
        historyText?: string;
        engineFacts?: string[];
        playerActionText?: string;
        preferredSpeaker?: string;
        preferredRole?: 'narrator' | 'dialogue';
      };

      const baseUrl = (body.baseUrl || ANYTHINKLLM_BASE_URL).trim().replace(/\/+$/, '');
      const apiKey = body.apiKey || ANYTHINKLLM_API_KEY;
      const model = body.model || ANYTHINKLLM_MODEL;
      const anyThinkEndpointBase = anyThinkUrl(baseUrl, 'chat/completions');
      const messages = Array.isArray(body.messages)
        ? body.messages.filter((m) => m && typeof m.content === 'string')
        : [];
      if (messages.length === 0) {
        res.status(400).json({ error: 'Geçersiz mesaj listesi.' });
        return;
      }

      const factsBlock =
        Array.isArray(body.engineFacts) && body.engineFacts.length > 0
          ? body.engineFacts.map((f, i) => `${i + 1}. ${f}`).join('\n')
          : 'Mekanik durum değişimi yok; saf atmosferik veya rol yapma sahnesi.';

      const finalPrompt = [
        `[DÜNYA BAĞLAMI]\n${body.contextSnapshotText ?? ''}`,
        body.historyText ? `[SON SOHBET GEÇMİŞİ]\n${body.historyText}` : '',
        `[EŞREF'İN SON EYLEMİ${body.playerActionText ? ` (${body.preferredRole ?? 'dialogue'})` : ''}]`,
        body.playerActionText ?? '',
        `[KESİN MOTOR SONUÇLARI]\n${factsBlock}`,
        body.preferredSpeaker
          ? `[KONUŞMA İPUCU]\nBu turda "${body.preferredSpeaker}" (${body.preferredRole ?? 'dialogue'}) doğrudan yanıt verdi; anlatımı veya diyaloğu bununla uyumlu kur.`
          : '',
      ]
        .filter(Boolean)
        .join('\n\n');

      const anythinkResponse = await fetch(anyThinkEndpointBase, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        },
        body: JSON.stringify({
          model,
          messages: [
            {
              role: 'system',
              content:
                NARRATOR_SYSTEM_INSTRUCTION +
                '\nYanıtını SADECE JSON olarak ver. Kod bloğu, üçlü ters tırnak veya açıklama ekleme. Şema: {"speaker":"...","role":"narrator veya dialogue","text":"...","choices":[{"label":"...","actionPrompt":"...","kind":"observe|talk|action|risk|travel|rest"}]}',
            },
            ...messages,
          ],
          temperature: 0.7,
          response_format: { type: 'json_object' },
        }),
      });

      if (!anythinkResponse.ok) {
        const anythinkErrText = await anythinkResponse.text();
        res.status(502).json({ error: `AnyThinkLLM isteği başarısız oldu (HTTP ${anythinkResponse.status}): ${anythinkErrText}` });
        return;
      }

      const anythinkData = (await anythinkResponse.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const rawContent = anythinkData.choices?.[0]?.message?.content ?? '';
      const parsed = extractJsonObject(rawContent);
      const picked = pickNarrativeFields(parsed);
      const parsedChoices = picked.choices
        .map(coerceNarrativeChoice)
        .filter((choice) => choice.label.length > 0 && choice.actionPrompt.length > 0)
        .slice(0, 4);

      const narrative = {
        speaker: picked.speaker || body.preferredSpeaker || 'Anlatıcı',
        role: picked.role,
        text: picked.text || readableNarrativeText(rawContent) || factsBlock,
        choices:
          parsedChoices.length > 0
            ? parsedChoices
            : [
                { label: 'Çevreyi incele', actionPrompt: 'Çevreyi dikkatle inceliyorum.', kind: 'observe' },
                { label: 'Konuş', actionPrompt: 'Karşımdakiyle konuşuyorum.', kind: 'talk' },
                { label: 'Yola devam et', actionPrompt: 'Yoluma devam ediyorum.', kind: 'travel' },
              ],
      };
      res.json({ status: 'final', narrative });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(502).json({ error: `AnyThinkLLM ile iletişim hatası: ${msg}` });
    }
  });

  app.post('/api/narrative/step', async (req, res) => {
    try {
      const body = (req.body ?? {}) as StepRequestBody;
      const ai = getAiClient(body.apiKey);
      const selectedModel = resolveModelName(body.model);
      const selectedThinking = resolveThinkingLevel(selectedModel, body.thinkingMode);

      if (body.mode !== 'finalize') {
        const contents = Array.isArray(body.turnContents) ? body.turnContents : [];
        if (contents.length === 0) {
          res.status(400).json({ error: 'Geçersiz tur içeriği.' });
          return;
        }

        const planResponse = await generateWithRetry(() =>
          ai.models.generateContent({
            model: selectedModel,
            contents: contents as never,
            config: {
              systemInstruction: PLANNER_SYSTEM_INSTRUCTION,
              tools: [{ functionDeclarations: ENGINE_TOOL_DECLARATIONS }],
              ...(selectedThinking ? { thinkingConfig: { thinkingLevel: selectedThinking } } : {}),
            },
          })
        );

        const functionCalls = planResponse.functionCalls ?? [];
        if (functionCalls.length > 0) {
          const modelContent = planResponse.candidates?.[0]?.content ?? null;
          res.json({
            status: 'tool_calls',
            modelContent,
            functionCalls,
          });
          return;
        }
      }

      // Final Narrator JSON Synthesis
      const factsBlock =
        Array.isArray(body.engineFacts) && body.engineFacts.length > 0
          ? body.engineFacts.map((f, i) => `${i + 1}. ${f}`).join('\n')
          : 'Mekanik durum değişimi yok; saf atmosferik veya rol yapma sahnesi.';

      const narratorPrompt = [
        `[DÜNYA BAĞLAMI]\n${body.contextSnapshotText ?? ''}`,
        body.historyText ? `[SON SOHBET GEÇMİŞİ]\n${body.historyText}` : '',
        `[EŞREF'İN SON EYLEMİ${body.chosenOptionKind ? ` (${body.chosenOptionKind})` : ''}]\n${body.playerActionText ?? ''}`,
        `[KESİN MOTOR SONUÇLARI]\n${factsBlock}`,
        body.preferredSpeaker
          ? `[KONUŞMA İPUCU]\nBu turda "${body.preferredSpeaker}" (${body.preferredRole ?? 'dialogue'}) doğrudan yanıt verdi; anlatımı veya diyaloğu bununla uyumlu kur.`
          : '',
      ]
        .filter(Boolean)
        .join('\n\n');

      const finalResponse = await generateWithRetry(() =>
        ai.models.generateContent({
          model: selectedModel,
          contents: narratorPrompt,
          config: {
            systemInstruction: NARRATOR_SYSTEM_INSTRUCTION,
            responseMimeType: 'application/json',
            responseSchema: NARRATIVE_RESPONSE_SCHEMA,
            ...(selectedThinking ? { thinkingConfig: { thinkingLevel: selectedThinking } } : {}),
          },
        })
      );

      const rawJson = (finalResponse.text ?? '').trim();
      const parsed = JSON.parse(rawJson) as {
        speaker?: string;
        role?: 'narrator' | 'dialogue';
        text?: string;
        choices?: Array<{
          label?: string;
          actionPrompt?: string;
          kind?: 'observe' | 'talk' | 'action' | 'risk' | 'travel' | 'rest';
        }>;
      };

      res.json({
        status: 'final',
        narrative: {
          speaker: parsed.speaker || body.preferredSpeaker || 'Anlatıcı',
          role: parsed.role === 'dialogue' ? 'dialogue' : 'narrator',
          text: parsed.text || factsBlock,
          choices: Array.isArray(parsed.choices) ? parsed.choices.slice(0, 4) : [],
        },
      });
    } catch (err) {
      const { status, message } = extractGeminiError(err);
      res.status(status).json({ error: message });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      const indexFile = path.join(distDir, 'index.html');
      if (fs.existsSync(indexFile)) {
        res.sendFile(indexFile);
      } else {
        res.status(404).send('Build çıktı dosyaları bulunamadı.');
      }
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Sisli Doğu Atlası sunucusu http://0.0.0.0:${PORT} adresinde çalışıyor.`);
  });
}

startServer();
