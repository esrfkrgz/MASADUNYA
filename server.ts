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

const ALLOWED_MODELS = new Set([
  'gemini-4-hydrogen',
  'gemini-3.1-flash-lite',
  'gemini-4-argon',
  'gemini-4-carbon',
]);

function resolveModelName(requested?: string): string {
  if (requested && ALLOWED_MODELS.has(requested)) {
    return requested;
  }
  return DEFAULT_MODEL_NAME;
}

function resolveThinkingLevel(model: string, mode?: string): ThinkingLevel {
  if (model === 'gemini-3.1-flash-lite') {
    if (mode === 'deep') return ThinkingLevel.MEDIUM;
    if (mode === 'balanced') return ThinkingLevel.LOW;
    return ThinkingLevel.MINIMAL;
  }
  if (mode === 'deep') return ThinkingLevel.HIGH;
  if (mode === 'balanced') return ThinkingLevel.MEDIUM;
  return ThinkingLevel.LOW;
}

function getAiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
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

  app.post('/api/narrative/step', async (req, res) => {
    try {
      const body = (req.body ?? {}) as StepRequestBody;
      const ai = getAiClient();
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
              thinkingConfig: { thinkingLevel: selectedThinking },
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
            thinkingConfig: { thinkingLevel: selectedThinking },
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
