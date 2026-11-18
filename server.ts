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
const ANYTHINKLLM_BASE_URL =
  process.env.ANYTHINKLLM_BASE_URL || 'http://localhost:3001/api/v1/openai';
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

function coerceNarrativeChoice(raw: unknown): {
  label: string;
  actionPrompt: string;
  kind: string;
} {
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
}

function extractJsonObject(raw: string): Record<string, unknown> | null {
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
            'self_and_pockets: üst-baş, cep, eşya ve hafıza yoklama; tracks_and_area: arazi, kişi veya iz inceleme; climb_vantage: ağaç/tepeye tırmanıp etrafı görme; listen_rumors: yerleşimde söylenti ve yerel havayı dinleme.',
        },
        durationMinutes: {
          type: Type.INTEGER,
          description:
            'Eylemin ne kadar süreceği (dakika cinsinden, 1–60 arası). Birine sadece bakmak veya etrafa hızlıca göz atmak için 1–2 dk, ceplere/üzerine bakmak için 2–5 dk, detaylı iz sürmek/ağaca tırmanmak/söylenti toplamak için 15–45 dk seç.',
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
      'Yakındaki bir yoldaş, NPC, yerleşim sakini veya gezgin grupla selamlaşır, konuşur, flört eder, ikna/cazibe dener, yüzleşir ya da ticaret/yardım iletişimi kurar.',
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
        durationMinutes: {
          type: Type.INTEGER,
          description:
            'Etkileşimin süreceği dakika (1–90 arası). Kısa selamlaşma ("merhaba", "selam", baş selamı) veya tek cümlelik soru için 1–3 dk; olağan sohbet/pazarlık için 10–25 dk; uzun ikna, flört veya eşlik için 30–60 dk seç.',
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
      'Kamp kurup dinlenmeyi (+8 saat), ormanda/bölgede avlanıp çalışmayı (+3 saat) veya yerleşime/soruna destek olmayı (+4 saat) yürütür.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        activity: {
          type: Type.STRING,
          enum: ['rest_camp', 'forage_or_work', 'help_settlement', 'help_settlement_problem'],
          description:
            'rest_camp: kamp kurma ve dinlenme (+8 saat); forage_or_work: avlanma veya çalışma (+3 saat); help_settlement: yerleşime destek olma (+4 saat); help_settlement_problem: belirli bir yerel sorunu çözmeye yardım (+3 saat).',
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
      'Diğer mekanik araçların kapsamına girmeyen yaratıcı rol yapma hareketleri için kullanılır (ör. birine bakmak, gülümsemek, ağaca bez bağlamak, kılıcı bilemek, nöbet tutmak, beklemek, ateş yakmak).',
    parameters: {
      type: Type.OBJECT,
      properties: {
        physicalEffort: {
          type: Type.STRING,
          enum: ['none', 'light', 'moderate'],
          description: 'Eylemin harcadığı fiziksel efor.',
        },
        minutesSpent: {
          type: Type.INTEGER,
          description:
            'Eylemin doğasına göre geçmesi gereken süre (dakika cinsinden, 0–720 arası). Ör: sadece birine bakmak/gülümsemek/tek söz söylemek 1 dk (veya 0); ateş yakmak/kamp hazırlığı 10–20 dk; kılıç bilemek/yemek yapmak 25–45 dk; uzun nöbet veya bekleyiş 60–360 dk.',
        },
        hoursSpent: {
          type: Type.INTEGER,
          description:
            'Yalnızca saat bazlı uzun eylemler için (minutesSpent verilmediyse 0–12 saat).',
        },
        advanceOneHour: {
          type: Type.BOOLEAN,
          description: 'Eski uyumluluk alanı; mümkünse bunun yerine minutesSpent kullan.',
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
  * "Yosunlardaki izleri inceleyip izlerin yönüne gizlice yürüyorum" -> Önce inspect_self_and_surroundings(tracks_and_area, durationMinutes: 10) çağır, motordan gerçek yön sonucunu aldıktan sonra ikinci adımda travel_direction çağır.
  * "Erzak yiyip güneye yürüyorum" -> use_inventory_or_eat(rations) ve travel_direction(Güney) çağır.
- ZAMAN AKIŞI (GERÇEKÇİ DAKİKA & SAAT): Zamanı eylemin gerçek boyutuna göre ilerlet! Kısa anlık eylemlerde ASLA 1 saat geçirme:
  * Birine sadece bakmak, hızlıca etrafa göz atmak, "merhaba/selam" demek veya tek cümlelik kısa bir şey sormak 1–3 dakika sürer (durationMinutes: 1 veya 2; ya da free_roleplay_action minutesSpent: 1).
  * Ceplerini/üzerini yoklamak 2–5 dk; dikkatli iz incelemek, ağaca tırmanmak veya handa söylenti toplamak 15–30 dk; ciddi sohbet/pazarlık/ikna 15–45 dk sürer.
  * KRİTİK: "çalışıyorum / deniyorum / inmeye çalışıyorum" DENEMEKTİR; nesne belirtilmeden toplama/iş (forage_or_work) aracı ÇAĞIRMA. "Odun/şifalı bitki topluyorum" gibi nesne varsa çağır.
  * Oyuncu "1 gün / 3 saat / yarım gün boyunca" derse bunu süre ilanı olarak algıla; tek karelik kısa yürüyüşe indirgeme. Motorun ilan edilen süreyi işlemesine izin ver.
  * Avlanma/iş +3 saat, yerleşime destek/yardım +4 saat, kamp/dinlenme +8 saat; serbest eylemlerde eylemin gerçekçi süresine uygun minutesSpent (0–720 dk) seç.
- Dünya kuralları dışındaki imkânsız şeyler (büyüyle uçmak, ejderha çağırmak vb.) için sahte başarı üretme; free_roleplay_action ile gerçekçi sınırlar içinde değerlendir.
- EPİSTEMİK BİLGİ SINIRI: Yalnızca [Bilinen Yerleşim ve Noktalar] listesindeki yerler için travel_to_settlement çağır; keşfedilmemiş yerleşimleri, gizli goblin/haydut kamplarını veya klan adlarını asla araç argümanlarına ekleme.
- Her turda mutlaka en az bir uygun aracı çağır; araç sonucu olmadan rastgele olay uydurma.
- Araç çağrıları tamamlandığında ek araç gerekmiyorsa kısa bir "Hazır" notu bırakabilirsin.`;

const NARRATOR_SYSTEM_INSTRUCTION = `Sen "Sisli Doğu Atlası" masaüstü RPG oyununun baş anlatıcısı ve NPC sesisin.
Ana karakter Eşref (18 yaşında, 185 cm, esmer, atletik, karizmatik; hafıza kaybı yaşıyor).

=== 0. ANLATIM KİŞİSİ VE OYUNCUYA HİTAP (ZORUNLU) ===
- Tüm anlatım ikinci tekil şahıs, samimi "sen" diliyle yazılır: "bakıyorsun", "elinde", "senin", "fark ediyorsun", "açıyorsun".
- YASAK: "siz / sizin / elinizde / tuniğinizin / fark ediyorsunuz" gibi resmî çoğul hitap; "Eşref etrafına bakıyor", "Eşref yürüyor" gibi üçüncü şahıs anlatım. Aynı yanıt içinde kişi değiştirilemez.
- Eşref'in adını anlatıcı cümlesinde özne yapma; eylemi doğrudan oyuncuya hitap ederek anlat ("Çantanın ağzını açıyorsun…", "Eşref çantasını açıyor" DEĞİL).

=== 1. SİSLİ ORMAN FİZİĞİ VE SINIRLI GÖRÜŞ MESAFESİ ===
- Her bölge ~18 fersah (~90 km) genişliğindedir. Görüş alanı [ODAKLI SAHNE KARTI] içindeki "Zaman & Görüş" değeriyle (ormanda ~15–30 m, yoğun sis/fırtınada ~10–18 m, meşalesiz gecede ~5 m) sınırlıdır.
- Yalnızca Eşref'in bulunduğu noktada kendi duyularıyla doğrudan fark edebileceği yakın unsurları yaz.
- Her turda tüm duyuları sıralamak zorunda değilsin; yalnızca o anki eylemle ilgili olanı yaz. Aynı atmosferi (sis, nem, yosun, çam kokusu, ses yankısı) tekrar tekrar anlatma.
- Sisin veya gece karanlığının ötesindeki uzak vadileri, komşu arazileri, ufuktaki gölleri, köyleri, kuleleri veya kilometrelerce öteden yükselen dumanları GÖRÜNÜR KILMA.

=== 2. EPİSTEMİK BİLGİ SINIRI — GİZLİ KAMPLAR VE UZAK OLAYLAR YASAĞI ===
- Eşref hafızasını yitirmiştir; yalnızca [ODAKLI SAHNE KARTI] içinde izin verilen "Seçenek Sınırları" ve "Sahnedeki Varlıklar" adlarını bilir.
- Keşfedilmemiş köy/kale/han/harabe adlarını, gizli goblin/kobold inlerini, haydut kamplarını, uzak yerleşimlerdeki olayları veya tanışılmamış klan/NPC adlarını anlatımda ve 4 seçenekte ASLA açık etme.
- Kimliği belirsiz bir tehlike varsa yalnızca o an algılanan fiziksel belirtiyle anlat (ör. "sisin içinde kısa boylu, paslı silahlı iki karartı").

=== 3. MOTOR KARARINA VE FİZİKSEL KONUMA SADAKAT ===
- Sahneyi baştan yazma: [ODAKLI SAHNE KARTI] içindeki "Etkileyen Motor Unsurları", "[MOTOR KARARI / NE OLDU]" ve "[ANLATIM ODAĞI]" talimatlarına %100 uy.
- Olmayan eşya, gümüş, NPC, kamp ateşi, duman, iskele, matara, sandık, mektup veya iz uydurma; "G4", "mazgal", "karesi" gibi teknik kodlar kullanma.
- FİZİKSEL KONUM TUTARLILIĞI: "Konum & Pozisyon" ne diyorsa ona uy. Örneğin Eşref ağaç tepesindeyse yerdeki toprak, yosun veya ayak sesinden bahsetme.
- MOTOR SAYILARINA SADAKAT: [MOTOR KARARI / NE OLDU] içindeki mesafe, süre, saat, gümüş, erzak ve benzeri sayıları BİREBİR aktar. "0.4 fersah" yazıyorsa "0.4 fersah" yaz; "4 fersah" veya "dört fersah" yapma. Sayı yuvarlama, katlama veya tahmin etme.
- EŞYA TUTARLILIĞI: "Çanta & Kese" veya motor sonucunda geçmeyen eşya ayrıntılarını (kılıf, matara, sandık, mektup, ip bağlama biçimi vb.) uydurma. "Kuru dere yatağı" kurudur; içinden su akıtma, su sesi çıkarma.

=== 4. NET, DUYUSAL VE ÖZ ANLATIM (TEKRAR YASAĞI) ===
- ÜSLUP: Net, somut, duyusal odaklı ve öz 1–3 cümle yaz. Ağdalı edebi süslemeler, şiirsel benzetmeler ve basmakalıp klişeler ("ürkütücü bir melodi", "görkemli sessizlik", "sürekli aynı koku/sis tarifi") KESİNLİKLE YASAKTIR.
- TEKRAR YASAĞI (KATI): [SON SOHBET GEÇMİŞİ] içinde geçen çevre, zemin, ağaç, sis, koku veya ses tasvirlerini TEKRAR KULLANMA. Atmosferi yeniden kurmak yerine yalnızca motor kararının getirdiği yeni bilgiyi ver. Motor sonucu "Mekanik değişiklik yok" ise çevre tarifine hiç girme; tek cümlelik sonuç yeterlidir.
- DOĞRUDAN YANIT: Oyuncunun son aksiyonuna veya sorusuna doğrudan, lafı uzatmadan karşılık ver. Başka bir konuya (çevre, hava, manzara) KAYMA.
- KENDİNİ KONTROL ETME: Oyuncu üstünü, cebini, çantasını veya envanterini kontrol ediyorsa çevreyi tarif etme; doğrudan [ODAKLI SAHNE KARTI] içindeki "Çanta & Kese" satırındaki gerçek içeriği say ("Çantada üç kuru erzak ve yedek sicim var."). Orada olmayan eşya uydurma. Bu içerik önceki turda zaten verildiyse "Aynı şeyler yerinde duruyor." deyip yalnızca gerçekten yeni olan tek ayrıntıyı ekle. Üstünü/ceplerini kontrol eylemlerinde yanıtın İLK cümlesi mutlaka karttaki bir eşyayı (kılıç, gümüş, erzak, sicim) somut olarak içermek zorundadır; yosun, sis veya ağaç tarifiyle başlama.
- AYNI EYLEM TEKRARI: Oyuncu az önce yaptığı eylemi tekrar ediyorsa yeni sahne uydurma; sonucu tek kısa cümleyle ver.
- HER YANITTA EN AZ BİR YENİ SOMUT ÖĞE: bir nesne, iz, sesin kaynağı, arazi şekli, yapı kalıntısı veya kişi. "Yine sis, yine nem" gibi içeriksiz yanıt yasaktır.
- "Ne görüyorum?", "Ne var?" gibi doğrudan sorularda atmosfer yerine sayılabilir somut şeyler ver (2-4 kısa madde).
- SOMUTLUK İZNİ: [ODAKLI SAHNE KARTI] sınırları içinde kalmak şartıyla, sisin içinde görülebilecek sıradan ve HAREKETSİZ arazi öğelerini (devrilmiş kütük, yosunlu kaya, kuru dere yatağı, kırık dal, çalılık) betimleyebilirsin. Bunlar eşya, ödül veya isimli yer sayılmaz ve motor durumunu değiştirmez.
- İZ UYDURMA YASAĞI: Taze ayak izi, hayvan izi, taze kırık dal, sıcak kül, kan lekesi, yeni kesilmiş ağaç gibi "az önce buradan biri/ bir şey geçti" ima eden belirtileri UYDURMA. Bu tür izler yalnızca motor sonucu ya da [ODAKLI SAHNE KARTI] içinde açıkça verildiğinde anlatılır.
- Aynı yanıtta en fazla bir benzetme kullan; sıfat ve duygu yığınından kaçın.
- Bir NPC/grup doğrudan konuştuysa role="dialogue", speaker="<Kişi/Grup Adı>" seç; aksi hâlde role="narrator", speaker="Anlatıcı" kullan.
- Uykusuzluk uyarısı veya "AŞIRI UYKUSUZLUK VE BAYGINLIK" sonucu varsa bunu net ve kısa yansıt.
- Her yanıtın sonunda duruma uygun TAM 4 ADET kısa ve birbirinden FARKLI devam seçeneği (choices) üret; seçeneklerin "label" ve "actionPrompt" alanlarında da "Seçenek Sınırları" dışına çıkma.`;

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
      description:
        'İkinci tekil şahısla ("sen") yazılmış, 1-3 cümlelik (en fazla 50 kelime), net, duyusal odaklı, tekrar içermeyen ve oyuncunun aksiyonuna doğrudan yanıt veren öz Türkçe anlatı veya diyalog. "Siz/sizin/elinizde" ve "Eşref …yor" üçüncü şahıs anlatımı kullanılmaz. Edebi süsleme ve keşfedilmemiş yer, klan veya NPC adı içermez.',
    },
    choices: {
      type: Type.ARRAY,
      description:
        'Sonraki hamle için 4 adet kısa ve anlamlı eylem önerisi. Eşrefin henüz bilmediği yerleşim, klan veya gizli bilgi adlarını ASLA içermez.',
      items: {
        type: Type.OBJECT,
        properties: {
          label: {
            type: Type.STRING,
            description:
              'Butonda görünecek kısa etiket (3-7 kelime); keşfedilmemiş yer/klan adı içeremez.',
          },
          actionPrompt: {
            type: Type.STRING,
            description:
              'Seçildiğinde Eşref ağzından gönderilecek birinci tekil şahıs cümlesi; Eşrefin henüz bilmediği yer/klan adı veya sırrı içeremez.',
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

function isModelUnsupportedError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    msg.includes('PROXY_GENERATION_DISABLED') ||
    msg.includes('not found') ||
    msg.includes('NOT_FOUND') ||
    msg.includes('is not supported')
  );
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
        'Gemini API anahtarı geçersiz veya yetkisiz. Lütfen Settings > Secrets veya Anlatıcı Ayarları üzerinden anahtarınızı kontrol edin.',
    };
  }
  if (msg.includes('PROXY_GENERATION_DISABLED')) {
    return {
      status: 400,
      message:
        'Seçili model veya anahtar için Gemini isteği proxy tarafından desteklenmiyor. Ayarlardan farklı bir model (ör. Gemini 2.5 Flash) veya geçerli bir Gemini API anahtarı deneyin.',
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

async function generateWithModelFallback<T>(
  primaryModel: string,
  thinkingMode: string | undefined,
  runForModel: (model: string, thinking: ThinkingLevel | undefined) => Promise<T>
): Promise<T> {
  const candidates =
    primaryModel === 'gemini-2.5-flash'
      ? ['gemini-2.5-flash']
      : [primaryModel, 'gemini-2.5-flash'];
  let lastErr: unknown;
  for (let i = 0; i < candidates.length; i += 1) {
    const activeModel = candidates[i];
    const activeThinking = resolveThinkingLevel(activeModel, thinkingMode);
    try {
      return await generateWithRetry(() => runForModel(activeModel, activeThinking));
    } catch (err) {
      lastErr = err;
      if (i < candidates.length - 1 && isModelUnsupportedError(err)) {
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
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
  });

  app.post('/api/narrative/anythinkllm', async (req, res) => {
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

      const hasSceneCard = (body.contextSnapshotText ?? '').includes('[ODAKLI SAHNE KARTI]');
      const anyThinkPrompt = body.contextSnapshotText
        ? [
            body.contextSnapshotText,
            body.historyText ? `[SON SOHBET GEÇMİŞİ — TEKRAR ETME]\n${body.historyText}` : '',
            `[EŞREF'İN SON EYLEMİ]\n${body.playerActionText ?? ''}`,
            !hasSceneCard ? `[KESİN MOTOR SONUÇLARI]\n${factsBlock}` : '',
            body.preferredSpeaker
              ? `[KONUŞMA İPUCU]\nBu turda "${body.preferredSpeaker}" (${body.preferredRole ?? 'dialogue'}) doğrudan yanıt verdi; anlatımı veya diyaloğu bununla uyumlu kur.`
              : '',
          ]
            .filter(Boolean)
            .join('\n\n')
        : '';

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
            ...(anyThinkPrompt
              ? [{ role: 'user', content: anyThinkPrompt }]
              : messages),
          ],
          temperature: 0.65,
          response_format: { type: 'json_object' },
        }),
      });

      if (!anythinkResponse.ok) {
        const anythinkErrText = await anythinkResponse.text();
        res.status(502).json({
          error: `AnyThinkLLM isteği başarısız oldu (HTTP ${anythinkResponse.status}): ${anythinkErrText}`,
        });
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
                {
                  label: 'Çevreyi incele',
                  actionPrompt: 'Çevreyi dikkatle inceliyorum.',
                  kind: 'observe',
                },
                { label: 'Konuş', actionPrompt: 'Karşımdakiyle konuşuyorum.', kind: 'talk' },
                {
                  label: 'Yola devam et',
                  actionPrompt: 'Yoluma devam ediyorum.',
                  kind: 'travel',
                },
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

      if (body.mode !== 'finalize') {
        const contents = Array.isArray(body.turnContents) ? body.turnContents : [];
        if (contents.length === 0) {
          res.status(400).json({ error: 'Geçersiz tur içeriği.' });
          return;
        }

        const planResponse = await generateWithModelFallback(
          selectedModel,
          body.thinkingMode,
          (modelName, thinking) =>
            ai.models.generateContent({
              model: modelName,
              contents: contents as never,
              config: {
                systemInstruction: PLANNER_SYSTEM_INSTRUCTION,
                tools: [{ functionDeclarations: ENGINE_TOOL_DECLARATIONS }],
                ...(thinking ? { thinkingConfig: { thinkingLevel: thinking } } : {}),
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

      const hasSceneCard = (body.contextSnapshotText ?? '').includes('[ODAKLI SAHNE KARTI]');
      const narratorPrompt = [
        body.contextSnapshotText ? body.contextSnapshotText : '',
        body.historyText ? `[SON SOHBET GEÇMİŞİ — TEKRAR ETME]\n${body.historyText}` : '',
        `[EŞREF'İN SON EYLEMİ${body.chosenOptionKind ? ` (${body.chosenOptionKind})` : ''}]\n${body.playerActionText ?? ''}`,
        !hasSceneCard ? `[KESİN MOTOR SONUÇLARI]\n${factsBlock}` : '',
        body.preferredSpeaker
          ? `[KONUŞMA İPUCU]\nBu turda "${body.preferredSpeaker}" (${body.preferredRole ?? 'dialogue'}) doğrudan yanıt verdi; anlatımı veya diyaloğu bununla uyumlu kur.`
          : '',
      ]
        .filter(Boolean)
        .join('\n\n');

      const finalResponse = await generateWithModelFallback(
        selectedModel,
        body.thinkingMode,
        (modelName, thinking) =>
          ai.models.generateContent({
            model: modelName,
            contents: narratorPrompt,
            config: {
              systemInstruction: NARRATOR_SYSTEM_INSTRUCTION,
              responseMimeType: 'application/json',
              responseSchema: NARRATIVE_RESPONSE_SCHEMA,
              ...(thinking ? { thinkingConfig: { thinkingLevel: thinking } } : {}),
            },
          })
      );

      const rawJson = (finalResponse.text ?? '').trim();
      const parsed = (extractJsonObject(rawJson) ?? {}) as {
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
          speaker:
            (typeof parsed.speaker === 'string' && parsed.speaker.trim()) ||
            body.preferredSpeaker ||
            'Anlatıcı',
          role: parsed.role === 'dialogue' ? 'dialogue' : 'narrator',
          text:
            (typeof parsed.text === 'string' && parsed.text.trim()) ||
            readableNarrativeText(rawJson) ||
            factsBlock,
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
