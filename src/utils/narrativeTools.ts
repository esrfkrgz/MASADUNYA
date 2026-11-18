import type {
  JourneyLogEntry,
  MapLocation,
  MapRoute,
  MazgalCell,
  NarrativeAiSettings,
  NarrativeChoice,
  NarrativeChoiceKind,
  NarrativeMessage,
  ProtagonistState,
  TravelPace,
  TravelTransport,
  WeatherConditionKey,
  WorldRoamingUnit,
} from '../types/map';
import { rollDie } from './diceEngine';
import {
  INITIAL_GAME_TIME_MS,
  addGameHours,
  addGameMinutes,
  formatGameDateTime,
  getDayPhaseLabel,
} from './gameTime';
import { findShortestMazgalPath, formatTravelHours, getCellForCoords } from './gridEngine';
import {
  advanceLivingLocations,
  applyExternalMoraleShift,
  recordRoamingArrivalOnLocation,
  resolveSettlementProblemByParty,
} from './livingWorldEngine';
import {
  inferRiskCategory,
  resolveActionRisk,
  type RiskCategory as ActionRiskCategory,
  type ActionRiskInput,
  type ActionRiskOutcome,
} from './actionRiskEngine';
import { buildContextualChoices } from './narrativeEngine';
import { forceFirstPersonAction, guardNarrativeText } from './narrativeGuard';
import {
  hasDescentIntent,
  hasForageIntent,
  hasStealIntent,
  normalizeTr,
  parseRequestedDurationMinutes,
} from './narrativeIntent';
import {
  advancePartyAndContactsWithTime,
  interactWithLivingNpc,
  type NpcInteractionType,
} from './partyAndRelationsEngine';
import {
  ACTION_HOURS,
  applyProtagonistTravel,
  evaluateSleepDeprivationAndCollapse,
  getFactionForLocation,
  getHoursWithoutSleep,
  getProtagonistModifiers,
  performProtagonistAction,
  resolveAutomaticTravelPace,
  resolveAutomaticTravelTransport,
} from './protagonistEngine';
import {
  advanceContractsAndWaves,
  advanceRegionalWeatherWithTime,
  advanceRoamingUnitsWithTime,
  checkGuardEncounterOnArrival,
  evaluateCriticalHealthRecovery,
  interactWithRoamingUnit,
  performShadowAction,
  resolveSettlementProblemAttempt,
  useInventoryItem,
} from './worldSystemsEngine';

import {
  buildFocusedSceneCard,
  buildPlannerContextBrief,
  detectScenePosture,
  maskUndiscoveredNames,
  sanitizeNarrativeOutput,
  type SceneActionRecord,
} from './sceneDirector';

export interface NarrativeWorkingState {
  protagonist: ProtagonistState;
  locations: MapLocation[];
  mazgalCells: MazgalCell[];
  routes: MapRoute[];
  activeWeatherKey: WeatherConditionKey;
  gameTimeMs: number;
  partyLocationId: string;
  journeyEntries: JourneyLogEntry[];
  engineFacts: string[];
  actionRecords: SceneActionRecord[];
  recentMessages?: NarrativeMessage[];
  playerActionText?: string;
  hoursSpentTotal: number;
  lastTimeAction?: string;
  preferredRole?: 'narrator' | 'dialogue';
  preferredSpeaker?: string;
  movedThisTurn: boolean;
  rolledDiceThisTurn: boolean;
}

const WEATHER_LABELS: Record<WeatherConditionKey, string> = {
  clear: 'Açık ve serin rüzgarlı hava',
  mist: 'Yoğun doğu sisi',
  rain: 'Orman yağmuru',
  storm: 'Sert fırtına',
};

function getLocationCategoryLabel(category: MapLocation['category']): string {
  switch (category) {
    case 'village':
      return 'yerleşim';
    case 'ruin':
      return 'eski kalıntı / harabe';
    case 'nature':
      return 'doğa alanı';
    case 'burrow':
      return 'ilkel in bölgesi';
    case 'danger':
      return 'tehlike bölgesi';
    case 'crossing':
      return 'geçit';
    default:
      return 'bölge';
  }
}

function isUnitOriginKnown(
  unit: WorldRoamingUnit,
  locations: MapLocation[],
  currentLocation?: MapLocation
): boolean {
  return (
    Boolean(currentLocation?.discovered) ||
    locations.some((l) => l.discovered && l.id === unit.currentLocationId)
  );
}

function getGenericUnitRoleLabel(unit: WorldRoamingUnit): string {
  if (unit.kind === 'raider') return 'Kimliği belirsiz silahlı akıncı/yağmacı grubu';
  if (unit.kind === 'caravan') return 'Yüklü yabancı tüccar kervanı';
  if (unit.kind === 'patrol') return 'Silahlı sınır devriyesi';
  return 'Bölgeyi tarayan silahlı gözcüler';
}

function describeUnitSensory(
  unit: WorldRoamingUnit,
  locations: MapLocation[],
  currentLocation?: MapLocation
): string {
  const known = isUnitOriginKnown(unit, locations, currentLocation);
  const label = known ? unit.name : getGenericUnitRoleLabel(unit);
  return known
    ? `${label} (bölgede ilerliyor)`
    : `${label} (kimliği ve geldiği yer Eşref tarafından henüz bilinmiyor — yalnızca dış görünüş ve silahlarıyla anlat)`;
}

function maskUndiscoveredLocationNames(
  text: string,
  locations: MapLocation[],
  currentLocation?: MapLocation
): string {
  return maskUndiscoveredNames(text, locations, currentLocation);
}

function sanitizeNarrativeOutputForEpistemicSafety(
  text: string,
  locations: MapLocation[],
  currentLocation?: MapLocation
): string {
  return sanitizeNarrativeOutput(text, locations, currentLocation);
}

function getCurrentContext(state: NarrativeWorkingState): {
  currentLocation: MapLocation | undefined;
  currentMazgal: MazgalCell;
} {
  const currentLocation = state.protagonist.locationId
    ? state.locations.find((l) => l.id === state.protagonist.locationId)
    : undefined;
  const fallbackCell =
    state.mazgalCells.find((c) => c.id === state.protagonist.mazgalId) ??
    state.mazgalCells.find(
      (c) => c.id === getCellForCoords(state.protagonist.x, state.protagonist.y).id
    ) ??
    state.mazgalCells[0];
  return { currentLocation, currentMazgal: fallbackCell };
}

function advanceWorldStateInTurn(
  state: NarrativeWorkingState,
  prevMs: number,
  nextMs: number,
  arrivalLoc?: MapLocation,
  arrivalCell?: MazgalCell,
  checkGuardsOnArrival = false
): string[] {
  const notices: string[] = [];
  let current = state.protagonist;

  current = advancePartyAndContactsWithTime(
    current,
    state.locations,
    state.routes,
    prevMs,
    nextMs
  );

  const { currentLocation: prevLoc, currentMazgal: prevMazgal } = getCurrentContext(state);
  const waveRes = advanceContractsAndWaves(current, prevMs, nextMs);
  current = waveRes.nextProtagonist;
  if (waveRes.waveAnnouncement) {
    notices.push(
      prevLoc?.discovered
        ? waveRes.waveAnnouncement
        : 'Bölge genelindeki havada huzursuz bir hareketlilik seziliyor.'
    );
  }

  const weatherTargetCell = arrivalCell ?? prevMazgal;
  const weatherRes = advanceRegionalWeatherWithTime(
    state.activeWeatherKey,
    current.activeWorldWave,
    prevMs,
    nextMs,
    {
      terrain: weatherTargetCell.terrain,
      safetyScore: weatherTargetCell.safetyScore,
      inSettlement: Boolean(arrivalLoc ?? prevLoc),
    }
  );
  state.activeWeatherKey = weatherRes.nextWeather;
  if (weatherRes.weatherNotice) notices.push(weatherRes.weatherNotice);

  const roamRes = advanceRoamingUnitsWithTime(
    current.roamingUnits ?? [],
    state.locations,
    state.routes,
    prevMs,
    nextMs
  );
  current = {
    ...current,
    roamingUnits: roamRes.nextUnits,
  };
  if (roamRes.notices.length > 0) {
    const visibleNotices = roamRes.notices.filter((note) =>
      state.locations.some(
        (loc) =>
          (loc.discovered || loc.id === (arrivalLoc ?? prevLoc)?.id) &&
          note.includes(loc.name)
      )
    );
    if (visibleNotices.length > 0) {
      notices.push(...visibleNotices);
    }
  }

  const { currentLocation, currentMazgal } = getCurrentContext({
    ...state,
    protagonist: current,
  });

  if (checkGuardsOnArrival && arrivalLoc) {
    const mods = getProtagonistModifiers(current, arrivalLoc, arrivalCell ?? currentMazgal);
    const guardRes = checkGuardEncounterOnArrival(current, arrivalLoc, nextMs, mods);
    current = guardRes.nextProtagonist;
    if (guardRes.alertNote) notices.push(guardRes.alertNote);
  }

  const critRes = evaluateCriticalHealthRecovery(
    current,
    arrivalLoc ?? currentLocation,
    arrivalCell ?? currentMazgal,
    nextMs
  );
  current = critRes.nextProtagonist;
  if (critRes.recoveryNotice) notices.push(critRes.recoveryNotice);

  state.protagonist = current;

  const prevDay = Math.floor((prevMs - INITIAL_GAME_TIME_MS) / (24 * 60 * 60 * 1000));
  const nextDay = Math.floor((nextMs - INITIAL_GAME_TIME_MS) / (24 * 60 * 60 * 1000));
  const daysCrossed = Math.max(0, nextDay - prevDay);
  let baseLocs = state.locations;

  if (roamRes.arrivals.length > 0) {
    baseLocs = baseLocs.map((loc) => {
      const hits = roamRes.arrivals.filter((a) => a.locationId === loc.id);
      let nextLoc = loc;
      for (const hit of hits) {
        nextLoc = recordRoamingArrivalOnLocation(
          nextLoc,
          hit.unitName,
          hit.unitKind,
          hit.detail,
          hit.moraleDelta,
          nextMs,
          hit.spawnRaid
        );
      }
      return nextLoc;
    });
  }

  const wave = current.activeWorldWave;
  if (wave && daysCrossed > 0 && wave.moraleShiftPerDay !== 0) {
    const totalWaveShift = wave.moraleShiftPerDay * daysCrossed;
    baseLocs = baseLocs.map((loc) => {
      const fac = getFactionForLocation(loc);
      if (!wave.affectedFactions.includes(fac)) return loc;
      return applyExternalMoraleShift(
        loc,
        totalWaveShift,
        nextMs,
        wave.title,
        wave.description
      );
    });
  }

  state.locations = advanceLivingLocations(baseLocs, nextMs, state.routes, current);
  state.gameTimeMs = nextMs;
  return notices;
}

function applySleepCollapseOrFatigueNotice(
  state: NarrativeWorkingState,
  duringTravel: boolean
): void {
  const { currentMazgal } = getCurrentContext(state);
  const res = evaluateSleepDeprivationAndCollapse({
    protagonist: state.protagonist,
    currentCell: currentMazgal,
    mazgalCells: state.mazgalCells,
    locations: state.locations,
    gameTimeMs: state.gameTimeMs,
    duringTravel,
  });

  if (res.collapsed && res.collapseFact) {
    const prevSleepMs = state.gameTimeMs;
    state.protagonist = res.nextProtagonist;
    if (res.landedLocation) {
      state.partyLocationId = res.landedLocation.id;
      state.locations = state.locations.map((loc) =>
        loc.id === res.landedLocation?.id ? { ...loc, discovered: true } : loc
      );
    }
    advanceWorldStateInTurn(
      state,
      prevSleepMs,
      res.nextTimeMs,
      res.landedLocation,
      res.landedCell,
      false
    );
    state.protagonist = {
      ...state.protagonist,
      lastSleptMs: res.nextTimeMs,
      lastUpdatedMs: res.nextTimeMs,
    };
    state.hoursSpentTotal += res.sleepHours;
    if (res.movedCell) state.movedThisTurn = true;
    state.lastTimeAction = `Uykusuzluktan Bayılma (+${res.sleepHours} Saat)`;
    state.journeyEntries.push({
      id: `log-collapse-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      locationId: res.landedLocation?.id ?? state.partyLocationId,
      locationName: res.landedLocation ? res.landedLocation.name : res.landedCell.terrainLabel,
      timestamp: formatGameDateTime(res.nextTimeMs),
      note: `Aşırı uykusuzluktan kendinden geçip ${res.sleepHours} saat sonra burada uyandın.`,
    });
    state.engineFacts.push(res.collapseFact);
    state.actionRecords.push({
      category: 'travel',
      subType: 'sleep_collapse',
      summary: res.collapseFact,
      outcomeTone: 'critical',
      focusDirective:
        'Aşırı uykusuzluktan Eşref’in bilincinin kapanıp yığıldığını ve saatler sonra rastgele yabancı bir noktada gözlerini açtığını net biçimde yaz.',
      forbiddenHints: [],
    });
  } else if (res.hoursAwake >= 22) {
    const hrs = Math.round(res.hoursAwake);
    state.engineFacts.push(
      res.hoursAwake >= 40
        ? `KRİTİK UYKUSUZLUK (${hrs} saattir uykusuz): Gözlerin kararıyor, adımların birbirine dolanıyor. Artık durup uyumazsan her an rastgele bir yerde yığılıp kalacaksın!`
        : `AŞIRI YORGUNLUK (${hrs} saattir uykusuz): Göz kapakların ağırlaştı, bedenin dinlenmek için yalvarıyor; bir yerde durup uyuman gerekiyor.`
    );
  }
}

function computeTravelHours(
  baseHours: number,
  pace: TravelPace,
  transport: TravelTransport,
  weather: WeatherConditionKey,
  hasDirectRoute: boolean,
  requiresBoat: boolean
): number {
  const paceMult = pace === 'stealth' ? 1.18 : pace === 'forced' ? 0.8 : 1.0;
  const transportMult =
    transport === 'mule'
      ? hasDirectRoute
        ? 0.85
        : 1.05
      : transport === 'boat' && requiresBoat
      ? 0.75
      : 1.0;
  const weatherMult =
    weather === 'storm' ? 1.28 : weather === 'rain' ? 1.14 : weather === 'mist' ? 1.06 : 1.0;
  return Math.max(1, Math.round(baseHours * paceMult * transportMult * weatherMult));
}

export function buildAiContextSnapshot(state: NarrativeWorkingState): string {
  const { currentLocation, currentMazgal } = getCurrentContext(state);
  const p = state.protagonist;
  const mods = getProtagonistModifiers(p, currentLocation, currentMazgal);
  const living = currentLocation?.livingState;

  const contactsHere = (p.contacts ?? []).filter(
    (c) =>
      c.partyRelation !== 'independent' ||
      (currentLocation
        ? c.currentLocationId === currentLocation.id
        : c.currentMazgalId === currentMazgal.id)
  );
  const unitsHere = (p.roamingUnits ?? []).filter((u) => u.mazgalId === currentMazgal.id);

  const inventorySummary =
    (p.inventory ?? [])
      .filter((item) => item.qty > 0)
      .map((item) => `${item.name} x${item.qty}`)
      .join(', ') || 'Özel eşya yok';

  const dayPhase = getDayPhaseLabel(state.gameTimeMs);
  const isNight = dayPhase === 'Gece' || dayPhase === 'Gece Yarısı';
  const hasTorchLit = (p.activeConditions ?? []).includes('Meşale Işığı');
  const effectiveVisibilityMeters = isNight
    ? hasTorchLit
      ? Math.min(18, currentMazgal.visibilityMeters)
      : Math.min(5, currentMazgal.visibilityMeters)
    : currentMazgal.visibilityMeters;
  const canPreviewNeighborTerrain = !isNight && effectiveVisibilityMeters >= 45;

  const visitedSet = new Set(p.visitedMazgalIds ?? [currentMazgal.id]);
  const directionsList = currentMazgal.neighbors
    .map((nb) => {
      const targetCell = state.mazgalCells.find((c) => c.id === nb.id);
      const locInside = targetCell?.locationsInside?.[0];
      const isLocKnown =
        Boolean(locInside) &&
        (Boolean(locInside?.discovered) || visitedSet.has(nb.id));
      const locSuffix =
        locInside && isLocKnown
          ? ` (bilinen ${getLocationCategoryLabel(locInside.category)}: ${locInside.name})`
          : '';
      if (visitedSet.has(nb.id) || isLocKnown || canPreviewNeighborTerrain) {
        return `${nb.direction}: ${nb.terrainLabel}${locSuffix}`;
      }
      return `${nb.direction}: ${
        isNight && !hasTorchLit ? 'Karanlık' : 'Yoğun sis ve sık örtü'
      } ardı görünmüyor (henüz keşfedilmedi)`;
    })
    .join(' | ');

  const knownSettlements = state.locations
    .filter((l) => l.discovered || l.id === currentLocation?.id)
    .map((l) => l.name)
    .join(', ');

  const waveSummary = (() => {
    const wave = p.activeWorldWave;
    if (!wave) return '';
    if (currentLocation?.discovered) {
      return `Bölgesel Olay Dalgası: ${wave.title} (${maskUndiscoveredLocationNames(wave.description, state.locations, currentLocation)})`;
    }
    const sensoryWave =
      wave.kind === 'Sis Fırtınası'
        ? 'Çevrede olağanüstü soğuk ve yoğun sis tabakası hakim'
        : wave.kind === 'Goblin Akını'
        ? 'Ormanın yakın çemberinde tedirgin edici bir sessizlik ve belirsiz hareketlilik hissi var (kaynağı ve kimliği görünmüyor)'
        : wave.kind === 'Ticaret Şenliği'
        ? 'Hava yolculuk için görece elverişli hissediliyor'
        : wave.kind === 'Kıtlık Dalgası'
        ? 'Çevredeki bitki ve av izleri cılız görünüyor'
        : 'Çevredeki sessizlikte belirsiz bir tekinsizlik hissediliyor';
    return `Yakın Çevre Atmosferi: ${sensoryWave} (Eşref uzak olayları bilmiyor).`;
  })();

  const lightAndSightLimit =
    isNight && !hasTorchLit
      ? `Işık ve Görüş Sınırı: Şu an ${dayPhase.toLowerCase()} ve meşale YANMIYOR! Fiziksel görüş yalnızca ~${effectiveVisibilityMeters} metre (zifiri karanlık). Bu 5 metrelik çemberin dışındaki ağaçları, suları, uzak tepeleri veya yapıları gördüğünü ASLA yazma.`
      : `Işık ve Görüş Sınırı: Fiziksel görüş ~${effectiveVisibilityMeters} metre (${
          hasTorchLit ? 'elde meşale yanıyor' : WEATHER_LABELS[state.activeWeatherKey].toLowerCase()
        }). Her bölge ~18 fersah (~90 km) genişliğindedir; bu dar sis çemberinden komşu bölgeler, uzak dumanlar, gizli kamplar veya uzak köyler ASLA GÖRÜNEMEZ.`;

  const sceneObjectBoundary = !currentLocation
    ? 'Çevre Nesne Gerçeği: Bu açık arazide önceden kurulmuş hiçbir iskele, kamp ateşi, duman kaynağı, matara veya sandık YOKTUR; motor sonucu belirtmedikçe uydurma.'
    : currentLocation.category === 'ruin' || currentLocation.category === 'nature'
    ? `Çevre Nesne Gerçeği: Burası ıssız bir ${getLocationCategoryLabel(currentLocation.category)} noktasıdır; motor sonucu belirtmedikçe olmayan kamp ateşi, matara veya iskele uydurma.`
    : '';

  const hoursAwake = getHoursWithoutSleep(p, state.gameTimeMs);
  const sleepStatus =
    hoursAwake >= 40
      ? `${Math.round(hoursAwake)} saattir uykusuz — KRİTİK! Artık uyumazsa her an kendinden geçip yığılabilir`
      : hoursAwake >= 22
      ? `${Math.round(hoursAwake)} saattir uykusuz — AŞIRI YORGUN, artık uyuması gerek`
      : `${Math.round(hoursAwake)} saattir uyanık (Olağan)`;

  const safeLore = currentLocation
    ? maskUndiscoveredLocationNames(currentLocation.playerLore, state.locations, currentLocation)
    : '';
  const safeProblems =
    living && living.activeProblems.length > 0
      ? living.activeProblems
          .map((pr) => maskUndiscoveredLocationNames(pr.title, state.locations, currentLocation))
          .join(', ')
      : 'Aktif sorun yok';

  return [
    `Karakter: ${p.name} (${p.appearanceNote ?? p.title})`,
    `Fiziksel/Durum: Can ${p.health}/100, Zindelik ${p.stamina}/100, Açlık ${p.hunger}/100, Moral/Ruh Hali: ${p.mood}`,
    `Uykusuzluk Durumu: ${sleepStatus}`,
    `Özellikler & Koşullar: ${(p.marks ?? []).join(', ') || 'Yok'} | Aktif Durumlar: ${(p.activeConditions ?? []).join(', ') || 'Yok'}`,
    `Modifikatörler: Fiziksel ${mods.physicalMod >= 0 ? `+${mods.physicalMod}` : mods.physicalMod}, Algı ${mods.perceptionMod >= 0 ? `+${mods.perceptionMod}` : mods.perceptionMod}, Sosyal ${mods.socialMod >= 0 ? `+${mods.socialMod}` : mods.socialMod}`,
    `Çanta & Kesesi: ${p.silver} Gümüş, ${p.rations} Kuru Erzak | Eşyalar: ${inventorySummary}`,
    `Zaman & Hava: ${formatGameDateTime(state.gameTimeMs)} (${dayPhase}) | ${WEATHER_LABELS[state.activeWeatherKey]}`,
    currentLocation
      ? `Konum (${getLocationCategoryLabel(currentLocation.category)}): ${currentLocation.name} — ${safeLore} | Yerel Ruh Hali: ${living?.mood ?? 'Olağan'} | Sakinler: ${living?.notableResidents.map((r) => `${r.name} (${r.role})`).join(', ') || 'Bölge halkı'} | Görünen Yerel Meseleler: ${safeProblems}`
      : `Konum (Açık Arazi): ${currentMazgal.terrainLabel} — ${currentMazgal.summary} | Görüş: ~${effectiveVisibilityMeters} metre | Tehlike: ${currentMazgal.dangerLevel}/5 | Doğal İzler: ${currentMazgal.resourceYield}`,
    lightAndSightLimit,
    sceneObjectBoundary,
    `Ulaşılabilir Yönler: ${directionsList || 'Çıkış yok'}`,
    `Bilinen Yerleşim ve Noktalar: ${knownSettlements || 'Henüz keşfedilmiş yer yok'}`,
    `Yanındaki / Konumdaki Kişiler: ${contactsHere.map((c) => `${c.name} (${c.role}, ilişki: ${c.partyRelation}, güven: ${c.trust}, yakınlık: ${c.affection})`).join(' | ') || 'Kimse yok'}`,
    `Yakındaki Gezgin Gruplar: ${unitsHere.map((u) => describeUnitSensory(u, state.locations, currentLocation)).join(' | ') || 'Yok'}`,
    waveSummary,
    `Epistemik Bilgi Sınırı: Eşref yalnızca ~${effectiveVisibilityMeters} metrelik duyusal çemberindekileri, "Bilinen Yerleşim ve Noktalar" listesini ve "Yanındaki / Konumdaki Kişiler"i bilir. Listede olmayan gizli kampları, goblin/kobold inlerini, uzak yerleşim olaylarını veya keşfedilmemiş yerleri anlatımda ve 4 seçenekte ASLA açık etme.`,
  ]
    .filter(Boolean)
    .join('\n');
}

/** Eylemin risk hesabı için çevre + metrik girdisini oluşturur. */
function buildActionRiskInput(
  state: NarrativeWorkingState,
  category: ActionRiskCategory,
  actionText: string
): ActionRiskInput {
  const { currentLocation, currentMazgal } = getCurrentContext(state);
  const mods = getProtagonistModifiers(state.protagonist, currentLocation, currentMazgal);
  const norm = normalizeTr(actionText);
  const dayPhase = getDayPhaseLabel(state.gameTimeMs);
  const isNight = dayPhase === 'Gece' || dayPhase === 'Gece Yarısı';
  const hasTorchLit = (state.protagonist.activeConditions ?? []).includes('Meşale Işığı');
  const hoursAwake = getHoursWithoutSleep(state.protagonist, state.gameTimeMs);
  const terrainFold = normalizeTr(`${currentMazgal.terrainLabel} ${currentMazgal.terrain}`);
  const weather = String(state.activeWeatherKey).toLowerCase();

  return {
    category,
    roll: rollDie(20),
    secondaryRoll: rollDie(6),
    mods: { physical: mods.physicalMod, perception: mods.perceptionMod, social: mods.socialMod },
    nightWithoutTorch: isNight && !hasTorchLit,
    lowVisibility: currentMazgal.visibilityMeters < 20,
    wetGround: /marsh|river|nemli|islak|yosun|sis/.test(terrainFold),
    heavyWeather: /rain|storm|firtina|yagmur/.test(weather),
    exhausted: hoursAwake >= 20 || state.protagonist.stamina <= 30,
    careful: /\b(yavas\w*|dikkat\w*|temkin\w*|usulca|sessiz\w*)/.test(norm),
    rushing: /\b(hizli\w*|acele\w*|kos\w*|depar\w*)/.test(norm),
  };
}

function riskSceneRecord(outcome: ActionRiskOutcome): {
  category: SceneActionRecord['category'];
  subType: string;
  outcomeTone: SceneActionRecord['outcomeTone'];
} {
  const failed = outcome.healthLoss > 0 || outcome.degree === 'failure' || outcome.degree === 'critical_failure';
  if (outcome.category === 'climb' && !failed) {
    return { category: 'observe', subType: 'climb_vantage', outcomeTone: 'success' };
  }
  if (outcome.category === 'climb') {
    return { category: 'survival', subType: 'descend_from_vantage', outcomeTone: 'fail' };
  }
  if (outcome.category === 'descend') {
    return {
      category: 'survival',
      subType: 'descend_from_vantage',
      outcomeTone: failed ? 'fail' : 'success',
    };
  }
  const category: SceneActionRecord['category'] =
    outcome.category === 'inspect'
      ? 'observe'
      : outcome.category === 'travel'
      ? 'travel'
      : outcome.category === 'social'
      ? 'social'
      : outcome.category === 'forage' || outcome.category === 'stealth' || outcome.category === 'rest'
      ? 'survival'
      : 'free_roleplay';
  return {
    category,
    subType: outcome.category,
    outcomeTone: failed ? 'fail' : outcome.degree === 'critical_success' ? 'critical' : 'success',
  };
}

/** Risk sonucunu can/zindelik/süre ve motor gerçeği olarak duruma işler. */
function applyActionRisk(
  state: NarrativeWorkingState,
  outcome: ActionRiskOutcome,
  focusSuffix = ''
): ActionRiskOutcome {
  const p = state.protagonist;
  const conditions = [...(p.activeConditions ?? [])];
  if (outcome.condition && !conditions.includes(outcome.condition)) {
    conditions.push(outcome.condition);
  }
  state.protagonist = {
    ...p,
    health: Math.max(5, p.health - outcome.healthLoss),
    stamina: Math.max(5, p.stamina - outcome.staminaLoss),
    activeConditions: conditions.slice(0, 4),
    lastObservation: outcome.fact,
    lastUpdatedMs: state.gameTimeMs,
  };
  state.rolledDiceThisTurn = true;
  state.engineFacts.push(outcome.fact);
  const record = riskSceneRecord(outcome);
  state.actionRecords.push({
    category: record.category,
    subType: record.subType,
    summary: outcome.fact,
    outcomeTone: record.outcomeTone,
    durationLabel: formatTravelHours(outcome.minutes / 60),
    focusDirective: `${outcome.focusDirective}${focusSuffix ? ` ${focusSuffix}` : ''}`,
    forbiddenHints:
      outcome.healthLoss > 0
        ? ['Yaralanma/düşme sonucunu gizleme veya başarı gibi anlatma.', 'Can ve zindelik sayılarını birebir aktar.']
        : [],
  });
  return outcome;
}

export function executeNarrativeToolCall(
  toolName: string,
  args: Record<string, unknown>,
  state: NarrativeWorkingState
): Record<string, unknown> {
  const { currentLocation, currentMazgal } = getCurrentContext(state);
  const mods = getProtagonistModifiers(state.protagonist, currentLocation, currentMazgal);
  const living = currentLocation?.livingState;

  if (toolName === 'descend_from_vantage') {
    // Önceki pozisyonu, oyuncunun "aşağı in" cümlesini yok sayarak bul:
    // detectScenePosture o cümleyi görünce hemen 'ground' döndürüyordu.
    const priorPosture = detectScenePosture({
      currentLocation,
      recentMessages: state.recentMessages ?? [],
      currentPlayerText: '',
      movedThisTurn: state.movedThisTurn,
      actionRecords: state.actionRecords,
    });
    if (priorPosture !== 'treetop') {
      const noRiskFact = 'Zemin üzerindesin; aşağı inmen gerekmiyor, düşme riski oluşmadı.';
      state.engineFacts.push(noRiskFact);
      state.actionRecords.push({
        category: 'survival',
        subType: 'descend_from_vantage',
        summary: noRiskFact,
        outcomeTone: 'neutral',
        focusDirective: 'İnişe gerek olmadığını tek kısa cümlede söyle; düşme uydurma.',
        forbiddenHints: [],
      });
      return { moved: false, fell: false, fact: noRiskFact };
    }

    const outcome = applyActionRisk(
      state,
      resolveActionRisk(
        buildActionRiskInput(
          state,
          'descend',
          String(args.note ?? state.playerActionText ?? 'ağaçtan aşağı iniyorum')
        )
      )
    );
    const prevMs = state.gameTimeMs;
    const nextMs = addGameMinutes(prevMs, outcome.minutes);
    const notices = advanceWorldStateInTurn(state, prevMs, nextMs, currentLocation, currentMazgal);
    state.hoursSpentTotal += outcome.minutes / 60;
    state.lastTimeAction = `Ağaçtan iniş (+${formatTravelHours(outcome.minutes / 60)})${
      notices.length > 0 ? ` · ${notices[0]}` : ''
    }`;
    return {
      moved: true,
      fell: outcome.healthLoss > 0,
      damage: outcome.healthLoss,
      dc: outcome.dc,
      total: outcome.total,
      fact: outcome.fact,
      notices,
    };
  }

  if (toolName === 'inspect_self_and_surroundings') {
    const focus = String(args.focus ?? 'tracks_and_area');
    const defaultMinutes =
      focus === 'self_and_pockets'
        ? 3
        : focus === 'tracks_and_area'
        ? 10
        : 20;
    const durationMinutes =
      typeof args.durationMinutes === 'number' && Number.isFinite(args.durationMinutes)
        ? Math.max(1, Math.min(90, Math.round(args.durationMinutes)))
        : defaultMinutes;
    const elapsedHours = durationMinutes / 60;
    const prevMs = state.gameTimeMs;
    const nextMs = addGameMinutes(prevMs, durationMinutes);
    const outcome = performProtagonistAction(
      state.protagonist,
      'observe',
      currentLocation,
      currentMazgal,
      nextMs,
      durationMinutes
    );
    state.protagonist = outcome.nextProtagonist;
    const notices = advanceWorldStateInTurn(
      state,
      prevMs,
      nextMs,
      currentLocation,
      currentMazgal
    );
    state.hoursSpentTotal += elapsedHours;
    state.rolledDiceThisTurn = true;
    state.lastTimeAction = `Gözlem (+${formatTravelHours(elapsedHours)})${
      notices.length > 0 ? ` · ${notices[0]}` : ''
    }`;

    const roll = rollDie(20);
    const total = roll + mods.perceptionMod;
    const modStr = mods.perceptionMod >= 0 ? `+${mods.perceptionMod}` : `${mods.perceptionMod}`;
    const p = state.protagonist;
    const unitsHere = (p.roamingUnits ?? []).filter((u) => u.mazgalId === currentMazgal.id);
    const dayPhase = getDayPhaseLabel(state.gameTimeMs);
    const isNight = dayPhase === 'Gece' || dayPhase === 'Gece Yarısı';
    const hasTorchLit = (p.activeConditions ?? []).includes('Meşale Işığı');
    const effectiveVis = isNight
      ? hasTorchLit
        ? Math.min(18, currentMazgal.visibilityMeters)
        : Math.min(5, currentMazgal.visibilityMeters)
      : currentMazgal.visibilityMeters;
    const nearSummary =
      !isNight && effectiveVis >= 45
        ? currentMazgal.neighbors
            .slice(0, 3)
            .map((nb) => `${nb.direction} yönünde ${nb.terrainLabel.toLowerCase()}`)
            .join(', ')
        : 'görüş sis ve karanlık nedeniyle yalnızca birkaç adımla sınırlı';

    const maskedLocalEffect = currentMazgal.neighborEffects[0]
      ? maskUndiscoveredLocationNames(
          currentMazgal.neighborEffects[0],
          state.locations,
          currentLocation
        )
      : '';

    let fact = '';
    if (focus === 'self_and_pockets') {
      const trackPart =
        total >= 12
          ? `Yosunlar incelendiğinde (Algı zarı ${roll}${modStr}=${total}, Başarılı) çam diplerinden güney yönüne doğru giden taze bot izleri ve kırık dallar tespit edildi.`
          : `Yosunlardaki izler sis ve nem yüzünden belirsiz (Algı zarı ${roll}${modStr}=${total}); yalnızca kendi düşüş izi seçilebiliyor.`;
      fact = `Üst-baş ve cep incelemesi: Koyu renk işaretsiz yolcu tuniği, belde kısa kılıç, kesede ${p.silver} gümüş sikke, çantada ${p.rations} kuru erzak var. Kimlik veya mektup yok; hafızada yalnızca "Eşref" adı bulunuyor. ${trackPart}`;
    } else if (focus === 'climb_vantage') {
      fact = !currentLocation
        ? !isNight && effectiveVis >= 45
          ? `Yüksek çam ağacına tırmanış (Algı zarı ${roll}${modStr}=${total}): Sisin inceldiği noktalarda ${nearSummary} seçildi.`
          : `Yüksek bir noktaya çıkılsa da (Algı zarı ${roll}${modStr}=${total}) ${
              isNight && !hasTorchLit
                ? 'gece karanlığı nedeniyle uzak yönler seçilemiyor.'
                : 'yoğun sis nedeniyle görüş ~' + effectiveVis + ' metre ile sınırlı; ağaç tepesinden bile yalnızca gri sis denizi görünüyor, uzak yerleşim veya kamp seçilemiyor.'
            }`
        : `${currentLocation.name} içinde yüksek bir noktadan çevre gözlendi (Algı zarı ${roll}${modStr}=${total}): Yerleşim ${living?.mood ?? 'olağan'} durumda.`;
    } else if (focus === 'listen_rumors') {
      if (currentLocation && living) {
        const safeRumor =
          living.rumors.length > 0
            ? maskUndiscoveredLocationNames(living.rumors[0], state.locations, currentLocation)
            : '';
        const safeProb =
          living.activeProblems.length > 0
            ? maskUndiscoveredLocationNames(
                living.activeProblems[0].title,
                state.locations,
                currentLocation
              )
            : '';
        fact = `${currentLocation.name} içinde kulak kabartıldı (Algı zarı ${roll}${modStr}=${total}): Ruh hali "${living.mood}". ${
          safeRumor ? `Duyulan yerel söylenti: "${safeRumor}". ` : ''
        }${safeProb ? `Yerel sorun: ${safeProb}.` : ''}`;
      } else {
        fact = `Açık arazide sesler dinlendi (Algı zarı ${roll}${modStr}=${total}): ${
          total >= 12 && maskedLocalEffect
            ? maskedLocalEffect
            : 'Rüzgar ve yaprak hışırtısı dışında net bir insan veya hareket sesi yok.'
        }`;
      }
    } else {
      const darkNote =
        isNight && !hasTorchLit
          ? `Gece karanlığı (${dayPhase.toLowerCase()}, meşalesiz): Görüş ~${effectiveVis} metre ile sınırlı, yalnızca yakın sesler ve temasla çevre tartılabiliyor.`
          : `Görüş yaklaşık ${effectiveVis} metre.`;
      const trackHint =
        total >= 12
          ? `Güçlü gözlem (Algı zarı ${roll}${modStr}=${total}): ${darkNote} Yakın çevrede ${currentMazgal.resourceYield.toLowerCase()} izleri var.${
              !isNight && effectiveVis >= 45 ? ` ${nearSummary}.` : ''
            }${maskedLocalEffect ? ` ${maskedLocalEffect}` : ''}`
          : `Kısıtlı gözlem (Algı zarı ${roll}${modStr}=${total}): ${darkNote} Çevre şimdilik sakin görünüyor.`;
      fact = `${trackHint}${
        unitsHere.length > 0
          ? ` Yakındaki hareketlilik: ${unitsHere
              .map((u) => describeUnitSensory(u, state.locations, currentLocation))
              .join(', ')}.`
          : ''
      }`;
    }

    if (notices.length > 0) fact += ` Dünya bildirimi: ${notices[0]}`;

    // Tırmanış da fiziksel risk taşır: düşme zarı yoksa tırmanış "bedava" oluyordu.
    let climbRisk: ActionRiskOutcome | null = null;
    if (focus === 'climb_vantage' && !currentLocation) {
      climbRisk = resolveActionRisk(
        buildActionRiskInput(state, 'climb', state.playerActionText ?? '')
      );
      const p = state.protagonist;
      const conditions = [...(p.activeConditions ?? [])];
      if (climbRisk.condition && !conditions.includes(climbRisk.condition)) {
        conditions.push(climbRisk.condition);
      }
      state.protagonist = {
        ...p,
        health: Math.max(5, p.health - climbRisk.healthLoss),
        stamina: Math.max(5, p.stamina - climbRisk.staminaLoss),
        activeConditions: conditions.slice(0, 4),
        lastUpdatedMs: state.gameTimeMs,
      };
      state.rolledDiceThisTurn = true;
      fact = `${climbRisk.fact} ${fact}`;
    }

    state.engineFacts.push(fact);

    const priorPosture = detectScenePosture({
      currentLocation,
      recentMessages: state.recentMessages ?? [],
      currentPlayerText: state.playerActionText ?? '',
      movedThisTurn: state.movedThisTurn,
      actionRecords: state.actionRecords,
    });
    const observeDirective =
      focus === 'climb_vantage'
        ? !currentLocation && !(!isNight && effectiveVis >= 45)
          ? `Yalnızca çama tırmanışını ve ~${effectiveVis}m yoğun sis/karanlık yüzünden tepeden bile duman, yapı veya yerleşim görülmediğini 1–2 net cümlede anlat.`
          : 'Yüksekten görülebilen kadarını kısaca anlat.'
        : focus === 'self_and_pockets'
        ? 'Yalnızca Eşref’in üzerindekileri, kesesindeki gümüş/erzağı ve yerdeki iz sonucunu doğrudan aktar.'
        : focus === 'listen_rumors'
        ? 'Yalnızca kulak kabartarak duyduğu yakın sesleri veya yerel söylentiyi aktar.'
        : priorPosture === 'treetop'
        ? `Eşref hâlâ ağaç tepesinde; yalnızca ~${effectiveVis}m sis/karanlık içinde dallar arasından görebildiğini kısaca söyle.`
        : 'Önceki turda söylediklerini tekrarlamadan yalnızca yeni gözlem sonucunu ve varsa yakındaki iz/hareketi yaz.';
    const observeForbidden =
      focus === 'climb_vantage' || priorPosture === 'treetop'
        ? ['Eşref şu an ağaç tepesinde: yerdeki toprak, yosun veya ayak sesi tasviri YAPMA!']
        : [];
    const fellWhileClimbing = Boolean(climbRisk && climbRisk.healthLoss > 0);
    state.actionRecords.push({
      category: fellWhileClimbing ? 'survival' : 'observe',
      subType: fellWhileClimbing ? 'descend_from_vantage' : focus,
      summary: fact,
      outcomeTone: climbRisk
        ? fellWhileClimbing
          ? 'fail'
          : climbRisk.degree === 'critical_success'
          ? 'critical'
          : 'success'
        : total >= 12
        ? 'success'
        : 'fail',
      durationLabel: formatTravelHours(elapsedHours),
      focusDirective: climbRisk
        ? `${climbRisk.focusDirective} ${observeDirective}`
        : observeDirective,
      forbiddenHints: fellWhileClimbing
        ? ['Düştüğünü ve yaralandığını gizleme; ağaç tepesinde olduğunu söyleme.']
        : observeForbidden,
    });
    applySleepCollapseOrFatigueNotice(state, false);

    return {
      ok: true,
      perceptionRoll: total,
      silver: p.silver,
      rations: p.rations,
      visibilityMeters: effectiveVis,
      nearbyDirections: nearSummary,
      unitsHere: unitsHere.map((u) =>
        isUnitOriginKnown(u, state.locations, currentLocation)
          ? u.name
          : getGenericUnitRoleLabel(u)
      ),
      summary: fact,
    };
  }

  if (toolName === 'travel_direction') {
    const requestedDir = normalizeTr(String(args.direction ?? ''));
    const nb = currentMazgal.neighbors.find((n) =>
      normalizeTr(n.direction).includes(requestedDir)
    );
    if (!nb) {
      const validDirs = currentMazgal.neighbors.map((n) => n.direction).join(', ');
      const fact = `${String(args.direction ?? 'Bu')} yönünde aşılabilir bir yol veya geçit yok. Geçilebilir yönler: ${validDirs}.`;
      state.engineFacts.push(fact);
      state.actionRecords.push({
        category: 'travel',
        subType: 'blocked_dir',
        summary: fact,
        outcomeTone: 'fail',
        focusDirective: 'O yönde geçiş olmadığını ve geçilebilir yönleri kısaca belirt.',
        forbiddenHints: [],
      });
      return { moved: false, reason: fact, validDirections: validDirs };
    }

    const targetCell = state.mazgalCells.find((c) => c.id === nb.id) ?? currentMazgal;
    const requestedPace =
      args.pace === 'stealth' || args.pace === 'forced'
        ? (args.pace as TravelPace)
        : undefined;
    const pace = resolveAutomaticTravelPace(
      state.protagonist,
      targetCell,
      state.activeWeatherKey,
      requestedPace
    );
    const transport = resolveAutomaticTravelTransport(
      state.protagonist,
      targetCell,
      Boolean(nb.requiresBoat),
      false
    );

    if ((targetCell.terrain === 'lake' || targetCell.terrain === 'sea') && transport !== 'boat') {
      const prevMs = state.gameTimeMs;
      const nextMs = addGameMinutes(prevMs, 20);
      const notices = advanceWorldStateInTurn(
        state,
        prevMs,
        nextMs,
        currentLocation,
        currentMazgal
      );
      state.hoursSpentTotal += 20 / 60;
      const validLandDirs = currentMazgal.neighbors
        .filter((n) => {
          const nc = state.mazgalCells.find((c) => c.id === n.id);
          return nc && nc.terrain !== 'lake' && nc.terrain !== 'sea';
        })
        .map((n) => `${n.direction} (${n.terrainLabel})`)
        .join(', ');
      state.lastTimeAction = 'Su Kıyısı (+20 Dk)';
      const fact = `${nb.direction} yönünde ${targetCell.terrainLabel.toLowerCase()} kıyısına ulaşıldı; ancak Eşref'in kayık, sal veya teknesi olmadığı için açık suya açılamadı ve kuru kıyıda durmak zorunda kaldı. Geçilebilir kara yönleri: ${validLandDirs || 'çevrede kara yok'}.${
        notices.length > 0 ? ` ${notices[0]}` : ''
      }`;
      state.engineFacts.push(fact);
      state.actionRecords.push({
        category: 'travel',
        subType: 'blocked_water',
        summary: fact,
        outcomeTone: 'fail',
        focusDirective: 'Suyun kıyısına gelip tekne olmadığı için durduğunu ve açık kara yönlerini net söyle.',
        forbiddenHints: [],
      });
      return {
        moved: false,
        blockedByWater: true,
        waterTerrain: targetCell.terrainLabel,
        validLandDirections: validLandDirs,
        summary: fact,
      };
    }

    const adjustedHours = computeTravelHours(
      nb.travelHours,
      pace,
      transport,
      state.activeWeatherKey,
      false,
      Boolean(nb.requiresBoat)
    );
    const prevMs = state.gameTimeMs;
    const nextMs = addGameHours(prevMs, adjustedHours);
    const locInside = targetCell.locationsInside[0];

    const { nextProtagonist, localMoraleDelta } = applyProtagonistTravel(
      state.protagonist,
      locInside,
      targetCell,
      adjustedHours,
      nextMs,
      {
        pace,
        transport,
        weather: state.activeWeatherKey,
        requiresBoat: Boolean(nb.requiresBoat),
      }
    );
    state.protagonist = nextProtagonist;
    const insideIds = new Set(targetCell.locationsInside.map((l) => l.id));
    if (locInside) {
      state.partyLocationId = locInside.id;
    }
    if (insideIds.size > 0) {
      state.locations = state.locations.map((loc) =>
        insideIds.has(loc.id)
          ? applyExternalMoraleShift(
              { ...loc, discovered: true },
              loc.id === locInside?.id ? localMoraleDelta : 0,
              nextMs
            )
          : loc
      );
    }

    const notices = advanceWorldStateInTurn(
      state,
      prevMs,
      nextMs,
      locInside,
      targetCell,
      Boolean(locInside)
    );
    state.hoursSpentTotal += adjustedHours;
    state.movedThisTurn = true;
    state.lastTimeAction = `${nb.direction} Yürüyüşü (+${formatTravelHours(adjustedHours)})${
      notices.length > 0 ? ` · ${notices[0]}` : ''
    }`;
    state.journeyEntries.push({
      id: `log-ai-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      locationId: locInside?.id ?? state.partyLocationId,
      locationName: locInside ? locInside.name : `${targetCell.terrainLabel} (${nb.direction})`,
      timestamp: formatGameDateTime(nextMs),
      note: `${nb.direction} yönüne ${formatTravelHours(adjustedHours)} (${pace === 'stealth' ? 'gizli tempo' : pace === 'forced' ? 'hızlı yürüyüş' : 'olağan tempo'}) ilerlendi.`,
    });

    const newUnitsHere = (state.protagonist.roamingUnits ?? []).filter(
      (u) => u.mazgalId === targetCell.id
    );
    const locIntro = locInside
      ? `Yeni keşfedilen ${getLocationCategoryLabel(locInside.category)}: ${locInside.name} — ${
          maskUndiscoveredLocationNames(
            locInside.playerLore.split('.')[0],
            state.locations,
            locInside
          )
        }.`
      : `Yeni bölge: ${targetCell.terrainLabel}.`;
    const maskedNotices = notices
      .map((n) => maskUndiscoveredLocationNames(n, state.locations, locInside))
      .join(' ');
    const fact = `${nb.direction} yönüne ${formatTravelHours(adjustedHours)} (${
      pace === 'stealth' ? 'gizlice' : pace === 'forced' ? 'hızlıca' : 'olağan tempoda'
    }) ilerlendi. ${locIntro} Can: ${state.protagonist.health}/100, Zindelik: ${
      state.protagonist.stamina
    }/100.${
      newUnitsHere.length > 0
        ? ` Burada karşılaşılan gruplar: ${newUnitsHere
            .map((u) => describeUnitSensory(u, state.locations, locInside))
            .join(', ')}.`
        : ''
    }${maskedNotices ? ` Yol olayı: ${maskedNotices}` : ''}`;
    state.engineFacts.push(fact);
    state.actionRecords.push({
      category: 'travel',
      subType: 'move',
      summary: fact,
      outcomeTone: 'success',
      durationLabel: formatTravelHours(adjustedHours),
      movedFromLabel: currentLocation?.name ?? currentMazgal.terrainLabel,
      movedToLabel: locInside?.name ?? targetCell.terrainLabel,
      discoveredPlaceName: locInside?.name,
      focusDirective: locInside
        ? `Yolculuk süresini ve yeni keşfedilen ${locInside.name} eşiğindeki ilk somut gözlemi net anlat.`
        : `Yolculuk süresini, yorgunluk/hava etkisini ve ulaşılan ${targetCell.terrainLabel.toLowerCase()} ortamının önceki yerden farkını kısa ve net anlat.`,
      forbiddenHints: [],
    });
    applySleepCollapseOrFatigueNotice(state, true);

    return {
      moved: true,
      direction: nb.direction,
      hoursSpent: adjustedHours,
      newTerrain: targetCell.terrainLabel,
      enteredSettlement: locInside?.name ?? null,
      unitsHere: newUnitsHere.map((u) =>
        isUnitOriginKnown(u, state.locations, locInside)
          ? u.name
          : getGenericUnitRoleLabel(u)
      ),
      summary: fact,
    };
  }

  if (toolName === 'travel_to_settlement') {
    const query = normalizeTr(String(args.settlementName ?? ''));
    const target = state.locations.find(
      (l) =>
        (l.discovered || l.id === currentLocation?.id) &&
        (normalizeTr(l.name).includes(query) ||
          query.includes(normalizeTr(l.name.split(' ')[0])))
    );
    if (!target) {
      const available = state.locations
        .filter((l) => l.discovered)
        .map((l) => l.name)
        .join(', ');
      const fact = `"${String(args.settlementName ?? '')}" adında bilinen veya ulaşılabilir bir yerleşim yok.${
        available ? ` Bilinen yerleşimler: ${available}.` : ' Yakında henüz keşfedilmiş yerleşim bulunmuyor.'
      }`;
      state.engineFacts.push(fact);
      return { moved: false, reason: fact };
    }

    const fromCellId = currentMazgal.id;
    const toCellSummary = getCellForCoords(target.x, target.y);
    let baseHours = 8;
    let hasDirectRoute = false;
    let requiresBoat = false;
    const pathPlan = findShortestMazgalPath(fromCellId, toCellSummary.id, state.mazgalCells);
    if (fromCellId === toCellSummary.id) {
      baseHours = Math.max(
        2,
        Math.round(Math.hypot(target.x - state.protagonist.x, target.y - state.protagonist.y) * 1.5)
      );
    } else {
      const directRoute = currentLocation
        ? state.routes.find(
            (r) =>
              (r.fromId === currentLocation.id && r.toId === target.id) ||
              (r.toId === currentLocation.id && r.fromId === target.id)
          )
        : undefined;
      if (directRoute) {
        baseHours = directRoute.travelHours;
        hasDirectRoute = true;
      } else {
        baseHours = pathPlan.hours;
        requiresBoat = pathPlan.requiresBoat;
      }
    }

    const targetCell = state.mazgalCells.find((c) => c.id === toCellSummary.id) ?? currentMazgal;
    const requestedPace =
      args.pace === 'stealth' || args.pace === 'forced'
        ? (args.pace as TravelPace)
        : undefined;
    const pace = resolveAutomaticTravelPace(
      state.protagonist,
      targetCell,
      state.activeWeatherKey,
      requestedPace
    );
    const transport = resolveAutomaticTravelTransport(
      state.protagonist,
      targetCell,
      requiresBoat,
      hasDirectRoute
    );

    const adjustedHours = computeTravelHours(
      baseHours,
      pace,
      transport,
      state.activeWeatherKey,
      hasDirectRoute,
      requiresBoat
    );
    const prevMs = state.gameTimeMs;
    const nextMs = addGameHours(prevMs, adjustedHours);

    const { nextProtagonist, localMoraleDelta } = applyProtagonistTravel(
      state.protagonist,
      target,
      targetCell,
      adjustedHours,
      nextMs,
      {
        pace,
        transport,
        weather: state.activeWeatherKey,
        requiresBoat,
        extraVisitedMazgalIds: pathPlan.pathIds,
      }
    );
    state.protagonist = nextProtagonist;
    state.partyLocationId = target.id;
    const pathSet = new Set(pathPlan.pathIds);
    state.locations = state.locations.map((loc) => {
      const locCellId = getCellForCoords(loc.x, loc.y).id;
      if (loc.id === target.id) {
        return applyExternalMoraleShift({ ...loc, discovered: true }, localMoraleDelta, nextMs);
      }
      if (pathSet.has(locCellId)) {
        return { ...loc, discovered: true };
      }
      return loc;
    });

    const notices = advanceWorldStateInTurn(state, prevMs, nextMs, target, targetCell, true);
    state.hoursSpentTotal += adjustedHours;
    state.movedThisTurn = true;
    state.lastTimeAction = `${target.name} Yolculuğu (+${formatTravelHours(adjustedHours)})`;
    state.journeyEntries.push({
      id: `log-ai-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      locationId: target.id,
      locationName: target.name,
      timestamp: formatGameDateTime(nextMs),
      note: `${target.name} bölgesine ${formatTravelHours(adjustedHours)} yürüyüşle ulaşıldı.`,
    });

    const fact = `${target.name} yerleşimine ${formatTravelHours(adjustedHours)} yolculukla ulaşıldı. Yerleşim ruh hali: ${
      target.livingState?.mood ?? 'Olağan'
    }. Can: ${state.protagonist.health}/100, Zindelik: ${state.protagonist.stamina}/100.${
      notices.length > 0 ? ` Yol olayı: ${notices.join(' ')}` : ''
    }`;
    state.engineFacts.push(fact);
    state.actionRecords.push({
      category: 'travel',
      subType: 'move_settlement',
      summary: fact,
      outcomeTone: 'success',
      durationLabel: formatTravelHours(adjustedHours),
      movedToLabel: target.name,
      discoveredPlaceName: target.name,
      focusDirective: `${target.name} yerleşimine varışı, geçen süreyi ve yerleşim havasını/yol olayını kısaca aktar.`,
      forbiddenHints: [],
    });
    applySleepCollapseOrFatigueNotice(state, true);
    return { moved: true, settlement: target.name, hoursSpent: adjustedHours, summary: fact };
  }

  if (toolName === 'interact_npc_or_group') {
    const targetName = normalizeTr(String(args.targetName ?? ''));
    const tone = String(args.tone ?? 'talk');
    const defaultMinutes =
      tone === 'escort_aid'
        ? 45
        : tone === 'flirt_or_romance' || tone === 'seduce_or_charm' || tone === 'confront_or_test'
        ? 15
        : tone === 'greet_trade'
        ? 10
        : 3;
    const durationMinutes =
      typeof args.durationMinutes === 'number' && Number.isFinite(args.durationMinutes)
        ? Math.max(1, Math.min(120, Math.round(args.durationMinutes)))
        : defaultMinutes;
    const elapsedHours = durationMinutes / 60;

    const contactsHere = (state.protagonist.contacts ?? []).filter(
      (c) =>
        c.partyRelation !== 'independent' ||
        (currentLocation
          ? c.currentLocationId === currentLocation.id
          : c.currentMazgalId === currentMazgal.id)
    );
    const unitsHere = (state.protagonist.roamingUnits ?? []).filter(
      (u) => u.mazgalId === currentMazgal.id
    );

    const matchedUnit = targetName
      ? unitsHere.find((u) => normalizeTr(u.name).includes(targetName)) ??
        (unitsHere.length > 0 &&
        [
          'kervan',
          'devriye',
          'gozcu',
          'yagmaci',
          'akinci',
          'goblin',
          'grup',
          'golge',
          'silahli',
          'kararti',
        ].some((kw) => targetName.includes(kw))
          ? unitsHere[0]
          : undefined)
      : !currentLocation && contactsHere.length === 0
      ? unitsHere[0]
      : undefined;

    if (matchedUnit) {
      const mode = tone === 'escort_aid' ? 'escort_aid' : 'greet_trade';
      const prevMs = state.gameTimeMs;
      const nextMs = addGameMinutes(prevMs, durationMinutes);
      const res = interactWithRoamingUnit(
        state.protagonist,
        matchedUnit.id,
        mode,
        currentMazgal,
        nextMs
      );
      state.protagonist = res.nextProtagonist;
      const notices = advanceWorldStateInTurn(
        state,
        prevMs,
        nextMs,
        currentLocation,
        currentMazgal
      );
      state.hoursSpentTotal += elapsedHours;
      state.rolledDiceThisTurn = true;
      state.lastTimeAction = `Sohbet (+${formatTravelHours(elapsedHours)})${
        notices.length > 0 ? ` · ${notices[0]}` : ''
      }`;
      const unitKnown = isUnitOriginKnown(matchedUnit, state.locations, currentLocation);
      const unitSpeaker = unitKnown
        ? matchedUnit.name
        : matchedUnit.kind === 'raider'
        ? 'Silahlı Akıncı'
        : matchedUnit.kind === 'caravan'
        ? 'Kervanbaşı'
        : 'Devriye Lideri';
      state.preferredRole = 'dialogue';
      state.preferredSpeaker = unitSpeaker;
      const safeMessage = maskUndiscoveredLocationNames(
        res.message,
        state.locations,
        currentLocation
      );
      const fact = `${unitSpeaker} ile etkileşim (+${formatTravelHours(elapsedHours)}): ${safeMessage}${
        notices.length > 0 ? ` ${notices[0]}` : ''
      }`;
      state.engineFacts.push(fact);
      state.actionRecords.push({
        category: 'social',
        subType: 'roaming_chat',
        summary: fact,
        outcomeTone: 'neutral',
        durationLabel: formatTravelHours(elapsedHours),
        speakerName: unitSpeaker,
        speakerRole: 'dialogue',
        focusDirective: `${unitSpeaker} ağzından doğrudan, duruma uygun kısa bir diyalog yanıtı ver.`,
        forbiddenHints: [],
      });
      applySleepCollapseOrFatigueNotice(state, false);
      return { interacted: true, target: unitSpeaker, summary: fact };
    }

    const matchedContact =
      (targetName
        ? contactsHere.find((c) => normalizeTr(c.name).includes(targetName))
        : undefined) ?? contactsHere[0];

    if (matchedContact) {
      const npcAction: NpcInteractionType =
        tone === 'flirt_or_romance' ||
        tone === 'seduce_or_charm' ||
        tone === 'confront_or_test'
          ? tone
          : 'talk';
      const prevMs = state.gameTimeMs;
      const candidateMs = addGameMinutes(prevMs, durationMinutes);
      const res = interactWithLivingNpc(
        state.protagonist,
        matchedContact.id,
        npcAction,
        currentLocation,
        currentMazgal,
        candidateMs,
        mods,
        state.routes,
        state.locations
      );
      const actualHours = res.hoursSpent > 0 ? elapsedHours : 0;
      const nextMs = actualHours > 0 ? candidateMs : prevMs;
      state.protagonist = res.nextProtagonist;
      if (currentLocation && (res.locationMoraleDelta || res.locationNoteDetail)) {
        state.locations = state.locations.map((loc) =>
          loc.id === currentLocation.id
            ? applyExternalMoraleShift(
                loc,
                res.locationMoraleDelta ?? 0,
                nextMs,
                res.locationNoteTitle,
                res.locationNoteDetail
              )
            : loc
        );
      }
      const notices =
        actualHours > 0
          ? advanceWorldStateInTurn(
              state,
              prevMs,
              nextMs,
              currentLocation,
              currentMazgal
            )
          : [];
      state.hoursSpentTotal += actualHours;
      state.rolledDiceThisTurn = true;
      if (actualHours > 0) {
        state.lastTimeAction = `Sohbet (+${formatTravelHours(actualHours)})${
          notices.length > 0 ? ` · ${notices[0]}` : ''
        }`;
      }
      state.preferredRole = 'dialogue';
      state.preferredSpeaker = `${matchedContact.name} (${matchedContact.role})`;
      const fact = `${matchedContact.name} ile görüşme (${npcAction}${
        actualHours > 0 ? `, +${formatTravelHours(actualHours)}` : ''
      }): ${res.feedbackText}${notices.length > 0 ? ` ${notices[0]}` : ''}`;
      state.engineFacts.push(fact);
      state.actionRecords.push({
        category: 'social',
        subType: 'npc_chat',
        summary: fact,
        outcomeTone: 'neutral',
        durationLabel: actualHours > 0 ? formatTravelHours(actualHours) : undefined,
        speakerName: state.preferredSpeaker,
        speakerRole: 'dialogue',
        focusDirective: `${matchedContact.name} karakterinin güven/ruh haline uygun doğrudan ve kısa cevabını yaz.`,
        forbiddenHints: [],
      });
      if (actualHours > 0) {
        applySleepCollapseOrFatigueNotice(state, false);
      }
      return { interacted: true, target: matchedContact.name, summary: fact };
    }

    if (currentLocation && living) {
      const prevMs = state.gameTimeMs;
      const nextMs = addGameMinutes(prevMs, durationMinutes);
      const outcome = performProtagonistAction(
        state.protagonist,
        'converse',
        currentLocation,
        currentMazgal,
        nextMs,
        durationMinutes
      );
      state.protagonist = outcome.nextProtagonist;
      if (outcome.locationMoraleDelta !== 0 || outcome.locationEventNote) {
        state.locations = state.locations.map((loc) =>
          loc.id === currentLocation.id
            ? applyExternalMoraleShift(
                loc,
                outcome.locationMoraleDelta,
                nextMs,
                `${state.protagonist.name} Sohbeti`,
                outcome.locationEventNote
              )
            : loc
        );
      }
      const notices = advanceWorldStateInTurn(
        state,
        prevMs,
        nextMs,
        currentLocation,
        currentMazgal
      );
      state.hoursSpentTotal += elapsedHours;
      state.lastTimeAction = `Konuş (+${formatTravelHours(elapsedHours)})${
        notices.length > 0 ? ` · ${notices[0]}` : ''
      }`;
      const resident =
        (targetName
          ? living.notableResidents.find((r) => normalizeTr(r.name).includes(targetName))
          : undefined) ?? living.notableResidents[0];
      const speakerName = resident
        ? `${resident.name} (${resident.role})`
        : `${currentLocation.name} Sakini`;
      state.preferredRole = 'dialogue';
      state.preferredSpeaker = speakerName;
      const safeRumors = living.rumors[0]
        ? maskUndiscoveredLocationNames(living.rumors[0], state.locations, currentLocation)
        : '';
      const safeProb = living.activeProblems[0]
        ? maskUndiscoveredLocationNames(
            living.activeProblems[0].title,
            state.locations,
            currentLocation
          )
        : '';
      const fact = `${speakerName} ile konuşuldu (+${formatTravelHours(elapsedHours)}): ${maskUndiscoveredLocationNames(
        outcome.nextProtagonist.lastDialogue,
        state.locations,
        currentLocation
      )}${
        safeRumors ? ` Söylenti: "${safeRumors}".` : ''
      }${
        safeProb ? ` Yerel sorun: ${safeProb}.` : ''
      }${notices.length > 0 ? ` ${notices[0]}` : ''}`;
      state.engineFacts.push(fact);
      state.actionRecords.push({
        category: 'social',
        subType: 'resident_chat',
        summary: fact,
        outcomeTone: 'neutral',
        durationLabel: formatTravelHours(elapsedHours),
        speakerName,
        speakerRole: 'dialogue',
        focusDirective: `${speakerName} ağzından doğrudan kısa diyalog ve varsa yerel bilgiyi ver.`,
        forbiddenHints: [],
      });
      applySleepCollapseOrFatigueNotice(state, false);
      return { interacted: true, target: speakerName, summary: fact };
    }

    const fact = 'Çevrede konuşabilecek hiçbir kişi, yoldaş veya gezgin grup yok; Eşref açık doğada yalnız.';
    state.engineFacts.push(fact);
    state.actionRecords.push({
      category: 'social',
      subType: 'nobody',
      summary: fact,
      outcomeTone: 'fail',
      focusDirective: 'Çevrede konuşacak kimsenin olmadığını net söyle; hayali bir kişi uydurma.',
      forbiddenHints: [],
    });
    return { interacted: false, nobodyPresent: true, summary: fact };
  }

  if (toolName === 'combat_or_shadow_action') {
    const intent = String(args.intent ?? 'skirmish');
    const unitsHere = (state.protagonist.roamingUnits ?? []).filter(
      (u) => u.mazgalId === currentMazgal.id
    );

    if (intent === 'ambush_group' && unitsHere.length > 0) {
      const unit = unitsHere.find((u) => u.kind === 'raider') ?? unitsHere[0];
      const prevMs = state.gameTimeMs;
      const nextMs = addGameHours(prevMs, 1);
      const res = interactWithRoamingUnit(
        state.protagonist,
        unit.id,
        'ambush_raid',
        currentMazgal,
        nextMs
      );
      state.protagonist = res.nextProtagonist;
      const notices = advanceWorldStateInTurn(
        state,
        prevMs,
        nextMs,
        currentLocation,
        currentMazgal
      );
      state.hoursSpentTotal += 1;
      state.rolledDiceThisTurn = true;
      const unitLabel = isUnitOriginKnown(unit, state.locations, currentLocation)
        ? unit.name
        : getGenericUnitRoleLabel(unit);
      const safeMsg = maskUndiscoveredLocationNames(
        res.message,
        state.locations,
        currentLocation
      );
      const fact = `${unitLabel} grubuna pusu: ${safeMsg}${
        notices.length > 0 ? ` ${notices[0]}` : ''
      }`;
      state.engineFacts.push(fact);
      state.actionRecords.push({
        category: 'combat',
        subType: 'ambush_group',
        summary: fact,
        outcomeTone: 'neutral',
        durationLabel: '1 Saat',
        focusDirective: 'Pusu hamlesinin sonucunu, zar etkisini ve alınan/verilen hasarı net ve somut yaz.',
        forbiddenHints: [],
      });
      applySleepCollapseOrFatigueNotice(state, false);
      return { ok: true, summary: fact };
    }

    if (
      intent === 'steal_supplies' ||
      intent === 'extort' ||
      intent === 'capture_captive'
    ) {
      const shadowKind =
        intent === 'capture_captive'
          ? 'capture_captive'
          : intent === 'extort'
          ? 'extort_locals'
          : 'raid_supply';
      const prevMs = state.gameTimeMs;
      const nextMs = addGameHours(prevMs, 2);
      const res = performShadowAction(
        state.protagonist,
        shadowKind,
        currentLocation,
        currentMazgal,
        nextMs,
        mods
      );
      state.protagonist = res.nextProtagonist;
      if (currentLocation && (res.locationMoraleDelta !== 0 || res.locationNoteDetail)) {
        state.locations = state.locations.map((loc) =>
          loc.id === currentLocation.id
            ? applyExternalMoraleShift(
                loc,
                res.locationMoraleDelta,
                nextMs,
                res.locationNoteTitle,
                res.locationNoteDetail
              )
            : loc
        );
      }
      const notices = advanceWorldStateInTurn(
        state,
        prevMs,
        nextMs,
        currentLocation,
        currentMazgal
      );
      state.hoursSpentTotal += 2;
      state.rolledDiceThisTurn = true;
      const fact = `${res.feedbackText}${notices.length > 0 ? ` ${notices[0]}` : ''}`;
      state.engineFacts.push(fact);
      state.actionRecords.push({
        category: 'combat',
        subType: intent,
        summary: fact,
        outcomeTone: 'neutral',
        durationLabel: '2 Saat',
        focusDirective: 'Gölge eyleminin sonucunu ve varsa ganimet/itibar etkisini doğrudan anlat.',
        forbiddenHints: [],
      });
      applySleepCollapseOrFatigueNotice(state, false);
      return { ok: true, summary: fact };
    }

    const prevMs = state.gameTimeMs;
    const nextMs = addGameHours(prevMs, 1);
    const roll = rollDie(20);
    const total = roll + mods.physicalMod;
    const dc = 10 + currentMazgal.dangerLevel;
    const won = total >= dc;
    const dmg = won ? (roll >= 15 ? 0 : 6) : 14;
    const loot = won ? 2 + currentMazgal.dangerLevel : 0;

    state.protagonist = {
      ...state.protagonist,
      health: Math.max(10, state.protagonist.health - dmg),
      stamina: Math.max(5, state.protagonist.stamina - 14),
      silver: state.protagonist.silver + loot,
      lastUpdatedMs: nextMs,
    };
    const notices = advanceWorldStateInTurn(
      state,
      prevMs,
      nextMs,
      currentLocation,
      currentMazgal
    );
    state.hoursSpentTotal += 1;
    state.rolledDiceThisTurn = true;

    const modStr = mods.physicalMod >= 0 ? `+${mods.physicalMod}` : `${mods.physicalMod}`;
    const fact = won
      ? `Fiziksel güç ve çatışma testi başarılı (${roll}${modStr}=${total} vs DC ${dc}).${
          dmg > 0 ? ` ${dmg} can sıyrığı alındı.` : ' Yara alınmadı.'
        } ${loot} gümüş değerinde ganimet elde edildi.${notices.length > 0 ? ` ${notices[0]}` : ''}`
      : `Fiziksel hamle başarısız (${roll}${modStr}=${total} vs DC ${dc}). ${dmg} can ve 14 zindelik kaybedildi.${
          notices.length > 0 ? ` ${notices[0]}` : ''
        }`;
    state.engineFacts.push(fact);
    state.actionRecords.push({
      category: 'combat',
      subType: 'skirmish',
      summary: fact,
      outcomeTone: won ? 'success' : 'fail',
      durationLabel: '1 Saat',
      focusDirective: 'Çatışma/güç hamlesinin sonucunu, yara/zindelik durumunu kısa ve net yaz.',
      forbiddenHints: [],
    });
    applySleepCollapseOrFatigueNotice(state, false);
    return { won, roll: total, dc, damage: dmg, loot, summary: fact };
  }

  if (toolName === 'use_inventory_or_eat') {
    const item = String(args.item ?? 'rations');
    if (item === 'rations') {
      if (state.protagonist.rations <= 0) {
        const fact = 'Çantada hiç kuru erzak kalmamış; açlık yatıştırılamadı.';
        state.engineFacts.push(fact);
        return { used: false, summary: fact };
      }
      state.protagonist = {
        ...state.protagonist,
        rations: state.protagonist.rations - 1,
        hunger: Math.max(0, state.protagonist.hunger - 45),
        stamina: Math.min(100, state.protagonist.stamina + 8),
        lastObservation: '1 porsiyon kuru erzak tüketildi; açlık yatıştı.',
      };
      const fact = `1 porsiyon kuru erzak yendi (Kalan: ${state.protagonist.rations}). Açlık: ${state.protagonist.hunger}/100, Zindelik: ${state.protagonist.stamina}/100.`;
      state.engineFacts.push(fact);
      state.actionRecords.push({
        category: 'survival',
        subType: 'rations',
        summary: fact,
        outcomeTone: 'success',
        focusDirective: 'Kuru erzağın yenmesini ve açlık/zindelik etkisini 1 net cümlede anlat.',
        forbiddenHints: [],
      });
      return { used: true, summary: fact };
    }

    const invId =
      item === 'healing_herb' || item === 'antidote_vial' || item === 'torch_bundle'
        ? item
        : 'healing_herb';
    const res = useInventoryItem(state.protagonist, invId, state.gameTimeMs);
    state.protagonist = res.nextProtagonist;
    state.engineFacts.push(res.message);
    state.actionRecords.push({
      category: 'survival',
      subType: invId,
      summary: res.message,
      outcomeTone: 'neutral',
      focusDirective: 'Eşyanın kullanımını ve anlık etkisini 1–2 net cümlede anlat.',
      forbiddenHints: [],
    });
    return { used: true, summary: res.message };
  }

  if (toolName === 'camp_forage_or_aid') {
    const activity = String(args.activity ?? 'rest_camp');
    if (
      activity === 'help_settlement_problem' &&
      currentLocation &&
      living &&
      living.activeProblems.length > 0
    ) {
      const hint = normalizeTr(String(args.problemHint ?? ''));
      const prob =
        (hint
          ? living.activeProblems.find((p) => normalizeTr(p.title).includes(hint))
          : undefined) ?? living.activeProblems[0];
      const prevMs = state.gameTimeMs;
      const nextMs = addGameHours(prevMs, 3);
      const attempt = resolveSettlementProblemAttempt(
        state.protagonist,
        currentLocation,
        prob.id,
        currentMazgal,
        nextMs
      );
      state.protagonist = attempt.nextProtagonist;
      state.locations = state.locations.map((loc) => {
        if (loc.id !== currentLocation.id) return loc;
        if (attempt.solved) return resolveSettlementProblemByParty(loc, prob.id, nextMs);
        if (!loc.livingState) return loc;
        return {
          ...loc,
          livingState: {
            ...loc.livingState,
            activeProblems: loc.livingState.activeProblems.map((p) =>
              p.id === prob.id ? { ...p, attempts: p.attempts + 1 } : p
            ),
          },
        };
      });
      const notices = advanceWorldStateInTurn(
        state,
        prevMs,
        nextMs,
        currentLocation,
        currentMazgal
      );
      state.hoursSpentTotal += 3;
      state.rolledDiceThisTurn = true;
      state.lastTimeAction = `Yerleşime Destek (+3 Saat)${notices.length > 0 ? ` · ${notices[0]}` : ''}`;
      const fact = `${attempt.message}${notices.length > 0 ? ` ${notices[0]}` : ''}`;
      state.engineFacts.push(fact);
      state.actionRecords.push({
        category: 'survival',
        subType: 'help_settlement_problem',
        summary: fact,
        outcomeTone: attempt.solved ? 'success' : 'fail',
        durationLabel: '3 Saat',
        focusDirective: 'Yerleşim sorununa yapılan müdahalenin sonucunu net anlat.',
        forbiddenHints: [],
      });
      applySleepCollapseOrFatigueNotice(state, false);
      return { solved: attempt.solved, summary: fact };
    }

    const actType =
      activity === 'forage_or_work'
        ? 'forage_or_work'
        : activity === 'help_settlement' || activity === 'help_settlement_problem'
        ? 'help_settlement'
        : 'rest_camp';
    const hours = ACTION_HOURS[actType];
    const prevMs = state.gameTimeMs;
    const nextMs = addGameHours(prevMs, hours);
    const outcome = performProtagonistAction(
      state.protagonist,
      actType,
      currentLocation,
      currentMazgal,
      nextMs
    );
    state.protagonist = outcome.nextProtagonist;
    if (currentLocation && (outcome.locationMoraleDelta !== 0 || outcome.locationEventNote)) {
      state.locations = state.locations.map((loc) =>
        loc.id === currentLocation.id
          ? applyExternalMoraleShift(
              loc,
              outcome.locationMoraleDelta,
              nextMs,
              actType === 'rest_camp'
                ? 'Kamp ve Dinlenme'
                : actType === 'help_settlement'
                ? 'Yerleşime Destek'
                : 'İş ve Av',
              outcome.locationEventNote
            )
          : loc
      );
    }
    const notices = advanceWorldStateInTurn(
      state,
      prevMs,
      nextMs,
      currentLocation,
      currentMazgal
    );
    state.hoursSpentTotal += hours;
    const actionLabel =
      actType === 'rest_camp'
        ? 'Kamp Kur'
        : actType === 'help_settlement'
        ? 'Destek Ol'
        : 'İş ve Av';
    state.lastTimeAction = `${actionLabel} (+${hours} Saat)${
      notices.length > 0 ? ` · ${notices[0]}` : ''
    }`;
    const fact = `${outcome.nextProtagonist.lastObservation} (+${hours} saat)${
      notices.length > 0 ? ` ${notices[0]}` : ''
    }`;
    state.engineFacts.push(fact);
    state.actionRecords.push({
      category: 'survival',
      subType: actType,
      summary: fact,
      outcomeTone: 'success',
      durationLabel: `${hours} Saat`,
      focusDirective:
        actType === 'rest_camp'
          ? 'Kamp ve uyku sonrası dinlenmeyi ve yeni gün/saat hissini kısaca anlat.'
          : 'Etkinliğin sonucunu ve geçen süreyi 1–2 net cümlede anlat.',
      forbiddenHints: [],
    });
    if (actType !== 'rest_camp') {
      applySleepCollapseOrFatigueNotice(state, false);
    }
    return { ok: true, hoursSpent: hours, summary: fact };
  }

  // free_roleplay_action
  const effort = String(args.physicalEffort ?? 'none');
  const totalMinutes =
    typeof args.minutesSpent === 'number' && Number.isFinite(args.minutesSpent)
      ? Math.max(0, Math.min(720, Math.round(args.minutesSpent)))
      : typeof args.hoursSpent === 'number' && Number.isFinite(args.hoursSpent)
      ? Math.max(0, Math.min(12, args.hoursSpent)) * 60
      : args.advanceOneHour === true
      ? 60
      : args.advanceOneHour === false
      ? 0
      : effort !== 'none'
      ? 15
      : 1;
  const elapsedHours = totalMinutes / 60;
  const summary = String(args.summary ?? 'Eşref çevresine uygun serbest bir eylem gerçekleştirdi.');

  // Artık hiçbir serbest eylem "bedava" değil: eylemin sınıfına göre ilgili
  // metrik, çevre ve yaklaşım etkenleriyle zar atılır ve sonuç motor gerçeğidir.
  const riskCategory = inferRiskCategory(normalizeTr(summary));
  const risk = resolveActionRisk(buildActionRiskInput(state, riskCategory, summary));
  const trivial = effort === 'none' && totalMinutes <= 5;
  const staminaCost = trivial ? Math.min(1, risk.staminaLoss) : risk.staminaLoss;
  const riskConditions = [...(state.protagonist.activeConditions ?? [])];
  if (risk.condition && !riskConditions.includes(risk.condition)) {
    riskConditions.push(risk.condition);
  }
  state.protagonist = {
    ...state.protagonist,
    health: Math.max(5, state.protagonist.health - risk.healthLoss),
    stamina: Math.max(5, state.protagonist.stamina - staminaCost),
    activeConditions: riskConditions.slice(0, 4),
    lastObservation: summary,
  };
  state.rolledDiceThisTurn = true;
  const freeRiskRecord = riskSceneRecord(risk);

  if (totalMinutes > 0) {
    const prevMs = state.gameTimeMs;
    const nextMs = addGameMinutes(prevMs, totalMinutes);
    const isSleepAction =
      totalMinutes >= 180 && /uyu|uyku|dinlen|kestir|şekerleme/i.test(summary);
    if (isSleepAction) {
      const sleptRecover = Math.min(55, Math.max(15, Math.round(totalMinutes / 9)));
      state.protagonist = {
        ...state.protagonist,
        stamina: Math.min(100, state.protagonist.stamina + sleptRecover),
        lastSleptMs: nextMs,
        lastUpdatedMs: nextMs,
        activeConditions: (state.protagonist.activeConditions ?? []).filter(
          (c) => !/Uykusuzluk|Yorgunluk|Bitkin/i.test(c)
        ),
      };
    }
    const notices = advanceWorldStateInTurn(
      state,
      prevMs,
      nextMs,
      currentLocation,
      currentMazgal
    );
    state.hoursSpentTotal += elapsedHours;
    const durationLabel = formatTravelHours(elapsedHours);
    state.lastTimeAction = `Anlatı Eylemi (+${durationLabel})${
      notices.length > 0 ? ` · ${notices[0]}` : ''
    }`;
    const fact = `${summary} (+${durationLabel}${
      isSleepAction
        ? ', uyuyup dinlenildi'
        : staminaCost > 0
        ? `, -${staminaCost} Zindelik`
        : ''
    }). ${risk.fact}${notices.length > 0 ? ` ${notices[0]}` : ''}`;
    state.engineFacts.push(fact);
    state.actionRecords.push({
      category: freeRiskRecord.category,
      subType: freeRiskRecord.subType,
      summary: fact,
      outcomeTone: freeRiskRecord.outcomeTone,
      durationLabel,
      focusDirective: `${risk.focusDirective} Serbest eylemin doğrudan sonucunu tekrar yapmadan 1–2 net cümlede anlat.`,
      forbiddenHints: risk.healthLoss > 0
        ? ['Yaralanma/bedel sonucunu gizleme veya başarı gibi anlatma.', 'Can ve zindelik sayılarını birebir aktar.']
        : [],
    });
    if (!isSleepAction) {
      applySleepCollapseOrFatigueNotice(state, false);
    }
    return { ok: true, minutesSpent: totalMinutes, hoursSpent: elapsedHours, summary: fact };
  }

  const zeroFact = `${summary} ${risk.fact}`;
  state.engineFacts.push(zeroFact);
  state.actionRecords.push({
    category: freeRiskRecord.category,
    subType: freeRiskRecord.subType,
    summary: zeroFact,
    outcomeTone: freeRiskRecord.outcomeTone,
    focusDirective: `${risk.focusDirective} Serbest eylemin doğrudan karşılığını kısa ve net anlat.`,
    forbiddenHints: risk.healthLoss > 0
      ? ['Yaralanma/bedel sonucunu gizleme veya başarı gibi anlatma.', 'Can ve zindelik sayılarını birebir aktar.']
      : [],
  });
  return { ok: true, minutesSpent: 0, hoursSpent: 0, summary: zeroFact };
}

export interface AiTurnExecutionResult {
  appendedMessages: NarrativeMessage[];
  nextProtagonist: ProtagonistState;
  nextLocations: MapLocation[];
  nextWeatherKey: WeatherConditionKey;
  nextGameTimeMs: number;
  nextPartyLocationId: string;
  journeyEntries: JourneyLogEntry[];
  lastTimeAction?: string;
  movedThisTurn: boolean;
  rolledDiceThisTurn: boolean;
}

/**
 * Oyuncu uzun bir süre ilan ettiyse motorun gerçekleştirdiği ilk adımın
 * dışında kalan zamanı da ilerletir; aksi hâlde "1 gün yürü" 5 dakikada kalıyordu.
 */
function applyRequestedDurationIfNeeded(rawText: string, state: NarrativeWorkingState): boolean {
  const requested = parseRequestedDurationMinutes(rawText);
  if (requested < 60) return false;
  const actualMinutes = Math.round(state.hoursSpentTotal * 60);
  const remaining = Math.min(1440, requested) - actualMinutes;
  if (remaining < 30) return false;

  const { currentLocation, currentMazgal } = getCurrentContext(state);
  const prevMs = state.gameTimeMs;
  const nextMs = addGameMinutes(prevMs, remaining);
  const notices = advanceWorldStateInTurn(
    state,
    prevMs,
    nextMs,
    currentLocation,
    currentMazgal
  );
  state.gameTimeMs = nextMs;
  state.hoursSpentTotal += remaining / 60;
  const durationLabel = formatTravelHours(remaining / 60);
  state.lastTimeAction = `İlan edilen süre (+${durationLabel})${
    notices.length > 0 ? ` · ${notices[0]}` : ''
  }`;
  const fact = `Oyuncunun ilan ettiği toplam süre ${formatTravelHours(requested / 60)}; ilk adım sonrası kalan ${durationLabel} boyunca dünya ilerledi.${
    notices.length > 0 ? ` ${notices[0]}` : ''
  }`;
  state.engineFacts.push(fact);
  state.actionRecords.push({
    category: 'free_roleplay',
    subType: 'declared_duration',
    summary: fact,
    outcomeTone: 'neutral',
    durationLabel,
    focusDirective: 'Oyuncunun ilan ettiği uzun süreyi ve dünyanın bu sürede ilerlediğini net ve kısa söyle; text içinde saat/mesafe uydurma.',
    forbiddenHints: ['Kısa bir yürüyüş veya "birkaç adım" denmez.'],
  });
  return true;
}

function runHeuristicEngineTurn(
  rawText: string,
  chosenOption: NarrativeChoice | undefined,
  state: NarrativeWorkingState
): void {
  const norm = normalizeTr(rawText);
  const { currentLocation } = getCurrentContext(state);
  const forceObserve = chosenOption?.kind === 'observe';
  const pace: TravelPace = /\b(gizli\w*|sessiz\w*|temkin\w*|usulca|sokularak)\b/.test(norm)
    ? 'stealth'
    : /\b(hizli\w*|kos\w*|acele\w*|depar\w*)\b/.test(norm)
    ? 'forced'
    : 'normal';

  // 1. Bilinen yerleşime veya yöne seyahat
  const hasTravelVerb =
    /\b(yola cik\w*|git\b|gid\w*|yuru\w*|ilerl\w*|istikamet\w*|geri don\w*|donuyorum|donelim)\b/.test(norm) ||
    chosenOption?.kind === 'travel';

  if (!forceObserve && hasTravelVerb) {
    const namedLoc = state.locations.find(
      (l) =>
        l.discovered &&
        l.id !== currentLocation?.id &&
        (norm.includes(normalizeTr(l.name)) || norm.includes(normalizeTr(l.name.split(' ')[0])))
    );
    if (namedLoc) {
      executeNarrativeToolCall(
        'travel_to_settlement',
        { settlementName: namedLoc.name, pace },
        state
      );
      return;
    }

    const dirPatterns: Array<{ re: RegExp; dir: string }> = [
      { re: /kuzey\s*bati/, dir: 'Kuzeybatı' },
      { re: /kuzey\s*dogu/, dir: 'Kuzeydoğu' },
      { re: /guney\s*bati/, dir: 'Güneybatı' },
      { re: /guney\s*dogu/, dir: 'Güneydoğu' },
      { re: /\bkuzey/, dir: 'Kuzey' },
      { re: /\bguney/, dir: 'Güney' },
      { re: /\bdogu/, dir: 'Doğu' },
      { re: /\bbati/, dir: 'Batı' },
    ];
    for (const d of dirPatterns) {
      if (d.re.test(norm)) {
        executeNarrativeToolCall('travel_direction', { direction: d.dir, pace }, state);
        return;
      }
    }
  }

  // 2. Envanter kullanımı
  if (/\b(erzak\w*|peksimet\w*|yemek ye\w*|karnimi doyur\w*)\b/.test(norm)) {
    executeNarrativeToolCall('use_inventory_or_eat', { item: 'rations' }, state);
    return;
  }
  if (/\b(kekik\w*|sargi\w*|yara sar\w*|sifa\w*)\b/.test(norm)) {
    executeNarrativeToolCall('use_inventory_or_eat', { item: 'healing_herb' }, state);
    return;
  }
  if (/\b(panzehir\w*|zehir\w*)\b/.test(norm)) {
    executeNarrativeToolCall('use_inventory_or_eat', { item: 'antidote_vial' }, state);
    return;
  }
  if (/\b(mesale\w*|isik yak\w*)\b/.test(norm)) {
    executeNarrativeToolCall('use_inventory_or_eat', { item: 'torch_bundle' }, state);
    return;
  }

  // 3. Kamp / Dinlenme / Av / Yardım
  if (/\b(kamp\w*|uyu\w*|dinlen\w*|gecele\w*|yat\w*)\b/.test(norm)) {
    executeNarrativeToolCall('camp_forage_or_aid', { activity: 'rest_camp' }, state);
    return;
  }
  // NOT: "calis" asla tek başına tetikleyici değil — "denemek/çalışıyorum" ile
  // "iş yapmak" aynı kökten geliyor; "Ağaçtan inmeye çalışıyorsun" 3 saatlik
  // toplama eylemine dönüşüyordu. Nesneli kalıplar yeterli.
  if (hasForageIntent(norm)) {
    executeNarrativeToolCall('camp_forage_or_aid', { activity: 'forage_or_work' }, state);
    return;
  }
  if (
    currentLocation &&
    /\b(sorun\w*|mesele\w*|yardim\w*|destek\w*|mudahale\w*)\b/.test(norm)
  ) {
    executeNarrativeToolCall('camp_forage_or_aid', { activity: 'help_settlement_problem' }, state);
    return;
  }

  // 4. Çatışma / Gölge eylemleri
  if (/\b(pusu\w*|saldir\w*|vur\w*|kilic\w*|hancer\w*|oldur\w*|baskin\w*)\b/.test(norm)) {
    executeNarrativeToolCall('combat_or_shadow_action', { intent: 'ambush_group' }, state);
    return;
  }
  // "cal(?!is)": çal/çalmak (steal) değil, calis/çalış (try/work) ayrımı.
  // "Ağaçtan inmeye çalışıyorsun" burada da hırsızlık sanılıyordu.
  if (hasStealIntent(norm)) {
    const intent = /\b(tutsak\w*|kacir\w*)\b/.test(norm)
      ? 'capture_captive'
      : /\b(gasp\w*|harac\w*)\b/.test(norm)
      ? 'extort'
      : 'steal_supplies';
    executeNarrativeToolCall('combat_or_shadow_action', { intent }, state);
    return;
  }

  // 5. İniş — yükseklikten düşme riski evrensel risk motoruyla çözülür.
  if (!forceObserve && hasDescentIntent(norm)) {
    executeNarrativeToolCall('descend_from_vantage', { note: rawText }, state);
    return;
  }

  // 6. Tırmanma / İnceleme / Gözlem
  if (/\b(tirman\w*|agaca cik\w*|tepeye cik\w*)\b/.test(norm)) {
    executeNarrativeToolCall(
      'inspect_self_and_surroundings',
      { focus: 'climb_vantage', durationMinutes: 15, note: rawText },
      state
    );
    return;
  }
  if (/\b(cep\w*|ustumu|basimi|kiyafet\w*|yokla\w*|hafiza\w*|kimim)\b/.test(norm)) {
    executeNarrativeToolCall(
      'inspect_self_and_surroundings',
      { focus: 'self_and_pockets', durationMinutes: 3, note: rawText },
      state
    );
    return;
  }
  if (currentLocation && /\b(soylenti\w*|kulak kabart\w*|dedikodu\w*)\b/.test(norm)) {
    executeNarrativeToolCall(
      'inspect_self_and_surroundings',
      { focus: 'listen_rumors', durationMinutes: 15, note: rawText },
      state
    );
    return;
  }

  // 6. Konuşma / Selamlaşma
  if (
    !forceObserve &&
    /\b(konus\w*|sohbet\w*|selam\w*|merhaba|sor\w*|seslen\w*|flort\w*|ikna\w*|pazarlik\w*)\b/.test(norm)
  ) {
    const isGreeting = /\b(merhaba|selam\w*)\b/.test(norm) && rawText.length < 40;
    executeNarrativeToolCall(
      'interact_npc_or_group',
      { tone: 'talk', durationMinutes: isGreeting ? 2 : 15 },
      state
    );
    return;
  }

  // 7. Genel gözlem veya serbest rol yapma
  if (
    forceObserve ||
    /\b(ne gor\w*|goruyorum|bak\w*|izl\w*|gozlem\w*|incele\w*|dinl\w*|ariyorum|arastir\w*|ara\b|gez\w*|dolas\w*)\b/.test(norm)
  ) {
    const isShortLook =
      norm.length < 36 && !/\b(gez\w*|dolas\w*|incele\w*|ariyorum|arastir\w*|tirman\w*)\b/.test(norm);
    executeNarrativeToolCall(
      'inspect_self_and_surroundings',
      {
        focus: 'tracks_and_area',
        durationMinutes: isShortLook ? 2 : 15,
        note: rawText,
      },
      state
    );
    return;
  }

  executeNarrativeToolCall(
    'free_roleplay_action',
    {
      physicalEffort: 'light',
      minutesSpent: 5,
      summary: rawText,
    },
    state
  );
}

export async function runAiNarrativeTurn(params: {
  rawText: string;
  chosenOption?: NarrativeChoice;
  protagonist: ProtagonistState;
  locations: MapLocation[];
  mazgalCells: MazgalCell[];
  routes: MapRoute[];
  activeWeatherKey: WeatherConditionKey;
  gameTimeMs: number;
  partyLocationId: string;
  recentMessages: NarrativeMessage[];
  aiSettings?: NarrativeAiSettings;
}): Promise<AiTurnExecutionResult> {
  const {
    rawText,
    chosenOption,
    protagonist,
    locations,
    mazgalCells,
    routes,
    activeWeatherKey,
    gameTimeMs,
    partyLocationId,
    recentMessages,
    aiSettings,
  } = params;

  const trimmed = rawText.trim();
  const workingState: NarrativeWorkingState = {
    protagonist,
    locations,
    mazgalCells,
    routes,
    activeWeatherKey,
    gameTimeMs,
    partyLocationId,
    journeyEntries: [],
    engineFacts: [],
    actionRecords: [],
    recentMessages,
    playerActionText: trimmed,
    hoursSpentTotal: 0,
    movedThisTurn: false,
    rolledDiceThisTurn: false,
  };

  const { currentLocation, currentMazgal } = getCurrentContext(workingState);
  const currentTs = formatGameDateTime(gameTimeMs);
  const currentPlace = currentLocation ? currentLocation.name : currentMazgal.terrainLabel;

  const playerMsg: NarrativeMessage = {
    id: `plr-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
    role: 'player',
    speaker: protagonist.name,
    text: trimmed,
    timestamp: currentTs,
    locationLabel: currentPlace,
  };

  const historyText = recentMessages
    .slice(-4)
    .map((m) => {
      const spk = m.speaker ?? (m.role === 'player' ? protagonist.name : 'Anlatıcı');
      const snippet = m.text.length > 220 ? `${m.text.slice(0, 220)}...` : m.text;
      return `${spk}: ${snippet}`;
    })
    .join('\n');

  const initialContextText = buildPlannerContextBrief({
    protagonist: workingState.protagonist,
    locations: workingState.locations,
    currentLocation,
    currentMazgal,
    activeWeatherKey: workingState.activeWeatherKey,
    gameTimeMs: workingState.gameTimeMs,
  });
  const initialUserTurnText = [
    `[PLANLAMA BAĞLAMI]\n${initialContextText}`,
    historyText ? `[SON SOHBET]\n${historyText}` : '',
    `[OYUNCU EYLEMİ${chosenOption ? ` (Seçilen Öneri Türü: ${chosenOption.kind})` : ''}]\n${trimmed}`,
  ]
    .filter(Boolean)
    .join('\n\n');

  const turnContents: Array<Record<string, unknown>> = [
    { role: 'user', parts: [{ text: initialUserTurnText }] },
  ];

  let finalPayload: {
    speaker: string;
    role: 'narrator' | 'dialogue';
    text: string;
    choices: Array<{
      label: string;
      actionPrompt: string;
      kind: NarrativeChoiceKind;
    }>;
  } | null = null;

  let needsChainedPlan = false;
  let durationApplied = false;
  for (let round = 0; round < 3; round += 1) {
    const mode =
      round === 0 || (round === 1 && needsChainedPlan) ? 'plan' : 'finalize';

    if (aiSettings?.provider === 'anythinkllm') {
      if (workingState.engineFacts.length === 0) {
        runHeuristicEngineTurn(trimmed, chosenOption, workingState);
      }
      if (!durationApplied) durationApplied = applyRequestedDurationIfNeeded(trimmed, workingState);
      const postCtx = getCurrentContext(workingState);
      const focusedSceneCard = buildFocusedSceneCard({
        protagonist: workingState.protagonist,
        locations: workingState.locations,
        currentLocation: postCtx.currentLocation,
        currentMazgal: postCtx.currentMazgal,
        activeWeatherKey: workingState.activeWeatherKey,
        gameTimeMs: workingState.gameTimeMs,
        recentMessages,
        playerActionText: trimmed,
        actionRecords: workingState.actionRecords,
        engineFacts: workingState.engineFacts,
        movedThisTurn: workingState.movedThisTurn,
        preferredSpeaker: workingState.preferredSpeaker,
        preferredRole: workingState.preferredRole,
      });
      const anyThinkMessages = (
        turnContents as Array<{ role?: string; parts?: Array<Record<string, unknown>> }>
      )
        .map((c) => ({
          role: c.role === 'model' ? 'assistant' : 'user',
          content: (c.parts ?? [])
            .map((p) => (p && typeof p === 'object' && 'text' in p ? String(p.text ?? '') : ''))
            .filter(Boolean)
            .join('\n'),
        }))
        .filter((m) => m.content);
      const anyThinkRes = await fetch('/api/narrative/anythinkllm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          baseUrl: aiSettings.anythinkllmBaseUrl,
          apiKey: aiSettings.anythinkllmApiKey,
          model: aiSettings.anythinkllmModel,
          messages: anyThinkMessages,
          contextSnapshotText: focusedSceneCard,
          historyText,
          engineFacts: workingState.engineFacts,
          playerActionText: trimmed,
          preferredSpeaker: workingState.preferredSpeaker,
          preferredRole: workingState.preferredRole,
        }),
      });
      const anyThinkRaw = await anyThinkRes.text();
      let anyThinkData: {
        error?: string;
        narrative?: {
          speaker?: string;
          role?: string;
          text?: string;
          choices?: Array<Record<string, unknown>>;
        };
      };
      try {
        anyThinkData = JSON.parse(anyThinkRaw);
      } catch {
        const looksLikeHtml = anyThinkRaw.trimStart().startsWith('<');
        throw new Error(
          looksLikeHtml
            ? `AnyThinkLLM sunucusundan JSON yerine HTML yanıtı geldi (HTTP ${anyThinkRes.status}).`
            : `AnyThinkLLM sunucusu geçersiz yanıt döndürdü (HTTP ${anyThinkRes.status}).`
        );
      }
      if (!anyThinkRes.ok) {
        throw new Error(anyThinkData.error || 'Sunucu hatası (' + anyThinkRes.status + ')');
      }
      finalPayload = {
        speaker: anyThinkData.narrative?.speaker || workingState.preferredSpeaker || 'Anlatıcı',
        role: anyThinkData.narrative?.role === 'dialogue' ? 'dialogue' : 'narrator',
        text: anyThinkData.narrative?.text || 'Anlatıcı şu an konuşuyor.',
        choices: Array.isArray(anyThinkData.narrative?.choices)
          ? (anyThinkData.narrative?.choices as Array<{ label: string; actionPrompt: string; kind: NarrativeChoiceKind }>).slice(0, 4)
          : [],
      };
      break;
    }

    const postCtx = getCurrentContext(workingState);
    const contextPayloadForStep =
      mode === 'finalize'
        ? buildFocusedSceneCard({
            protagonist: workingState.protagonist,
            locations: workingState.locations,
            currentLocation: postCtx.currentLocation,
            currentMazgal: postCtx.currentMazgal,
            activeWeatherKey: workingState.activeWeatherKey,
            gameTimeMs: workingState.gameTimeMs,
            recentMessages,
            playerActionText: trimmed,
            actionRecords: workingState.actionRecords,
            engineFacts: workingState.engineFacts,
            movedThisTurn: workingState.movedThisTurn,
            preferredSpeaker: workingState.preferredSpeaker,
            preferredRole: workingState.preferredRole,
          })
        : '';

    const res = await fetch('/api/narrative/step', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode,
        model: aiSettings?.model,
        thinkingMode: aiSettings?.thinkingMode,
        apiKey: aiSettings?.apiKey,
        turnContents,
        playerActionText: trimmed,
        chosenOptionKind: chosenOption?.kind,
        contextSnapshotText: contextPayloadForStep,
        historyText,
        engineFacts: workingState.engineFacts,
        preferredRole: workingState.preferredRole,
        preferredSpeaker: workingState.preferredSpeaker,
      }),
    });

    const rawResponseText = await res.text();
    let data: {
      error?: string;
      status?: 'tool_calls' | 'final';
      modelContent?: Record<string, unknown>;
      functionCalls?: Array<{ id?: string; name: string; args?: Record<string, unknown> }>;
      narrative?: {
        speaker: string;
        role: 'narrator' | 'dialogue';
        text: string;
        choices: Array<{
          label: string;
          actionPrompt: string;
          kind: NarrativeChoiceKind;
        }>;
      };
    };

    try {
      data = JSON.parse(rawResponseText);
    } catch {
      const looksLikeHtml = rawResponseText.trimStart().startsWith('<');
      throw new Error(
        looksLikeHtml
          ? `Anlatı sunucusuna şu anda ulaşılamıyor (HTTP ${res.status}). Sayfayı yenileyin veya paylaşılan uygulamayı yeniden yayınlayın.`
          : `Anlatı sunucusu geçersiz yanıt döndürdü (HTTP ${res.status}).`
      );
    }

    if (!res.ok) {
      throw new Error(data.error || `Sunucu hatası (${res.status})`);
    }

    if (data.status === 'tool_calls' && data.functionCalls && data.functionCalls.length > 0) {
      if (data.modelContent) {
        turnContents.push(data.modelContent);
      }
      needsChainedPlan =
        round === 0 &&
        data.functionCalls.length === 1 &&
        data.functionCalls[0]?.name === 'inspect_self_and_surroundings';
      const fnResponses = data.functionCalls.map((fc) => {
        const resultObj = executeNarrativeToolCall(fc.name, fc.args ?? {}, workingState);
        return {
          functionResponse: {
            id: fc.id,
            name: fc.name,
            response: resultObj,
          },
        };
      });
      turnContents.push({
        role: 'user',
        parts: fnResponses,
      });
      if (!durationApplied) durationApplied = applyRequestedDurationIfNeeded(trimmed, workingState);
      continue;
    }

    if (data.status === 'final' && data.narrative) {
      if (round === 0 && workingState.engineFacts.length === 0) {
        runHeuristicEngineTurn(trimmed, chosenOption, workingState);
        if (workingState.engineFacts.length > 0) {
          if (!durationApplied) durationApplied = applyRequestedDurationIfNeeded(trimmed, workingState);
          continue;
        }
      }
      if (!durationApplied) durationApplied = applyRequestedDurationIfNeeded(trimmed, workingState);
      finalPayload = data.narrative;
      break;
    }
  }

  if (!finalPayload) {
    throw new Error('Anlatıcı yanıtı tamamlanamadı. Lütfen tekrar deneyin.');
  }

  const endCtx = getCurrentContext(workingState);
  const endPlace = endCtx.currentLocation
    ? endCtx.currentLocation.name
    : endCtx.currentMazgal.terrainLabel;

  const fallbackChoices = buildContextualChoices({
    protagonist: workingState.protagonist,
    currentLocation: endCtx.currentLocation,
    currentMazgal: endCtx.currentMazgal,
    allLocations: workingState.locations,
    routes: workingState.routes,
    activeWeatherKey: workingState.activeWeatherKey,
    gameTimeMs: workingState.gameTimeMs,
  });

  const sanitizedChoices: NarrativeChoice[] =
    finalPayload.choices.length > 0
      ? finalPayload.choices.slice(0, 4).map((c, idx) => ({
          id: `ai-ch-${Date.now()}-${idx}`,
          label: sanitizeNarrativeOutputForEpistemicSafety(
            c.label,
            workingState.locations,
            endCtx.currentLocation
          ),
          actionPrompt: forceFirstPersonAction(
            sanitizeNarrativeOutputForEpistemicSafety(
              c.actionPrompt,
              workingState.locations,
              endCtx.currentLocation
            )
          ),
          kind: c.kind,
        }))
      : fallbackChoices;

  const safeText = sanitizeNarrativeOutputForEpistemicSafety(
    finalPayload.text,
    workingState.locations,
    endCtx.currentLocation
  );
  // NPC diyaloğuna "sen" dili koruması uygulanmaz; yalnızca anlatıcı metni düzeltilir.
  const guardedText =
    finalPayload.role === 'dialogue'
      ? safeText
      : guardNarrativeText({
          text: safeText,
          recentNarratorTexts: recentMessages
            .filter((m) => m.role !== 'player' && m.role !== 'dialogue')
            .slice(-4)
            .map((m) => m.text),
          engineFacts: workingState.engineFacts,
          fallback:
            workingState.engineFacts.length > 0
              ? sanitizeNarrativeOutputForEpistemicSafety(
                  workingState.engineFacts[0],
                  workingState.locations,
                  endCtx.currentLocation
                )
              : 'Eylemin tamamlandı; çevrede belirgin bir değişiklik yok.',
        });

  const aiMsg: NarrativeMessage = {
    id: `ai-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
    role: finalPayload.role,
    speaker: sanitizeNarrativeOutputForEpistemicSafety(
      finalPayload.speaker,
      workingState.locations,
      endCtx.currentLocation
    ),
    text: guardedText,
    timestamp: formatGameDateTime(workingState.gameTimeMs),
    locationLabel: endPlace,
    choices: sanitizedChoices,
  };

  if (
    workingState.hoursSpentTotal > 0 &&
    !workingState.lastTimeAction
  ) {
    workingState.lastTimeAction = `Anlatı Eylemi (+${formatTravelHours(workingState.hoursSpentTotal)})`;
  }

  return {
    appendedMessages: [playerMsg, aiMsg],
    nextProtagonist: workingState.protagonist,
    nextLocations: workingState.locations,
    nextWeatherKey: workingState.activeWeatherKey,
    nextGameTimeMs: workingState.gameTimeMs,
    nextPartyLocationId: workingState.partyLocationId,
    journeyEntries: workingState.journeyEntries,
    lastTimeAction: workingState.lastTimeAction,
    movedThisTurn: workingState.movedThisTurn,
    rolledDiceThisTurn: workingState.rolledDiceThisTurn,
  };
}
