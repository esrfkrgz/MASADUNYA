/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useMemo, useState } from 'react';
import { Calendar, Clock, RotateCcw } from 'lucide-react';
import { ChronicleAtlas } from './components/ChronicleAtlas';
import { EncounterStudio } from './components/EncounterStudio';
import { GmToolsPanel } from './components/GmToolsPanel';
import { LocationInspector } from './components/LocationInspector';
import { LocationModal } from './components/LocationModal';
import { MapViewport } from './components/MapViewport';
import { MazgalInspector } from './components/MazgalInspector';
import { TopBar } from './components/TopBar';
import { INITIAL_LOCATIONS, INITIAL_ROUTES, REGION_INFO } from './data/easternForestData';
import type {
  ActiveTab,
  ForestEncounter,
  JourneyLogEntry,
  MapLocation,
  MapRoute,
  MazgalNeighborSummary,
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
  findShortestMazgalHours,
  formatTravelHours,
  getCellForCoords,
} from './utils/gridEngine';
import {
  advanceLivingLocations,
  recordProceduralSceneOnLocation,
  resolveSettlementProblemByParty,
} from './utils/livingWorldEngine';
import type { ProceduralSceneCard } from './utils/proceduralWorldDeck';
import { soundFx } from './utils/sound';

const STORAGE_KEY = 'sisli_dogu_atlasi_v4';

interface PersistedState {
  locations: MapLocation[];
  routes: MapRoute[];
  partyLocationId: string;
  journeyLog: JourneyLogEntry[];
  gameTimeMs?: number;
}

function loadInitialState(): PersistedState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as PersistedState;
      if (Array.isArray(parsed.locations) && parsed.locations.length > 0) {
        const hydratedLocations = parsed.locations.map((loc) => {
          if (loc.livingState) return loc;
          const seed = INITIAL_LOCATIONS.find((initLoc) => initLoc.id === loc.id);
          return seed?.livingState ? { ...loc, livingState: seed.livingState } : loc;
        });
        return {
          ...parsed,
          locations: hydratedLocations,
          gameTimeMs:
            typeof parsed.gameTimeMs === 'number'
              ? parsed.gameTimeMs
              : INITIAL_GAME_TIME_MS,
        };
      }
    }
  } catch {
    // Fallback to initial data
  }
  return {
    locations: INITIAL_LOCATIONS,
    routes: INITIAL_ROUTES,
    partyLocationId: 'loc-kuldere',
    gameTimeMs: INITIAL_GAME_TIME_MS,
    journeyLog: [
      {
        id: 'log-init',
        locationId: 'loc-kuldere',
        locationName: 'Külköy Sınır Kalesi',
        timestamp: formatGameDateTime(INITIAL_GAME_TIME_MS),
        note: 'Grup, 300 fersahlık Kadim Sis Ormanı eşiğinde sefer hazırlıklarını tamamladı.',
      },
    ],
  };
}

export default function App() {
  const [initial] = useState<PersistedState>(() => loadInitialState());
  const [locations, setLocations] = useState<MapLocation[]>(initial.locations);
  const [routes, setRoutes] = useState<MapRoute[]>(initial.routes);
  const [partyLocationId, setPartyLocationId] = useState<string>(initial.partyLocationId);
  const [journeyLog, setJourneyLog] = useState<JourneyLogEntry[]>(initial.journeyLog);
  const [gameTimeMs, setGameTimeMs] = useState<number>(
    initial.gameTimeMs ?? INITIAL_GAME_TIME_MS
  );
  const [lastTimeAction, setLastTimeAction] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<ActiveTab>('map');
  const [selectedLocationId, setSelectedLocationId] = useState<string>(initial.partyLocationId);

  const [fogOfWar, setFogOfWar] = useState<boolean>(false);
  const [showMist, setShowMist] = useState<boolean>(true);
  const [mistDensity, setMistDensity] = useState<number>(26);
  const [showRoutes, setShowRoutes] = useState<boolean>(true);
  const [soundEnabled, setSoundEnabled] = useState<boolean>(true);

  const [isPlacingPin, setIsPlacingPin] = useState<boolean>(false);
  const [pendingCoords, setPendingCoords] = useState<{ x: number; y: number } | null>(null);
  const [editingLocation, setEditingLocation] = useState<MapLocation | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState<boolean>(false);
  const [drawerMode, setDrawerMode] = useState<'location' | 'mazgal'>('location');
  const [selectedMazgalId, setSelectedMazgalId] = useState<string>('B5');
  const [confirmReset, setConfirmReset] = useState<boolean>(false);
  const [resetKey, setResetKey] = useState<number>(0);

  const mazgalCells = useMemo(() => buildMazgalGrid(locations), [locations]);

  useEffect(() => {
    try {
      const payload: PersistedState = {
        locations,
        routes,
        partyLocationId,
        journeyLog,
        gameTimeMs,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // Ignore storage quota errors
    }
  }, [locations, routes, partyLocationId, journeyLog, gameTimeMs]);

  useEffect(() => {
    soundFx.enabled = soundEnabled;
  }, [soundEnabled]);

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

  const selectedLocation = locations.find((l) => l.id === selectedLocationId) ?? locations[0];
  const selectedMazgal = mazgalCells.find((c) => c.id === selectedMazgalId) ?? mazgalCells[0];

  const advanceCampaignClock = (hours: number, summary: string): number => {
    const safeHours = Math.max(1, Math.round(hours));
    const nextMs = addGameHours(gameTimeMs, safeHours);
    setGameTimeMs(nextMs);
    setLastTimeAction(`${summary} (+${formatTravelHours(safeHours)})`);
    setLocations((prev) => advanceLivingLocations(prev, nextMs));
    return nextMs;
  };

  const handleResolveVillageProblem = (locationId: string, problemId: string) => {
    soundFx.playSelectChime();
    setLocations((prev) =>
      prev.map((loc) =>
        loc.id === locationId
          ? resolveSettlementProblemByParty(loc, problemId, gameTimeMs)
          : loc
      )
    );
  };

  const handleRecordProceduralScene = (scene: ProceduralSceneCard, advanceHours: number) => {
    soundFx.playSelectChime();
    let targetTimeMs = gameTimeMs;
    if (advanceHours > 0) {
      targetTimeMs = addGameHours(gameTimeMs, advanceHours);
      setGameTimeMs(targetTimeMs);
      setLastTimeAction(`${scene.title} (+${formatTravelHours(advanceHours)})`);
    }
    setLocations((prev) => {
      const updatedWithScene = prev.map((loc) =>
        loc.id === scene.locationId
          ? recordProceduralSceneOnLocation(loc, scene, targetTimeMs)
          : loc
      );
      return advanceHours > 0
        ? advanceLivingLocations(updatedWithScene, targetTimeMs)
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

  const handleQuickTimeAction = (hours: number, label: string) => {
    soundFx.playSelectChime();
    const nextMs = advanceCampaignClock(hours, label);
    const currentLoc = locations.find((l) => l.id === partyLocationId);
    if (hours >= 4 && currentLoc) {
      setJourneyLog((prev) => [
        {
          id: `log-${Date.now()}`,
          locationId: currentLoc.id,
          locationName: currentLoc.name,
          timestamp: formatGameDateTime(nextMs),
          note: `${label} tamamlandı (+${formatTravelHours(hours)}).`,
        },
        ...prev,
      ]);
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

  const handleStepMazgal = (fromId: string, nb: MazgalNeighborSummary) => {
    const nextMs = advanceCampaignClock(nb.travelHours, `Mazgal ${fromId} → ${nb.id}`);
    const currentLoc = locations.find((l) => l.id === partyLocationId);
    setJourneyLog((prev) => [
      {
        id: `log-${Date.now()}`,
        locationId: currentLoc?.id ?? 'loc-kuldere',
        locationName: `Mazgal ${nb.id} (${nb.direction})`,
        timestamp: formatGameDateTime(nextMs),
        note: `Mazgal ${fromId} karesinden ${nb.id} karesine ${nb.travelLabel} (${nb.distanceFersah} Fersah) yüründü.`,
      },
      ...prev,
    ]);
  };

  const handleMoveParty = (id: string) => {
    const target = locations.find((l) => l.id === id);
    if (!target) return;
    const current = locations.find((l) => l.id === partyLocationId);
    soundFx.playMoveToken();

    let travelHours = 12;
    if (current && current.id !== target.id) {
      const directRoute = routes.find(
        (r) =>
          (r.fromId === current.id && r.toId === target.id) ||
          (r.toId === current.id && r.fromId === target.id)
      );
      if (directRoute) {
        travelHours = directRoute.travelHours;
      } else {
        const fromCell = getCellForCoords(current.x, current.y);
        const toCell = getCellForCoords(target.x, target.y);
        if (fromCell.id === toCell.id) {
          travelHours = Math.max(
            2,
            Math.round(Math.hypot(target.x - current.x, target.y - current.y) * 1.5)
          );
        } else {
          travelHours = findShortestMazgalHours(fromCell.id, toCell.id, mazgalCells);
        }
      }
    }

    const nextMs = advanceCampaignClock(
      travelHours,
      current ? `${current.name} → ${target.name}` : target.name
    );

    setPartyLocationId(id);
    setLocations((prev) =>
      prev.map((loc) => (loc.id === id ? { ...loc, discovered: true } : loc))
    );
    setJourneyLog((prev) => [
      {
        id: `log-${Date.now()}`,
        locationId: target.id,
        locationName: target.name,
        timestamp: formatGameDateTime(nextMs),
        note: current
          ? `Grup ${current.name} noktasından ${target.name} bölgesine ${formatTravelHours(travelHours)} yürüyüşle ulaştı.`
          : `Grup ${target.name} bölgesine ulaştı.`,
      },
      ...prev,
    ]);
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
    setPartyLocationId('loc-kuldere');
    setSelectedLocationId('loc-kuldere');
    setSelectedMazgalId('B5');
    setDrawerMode('location');
    setInspectorOpen(false);
    setFogOfWar(false);
    setShowMist(true);
    setMistDensity(26);
    setShowRoutes(true);
    setIsPlacingPin(false);
    setPendingCoords(null);
    setEditingLocation(null);
    setGameTimeMs(INITIAL_GAME_TIME_MS);
    setLastTimeAction('Başlangıç noktasına dönüldü (06.06.2026 · 08:00)');
    setConfirmReset(false);
    setResetKey((k) => k + 1);
    setJourneyLog([
      {
        id: 'log-reset',
        locationId: 'loc-kuldere',
        locationName: 'Külköy Sınır Kalesi',
        timestamp: formatGameDateTime(INITIAL_GAME_TIME_MS),
        note: 'Grup, 300 fersahlık Kadim Sis Ormanı eşiğinde sefer hazırlıklarını tamamladı.',
      },
    ]);
  };

  const currentDay = getDayNumber(gameTimeMs);
  const currentPhase = getDayPhaseLabel(gameTimeMs);

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

      {/* Persistent In-Game Campaign Calendar & Clock Strip */}
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
            {lastTimeAction && (
              <>
                <span aria-hidden="true" className="hidden sm:inline text-[#56665F]">·</span>
                <span className="hidden sm:inline text-[#67C7C0]">
                  Son Aksiyon: {lastTimeAction}
                </span>
              </>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => handleQuickTimeAction(1, 'Çevre Araştırması')}
              className="rounded border border-[#D4A853]/22 bg-[#17241F] px-2.5 py-1 text-[11px] font-medium text-[#D9D3C4] transition-colors hover:border-[#D4A853]/55 hover:text-[#F8F3E6] whitespace-nowrap cursor-pointer"
            >
              Araştır (+1 Saat)
            </button>
            <button
              type="button"
              onClick={() => handleQuickTimeAction(4, 'Bölge Devriyesi')}
              className="rounded border border-[#D4A853]/22 bg-[#17241F] px-2.5 py-1 text-[11px] font-medium text-[#D9D3C4] transition-colors hover:border-[#D4A853]/55 hover:text-[#F8F3E6] whitespace-nowrap cursor-pointer"
            >
              Devriye (+4 Saat)
            </button>
            <button
              type="button"
              onClick={() => handleQuickTimeAction(8, 'Gece Kampı ve Dinlenme')}
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

            {/* Full-Width Map Canvas */}
            <MapViewport
              locations={locations}
              routes={routes}
              mazgalCells={mazgalCells}
              selectedLocationId={selectedLocationId}
              selectedMazgalId={drawerMode === 'mazgal' ? selectedMazgalId : null}
              partyLocationId={partyLocationId}
              fogOfWar={fogOfWar}
              showMist={showMist}
              mistDensity={mistDensity}
              showRoutes={showRoutes}
              soundEnabled={soundEnabled}
              isPlacingPin={isPlacingPin}
              resetKey={resetKey}
              onSelectLocation={handleSelectLocation}
              onSelectMazgal={handleSelectMazgal}
              onPlacePinAt={handlePlacePinAt}
              onToggleFogOfWar={() => setFogOfWar((v) => !v)}
              onToggleMist={() => setShowMist((v) => !v)}
              onMistDensityChange={setMistDensity}
              onToggleRoutes={() => setShowRoutes((v) => !v)}
              onToggleSound={() => setSoundEnabled((v) => !v)}
              onOpenInspector={() => {
                setDrawerMode('location');
                setInspectorOpen(true);
              }}
            />

            {/* Slide-Over Inspector Drawer (Location or Mazgal) */}
            {inspectorOpen && (
              <div className="fixed inset-0 z-40 flex justify-end">
                <div
                  aria-hidden="true"
                  onClick={() => setInspectorOpen(false)}
                  className="fixed inset-0 bg-black/55 backdrop-blur-[1px]"
                />
                <div className="relative z-10 h-full w-full max-w-[440px] overflow-y-auto border-l border-[#D4A853]/25 bg-[#141F1B] p-4 shadow-2xl">
                  {drawerMode === 'mazgal' ? (
                    <MazgalInspector
                      cell={selectedMazgal}
                      fogOfWar={fogOfWar}
                      gameTimeMs={gameTimeMs}
                      resetKey={resetKey}
                      onSelectMazgal={handleSelectMazgal}
                      onStepMazgal={handleStepMazgal}
                      onSelectLocation={handleSelectLocation}
                      onClose={() => setInspectorOpen(false)}
                    />
                  ) : (
                    <LocationInspector
                      location={selectedLocation}
                      routes={routes}
                      allLocations={locations}
                      isPartyHere={selectedLocation?.id === partyLocationId}
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
                      onRecordProceduralScene={handleRecordProceduralScene}
                      onClose={() => setInspectorOpen(false)}
                    />
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'chronicle' && (
          <ChronicleAtlas
            locations={locations}
            partyLocationId={partyLocationId}
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
            partyLocationId={partyLocationId}
            gameTimeMs={gameTimeMs}
            resetKey={resetKey}
            onEncounterRolled={handleEncounterRolled}
            onRecordProceduralScene={handleRecordProceduralScene}
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
