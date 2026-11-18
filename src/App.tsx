/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Calendar, Clock, RotateCcw, User } from 'lucide-react';
import { ChronicleAtlas } from './components/ChronicleAtlas';
import { EncounterStudio } from './components/EncounterStudio';
import { GmToolsPanel } from './components/GmToolsPanel';
import { LocationInspector } from './components/LocationInspector';
import { LocationModal } from './components/LocationModal';
import { MapViewport } from './components/MapViewport';
import { MazgalInspector } from './components/MazgalInspector';
import { NarrativeChatbox } from './components/NarrativeChatbox';
import {
  NARRATIVE_MODEL_OPTIONS,
  NarrativeSettingsModal,
} from './components/NarrativeSettingsModal';
import { ProtagonistDrawer } from './components/ProtagonistDrawer';
import { TopBar } from './components/TopBar';
import { INITIAL_LOCATIONS, INITIAL_ROUTES, REGION_INFO } from './data/easternForestData';
import type {
  ActiveContract,
  ActiveTab,
  ForestEncounter,
  InventoryItemId,
  JourneyLogEntry,
  MapLocation,
  MapRoute,
  MazgalCell,
  MazgalNeighborSummary,
  NarrativeAiSettings,
  NarrativeChoice,
  NarrativeMessage,
  ProtagonistActionType,
  ProtagonistState,
  SettlementResident,
  TravelPace,
  TravelTransport,
  WeatherConditionKey,
} from './types/map';
import {
  INITIAL_GAME_TIME_MS,
  addGameHours,
  formatGameDate,
  formatGameDateTime,
  formatGameHour,
  getDayNumber,
  getDayPhaseLabel,
} from './utils/gameTime';
import {
  buildMazgalGrid,
  findShortestMazgalPath,
  formatTravelHours,
  getCellForCoords,
} from './utils/gridEngine';
import {
  advanceLivingLocations,
  applyExternalMoraleShift,
  recordProceduralSceneOnLocation,
  recordRoamingArrivalOnLocation,
  resolveSettlementProblemByParty,
} from './utils/livingWorldEngine';
import {
  advancePartyAndContactsWithTime,
  appendNpcMoment,
  createContactFromProceduralNpc,
  createContactFromResident,
  createNpcMomentRecord,
  getPartyBonusSummary,
  interactWithLivingNpc,
  type NpcInteractionType,
} from './utils/partyAndRelationsEngine';
import type {
  MazgalProceduralEvent,
  ProceduralNpcCard,
  ProceduralSceneCard,
} from './utils/proceduralWorldDeck';
import {
  ACTION_HOURS,
  FACTION_LABELS,
  applyEncounterResultToProtagonist,
  applyMazgalEventToProtagonist,
  applyProtagonistTravel,
  createInitialProtagonist,
  getFactionForLocation,
  getProtagonistModifiers,
  hydrateProtagonist,
  performProtagonistAction,
} from './utils/protagonistEngine';
import {
  createInitialNarrativeMessages,
  createTravelNarrativeNotice,
} from './utils/narrativeEngine';
import { runAiNarrativeTurn } from './utils/narrativeTools';
import { soundFx } from './utils/sound';
import {
  type EncounterChoiceId,
  type RoamingArrivalEvent,
  type ShadowActionType,
  acceptContract,
  advanceContractsAndWaves,
  advanceRegionalWeatherWithTime,
  advanceRoamingUnitsWithTime,
  buyMarketItem,
  buySlaveForParty,
  checkGuardEncounterOnArrival,
  evaluateCriticalHealthRecovery,
  freeBondedRetainer,
  interactWithRoamingUnit,
  payBountyAtSettlement,
  performShadowAction,
  resolveInteractiveEncounterChoice,
  resolveSettlementProblemAttempt,
  sellBondedRetainerAtMarket,
  sellCaptiveAtMarket,
  sellMarketItem,
  tryCompleteContractAtLocation,
  useInventoryItem,
} from './utils/worldSystemsEngine';

const STORAGE_KEY = 'sisli_dogu_atlasi_v6';

interface PersistedState {
  locations: MapLocation[];
  routes: MapRoute[];
  partyLocationId: string;
  journeyLog: JourneyLogEntry[];
  gameTimeMs?: number;
  protagonist?: ProtagonistState;
  activeWeatherKey?: WeatherConditionKey;
  narrativeMessages?: NarrativeMessage[];
  aiSettings?: NarrativeAiSettings;
}

const DEFAULT_AI_SETTINGS: NarrativeAiSettings = {
  model: 'gemini-4-hydrogen',
  thinkingMode: 'fast',
  apiKey: '',
  provider: 'gemini',
  anythinkllmBaseUrl: 'http://localhost:3001/api/v1/openai',
  anythinkllmApiKey: '',
  anythinkllmModel: 'gpt-4o',
};

function loadInitialState(): PersistedState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as PersistedState;
      if (Array.isArray(parsed.locations) && parsed.locations.length > 0) {
        const hydratedLocations = parsed.locations.map((loc) => {
          const seed = INITIAL_LOCATIONS.find((initLoc) => initLoc.id === loc.id);
          if (!loc.livingState) {
            return seed?.livingState ? { ...loc, livingState: seed.livingState } : loc;
          }
          if (
            loc.id === 'loc-kuldere' &&
            !loc.livingState.establishments.includes('Sınır Köle ve Tutsak Pazarı')
          ) {
            return {
              ...loc,
              playerLore: seed?.playerLore ?? loc.playerLore,
              livingState: {
                ...loc.livingState,
                establishments: [...loc.livingState.establishments, 'Sınır Köle ve Tutsak Pazarı'],
              },
            };
          }
          return loc;
        });
        return {
          ...parsed,
          locations: hydratedLocations,
          gameTimeMs:
            typeof parsed.gameTimeMs === 'number'
              ? parsed.gameTimeMs
              : INITIAL_GAME_TIME_MS,
          protagonist: parsed.protagonist
            ? hydrateProtagonist(parsed.protagonist, hydratedLocations)
            : createInitialProtagonist(hydratedLocations),
        };
      }
    }
  } catch {
    // Fallback to initial data
  }
  return {
    locations: INITIAL_LOCATIONS,
    routes: INITIAL_ROUTES,
    partyLocationId: '',
    gameTimeMs: INITIAL_GAME_TIME_MS,
    protagonist: createInitialProtagonist(INITIAL_LOCATIONS),
    journeyLog: [
      {
        id: 'log-init',
        locationId: 'loc-gumus-kopru',
        locationName: 'Mazgal G4 (Sisli Çam ve Meşe Ormanı)',
        timestamp: formatGameDateTime(INITIAL_GAME_TIME_MS),
        note: 'Hafıza kaybı içinde yalnızca adının Eşref olduğunu hatırlayarak G4 mazgalındaki ormanda uyandın.',
      },
    ],
  };
}

export default function App() {
  const [initial] = useState<PersistedState>(() => loadInitialState());
  const [locations, setLocations] = useState<MapLocation[]>(initial.locations);
  const [routes, setRoutes] = useState<MapRoute[]>(initial.routes);
  const [partyLocationId, setPartyLocationId] = useState<string>(initial.partyLocationId);
  const [protagonist, setProtagonist] = useState<ProtagonistState>(() =>
    hydrateProtagonist(
      initial.protagonist ?? createInitialProtagonist(initial.locations),
      initial.locations
    )
  );
  const [journeyLog, setJourneyLog] = useState<JourneyLogEntry[]>(initial.journeyLog);
  const [gameTimeMs, setGameTimeMs] = useState<number>(
    initial.gameTimeMs ?? INITIAL_GAME_TIME_MS
  );
  const [lastTimeAction, setLastTimeAction] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<ActiveTab>('map');
  const [selectedLocationId, setSelectedLocationId] = useState<string>(
    initial.partyLocationId || 'loc-gumus-kopru'
  );

  const [fogOfWar, setFogOfWar] = useState<boolean>(false);
  const [activeWeatherKey, setActiveWeatherKey] = useState<WeatherConditionKey>(
    initial.activeWeatherKey ?? 'mist'
  );
  const [showRoutes, setShowRoutes] = useState<boolean>(true);
  const [soundEnabled, setSoundEnabled] = useState<boolean>(true);

  const [isPlacingPin, setIsPlacingPin] = useState<boolean>(false);
  const [pendingCoords, setPendingCoords] = useState<{ x: number; y: number } | null>(null);
  const [editingLocation, setEditingLocation] = useState<MapLocation | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState<boolean>(false);
  const [drawerMode, setDrawerMode] = useState<'location' | 'mazgal' | 'protagonist'>('location');
  const [protagonistTab, setProtagonistTab] = useState<'status' | 'bag' | 'party' | 'relations' | 'moments'>('status');
  const [selectedMazgalId, setSelectedMazgalId] = useState<string>(
    initial.protagonist?.mazgalId ?? 'G4'
  );
  const [confirmReset, setConfirmReset] = useState<boolean>(false);
  const [resetKey, setResetKey] = useState<number>(0);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [narrativePending, setNarrativePending] = useState<boolean>(false);
  const [narrativeError, setNarrativeError] = useState<string | null>(null);
  const [failedNarrativeAttempt, setFailedNarrativeAttempt] = useState<{
    text: string;
    choice?: NarrativeChoice;
  } | null>(null);
  const [narrativeSettingsOpen, setNarrativeSettingsOpen] = useState<boolean>(false);
  const [aiSettings, setAiSettings] = useState<NarrativeAiSettings>(
    initial.aiSettings ?? DEFAULT_AI_SETTINGS
  );
  const playArenaRef = useRef<HTMLDivElement>(null);

  const mazgalCells = useMemo(
    () => buildMazgalGrid(locations, activeWeatherKey, protagonist.activeWorldWave ?? null),
    [locations, activeWeatherKey, protagonist.activeWorldWave]
  );

  const [narrativeMessages, setNarrativeMessages] = useState<NarrativeMessage[]>(() => {
    if (Array.isArray(initial.narrativeMessages) && initial.narrativeMessages.length > 0) {
      return initial.narrativeMessages;
    }
    const initCells = buildMazgalGrid(
      initial.locations,
      initial.activeWeatherKey ?? 'mist',
      initial.protagonist?.activeWorldWave ?? null
    );
    const startProtag = hydrateProtagonist(
      initial.protagonist ?? createInitialProtagonist(initial.locations),
      initial.locations
    );
    const startLoc = startProtag.locationId
      ? initial.locations.find((l) => l.id === startProtag.locationId)
      : undefined;
    const startCell = initCells.find((c) => c.id === startProtag.mazgalId) ?? initCells[0];
    return createInitialNarrativeMessages({
      protagonist: startProtag,
      currentLocation: startLoc,
      currentMazgal: startCell,
      allLocations: initial.locations,
      routes: initial.routes,
      activeWeatherKey: initial.activeWeatherKey ?? 'mist',
      gameTimeMs: initial.gameTimeMs ?? INITIAL_GAME_TIME_MS,
    });
  });

  useEffect(() => {
    try {
      const payload: PersistedState = {
        locations,
        routes,
        partyLocationId,
        journeyLog,
        gameTimeMs,
        protagonist,
        activeWeatherKey,
        narrativeMessages: narrativeMessages.slice(-80),
        aiSettings,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // Ignore storage quota errors
    }
  }, [
    locations,
    routes,
    partyLocationId,
    journeyLog,
    gameTimeMs,
    protagonist,
    activeWeatherKey,
    narrativeMessages,
    aiSettings,
  ]);

  useEffect(() => {
    soundFx.enabled = soundEnabled;
  }, [soundEnabled]);

  useEffect(() => {
    const onFullscreenChange = () => {
      if (!document.fullscreenElement) {
        setIsFullscreen(false);
      }
    };
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsPlacingPin(false);
        setPendingCoords(null);
        setEditingLocation(null);
        setInspectorOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const handleToggleFullscreen = async () => {
    const next = !isFullscreen;
    setIsFullscreen(next);
    try {
      if (next && playArenaRef.current?.requestFullscreen) {
        await playArenaRef.current.requestFullscreen();
      } else if (!next && document.fullscreenElement) {
        await document.exitFullscreen();
      }
    } catch {
      // Fallback to in-page fixed 100vh fullscreen layout when Fullscreen API is blocked
    }
  };

  const selectedLocation = locations.find((l) => l.id === selectedLocationId) ?? locations[0];
  const selectedMazgal = mazgalCells.find((c) => c.id === selectedMazgalId) ?? mazgalCells[0];
  const protagonistCurrentLoc = protagonist.locationId
    ? locations.find((l) => l.id === protagonist.locationId)
    : undefined;
  const protagonistCurrentCell =
    mazgalCells.find((c) => c.id === protagonist.mazgalId) ?? mazgalCells[0];

  const processWorldTick = (
    draftProtag: ProtagonistState,
    prevMs: number,
    nextMs: number,
    arrivalLoc?: MapLocation,
    arrivalCell?: MazgalCell,
    checkGuardsOnArrival = false
  ): {
    finalProtag: ProtagonistState;
    notices: string[];
    roamingArrivals: RoamingArrivalEvent[];
  } => {
    const notices: string[] = [];
    let current = advancePartyAndContactsWithTime(
      draftProtag,
      locations,
      routes,
      prevMs,
      nextMs
    );

    const waveRes = advanceContractsAndWaves(current, prevMs, nextMs);
    current = waveRes.nextProtagonist;
    if (waveRes.waveAnnouncement) notices.push(waveRes.waveAnnouncement);

    const weatherRes = advanceRegionalWeatherWithTime(
      activeWeatherKey,
      current.activeWorldWave,
      prevMs,
      nextMs
    );
    if (weatherRes.nextWeather !== activeWeatherKey) {
      setActiveWeatherKey(weatherRes.nextWeather);
    }
    if (weatherRes.weatherNotice) {
      notices.push(weatherRes.weatherNotice);
    }

    const roamRes = advanceRoamingUnitsWithTime(
      current.roamingUnits ?? [],
      locations,
      routes,
      prevMs,
      nextMs
    );
    current = {
      ...current,
      roamingUnits: roamRes.nextUnits,
    };
    if (roamRes.notices.length > 0) {
      notices.push(...roamRes.notices);
    }

    if (checkGuardsOnArrival && arrivalLoc) {
      const mods = getProtagonistModifiers(
        current,
        arrivalLoc,
        arrivalCell ?? protagonistCurrentCell
      );
      const guardRes = checkGuardEncounterOnArrival(current, arrivalLoc, nextMs, mods);
      current = guardRes.nextProtagonist;
      if (guardRes.alertNote) notices.push(guardRes.alertNote);
    }

    const critRes = evaluateCriticalHealthRecovery(
      current,
      arrivalLoc ?? protagonistCurrentLoc,
      arrivalCell ?? protagonistCurrentCell,
      nextMs
    );
    current = critRes.nextProtagonist;
    if (critRes.recoveryNotice) notices.push(critRes.recoveryNotice);

    return { finalProtag: current, notices, roamingArrivals: roamRes.arrivals };
  };

  const applyLocationsTick = (
    prevLocs: MapLocation[],
    prevMs: number,
    nextMs: number,
    updatedProtag: ProtagonistState,
    roamingArrivals: RoamingArrivalEvent[] = []
  ): MapLocation[] => {
    const prevDay = Math.floor((prevMs - INITIAL_GAME_TIME_MS) / (24 * 60 * 60 * 1000));
    const nextDay = Math.floor((nextMs - INITIAL_GAME_TIME_MS) / (24 * 60 * 60 * 1000));
    const daysCrossed = Math.max(0, nextDay - prevDay);
    const wave = updatedProtag.activeWorldWave;
    let baseLocs = prevLocs;

    if (roamingArrivals.length > 0) {
      baseLocs = baseLocs.map((loc) => {
        const hits = roamingArrivals.filter((a) => a.locationId === loc.id);
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
    return advanceLivingLocations(baseLocs, nextMs, routes, updatedProtag);
  };

  const advanceCampaignClock = (hours: number, summary: string): number => {
    const safeHours = Math.max(1, Math.round(hours));
    const nextMs = addGameHours(gameTimeMs, safeHours);
    setGameTimeMs(nextMs);
    const { finalProtag, notices, roamingArrivals } = processWorldTick(
      protagonist,
      gameTimeMs,
      nextMs
    );
    setLastTimeAction(
      notices.length > 0
        ? `${summary} (+${formatTravelHours(safeHours)}) · ${notices[0]}`
        : `${summary} (+${formatTravelHours(safeHours)})`
    );
    setProtagonist(finalProtag);
    setLocations((prev) =>
      applyLocationsTick(prev, gameTimeMs, nextMs, finalProtag, roamingArrivals)
    );
    return nextMs;
  };

  const handleResolveVillageProblem = (locationId: string, problemId: string): string => {
    soundFx.playDiceRoll();
    const targetLoc = locations.find((l) => l.id === locationId);
    const targetCell = targetLoc
      ? mazgalCells.find((c) => c.id === getCellForCoords(targetLoc.x, targetLoc.y).id) ??
        protagonistCurrentCell
      : protagonistCurrentCell;
    const nextMs = addGameHours(gameTimeMs, 3);
    setGameTimeMs(nextMs);

    const attempt = resolveSettlementProblemAttempt(
      protagonist,
      targetLoc,
      problemId,
      targetCell,
      nextMs
    );
    const { finalProtag, notices, roamingArrivals } = processWorldTick(
      attempt.nextProtagonist,
      gameTimeMs,
      nextMs,
      targetLoc,
      targetCell
    );
    setProtagonist(finalProtag);

    setLocations((prev) => {
      const updated = prev.map((loc) => {
        if (loc.id !== locationId) return loc;
        if (attempt.solved) {
          return resolveSettlementProblemByParty(loc, problemId, nextMs);
        }
        if (!loc.livingState) return loc;
        return {
          ...loc,
          livingState: {
            ...loc.livingState,
            activeProblems: loc.livingState.activeProblems.map((p) =>
              p.id === problemId ? { ...p, attempts: p.attempts + 1 } : p
            ),
          },
        };
      });
      return applyLocationsTick(updated, gameTimeMs, nextMs, finalProtag, roamingArrivals);
    });

    const fullMsg = notices.length > 0 ? `${attempt.message} ${notices[0]}` : attempt.message;
    setLastTimeAction(`${targetLoc?.name ?? 'Yerleşim'} Müdahale (+3 Saat)`);
    return fullMsg;
  };

  const handleRecordProceduralScene = (scene: ProceduralSceneCard, advanceHours: number) => {
    soundFx.playSelectChime();
    let targetTimeMs = gameTimeMs;
    let currentProtag = protagonist;
    let arrivals: RoamingArrivalEvent[] = [];
    if (advanceHours > 0) {
      targetTimeMs = addGameHours(gameTimeMs, advanceHours);
      setGameTimeMs(targetTimeMs);
      const { finalProtag, notices, roamingArrivals } = processWorldTick(
        protagonist,
        gameTimeMs,
        targetTimeMs
      );
      currentProtag = finalProtag;
      arrivals = roamingArrivals;
      setLastTimeAction(
        notices.length > 0
          ? `${scene.title} (+${formatTravelHours(advanceHours)}) · ${notices[0]}`
          : `${scene.title} (+${formatTravelHours(advanceHours)})`
      );
      setProtagonist(currentProtag);
    }
    setLocations((prev) => {
      const updatedWithScene = prev.map((loc) =>
        loc.id === scene.locationId
          ? recordProceduralSceneOnLocation(loc, scene, targetTimeMs)
          : loc
      );
      return advanceHours > 0
        ? applyLocationsTick(updatedWithScene, gameTimeMs, targetTimeMs, currentProtag, arrivals)
        : updatedWithScene;
    });
    setJourneyLog((prev) => [
      {
        id: `log-proc-${Date.now()}`,
        locationId: scene.locationId,
        locationName: scene.locationName,
        timestamp: formatGameDateTime(targetTimeMs),
        note: `${scene.title} (${scene.checkLabel}).`,
      },
      ...prev,
    ]);
  };

  const handlePerformProtagonistAction = (actionType: ProtagonistActionType) => {
    soundFx.playSelectChime();
    const hours = ACTION_HOURS[actionType];
    const actionNames: Record<ProtagonistActionType, string> = {
      observe: 'Çevre Gözlemi',
      converse: 'Yerlilerle Görüşme',
      forage_or_work: 'İş / Avlanma',
      help_settlement: 'Bölge Desteği',
      rest_camp: 'Kamp ve Dinlenme',
    };
    const nextMs = addGameHours(gameTimeMs, hours);
    setGameTimeMs(nextMs);

    const outcome = performProtagonistAction(
      protagonist,
      actionType,
      protagonistCurrentLoc,
      protagonistCurrentCell,
      nextMs
    );
    const { finalProtag, notices, roamingArrivals } = processWorldTick(
      outcome.nextProtagonist,
      gameTimeMs,
      nextMs,
      protagonistCurrentLoc,
      protagonistCurrentCell
    );
    setLastTimeAction(
      notices.length > 0
        ? `${actionNames[actionType]} (+${formatTravelHours(hours)}) · ${notices[0]}`
        : `${actionNames[actionType]} (+${formatTravelHours(hours)})`
    );
    setProtagonist(finalProtag);

    setLocations((prev) => {
      const shifted = protagonistCurrentLoc
        ? prev.map((loc) =>
            loc.id === protagonistCurrentLoc.id
              ? applyExternalMoraleShift(
                  loc,
                  outcome.locationMoraleDelta,
                  nextMs,
                  `${protagonist.name} Etkisi`,
                  outcome.locationEventNote
                )
              : loc
          )
        : prev;
      return applyLocationsTick(shifted, gameTimeMs, nextMs, finalProtag, roamingArrivals);
    });

    if (hours >= 3) {
      setJourneyLog((prev) => [
        {
          id: `log-${Date.now()}`,
          locationId: protagonistCurrentLoc?.id ?? 'loc-kuldere',
          locationName: protagonistCurrentLoc?.name ?? `Mazgal ${protagonistCurrentCell.id}`,
          timestamp: formatGameDateTime(nextMs),
          note: outcome.nextProtagonist.journal[0]?.detail ?? `${actionNames[actionType]} tamamlandı.`,
        },
        ...prev,
      ]);
    }
  };

  const handleEatRation = () => {
    if (protagonist.rations <= 0) return;
    soundFx.playSelectChime();
    setProtagonist((prev) => ({
      ...prev,
      rations: prev.rations - 1,
      hunger: Math.max(0, prev.hunger - 45),
      stamina: Math.min(100, prev.stamina + 8),
      lastObservation: '1 porsiyon kuru erzak tükettin; açlığın yatıştı ve gücün toplandı.',
    }));
  };

  const handleRenameProtagonist = (name: string, title: string) => {
    setProtagonist((prev) => ({ ...prev, name, title }));
  };

  const handleApplyEncounterOutcome = (
    result: 'victory' | 'costly' | 'flee',
    title: string,
    locationId?: string
  ) => {
    soundFx.playSelectChime();
    const targetLoc = locationId
      ? locations.find((l) => l.id === locationId)
      : protagonistCurrentLoc;
    const cell = targetLoc
      ? mazgalCells.find((c) => c.id === getCellForCoords(targetLoc.x, targetLoc.y).id) ??
        protagonistCurrentCell
      : protagonistCurrentCell;

    const { nextProtagonist, moraleDelta } = applyEncounterResultToProtagonist(
      protagonist,
      result,
      title,
      targetLoc,
      cell,
      gameTimeMs
    );
    const critRes = evaluateCriticalHealthRecovery(nextProtagonist, targetLoc, cell, gameTimeMs);
    setProtagonist(critRes.nextProtagonist);
    if (critRes.recoveryNotice) setLastTimeAction(critRes.recoveryNotice);
    if (targetLoc && moraleDelta !== 0) {
      setLocations((prev) =>
        prev.map((loc) =>
          loc.id === targetLoc.id
            ? applyExternalMoraleShift(
                loc,
                moraleDelta,
                gameTimeMs,
                title,
                `${protagonist.name} karşılaşma sonucu bölgeye yansıdı.`
              )
            : loc
        )
      );
    }
  };

  const handleResolveInteractiveChoice = (
    choice: EncounterChoiceId,
    title: string,
    dc: number,
    locationId?: string
  ): string => {
    soundFx.playDiceRoll();
    const targetLoc = locationId
      ? locations.find((l) => l.id === locationId)
      : protagonistCurrentLoc;
    const cell = targetLoc
      ? mazgalCells.find((c) => c.id === getCellForCoords(targetLoc.x, targetLoc.y).id) ??
        protagonistCurrentCell
      : protagonistCurrentCell;

    const nextMs = addGameHours(gameTimeMs, 1);
    setGameTimeMs(nextMs);
    const mods = getProtagonistModifiers(protagonist, targetLoc, cell);
    const res = resolveInteractiveEncounterChoice(
      protagonist,
      choice,
      title,
      dc,
      targetLoc,
      cell,
      nextMs,
      mods
    );
    const { finalProtag, notices, roamingArrivals } = processWorldTick(
      res.nextProtagonist,
      gameTimeMs,
      nextMs,
      targetLoc,
      cell
    );
    setProtagonist(finalProtag);

    setLocations((prev) => {
      const shifted =
        targetLoc && res.moraleDelta !== 0
          ? prev.map((loc) =>
              loc.id === targetLoc.id
                ? applyExternalMoraleShift(
                    loc,
                    res.moraleDelta,
                    nextMs,
                    title,
                    res.summaryText
                  )
                : loc
            )
          : prev;
      return applyLocationsTick(shifted, gameTimeMs, nextMs, finalProtag, roamingArrivals);
    });

    const fullMsg = notices.length > 0 ? `${res.summaryText} ${notices[0]}` : res.summaryText;
    setLastTimeAction(`${title} (+1 Saat)`);
    return fullMsg;
  };

  const handleApplyMazgalEvent = (cell: MazgalCell, ev: MazgalProceduralEvent) => {
    soundFx.playSelectChime();
    const nextMs = addGameHours(gameTimeMs, 1);
    setGameTimeMs(nextMs);

    const { nextProtagonist, localMoraleDelta } = applyMazgalEventToProtagonist(
      protagonist,
      cell,
      ev.title,
      ev.kind,
      ev.outcomeNote,
      nextMs
    );
    const insideLoc = cell.locationsInside[0];
    const { finalProtag, notices, roamingArrivals } = processWorldTick(
      nextProtagonist,
      gameTimeMs,
      nextMs,
      insideLoc,
      cell
    );
    setLastTimeAction(
      notices.length > 0
        ? `Mazgal ${cell.id}: ${ev.title} (+1 Saat) · ${notices[0]}`
        : `Mazgal ${cell.id}: ${ev.title} (+1 Saat)`
    );
    setProtagonist(finalProtag);

    setLocations((prev) => {
      const shifted =
        insideLoc && localMoraleDelta !== 0
          ? prev.map((loc) =>
              loc.id === insideLoc.id
                ? applyExternalMoraleShift(
                    loc,
                    localMoraleDelta,
                    nextMs,
                    ev.title,
                    `Mazgal ${cell.id} olayından gelen etki yerleşime yansıdı.`
                  )
                : loc
            )
          : prev;
      return applyLocationsTick(shifted, gameTimeMs, nextMs, finalProtag, roamingArrivals);
    });

    setJourneyLog((prev) => [
      {
        id: `log-mzg-${Date.now()}`,
        locationId: insideLoc?.id ?? partyLocationId,
        locationName: insideLoc ? insideLoc.name : `Mazgal ${cell.id} (${cell.terrainLabel})`,
        timestamp: formatGameDateTime(nextMs),
        note: `${ev.title}: ${ev.outcomeNote}`,
      },
      ...prev,
    ]);
  };

  const handleWeatherChanged = (nextWeather: WeatherConditionKey, label?: string) => {
    setActiveWeatherKey(nextWeather);
    if (label) {
      setLastTimeAction(`Hava Değişti: ${label}`);
    }
  };

  const handleSelectLocation = (id: string) => {
    soundFx.playSelectChime();
    setSelectedLocationId(id);
    setDrawerMode('location');
    setInspectorOpen(true);
  };

  const handleSelectMazgal = (mazgalId: string) => {
    soundFx.playSelectChime();
    setSelectedMazgalId(mazgalId);
    setDrawerMode('mazgal');
    setInspectorOpen(true);
  };

  const handleOpenProtagonist = (tab: 'status' | 'bag' | 'party' | 'relations' | 'moments' = 'status') => {
    soundFx.playSelectChime();
    setProtagonistTab(tab);
    setDrawerMode('protagonist');
    setInspectorOpen(true);
  };

  const handleShadowAction = (action: ShadowActionType): string => {
    soundFx.playDiceRoll();
    const hours = action === 'spread_discord' ? 1 : 2;
    const nextMs = addGameHours(gameTimeMs, hours);
    setGameTimeMs(nextMs);
    const mods = getProtagonistModifiers(protagonist, protagonistCurrentLoc, protagonistCurrentCell);
    const res = performShadowAction(
      protagonist,
      action,
      protagonistCurrentLoc,
      protagonistCurrentCell,
      nextMs,
      mods
    );
    const { finalProtag, notices, roamingArrivals } = processWorldTick(
      res.nextProtagonist,
      gameTimeMs,
      nextMs,
      protagonistCurrentLoc,
      protagonistCurrentCell
    );
    setProtagonist(finalProtag);
    setLocations((prev) => {
      const shifted = protagonistCurrentLoc
        ? prev.map((loc) =>
            loc.id === protagonistCurrentLoc.id
              ? applyExternalMoraleShift(
                  loc,
                  res.locationMoraleDelta,
                  nextMs,
                  res.locationNoteTitle,
                  res.locationNoteDetail
                )
              : loc
          )
        : prev;
      return applyLocationsTick(shifted, gameTimeMs, nextMs, finalProtag, roamingArrivals);
    });
    const fullFeedback = notices.length > 0 ? `${res.feedbackText} ${notices[0]}` : res.feedbackText;
    setLastTimeAction(`${res.locationNoteTitle ?? 'Karanlık Eylem'} (+${hours} Saat)`);
    setJourneyLog((prev) => [
      {
        id: `log-shd-${Date.now()}`,
        locationId: protagonistCurrentLoc?.id ?? partyLocationId,
        locationName: protagonistCurrentLoc?.name ?? `Mazgal ${protagonistCurrentCell.id}`,
        timestamp: formatGameDateTime(nextMs),
        note: fullFeedback,
      },
      ...prev,
    ]);
    return fullFeedback;
  };

  const handleUseItem = (itemId: InventoryItemId): string => {
    soundFx.playSelectChime();
    const res = useInventoryItem(protagonist, itemId, gameTimeMs);
    setProtagonist(res.nextProtagonist);
    setLastTimeAction(res.message);
    return res.message;
  };

  const handleBuyItem = (itemId: 'rations' | InventoryItemId): string => {
    soundFx.playSelectChime();
    const res = buyMarketItem(protagonist, protagonistCurrentLoc, itemId, gameTimeMs);
    setProtagonist(res.nextProtagonist);
    setLastTimeAction(res.message);
    return res.message;
  };

  const handleSellItem = (itemId: 'rations' | InventoryItemId): string => {
    soundFx.playSelectChime();
    const res = sellMarketItem(protagonist, protagonistCurrentLoc, itemId, gameTimeMs);
    setProtagonist(res.nextProtagonist);
    setLastTimeAction(res.message);
    return res.message;
  };

  const handleBuySlave = (listingId: string, mode: 'bond_retainer' | 'manumit'): string => {
    soundFx.playSelectChime();
    const res = buySlaveForParty(protagonist, protagonistCurrentLoc, listingId, mode, gameTimeMs);
    setProtagonist(res.nextProtagonist);
    setLastTimeAction(res.message);
    return res.message;
  };

  const handleSellCaptive = (): string => {
    soundFx.playSelectChime();
    const res = sellCaptiveAtMarket(protagonist, protagonistCurrentLoc, gameTimeMs);
    setProtagonist(res.nextProtagonist);
    setLastTimeAction(res.message);
    return res.message;
  };

  const handleSellBondedNpc = (contactId: string): string => {
    soundFx.playSelectChime();
    const res = sellBondedRetainerAtMarket(protagonist, contactId, protagonistCurrentLoc, gameTimeMs);
    setProtagonist(res.nextProtagonist);
    setLastTimeAction(res.message);
    return res.message;
  };

  const handleFreeBondedNpc = (contactId: string): string => {
    soundFx.playSelectChime();
    const res = freeBondedRetainer(protagonist, contactId, gameTimeMs);
    setProtagonist(res.nextProtagonist);
    setLastTimeAction(res.message);
    return res.message;
  };

  const handleAcceptContract = (contract: ActiveContract): string => {
    soundFx.playSelectChime();
    const res = acceptContract(protagonist, contract);
    setProtagonist(res.nextProtagonist);
    setLastTimeAction(res.message);
    return res.message;
  };

  const handleCompleteContract = (contractId: string): string => {
    soundFx.playSelectChime();
    const res = tryCompleteContractAtLocation(
      protagonist,
      contractId,
      protagonistCurrentLoc,
      gameTimeMs
    );
    setProtagonist(res.nextProtagonist);
    if (protagonistCurrentLoc && res.locationMoraleDelta !== 0) {
      setLocations((prev) =>
        prev.map((loc) =>
          loc.id === protagonistCurrentLoc.id
            ? applyExternalMoraleShift(
                loc,
                res.locationMoraleDelta,
                gameTimeMs,
                'Kontrat Teslimi',
                res.message
              )
            : loc
        )
      );
    }
    setLastTimeAction(res.message);
    return res.message;
  };

  const handlePayBounty = (): string => {
    soundFx.playSelectChime();
    const res = payBountyAtSettlement(protagonist, protagonistCurrentLoc, gameTimeMs);
    setProtagonist(res.nextProtagonist);
    setLastTimeAction(res.message);
    return res.message;
  };

  const handleNpcInteraction = (contactId: string, action: NpcInteractionType): string => {
    soundFx.playSelectChime();
    const mods = getProtagonistModifiers(
      protagonist,
      protagonistCurrentLoc,
      protagonistCurrentCell
    );
    const previewTimeMs =
      action === 'talk' ||
      action === 'flirt_or_romance' ||
      action === 'seduce_or_charm' ||
      action === 'confront_or_test' ||
      action === 'exploit_or_rob_npc'
        ? addGameHours(gameTimeMs, 1)
        : gameTimeMs;

    const {
      nextProtagonist,
      feedbackText,
      hoursSpent,
      locationMoraleDelta,
      locationNoteTitle,
      locationNoteDetail,
    } = interactWithLivingNpc(
      protagonist,
      contactId,
      action,
      protagonistCurrentLoc,
      protagonistCurrentCell,
      previewTimeMs,
      mods,
      routes,
      locations
    );

    if (hoursSpent > 0) {
      setGameTimeMs(previewTimeMs);
      const { finalProtag, notices } = processWorldTick(
        nextProtagonist,
        gameTimeMs,
        previewTimeMs,
        protagonistCurrentLoc,
        protagonistCurrentCell
      );
      setLastTimeAction(
        notices.length > 0
          ? `${feedbackText} (+${hoursSpent} Saat) · ${notices[0]}`
          : `${feedbackText} (+${hoursSpent} Saat)`
      );
      setProtagonist(finalProtag);
      setLocations((prev) => {
        const shifted =
          protagonistCurrentLoc && (locationMoraleDelta || locationNoteDetail)
            ? prev.map((loc) =>
                loc.id === protagonistCurrentLoc.id
                  ? applyExternalMoraleShift(
                      loc,
                      locationMoraleDelta ?? 0,
                      previewTimeMs,
                      locationNoteTitle,
                      locationNoteDetail
                    )
                  : loc
              )
            : prev;
        return applyLocationsTick(shifted, gameTimeMs, previewTimeMs, finalProtag);
      });
    } else {
      setProtagonist(nextProtagonist);
    }
    return feedbackText;
  };

  const handleMeetProceduralNpc = (npc: ProceduralNpcCard, locationId?: string) => {
    soundFx.playSelectChime();
    const targetLoc = locationId
      ? locations.find((l) => l.id === locationId)
      : protagonistCurrentLoc;
    const cell = targetLoc
      ? mazgalCells.find((c) => c.id === getCellForCoords(targetLoc.x, targetLoc.y).id) ??
        protagonistCurrentCell
      : protagonistCurrentCell;
    const newContact = createContactFromProceduralNpc(npc, targetLoc, cell, gameTimeMs);
    const ts = formatGameDateTime(gameTimeMs);
    const placeLabel = targetLoc?.name ?? `Mazgal ${cell.id}`;
    setProtagonist((prev) => {
      const existing = prev.contacts ?? [];
      if (existing.some((c) => c.name === newContact.name && c.currentLocationId === newContact.currentLocationId)) {
        return prev;
      }
      return {
        ...prev,
        contacts: [newContact, ...existing],
        npcMoments: appendNpcMoment(
          prev.npcMoments,
          createNpcMomentRecord({
            npcId: newContact.id,
            npcName: newContact.name,
            npcRole: newContact.role,
            timestamp: ts,
            timestampMs: gameTimeMs,
            locationLabel: placeLabel,
            category: 'Tanışma',
            title: `${newContact.name} ile Karşılaşma`,
            summary: newContact.lastReaction,
            moodAfter: newContact.mood,
            significance: 'olağan',
          })
        ),
      };
    });
    setActiveTab('map');
    setProtagonistTab('relations');
    setDrawerMode('protagonist');
    setInspectorOpen(true);
  };

  const handleMeetResident = (resident: SettlementResident, locationId: string) => {
    soundFx.playSelectChime();
    const targetLoc = locations.find((l) => l.id === locationId);
    if (!targetLoc) return;
    const newContact = createContactFromResident(resident, targetLoc, gameTimeMs);
    const ts = formatGameDateTime(gameTimeMs);
    setProtagonist((prev) => {
      const existing = prev.contacts ?? [];
      if (existing.some((c) => c.name === newContact.name)) {
        return prev;
      }
      return {
        ...prev,
        contacts: [newContact, ...existing],
        npcMoments: appendNpcMoment(
          prev.npcMoments,
          createNpcMomentRecord({
            npcId: newContact.id,
            npcName: newContact.name,
            npcRole: newContact.role,
            timestamp: ts,
            timestampMs: gameTimeMs,
            locationLabel: targetLoc.name,
            category: 'Tanışma',
            title: `${newContact.name} ile Yerleşimde Tanışma`,
            summary: newContact.lastReaction,
            moodAfter: newContact.mood,
            significance: 'olağan',
          })
        ),
      };
    });
    setProtagonistTab('relations');
    setDrawerMode('protagonist');
    setInspectorOpen(true);
  };

  const handleChangeTravelMode = (pace: TravelPace, transport: TravelTransport) => {
    soundFx.playSelectChime();
    setProtagonist((prev) => ({
      ...prev,
      travelPace: pace,
      travelTransport: transport,
    }));
  };

  const handleInteractRoamingUnit = (
    unitId: string,
    mode: 'greet_trade' | 'escort_aid' | 'ambush_raid'
  ): string => {
    soundFx.playDiceRoll();
    const nextMs = addGameHours(gameTimeMs, 1);
    setGameTimeMs(nextMs);
    const res = interactWithRoamingUnit(
      protagonist,
      unitId,
      mode,
      protagonistCurrentCell,
      nextMs
    );
    const { finalProtag, notices, roamingArrivals } = processWorldTick(
      res.nextProtagonist,
      gameTimeMs,
      nextMs,
      protagonistCurrentLoc,
      protagonistCurrentCell
    );
    setProtagonist(finalProtag);
    setLocations((prev) =>
      applyLocationsTick(prev, gameTimeMs, nextMs, finalProtag, roamingArrivals)
    );
    const fullMsg = notices.length > 0 ? `${res.message} ${notices[0]}` : res.message;
    setLastTimeAction(`Yol Karşılaşması (+1 Saat)`);
    return fullMsg;
  };

  const computeEffectiveTravelHours = (
    baseHours: number,
    hasDirectRoute: boolean,
    requiresBoat: boolean
  ): number => {
    const pace = protagonist.travelPace ?? 'normal';
    const transport = protagonist.travelTransport ?? 'foot';
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
      activeWeatherKey === 'storm'
        ? 1.4
        : activeWeatherKey === 'rain'
        ? 1.22
        : activeWeatherKey === 'mist'
        ? 1.12
        : 1.0;
    return Math.max(1, Math.round(baseHours * paceMult * transportMult * weatherMult));
  };

  const handleStepMazgal = (fromId: string, nb: MazgalNeighborSummary) => {
    const pace = protagonist.travelPace ?? 'normal';
    const transport = protagonist.travelTransport ?? 'foot';
    const adjustedHours = computeEffectiveTravelHours(
      nb.travelHours,
      false,
      Boolean(nb.requiresBoat)
    );
    const nextMs = addGameHours(gameTimeMs, adjustedHours);
    setGameTimeMs(nextMs);

    const targetCell = mazgalCells.find((c) => c.id === nb.id) ?? protagonistCurrentCell;
    const locInside = targetCell.locationsInside[0];
    const { nextProtagonist, localMoraleDelta } = applyProtagonistTravel(
      protagonist,
      locInside,
      targetCell,
      adjustedHours,
      nextMs,
      {
        pace,
        transport,
        weather: activeWeatherKey,
        requiresBoat: Boolean(nb.requiresBoat),
      }
    );
    const { finalProtag, notices, roamingArrivals } = processWorldTick(
      nextProtagonist,
      gameTimeMs,
      nextMs,
      locInside,
      targetCell,
      Boolean(locInside)
    );
    setLastTimeAction(
      notices.length > 0
        ? `Mazgal ${fromId} → ${nb.id} (+${formatTravelHours(adjustedHours)}) · ${notices[0]}`
        : `Mazgal ${fromId} → ${nb.id} (+${formatTravelHours(adjustedHours)})`
    );
    setProtagonist(finalProtag);
    if (locInside) {
      setPartyLocationId(locInside.id);
    }

    setLocations((prev) => {
      const updated = prev.map((loc) => {
        if (locInside && loc.id === locInside.id) {
          const discoveredLoc = { ...loc, discovered: true };
          return applyExternalMoraleShift(discoveredLoc, localMoraleDelta, nextMs);
        }
        return loc;
      });
      return applyLocationsTick(updated, gameTimeMs, nextMs, finalProtag, roamingArrivals);
    });

    setJourneyLog((prev) => [
      {
        id: `log-${Date.now()}`,
        locationId: locInside?.id ?? partyLocationId,
        locationName: locInside ? locInside.name : `Mazgal ${nb.id} (${nb.direction})`,
        timestamp: formatGameDateTime(nextMs),
        note: `Mazgal ${fromId} karesinden ${nb.id} karesine ${formatTravelHours(adjustedHours)} (${nb.distanceFersah} Fersah) yürüdün.`,
      },
      ...prev,
    ]);

    setNarrativeMessages((prev) => [
      ...prev.slice(-79),
      createTravelNarrativeNotice(
        {
          protagonist: finalProtag,
          currentLocation: locInside,
          currentMazgal: targetCell,
          allLocations: locations,
          routes,
          activeWeatherKey,
          gameTimeMs: nextMs,
        },
        finalProtag.lastObservation
      ),
    ]);
  };

  const handleMoveParty = (id: string) => {
    const target = locations.find((l) => l.id === id);
    if (!target) return;
    const current = locations.find((l) => l.id === (protagonist.locationId ?? partyLocationId));
    soundFx.playMoveToken();

    const pace = protagonist.travelPace ?? 'normal';
    const transport = protagonist.travelTransport ?? 'foot';
    let baseHours = 12;
    let hasDirectRoute = false;
    let requiresBoat = false;
    const fromCellId = protagonist.mazgalId || (current ? getCellForCoords(current.x, current.y).id : 'B5');
    const toCellSummary = getCellForCoords(target.x, target.y);

    if (fromCellId === toCellSummary.id) {
      baseHours = Math.max(
        2,
        Math.round(Math.hypot(target.x - protagonist.x, target.y - protagonist.y) * 1.5)
      );
    } else {
      const directRoute = current
        ? routes.find(
            (r) =>
              (r.fromId === current.id && r.toId === target.id) ||
              (r.toId === current.id && r.fromId === target.id)
          )
        : undefined;
      if (directRoute) {
        baseHours = directRoute.travelHours;
        hasDirectRoute = true;
      } else {
        const plan = findShortestMazgalPath(fromCellId, toCellSummary.id, mazgalCells);
        baseHours = plan.hours;
        requiresBoat = plan.requiresBoat;
      }
    }

    const travelHours = computeEffectiveTravelHours(baseHours, hasDirectRoute, requiresBoat);
    const nextMs = addGameHours(gameTimeMs, travelHours);
    setGameTimeMs(nextMs);

    const targetCell = mazgalCells.find((c) => c.id === toCellSummary.id) ?? protagonistCurrentCell;
    const { nextProtagonist, localMoraleDelta } = applyProtagonistTravel(
      protagonist,
      target,
      targetCell,
      travelHours,
      nextMs,
      {
        pace,
        transport,
        weather: activeWeatherKey,
        requiresBoat,
      }
    );
    const { finalProtag, notices, roamingArrivals } = processWorldTick(
      nextProtagonist,
      gameTimeMs,
      nextMs,
      target,
      targetCell,
      true
    );
    const routeText = `${current && protagonist.locationId ? current.name : `Mazgal ${fromCellId}`} → ${target.name} (+${formatTravelHours(travelHours)})`;
    setLastTimeAction(notices.length > 0 ? `${routeText} · ${notices[0]}` : routeText);
    setProtagonist(finalProtag);
    setPartyLocationId(id);

    setLocations((prev) => {
      const updated = prev.map((loc) => {
        if (loc.id === id) {
          return applyExternalMoraleShift(
            { ...loc, discovered: true },
            localMoraleDelta,
            nextMs
          );
        }
        return loc;
      });
      return applyLocationsTick(updated, gameTimeMs, nextMs, finalProtag, roamingArrivals);
    });

    setJourneyLog((prev) => [
      {
        id: `log-${Date.now()}`,
        locationId: target.id,
        locationName: target.name,
        timestamp: formatGameDateTime(nextMs),
        note: `${target.name} bölgesine ${formatTravelHours(travelHours)} yürüyüşle ulaştın.`,
      },
      ...prev,
    ]);

    setNarrativeMessages((prev) => [
      ...prev.slice(-79),
      createTravelNarrativeNotice(
        {
          protagonist: finalProtag,
          currentLocation: target,
          currentMazgal: targetCell,
          allLocations: locations,
          routes,
          activeWeatherKey,
          gameTimeMs: nextMs,
        },
        finalProtag.lastObservation
      ),
    ]);
  };

  const handleSubmitNarrativeTurn = async (
    rawText: string,
    chosenOption?: NarrativeChoice
  ): Promise<boolean> => {
    if (narrativePending) return false;
    soundFx.playSelectChime();
    setNarrativeError(null);
    setNarrativePending(true);

    try {
      const res = await runAiNarrativeTurn({
        rawText,
        chosenOption,
        protagonist,
        locations,
        mazgalCells,
        routes,
        activeWeatherKey,
        gameTimeMs,
        partyLocationId,
        recentMessages: narrativeMessages,
        aiSettings,
      });

      if (res.movedThisTurn) {
        soundFx.playMoveToken();
      } else if (res.rolledDiceThisTurn) {
        soundFx.playDiceRoll();
      }

      setProtagonist(res.nextProtagonist);
      setLocations(res.nextLocations);
      setActiveWeatherKey(res.nextWeatherKey);
      setGameTimeMs(res.nextGameTimeMs);
      setPartyLocationId(res.nextPartyLocationId);
      if (res.lastTimeAction) {
        setLastTimeAction(res.lastTimeAction);
      }
      if (res.journeyEntries.length > 0) {
        setJourneyLog((prev) => [...res.journeyEntries, ...prev]);
      }
      setNarrativeMessages((prev) => [...prev.slice(-76), ...res.appendedMessages]);
      setFailedNarrativeAttempt(null);
      return true;
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : 'Yapay zeka anlatıcısı şu an yanıt veremiyor.';
      setFailedNarrativeAttempt({ text: rawText, choice: chosenOption });
      setNarrativeError(msg);
      return false;
    } finally {
      setNarrativePending(false);
    }
  };

  const handleResetNarrative = () => {
    soundFx.playSelectChime();
    setNarrativeError(null);
    setFailedNarrativeAttempt(null);
    setNarrativeMessages(
      createInitialNarrativeMessages({
        protagonist,
        currentLocation: protagonistCurrentLoc,
        currentMazgal: protagonistCurrentCell,
        allLocations: locations,
        routes,
        activeWeatherKey,
        gameTimeMs,
      })
    );
  };

  const handleEncounterRolled = (encounter: ForestEncounter) => {
    const nextMs = advanceCampaignClock(2, `Karşılaşma: ${encounter.title}`);
    const currentLoc = locations.find((l) => l.id === partyLocationId);
    setJourneyLog((prev) => [
      {
        id: `log-${Date.now()}`,
        locationId: currentLoc?.id ?? 'loc-kuldere',
        locationName: currentLoc?.name ?? 'Orman İçi',
        timestamp: formatGameDateTime(nextMs),
        note: `Karşılaşma (${encounter.type}): ${encounter.title} (+2 Saat).`,
      },
      ...prev,
    ]);
  };

  const handleToggleDiscovered = (id: string) => {
    soundFx.playSelectChime();
    const target = locations.find((loc) => loc.id === id);
    if (target && !target.discovered) {
      advanceCampaignClock(1, `Keşif: ${target.name}`);
    }
    setLocations((prev) =>
      prev.map((loc) => (loc.id === id ? { ...loc, discovered: !loc.discovered } : loc))
    );
  };

  const handleTogglePlacePin = () => {
    setActiveTab('map');
    setIsPlacingPin((prev) => !prev);
  };

  const handlePlacePinAt = (x: number, y: number) => {
    setIsPlacingPin(false);
    setEditingLocation(null);
    setPendingCoords({ x, y });
  };

  const handleSaveLocation = (data: Omit<MapLocation, 'id'> & { id?: string }) => {
    soundFx.playSelectChime();
    if (data.id) {
      setLocations((prev) =>
        prev.map((loc) => (loc.id === data.id ? { ...loc, ...data, id: data.id } : loc))
      );
      setSelectedLocationId(data.id);
    } else {
      const newId = `loc-custom-${Date.now()}`;
      const newLoc: MapLocation = {
        ...data,
        id: newId,
        isCustom: true,
      };
      setLocations((prev) => [...prev, newLoc]);
      setSelectedLocationId(newId);
      advanceCampaignClock(2, `Yeni Konum İşareti: ${data.name}`);
    }
    setPendingCoords(null);
    setEditingLocation(null);
  };

  const handleDeleteLocation = (id: string) => {
    setLocations((prev) => prev.filter((l) => l.id !== id));
    setRoutes((prev) => prev.filter((r) => r.fromId !== id && r.toId !== id));
    if (selectedLocationId === id) {
      setSelectedLocationId(locations[0]?.id ?? '');
    }
    if (partyLocationId === id) {
      setPartyLocationId(locations[0]?.id ?? '');
    }
  };

  const handleAddRoute = (route: Omit<MapRoute, 'id'>) => {
    soundFx.playSelectChime();
    setRoutes((prev) => [...prev, { ...route, id: `rt-${Date.now()}` }]);
  };

  const handleDeleteRoute = (id: string) => {
    setRoutes((prev) => prev.filter((r) => r.id !== id));
  };

  const handleImportCampaign = (
    nextLocations: MapLocation[],
    nextRoutes: MapRoute[],
    nextPartyId: string
  ) => {
    setLocations(nextLocations);
    setRoutes(nextRoutes);
    setPartyLocationId(nextPartyId);
    setSelectedLocationId(nextPartyId || nextLocations[0]?.id || '');
  };

  const handleResetAll = () => {
    soundFx.playSelectChime();
    localStorage.removeItem(STORAGE_KEY);
    setLocations(INITIAL_LOCATIONS);
    setRoutes(INITIAL_ROUTES);
    setPartyLocationId('');
    const freshProtag = createInitialProtagonist(INITIAL_LOCATIONS);
    const freshCells = buildMazgalGrid(INITIAL_LOCATIONS, 'mist', null);
    const startLoc = INITIAL_LOCATIONS.find((l) => l.id === freshProtag.locationId);
    const startCell = freshCells.find((c) => c.id === freshProtag.mazgalId) ?? freshCells[0];
    setProtagonist(freshProtag);
    setSelectedLocationId('loc-gumus-kopru');
    setSelectedMazgalId('G4');
    setDrawerMode('location');
    setInspectorOpen(false);
    setFogOfWar(false);
    setActiveWeatherKey('mist');
    setShowRoutes(true);
    setIsPlacingPin(false);
    setPendingCoords(null);
    setEditingLocation(null);
    setGameTimeMs(INITIAL_GAME_TIME_MS);
    setLastTimeAction('Başlangıca dönüldü: Eşref · Mazgal G4 (06.06.2026 · 08:00)');
    setConfirmReset(false);
    setResetKey((k) => k + 1);
    setJourneyLog([
      {
        id: 'log-reset',
        locationId: 'loc-gumus-kopru',
        locationName: 'Mazgal G4 (Sisli Çam ve Meşe Ormanı)',
        timestamp: formatGameDateTime(INITIAL_GAME_TIME_MS),
        note: 'Hafıza kaybı içinde yalnızca adının Eşref olduğunu hatırlayarak G4 mazgalındaki ormanda uyandın.',
      },
    ]);
    setNarrativeMessages(
      createInitialNarrativeMessages({
        protagonist: freshProtag,
        currentLocation: startLoc,
        currentMazgal: startCell,
        allLocations: INITIAL_LOCATIONS,
        routes: INITIAL_ROUTES,
        activeWeatherKey: 'mist',
        gameTimeMs: INITIAL_GAME_TIME_MS,
      })
    );
  };

  const currentDay = getDayNumber(gameTimeMs);
  const currentPhase = getDayPhaseLabel(gameTimeMs);
  const partyBonusSummary = getPartyBonusSummary(protagonist.contacts ?? []);

  return (
    <div className="flex min-h-screen flex-col bg-[#0D1512] text-[#EDE6D6]">
      <TopBar
        activeTab={activeTab}
        onTabChange={(tab) => {
          setActiveTab(tab);
          setIsPlacingPin(false);
        }}
        isPlacingPin={isPlacingPin}
        onTogglePlacePin={handleTogglePlacePin}
      />

      {/* Persistent In-Game Campaign Calendar, Protagonist Status & Clock Strip */}
      <div className="border-b border-[#D4A853]/12 bg-[#101A16]">
        <div className="mx-auto flex max-w-[1920px] flex-wrap items-center justify-between gap-3 px-4 py-2 text-xs sm:px-6">
          <div className="flex flex-wrap items-center gap-2.5 tabular-nums">
            <span className="inline-flex items-center gap-1.5 font-mono font-semibold text-[#F8F3E6]">
              <Calendar className="h-3.5 w-3.5 text-[#D4A853]" />
              {formatGameDate(gameTimeMs)}
            </span>
            <span aria-hidden="true" className="text-[#56665F]">·</span>
            <span className="inline-flex items-center gap-1.5 font-mono font-semibold text-[#D4A853]">
              <Clock className="h-3.5 w-3.5" />
              {formatGameHour(gameTimeMs)}
            </span>
            <span aria-hidden="true" className="text-[#56665F]">·</span>
            <span className="text-[#B7C4BE]">
              {currentDay}. Gün ({currentPhase})
            </span>
            <span aria-hidden="true" className="text-[#56665F]">·</span>
            <button
              type="button"
              onClick={() => {
                setActiveTab('map');
                handleOpenProtagonist('status');
              }}
              className="inline-flex items-center gap-1.5 rounded border border-[#67C7C0]/35 bg-[#13231F] px-2.5 py-0.5 text-[11px] font-medium text-[#9CE3DD] hover:border-[#67C7C0]/70 hover:bg-[#192F29] cursor-pointer"
            >
              <User className="h-3 w-3 text-[#67C7C0]" />
              <span>
                {protagonist.name} · Can {protagonist.health} · {partyBonusSummary.modeLabel}
              </span>
            </button>
            <button
              type="button"
              onClick={() => {
                setActiveTab('map');
                handleOpenProtagonist('bag');
              }}
              className="rounded border border-[#D4A853]/28 bg-[#1A241F] px-2 py-0.5 text-[11px] font-medium text-[#E8C472] hover:border-[#D4A853]/65 cursor-pointer"
            >
              Çanta ({protagonist.silver}g)
            </button>
            <button
              type="button"
              onClick={() => {
                setActiveTab('map');
                handleOpenProtagonist('party');
              }}
              className="rounded border border-[#D4A853]/28 bg-[#1A241F] px-2 py-0.5 text-[11px] font-medium text-[#E8C472] hover:border-[#D4A853]/65 cursor-pointer"
            >
              Parti & İlişkiler
            </button>
            {(protagonist.bountySilver ?? 0) > 0 && (
              <>
                <span aria-hidden="true" className="text-[#56665F]">·</span>
                <span className="font-mono text-[11px] font-semibold text-[#E89898]">
                  Ödül: {protagonist.bountySilver}g
                </span>
              </>
            )}
            {protagonist.activeWorldWave && (
              <>
                <span aria-hidden="true" className="hidden lg:inline text-[#56665F]">·</span>
                <span className="hidden lg:inline text-[11px] text-[#E29D72]">
                  Dalga: {protagonist.activeWorldWave.kind}
                </span>
              </>
            )}
            {lastTimeAction && (
              <>
                <span aria-hidden="true" className="hidden xl:inline text-[#56665F]">·</span>
                <span className="hidden xl:inline text-[#D4A853]">
                  {lastTimeAction}
                </span>
              </>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => handlePerformProtagonistAction('observe')}
              className="rounded border border-[#D4A853]/22 bg-[#17241F] px-2.5 py-1 text-[11px] font-medium text-[#D9D3C4] transition-colors hover:border-[#D4A853]/55 hover:text-[#F8F3E6] whitespace-nowrap cursor-pointer"
            >
              Gözlem (+1 Saat)
            </button>
            <button
              type="button"
              onClick={() => handlePerformProtagonistAction('converse')}
              className="rounded border border-[#D4A853]/22 bg-[#17241F] px-2.5 py-1 text-[11px] font-medium text-[#D9D3C4] transition-colors hover:border-[#D4A853]/55 hover:text-[#F8F3E6] whitespace-nowrap cursor-pointer"
            >
              Konuş (+1 Saat)
            </button>
            <button
              type="button"
              onClick={() => handlePerformProtagonistAction('help_settlement')}
              className="rounded border border-[#D4A853]/22 bg-[#17241F] px-2.5 py-1 text-[11px] font-medium text-[#D9D3C4] transition-colors hover:border-[#D4A853]/55 hover:text-[#F8F3E6] whitespace-nowrap cursor-pointer"
            >
              Destek Ol (+4 Saat)
            </button>
            <button
              type="button"
              onClick={() => handlePerformProtagonistAction('rest_camp')}
              className="rounded border border-[#67C7C0]/30 bg-[#14231F] px-2.5 py-1 text-[11px] font-medium text-[#9CE3DD] transition-colors hover:border-[#67C7C0]/60 hover:bg-[#192D28] whitespace-nowrap cursor-pointer"
            >
              Kamp Kur (+8 Saat)
            </button>

            <span aria-hidden="true" className="mx-0.5 hidden h-4 w-px bg-[#D4A853]/20 sm:inline-block" />

            {!confirmReset ? (
              <button
                type="button"
                onClick={() => setConfirmReset(true)}
                title="Her şeyi 06.06.2026 · 08:00 başlangıcına sıfırla"
                className="inline-flex items-center gap-1 rounded border border-[#DC6B6B]/30 bg-[#231718] px-2.5 py-1 text-[11px] font-medium text-[#E89898] transition-colors hover:border-[#DC6B6B]/60 hover:bg-[#2F1E20] whitespace-nowrap cursor-pointer"
              >
                <RotateCcw className="h-3 w-3" />
                Başa Sıfırla
              </button>
            ) : (
              <div className="inline-flex items-center gap-1 rounded border border-[#DC6B6B]/45 bg-[#26181A] px-2 py-0.5">
                <span className="text-[11px] text-[#F3D4D4] whitespace-nowrap">
                  06.06.2026&apos;ya dönülsün mü?
                </span>
                <button
                  type="button"
                  onClick={handleResetAll}
                  className="rounded bg-[#DC6B6B] px-2 py-0.5 text-[11px] font-semibold text-[#160B0B] hover:bg-[#E78383] whitespace-nowrap cursor-pointer"
                >
                  Evet, Sıfırla
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmReset(false)}
                  className="rounded px-1.5 py-0.5 text-[11px] text-[#C8B8B8] hover:text-white whitespace-nowrap cursor-pointer"
                >
                  Vazgeç
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <main className="flex-1">
        {activeTab === 'map' && (
          <div className="mx-auto w-full max-w-[1920px] px-4 py-4 sm:px-6">
            {/* Compact Regional Intro */}
            <div className="mb-3 flex flex-col justify-between gap-2 border-b border-[#D4A853]/15 pb-3 lg:flex-row lg:items-end">
              <div>
                <p className="text-xs font-medium text-[#D4A853]">
                  {REGION_INFO.continentPosition}
                </p>
                <h1 className="mt-0.5 font-display text-xl font-semibold text-[#F8F3E6] sm:text-2xl text-balance">
                  {REGION_INFO.title}
                </h1>
              </div>
              <p className="max-w-3xl text-xs sm:text-sm leading-relaxed text-[#A3B1AA]">
                {REGION_INFO.summary}
              </p>
            </div>

            {/* Full-Width Map Canvas & Narrative Chatbox Below (Single-Screen Arena in Fullscreen) */}
            <div
              ref={playArenaRef}
              className={
                isFullscreen
                  ? 'fixed inset-0 z-50 flex h-screen flex-col gap-2 overflow-hidden bg-[#080E0C] p-2.5 sm:p-3'
                  : 'flex flex-col gap-5'
              }
            >
              {isFullscreen && (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[#D4A853]/18 bg-[#101A16] px-3 py-1.5 text-xs shrink-0">
                  <div className="flex flex-wrap items-center gap-2 tabular-nums">
                    <span className="font-mono font-semibold text-[#F8F3E6]">
                      {formatGameDate(gameTimeMs)}
                    </span>
                    <span aria-hidden="true" className="text-[#56665F]">·</span>
                    <span className="font-mono font-semibold text-[#D4A853]">
                      {formatGameHour(gameTimeMs)}
                    </span>
                    <span aria-hidden="true" className="text-[#56665F]">·</span>
                    <span className="text-[#B7C4BE]">
                      {currentDay}. Gün ({currentPhase})
                    </span>
                    <span aria-hidden="true" className="hidden md:inline text-[#56665F]">·</span>
                    <span className="hidden md:inline text-[#9CE3DD]">
                      {protagonist.name} · Can {protagonist.health} · Gümüş {protagonist.silver}g
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => handleOpenProtagonist('status')}
                      className="rounded border border-[#67C7C0]/35 bg-[#13231F] px-2 py-0.5 text-[11px] font-medium text-[#9CE3DD] hover:border-[#67C7C0]/70 cursor-pointer whitespace-nowrap"
                    >
                      Karakterim
                    </button>
                    <button
                      type="button"
                      onClick={() => handleOpenProtagonist('bag')}
                      className="rounded border border-[#D4A853]/28 bg-[#1A241F] px-2 py-0.5 text-[11px] font-medium text-[#E8C472] hover:border-[#D4A853]/65 cursor-pointer whitespace-nowrap"
                    >
                      Çanta
                    </button>
                    <button
                      type="button"
                      onClick={() => handleOpenProtagonist('party')}
                      className="rounded border border-[#D4A853]/28 bg-[#1A241F] px-2 py-0.5 text-[11px] font-medium text-[#E8C472] hover:border-[#D4A853]/65 cursor-pointer whitespace-nowrap"
                    >
                      Parti &amp; İlişkiler
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setDrawerMode('location');
                        setInspectorOpen(true);
                      }}
                      className="rounded border border-[#D4A853]/28 bg-[#1A241F] px-2 py-0.5 text-[11px] font-medium text-[#EDE6D6] hover:border-[#D4A853]/65 cursor-pointer whitespace-nowrap"
                    >
                      Konum Detayı
                    </button>
                  </div>
                </div>
              )}

              <MapViewport
                locations={locations}
                routes={routes}
                mazgalCells={mazgalCells}
                selectedLocationId={selectedLocationId}
                selectedMazgalId={drawerMode === 'mazgal' ? selectedMazgalId : null}
                partyLocationId={protagonist.locationId ?? ''}
                protagonist={protagonist}
                activeWeatherKey={activeWeatherKey}
                fogOfWar={fogOfWar}
                showRoutes={showRoutes}
                soundEnabled={soundEnabled}
                isPlacingPin={isPlacingPin}
                resetKey={resetKey}
                isFullscreen={isFullscreen}
                onToggleFullscreen={handleToggleFullscreen}
                onSelectLocation={handleSelectLocation}
                onSelectMazgal={handleSelectMazgal}
                onPlacePinAt={handlePlacePinAt}
                onToggleFogOfWar={() => setFogOfWar((v) => !v)}
                onToggleRoutes={() => setShowRoutes((v) => !v)}
                onToggleSound={() => setSoundEnabled((v) => !v)}
                onChangeTravelMode={handleChangeTravelMode}
                onWeatherChanged={handleWeatherChanged}
                onOpenInspector={() => {
                  setDrawerMode('location');
                  setInspectorOpen(true);
                }}
                onOpenProtagonist={handleOpenProtagonist}
              />

              <NarrativeChatbox
                messages={narrativeMessages}
                protagonistName={protagonist.name}
                activeModelName={
                  NARRATIVE_MODEL_OPTIONS.find((m) => m.id === aiSettings.model)?.name
                }
                isFullscreen={isFullscreen}
                isPending={narrativePending}
                errorMessage={narrativeError}
                failedAttempt={failedNarrativeAttempt}
                currentPlaceLabel={
                  protagonistCurrentLoc
                    ? protagonistCurrentLoc.name
                    : protagonistCurrentCell.terrainLabel
                }
                onSubmitAction={handleSubmitNarrativeTurn}
                onRetryFailedAction={() =>
                  failedNarrativeAttempt
                    ? handleSubmitNarrativeTurn(
                        failedNarrativeAttempt.text,
                        failedNarrativeAttempt.choice
                      )
                    : false
                }
                onResetNarrative={handleResetNarrative}
                onOpenSettings={() => setNarrativeSettingsOpen(true)}
              />

              <NarrativeSettingsModal
                isOpen={narrativeSettingsOpen}
                settings={aiSettings}
                onChange={setAiSettings}
                onClose={() => setNarrativeSettingsOpen(false)}
              />

              {/* Slide-Over Inspector Drawer (stays reachable even in native fullscreen) */}
              {inspectorOpen && (
                <div className="fixed inset-0 z-[60] flex justify-end">
                  <div
                    aria-hidden="true"
                    onClick={() => setInspectorOpen(false)}
                    className="fixed inset-0 bg-black/55 backdrop-blur-[1px]"
                  />
                  <div className="relative z-10 h-full w-full max-w-[440px] overflow-y-auto border-l border-[#D4A853]/25 bg-[#141F1B] p-4 shadow-2xl">
                  {drawerMode === 'protagonist' ? (
                    <ProtagonistDrawer
                      key={protagonistTab}
                      protagonist={protagonist}
                      currentLocation={protagonistCurrentLoc}
                      currentMazgal={protagonistCurrentCell}
                      allLocations={locations}
                      gameTimeMs={gameTimeMs}
                      initialTab={protagonistTab}
                      onRenameProtagonist={handleRenameProtagonist}
                      onPerformAction={handlePerformProtagonistAction}
                      onShadowAction={handleShadowAction}
                      onUseItem={handleUseItem}
                      onBuyItem={handleBuyItem}
                      onSellItem={handleSellItem}
                      onBuySlave={handleBuySlave}
                      onSellCaptive={handleSellCaptive}
                      onSellBondedNpc={handleSellBondedNpc}
                      onFreeBondedNpc={handleFreeBondedNpc}
                      onAcceptContract={handleAcceptContract}
                      onCompleteContract={handleCompleteContract}
                      onPayBounty={handlePayBounty}
                      onEatRation={handleEatRation}
                      onMoveToLocation={(id) => {
                        handleMoveParty(id);
                        setSelectedLocationId(id);
                      }}
                      onNpcInteraction={handleNpcInteraction}
                      onInspectCurrentLocation={() => {
                        if (protagonistCurrentLoc) {
                          setSelectedLocationId(protagonistCurrentLoc.id);
                          setDrawerMode('location');
                        }
                      }}
                      onInspectCurrentMazgal={() => {
                        setSelectedMazgalId(protagonist.mazgalId);
                        setDrawerMode('mazgal');
                      }}
                      onClose={() => setInspectorOpen(false)}
                    />
                  ) : drawerMode === 'mazgal' ? (
                    <MazgalInspector
                      cell={selectedMazgal}
                      protagonist={protagonist}
                      fogOfWar={fogOfWar}
                      gameTimeMs={gameTimeMs}
                      resetKey={resetKey}
                      onSelectMazgal={handleSelectMazgal}
                      onStepMazgal={handleStepMazgal}
                      onApplyMazgalEvent={handleApplyMazgalEvent}
                      onInteractRoamingUnit={handleInteractRoamingUnit}
                      onSelectLocation={handleSelectLocation}
                      onClose={() => setInspectorOpen(false)}
                    />
                  ) : (
                    <LocationInspector
                      location={selectedLocation}
                      routes={routes}
                      allLocations={locations}
                      isPartyHere={selectedLocation?.id === protagonist.locationId}
                      protagonist={protagonist}
                      fogOfWar={fogOfWar}
                      gameTimeMs={gameTimeMs}
                      onMoveParty={handleMoveParty}
                      onToggleDiscovered={handleToggleDiscovered}
                      onSelectLocation={handleSelectLocation}
                      onEditLocation={(loc) => {
                        setPendingCoords(null);
                        setEditingLocation(loc);
                      }}
                      onDeleteLocation={handleDeleteLocation}
                      onInspectMazgal={handleSelectMazgal}
                      onResolveVillageProblem={handleResolveVillageProblem}
                      onInteractRoamingUnit={handleInteractRoamingUnit}
                      onRecordProceduralScene={handleRecordProceduralScene}
                      onMeetProceduralNpc={handleMeetProceduralNpc}
                      onMeetResident={handleMeetResident}
                      onOpenProtagonist={handleOpenProtagonist}
                      onClose={() => setInspectorOpen(false)}
                    />
                  )}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'chronicle' && (
          <ChronicleAtlas
            locations={locations}
            partyLocationId={protagonist.locationId ?? ''}
            fogOfWar={fogOfWar}
            journeyLog={journeyLog}
            onInspectOnMap={(id) => {
              setSelectedLocationId(id);
              setDrawerMode('location');
              setInspectorOpen(true);
              setActiveTab('map');
            }}
          />
        )}

        {activeTab === 'encounters' && (
          <EncounterStudio
            locations={locations}
            routes={routes}
            mazgalCells={mazgalCells}
            partyLocationId={protagonist.locationId ?? partyLocationId}
            protagonist={protagonist}
            activeWeatherKey={activeWeatherKey}
            gameTimeMs={gameTimeMs}
            resetKey={resetKey}
            onEncounterRolled={handleEncounterRolled}
            onRecordProceduralScene={handleRecordProceduralScene}
            onApplyEncounterOutcome={handleApplyEncounterOutcome}
            onResolveInteractiveChoice={handleResolveInteractiveChoice}
            onWeatherChanged={handleWeatherChanged}
            onMeetProceduralNpc={handleMeetProceduralNpc}
          />
        )}

        {activeTab === 'gm' && (
          <GmToolsPanel
            locations={locations}
            routes={routes}
            partyLocationId={partyLocationId}
            fogOfWar={fogOfWar}
            onAddRoute={handleAddRoute}
            onDeleteRoute={handleDeleteRoute}
            onImportCampaign={handleImportCampaign}
            onResetAll={handleResetAll}
          />
        )}
      </main>

      <footer className="border-t border-[#D4A853]/12 bg-[#0B120F] px-4 py-4 text-xs text-[#7E8D85] sm:px-6">
        <div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-3">
          <span>Sisli Doğu Atlası · Kadim Sis Ormanı Kampanya Haritası</span>
          <span>Tüm konum ve rota düzenlemeleri tarayıcınızda otomatik kaydedilir</span>
        </div>
      </footer>

      <LocationModal
        isOpen={pendingCoords !== null || editingLocation !== null}
        coords={pendingCoords}
        editingLocation={editingLocation}
        onClose={() => {
          setPendingCoords(null);
          setEditingLocation(null);
        }}
        onSave={handleSaveLocation}
      />
    </div>
  );
}
