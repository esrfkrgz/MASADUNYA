export const INITIAL_GAME_TIME_MS = Date.UTC(2026, 5, 6, 8, 0, 0); // 06.06.2026 08:00

const MS_PER_MINUTE = 60 * 1000;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;
const MS_PER_DAY = 24 * MS_PER_HOUR;

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

export function formatGameDate(ms: number): string {
  const d = new Date(ms);
  const day = pad2(d.getUTCDate());
  const month = pad2(d.getUTCMonth() + 1);
  const year = d.getUTCFullYear();
  return `${day}.${month}.${year}`;
}

export function formatGameHour(ms: number): string {
  const d = new Date(ms);
  return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
}

export function formatGameDateTime(ms: number): string {
  return `${formatGameDate(ms)} · ${formatGameHour(ms)}`;
}

export function getDayNumber(ms: number): number {
  const startMidnight = Date.UTC(2026, 5, 6, 0, 0, 0);
  const d = new Date(ms);
  const currentMidnight = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0);
  return Math.max(1, Math.floor((currentMidnight - startMidnight) / MS_PER_DAY) + 1);
}

export function getDayPhaseLabel(ms: number): string {
  const hour = new Date(ms).getUTCHours();
  if (hour >= 5 && hour < 11) return 'Sabah';
  if (hour >= 11 && hour < 14) return 'Öğle';
  if (hour >= 14 && hour < 18) return 'İkindi';
  if (hour >= 18 && hour < 21) return 'Akşam';
  return 'Gece';
}

export function addGameMinutes(ms: number, minutes: number): number {
  return ms + Math.round(minutes * MS_PER_MINUTE);
}

export function addGameHours(ms: number, hours: number): number {
  return ms + Math.round(hours * MS_PER_HOUR);
}
