/**
 * Anlatıcı çıktısı için modelden bağımsız son koruma katmanı.
 * LLM talimatları uygulamadığında bile tekrar, üçüncü şahıs ve
 * motor sonucunda olmayan iz/eşya uydurmalarını ayıklar.
 */

const SENTENCE_SPLIT = /(?<=[.!?])\s+/;

const fold = (value: string): string =>
  value
    .toLocaleLowerCase('tr-TR')
    .replace(/ı/g, 'i')
    .replace(/ş/g, 's')
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const tokens = (value: string): Set<string> =>
  new Set(fold(value).split(' ').filter((word) => word.length > 3));

function similarity(a: string, b: string): number {
  const aa = tokens(a);
  const bb = tokens(b);
  if (aa.size === 0 || bb.size === 0) return 0;
  let shared = 0;
  for (const token of aa) if (bb.has(token)) shared += 1;
  return shared / Math.max(aa.size, bb.size);
}

const THIRD_PERSON_FIXES: Array<[RegExp, string]> = [
  [/\bgörüyor\b/giu, 'görüyorsun'],
  [/\btopluyor\b/giu, 'topluyorsun'],
  [/\bbakıyor\b/giu, 'bakıyorsun'],
  [/\byürüyor\b/giu, 'yürüyorsun'],
  [/\binceliyor\b/giu, 'inceliyorsun'],
  [/\btakip ediyor\b/giu, 'takip ediyorsun'],
  [/\bfark ediyor\b/giu, 'fark ediyorsun'],
  [/\bhissediyor\b/giu, 'hissediyorsun'],
  [/\bçıkıyor\b/giu, 'çıkıyorsun'],
  [/\biniyor\b/giu, 'iniyorsun'],
  [/\byakalıyor\b/giu, 'yakalıyorsun'],
  [/\byapıyor\b/giu, 'yapıyorsun'],
];

function fixThirdPerson(sentence: string): string {
  let out = sentence;
  for (const [pattern, replacement] of THIRD_PERSON_FIXES) out = out.replace(pattern, replacement);
  return out;
}

/** Anlatıcı metnini son turlara ve motor gerçeğine göre temizler. */
export function guardNarrativeText(params: {
  text: string;
  recentNarratorTexts: string[];
  engineFacts: string[];
  fallback: string;
}): string {
  const { text, recentNarratorTexts, engineFacts, fallback } = params;
  const factsText = engineFacts.join(' ');
  const factsFold = fold(factsText);
  const recent = recentNarratorTexts
    .flatMap((item) => item.split(SENTENCE_SPLIT))
    .map((item) => item.trim())
    .filter(Boolean)
    .map(fold)
    .filter((item) => item.length > 8);

  const kept: string[] = [];
  for (const raw of text.split(SENTENCE_SPLIT).map((s) => s.trim()).filter(Boolean)) {
    // 1) "Eşref, ..." hitap öneki kaldırılır; özne olarak kalırsa cümle atılır.
    let clean = raw.replace(/^Eşref\s*,\s*/iu, '');
    if (/\bEşref\b/iu.test(clean)) continue;

    const normalized = fold(clean);
    // 2) Son turlardaki cümlelerin birebir/yakın tekrarı atılır.
    const repeated = recent.some(
      (old) =>
        old === normalized ||
        (old.length > 14 && normalized.includes(old)) ||
        (normalized.length > 14 && old.includes(normalized)) ||
        similarity(old, normalized) >= 0.68
    );
    if (repeated) continue;

    // 3) Motor sonucunda geçmeyen "iz" ve "ip" uydurmaları atılır.
    const inventsTrack =
      /\b(iz|izler|izi|izini|izleri|izin|izlerini)\b/iu.test(raw) && !factsFold.includes('iz');
    const inventsRope = /\b(ip|ip parçası|iparçası)\b/iu.test(raw) && !factsFold.includes('ip');
    if (inventsTrack || inventsRope) continue;

    kept.push(fixThirdPerson(clean));
  }

  let result = kept.slice(0, 3);
  while (result.length > 1 && result.join(' ').split(/\s+/).length > 60) result.pop();
  if (result.length === 0) return fallback.trim();
  let final = result.join(' ');
  if (final.split(/\s+/).length > 60) final = `${final.split(/\s+/).slice(0, 60).join(' ')}.`;
  return final;
}

const FIRST_PERSON_SWAPS: Array<[RegExp, string]> = [
  // Ön sınır YOK: "çalışıyorsun"/"yürüyorsun" içinde ünsüz/zamir sesiyle bitişik.
  [/yorsun\b/giu, 'yorum'],
  [/iyorsun\b/giu, 'iyorum'],
  [/\bkılıcını\b/giu, 'kılıcımı'],
  [/\bçantanı\b/giu, 'çantamı'],
  [/\belini\b/giu, 'elimi'],
  [/\bayaklarını\b/giu, 'ayaklarımı'],
  [/\bgözlerini\b/giu, 'gözlerimi'],
  [/\berzaklarını\b/giu, 'erzaklarımı'],
];

/** Seçenek metnini Eşref'in birinci tekil ağzına çevirir. */
export function forceFirstPersonAction(prompt: string): string {
  let out = prompt.trim().replace(/[.!?]+$/, '');
  for (const [pattern, replacement] of FIRST_PERSON_SWAPS) out = out.replace(pattern, replacement);
  return `${out}.`;
}
