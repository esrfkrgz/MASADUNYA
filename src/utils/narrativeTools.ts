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
} from '../types/map';
import { rollDie } from './diceEngine';
import {
  INITIAL_GAME_TIME_MS,
  addGameHours,
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
import { buildContextualChoices } from './narrativeEngine';
import {
  advancePartyAndContactsWithTime,
  interactWithLivingNpc,
  type NpcInteractionType,
} from './partyAndRelationsEngine';
import {
  ACTION_HOURS,
  applyProtagonistTravel,
  getFactionForLocation,
  getProtagonistModifiers,
  performProtagonistAction,
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

function normalizeTr(text: string): string {
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

  const waveRes = advanceContractsAndWaves(current, prevMs, nextMs);
  current = waveRes.nextProtagonist;
  if (waveRes.waveAnnouncement) notices.push(waveRes.waveAnnouncement);

  const weatherRes = advanceRegionalWeatherWithTime(
    state.activeWeatherKey,
    current.activeWorldWave,
    prevMs,
    nextMs
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
  if (roamRes.notices.length > 0) notices.push(...roamRes.notices);

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

function computeTravelHours(
  baseHours: number,
  pace: TravelPace,
  transport: TravelTransport,
  weather: WeatherConditionKey,
  hasDirectRoute: boolean,
  requiresBoat: boolean
): number {
  const paceMult = pace === 'stealth' ? 1.35 : pace === 'forced' ? 0.78 : 1.0;
  const transportMult =
    transport === 'mule'
      ? hasDirectRoute
        ? 0.85
        : 1.05
      : transport === 'boat' && requiresBoat
      ? 0.75
      : 1.0;
  const weatherMult =
    weather === 'storm' ? 1.4 : weather === 'rain' ? 1.22 : weather === 'mist' ? 1.12 : 1.0;
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

  const directionsList = currentMazgal.neighbors
    .map((nb) => {
      const targetCell = state.mazgalCells.find((c) => c.id === nb.id);
      const locInside = targetCell?.locationsInside?.[0];
      return `${nb.direction}: ${nb.terrainLabel} (~${nb.travelHours} saat${
        locInside ? `, burada yerleşim var: ${locInside.name}` : ''
      })`;
    })
    .join(' | ');

  const knownSettlements = state.locations
    .filter((l) => l.discovered || l.id === currentLocation?.id)
    .map((l) => l.name)
    .join(', ');

  return [
    `Karakter: ${p.name} (${p.appearanceNote ?? p.title})`,
    `Fiziksel/Durum: Can ${p.health}/100, Zindelik ${p.stamina}/100, Açlık ${p.hunger}/100, Moral/Ruh Hali: ${p.mood}`,
    `Özellikler & Koşullar: ${(p.marks ?? []).join(', ') || 'Yok'} | Aktif Durumlar: ${(p.activeConditions ?? []).join(', ') || 'Yok'}`,
    `Modifikatörler: Fiziksel ${mods.physicalMod >= 0 ? `+${mods.physicalMod}` : mods.physicalMod}, Algı ${mods.perceptionMod >= 0 ? `+${mods.perceptionMod}` : mods.perceptionMod}, Sosyal ${mods.socialMod >= 0 ? `+${mods.socialMod}` : mods.socialMod}`,
    `Çanta & Kesesi: ${p.silver} Gümüş, ${p.rations} Kuru Erzak | Eşyalar: ${inventorySummary}`,
    `Zaman & Hava: ${formatGameDateTime(state.gameTimeMs)} (${getDayPhaseLabel(state.gameTimeMs)}) | ${WEATHER_LABELS[state.activeWeatherKey]}`,
    currentLocation
      ? `Konum (Yerleşim): ${currentLocation.name} — ${currentLocation.playerLore} | Yerel Ruh Hali: ${living?.mood ?? 'Olağan'} | Sakinler: ${living?.notableResidents.map((r) => `${r.name} (${r.role})`).join(', ') || 'Bölge halkı'} | Sorunlar: ${living?.activeProblems.map((pr) => pr.title).join(', ') || 'Aktif sorun yok'} | Söylentiler: ${living?.rumors.slice(0, 2).join(' ; ') || 'Yok'}`
      : `Konum (Açık Arazi): ${currentMazgal.terrainLabel} — ${currentMazgal.summary} | Görüş: ~${currentMazgal.visibilityMeters} metre | Tehlike: ${currentMazgal.dangerLevel}/5 | Doğal İzler: ${currentMazgal.resourceYield}`,
    `Ulaşılabilir Yönler: ${directionsList || 'Çıkış yok'}`,
    `Bilinen Yerleşimler: ${knownSettlements || 'Henüz keşfedilmiş yerleşim yok'}`,
    `Yanındaki / Konumdaki Kişiler: ${contactsHere.map((c) => `${c.name} (${c.role}, ilişki: ${c.partyRelation}, güven: ${c.trust}, yakınlık: ${c.affection})`).join(' | ') || 'Kimse yok'}`,
    `Yakındaki Gezgin Gruplar: ${unitsHere.map((u) => `${u.name} (${u.kind}, ${u.statusNote})`).join(' | ') || 'Yok'}`,
    p.activeWorldWave
      ? `Bölgesel Olay Dalgası: ${p.activeWorldWave.title} (${p.activeWorldWave.description})`
      : '',
  ]
    .filter(Boolean)
    .join('\n');
}

export function executeNarrativeToolCall(
  toolName: string,
  args: Record<string, unknown>,
  state: NarrativeWorkingState
): Record<string, unknown> {
  const { currentLocation, currentMazgal } = getCurrentContext(state);
  const mods = getProtagonistModifiers(state.protagonist, currentLocation, currentMazgal);
  const living = currentLocation?.livingState;

  if (toolName === 'inspect_self_and_surroundings') {
    const focus = String(args.focus ?? 'tracks_and_area');
    const prevMs = state.gameTimeMs;
    const nextMs = addGameHours(prevMs, ACTION_HOURS.observe);
    const outcome = performProtagonistAction(
      state.protagonist,
      'observe',
      currentLocation,
      currentMazgal,
      nextMs
    );
    state.protagonist = outcome.nextProtagonist;
    const notices = advanceWorldStateInTurn(
      state,
      prevMs,
      nextMs,
      currentLocation,
      currentMazgal
    );
    state.hoursSpentTotal += ACTION_HOURS.observe;
    state.rolledDiceThisTurn = true;
    state.lastTimeAction = `Gözlem (+1 Saat)${notices.length > 0 ? ` · ${notices[0]}` : ''}`;

    const roll = rollDie(20);
    const total = roll + mods.perceptionMod;
    const modStr = mods.perceptionMod >= 0 ? `+${mods.perceptionMod}` : `${mods.perceptionMod}`;
    const p = state.protagonist;
    const unitsHere = (p.roamingUnits ?? []).filter((u) => u.mazgalId === currentMazgal.id);
    const nearSummary = currentMazgal.neighbors
      .slice(0, 3)
      .map((nb) => `${nb.direction} yönünde ${nb.terrainLabel.toLowerCase()}`)
      .join(', ');

    let fact = '';
    if (focus === 'self_and_pockets') {
      const trackPart =
        total >= 12
          ? `Yosunlar incelendiğinde (Algı zarı ${roll}${modStr}=${total}, Başarılı) çam diplerinden güney yönüne doğru giden taze bot izleri ve kırık dallar tespit edildi.`
          : `Yosunlardaki izler sis ve nem yüzünden belirsiz (Algı zarı ${roll}${modStr}=${total}); yalnızca kendi düşüş izi seçilebiliyor.`;
      fact = `Üst-baş ve cep incelemesi: Koyu renk işaretsiz yolcu tuniği, belde kısa kılıç, kesede ${p.silver} gümüş sikke, çantada ${p.rations} kuru erzak var. Kimlik veya mektup yok; hafızada yalnızca "Eşref" adı bulunuyor. ${trackPart}`;
    } else if (focus === 'climb_vantage') {
      fact = !currentLocation
        ? `Yüksek çam ağacına tırmanış (Algı zarı ${roll}${modStr}=${total}): Sisin inceldiği noktalarda ${nearSummary} seçildi.`
        : `${currentLocation.name} içinde yüksek bir noktadan çevre gözlendi (Algı zarı ${roll}${modStr}=${total}): Yerleşim ${living?.mood ?? 'olağan'} durumda.`;
    } else if (focus === 'listen_rumors') {
      if (currentLocation && living) {
        fact = `${currentLocation.name} içinde kulak kabartıldı (Algı zarı ${roll}${modStr}=${total}): Ruh hali "${living.mood}". ${
          living.rumors.length > 0 ? `Duyulan söylenti: "${living.rumors[0]}". ` : ''
        }${living.activeProblems.length > 0 ? `Yerel sorun: ${living.activeProblems[0].title}.` : ''}`;
      } else {
        fact = `Açık arazide sesler dinlendi (Algı zarı ${roll}${modStr}=${total}): ${
          total >= 12 && currentMazgal.neighborEffects.length > 0
            ? currentMazgal.neighborEffects[0]
            : 'Yoğun sis içinde rüzgar ve yaprak hışırtısı dışında net bir insan sesi yok.'
        }`;
      }
    } else {
      const trackHint =
        total >= 12
          ? `Güçlü gözlem (Algı zarı ${roll}${modStr}=${total}): Çevrede ${currentMazgal.resourceYield.toLowerCase()} ve ${nearSummary} yönelimleri seçildi.${
              currentMazgal.neighborEffects[0] ? ` ${currentMazgal.neighborEffects[0]}` : ''
            }`
          : `Sisli gözlem (Algı zarı ${roll}${modStr}=${total}): Görüş yaklaşık ${currentMazgal.visibilityMeters} metre ile kısıtlı; çevre şimdilik sakin görünüyor.`;
      fact = `${trackHint}${
        unitsHere.length > 0
          ? ` Yakındaki hareketlilik: ${unitsHere.map((u) => `${u.name} (${u.statusNote})`).join(', ')}.`
          : ''
      }`;
    }

    if (notices.length > 0) fact += ` Dünya bildirimi: ${notices[0]}`;
    state.engineFacts.push(fact);

    return {
      ok: true,
      perceptionRoll: total,
      silver: p.silver,
      rations: p.rations,
      visibilityMeters: currentMazgal.visibilityMeters,
      nearbyDirections: nearSummary,
      unitsHere: unitsHere.map((u) => u.name),
      summary: fact,
    };
  }

  if (toolName === 'travel_direction') {
    const requestedDir = normalizeTr(String(args.direction ?? ''));
    const paceArg = String(args.pace ?? state.protagonist.travelPace ?? 'normal') as TravelPace;
    const pace: TravelPace =
      paceArg === 'stealth' || paceArg === 'forced' ? paceArg : 'normal';

    const nb = currentMazgal.neighbors.find((n) =>
      normalizeTr(n.direction).includes(requestedDir)
    );
    if (!nb) {
      const validDirs = currentMazgal.neighbors.map((n) => n.direction).join(', ');
      const fact = `${String(args.direction ?? 'Bu')} yönünde aşılabilir bir yol veya geçit yok. Geçilebilir yönler: ${validDirs}.`;
      state.engineFacts.push(fact);
      return { moved: false, reason: fact, validDirections: validDirs };
    }

    const transport: TravelTransport = state.protagonist.travelTransport ?? 'foot';
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
    const targetCell = state.mazgalCells.find((c) => c.id === nb.id) ?? currentMazgal;
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
    if (locInside) {
      state.partyLocationId = locInside.id;
      state.locations = state.locations.map((loc) =>
        loc.id === locInside.id
          ? applyExternalMoraleShift({ ...loc, discovered: true }, localMoraleDelta, nextMs)
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
    const fact = `${nb.direction} yönüne ${formatTravelHours(adjustedHours)} (${
      pace === 'stealth' ? 'gizlice' : pace === 'forced' ? 'hızlıca' : 'olağan tempoda'
    }) ilerlendi. Yeni bölge: ${
      locInside ? `${locInside.name} yerleşimi` : targetCell.terrainLabel
    }. Can: ${state.protagonist.health}/100, Zindelik: ${state.protagonist.stamina}/100.${
      newUnitsHere.length > 0
        ? ` Burada karşılaşılan gruplar: ${newUnitsHere.map((u) => `${u.name} (${u.statusNote})`).join(', ')}.`
        : ''
    }${notices.length > 0 ? ` Yol olayı: ${notices.join(' ')}` : ''}`;
    state.engineFacts.push(fact);

    return {
      moved: true,
      direction: nb.direction,
      hoursSpent: adjustedHours,
      newTerrain: targetCell.terrainLabel,
      enteredSettlement: locInside?.name ?? null,
      unitsHere: newUnitsHere.map((u) => u.name),
      summary: fact,
    };
  }

  if (toolName === 'travel_to_settlement') {
    const query = normalizeTr(String(args.settlementName ?? ''));
    const paceArg = String(args.pace ?? state.protagonist.travelPace ?? 'normal') as TravelPace;
    const pace: TravelPace =
      paceArg === 'stealth' || paceArg === 'forced' ? paceArg : 'normal';

    const target = state.locations.find(
      (l) =>
        normalizeTr(l.name).includes(query) ||
        query.includes(normalizeTr(l.name.split(' ')[0]))
    );
    if (!target) {
      const available = state.locations
        .filter((l) => l.discovered)
        .map((l) => l.name)
        .join(', ');
      const fact = `"${String(args.settlementName ?? '')}" adında ulaşılabilir bir yerleşim bulunamadı.${
        available ? ` Bilinen yerleşimler: ${available}.` : ' Yakındaki bilinen yerleşim henüz keşfedilmedi.'
      }`;
      state.engineFacts.push(fact);
      return { moved: false, reason: fact };
    }

    const fromCellId = currentMazgal.id;
    const toCellSummary = getCellForCoords(target.x, target.y);
    let baseHours = 8;
    let hasDirectRoute = false;
    let requiresBoat = false;
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
        const plan = findShortestMazgalPath(fromCellId, toCellSummary.id, state.mazgalCells);
        baseHours = plan.hours;
        requiresBoat = plan.requiresBoat;
      }
    }

    const adjustedHours = computeTravelHours(
      baseHours,
      pace,
      state.protagonist.travelTransport ?? 'foot',
      state.activeWeatherKey,
      hasDirectRoute,
      requiresBoat
    );
    const prevMs = state.gameTimeMs;
    const nextMs = addGameHours(prevMs, adjustedHours);
    const targetCell = state.mazgalCells.find((c) => c.id === toCellSummary.id) ?? currentMazgal;

    const { nextProtagonist, localMoraleDelta } = applyProtagonistTravel(
      state.protagonist,
      target,
      targetCell,
      adjustedHours,
      nextMs,
      {
        pace,
        transport: state.protagonist.travelTransport ?? 'foot',
        weather: state.activeWeatherKey,
        requiresBoat,
      }
    );
    state.protagonist = nextProtagonist;
    state.partyLocationId = target.id;
    state.locations = state.locations.map((loc) =>
      loc.id === target.id
        ? applyExternalMoraleShift({ ...loc, discovered: true }, localMoraleDelta, nextMs)
        : loc
    );

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
    return { moved: true, settlement: target.name, hoursSpent: adjustedHours, summary: fact };
  }

  if (toolName === 'interact_npc_or_group') {
    const targetName = normalizeTr(String(args.targetName ?? ''));
    const tone = String(args.tone ?? 'talk');

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
      ? unitsHere.find((u) => normalizeTr(u.name).includes(targetName))
      : !currentLocation && contactsHere.length === 0
      ? unitsHere[0]
      : undefined;

    if (matchedUnit) {
      const mode = tone === 'escort_aid' ? 'escort_aid' : 'greet_trade';
      const prevMs = state.gameTimeMs;
      const nextMs = addGameHours(prevMs, 1);
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
      state.hoursSpentTotal += 1;
      state.rolledDiceThisTurn = true;
      state.preferredRole = 'dialogue';
      state.preferredSpeaker = matchedUnit.name;
      const fact = `${matchedUnit.name} ile etkileşim: ${res.message}${
        notices.length > 0 ? ` ${notices[0]}` : ''
      }`;
      state.engineFacts.push(fact);
      return { interacted: true, target: matchedUnit.name, summary: fact };
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
      const nextMs = addGameHours(prevMs, 1);
      const res = interactWithLivingNpc(
        state.protagonist,
        matchedContact.id,
        npcAction,
        currentLocation,
        currentMazgal,
        nextMs,
        mods,
        state.routes,
        state.locations
      );
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
      const notices = advanceWorldStateInTurn(
        state,
        prevMs,
        nextMs,
        currentLocation,
        currentMazgal
      );
      state.hoursSpentTotal += res.hoursSpent;
      state.rolledDiceThisTurn = true;
      state.preferredRole = 'dialogue';
      state.preferredSpeaker = `${matchedContact.name} (${matchedContact.role})`;
      const fact = `${matchedContact.name} ile görüşme (${npcAction}): ${res.feedbackText}${
        notices.length > 0 ? ` ${notices[0]}` : ''
      }`;
      state.engineFacts.push(fact);
      return { interacted: true, target: matchedContact.name, summary: fact };
    }

    if (currentLocation && living) {
      const prevMs = state.gameTimeMs;
      const nextMs = addGameHours(prevMs, ACTION_HOURS.converse);
      const outcome = performProtagonistAction(
        state.protagonist,
        'converse',
        currentLocation,
        currentMazgal,
        nextMs
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
      state.hoursSpentTotal += ACTION_HOURS.converse;
      const resident =
        (targetName
          ? living.notableResidents.find((r) => normalizeTr(r.name).includes(targetName))
          : undefined) ?? living.notableResidents[0];
      const speakerName = resident
        ? `${resident.name} (${resident.role})`
        : `${currentLocation.name} Sakini`;
      state.preferredRole = 'dialogue';
      state.preferredSpeaker = speakerName;
      const fact = `${speakerName} ile konuşuldu: ${outcome.nextProtagonist.lastDialogue}${
        living.rumors[0] ? ` Söylenti: "${living.rumors[0]}".` : ''
      }${
        living.activeProblems[0] ? ` Yerel sorun: ${living.activeProblems[0].title}.` : ''
      }${notices.length > 0 ? ` ${notices[0]}` : ''}`;
      state.engineFacts.push(fact);
      return { interacted: true, target: speakerName, summary: fact };
    }

    const fact = 'Çevrede konuşabilecek hiçbir kişi, yoldaş veya gezgin grup yok; Eşref açık doğada yalnız.';
    state.engineFacts.push(fact);
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
      const fact = `${unit.name} grubuna pusu: ${res.message}${
        notices.length > 0 ? ` ${notices[0]}` : ''
      }`;
      state.engineFacts.push(fact);
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
      return { used: true, summary: fact };
    }

    const invId =
      item === 'healing_herb' || item === 'antidote_vial' || item === 'torch_bundle'
        ? item
        : 'healing_herb';
    const res = useInventoryItem(state.protagonist, invId, state.gameTimeMs);
    state.protagonist = res.nextProtagonist;
    state.engineFacts.push(res.message);
    return { used: true, summary: res.message };
  }

  if (toolName === 'camp_forage_or_aid') {
    const activity = String(args.activity ?? 'rest_camp');
    if (activity === 'help_settlement_problem' && currentLocation && living && living.activeProblems.length > 0) {
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
      const fact = `${attempt.message}${notices.length > 0 ? ` ${notices[0]}` : ''}`;
      state.engineFacts.push(fact);
      return { solved: attempt.solved, summary: fact };
    }

    const actType = activity === 'forage_or_work' ? 'forage_or_work' : 'rest_camp';
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
              actType === 'rest_camp' ? 'Kamp ve Dinlenme' : 'İş ve Av',
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
    const fact = `${outcome.nextProtagonist.lastObservation} (+${hours} saat)${
      notices.length > 0 ? ` ${notices[0]}` : ''
    }`;
    state.engineFacts.push(fact);
    return { ok: true, hoursSpent: hours, summary: fact };
  }

  // free_roleplay_action
  const effort = String(args.physicalEffort ?? 'none');
  const advanceHour = Boolean(args.advanceOneHour);
  const summary = String(args.summary ?? 'Eşref çevresine uygun serbest bir eylem gerçekleştirdi.');
  const staminaCost = effort === 'moderate' ? 5 : effort === 'light' ? 2 : 0;

  state.protagonist = {
    ...state.protagonist,
    stamina: Math.max(5, state.protagonist.stamina - staminaCost),
    lastObservation: summary,
  };

  if (advanceHour) {
    const prevMs = state.gameTimeMs;
    const nextMs = addGameHours(prevMs, 1);
    const notices = advanceWorldStateInTurn(
      state,
      prevMs,
      nextMs,
      currentLocation,
      currentMazgal
    );
    state.hoursSpentTotal += 1;
    const fact = `${summary} (+1 saat${staminaCost > 0 ? `, -${staminaCost} Zindelik` : ''}).${
      notices.length > 0 ? ` ${notices[0]}` : ''
    }`;
    state.engineFacts.push(fact);
    return { ok: true, summary: fact };
  }

  state.engineFacts.push(summary);
  return { ok: true, summary };
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
    .slice(-8)
    .map((m) => `${m.speaker ?? (m.role === 'player' ? protagonist.name : 'Anlatıcı')}: ${m.text}`)
    .join('\n');

  const initialContextText = buildAiContextSnapshot(workingState);
  const initialUserTurnText = [
    `[MEVCUT DÜNYA BAĞLAMI]\n${initialContextText}`,
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
  for (let round = 0; round < 3; round += 1) {
    const mode =
      round === 0 || (round === 1 && needsChainedPlan) ? 'plan' : 'finalize';
    const res = await fetch('/api/narrative/step', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode,
        model: aiSettings?.model,
        thinkingMode: aiSettings?.thinkingMode,
        turnContents,
        playerActionText: trimmed,
        chosenOptionKind: chosenOption?.kind,
        contextSnapshotText: buildAiContextSnapshot(workingState),
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
          ? `Anlatı sunucusundan JSON yerine HTML yanıtı geldi (HTTP ${res.status}). Lütfen sayfayı yenileyin veya paylaşılan uygulamayı yeniden yayınlayın.`
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
      continue;
    }

    if (data.status === 'final' && data.narrative) {
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

  const normalizedChoices: NarrativeChoice[] =
    finalPayload.choices.length > 0
      ? finalPayload.choices.slice(0, 4).map((c, idx) => ({
          id: `ai-ch-${Date.now()}-${idx}`,
          label: c.label,
          actionPrompt: c.actionPrompt,
          kind: c.kind,
        }))
      : fallbackChoices;

  const aiMsg: NarrativeMessage = {
    id: `ai-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
    role: finalPayload.role,
    speaker: finalPayload.speaker,
    text: finalPayload.text,
    timestamp: formatGameDateTime(workingState.gameTimeMs),
    locationLabel: endPlace,
    choices: normalizedChoices,
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
