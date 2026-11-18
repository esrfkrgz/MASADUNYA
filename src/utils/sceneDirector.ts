import type {
  MapLocation,
  MazgalCell,
  NarrativeMessage,
  ProtagonistState,
  WeatherConditionKey,
  WorldRoamingUnit,
} from '../types/map';
import { formatGameDateTime, getDayPhaseLabel } from './gameTime';
import { getHoursWithoutSleep, getProtagonistModifiers } from './protagonistEngine';

export type SceneActionCategory =
  | 'observe'
  | 'travel'
  | 'social'
  | 'combat'
  | 'survival'
  | 'free_roleplay';

export type ScenePosture = 'ground' | 'treetop' | 'settlement';

export interface SceneActionRecord {
  category: SceneActionCategory;
  subType: string;
  summary: string;
  outcomeTone: 'success' | 'fail' | 'neutral' | 'critical';
  durationLabel?: string;
  movedFromLabel?: string;
  movedToLabel?: string;
  discoveredPlaceName?: string;
  speakerName?: string;
  speakerRole?: 'narrator' | 'dialogue';
  focusDirective: string;
  forbiddenHints: string[];
}

const WEATHER_SHORT: Record<WeatherConditionKey, string> = {
  clear: 'Açık ve serin hava',
  mist: 'Yoğun doğu sisi',
  rain: 'Orman yağmuru',
  storm: 'Sert fırtına',
};

const DISTINCTIVE_PROPER_TOKENS = [
  'Paslıçukur',
  'Çakmaktaşı',
  'Batakhan',
  'Külköy',
  'Kulova',
  'Derebaşı',
  'Yüksekçam',
  'Bozpençe',
  'Taşburun',
  'Kızılşahin',
  'Söğütlü',
  'Gümüş Köprü',
  'Yosunlu Koyak',
  'Ayna Gölü',
  'Doğu Falezleri',
];

function normalizeTrSimple(text: string): string {
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

export function maskUndiscoveredNames(
  text: string,
  locations: MapLocation[],
  currentLocation?: MapLocation
): string {
  let masked = text;
  const knownText = locations
    .filter((l) => l.discovered || l.id === currentLocation?.id)
    .map((l) => l.name)
    .join(' ');

  for (const loc of locations) {
    if (loc.discovered || loc.id === currentLocation?.id) continue;
    const escaped = loc.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const replacement =
      loc.category === 'burrow'
        ? 'gizli bir yeraltı ini'
        : loc.category === 'village'
        ? 'uzaktaki bilinmeyen bir yerleşim'
        : 'keşfedilmemiş bir bölge';
    masked = masked.replace(new RegExp(escaped, 'gi'), replacement);
  }

  for (const token of DISTINCTIVE_PROPER_TOKENS) {
    if (knownText.toLowerCase().includes(token.toLowerCase())) continue;
    const escapedToken = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    masked = masked.replace(new RegExp(escapedToken, 'gi'), 'bilinmeyen');
  }

  const anyBurrowDiscovered = locations.some(
    (l) => l.category === 'burrow' && (l.discovered || l.id === currentLocation?.id)
  );
  if (!anyBurrowDiscovered) {
    masked = masked.replace(
      /\b(goblin|kobold)\s+(ini|inleri|kamp[ıi]|mağaras[ıi]|oyuklar[ıi]|tünelleri)/gi,
      'tekinsiz sığınak'
    );
  }
  return masked;
}

export function sanitizeNarrativeOutput(
  text: string,
  locations: MapLocation[],
  currentLocation?: MapLocation
): string {
  let clean = maskUndiscoveredNames(text, locations, currentLocation);
  clean = clean
    .replace(/\b[A-P][1-9]\s*(?:mazgal[ıia]?|karesi(?:ne|nde|nden)?)\b/gi, 'bu bölge')
    .replace(/\bmazgal(?:[ıia]|da|dan|lar[ıa]?)?\b/gi, 'bölge')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return clean;
}

export function getEffectiveVisibility(
  gameTimeMs: number,
  protagonist: ProtagonistState,
  cell: MazgalCell
): {
  dayPhase: string;
  isNight: boolean;
  hasTorchLit: boolean;
  effectiveVisibilityMeters: number;
} {
  const dayPhase = getDayPhaseLabel(gameTimeMs);
  const isNight = dayPhase === 'Gece' || dayPhase === 'Gece Yarısı';
  const hasTorchLit = (protagonist.activeConditions ?? []).includes('Meşale Işığı');
  const effectiveVisibilityMeters = isNight
    ? hasTorchLit
      ? Math.min(18, cell.visibilityMeters)
      : Math.min(5, cell.visibilityMeters)
    : cell.visibilityMeters;
  return { dayPhase, isNight, hasTorchLit, effectiveVisibilityMeters };
}

export function detectScenePosture(params: {
  currentLocation?: MapLocation;
  recentMessages: NarrativeMessage[];
  currentPlayerText: string;
  movedThisTurn: boolean;
  actionRecords: SceneActionRecord[];
}): ScenePosture {
  const { currentLocation, recentMessages, currentPlayerText, movedThisTurn, actionRecords } =
    params;

  if (currentLocation) return 'settlement';
  if (movedThisTurn) return 'ground';
  if (actionRecords.some((r) => r.subType === 'climb_vantage')) return 'treetop';
  if (actionRecords.some((r) => r.category === 'survival')) return 'ground';

  const normNow = normalizeTrSimple(currentPlayerText);
  if (/(?:^|\s)(asagi in|yere in|agactan in|inip|ineyim|iniyorum)/.test(normNow)) {
    return 'ground';
  }
  if (/(?:^|\s)(tirman|agaca cik|tepeye cik|yuksek.*cama.*cik)/.test(normNow)) {
    return 'treetop';
  }

  for (let i = recentMessages.length - 1; i >= 0; i -= 1) {
    const msg = recentMessages[i];
    const norm = normalizeTrSimple(msg.text);
    if (msg.role === 'player') {
      if (
        /(?:^|\s)(asagi in|yere in|agactan in|inip|iniyorum|yuru|ilerle|git|gidiyorum|kamp|uyu)/.test(
          norm
        )
      ) {
        return 'ground';
      }
      if (/(?:^|\s)(tirman|agaca cik|tepeye cik|agac tepes)/.test(norm)) {
        return 'treetop';
      }
    } else if (msg.role === 'narrator') {
      if (/(?:^|\s)(yere indin|topraga adim|zemine indin|yola koyuldun|kamp kur)/.test(norm)) {
        return 'ground';
      }
      if (/(?:^|\s)(agac(?:in)? tepes|cam(?:in)? tepes|yuksek bir cam|tepesine tirmand)/.test(norm)) {
        return 'treetop';
      }
    }
  }

  return 'ground';
}

function hasScoutBonusNote(notes: string[]): boolean {
  return notes.some((n) => /gözcü|keşifçi/i.test(n));
}

function formatPresenceSummary(params: {
  protagonist: ProtagonistState;
  locations: MapLocation[];
  currentLocation?: MapLocation;
  currentMazgal: MazgalCell;
  categories: Set<SceneActionCategory>;
}): string {
  const { protagonist, locations, currentLocation, currentMazgal, categories } = params;
  const contactsHere = (protagonist.contacts ?? []).filter(
    (c) =>
      c.partyRelation !== 'independent' ||
      (currentLocation
        ? c.currentLocationId === currentLocation.id
        : c.currentMazgalId === currentMazgal.id)
  );
  const unitsHere: WorldRoamingUnit[] = (protagonist.roamingUnits ?? []).filter(
    (u) => u.mazgalId === currentMazgal.id
  );

  const items: string[] = [];
  if (contactsHere.length > 0) {
    items.push(
      `Yanında/konumda: ${contactsHere.map((c) => `${c.name} (${c.role})`).join(', ')}`
    );
  }
  if (unitsHere.length > 0) {
    const unitStrings = unitsHere.map((u) => {
      const known =
        Boolean(currentLocation?.discovered) ||
        locations.some((l) => l.discovered && l.id === u.currentLocationId);
      if (known) return u.name;
      return u.kind === 'raider'
        ? 'kimliği belirsiz silahlı karartılar'
        : u.kind === 'caravan'
        ? 'yabancı bir kervan'
        : u.kind === 'patrol'
        ? 'silahlı sınır devriyesi'
        : 'silahlı gözcüler';
    });
    items.push(`Yakındaki hareketlilik: ${unitStrings.join(', ')}`);
  }

  if (
    currentLocation?.livingState &&
    (categories.has('social') || categories.has('travel') || categories.has('survival'))
  ) {
    const ls = currentLocation.livingState;
    if (ls.notableResidents.length > 0) {
      items.push(
        `Yerleşim sakinleri: ${ls.notableResidents
          .slice(0, 3)
          .map((r) => `${r.name} (${r.role})`)
          .join(', ')}`
      );
    }
    if (ls.activeProblems.length > 0) {
      items.push(
        `Yerel mesele: ${maskUndiscoveredNames(
          ls.activeProblems[0].title,
          locations,
          currentLocation
        )}`
      );
    }
  }

  return items.length > 0 ? items.join(' | ') : 'Yakında başka kimse veya canlı hareketi yok.';
}

export function buildPlannerContextBrief(params: {
  protagonist: ProtagonistState;
  locations: MapLocation[];
  currentLocation?: MapLocation;
  currentMazgal: MazgalCell;
  activeWeatherKey: WeatherConditionKey;
  gameTimeMs: number;
}): string {
  const { protagonist, locations, currentLocation, currentMazgal, activeWeatherKey, gameTimeMs } =
    params;
  const vis = getEffectiveVisibility(gameTimeMs, protagonist, currentMazgal);
  const knownSettlements = locations
    .filter((l) => l.discovered || l.id === currentLocation?.id)
    .map((l) => l.name)
    .join(', ');
  const contactsHere = (protagonist.contacts ?? []).filter(
    (c) =>
      c.partyRelation !== 'independent' ||
      (currentLocation
        ? c.currentLocationId === currentLocation.id
        : c.currentMazgalId === currentMazgal.id)
  );
  const unitsHere = (protagonist.roamingUnits ?? []).filter(
    (u) => u.mazgalId === currentMazgal.id
  );
  const inv = (protagonist.inventory ?? [])
    .filter((i) => i.qty > 0)
    .map((i) => `${i.name} x${i.qty}`)
    .join(', ');
  const dirs = currentMazgal.neighbors.map((n) => n.direction).join(', ');
  const hoursAwake = Math.round(getHoursWithoutSleep(protagonist, gameTimeMs));

  return [
    `Konum: ${currentLocation ? currentLocation.name : currentMazgal.terrainLabel} | Zaman: ${formatGameDateTime(gameTimeMs)} (${vis.dayPhase}) | Hava: ${WEATHER_SHORT[activeWeatherKey]} (Görüş ~${vis.effectiveVisibilityMeters}m)`,
    `Durum: Can ${protagonist.health}/100, Zindelik ${protagonist.stamina}/100, Açlık ${protagonist.hunger}/100, Uykusuzluk ${hoursAwake} saat`,
    `Çanta: ${protagonist.rations} Kuru Erzak, ${protagonist.silver} Gümüş | Eşyalar: ${inv || 'Yok'}`,
    `Geçilebilir Yönler: ${dirs}`,
    `Bilinen Yerleşim ve Noktalar: ${knownSettlements || 'Yok'}`,
    `Yanındaki/Konumdaki Kişiler: ${contactsHere.map((c) => c.name).join(', ') || 'Kimse yok'} | Yakındaki Gruplar: ${unitsHere.length > 0 ? `${unitsHere.length} hareketli grup` : 'Yok'}`,
  ].join('\n');
}

export function buildFocusedSceneCard(params: {
  protagonist: ProtagonistState;
  locations: MapLocation[];
  currentLocation?: MapLocation;
  currentMazgal: MazgalCell;
  activeWeatherKey: WeatherConditionKey;
  gameTimeMs: number;
  recentMessages: NarrativeMessage[];
  playerActionText: string;
  actionRecords: SceneActionRecord[];
  engineFacts: string[];
  movedThisTurn: boolean;
  preferredSpeaker?: string;
  preferredRole?: 'narrator' | 'dialogue';
}): string {
  const {
    protagonist,
    locations,
    currentLocation,
    currentMazgal,
    activeWeatherKey,
    gameTimeMs,
    recentMessages,
    playerActionText,
    actionRecords,
    engineFacts,
    movedThisTurn,
    preferredSpeaker,
  } = params;

  const categories = new Set<SceneActionCategory>(
    actionRecords.length > 0 ? actionRecords.map((r) => r.category) : ['free_roleplay']
  );
  const posture = detectScenePosture({
    currentLocation,
    recentMessages,
    currentPlayerText: playerActionText,
    movedThisTurn,
    actionRecords,
  });
  const vis = getEffectiveVisibility(gameTimeMs, protagonist, currentMazgal);
  const mods = getProtagonistModifiers(protagonist, currentLocation, currentMazgal);
  const hoursAwake = Math.round(getHoursWithoutSleep(protagonist, gameTimeMs));
  const inventoryLine =
    (protagonist.inventory ?? [])
      .filter((i) => i.qty > 0)
      .map((i) => `${i.name} x${i.qty}`)
      .join(', ') || 'Yok';

  const postureLabel =
    posture === 'treetop'
      ? 'Yüksek ağaç tepesinde (~8-10m yukarıda, YERDE DEĞİL)'
      : posture === 'settlement'
      ? `${currentLocation?.name ?? 'Yerleşim'} içinde`
      : 'Orman/arazi zemininde';

  const factors: string[] = [];
  if (hoursAwake >= 40) {
    factors.push(`Kritik uykusuzluk (${hoursAwake} saat: -2 Fiziksel/-2 Algı, bayılma eşiği)`);
  } else if (hoursAwake >= 22) {
    factors.push(`Aşırı yorgunluk (${hoursAwake} saat uykusuz: -1 Fiziksel/-1 Algı)`);
  }
  if (protagonist.health <= 45) factors.push(`Yaralı (${protagonist.health}/100 Can)`);
  if ((protagonist.injuries ?? []).length > 0) {
    factors.push(`Yara: ${(protagonist.injuries ?? []).join(', ')}`);
  }
  if (protagonist.hunger >= 70) factors.push(`Açlık (${protagonist.hunger}/100)`);
  if (protagonist.stamina <= 30) factors.push(`Bitkin (${protagonist.stamina}/100 Zindelik)`);

  if (categories.has('observe')) {
    const reasons: string[] = [];
    if (vis.isNight && !vis.hasTorchLit) reasons.push('meşalesiz gece (~5m)');
    else if (currentMazgal.visibilityMeters <= 25) reasons.push(`sis/örtü (~${vis.effectiveVisibilityMeters}m)`);
    if (hasScoutBonusNote(mods.notes)) reasons.push('yoldaş gözcü desteği');
    const cloak = (protagonist.inventory ?? []).find((i) => i.qty > 0 && (i.percBonus ?? 0) > 0);
    if (cloak) reasons.push(cloak.name);
    factors.push(
      `Algı ${mods.perceptionMod >= 0 ? `+${mods.perceptionMod}` : mods.perceptionMod}${
        reasons.length > 0 ? ` (${reasons.join(', ')})` : ''
      }`
    );
  }
  if (categories.has('travel')) {
    factors.push(`Hava: ${WEATHER_SHORT[activeWeatherKey]}, Arazi: ${currentMazgal.terrainLabel}`);
  }
  if (categories.has('combat')) {
    const bestWeapon = (protagonist.inventory ?? [])
      .filter((i) => i.qty > 0 && (i.physBonus ?? 0) > 0)
      .sort((a, b) => (b.physBonus ?? 0) - (a.physBonus ?? 0))[0];
    factors.push(
      `Fiziksel ${mods.physicalMod >= 0 ? `+${mods.physicalMod}` : mods.physicalMod}${
        bestWeapon ? `, Silah: ${bestWeapon.name}` : ''
      }`
    );
  }
  if (categories.has('social')) {
    factors.push(
      `Sosyal ${mods.socialMod >= 0 ? `+${mods.socialMod}` : mods.socialMod}, İtibar: ${mods.repSummary}`
    );
    if (preferredSpeaker) {
      const contact = (protagonist.contacts ?? []).find(
        (c) => c.name === preferredSpeaker || preferredSpeaker.includes(c.name)
      );
      if (contact) {
        factors.push(
          `Muhatap ruh hali: ${contact.mood ?? 'Temkinli'} (Güven ${contact.trust}/100, Yakınlık ${contact.affection}/100)`
        );
      }
    }
  }
  if (categories.has('survival')) {
    factors.push(
      `Can ${protagonist.health}/100, Zindelik ${protagonist.stamina}/100, Açlık ${protagonist.hunger}/100`
    );
  }

  const presenceLine = formatPresenceSummary({
    protagonist,
    locations,
    currentLocation,
    currentMazgal,
    categories,
  });

  const knownSettlements = locations
    .filter((l) => l.discovered || l.id === currentLocation?.id)
    .map((l) => l.name)
    .join(', ');
  const availableDirs = currentMazgal.neighbors.map((n) => n.direction).join(', ');

  const resultsBlock =
    actionRecords.length > 0
      ? actionRecords
          .map((r, i) => `${i + 1}. ${sanitizeNarrativeOutput(r.summary, locations, currentLocation)}`)
          .join('\n')
      : engineFacts.length > 0
      ? engineFacts
          .map((f, i) => `${i + 1}. ${sanitizeNarrativeOutput(f, locations, currentLocation)}`)
          .join('\n')
      : 'Mekanik değişiklik yok.';

  const focusLines = Array.from(
    new Set(actionRecords.map((r) => r.focusDirective).filter(Boolean))
  );
  if (categories.has('travel') && movedThisTurn) {
    focusLines.push(
      'Yeni ulaşılan yerin farkını ve süre/yorgunluk etkisini kısaca söyle; önceki turun betimlemesini tekrarlama.'
    );
  }
  if (focusLines.length === 0) {
    focusLines.push(
      'Oyuncunun son aksiyonuna doğrudan, tekrar yapmadan 1–3 net ve duyusal cümleyle yanıt ver.'
    );
  }

  const forbiddenLines = Array.from(
    new Set(actionRecords.flatMap((r) => r.forbiddenHints).filter(Boolean))
  );
  if (posture === 'treetop' && forbiddenLines.length === 0) {
    forbiddenLines.push(
      'Eşref şu an ağaç tepesinde: yerdeki toprak, yosun veya ayak sesi tasviri YAPMA!'
    );
  }

  return [
    `[ODAKLI SAHNE KARTI]`,
    `Konum & Pozisyon: ${currentLocation ? currentLocation.name : currentMazgal.terrainLabel} · ${postureLabel}`,
    `Zaman & Görüş: ${formatGameDateTime(gameTimeMs)} (${vis.dayPhase}) · ${
      vis.isNight && !vis.hasTorchLit
        ? `Meşalesiz gece (~${vis.effectiveVisibilityMeters}m görüş)`
        : `${WEATHER_SHORT[activeWeatherKey]} (~${vis.effectiveVisibilityMeters}m görüş)`
    }`,
    factors.length > 0 ? `Etkileyen Motor Unsurları: ${factors.join(' | ')}` : '',
    `Çanta & Kese: ${protagonist.silver} gümüş, ${protagonist.rations} kuru erzak | Eşyalar: ${inventoryLine}`,
    `Sahnedeki Varlıklar: ${presenceLine}`,
    `\n[MOTOR KARARI / NE OLDU]\n${resultsBlock}`,
    `\n[ANLATIM ODAĞI]\n- ${focusLines.join('\n- ')}`,
    forbiddenLines.length > 0 ? `- Yasaklar: ${forbiddenLines.join(' ')}` : '',
    `Seçenek Sınırları: Yalnızca şu yönleri (${availableDirs}) veya bilinen yerleri (${
      knownSettlements || 'yok'
    }) kullan; gizli kamp/klan/uzak yer adı ve sahnede olmayan nesne (ateş, iskele, matara vb.) ekleme.`,
  ]
    .filter(Boolean)
    .join('\n');
}
