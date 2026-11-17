import React, { useEffect, useState } from 'react';
import { Clock, Compass, Dices, MapPin, RotateCcw, Shield, X } from 'lucide-react';
import type { MazgalCell, MazgalNeighborSummary, ProtagonistState } from '../types/map';
import { INITIAL_GAME_TIME_MS } from '../utils/gameTime';
import { formatTravelHours } from '../utils/gridEngine';
import { generateMazgalEvent, type MazgalProceduralEvent } from '../utils/proceduralWorldDeck';
import { soundFx } from '../utils/sound';

interface MazgalInspectorProps {
  cell: MazgalCell | undefined;
  protagonist?: ProtagonistState;
  fogOfWar: boolean;
  gameTimeMs?: number;
  resetKey?: number;
  onSelectMazgal: (id: string) => void;
  onStepMazgal?: (fromId: string, nb: MazgalNeighborSummary) => void;
  onApplyMazgalEvent?: (cell: MazgalCell, ev: MazgalProceduralEvent) => void;
  onInteractRoamingUnit?: (
    unitId: string,
    mode: 'greet_trade' | 'escort_aid' | 'ambush_raid'
  ) => string;
  onSelectLocation: (id: string) => void;
  onClose: () => void;
}

export const MazgalInspector: React.FC<MazgalInspectorProps> = ({
  cell,
  protagonist,
  fogOfWar,
  gameTimeMs = INITIAL_GAME_TIME_MS,
  resetKey = 0,
  onSelectMazgal,
  onStepMazgal,
  onApplyMazgalEvent,
  onInteractRoamingUnit,
  onSelectLocation,
  onClose,
}) => {
  const [imgFailed, setImgFailed] = useState(false);
  const [journeyPath, setJourneyPath] = useState<string[]>([]);
  const [journeyHours, setJourneyHours] = useState(0);
  const [journeyFersah, setJourneyFersah] = useState(0);
  const [advanceClockOnStep, setAdvanceClockOnStep] = useState(true);
  const [mazgalEvent, setMazgalEvent] = useState<MazgalProceduralEvent | null>(null);
  const [mazgalEventApplied, setMazgalEventApplied] = useState(false);
  const [roamFeedback, setRoamFeedback] = useState<string | null>(null);

  useEffect(() => {
    setImgFailed(false);
    setMazgalEvent(null);
    setMazgalEventApplied(false);
    setRoamFeedback(null);
    if (!cell) return;
    setJourneyPath((prev) => {
      if (prev.length === 0) return [cell.id];
      const lastId = prev[prev.length - 1];
      if (lastId === cell.id) return prev;
      // Direct click on non-adjacent cell starts a fresh route trace
      const isDirectStep = cell.neighbors.some((n) => n.id === lastId);
      if (!isDirectStep) {
        setJourneyHours(0);
        setJourneyFersah(0);
        return [cell.id];
      }
      return prev;
    });
  }, [cell?.id]);

  useEffect(() => {
    if (resetKey === 0) return;
    setJourneyHours(0);
    setJourneyFersah(0);
    setMazgalEvent(null);
    setMazgalEventApplied(false);
    setJourneyPath(cell ? [cell.id] : []);
  }, [resetKey]);

  if (!cell) {
    return (
      <aside className="flex h-full flex-col items-center justify-center rounded-lg border border-[#D4A853]/18 bg-[#141F1B] p-8 text-center">
        <Compass className="mb-3 h-8 w-8 text-[#D4A853]" />
        <h2 className="font-display text-lg text-[#F3EBD8]">Bir Mazgal Seçin</h2>
        <p className="mt-2 text-sm text-[#9AA8A1]">
          Arazi yapısını, geçiş süresini ve komşu etkilerini görmek için haritadan bir mazgal karesine tıklayın.
        </p>
      </aside>
    );
  }

  const handleStepToNeighbor = (nb: MazgalNeighborSummary) => {
    setJourneyHours((h) => h + nb.travelHours);
    setJourneyFersah((d) => d + nb.distanceFersah);
    setJourneyPath((prev) => (prev.length === 0 ? [cell.id, nb.id] : [...prev, nb.id]));
    if (advanceClockOnStep) {
      onStepMazgal?.(cell.id, nb);
    }
    onSelectMazgal(nb.id);
  };

  const handleResetJourney = () => {
    setJourneyHours(0);
    setJourneyFersah(0);
    setJourneyPath([cell.id]);
  };

  const visibleLocationsInside = fogOfWar
    ? cell.locationsInside.filter((l) => l.discovered)
    : cell.locationsInside;

  const safetyLabel =
    cell.safetyScore >= 75
      ? 'Güvenli'
      : cell.safetyScore >= 55
      ? 'Görece Güvenli'
      : cell.safetyScore >= 38
      ? 'Temkinli'
      : 'Tehlikeli';

  return (
    <aside
      aria-label="Mazgal inceleme paneli"
      className="flex flex-col overflow-hidden rounded-lg border border-[#D4A853]/20 bg-[#141F1B]"
    >
      {/* Shared Terrain Illustration */}
      <div className="relative aspect-[4/3] w-full overflow-hidden bg-[#0E1714]">
        {!imgFailed ? (
          <img
            src={cell.imageUrl}
            alt={`${cell.terrainLabel} arazi görünümü`}
            referrerPolicy="no-referrer"
            onError={() => setImgFailed(true)}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center bg-gradient-to-br from-[#182822] via-[#101A16] to-[#0B1210] p-6 text-center">
            <Compass className="mb-2 h-8 w-8 text-[#D4A853]/85" />
            <span className="font-display text-base text-[#EDE6D6]">{cell.terrainLabel}</span>
          </div>
        )}
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-gradient-to-t from-[#141F1B] via-[#141F1B]/40 to-transparent"
        />
        <button
          type="button"
          onClick={onClose}
          aria-label="Mazgal panelini kapat"
          className="absolute right-3 top-3 inline-flex h-8 w-8 items-center justify-center rounded-md bg-[#0D1512]/80 text-[#F3EBD8] border border-[#D4A853]/30 transition-colors hover:bg-[#192621] cursor-pointer"
        >
          <X className="h-4 w-4" />
        </button>
        <div className="absolute inset-x-0 bottom-0 p-4">
          <p className="font-mono text-xs font-medium text-[#D4A853] tabular-nums">
            Mazgal {cell.id} · {cell.scaleFersah}×{cell.scaleFersah} Fersah · {cell.easternBeltLabel}
          </p>
          <h2 className="mt-0.5 font-display text-xl font-semibold text-[#F8F3E6]">
            {cell.terrainLabel}
          </h2>
        </div>
      </div>

      {/* Body */}
      <div className="flex flex-col gap-5 p-5">
        {/* Zero-Pill Metadata Line */}
        <div className="flex flex-wrap items-center gap-2 text-xs text-[#A3B1AA] tabular-nums">
          <span className="inline-flex items-center gap-1 font-medium text-[#EDE6D6]">
            <Shield className="h-3.5 w-3.5 text-[#D4A853]" />
            Güvenlik {cell.safetyScore}/100 ({safetyLabel})
          </span>
          <span aria-hidden="true">·</span>
          <span>Tehlike {cell.dangerLevel}/5</span>
        </div>

        {/* Terrain Metrics */}
        <div className="grid grid-cols-2 gap-3 border-t border-[#D4A853]/15 pt-4 text-xs">
          <div>
            <span className="text-[#8E9C95]">Bölge Geçişi ({cell.scaleFersah} Fersah)</span>
            <p className="mt-0.5 font-mono text-[#EDE6D6] tabular-nums">
              ~{cell.crossingLabel} · {cell.travelSpeedLabel}
            </p>
          </div>
          <div>
            <span className="text-[#8E9C95]">Görüş Mesafesi</span>
            <p className="mt-0.5 font-mono text-[#EDE6D6] tabular-nums">{cell.visibilityMeters} Metre</p>
          </div>
          <div className="col-span-2">
            <span className="text-[#8E9C95]">Doğal Kaynak ve Av</span>
            <p className="mt-0.5 text-[#EDE6D6]">{cell.resourceYield}</p>
          </div>
        </div>

        <div className="border-t border-[#D4A853]/15 pt-4">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-xs font-semibold tracking-wide text-[#D4A853]">Arazi Özeti</h3>
            <button
              type="button"
              onClick={() => {
                soundFx.playDiceRoll();
                setMazgalEvent(
                  generateMazgalEvent(
                    cell,
                    gameTimeMs,
                    protagonist?.activeWorldWave?.dangerShift ?? 0
                  )
                );
                setMazgalEventApplied(false);
              }}
              className="inline-flex items-center gap-1 rounded border border-[#D4A853]/30 bg-[#192621] px-2.5 py-1 text-[11px] font-medium text-[#E8C472] hover:border-[#D4A853]/65 cursor-pointer"
            >
              <Dices className="h-3 w-3" />
              Mazgal Olay Zarı (1d20)
            </button>
          </div>
          <p className="mt-1.5 text-sm leading-relaxed text-[#D9D3C4]">{cell.summary}</p>

          {mazgalEvent && (
            <div className="mt-3 rounded-md border border-[#D4A853]/25 bg-[#101A16] p-3 text-xs space-y-2">
              <div className="flex items-center justify-between gap-2 font-mono text-[10px]">
                <span className="text-[#D4A853]">
                  1d20: {mazgalEvent.roll1d20} · {mazgalEvent.kind}
                </span>
                <span className="text-[#67C7C0]">{mazgalEvent.checkHint}</span>
              </div>
              <p className="font-semibold text-[#F8F3E6]">{mazgalEvent.title}</p>
              <p className="leading-relaxed text-[#CFC8B9]">{mazgalEvent.detail}</p>
              <p className="text-[11px] text-[#D4A853]">{mazgalEvent.outcomeNote}</p>
              {onApplyMazgalEvent && (
                <div className="flex items-center justify-between gap-2 border-t border-[#D4A853]/15 pt-2">
                  <button
                    type="button"
                    disabled={mazgalEventApplied}
                    onClick={() => {
                      onApplyMazgalEvent(cell, mazgalEvent);
                      setMazgalEventApplied(true);
                    }}
                    className={`rounded border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                      mazgalEventApplied
                        ? 'border-[#67C7C0]/25 bg-[#132520]/60 text-[#7BAFA9] cursor-default'
                        : 'border-[#67C7C0]/40 bg-[#132520] text-[#9CE3DD] hover:bg-[#19322B] cursor-pointer'
                    }`}
                  >
                    {mazgalEventApplied ? 'Karşılaşma İşlendi (+1 Saat)' : 'Olayı Yaşa (+1 Saat)'}
                  </button>
                  {mazgalEventApplied && (
                    <span className="text-[10px] text-[#67C7C0]">Karaktere ve zamana işlendi</span>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Locations inside this cell */}
        {visibleLocationsInside.length > 0 && (
          <div className="border-t border-[#D4A853]/15 pt-4">
            <h3 className="text-xs font-semibold tracking-wide text-[#D4A853]">
              Bu Mazgaldaki Konumlar
            </h3>
            <div className="mt-2 space-y-1.5">
              {visibleLocationsInside.map((loc) => (
                <button
                  key={loc.id}
                  type="button"
                  onClick={() => onSelectLocation(loc.id)}
                  className="flex w-full items-center justify-between rounded-md bg-[#192621] px-3 py-2 text-left text-xs transition-colors hover:bg-[#22332C] cursor-pointer"
                >
                  <span className="inline-flex items-center gap-1.5 font-medium text-[#F3EBD8]">
                    <MapPin className="h-3.5 w-3.5 text-[#D4A853]" />
                    {loc.name}
                  </span>
                  <span className="text-[#8E9C95]">Detayı Aç</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Roaming Units inside this cell */}
        {(() => {
          const cellUnits = (protagonist?.roamingUnits ?? []).filter(
            (u) => u.mazgalId === cell.id
          );
          if (cellUnits.length === 0) return null;
          const isPlayerInCell = protagonist?.mazgalId === cell.id;
          return (
            <div className="border-t border-[#D4A853]/15 pt-4 space-y-2">
              <h3 className="text-xs font-semibold tracking-wide text-[#67C7C0]">
                Bu Mazgaldaki Hareketli Gruplar ({cellUnits.length})
              </h3>
              {roamFeedback && (
                <p className="rounded border border-[#D4A853]/30 bg-[#15201B] px-2.5 py-1.5 text-[11px] text-[#E8C472]">
                  {roamFeedback}
                </p>
              )}
              {cellUnits.map((unit) => (
                <div
                  key={unit.id}
                  className="rounded border border-[#D4A853]/20 bg-[#101A16] p-2.5 text-xs space-y-1.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-[#F3EBD8]">{unit.name}</span>
                    <span className="font-mono text-[10px] text-[#9AA8A1]">
                      Güç {unit.strength}/5
                    </span>
                  </div>
                  <p className="text-[11px] text-[#CFC8B9]">{unit.statusNote}</p>
                  {isPlayerInCell && onInteractRoamingUnit ? (
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      <button
                        type="button"
                        onClick={() =>
                          setRoamFeedback(onInteractRoamingUnit(unit.id, 'greet_trade'))
                        }
                        className="rounded border border-[#67C7C0]/30 bg-[#13241F] px-2 py-1 text-[10px] text-[#9CE3DD] hover:bg-[#19322B] cursor-pointer"
                      >
                        Selamla / Bilgi (+1s)
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setRoamFeedback(onInteractRoamingUnit(unit.id, 'escort_aid'))
                        }
                        className="rounded border border-[#D4A853]/30 bg-[#1A241E] px-2 py-1 text-[10px] text-[#E8C472] hover:bg-[#233129] cursor-pointer"
                      >
                        Eşlik / Destek (+1s)
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setRoamFeedback(onInteractRoamingUnit(unit.id, 'ambush_raid'))
                        }
                        className="rounded border border-[#DC6B6B]/30 bg-[#231718] px-2 py-1 text-[10px] text-[#F2B8B8] hover:bg-[#2E1E1F] cursor-pointer"
                      >
                        Baskın / Çatış (+1s)
                      </button>
                    </div>
                  ) : (
                    <p className="text-[10px] text-[#8E9C95]">
                      Karşılaşmak için bu mazgala yürüyün.
                    </p>
                  )}
                </div>
              ))}
            </div>
          );
        })()}

        {/* Neighbor Effects */}
        <div className="border-t border-[#D4A853]/15 pt-4">
          <h3 className="text-xs font-semibold tracking-wide text-[#67C7C0]">
            Komşu Mazgal Etkileri
          </h3>
          <ul className="mt-2 space-y-1.5 text-xs leading-relaxed text-[#CFC8B9]">
            {cell.neighborEffects.map((eff, i) => (
              <li key={i}>{eff}</li>
            ))}
          </ul>
        </div>

        {/* Neighbor Step Navigation with Travel Time */}
        <div className="border-t border-[#D4A853]/15 pt-4">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-xs font-semibold tracking-wide text-[#A3B1AA]">
              Komşu Mazgallara Geçiş Süresi
            </h3>
            {journeyHours > 0 && (
              <button
                type="button"
                onClick={handleResetJourney}
                className="inline-flex items-center gap-1 text-[11px] font-medium text-[#D4A853] hover:text-[#E8C472] cursor-pointer"
              >
                <RotateCcw className="h-3 w-3" />
                Süreyi Sıfırla
              </button>
            )}
          </div>

          {journeyHours > 0 && (
            <div className="mt-2 rounded-md border border-[#67C7C0]/25 bg-[#101C18] px-3 py-2 text-xs">
              <div className="flex items-center justify-between gap-2 text-[#9CE3DD]">
                <span className="inline-flex items-center gap-1.5 font-medium">
                  <Clock className="h-3.5 w-3.5" />
                  Toplam Sefer: {formatTravelHours(journeyHours)}
                </span>
                <span className="font-mono text-[11px] tabular-nums">{journeyFersah} Fersah</span>
              </div>
              <p className="mt-1 truncate font-mono text-[11px] text-[#9AA8A1]">
                {journeyPath.join(' → ')}
              </p>
            </div>
          )}

          <label className="mt-2 flex items-center gap-2 text-[11px] text-[#9AA8A1] cursor-pointer select-none">
            <input
              type="checkbox"
              checked={advanceClockOnStep}
              onChange={(e) => setAdvanceClockOnStep(e.target.checked)}
              className="h-3.5 w-3.5 accent-[#D4A853] cursor-pointer"
            />
            <span>Komşu mazgala yürüyüşte oyun tarihini ve saatini ilerlet</span>
          </label>

          <div className="mt-2.5 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            {cell.neighbors.map((nb) => (
              <button
                key={nb.id}
                type="button"
                onClick={() => handleStepToNeighbor(nb)}
                className="flex flex-col rounded bg-[#192621] px-2.5 py-2 text-left text-xs transition-colors hover:bg-[#22332C] cursor-pointer"
              >
                <div className="flex w-full items-center justify-between gap-1">
                  <span className="truncate font-medium text-[#EDE6D6]">
                    <strong className="font-mono text-[#D4A853]">{nb.id}</strong> · {nb.direction}
                  </span>
                  <span className="shrink-0 font-mono text-[11px] font-semibold text-[#67C7C0] tabular-nums">
                    {nb.travelLabel}
                  </span>
                </div>
                <div className="mt-1 flex w-full items-center justify-between gap-1 text-[10px] text-[#9AA8A1] tabular-nums">
                  <span className="truncate">{nb.transitionNote}</span>
                  <span className="shrink-0">{nb.distanceFersah} Fersah</span>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </aside>
  );
};
