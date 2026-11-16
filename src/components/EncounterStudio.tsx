import React, { useEffect, useMemo, useState } from 'react';
import {
  Calculator,
  CalendarClock,
  Compass,
  Dices,
  Package,
  RefreshCw,
  Shield,
  Sparkles,
  Swords,
  UserPlus,
  Wind,
} from 'lucide-react';
import { FOREST_ENCOUNTERS, MIST_WEATHERS } from '../data/easternForestData';
import type {
  ForestEncounter,
  MapLocation,
  MapRoute,
  MazgalCell,
  MistWeather,
} from '../types/map';
import {
  calculateExpeditionPlan,
  rollRegionalWeather,
  type RegionalWeatherRoll,
  type TravelPace,
  type TravelTransport,
  type WeatherConditionKey,
} from '../utils/campaignCalculators';
import {
  rollDiceEngine,
  type DiceRollResult,
  type RollAdvantageMode,
} from '../utils/diceEngine';
import { getCellForCoords } from '../utils/gridEngine';
import {
  generateProceduralNpc,
  generateProceduralScene,
  type ProceduralNpcCard,
  type ProceduralSceneCard,
  type SceneCategoryFilter,
} from '../utils/proceduralWorldDeck';
import { soundFx } from '../utils/sound';

interface EncounterStudioProps {
  locations: MapLocation[];
  routes: MapRoute[];
  mazgalCells: MazgalCell[];
  partyLocationId: string;
  gameTimeMs: number;
  resetKey?: number;
  onEncounterRolled?: (encounter: ForestEncounter) => void;
  onRecordProceduralScene?: (scene: ProceduralSceneCard, advanceHours: number) => void;
}

const QUICK_DICE = ['1d4', '1d6', '1d8', '1d10', '1d12', '1d20', '2d6', '1d100'];

export const EncounterStudio: React.FC<EncounterStudioProps> = ({
  locations,
  routes,
  mazgalCells,
  partyLocationId,
  gameTimeMs,
  resetKey = 0,
  onEncounterRolled,
  onRecordProceduralScene,
}) => {
  // 1) Dice & Check Engine State
  const [diceExpr, setDiceExpr] = useState('1d20');
  const [rollMode, setRollMode] = useState<RollAdvantageMode>('normal');
  const [useDc, setUseDc] = useState<boolean>(true);
  const [targetDc, setTargetDc] = useState<number>(13);
  const [rollHistory, setRollHistory] = useState<DiceRollResult[]>([]);

  // 2) Combinatorial Regional Scene & NPC State
  const [sceneLocationId, setSceneLocationId] = useState<string>(partyLocationId || locations[0]?.id || '');
  const [sceneFilter, setSceneFilter] = useState<SceneCategoryFilter>('auto');
  const [activeScene, setActiveScene] = useState<ProceduralSceneCard | null>(null);
  const [generatedNpc, setGeneratedNpc] = useState<ProceduralNpcCard | null>(null);
  const [sceneSavedToast, setSceneSavedToast] = useState<string | null>(null);

  // 3) Expedition & Ration Calculator State
  const [calcFromId, setCalcFromId] = useState<string>(partyLocationId || locations[0]?.id || '');
  const [calcToId, setCalcToId] = useState<string>(
    locations.find((l) => l.id === 'loc-elf-koyu')?.id ?? locations[1]?.id ?? ''
  );
  const [partySize, setPartySize] = useState<number>(4);
  const [pace, setPace] = useState<TravelPace>('normal');
  const [transport, setTransport] = useState<TravelTransport>('foot');
  const [weatherKey, setWeatherKey] = useState<WeatherConditionKey>('mist');
  const [regionalWeather, setRegionalWeather] = useState<RegionalWeatherRoll | null>(null);

  // 4) Classic 1d12 Forest Encounter State
  const [lastRoll, setLastRoll] = useState<number | null>(null);
  const [activeEncounter, setActiveEncounter] = useState<ForestEncounter>(FOREST_ENCOUNTERS[0]);
  const [activeWeather, setActiveWeather] = useState<MistWeather>(MIST_WEATHERS[0]);

  useEffect(() => {
    if (partyLocationId) {
      setSceneLocationId((prev) => prev || partyLocationId);
      setCalcFromId((prev) => prev || partyLocationId);
    }
  }, [partyLocationId]);

  useEffect(() => {
    if (resetKey === 0) return;
    setLastRoll(null);
    setActiveEncounter(FOREST_ENCOUNTERS[0]);
    setActiveWeather(MIST_WEATHERS[0]);
    setRollHistory([]);
    setActiveScene(null);
    setGeneratedNpc(null);
    setRegionalWeather(null);
    setSceneSavedToast(null);
    setSceneLocationId('loc-kuldere');
    setCalcFromId('loc-kuldere');
  }, [resetKey]);

  const selectedSceneLoc =
    locations.find((l) => l.id === sceneLocationId) ?? locations[0];

  const expeditionPlan = useMemo(
    () =>
      calculateExpeditionPlan({
        fromLocationId: calcFromId,
        toLocationId: calcToId,
        locations,
        routes,
        mazgalCells,
        gameTimeMs,
        partySize,
        pace,
        transport,
        weather: weatherKey,
      }),
    [calcFromId, calcToId, locations, routes, mazgalCells, gameTimeMs, partySize, pace, transport, weatherKey]
  );

  const handleRunDice = (exprOverride?: string) => {
    soundFx.playDiceRoll();
    const res = rollDiceEngine({
      expression: exprOverride ?? diceExpr,
      mode: rollMode,
      targetDc: useDc ? targetDc : undefined,
    });
    setRollHistory((prev) => [res, ...prev].slice(0, 6));
  };

  const handleGenerateScene = () => {
    if (!selectedSceneLoc) return;
    soundFx.playDiceRoll();
    const cell = getCellForCoords(selectedSceneLoc.x, selectedSceneLoc.y);
    const mazgal = mazgalCells.find((c) => c.id === cell.id);
    const scene = generateProceduralScene(
      selectedSceneLoc,
      gameTimeMs,
      sceneFilter,
      mazgal?.safetyScore ?? 50
    );
    setActiveScene(scene);
    setSceneSavedToast(null);
  };

  const handleGenerateNpc = () => {
    if (!selectedSceneLoc) return;
    soundFx.playSelectChime();
    const arch = selectedSceneLoc.livingState?.archetype ?? 'wild_nature';
    setGeneratedNpc(generateProceduralNpc(arch));
  };

  const handleRollRegionalWeather = () => {
    soundFx.playDiceRoll();
    const rolled = rollRegionalWeather(selectedSceneLoc, gameTimeMs);
    setRegionalWeather(rolled);
    setWeatherKey(rolled.weatherKey);
  };

  const handleCommitSceneToLocation = (advanceHours: number) => {
    if (!activeScene || !onRecordProceduralScene) return;
    soundFx.playSelectChime();
    onRecordProceduralScene(activeScene, advanceHours);
    setSceneSavedToast(
      advanceHours > 0
        ? `${activeScene.locationName} olay kaydına işlendi (+${advanceHours} Saat).`
        : `${activeScene.locationName} olay kaydına işlendi.`
    );
  };

  const handleRollEncounter = () => {
    soundFx.playDiceRoll();
    const d12 = Math.floor(Math.random() * 12) + 1;
    const encIdx = Math.min(FOREST_ENCOUNTERS.length - 1, Math.floor((d12 - 1) / 2));
    const weatherIdx = Math.floor(Math.random() * MIST_WEATHERS.length);
    const rolledEncounter = FOREST_ENCOUNTERS[encIdx];
    setLastRoll(d12);
    setActiveEncounter(rolledEncounter);
    setActiveWeather(MIST_WEATHERS[weatherIdx]);
    onEncounterRolled?.(rolledEncounter);
  };

  const latestRoll = rollHistory[0];

  return (
    <div className="mx-auto max-w-[1440px] space-y-8 px-4 py-8 sm:px-6">
      {/* Header */}
      <div className="flex flex-col justify-between gap-4 border-b border-[#D4A853]/15 pb-6 sm:flex-row sm:items-end">
        <div>
          <p className="text-xs font-medium text-[#67C7C0]">
            Çevrimdışı Oyun Motoru · Yapay Zekasız Kural ve Rastgelelik Sistemi
          </p>
          <h1 className="mt-1 font-display text-2xl font-semibold text-[#F8F3E6] sm:text-3xl">
            Zar, Bölgesel Olay ve Sefer Hesaplayıcı
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-[#A3B1AA]">
            Masa başında yapay zekaya ihtiyaç duymadan oyunu yönetmek için çok yüzlü zar motorunu, konuma özel binlerce kombinasyonlu olay/NPC üreticisini ve erzak-süre hesaplayıcısını kullanın.
          </p>
        </div>

        <button
          type="button"
          onClick={handleRollEncounter}
          className="inline-flex items-center gap-2 rounded-md bg-[#D4A853] px-5 py-2.5 text-sm font-semibold text-[#111916] transition-colors hover:bg-[#E0B96B] whitespace-nowrap shrink-0 cursor-pointer"
        >
          <Dices className="h-4 w-4" />
          Hızlı Yol Karşılaşması (1d12)
        </button>
      </div>

      {/* SECTION 1: Polyhedral Dice Engine + Regional Weather */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <section className="lg:col-span-2 rounded-lg border border-[#D4A853]/25 bg-[#141F1B] p-6 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#D4A853]/15 pb-3">
            <div className="flex items-center gap-2">
              <Dices className="h-4 w-4 text-[#D4A853]" />
              <h2 className="font-display text-lg font-semibold text-[#F8F3E6]">
                Çok Yüzlü Zar ve Zorluk (DC) Motoru
              </h2>
            </div>
            <span className="font-mono text-xs text-[#9AA8A1]">
              d4 · d6 · d8 · d10 · d12 · d20 · d100
            </span>
          </div>

          {/* Quick Die Buttons */}
          <div className="flex flex-wrap gap-1.5">
            {QUICK_DICE.map((expr) => (
              <button
                key={expr}
                type="button"
                onClick={() => {
                  setDiceExpr(expr);
                  handleRunDice(expr);
                }}
                className="rounded border border-[#D4A853]/25 bg-[#192621] px-3 py-1.5 font-mono text-xs font-semibold text-[#EDE6D6] transition-colors hover:border-[#D4A853]/65 hover:text-[#D4A853] cursor-pointer"
              >
                {expr}
              </button>
            ))}
          </div>

          {/* Custom Expression + Advantage + Target DC */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-12">
            <label className="block text-xs text-[#A3B1AA] sm:col-span-4">
              Zar İfadesi (örn: 2d6+3)
              <input
                type="text"
                value={diceExpr}
                onChange={(e) => setDiceExpr(e.target.value)}
                placeholder="1d20+2"
                className="mt-1.5 w-full rounded-md border border-[#D4A853]/25 bg-[#0F1815] px-3 py-2 font-mono text-sm text-[#F8F3E6] focus:border-[#D4A853] focus:outline-none"
              />
            </label>

            <label className="block text-xs text-[#A3B1AA] sm:col-span-3">
              d20 Durumu
              <select
                value={rollMode}
                onChange={(e) => setRollMode(e.target.value as RollAdvantageMode)}
                className="mt-1.5 w-full rounded-md border border-[#D4A853]/25 bg-[#0F1815] px-3 py-2 text-sm text-[#F8F3E6] focus:border-[#D4A853] focus:outline-none"
              >
                <option value="normal">Normal</option>
                <option value="advantage">Avantaj (2d20 Yüksek)</option>
                <option value="disadvantage">Dezavantaj (2d20 Düşük)</option>
              </select>
            </label>

            <div className="sm:col-span-3">
              <label className="flex items-center justify-between text-xs text-[#A3B1AA]">
                <span>Zorluk (DC)</span>
                <input
                  type="checkbox"
                  checked={useDc}
                  onChange={(e) => setUseDc(e.target.checked)}
                  className="h-3.5 w-3.5 accent-[#D4A853] cursor-pointer"
                />
              </label>
              <input
                type="number"
                min={5}
                max={30}
                disabled={!useDc}
                value={targetDc}
                onChange={(e) => setTargetDc(Number(e.target.value))}
                className="mt-1.5 w-full rounded-md border border-[#D4A853]/25 bg-[#0F1815] px-3 py-2 font-mono text-sm text-[#F8F3E6] disabled:opacity-45 focus:border-[#D4A853] focus:outline-none"
              />
            </div>

            <div className="flex items-end sm:col-span-2">
              <button
                type="button"
                onClick={() => handleRunDice()}
                className="w-full rounded-md bg-[#D4A853] px-3 py-2 text-sm font-semibold text-[#111916] transition-colors hover:bg-[#E0B96B] cursor-pointer"
              >
                Zar At
              </button>
            </div>
          </div>

          {/* Latest Roll Output & History */}
          {latestRoll ? (
            <div className="rounded-md border border-[#D4A853]/20 bg-[#101A16] p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-mono text-xs text-[#9AA8A1] tabular-nums">
                    {latestRoll.expression} · Zarlar: [{latestRoll.rolls.join(', ')}]
                    {latestRoll.modifier !== 0 &&
                      ` ${latestRoll.modifier > 0 ? `+ ${latestRoll.modifier}` : `- ${Math.abs(latestRoll.modifier)}`}`}
                  </p>
                  <div className="mt-1 flex items-baseline gap-3">
                    <span className="font-mono text-3xl font-bold text-[#F8F3E6] tabular-nums">
                      {latestRoll.total}
                    </span>
                    {latestRoll.outcomeLabel && (
                      <span
                        className={`text-sm font-semibold ${
                          latestRoll.outcomeTone === 'critical' || latestRoll.outcomeTone === 'success'
                            ? 'text-[#67C7C0]'
                            : latestRoll.outcomeTone === 'partial'
                            ? 'text-[#D4A853]'
                            : 'text-[#E89898]'
                        }`}
                      >
                        {latestRoll.outcomeLabel} (DC {latestRoll.dc})
                      </span>
                    )}
                    {!latestRoll.outcomeLabel && latestRoll.naturalNote && (
                      <span className="text-sm font-semibold text-[#D4A853]">
                        {latestRoll.naturalNote}
                      </span>
                    )}
                  </div>
                </div>
                <span className="font-mono text-xs text-[#7E8D85] tabular-nums">
                  {latestRoll.timestamp}
                </span>
              </div>

              {rollHistory.length > 1 && (
                <div className="mt-3 border-t border-[#D4A853]/12 pt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[#9AA8A1] tabular-nums">
                  {rollHistory.slice(1).map((h) => (
                    <span key={h.id} className="font-mono">
                      {h.expression} → <strong className="text-[#EDE6D6]">{h.total}</strong>
                    </span>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="rounded-md border border-[#D4A853]/12 bg-[#101A16] p-4 text-xs text-[#9AA8A1]">
              Yukarıdaki zar düğmelerinden birine basın veya <strong className="text-[#EDE6D6]">2d6+3</strong> gibi bir ifade girip test atın.
            </div>
          )}
        </section>

        {/* Regional 2d6 Mist & Weather Engine */}
        <section className="flex flex-col justify-between rounded-lg border border-[#67C7C0]/25 bg-[#121D1A] p-6 space-y-4">
          <div>
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs font-semibold text-[#67C7C0]">
                <Wind className="h-4 w-4" />
                <span>2d6 Bölgesel Sis ve Hava Motoru</span>
              </div>
              <button
                type="button"
                onClick={handleRollRegionalWeather}
                className="inline-flex items-center gap-1 rounded border border-[#67C7C0]/40 bg-[#172824] px-2.5 py-1 text-[11px] font-medium text-[#9CE3DD] hover:bg-[#1E342F] cursor-pointer"
              >
                <RefreshCw className="h-3 w-3" />
                Hava Zarı At
              </button>
            </div>

            {regionalWeather ? (
              <div className="mt-3 space-y-2">
                <p className="font-mono text-[11px] text-[#9AA8A1] tabular-nums">
                  2d6: {regionalWeather.roll2d6} · {regionalWeather.belt}
                </p>
                <h3 className="font-display text-xl font-semibold text-[#F8F3E6]">
                  {regionalWeather.name}
                </h3>
                <p className="font-mono text-xs text-[#D4A853] tabular-nums">
                  Görüş: {regionalWeather.visibilityMeters}m · Yürüyüş: {regionalWeather.travelMultiplierLabel}
                </p>
                <p className="text-xs leading-relaxed text-[#D9D3C4]">
                  {regionalWeather.tacticalEffect}
                </p>
              </div>
            ) : (
              <div className="mt-3 space-y-2">
                <h3 className="font-display text-xl font-semibold text-[#F8F3E6]">
                  {activeWeather.name}
                </h3>
                <p className="font-mono text-xs text-[#A3B1AA] tabular-nums">
                  Görüş Mesafesi: {activeWeather.visibility}
                </p>
                <p className="text-sm leading-relaxed text-[#D9D3C4]">{activeWeather.effect}</p>
              </div>
            )}
          </div>

          <div className="border-t border-[#67C7C0]/15 pt-3">
            <h3 className="text-xs font-semibold text-[#A3B1AA]">Sabit Hava Koşulları</h3>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {MIST_WEATHERS.map((w) => (
                <button
                  key={w.id}
                  type="button"
                  onClick={() => {
                    setRegionalWeather(null);
                    setActiveWeather(w);
                  }}
                  className={`rounded px-2.5 py-1 text-xs transition-colors cursor-pointer ${
                    !regionalWeather && activeWeather.id === w.id
                      ? 'bg-[#67C7C0] text-[#0D1512] font-semibold'
                      : 'bg-[#192824] text-[#B7C4BE] hover:text-[#F8F3E6]'
                  }`}
                >
                  {w.name}
                </button>
              ))}
            </div>
          </div>
        </section>
      </div>

      {/* SECTION 2: Combinatorial Procedural Regional Scene & NPC Engine */}
      <section className="rounded-lg border border-[#D4A853]/25 bg-[#141F1B] p-6 space-y-5">
        <div className="flex flex-col justify-between gap-4 border-b border-[#D4A853]/15 pb-4 lg:flex-row lg:items-end">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold text-[#D4A853]">
              <Sparkles className="h-4 w-4" />
              <span>Kombine Prosedürel Olay ve NPC Üreticisi</span>
            </div>
            <h2 className="mt-1 font-display text-xl font-semibold text-[#F8F3E6]">
              Bölgeye Özel Yüzlerce Olasılıklı Sahne Motoru
            </h2>
            <p className="mt-1 text-xs text-[#A3B1AA]">
              Seçili konumun arketipine, komşularına, günün saatine ve mazgal güvenliğine göre mantıksal sahneler ve yerel karakterler üretir.
            </p>
          </div>

          <div className="flex flex-wrap items-end gap-2">
            <label className="block text-xs text-[#A3B1AA]">
              Konum Seçimi
              <select
                value={sceneLocationId}
                onChange={(e) => setSceneLocationId(e.target.value)}
                className="mt-1 block rounded-md border border-[#D4A853]/25 bg-[#0F1815] px-3 py-2 text-xs text-[#F8F3E6] focus:border-[#D4A853] focus:outline-none"
              >
                {locations.map((loc) => (
                  <option key={loc.id} value={loc.id}>
                    {loc.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="block text-xs text-[#A3B1AA]">
              Olay Türü
              <select
                value={sceneFilter}
                onChange={(e) => setSceneFilter(e.target.value as SceneCategoryFilter)}
                className="mt-1 block rounded-md border border-[#D4A853]/25 bg-[#0F1815] px-3 py-2 text-xs text-[#F8F3E6] focus:border-[#D4A853] focus:outline-none"
              >
                <option value="auto">Otomatik (Güvenliğe Göre)</option>
                <option value="daily">Günlük Yaşam / Sosyal</option>
                <option value="danger">Tehlike / Pusu / Sorun</option>
                <option value="discovery">Keşif / İz / İpucu</option>
              </select>
            </label>

            <button
              type="button"
              onClick={handleGenerateScene}
              className="inline-flex items-center gap-1.5 rounded-md bg-[#D4A853] px-4 py-2 text-xs font-semibold text-[#111916] hover:bg-[#E0B96B] whitespace-nowrap cursor-pointer"
            >
              <Dices className="h-3.5 w-3.5" />
              Olay / Sahne Üret (1d100)
            </button>

            <button
              type="button"
              onClick={handleGenerateNpc}
              className="inline-flex items-center gap-1.5 rounded-md border border-[#67C7C0]/35 bg-[#132520] px-3.5 py-2 text-xs font-medium text-[#9CE3DD] hover:bg-[#19322B] whitespace-nowrap cursor-pointer"
            >
              <UserPlus className="h-3.5 w-3.5" />
              Yerli NPC Üret
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {/* Generated Scene Output */}
          <div className="lg:col-span-2 rounded-md border border-[#D4A853]/18 bg-[#101A16] p-5">
            {activeScene ? (
              <div className="space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-2 border-b border-[#D4A853]/12 pb-3">
                  <div>
                    <p className="font-mono text-xs text-[#D4A853] tabular-nums">
                      1d100: {activeScene.roll1d100} · {activeScene.category} · {activeScene.timePhase} · ~
                      {activeScene.comboSpaceSize.toLocaleString('tr-TR')} Olası Varyasyon
                    </p>
                    <h3 className="mt-1 font-display text-lg font-semibold text-[#F8F3E6]">
                      {activeScene.title}
                    </h3>
                  </div>
                  <span className="font-mono text-xs font-semibold text-[#67C7C0]">
                    {activeScene.checkLabel}
                  </span>
                </div>

                <p className="text-sm leading-relaxed text-[#EDE6D6]">{activeScene.description}</p>
                <p className="text-xs leading-relaxed text-[#E29D72]">
                  <strong>Düğüm / Zorluk:</strong> {activeScene.complication}
                </p>

                <div className="grid grid-cols-1 gap-4 border-t border-[#D4A853]/12 pt-3 sm:grid-cols-2 text-xs">
                  <div>
                    <span className="font-semibold text-[#A3B1AA]">Olası Çözüm / Taktik</span>
                    <p className="mt-1 leading-relaxed text-[#D9D3C4]">{activeScene.tactic}</p>
                  </div>
                  <div>
                    <span className="font-semibold text-[#A3B1AA]">Kazanım / İpucu</span>
                    <p className="mt-1 leading-relaxed text-[#D4A853]">{activeScene.reward}</p>
                  </div>
                </div>

                {onRecordProceduralScene && (
                  <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#D4A853]/12 pt-3">
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => handleCommitSceneToLocation(0)}
                        className="rounded border border-[#D4A853]/30 bg-[#192621] px-3 py-1.5 text-xs font-medium text-[#EDE6D6] hover:border-[#D4A853]/65 cursor-pointer"
                      >
                        Konum Kaydına İşle
                      </button>
                      <button
                        type="button"
                        onClick={() => handleCommitSceneToLocation(2)}
                        className="rounded border border-[#67C7C0]/35 bg-[#132520] px-3 py-1.5 text-xs font-medium text-[#9CE3DD] hover:bg-[#19322B] cursor-pointer"
                      >
                        İşle ve Saati +2 İlerlet
                      </button>
                    </div>
                    {sceneSavedToast && (
                      <span className="text-xs text-[#67C7C0]">{sceneSavedToast}</span>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className="flex h-full flex-col items-center justify-center py-8 text-center">
                <Compass className="mb-2 h-7 w-7 text-[#D4A853]/80" />
                <p className="text-sm font-medium text-[#EDE6D6]">
                  Seçili konum için yapay zekasız rastgele sahne üretmeye hazır
                </p>
                <p className="mt-1 max-w-md text-xs text-[#8E9C95]">
                  Her arketip için binlerce mantıklı aktör, durum, düğüm ve çözüm kombinasyonu içerir.
                </p>
              </div>
            )}
          </div>

          {/* Generated Regional NPC Output */}
          <div className="rounded-md border border-[#67C7C0]/20 bg-[#101A16] p-5">
            <h3 className="text-xs font-semibold tracking-wide text-[#67C7C0]">
              Anlık Bölge Karakteri (NPC)
            </h3>
            {generatedNpc ? (
              <div className="mt-3 space-y-2.5 text-xs">
                <div>
                  <p className="font-display text-base font-semibold text-[#F8F3E6]">
                    {generatedNpc.name}
                  </p>
                  <p className="text-[#D4A853]">
                    {generatedNpc.cultureLabel} · {generatedNpc.role}
                  </p>
                </div>
                <div className="border-t border-[#67C7C0]/12 pt-2 space-y-1.5 text-[#D9D3C4]">
                  <p>
                    <strong className="text-[#9AA8A1]">Ayırt Edici Özellik:</strong> {generatedNpc.trait}
                  </p>
                  <p>
                    <strong className="text-[#9AA8A1]">Anlık Amacı:</strong> {generatedNpc.motive}
                  </p>
                  <p>
                    <strong className="text-[#9AA8A1]">Üzerindeki Eşya:</strong> {generatedNpc.carriedItem}
                  </p>
                </div>
              </div>
            ) : (
              <p className="mt-3 text-xs leading-relaxed text-[#8E9C95]">
                Seçilen konumun kültürüne (İnsan, Elf, Bozpençe Klanı, Goblin/Kobold veya Kaçakçı) uygun isimli bir yerli karakter üretmek için <strong>Yerli NPC Üret</strong> düğmesine basın.
              </p>
            )}
          </div>
        </div>
      </section>

      {/* SECTION 3: Expedition Travel, Supply & Risk Calculator */}
      <section className="rounded-lg border border-[#D4A853]/20 bg-[#141F1B] p-6 space-y-5">
        <div className="border-b border-[#D4A853]/15 pb-4">
          <div className="flex items-center gap-2 text-xs font-semibold text-[#D4A853]">
            <Calculator className="h-4 w-4" />
            <span>Sefer, Süre, Erzak ve Risk Hesaplayıcısı</span>
          </div>
          <h2 className="mt-1 font-display text-xl font-semibold text-[#F8F3E6]">
            İki Konum Arası Lojistik Planlayıcı
          </h2>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-6">
          <label className="block text-xs text-[#A3B1AA]">
            Başlangıç
            <select
              value={calcFromId}
              onChange={(e) => setCalcFromId(e.target.value)}
              className="mt-1.5 w-full rounded-md border border-[#D4A853]/25 bg-[#0F1815] px-2.5 py-2 text-xs text-[#F8F3E6] focus:border-[#D4A853] focus:outline-none"
            >
              {locations.map((loc) => (
                <option key={loc.id} value={loc.id}>
                  {loc.name}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-xs text-[#A3B1AA]">
            Varış
            <select
              value={calcToId}
              onChange={(e) => setCalcToId(e.target.value)}
              className="mt-1.5 w-full rounded-md border border-[#D4A853]/25 bg-[#0F1815] px-2.5 py-2 text-xs text-[#F8F3E6] focus:border-[#D4A853] focus:outline-none"
            >
              {locations.map((loc) => (
                <option key={loc.id} value={loc.id}>
                  {loc.name}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-xs text-[#A3B1AA]">
            Grup Kişi Sayısı
            <input
              type="number"
              min={1}
              max={12}
              value={partySize}
              onChange={(e) => setPartySize(Number(e.target.value))}
              className="mt-1.5 w-full rounded-md border border-[#D4A853]/25 bg-[#0F1815] px-2.5 py-2 font-mono text-xs text-[#F8F3E6] focus:border-[#D4A853] focus:outline-none"
            />
          </label>

          <label className="block text-xs text-[#A3B1AA]">
            Yürüyüş Temposu
            <select
              value={pace}
              onChange={(e) => setPace(e.target.value as TravelPace)}
              className="mt-1.5 w-full rounded-md border border-[#D4A853]/25 bg-[#0F1815] px-2.5 py-2 text-xs text-[#F8F3E6] focus:border-[#D4A853] focus:outline-none"
            >
              <option value="stealth">Gizli ve Temkinli (1.35x)</option>
              <option value="normal">Normal Tempo (1.0x)</option>
              <option value="forced">Zorlu Yürüyüş (0.78x)</option>
            </select>
          </label>

          <label className="block text-xs text-[#A3B1AA]">
            Ulaşım Aracı
            <select
              value={transport}
              onChange={(e) => setTransport(e.target.value as TravelTransport)}
              className="mt-1.5 w-full rounded-md border border-[#D4A853]/25 bg-[#0F1815] px-2.5 py-2 text-xs text-[#F8F3E6] focus:border-[#D4A853] focus:outline-none"
            >
              <option value="foot">Yaya Grup</option>
              <option value="mule">Katır / Yük Arabası</option>
              <option value="boat">Kayık / Tekne Destekli</option>
            </select>
          </label>

          <label className="block text-xs text-[#A3B1AA]">
            Hava Koşulu
            <select
              value={weatherKey}
              onChange={(e) => setWeatherKey(e.target.value as WeatherConditionKey)}
              className="mt-1.5 w-full rounded-md border border-[#D4A853]/25 bg-[#0F1815] px-2.5 py-2 text-xs text-[#F8F3E6] focus:border-[#D4A853] focus:outline-none"
            >
              <option value="clear">Açık / Rüzgarlı (1.0x)</option>
              <option value="mist">Yoğun Doğu Sisi (1.12x)</option>
              <option value="rain">Soğuk Yağmur (1.22x)</option>
              <option value="storm">Fırtına / Bora (1.40x)</option>
            </select>
          </label>
        </div>

        {/* Computed Metrics */}
        <div className="grid grid-cols-1 gap-4 rounded-md border border-[#D4A853]/18 bg-[#101A16] p-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <span className="inline-flex items-center gap-1.5 text-[11px] text-[#9AA8A1]">
              <CalendarClock className="h-3.5 w-3.5 text-[#D4A853]" />
              Tahmini Süre ve Varış
            </span>
            <p className="mt-1 font-mono text-base font-semibold text-[#F8F3E6] tabular-nums">
              {expeditionPlan.durationLabel}
            </p>
            <p className="mt-0.5 font-mono text-[11px] text-[#67C7C0] tabular-nums">
              Varış: {expeditionPlan.arrivalDateTime}
            </p>
          </div>

          <div>
            <span className="inline-flex items-center gap-1.5 text-[11px] text-[#9AA8A1]">
              <Compass className="h-3.5 w-3.5 text-[#D4A853]" />
              Mesafe ve Güzergah
            </span>
            <p className="mt-1 font-mono text-base font-semibold text-[#F8F3E6] tabular-nums">
              ~{expeditionPlan.totalFersah} Fersah
            </p>
            <p className="mt-0.5 truncate text-[11px] text-[#A3B1AA]">
              {expeditionPlan.routeSourceLabel}
            </p>
          </div>

          <div>
            <span className="inline-flex items-center gap-1.5 text-[11px] text-[#9AA8A1]">
              <Package className="h-3.5 w-3.5 text-[#67C7C0]" />
              Erzak, Su ve Kamp
            </span>
            <p className="mt-1 font-mono text-base font-semibold text-[#F8F3E6] tabular-nums">
              {expeditionPlan.rationsNeeded} Porsiyon · {expeditionPlan.waterLitersNeeded}L Su
            </p>
            <p className="mt-0.5 text-[11px] text-[#A3B1AA] tabular-nums">
              {expeditionPlan.campNights} Gece Kamp
              {expeditionPlan.muleFeedBundles > 0
                ? ` · ${expeditionPlan.muleFeedBundles} Demet Yem`
                : ''}
            </p>
          </div>

          <div>
            <span className="inline-flex items-center gap-1.5 text-[11px] text-[#9AA8A1]">
              <Shield className="h-3.5 w-3.5 text-[#E29D72]" />
              Güvenlik ve Test Zorluğu
            </span>
            <p className="mt-1 font-mono text-base font-semibold text-[#E29D72] tabular-nums">
              Günlük Pusu %{expeditionPlan.dailyEncounterRiskPct}
            </p>
            <p className="mt-0.5 font-mono text-[11px] text-[#A3B1AA] tabular-nums">
              Ort. Güvenlik {expeditionPlan.avgSafety}/100 · Yön Bulma DC {expeditionPlan.navigationDc}
            </p>
          </div>
        </div>

        <div className="space-y-1.5 text-xs">
          {expeditionPlan.mazgalPath.length > 1 && (
            <p className="font-mono text-[#A3B1AA] tabular-nums">
              En Kısa Mazgal Zinciri: <span className="text-[#D4A853]">{expeditionPlan.mazgalPath.join(' → ')}</span>
            </p>
          )}
          <p className="text-[#CFC8B9]">{expeditionPlan.paceNote}</p>
          {expeditionPlan.warnings.map((w, idx) => (
            <p key={idx} className="text-[#E29D72]">
              • {w}
            </p>
          ))}
        </div>
      </section>

      {/* SECTION 4: Classic 1d12 Quick Forest Encounter + Reference Table */}
      <section className="rounded-lg border border-[#D4A853]/18 bg-[#141F1B] p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#D4A853]/15 pb-4">
          <div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-[#D4A853] tabular-nums">
              <span>{activeEncounter.type}</span>
              <span aria-hidden="true">·</span>
              <span>{activeEncounter.threat}</span>
              {lastRoll !== null && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono font-semibold text-[#F8F3E6]">
                    1d12 Sonucu: {lastRoll} (+2 Saat)
                  </span>
                </>
              )}
            </div>
            <h2 className="mt-1 font-display text-xl font-semibold text-[#F8F3E6]">
              {activeEncounter.title}
            </h2>
          </div>

          {activeEncounter.hp > 0 && (
            <div className="flex items-center gap-5 font-mono text-xs tabular-nums">
              <div className="flex items-center gap-1.5 text-[#EDE6D6]">
                <Swords className="h-4 w-4 text-[#D4A853]" />
                <span>HP: {activeEncounter.hp}</span>
              </div>
              <div className="flex items-center gap-1.5 text-[#EDE6D6]">
                <Shield className="h-4 w-4 text-[#67C7C0]" />
                <span>Savunma: {activeEncounter.defense}</span>
              </div>
            </div>
          )}
        </div>

        <p className="text-sm leading-relaxed text-[#D9D3C4]">{activeEncounter.description}</p>

        <div className="grid grid-cols-1 gap-4 border-t border-[#D4A853]/15 pt-4 sm:grid-cols-3 text-sm">
          <div>
            <h3 className="text-xs font-semibold text-[#A3B1AA]">Zayıflık / Çözüm</h3>
            <p className="mt-1 text-[#EDE6D6]">{activeEncounter.weakness}</p>
          </div>
          <div>
            <h3 className="text-xs font-semibold text-[#A3B1AA]">Yönetici Taktiği</h3>
            <p className="mt-1 text-[#EDE6D6]">{activeEncounter.tactic}</p>
          </div>
          <div>
            <h3 className="text-xs font-semibold text-[#A3B1AA]">Olası Ödül</h3>
            <p className="mt-1 text-[#D4A853]">{activeEncounter.reward}</p>
          </div>
        </div>
      </section>

      <section className="overflow-hidden rounded-lg border border-[#D4A853]/18 bg-[#141F1B]">
        <div className="border-b border-[#D4A853]/15 px-5 py-4">
          <h2 className="font-display text-lg font-semibold text-[#F8F3E6]">
            Sabit 1d12 Orman Karşılaşma Tablosu
          </h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-[#D4A853]/15 bg-[#101A16] text-xs text-[#9AA8A1]">
              <tr>
                <th className="px-5 py-3 font-medium">Zar</th>
                <th className="px-5 py-3 font-medium">Karşılaşma</th>
                <th className="px-5 py-3 font-medium">Tür</th>
                <th className="px-5 py-3 font-medium">HP / Savunma</th>
                <th className="px-5 py-3 font-medium">Zayıflık</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#D4A853]/10">
              {FOREST_ENCOUNTERS.map((enc) => {
                const isSelected = activeEncounter.id === enc.id;
                return (
                  <tr
                    key={enc.id}
                    onClick={() => {
                      soundFx.playSelectChime();
                      setActiveEncounter(enc);
                    }}
                    className={`transition-colors cursor-pointer ${
                      isSelected ? 'bg-[#1D2D27]' : 'hover:bg-[#192621]'
                    }`}
                  >
                    <td className="px-5 py-3.5 font-mono text-xs text-[#D4A853] tabular-nums whitespace-nowrap">
                      {enc.rollRange}
                    </td>
                    <td className="px-5 py-3.5 font-medium text-[#F3EBD8]">{enc.title}</td>
                    <td className="px-5 py-3.5 text-xs text-[#A3B1AA]">{enc.type}</td>
                    <td className="px-5 py-3.5 font-mono text-xs text-[#D9D3C4] tabular-nums whitespace-nowrap">
                      {enc.hp > 0 ? `${enc.hp} HP · ${enc.defense} AC` : `Test · ${enc.defense} DC`}
                    </td>
                    <td className="px-5 py-3.5 text-xs text-[#B7C4BE]">{enc.weakness}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};
