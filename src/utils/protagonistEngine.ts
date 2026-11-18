import type {
  FactionKey,
  MapLocation,
  MazgalCell,
  ProtagonistActionType,
  ProtagonistEventRecord,
  ProtagonistMood,
  ProtagonistState,
  SettlementArchetype,
  TravelPace,
  TravelTransport,
  WeatherConditionKey,
} from '../types/map';
import { rollDie } from './diceEngine';
import { INITIAL_GAME_TIME_MS, addGameHours, formatGameDateTime, getDayPhaseLabel } from './gameTime';
import { getCellForCoords } from './gridEngine';
import {
  buildInitialNpcMoments,
  computeNpcMood,
  createInitialContacts,
  createNpcMomentRecord,
  getDefaultMoralityForContact,
  getPartyBonusSummary,
} from './partyAndRelationsEngine';
import {
  createInitialInventory,
  createInitialRoamingUnits,
  getEquipmentBonuses,
} from './worldSystemsEngine';

const MAX_JOURNAL = 12;
const MAX_CONDITIONS = 4;
const MAX_MARKS = 4;

export const FACTION_LABELS: Record<FactionKey, string> = {
  border_human: 'İnsan Sınır Yerleşimleri',
  elf: 'Yüksekçam Elfleri',
  beastkin: 'Bozpençe Klanı',
  outlaws: 'Kuzey Eşkıya ve Kaçakçıları',
  goblinoids: 'Goblin-Kobold İnleri',
};

export const ACTION_HOURS: Record<ProtagonistActionType, number> = {
  observe: 1,
  converse: 1,
  forage_or_work: 3,
  help_settlement: 4,
  rest_camp: 8,
};

export function getFactionForLocation(location?: MapLocation): FactionKey {
  const arch: SettlementArchetype | undefined = location?.livingState?.archetype;
  switch (arch) {
    case 'elf_canopy':
      return 'elf';
    case 'beastkin_clan':
      return 'beastkin';
    case 'goblin_burrow':
      return 'goblinoids';
    case 'bandit_hamlet':
    case 'smuggler_cove':
      return 'outlaws';
    default:
      return 'border_human';
  }
}

export function getReputationLabel(score: number): {
  label: string;
  tone: 'ally' | 'warm' | 'neutral' | 'cold' | 'hostile';
} {
  if (score >= 30) return { label: 'Güvenilen Dost', tone: 'ally' };
  if (score >= 12) return { label: 'İyi Tanınan', tone: 'warm' };
  if (score > -12) return { label: 'Tarafsız / Yabancı', tone: 'neutral' };
  if (score > -30) return { label: 'Şüpheyle Karşılanan', tone: 'cold' };
  return { label: 'İstenmeyen / Düşman', tone: 'hostile' };
}

export function computeProtagonistMood(
  health: number,
  stamina: number,
  hunger: number,
  localSafety: number
): ProtagonistMood {
  if (health <= 45) return 'Yaralı';
  if (stamina <= 28 || hunger >= 75) return 'Yorgun';
  if (localSafety <= 36) return 'Gergin';
  if (stamina >= 68 && health >= 75 && hunger <= 40) return 'Dinç';
  return 'Temkinli';
}

export interface ProtagonistContextModifiers {
  physicalMod: number;
  socialMod: number;
  perceptionMod: number;
  factionKey: FactionKey;
  factionLabel: string;
  factionRep: number;
  repSummary: string;
  notes: string[];
}

export function getProtagonistModifiers(
  protagonist: ProtagonistState,
  currentLocation?: MapLocation,
  currentMazgal?: MazgalCell
): ProtagonistContextModifiers {
  const factionKey = getFactionForLocation(currentLocation);
  const factionRep = protagonist.reputation[factionKey] ?? 0;
  const repInfo = getReputationLabel(factionRep);

  let physicalMod = 0;
  let socialMod = 0;
  let perceptionMod = 0;
  const notes: string[] = [];

  if (protagonist.health <= 45) {
    physicalMod -= 2;
    notes.push('Yaralı halin fiziksel testlere -2 zorluk getiriyor.');
  }
  const hoursAwake = getHoursWithoutSleep(protagonist, protagonist.lastUpdatedMs);
  if (hoursAwake >= 42) {
    physicalMod -= 2;
    perceptionMod -= 2;
    notes.push('Yaklaşık 2 gündür uykusuzsun (-2 Fiziksel, -2 Algı) — bayılma eşiğindesin!');
  } else if (hoursAwake >= 24) {
    physicalMod -= 1;
    perceptionMod -= 1;
    notes.push('Aşırı yorgunluk ve uykusuzluk (-1 Fiziksel, -1 Algı) — uyuman gerekiyor.');
  }
  if (protagonist.stamina <= 30) {
    physicalMod -= 1;
    perceptionMod -= 1;
    notes.push('Zindelik düşüklüğü dikkat ve dayanıklılığı düşürüyor (-1 Fiziksel, -1 Algı).');
  } else if (protagonist.stamina >= 80 && protagonist.health >= 85 && hoursAwake < 20) {
    physicalMod += 1;
    notes.push('Dinç durumdasın (+1 Fiziksel test avantajı).');
  }

  if (protagonist.hunger >= 70) {
    physicalMod -= 1;
    socialMod -= 1;
    notes.push('Açlık sabrını ve gücünü azaltıyor (-1 Fiziksel/Sosyal).');
  }

  if (factionRep >= 25) {
    socialMod += 2;
    notes.push(`${FACTION_LABELS[factionKey]} seni iyi tanıyor (+2 İkna/Takas).`);
  } else if (factionRep >= 10) {
    socialMod += 1;
    notes.push(`${FACTION_LABELS[factionKey]} nezdinde olumlu ismin var (+1 Sosyal).`);
  } else if (factionRep <= -20) {
    socialMod -= 2;
    notes.push(`${FACTION_LABELS[factionKey]} sana güvenmiyor (-2 Sosyal, nöbetçiler tetikte).`);
  }

  if (currentMazgal && currentMazgal.visibilityMeters <= 25) {
    perceptionMod -= 1;
    notes.push(`Yoğun arazi sisi görüşü ${currentMazgal.visibilityMeters}m ile sınırlıyor (-1 Algı).`);
  }

  const partyBonus = getPartyBonusSummary(protagonist.contacts ?? []);
  physicalMod += partyBonus.combatBonus;
  socialMod += partyBonus.socialBonus;
  perceptionMod += partyBonus.scoutBonus;
  if (partyBonus.mode !== 'solo') {
    notes.push(...partyBonus.summaryNotes);
  }

  const eq = getEquipmentBonuses(protagonist.inventory ?? []);
  physicalMod += eq.physBonus;
  perceptionMod += eq.percBonus;
  socialMod += eq.socBonus;
  if (eq.notes.length > 0) {
    notes.push(`Taşınan donanım: ${eq.notes.join(', ')}.`);
  }

  const injuries = protagonist.injuries ?? [];
  if (injuries.length > 0) {
    physicalMod -= 1;
    notes.push(`Aktif yaralar fiziksel testleri zorlaştırıyor (-1 Fiziksel: ${injuries.join(', ')}).`);
  }

  if ((protagonist.marks ?? []).includes('Doğuştan Karizma')) {
    physicalMod += 1;
    socialMod += 1;
    notes.push('185 cm atletik yapın ve doğal karizman etkileşimlerde avantaj sağlıyor (+1 Fiziksel, +1 Sosyal).');
  }

  if (notes.length === 0) {
    notes.push('Durumun dengeli; çevreye olağan dikkatle uyum sağlıyorsun.');
  }

  return {
    physicalMod,
    socialMod,
    perceptionMod,
    factionKey,
    factionLabel: FACTION_LABELS[factionKey],
    factionRep,
    repSummary: repInfo.label,
    notes,
  };
}

function pushJournal(
  journal: ProtagonistEventRecord[],
  entry: ProtagonistEventRecord
): ProtagonistEventRecord[] {
  return [entry, ...journal].slice(0, MAX_JOURNAL);
}

export function getHoursWithoutSleep(
  protagonist: ProtagonistState,
  gameTimeMs: number
): number {
  const sleptAt = protagonist.lastSleptMs ?? INITIAL_GAME_TIME_MS;
  return Math.max(0, (gameTimeMs - sleptAt) / (60 * 60 * 1000));
}

function updateConditions(
  health: number,
  stamina: number,
  hunger: number,
  cell?: MazgalCell,
  hoursAwake = 0
): string[] {
  const next: string[] = [];
  if (hoursAwake >= 40) next.push('Aşırı Uykusuzluk (Uyumalısın!)');
  else if (hoursAwake >= 20) next.push('Aşırı Yorgunluk');
  if (health <= 45) next.push('Yaralı (Dinlenme Gerekir)');
  if (stamina <= 30) next.push('Bitkin');
  if (hunger >= 70) next.push('Açlık Hissi');
  if (cell) {
    if (cell.terrain === 'marsh' || cell.terrain === 'river') {
      next.push('Nemli ve Çamurlu Zemin');
    } else if (cell.terrain === 'mountain' || cell.terrain === 'coast') {
      next.push('Soğuk Rüzgar');
    } else if (cell.safetyScore >= 75) {
      next.push('Güvenli Çevre');
    }
  }
  return next.slice(0, MAX_CONDITIONS);
}

export function createInitialProtagonist(locations: MapLocation[]): ProtagonistState {
  const ts = formatGameDateTime(INITIAL_GAME_TIME_MS);
  const initialContacts = createInitialContacts(locations);

  return {
    name: 'Eşref',
    title: 'Hafızasını Yitirmiş 18 Yaşında Esmer Genç',
    appearanceNote:
      '18 yaşında, 185 cm boyunda, esmer tenli, atletik yapılı ve karizmatik bir genç. Hafıza kaybı nedeniyle geçmişine dair hiçbir şey bilmiyor; yalnızca adının Eşref olduğunu hatırlıyor.',
    locationId: null,
    mazgalId: 'G4',
    x: 40.6,
    y: 38.9,
    health: 92,
    stamina: 82,
    hunger: 25,
    rations: 3,
    silver: 6,
    mood: 'Temkinli',
    reputation: {
      border_human: 0,
      elf: 0,
      beastkin: 0,
      outlaws: 0,
      goblinoids: -15,
    },
    activeConditions: ['Hafıza Kaybı', 'Orman Sisi'],
    marks: ['185 cm · Esmer · Atletik', 'Doğuştan Karizma'],
    lastObservation:
      'Soğuk çam iğneleri ve nemli orman yosunlarının üzerinde gözlerini açtın. Geçmişine dair zihnin bembeyaz bir sis perdesinin ardında; hatırladığın tek şey adının Eşref olduğu. 18 yaşındasın, 185 cm boyundaki esmer ve atletik bedenin serin orman havasında diri.',
    lastDialogue: '',
    visitedMazgalIds: ['G4'],
    journal: [
      {
        id: 'pj-init',
        timestamp: ts,
        kind: 'Durum',
        locationLabel: 'Sisli Çam ve Meşe Ormanı',
        title: 'Sisler İçinde Uyanış',
        detail:
          'Hafıza kaybı içinde, yalnızca adının Eşref olduğunu hatırlayarak soğuk çam ve meşe ormanında uyandın.',
      },
    ],
    lastUpdatedMs: INITIAL_GAME_TIME_MS,
    partyMode: 'solo',
    contacts: initialContacts,
    npcMoments: buildInitialNpcMoments(initialContacts, locations),
    playerMorality: 10,
    bountySilver: 0,
    bountyFactions: [],
    injuries: [],
    inventory: createInitialInventory(),
    contracts: [],
    activeWorldWave: null,
    capturedCaptives: 0,
    roamingUnits: createInitialRoamingUnits(locations),
    travelPace: 'normal',
    travelTransport: 'foot',
    lastWeatherUpdateMs: INITIAL_GAME_TIME_MS,
    lastSleptMs: INITIAL_GAME_TIME_MS,
  };
}

export function hydrateProtagonist(
  protagonist: ProtagonistState,
  locations: MapLocation[]
): ProtagonistState {
  const baseFields = {
    appearanceNote:
      protagonist.appearanceNote ??
      (protagonist.name === 'Eşref'
        ? '18 yaşında, 185 cm boyunda, esmer tenli, atletik yapılı ve karizmatik bir genç. Yalnızca adının Eşref olduğunu hatırlıyor.'
        : undefined),
    playerMorality: protagonist.playerMorality ?? 10,
    bountySilver: protagonist.bountySilver ?? 0,
    bountyFactions: protagonist.bountyFactions ?? [],
    injuries: protagonist.injuries ?? [],
    inventory:
      protagonist.inventory && protagonist.inventory.length > 0
        ? protagonist.inventory
        : createInitialInventory(),
    contracts: protagonist.contracts ?? [],
    activeWorldWave: protagonist.activeWorldWave ?? null,
    capturedCaptives: protagonist.capturedCaptives ?? 0,
    roamingUnits:
      Array.isArray(protagonist.roamingUnits) && protagonist.roamingUnits.length > 0
        ? protagonist.roamingUnits
        : createInitialRoamingUnits(locations),
    travelPace: protagonist.travelPace ?? 'normal',
    travelTransport: protagonist.travelTransport ?? 'foot',
    lastWeatherUpdateMs: protagonist.lastWeatherUpdateMs ?? INITIAL_GAME_TIME_MS,
    lastSleptMs: protagonist.lastSleptMs ?? protagonist.lastUpdatedMs ?? INITIAL_GAME_TIME_MS,
    visitedMazgalIds: Array.from(
      new Set([
        ...(Array.isArray(protagonist.visitedMazgalIds) ? protagonist.visitedMazgalIds : []),
        protagonist.mazgalId || 'G4',
      ])
    ),
  };

  if (protagonist.contacts && protagonist.contacts.length > 0) {
    const seeded = createInitialContacts(locations);
    const hydratedContacts = protagonist.contacts.map((c) => {
      const seedMatch = seeded.find((s) => s.id === c.id);
      const morality =
        typeof c.morality === 'number'
          ? c.morality
          : seedMatch?.morality ?? getDefaultMoralityForContact(c.temperament, c.faction);
      // Migrate legacy -100..100 trust saves (identified by missing c.mood) to 0..100 scale
      const normalizedTrust =
        typeof c.mood === 'string'
          ? Math.max(0, Math.min(100, Math.round(c.trust)))
          : Math.max(0, Math.min(100, Math.round(50 + c.trust)));
      const locMood = c.currentLocationId
        ? locations.find((l) => l.id === c.currentLocationId)?.livingState?.mood
        : undefined;
      const mood =
        c.mood ??
        computeNpcMood(
          { ...c, morality, trust: normalizedTrust },
          { locationMood: locMood }
        );
      return {
        ...c,
        morality,
        trust: normalizedTrust,
        mood,
      };
    });
    const existingMoments =
      Array.isArray(protagonist.npcMoments) && protagonist.npcMoments.length > 0
        ? protagonist.npcMoments
        : hydratedContacts.flatMap((c, cIdx) => {
            const locName = c.currentLocationId
              ? locations.find((l) => l.id === c.currentLocationId)?.name ??
                `Mazgal ${c.currentMazgalId}`
              : `Mazgal ${c.currentMazgalId}`;
            const notes = c.memoryNotes && c.memoryNotes.length > 0 ? c.memoryNotes : [c.lastReaction];
            return notes.map((note, nIdx) =>
              createNpcMomentRecord({
                npcId: c.id,
                npcName: c.name,
                npcRole: c.role,
                timestamp: nIdx === notes.length - 1 ? c.metAt : formatGameDateTime(c.lastUpdatedMs),
                timestampMs: c.lastUpdatedMs - nIdx * 10 - cIdx,
                locationLabel: locName,
                category: nIdx === notes.length - 1 ? 'Tanışma' : 'Sohbet',
                title:
                  nIdx === notes.length - 1
                    ? `${c.name} ile İlk İz / Tanışma`
                    : `${c.name} ile Geçmiş Etkileşim`,
                summary: note,
                moodAfter: c.mood,
                significance: nIdx === 0 && notes.length > 1 ? 'önemli' : 'olağan',
              })
            );
          }).sort((a, b) => b.timestampMs - a.timestampMs);

    return {
      ...protagonist,
      ...baseFields,
      partyMode: protagonist.partyMode ?? 'solo',
      contacts: hydratedContacts,
      npcMoments: existingMoments,
    };
  }
  const freshContacts = createInitialContacts(locations);
  return {
    ...protagonist,
    ...baseFields,
    partyMode: protagonist.partyMode ?? 'solo',
    contacts: freshContacts,
    npcMoments:
      Array.isArray(protagonist.npcMoments) && protagonist.npcMoments.length > 0
        ? protagonist.npcMoments
        : buildInitialNpcMoments(freshContacts, locations),
  };
}

export function buildContextualObservation(
  protagonist: ProtagonistState,
  location: MapLocation | undefined,
  cell: MazgalCell,
  gameTimeMs: number
): string {
  const phase = getDayPhaseLabel(gameTimeMs);

  if (!location) {
    const terrainNote =
      cell.safetyScore <= 38
        ? 'Çalılar ve sis gölgeleri pusu ihtimalini artırıyor; elin kabzanın üzerinde yürümen gerekiyor.'
        : cell.safetyScore >= 68
        ? 'Patika ve toprak zemin şimdilik görece sakin görünüyor.'
        : 'Arazi sessiz ama iz bırakmadan ilerlemek için dikkatli olmalısın.';
    const staminaNote =
      protagonist.stamina <= 35
        ? ' Adımların ağırlaştı; kısa bir mola vermezsen dikkatin dağılacak.'
        : '';
    return `${phase} vaktinde ${cell.terrainLabel.toLowerCase()} içinde çevreni süzüyorsun. Görüş yaklaşık ${cell.visibilityMeters} metre. ${terrainNote}${staminaNote}`;
  }

  const ls = location.livingState;
  const moodDesc =
    ls?.mood === 'Endişeli' || ls?.mood === 'Korkulu'
      ? 'Halkın bakışlarında tedirginlik var; kapılar aralık, nöbetler sıkı tutuluyor.'
      : ls?.mood === 'Mutlu'
      ? 'Bölgede canlı ve güvenli bir hareketlilik hissediliyor.'
      : 'Yerleşim olağan gündelik düzeninde ilerliyor.';

  const problemLine =
    ls && ls.activeProblems.length > 0
      ? ` Gözüne çarpan acil mesele: ${ls.activeProblems[0].title}.`
      : '';

  const woundLine =
    protagonist.health <= 50
      ? ' Yaralı halin çevredeki gözcülerin dikkatinden kaçmıyor.'
      : '';

  return `${phase} vaktinde ${location.name} sınırları içindesin. ${moodDesc}${problemLine}${woundLine}`;
}

export function buildContextualDialogue(
  protagonist: ProtagonistState,
  location: MapLocation | undefined,
  cell: MazgalCell
): { speaker: string; line: string; repDelta: number; rumorGained?: string } {
  if (!location) {
    return {
      speaker: 'Kendi Kendine Not',
      line: `${cell.terrainLabel} boyunca sesine karşılık verecek kimse yok. Çevrede seçilen izler: ${cell.resourceYield}.`,
      repDelta: 0,
    };
  }

  const faction = getFactionForLocation(location);
  const rep = protagonist.reputation[faction] ?? 0;
  const ls = location.livingState;
  const npcBase = location.npcsOrFoes[0]?.split('(')[0].trim() || 'Yerel Gözcü';
  const activeProblem = ls?.activeProblems[0];
  const rumor = ls?.rumors[0];

  if (faction === 'goblinoids') {
    if (rep <= -15) {
      return {
        speaker: npcBase,
        line: `"İnsan kokusu! Yaklaşma yoksa sapan taşını yersin!" (İtibarın ${rep}; silah çekmeden pazarlık yapman zor.)`,
        repDelta: 0,
      };
    }
    return {
      speaker: npcBase,
      line: `"Parlak demir veya tuz getirdiysen konuşuruz, yoksa tünellere girme!"`,
      repDelta: +1,
      rumorGained: rumor,
    };
  }

  if (faction === 'outlaws') {
    if (rep <= -15) {
      return {
        speaker: npcBase,
        line: `"Senin adını sınır devriyelerinden duyduk. Keseyi bırakıp yürümezsen buradan çıkamazsın."`,
        repDelta: 0,
      };
    }
    return {
      speaker: npcBase,
      line: `"Burada isim değil gümüş konuşur. ${rumor ?? 'Kuzey yolunda tek başına gezenlere pek acımayız.'}"`,
      repDelta: +1,
      rumorGained: rumor,
    };
  }

  if (rep >= 20) {
    return {
      speaker: npcBase,
      line: activeProblem
        ? `"Hoş geldin dostum, tam da sana ihtiyacımız vardı! ${activeProblem.title} yüzünden başımız dertte; bize yardım edersen karşılığını veririz."`
        : `"Seni yeniden görmek güzel, ${protagonist.name}. Ocak sıcak, su temiz; duyduğuma göre ${rumor ?? 'yollar bu hafta biraz daha sakinmiş.'}"`,
      repDelta: +2,
      rumorGained: rumor,
    };
  }

  if (rep <= -10) {
    return {
      speaker: npcBase,
      line: `"Hakkında iyi şeyler duymadık. İşini çabuk gör ve hava kararmadan sınırımızdan ayrıl."`,
      repDelta: +1,
    };
  }

  if (ls?.mood === 'Endişeli' || ls?.mood === 'Korkulu') {
    return {
      speaker: npcBase,
      line: activeProblem
        ? `"Yabancı, ortalık gergin. ${activeProblem.title} çözülmeden kimseye rahat yok. Bir bilgin var mı?"`
        : `"Bu günlerde sis içinden garip sesler geliyor. ${rumor ?? 'Ateşimizi gece alçak tutuyoruz.'}"`,
      repDelta: +1,
      rumorGained: rumor,
    };
  }

  return {
    speaker: npcBase,
    line: `"Selam yolcu. ${rumor ?? 'Doğuya doğru gideceksen sis çökmeden geçitleri aşmaya bak.'}"`,
    repDelta: +1,
    rumorGained: rumor,
  };
}

export function resolveAutomaticTravelPace(
  protagonist: ProtagonistState,
  targetCell: MazgalCell,
  weather: WeatherConditionKey,
  requestedPace?: TravelPace
): TravelPace {
  if (requestedPace === 'stealth') {
    return 'stealth';
  }
  if (requestedPace === 'forced') {
    if (protagonist.stamina >= 30 && protagonist.health >= 35 && weather !== 'storm') {
      return 'forced';
    }
    return protagonist.health <= 45 || weather === 'storm' ? 'stealth' : 'normal';
  }

  const isInjuredOrExhausted =
    protagonist.health <= 45 ||
    protagonist.stamina <= 25 ||
    (protagonist.activeConditions ?? []).some((c) => /Yaralı|Bitkin|Kanama/i.test(c));
  if (weather === 'storm' || targetCell.safetyScore <= 22 || isInjuredOrExhausted) {
    return 'stealth';
  }

  if (
    protagonist.activeWorldWave &&
    (protagonist.activeWorldWave.kind === 'Eşkıya İttifakı' ||
      protagonist.activeWorldWave.kind === 'Goblin Akını') &&
    protagonist.stamina >= 60 &&
    protagonist.health >= 65 &&
    weather === 'clear'
  ) {
    return 'forced';
  }

  return 'normal';
}

export function resolveAutomaticTravelTransport(
  protagonist: ProtagonistState,
  targetCell: MazgalCell,
  requiresBoat: boolean,
  hasDirectRoute: boolean
): TravelTransport {
  const hasBoatItem = (protagonist.inventory ?? []).some(
    (item) => item.qty > 0 && /kayık|tekne|sal/i.test(item.name)
  );
  const hasBoatCompanion = (protagonist.contacts ?? []).some(
    (c) =>
      c.partyRelation !== 'independent' &&
      /salcı|kayık|denizci|tekne/i.test(`${c.name} ${c.role} ${c.trait}`)
  );
  if (hasBoatItem || hasBoatCompanion) {
    return 'boat';
  }
  if (requiresBoat && hasDirectRoute) {
    return 'boat';
  }

  const hasMountItem = (protagonist.inventory ?? []).some(
    (item) => item.qty > 0 && /katır|at |araba|binek|yük/i.test(item.name)
  );
  const hasMountedCompanion = (protagonist.contacts ?? []).some(
    (c) =>
      c.partyRelation !== 'independent' &&
      /kervan|tüccar|arabacı|atlı|katır/i.test(`${c.name} ${c.role} ${c.trait}`)
  );
  if (
    hasMountItem ||
    hasMountedCompanion ||
    (hasDirectRoute && protagonist.activeWorldWave?.kind === 'Ticaret Şenliği')
  ) {
    return 'mule';
  }

  return 'foot';
}

export function applyProtagonistTravel(
  protagonist: ProtagonistState,
  targetLocation: MapLocation | undefined,
  targetCell: MazgalCell,
  travelHours: number,
  nextTimeMs: number,
  options?: {
    pace?: TravelPace;
    transport?: TravelTransport;
    weather?: WeatherConditionKey;
    requiresBoat?: boolean;
    extraVisitedMazgalIds?: string[];
  }
): { nextProtagonist: ProtagonistState; localMoraleDelta: number } {
  const ts = formatGameDateTime(nextTimeMs);
  const weather = options?.weather ?? 'mist';
  const requiresBoat = options?.requiresBoat ?? (targetCell.terrain === 'lake' || targetCell.terrain === 'sea');
  const pace =
    options?.pace ??
    resolveAutomaticTravelPace(protagonist, targetCell, weather);
  const transport =
    options?.transport ??
    resolveAutomaticTravelTransport(protagonist, targetCell, requiresBoat, false);

  const paceStaminaMult = pace === 'forced' ? 1.32 : pace === 'stealth' ? 0.92 : 1.0;
  const transportStaminaMult = transport === 'mule' ? 0.8 : 1.0;
  const weatherStaminaAdd = weather === 'storm' ? 6 : weather === 'rain' ? 3 : 0;

  // No automatic overnight camp: traveling drains stamina & keeps Eşref awake until he rests or collapses!
  const staminaCost = Math.min(
    65,
    Math.max(4, Math.round(travelHours * 1.18 * paceStaminaMult * transportStaminaMult) + weatherStaminaAdd)
  );
  const hungerGain = Math.min(55, Math.max(3, Math.round(travelHours * (pace === 'forced' ? 1.25 : 1.0))));

  let nextHealth = protagonist.health;
  let nextStamina = Math.max(5, protagonist.stamina - staminaCost);
  let nextHunger = Math.min(100, protagonist.hunger + hungerGain);
  let rations = protagonist.rations;

  // Eat 1 ration on the move if carrying rations and hungry
  let rationNote = '';
  if (travelHours >= 12 && nextHunger >= 55 && rations > 0) {
    rations -= 1;
    nextHunger = Math.max(10, nextHunger - 38);
    rationNote = ' Yürürken 1 porsiyon kuru erzak atıştırdın.';
  }

  const hoursAwake = getHoursWithoutSleep(protagonist, nextTimeMs);
  let fatigueWarningNote = '';
  if (hoursAwake >= 42) {
    fatigueWarningNote =
      ' Yaklaşık 2 gündür gözünü kırpmadın; aşırı yorgunluktan başın dönüyor, artık durup uyumazsan yığılıp kalacaksın!';
  } else if (hoursAwake >= 22) {
    fatigueWarningNote =
      ' Uzun süredir uyumadığın için göz kapakların ağırlaştı; artık bir yerde durup uyuman gerekiyor.';
  }

  // Pace, water-crossing & harsh terrain checks
  let travelHazardNote = '';
  if (requiresBoat && transport !== 'boat') {
    nextStamina = Math.max(5, nextStamina - 14);
    nextHealth = Math.max(10, nextHealth - 5);
    travelHazardNote += ' Kayık olmadan sığ geçidi/suyu zorlayarak aştın (-5 Can, -14 Zindelik).';
  }

  if (pace === 'forced' && travelHours >= 10) {
    const endCheck = rollDie(20) + (protagonist.stamina >= 60 ? 2 : 0);
    if (endCheck < 12) {
      nextStamina = Math.max(5, nextStamina - 8);
      travelHazardNote += ` Zorlu yürüyüş dayanıklılık testinde (Zar ${endCheck}) ek yorgunluk bindi (-8 Zindelik).`;
    }
  }

  const hazardProb =
    (pace === 'stealth' ? 0.1 : pace === 'forced' ? 0.34 : 0.22) +
    (weather === 'storm' ? 0.12 : 0);

  if (travelHours >= 10 && targetCell.safetyScore <= 42 && Math.random() < hazardProb) {
    const dmg = rollDie(6) + (weather === 'storm' ? 4 : 2);
    nextHealth = Math.max(12, nextHealth - dmg);
    travelHazardNote += ` Zorlu arazide küçük bir sıyrık/soğuk darbesi aldın (-${dmg} Can).`;
  } else if (targetLocation && targetCell.safetyScore >= 70) {
    nextStamina = Math.min(100, nextStamina + 4);
  }

  const nextMood = computeProtagonistMood(
    nextHealth,
    nextStamina,
    nextHunger,
    targetCell.safetyScore
  );
  const conditions = updateConditions(nextHealth, nextStamina, nextHunger, targetCell, hoursAwake);
  if ((protagonist.activeConditions ?? []).includes('Hafıza Kaybı') && !conditions.includes('Hafıza Kaybı')) {
    conditions.unshift('Hafıza Kaybı');
  }
  if (
    travelHours < 4 &&
    (protagonist.activeConditions ?? []).includes('Meşale Işığı') &&
    !conditions.includes('Meşale Işığı')
  ) {
    conditions.push('Meşale Işığı');
  }

  const nextVisitedMazgalIds = Array.from(
    new Set([
      ...(protagonist.visitedMazgalIds ?? [protagonist.mazgalId]),
      protagonist.mazgalId,
      ...(options?.extraVisitedMazgalIds ?? []),
      targetCell.id,
    ])
  );

  const draft: ProtagonistState = {
    ...protagonist,
    locationId: targetLocation?.id ?? null,
    mazgalId: targetCell.id,
    x: targetLocation ? targetLocation.x : targetCell.centerX,
    y: targetLocation ? targetLocation.y : targetCell.centerY,
    health: nextHealth,
    stamina: nextStamina,
    hunger: nextHunger,
    rations,
    mood: nextMood,
    activeConditions: conditions.slice(0, 4),
    travelPace: pace,
    travelTransport: transport,
    lastUpdatedMs: nextTimeMs,
    visitedMazgalIds: nextVisitedMazgalIds,
  };

  const observation = buildContextualObservation(draft, targetLocation, targetCell, nextTimeMs);
  const placeName = targetLocation ? targetLocation.name : `Mazgal ${targetCell.id} (${targetCell.terrainLabel})`;
  const paceBadge =
    pace === 'stealth'
      ? ' [Gizli Tempo]'
      : pace === 'forced'
      ? ' [Zorlu Yürüyüş]'
      : '';
  const transportBadge =
    transport === 'mule' ? ' · Katırlı' : transport === 'boat' ? ' · Kayıklı' : '';

  // Protagonist -> Environment morale pulse on arrival
  let localMoraleDelta = 0;
  if (targetLocation?.livingState?.enabled) {
    const faction = getFactionForLocation(targetLocation);
    const rep = protagonist.reputation[faction] ?? 0;
    if (rep >= 15) localMoraleDelta = 2;
    else if (rep <= -15) localMoraleDelta = -3;
    else if (targetLocation.livingState.mood === 'Endişeli' || targetLocation.livingState.mood === 'Korkulu') {
      localMoraleDelta = 1;
    }
  }

  return {
    nextProtagonist: {
      ...draft,
      lastObservation: `${observation}${fatigueWarningNote}${rationNote}${travelHazardNote}`,
      journal: pushJournal(protagonist.journal, {
        id: `pj-move-${Date.now()}`,
        timestamp: ts,
        kind: 'Yolculuk',
        locationLabel: placeName,
        title: `${placeName} Bölgesine Ulaştın${paceBadge}${transportBadge}`,
        detail: `${observation}${fatigueWarningNote}${rationNote}${travelHazardNote}`,
      }),
    },
    localMoraleDelta,
  };
}

export function evaluateSleepDeprivationAndCollapse(params: {
  protagonist: ProtagonistState;
  currentCell: MazgalCell;
  mazgalCells: MazgalCell[];
  locations: MapLocation[];
  gameTimeMs: number;
  duringTravel?: boolean;
}): {
  collapsed: boolean;
  hoursAwake: number;
  sleepHours: number;
  nextTimeMs: number;
  nextProtagonist: ProtagonistState;
  landedCell: MazgalCell;
  landedLocation?: MapLocation;
  movedCell: boolean;
  collapseFact?: string;
} {
  const { protagonist, currentCell, mazgalCells, locations, gameTimeMs, duringTravel } = params;
  const hoursAwake = getHoursWithoutSleep(protagonist, gameTimeMs);

  // Trigger involuntary collapse between 48 and 72 hours (2-3 days) without sleep
  const shouldCollapse =
    hoursAwake >= 48 &&
    (hoursAwake >= 68 ||
      (protagonist.stamina <= 12 && hoursAwake >= 48) ||
      (duringTravel && hoursAwake >= 52 && Math.random() < 0.7) ||
      Math.random() < (hoursAwake - 46) * 0.045);

  if (!shouldCollapse) {
    return {
      collapsed: false,
      hoursAwake,
      sleepHours: 0,
      nextTimeMs: gameTimeMs,
      nextProtagonist: protagonist,
      landedCell: currentCell,
      landedLocation: protagonist.locationId
        ? locations.find((l) => l.id === protagonist.locationId)
        : undefined,
      movedCell: false,
    };
  }

  const sleepHours = 6 + rollDie(5); // 7-11 hours unconscious sleep
  const nextTimeMs = addGameHours(gameTimeMs, sleepHours);
  const ts = formatGameDateTime(nextTimeMs);

  // Determine a random dry-land spot where Eşref collapsed in a daze
  const dryNeighbors = currentCell.neighbors
    .map((nb) => mazgalCells.find((c) => c.id === nb.id))
    .filter(
      (c): c is MazgalCell =>
        Boolean(c && c.terrain !== 'lake' && c.terrain !== 'sea')
    );

  const wanderOffCourse =
    dryNeighbors.length > 0 && (duringTravel ? Math.random() < 0.65 : Math.random() < 0.4);
  const landedCell = wanderOffCourse
    ? dryNeighbors[Math.floor(Math.random() * dryNeighbors.length)]
    : currentCell;
  const movedCell = landedCell.id !== currentCell.id;

  // Random coordinates inside the landed cell (so he wakes up in an unfamiliar/random spot)
  const randX = Number(
    Math.max(2, Math.min(98, landedCell.centerX + (Math.random() - 0.5) * 4.2)).toFixed(1)
  );
  const randY = Number(
    Math.max(2, Math.min(98, landedCell.centerY + (Math.random() - 0.5) * 6.5)).toFixed(1)
  );
  const landedLocation = landedCell.locationsInside[0];

  let nextHealth = protagonist.health;
  const nextStamina = Math.min(72, protagonist.stamina + 38 + rollDie(12));
  const nextHunger = Math.min(100, protagonist.hunger + 10);
  let nextSilver = protagonist.silver;
  let nextRations = protagonist.rations;
  let exposureNote = '';

  if (landedCell.safetyScore <= 42 && Math.random() < 0.45) {
    if (nextSilver >= 2 && Math.random() < 0.45) {
      const lost = Math.min(nextSilver, 1 + rollDie(2));
      nextSilver -= lost;
      exposureNote = ` Açıkta savunmasız uyurken kesenden ${lost} Gümüş eksilmiş.`;
    } else if (nextRations >= 1 && Math.random() < 0.4) {
      nextRations -= 1;
      exposureNote = ' Açıkta uyurken çantandaki erzaklardan 1 porsiyonu hayvanlara veya soğuğa kaptırmışsın.';
    } else {
      const coldDmg = 4 + rollDie(5);
      nextHealth = Math.max(10, nextHealth - coldDmg);
      exposureNote = ` Korumasız toprakta uyuyakaldığın için soğuk ve sert zemin canını yaktı (-${coldDmg} Can).`;
    }
  }

  const conditions = updateConditions(nextHealth, nextStamina, nextHunger, landedCell, 0);
  if (
    (protagonist.activeConditions ?? []).includes('Hafıza Kaybı') &&
    !conditions.includes('Hafıza Kaybı')
  ) {
    conditions.unshift('Hafıza Kaybı');
  }

  const nextVisited = Array.from(
    new Set([
      ...(protagonist.visitedMazgalIds ?? [protagonist.mazgalId]),
      landedCell.id,
    ])
  );

  const wakePlaceDesc = landedLocation
    ? `${landedLocation.name} yakınlarında kuytu bir köşede`
    : `${landedCell.terrainLabel.toLowerCase()} içinde rastgele bir açıklıkta`;

  const collapseFact = `AŞIRI UYKUSUZLUK VE BAYGINLIK (${Math.round(
    hoursAwake
  )} saat uykusuz kaldıktan sonra): Gözlerin karardı, bilincin kapandı ve nerede olduğunu bile anlamadan ${wakePlaceDesc} yığılıp uyuyakaldın. Yaklaşık ${sleepHours} saat sonra sızlayan kemiklerinle gözlerini açtın (Can: ${nextHealth}/100, Zindelik: ${nextStamina}/100).${exposureNote}`;

  const nextProtagonist: ProtagonistState = {
    ...protagonist,
    locationId: landedLocation?.id ?? null,
    mazgalId: landedCell.id,
    x: landedLocation ? landedLocation.x : randX,
    y: landedLocation ? landedLocation.y : randY,
    health: nextHealth,
    stamina: nextStamina,
    hunger: nextHunger,
    silver: nextSilver,
    rations: nextRations,
    activeConditions: conditions.slice(0, 4),
    mood: computeProtagonistMood(nextHealth, nextStamina, nextHunger, landedCell.safetyScore),
    lastSleptMs: nextTimeMs,
    lastUpdatedMs: nextTimeMs,
    lastObservation: collapseFact,
    visitedMazgalIds: nextVisited,
    journal: pushJournal(protagonist.journal, {
      id: `pj-collapse-${Date.now()}`,
      timestamp: ts,
      kind: 'Durum',
      locationLabel: landedLocation ? landedLocation.name : landedCell.terrainLabel,
      title: 'Uykusuzluktan Yığılıp Kaldın',
      detail: collapseFact,
    }),
  };

  return {
    collapsed: true,
    hoursAwake,
    sleepHours,
    nextTimeMs,
    nextProtagonist,
    landedCell,
    landedLocation,
    movedCell,
    collapseFact,
  };
}

export function performProtagonistAction(
  protagonist: ProtagonistState,
  actionType: ProtagonistActionType,
  currentLocation: MapLocation | undefined,
  currentCell: MazgalCell,
  nextTimeMs: number,
  elapsedMinutes?: number
): {
  nextProtagonist: ProtagonistState;
  locationMoraleDelta: number;
  locationEventNote?: string;
} {
  const ts = formatGameDateTime(nextTimeMs);
  const placeLabel = currentLocation
    ? currentLocation.name
    : `Mazgal ${currentCell.id} (${currentCell.terrainLabel})`;
  const faction = getFactionForLocation(currentLocation);

  let health = protagonist.health;
  let stamina = protagonist.stamina;
  let hunger = protagonist.hunger;
  let rations = protagonist.rations;
  let silver = protagonist.silver;
  let playerMorality = protagonist.playerMorality ?? 10;
  const reputation = { ...protagonist.reputation };
  let lastObservation = protagonist.lastObservation;
  let lastDialogue = protagonist.lastDialogue;
  let locationMoraleDelta = 0;
  let locationEventNote: string | undefined;
  let title = '';
  let detail = '';
  let kind: ProtagonistEventRecord['kind'] = 'Eylem';
  let lastSleptMs = protagonist.lastSleptMs ?? INITIAL_GAME_TIME_MS;

  if (actionType === 'observe') {
    const mins = typeof elapsedMinutes === 'number' ? Math.max(0, elapsedMinutes) : 60;
    const staminaLoss = mins <= 5 ? 0 : Math.max(1, Math.round((4 * Math.min(60, mins)) / 60));
    const hungerGain = mins <= 10 ? 0 : Math.max(1, Math.round((4 * Math.min(60, mins)) / 60));
    kind = 'Gözlem';
    stamina = Math.max(5, stamina - staminaLoss);
    hunger = Math.min(100, hunger + hungerGain);
    lastObservation = buildContextualObservation(protagonist, currentLocation, currentCell, nextTimeMs);
    title = `${placeLabel} Gözlemi`;
    detail = lastObservation;
  } else if (actionType === 'converse') {
    const mins = typeof elapsedMinutes === 'number' ? Math.max(0, elapsedMinutes) : 60;
    const staminaLoss = mins <= 5 ? 0 : Math.max(1, Math.round((3 * Math.min(60, mins)) / 60));
    const hungerGain = mins <= 10 ? 0 : Math.max(1, Math.round((4 * Math.min(60, mins)) / 60));
    kind = 'Konuşma';
    stamina = Math.max(5, stamina - staminaLoss);
    hunger = Math.min(100, hunger + hungerGain);
    const dlg = buildContextualDialogue(protagonist, currentLocation, currentCell);
    lastDialogue = `${dlg.speaker}: ${dlg.line}`;
    if (dlg.repDelta !== 0 && currentLocation) {
      reputation[faction] = Math.max(-100, Math.min(100, (reputation[faction] ?? 0) + dlg.repDelta));
    }
    title = `${dlg.speaker} ile Görüşme`;
    detail = dlg.line;
    if (currentLocation && dlg.repDelta > 0) {
      locationEventNote = `${protagonist.name} yerel halkla görüşüp son haberleri paylaştı.`;
    }
  } else if (actionType === 'forage_or_work') {
    stamina = Math.max(5, stamina - 16);
    hunger = Math.min(100, hunger + 12);
    if (currentLocation && currentLocation.category === 'village') {
      const earned = 3 + rollDie(6);
      silver += earned;
      reputation[faction] = Math.min(100, (reputation[faction] ?? 0) + 3);
      locationMoraleDelta = 2;
      title = `${currentLocation.name} İçinde Gündelik İş`;
      detail = `Yerleşimde eşlik/bakım işine yardım ederek ${earned} Gümüş kazandın ve güven tazeledin (+3 İtibar).`;
      locationEventNote = `${protagonist.name} yerleşimdeki gündelik işlere destek verip ücret aldı.`;
    } else {
      const foundRations = rollDie(3);
      rations += foundRations;
      title = `${placeLabel} Alanında Av ve Toplama`;
      detail = `${currentCell.resourceYield} kaynaklarından ${foundRations} porsiyonluk yenilebilir erzak topladın.`;
      if (currentCell.safetyScore <= 38 && Math.random() < 0.3) {
        const dmg = rollDie(4) + 2;
        health = Math.max(15, health - dmg);
        detail += ` Ancak dik kayalar/çalılıklar arasında küçük bir yara aldın (-${dmg} Can).`;
      }
    }
    lastObservation = detail;
  } else if (actionType === 'help_settlement') {
    stamina = Math.max(5, stamina - 20);
    hunger = Math.min(100, hunger + 15);
    if (currentLocation) {
      reputation[faction] = Math.min(100, (reputation[faction] ?? 0) + 6);
      playerMorality = Math.min(100, playerMorality + 2);
      locationMoraleDelta = 5;
      title = `${currentLocation.name} Çevresinde Devriye ve Destek`;
      detail = `Çevrede 4 saatlik devriye ve onarım desteği verdin. Bölge morali (+5) ve yerel itibarın (+6) yükseldi.`;
      locationEventNote = `${protagonist.name} bölge çevresini devriye gezerek güvenliği artırdı.`;
    } else {
      title = `${currentCell.terrainLabel} Keşif ve İşaretleme`;
      detail = `Bölgedeki güvenli geçiş noktalarını ve izleri belleğine kazıdın.`;
    }
    lastObservation = detail;
  } else if (actionType === 'rest_camp') {
    lastSleptMs = nextTimeMs;
    if (rations > 0) {
      rations -= 1;
      hunger = Math.max(0, hunger - 45);
      stamina = Math.min(100, stamina + 50);
      health = Math.min(100, health + 22);
      title = `${placeLabel} Dinlenme ve Kamp`;
      detail = `1 porsiyon erzak yiyip 8 saat uyuyup dinlendin. Can (+22) ve Zindelik (+50) toparlandı.`;
    } else {
      hunger = Math.min(100, hunger + 15);
      stamina = Math.min(85, stamina + 28);
      health = Math.min(100, health + 8);
      title = `${placeLabel} Erzağı Eksik Kamp`;
      detail = `Erzağın kalmadığı için aç karnına uyuyup dinlendin; Zindelik kısmen (+28) toplandı ancak açlık arttı.`;
    }
    lastObservation = detail;
  }

  const hoursAwake = getHoursWithoutSleep({ ...protagonist, lastSleptMs }, nextTimeMs);
  const mood = computeProtagonistMood(health, stamina, hunger, currentCell.safetyScore);
  const activeConditions = updateConditions(health, stamina, hunger, currentCell, hoursAwake);
  if (
    (protagonist.activeConditions ?? []).includes('Hafıza Kaybı') &&
    !activeConditions.includes('Hafıza Kaybı')
  ) {
    activeConditions.unshift('Hafıza Kaybı');
  }

  return {
    nextProtagonist: {
      ...protagonist,
      health,
      stamina,
      hunger,
      rations,
      silver,
      playerMorality,
      mood,
      reputation,
      activeConditions: activeConditions.slice(0, 4),
      lastObservation,
      lastDialogue,
      lastSleptMs,
      lastUpdatedMs: nextTimeMs,
      journal: pushJournal(protagonist.journal, {
        id: `pj-act-${Date.now()}`,
        timestamp: ts,
        kind,
        locationLabel: placeLabel,
        title,
        detail,
      }),
    },
    locationMoraleDelta,
    locationEventNote,
  };
}

export function applyEncounterResultToProtagonist(
  protagonist: ProtagonistState,
  result: 'victory' | 'costly' | 'flee',
  encounterTitle: string,
  location: MapLocation | undefined,
  cell: MazgalCell,
  nextTimeMs: number
): { nextProtagonist: ProtagonistState; moraleDelta: number } {
  const ts = formatGameDateTime(nextTimeMs);
  const faction = getFactionForLocation(location);
  const reputation = { ...protagonist.reputation };
  let health = protagonist.health;
  let stamina = protagonist.stamina;
  let silver = protagonist.silver;
  let rations = protagonist.rations;
  let marks = protagonist.marks;
  let moraleDelta = 0;
  let detail = '';

  if (result === 'victory') {
    stamina = Math.max(10, stamina - 12);
    const silverGain = rollDie(6) + 2;
    silver += silverGain;
    reputation[faction] = Math.min(100, (reputation[faction] ?? 0) + 5);
    moraleDelta = 4;
    detail = `"${encounterTitle}" karşılaşmasını ustalıkla çözdün (+${silverGain} Gümüş, +5 ${FACTION_LABELS[faction]} İtibarı).`;
    if (marks.length < MAX_MARKS && Math.random() < 0.35) {
      const newMark = `${encounterTitle} Çözeni`;
      if (!marks.includes(newMark)) marks = [...marks, newMark].slice(0, MAX_MARKS);
    }
  } else if (result === 'costly') {
    const dmg = rollDie(12) + 8;
    health = Math.max(10, health - dmg);
    stamina = Math.max(5, stamina - 22);
    reputation[faction] = Math.min(100, (reputation[faction] ?? 0) + 2);
    moraleDelta = 1;
    detail = `"${encounterTitle}" sırasında zorlandın ve yara aldın (-${dmg} Can, -22 Zindelik), ancak tehlikeyi savuşturdun.`;
  } else {
    stamina = Math.max(5, stamina - 18);
    if (rations > 0 && Math.random() < 0.4) rations -= 1;
    reputation[faction] = Math.max(-100, (reputation[faction] ?? 0) - 2);
    detail = `"${encounterTitle}" karşısında geri çekilerek canını kurtardın (-18 Zindelik).`;
  }

  const hoursAwake = getHoursWithoutSleep(protagonist, nextTimeMs);
  const mood = computeProtagonistMood(health, stamina, protagonist.hunger, cell.safetyScore);
  const activeConditions = updateConditions(health, stamina, protagonist.hunger, cell, hoursAwake);
  if (
    (protagonist.activeConditions ?? []).includes('Hafıza Kaybı') &&
    !activeConditions.includes('Hafıza Kaybı')
  ) {
    activeConditions.unshift('Hafıza Kaybı');
  }

  return {
    nextProtagonist: {
      ...protagonist,
      health,
      stamina,
      rations,
      silver,
      mood,
      reputation,
      marks,
      activeConditions: activeConditions.slice(0, 4),
      lastObservation: detail,
      lastUpdatedMs: nextTimeMs,
      journal: pushJournal(protagonist.journal, {
        id: `pj-enc-${Date.now()}`,
        timestamp: ts,
        kind: 'Karşılaşma',
        locationLabel: location?.name ?? `Mazgal ${cell.id}`,
        title: encounterTitle,
        detail,
      }),
    },
    moraleDelta,
  };
}

export function applyMazgalEventToProtagonist(
  protagonist: ProtagonistState,
  cell: MazgalCell,
  eventTitle: string,
  eventKind: 'Tehlike' | 'İz ve Keşif' | 'Hava ve Arazi' | 'Karşılaşma',
  outcomeNote: string,
  nextTimeMs: number
): { nextProtagonist: ProtagonistState; localMoraleDelta: number } {
  const ts = formatGameDateTime(nextTimeMs);
  const insideLoc = cell.locationsInside[0];
  let health = protagonist.health;
  let stamina = Math.max(5, protagonist.stamina - 6);
  let hunger = Math.min(100, protagonist.hunger + 5);
  let rations = protagonist.rations;
  let silver = protagonist.silver;
  const reputation = { ...protagonist.reputation };
  let localMoraleDelta = 0;
  let detail = '';

  if (eventKind === 'Tehlike') {
    const dmg = rollDie(6) + 2;
    health = Math.max(12, health - dmg);
    stamina = Math.max(5, stamina - 10);
    localMoraleDelta = insideLoc ? -2 : 0;
    detail = `${cell.terrainLabel} içinde "${eventTitle}" tehlikesiyle karşılaştın (-${dmg} Can, -16 Zindelik). ${outcomeNote}`;
  } else if (eventKind === 'İz ve Keşif') {
    const gainedSilver = Math.random() < 0.45 ? rollDie(4) : 0;
    const gainedRation = Math.random() < 0.55 ? 1 : 0;
    silver += gainedSilver;
    rations += gainedRation;
    const lootSummary = [
      gainedSilver > 0 ? `+${gainedSilver} Gümüş` : '',
      gainedRation > 0 ? `+${gainedRation} Erzak` : '',
    ]
      .filter(Boolean)
      .join(', ');
    detail = `${cell.terrainLabel} keşfinde "${eventTitle}" izini inceledin${lootSummary ? ` (${lootSummary})` : ''}. ${outcomeNote}`;
  } else if (eventKind === 'Karşılaşma') {
    if (insideLoc) {
      const faction = getFactionForLocation(insideLoc);
      reputation[faction] = Math.min(100, (reputation[faction] ?? 0) + 2);
      localMoraleDelta = 1;
    } else {
      rations += 1;
    }
    detail = `${cell.terrainLabel} yolunda "${eventTitle}" karşılaşmasını yaşadın. ${outcomeNote}`;
  } else {
    stamina = Math.max(5, stamina - 5);
    detail = `${cell.terrainLabel} arazi ve hava koşulu ("${eventTitle}") seni yavaşlattı. ${outcomeNote}`;
  }

  const hoursAwake = getHoursWithoutSleep(protagonist, nextTimeMs);
  const mood = computeProtagonistMood(health, stamina, hunger, cell.safetyScore);
  const activeConditions = updateConditions(health, stamina, hunger, cell, hoursAwake);
  if (
    (protagonist.activeConditions ?? []).includes('Hafıza Kaybı') &&
    !activeConditions.includes('Hafıza Kaybı')
  ) {
    activeConditions.unshift('Hafıza Kaybı');
  }

  return {
    nextProtagonist: {
      ...protagonist,
      health,
      stamina,
      hunger,
      rations,
      silver,
      mood,
      reputation,
      activeConditions: activeConditions.slice(0, 4),
      lastObservation: detail,
      lastUpdatedMs: nextTimeMs,
      journal: pushJournal(protagonist.journal, {
        id: `pj-mzg-${Date.now()}`,
        timestamp: ts,
        kind: eventKind === 'Tehlike' || eventKind === 'Karşılaşma' ? 'Karşılaşma' : 'Gözlem',
        locationLabel: insideLoc ? `${insideLoc.name} (${cell.id})` : `Mazgal ${cell.id}`,
        title: eventTitle,
        detail,
      }),
    },
    localMoraleDelta,
  };
}

