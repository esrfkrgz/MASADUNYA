/**
 * Evrensel eylem risk motoru.
 *
 * Amaç: "serbest rol yapma" gibi hiç zar atılmayan eylemler dâhil her eylemin
 * ilgili metriklerle (Fiziksel / Algı / Sosyal, yorgunluk, gece, hava, zemin,
 * dikkatli/acele yaklaşım) hesaplanması. Sonuçlar motor gerçeği olarak anlatıcıya
 * geçer; sayıların birebir aktarılması zorunludur.
 *
 * Saf modüldür: dosya/varlık bağımlılığı yoktur, doğrudan test edilebilir.
 */

export type RiskStat = 'physical' | 'perception' | 'social';

export type RiskCategory =
  | 'climb'
  | 'descend'
  | 'forage'
  | 'inspect'
  | 'stealth'
  | 'travel'
  | 'social'
  | 'craft'
  | 'rest'
  | 'free';

export type RiskDegree = 'critical_success' | 'success' | 'failure' | 'critical_failure';

export interface RiskProfile {
  stat: RiskStat;
  label: string;
  baseDc: number;
  baseMinutes: number;
  staminaCost: number;
  failureStaminaCost: number;
  hazardDamage: number;
  hazardCondition?: string;
}

/** Her eylem sınıfının hangi metriği kullandığını ve bedelini tanımlar. */
export const ACTION_RISK_PROFILES: Record<RiskCategory, RiskProfile> = {
  climb: {
    stat: 'physical', label: 'Tırmanış', baseDc: 12, baseMinutes: 15,
    staminaCost: 6, failureStaminaCost: 10, hazardDamage: 8, hazardCondition: 'Yaralı (Düşme)',
  },
  descend: {
    stat: 'physical', label: 'Ağaçtan iniş', baseDc: 11, baseMinutes: 5,
    staminaCost: 3, failureStaminaCost: 8, hazardDamage: 7, hazardCondition: 'Yaralı (Düşme)',
  },
  forage: {
    stat: 'perception', label: 'Toplama', baseDc: 11, baseMinutes: 30,
    staminaCost: 6, failureStaminaCost: 12, hazardDamage: 0,
  },
  inspect: {
    stat: 'perception', label: 'Gözlem', baseDc: 10, baseMinutes: 10,
    staminaCost: 1, failureStaminaCost: 2, hazardDamage: 0,
  },
  stealth: {
    stat: 'physical', label: 'Gizli hareket', baseDc: 13, baseMinutes: 10,
    staminaCost: 4, failureStaminaCost: 8, hazardDamage: 0,
  },
  travel: {
    stat: 'physical', label: 'Yolculuk', baseDc: 10, baseMinutes: 60,
    staminaCost: 8, failureStaminaCost: 16, hazardDamage: 0,
  },
  social: {
    stat: 'social', label: 'Sosyal etkileşim', baseDc: 12, baseMinutes: 15,
    staminaCost: 2, failureStaminaCost: 4, hazardDamage: 0,
  },
  craft: {
    stat: 'physical', label: 'Yapma/onarım', baseDc: 11, baseMinutes: 25,
    staminaCost: 5, failureStaminaCost: 9, hazardDamage: 2,
  },
  rest: {
    stat: 'physical', label: 'Dinlenme', baseDc: 8, baseMinutes: 60,
    staminaCost: 0, failureStaminaCost: 0, hazardDamage: 0,
  },
  free: {
    stat: 'physical', label: 'Serbest eylem', baseDc: 10, baseMinutes: 5,
    staminaCost: 2, failureStaminaCost: 5, hazardDamage: 0,
  },
};

export interface ActionRiskInput {
  category: RiskCategory;
  roll: number;            // d20
  secondaryRoll: number;   // d6, hasar/sonuç büyüklüğü
  mods: { physical: number; perception: number; social: number };
  nightWithoutTorch: boolean;
  lowVisibility: boolean;
  wetGround: boolean;
  heavyWeather: boolean;
  exhausted: boolean;
  careful: boolean;
  rushing: boolean;
}

export interface ActionRiskOutcome {
  category: RiskCategory;
  stat: RiskStat;
  label: string;
  dc: number;
  roll: number;
  mod: number;
  total: number;
  degree: RiskDegree;
  minutes: number;
  staminaLoss: number;
  healthLoss: number;
  condition?: string;
  fact: string;
  focusDirective: string;
}

const STAT_LABELS: Record<RiskStat, string> = {
  physical: 'Fiziksel',
  perception: 'Algı',
  social: 'Sosyal',
};

const DEGREE_LABELS: Record<RiskDegree, string> = {
  critical_success: 'Kritik başarı',
  success: 'Başarı',
  failure: 'Başarısızlık',
  critical_failure: 'Kritik başarısızlık',
};

/** Eylem metninden risk sınıfı çıkarır; bilemeyense 'free' döner. */
export function inferRiskCategory(normText: string): RiskCategory {
  if (/\b(asagi\s+in|agactan\s+(?:asagi\s+)?in|yere\s+in|inmeye|iniyorum|inip)/.test(normText)) return 'descend';
  if (/\b(tirman\w*|agaca\s*cik|tepeye\s*cik|yuksek.*cama.*cik)/.test(normText)) return 'climb';
  if (/\b(odun\w*(?:\s+\w+){0,2}\s+topl|sifa\w*(?:\s+\w+){0,3}\s+topl|avlan\w*|avliyorum|balik\w*|yiyecek\w*(?:\s+\w+){0,2}\s+ar)/.test(normText)) return 'forage';
  if (/\b(incele\w*|gozlem\w*|bak\w*|izl\w*|dinl\w*|ariyorum|arastir\w*)/.test(normText)) return 'inspect';
  if (/\b(gizli\w*|sessiz\w*|usulca|sokularak|pusu\w*)/.test(normText)) return 'stealth';
  if (/\b(konus\w*|sohbet\w*|ikna\w*|pazarlik\w*|sor\w*|selam\w*)/.test(normText)) return 'social';
  if (/\b(yap\w*|onar\w*|bile\w*|kili\w*|dik\w*|bagla\w*)/.test(normText)) return 'craft';
  if (/\b(uyu\w*|uyku\w*|dinlen\w*|kestir\w*)/.test(normText)) return 'rest';
  return 'free';
}

/**
 * Eylemi ilgili metrik, çevre ve yaklaşım etkenleriyle çözümler.
 * Zar sonuçları çağıran tarafça üretilir; bu fonksiyon saf hesap yapar.
 */
export function resolveActionRisk(input: ActionRiskInput): ActionRiskOutcome {
  const profile = ACTION_RISK_PROFILES[input.category];
  const mod = input.mods[profile.stat];

  let dc = profile.baseDc;
  if (input.nightWithoutTorch) dc += 2;
  if (input.lowVisibility) dc += 1;
  if (input.wetGround) dc += 1;
  if (input.heavyWeather) dc += 1;
  if (input.exhausted) dc += 1;
  if (input.careful) dc -= 2;
  if (input.rushing) dc += 3;
  dc = Math.max(6, Math.min(20, dc));

  const total = input.roll + mod + (input.careful ? 1 : 0) - (input.rushing ? 1 : 0);
  const margin = total - dc;
  const degree: RiskDegree =
    margin >= 5
      ? 'critical_success'
      : margin >= 0
      ? 'success'
      : margin >= -5
      ? 'failure'
      : 'critical_failure';

  let minutes = profile.baseMinutes;
  if (input.careful) minutes = Math.round(minutes * 1.5);
  if (input.rushing) minutes = Math.round(minutes * 0.7);
  if (degree === 'critical_failure') minutes = Math.round(minutes * 1.25);

  let staminaLoss =
    degree === 'critical_success'
      ? Math.max(0, profile.staminaCost - 2)
      : degree === 'success'
      ? profile.staminaCost
      : degree === 'failure'
      ? profile.failureStaminaCost
      : profile.failureStaminaCost + 3;

  let healthLoss = 0;
  if ((degree === 'failure' || degree === 'critical_failure') && profile.hazardDamage > 0) {
    healthLoss =
      degree === 'critical_failure'
        ? profile.hazardDamage * 2 + Math.floor(input.secondaryRoll / 2)
        : profile.hazardDamage + Math.floor(input.secondaryRoll / 3);
  }
  const condition =
    healthLoss > 0 ? profile.hazardCondition ?? 'Yaralı' : undefined;

  const modText = mod >= 0 ? `+${mod}` : `${mod}`;
  const effects: string[] = [`+${minutes} dk`];
  if (staminaLoss > 0) effects.push(`-${staminaLoss} Zindelik`);
  if (healthLoss > 0) effects.push(`-${healthLoss} Can`);
  if (condition) effects.push(condition);
  if (degree === 'critical_success' && input.category === 'forage') effects.push('+1 Erzak');

  const fact = `${profile.label} riski (${STAT_LABELS[profile.stat]} zarı ${input.roll}${modText}=${total} / DC ${dc}): ${DEGREE_LABELS[degree]}. ${effects.join(', ')}.`;

  const focusDirective =
    degree === 'critical_success' || degree === 'success'
      ? `${DEGREE_LABELS[degree]} sonucunu ve motor sayılarını (${effects.join(', ')}) birebir aktar; yeni bir tehlike uydurma.`
      : `${DEGREE_LABELS[degree]} sonucunu, ${effects.join(', ')} bedelini ve varsa düşme/yaralanma sonucunu net söyle; başarıymış gibi anlatma.`;

  return {
    category: input.category,
    stat: profile.stat,
    label: profile.label,
    dc,
    roll: input.roll,
    mod,
    total,
    degree,
    minutes,
    staminaLoss,
    healthLoss,
    condition,
    fact,
    focusDirective,
  };
}
