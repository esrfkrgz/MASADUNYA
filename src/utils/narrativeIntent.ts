/**
 * Saf niyet/süre ayrıştırma yardımcıları.
 * Harici bağımlılığı yoktur; regresyon testleri doğrudan bunları içe aktarır.
 */

export function normalizeTr(text: string): string {
  return text
    .toLowerCase()
    .replace(/ı/g, 'i')
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ş/g, 's')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c')
    .trim();
}

/** Toplama/iş niyeti. "çalışıyorum" (denemek) asla dahil edilmez. */
export function hasForageIntent(normText: string): boolean {
  // "topla" ~ "topluyorum", "ara" ~ "arıyorum", "avla" ~ "avlıyorum":
  // Türkçe eylem kökü ünlü değişimi olduğu için her iki biçim de aranır.
  return /\b(avl[ai]\w*|odun\w*(?:\s+\w+){0,2}\s+topl[au]\w*|balik\w*|yiyecek\w*(?:\s+\w+){0,2}\s+ar[ai]\w*|sifa\w*(?:\s+\w+){0,3}\s+topl[au]\w*)\b/.test(
    normText
  );
}

/** Hırsızlık niyeti. "çalışıyorum"u dışlamak için cal(?!is) kullanılır. */
export function hasStealIntent(normText: string): boolean {
  return /\b(cal(?!is)\w*|hirsiz\w*|gasp\w*|harac\w*|tutsak\w*|kacir\w*)\b/.test(normText);
}

/** "1 gün", "3 saat", "yarım gün" gibi oyuncu bildirimlerini dakikaya çevirir. */
export function parseRequestedDurationMinutes(rawText: string): number {
  const norm = normalizeTr(rawText);
  const wordNumbers: Record<string, number> = {
    bir: 1, iki: 2, uc: 3, dort: 4, bes: 5, alti: 6, yedi: 7, sekiz: 8,
    dokuz: 9, on: 10, yirmi: 20, otuz: 30, kirk: 40, elli: 50, altmis: 60,
  };
  const unitMinutes = (unit: string): number =>
    unit === 'gun' ? 1440 : unit === 'saat' ? 60 : 1;

  const numeric = norm.match(/\b(\d+)\s*(gun|saat|dakika|dk)\b/);
  if (numeric) return Math.min(1440, Number(numeric[1]) * unitMinutes(numeric[2]));

  const written = norm.match(
    /\b(bir|iki|uc|dort|bes|alti|yedi|sekiz|dokuz|on|yirmi|otuz|kirk|elli|altmis)\s+(gun|saat|dakika)\b/
  );
  if (written) return Math.min(1440, (wordNumbers[written[1]] ?? 1) * unitMinutes(written[2]));

  if (/\byarim\s*gun\b/.test(norm)) return 720;
  return 0;
}
