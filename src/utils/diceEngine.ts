export type RollAdvantageMode = 'normal' | 'advantage' | 'disadvantage';

export interface DiceRollResult {
  id: string;
  expression: string;
  count: number;
  sides: number;
  modifier: number;
  rolls: number[];
  keptRolls: number[];
  mode: RollAdvantageMode;
  subtotal: number;
  total: number;
  naturalNote?: 'Kritik 20' | 'Doğal 1';
  dc?: number;
  outcomeLabel?: string;
  outcomeTone?: 'critical' | 'success' | 'partial' | 'fail' | 'fumble';
  timestamp: string;
}

export function rollDie(sides: number): number {
  const safeSides = Math.max(2, Math.floor(sides));
  return Math.floor(Math.random() * safeSides) + 1;
}

export function parseDiceExpression(raw: string): {
  count: number;
  sides: number;
  modifier: number;
  normalized: string;
} | null {
  const cleaned = raw.trim().toLowerCase().replace(/\s+/g, '');
  const match = cleaned.match(/^(\d{0,2})d(\d{1,3})([+-]\d{1,3})?$/);
  if (!match) return null;

  const count = Math.min(20, Math.max(1, match[1] ? Number(match[1]) : 1));
  const sides = Math.min(1000, Math.max(2, Number(match[2])));
  const modifier = match[3] ? Number(match[3]) : 0;

  const modStr = modifier === 0 ? '' : modifier > 0 ? `+${modifier}` : `${modifier}`;
  return {
    count,
    sides,
    modifier,
    normalized: `${count}d${sides}${modStr}`,
  };
}

export function evaluateDcOutcome(
  total: number,
  dc: number,
  naturalNote?: 'Kritik 20' | 'Doğal 1'
): {
  label: string;
  tone: 'critical' | 'success' | 'partial' | 'fail' | 'fumble';
} {
  if (naturalNote === 'Doğal 1') {
    return { label: 'Kritik Hata (Doğal 1)', tone: 'fumble' };
  }
  if (naturalNote === 'Kritik 20' || total >= dc + 8) {
    return { label: 'Kritik Başarı', tone: 'critical' };
  }
  if (total >= dc) {
    return { label: 'Tam Başarı', tone: 'success' };
  }
  if (total >= dc - 2) {
    return { label: 'Kısmi Başarı (Zorlu Bedel)', tone: 'partial' };
  }
  return { label: 'Başarısız', tone: 'fail' };
}

export function rollDiceEngine(options: {
  expression: string;
  mode?: RollAdvantageMode;
  targetDc?: number;
}): DiceRollResult {
  const parsed = parseDiceExpression(options.expression) ?? {
    count: 1,
    sides: 20,
    modifier: 0,
    normalized: '1d20',
  };

  const mode: RollAdvantageMode =
    parsed.count === 1 && parsed.sides === 20 && options.mode ? options.mode : 'normal';

  let rolls: number[] = [];
  let keptRolls: number[] = [];

  if (mode === 'advantage' || mode === 'disadvantage') {
    const r1 = rollDie(20);
    const r2 = rollDie(20);
    rolls = [r1, r2];
    keptRolls = [mode === 'advantage' ? Math.max(r1, r2) : Math.min(r1, r2)];
  } else {
    for (let i = 0; i < parsed.count; i++) {
      rolls.push(rollDie(parsed.sides));
    }
    keptRolls = [...rolls];
  }

  const subtotal = keptRolls.reduce((sum, val) => sum + val, 0);
  const total = subtotal + parsed.modifier;

  let naturalNote: 'Kritik 20' | 'Doğal 1' | undefined;
  if (parsed.count === 1 && parsed.sides === 20) {
    if (keptRolls[0] === 20) naturalNote = 'Kritik 20';
    else if (keptRolls[0] === 1) naturalNote = 'Doğal 1';
  }

  const dcEval =
    typeof options.targetDc === 'number' && options.targetDc > 0
      ? evaluateDcOutcome(total, options.targetDc, naturalNote)
      : undefined;

  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');

  return {
    id: `roll-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    expression:
      mode === 'advantage'
        ? `${parsed.normalized} (Avantaj)`
        : mode === 'disadvantage'
        ? `${parsed.normalized} (Dezavantaj)`
        : parsed.normalized,
    count: parsed.count,
    sides: parsed.sides,
    modifier: parsed.modifier,
    rolls,
    keptRolls,
    mode,
    subtotal,
    total,
    naturalNote,
    dc: options.targetDc,
    outcomeLabel: dcEval?.label,
    outcomeTone: dcEval?.tone,
    timestamp: `${hh}:${mm}:${ss}`,
  };
}
