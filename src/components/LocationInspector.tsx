import React, { useEffect, useState } from 'react';
import {
  CheckCircle2,
  Compass,
  Dices,
  Edit3,
  Eye,
  EyeOff,
  Grid,
  MapPin,
  MessageSquare,
  Navigation,
  ShieldAlert,
  Trash2,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { CATEGORY_LABELS } from '../data/easternForestData';
import type {
  MapLocation,
  MapRoute,
  ProtagonistState,
  SettlementResident,
} from '../types/map';
import { getCellForCoords } from '../utils/gridEngine';
import { getDailyRoutineForLocation, getLivingSectionLabels } from '../utils/livingWorldEngine';
import {
  generateProceduralNpc,
  generateProceduralScene,
  type ProceduralNpcCard,
  type ProceduralSceneCard,
} from '../utils/proceduralWorldDeck';
import {
  FACTION_LABELS,
  getFactionForLocation,
  getReputationLabel,
} from '../utils/protagonistEngine';
import { soundFx } from '../utils/sound';

interface LocationInspectorProps {
  location: MapLocation | undefined;
  routes: MapRoute[];
  allLocations: MapLocation[];
  isPartyHere: boolean;
  protagonist?: ProtagonistState;
  fogOfWar: boolean;
  gameTimeMs: number;
  onMoveParty: (id: string) => void;
  onToggleDiscovered: (id: string) => void;
  onSelectLocation: (id: string) => void;
  onEditLocation: (loc: MapLocation) => void;
  onDeleteLocation: (id: string) => void;
  onInspectMazgal?: (mazgalId: string) => void;
  onResolveVillageProblem?: (locationId: string, problemId: string) => string | void;
  onInteractRoamingUnit?: (
    unitId: string,
    mode: 'greet_trade' | 'escort_aid' | 'ambush_raid'
  ) => string;
  onRecordProceduralScene?: (scene: ProceduralSceneCard, advanceHours: number) => void;
  onMeetProceduralNpc?: (npc: ProceduralNpcCard, locationId?: string) => void;
  onMeetResident?: (resident: SettlementResident, locationId: string) => void;
  onOpenProtagonist?: (tab?: 'status' | 'party' | 'relations') => void;
  onClose?: () => void;
}

export const LocationInspector: React.FC<LocationInspectorProps> = ({
  location,
  routes,
  allLocations,
  isPartyHere,
  protagonist,
  fogOfWar,
  gameTimeMs,
  onMoveParty,
  onToggleDiscovered,
  onSelectLocation,
  onEditLocation,
  onDeleteLocation,
  onInspectMazgal,
  onResolveVillageProblem,
  onInteractRoamingUnit,
  onRecordProceduralScene,
  onMeetProceduralNpc,
  onMeetResident,
  onOpenProtagonist,
  onClose,
}) => {
  const [imgFailed, setImgFailed] = useState(false);
  const [rolledScene, setRolledScene] = useState<ProceduralSceneCard | null>(null);
  const [rolledNpc, setRolledNpc] = useState<ProceduralNpcCard | null>(null);
  const [problemFeedback, setProblemFeedback] = useState<string | null>(null);
  const [roamFeedback, setRoamFeedback] = useState<string | null>(null);

  useEffect(() => {
    setImgFailed(false);
    setRolledScene(null);
    setRolledNpc(null);
    setProblemFeedback(null);
    setRoamFeedback(null);
  }, [location?.id]);

  if (!location) {
    return (
      <aside className="flex h-full flex-col items-center justify-center rounded-lg border border-[#D4A853]/18 bg-[#141F1B] p-8 text-center">
        <Compass className="mb-3 h-8 w-8 text-[#D4A853]" />
        <h2 className="font-display text-lg text-[#F3EBD8]">Bir Konum Seçin</h2>
        <p className="mt-2 text-sm text-[#9AA8A1]">
          Bölge detaylarını, ipuçlarını ve karşılaşma notlarını görmek için haritadan bir noktaya tıklayın.
        </p>
      </aside>
    );
  }

  const connectedRoutes = routes.filter(
    (r) => r.fromId === location.id || r.toId === location.id
  );

  return (
    <aside
      aria-label="Konum inceleme paneli"
      className="flex flex-col overflow-hidden rounded-lg border border-[#D4A853]/20 bg-[#141F1B]"
    >
      {/* Vignette Header Artwork */}
      <div className="relative aspect-[4/3] w-full overflow-hidden bg-[#0E1714]">
        {location.imageUrl && !imgFailed ? (
          <img
            src={location.imageUrl}
            alt={`${location.name} JRPG sahne illüstrasyonu`}
            referrerPolicy="no-referrer"
            onError={() => setImgFailed(true)}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center bg-gradient-to-br from-[#182822] via-[#101A16] to-[#0B1210] p-6 text-center">
            <MapPin className="mb-2 h-8 w-8 text-[#D4A853]/85" />
            <span className="font-display text-base text-[#EDE6D6]">{location.name}</span>
            <span className="mt-1 text-xs text-[#8E9C95]">{CATEGORY_LABELS[location.category]}</span>
          </div>
        )}
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-gradient-to-t from-[#141F1B] via-[#141F1B]/35 to-transparent"
        />
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Konum panelini kapat"
            className="absolute right-3 top-3 inline-flex h-8 w-8 items-center justify-center rounded-md bg-[#0D1512]/80 text-[#F3EBD8] border border-[#D4A853]/30 transition-colors hover:bg-[#192621] cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        )}
        <div className="absolute inset-x-0 bottom-0 p-4">
          <p className="text-xs font-medium text-[#D4A853]">{location.subtitle}</p>
          <h2 className="mt-0.5 font-display text-xl font-semibold text-[#F8F3E6]">
            {location.name}
          </h2>
        </div>
      </div>

      {/* Body Details */}
      <div className="flex flex-col gap-5 p-5">
        {/* Zero-Pill Metadata Line */}
        <div className="flex flex-wrap items-center gap-2 text-xs text-[#A3B1AA] tabular-nums">
          <span className="font-medium text-[#EDE6D6]">{CATEGORY_LABELS[location.category]}</span>
          <span aria-hidden="true">·</span>
          <span>Tehlike {location.dangerLevel}/5</span>
          <span aria-hidden="true">·</span>
          <span>{location.travelTime}</span>
          <span aria-hidden="true">·</span>
          <span className="font-mono text-[#D4A853]">
            Mazgal {getCellForCoords(location.x, location.y).id}
          </span>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => onMoveParty(location.id)}
            disabled={isPartyHere}
            className={`inline-flex flex-1 items-center justify-center gap-1.5 rounded-md px-3.5 py-2 text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer disabled:cursor-default ${
              isPartyHere
                ? 'bg-[#1D2D27] text-[#67C7C0] border border-[#67C7C0]/30'
                : 'bg-[#D4A853] text-[#111916] hover:bg-[#E0B96B]'
            }`}
          >
            <Navigation className="h-3.5 w-3.5" />
            {isPartyHere ? 'Şu An Buradasın' : 'Buraya Yürü'}
          </button>

          <button
            type="button"
            onClick={() => onToggleDiscovered(location.id)}
            className="inline-flex items-center gap-1.5 rounded-md border border-[#D4A853]/25 bg-[#192621] px-3 py-2 text-xs font-medium text-[#EDE6D6] transition-colors hover:border-[#D4A853]/55 whitespace-nowrap cursor-pointer"
          >
            {location.discovered ? (
              <>
                <Eye className="h-3.5 w-3.5 text-[#67C7C0]" />
                Keşfedildi
              </>
            ) : (
              <>
                <EyeOff className="h-3.5 w-3.5 text-[#9AA8A1]" />
                Siste Gizli
              </>
            )}
          </button>

          <button
            type="button"
            onClick={() => onEditLocation(location)}
            aria-label="Konumu düzenle"
            className="inline-flex items-center justify-center rounded-md border border-[#D4A853]/25 bg-[#192621] p-2 text-[#C8D0CB] transition-colors hover:text-[#F3EBD8] cursor-pointer"
          >
            <Edit3 className="h-3.5 w-3.5" />
          </button>

          {location.isCustom && (
            <button
              type="button"
              onClick={() => onDeleteLocation(location.id)}
              aria-label="Özel konumu sil"
              className="inline-flex items-center justify-center rounded-md border border-[#DC6B6B]/30 bg-[#26191A] p-2 text-[#E89898] transition-colors hover:bg-[#342021] cursor-pointer"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {onInspectMazgal && (
          <button
            type="button"
            onClick={() => onInspectMazgal(getCellForCoords(location.x, location.y).id)}
            className="inline-flex w-full items-center justify-center gap-2 rounded-md border border-[#D4A853]/25 bg-[#192621] px-3.5 py-2 text-xs font-medium text-[#D4A853] transition-colors hover:border-[#D4A853]/60 hover:bg-[#1F2F29] cursor-pointer"
          >
            <Grid className="h-3.5 w-3.5" />
            <span>
              Bulunduğu Mazgalı İncele ({getCellForCoords(location.x, location.y).id})
            </span>
          </button>
        )}

        {protagonist && (() => {
          const factionKey = getFactionForLocation(location);
          const repScore = protagonist.reputation[factionKey] ?? 0;
          const repInfo = getReputationLabel(repScore);
          const localContacts = (protagonist.contacts ?? []).filter(
            (c) => c.currentLocationId === location.id
          );
          return (
            <div className="space-y-2 rounded-md border border-[#67C7C0]/20 bg-[#101C18] px-3 py-2.5 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <span className="text-[#9AA8A1]">{FACTION_LABELS[factionKey]} İtibarı: </span>
                  <strong className="font-mono text-[#67C7C0] tabular-nums">
                    {repScore > 0 ? `+${repScore}` : repScore} ({repInfo.label})
                  </strong>
                </div>
                {onOpenProtagonist && (
                  <button
                    type="button"
                    onClick={() => onOpenProtagonist('status')}
                    className="text-[11px] font-medium text-[#D4A853] hover:text-[#E8C472] cursor-pointer"
                  >
                    Durumunu Gör
                  </button>
                )}
              </div>
              {localContacts.length > 0 && (
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#67C7C0]/15 pt-1.5 text-[11px]">
                  <span className="text-[#CFC8B9]">
                    <strong className="text-[#D4A853]">Buradaki Tanıdıklar:</strong>{' '}
                    {localContacts.map((c) => c.name).join(', ')}
                  </span>
                  {onOpenProtagonist && (
                    <button
                      type="button"
                      onClick={() => onOpenProtagonist('relations')}
                      className="font-medium text-[#67C7C0] hover:text-[#9CE3DD] cursor-pointer"
                    >
                      İlişkileri & Partiyi Aç
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })()}

        {/* Player Lore */}
        <div className="border-t border-[#D4A853]/15 pt-4">
          <h3 className="text-xs font-semibold tracking-wide text-[#D4A853]">
            Bölge Tasviri (Oyunculara Okunabilir)
          </h3>
          <p className="mt-2 text-sm leading-relaxed text-[#D9D3C4]">{location.playerLore}</p>
        </div>

        {/* GM Secret - hidden when Fog of War (Player View) is active */}
        {!fogOfWar ? (
          <div className="border-t border-[#D4A853]/15 pt-4">
            <div className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-[#E29D72]">
              <ShieldAlert className="h-3.5 w-3.5" />
              <span>Yönetici Sırrı (GM Notu)</span>
            </div>
            <p className="mt-2 text-sm leading-relaxed text-[#CFC8B9]">{location.gmSecret}</p>
          </div>
        ) : (
          <div className="border-t border-[#D4A853]/15 pt-4">
            <p className="text-xs text-[#8E9C95]">
              Keşif Sisi açıkken yönetici sırları oyuncu ekranında gizlenir.
            </p>
          </div>
        )}

        {/* Hooks, NPCs, Loot */}
        {location.hooks.length > 0 && (
          <div className="border-t border-[#D4A853]/15 pt-4">
            <h3 className="text-xs font-semibold tracking-wide text-[#D4A853]">Macera İpuçları</h3>
            <ul className="mt-2 space-y-1.5 text-sm text-[#D9D3C4]">
              {location.hooks.map((hook, i) => (
                <li key={i} className="leading-snug">
                  {i + 1}. {hook}
                </li>
              ))}
            </ul>
          </div>
        )}

        {(location.npcsOrFoes.length > 0 || location.loot.length > 0) && (
          <div className="grid grid-cols-1 gap-4 border-t border-[#D4A853]/15 pt-4 sm:grid-cols-2">
            {location.npcsOrFoes.length > 0 && (
              <div>
                <h3 className="text-xs font-semibold text-[#A3B1AA]">Karakterler ve Tehditler</h3>
                <ul className="mt-1.5 space-y-1 text-xs text-[#EDE6D6]">
                  {location.npcsOrFoes.map((npc, i) => (
                    <li key={i}>{npc}</li>
                  ))}
                </ul>
              </div>
            )}
            {location.loot.length > 0 && (
              <div>
                <h3 className="text-xs font-semibold text-[#A3B1AA]">Ödüller ve Eşyalar</h3>
                <ul className="mt-1.5 space-y-1 text-xs text-[#EDE6D6]">
                  {location.loot.map((item, i) => (
                    <li key={i}>{item}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {/* Living Settlement Simulation Panel */}
        {location.livingState?.enabled && (() => {
          const ls = location.livingState;
          const labels = getLivingSectionLabels(ls.archetype);
          const routine = getDailyRoutineForLocation(location, gameTimeMs);
          const moodColor =
            ls.mood === 'Mutlu' || ls.mood === 'Huzurlu'
              ? 'text-[#67C7C0]'
              : ls.mood === 'Temkinli'
              ? 'text-[#D4A853]'
              : 'text-[#E89898]';
          const populationLabel =
            ls.populationEstimate > 0
              ? `~${ls.populationEstimate} ${ls.unitLabel ?? 'Kişi'}`
              : ls.unitLabel ?? 'Issız Bölge';

          return (
            <div className="space-y-4 border-t border-[#D4A853]/25 pt-4">
              <div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-xs font-semibold tracking-wide text-[#D4A853]">
                    {labels.heading}
                  </h3>
                  <span className={`font-mono text-xs font-semibold tabular-nums ${moodColor}`}>
                    {ls.mood} · Moral {ls.morale}/100 · {populationLabel}
                  </span>
                </div>

                {/* Current Hourly Routine */}
                <div className="mt-2.5 rounded-md border border-[#D4A853]/15 bg-[#101A16] p-3">
                  <p className="text-[11px] font-semibold text-[#67C7C0]">{routine.timeSlot}</p>
                  <p className="mt-1 text-xs leading-relaxed text-[#D9D3C4]">{routine.activity}</p>
                </div>

                {/* Instant Procedural Engine Controls */}
                <div className="mt-2.5 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      soundFx.playDiceRoll();
                      setRolledScene(
                        generateProceduralScene(
                          location,
                          gameTimeMs,
                          'auto',
                          Math.max(25, 100 - location.dangerLevel * 15),
                          protagonist?.activeWorldWave?.dangerShift ?? 0
                        )
                      );
                    }}
                    className="inline-flex flex-1 items-center justify-center gap-1.5 rounded border border-[#D4A853]/30 bg-[#182520] px-2.5 py-1.5 text-[11px] font-medium text-[#E8C472] hover:border-[#D4A853]/65 whitespace-nowrap cursor-pointer"
                  >
                    <Dices className="h-3.5 w-3.5" />
                    Anlık Olay Üret (1d100)
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      soundFx.playSelectChime();
                      setRolledNpc(generateProceduralNpc(ls.archetype));
                    }}
                    className="inline-flex items-center justify-center gap-1.5 rounded border border-[#67C7C0]/30 bg-[#13241F] px-2.5 py-1.5 text-[11px] font-medium text-[#9CE3DD] hover:border-[#67C7C0]/60 whitespace-nowrap cursor-pointer"
                  >
                    <UserPlus className="h-3.5 w-3.5" />
                    NPC Üret
                  </button>
                </div>

                {rolledScene && (
                  <div className="mt-2.5 rounded-md border border-[#D4A853]/30 bg-[#15221D] p-3 text-xs space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-[10px] text-[#D4A853]">
                        1d100: {rolledScene.roll1d100} · {rolledScene.category}
                      </span>
                      <span className="font-mono text-[10px] text-[#67C7C0]">
                        {rolledScene.checkLabel}
                      </span>
                    </div>
                    <p className="font-semibold text-[#F8F3E6]">{rolledScene.title}</p>
                    <p className="leading-relaxed text-[#D9D3C4]">{rolledScene.description}</p>
                    <p className="text-[11px] text-[#E29D72]">{rolledScene.complication}</p>
                    <p className="text-[11px] text-[#D4A853]">
                      <strong>Çözüm/Ödül:</strong> {rolledScene.tactic} → {rolledScene.reward}
                    </p>
                    {onRecordProceduralScene && (
                      <button
                        type="button"
                        onClick={() => {
                          soundFx.playSelectChime();
                          onRecordProceduralScene(rolledScene, 2);
                          setRolledScene(null);
                        }}
                        className="w-full rounded bg-[#D4A853] px-2.5 py-1.5 text-[11px] font-semibold text-[#111916] hover:bg-[#E0B96B] cursor-pointer"
                      >
                        Bölge Kaydına İşle (+2 Saat)
                      </button>
                    )}
                  </div>
                )}

                {rolledNpc && (
                  <div className="mt-2.5 rounded-md border border-[#67C7C0]/25 bg-[#101C18] p-3 text-xs space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-[#F8F3E6]">{rolledNpc.name}</span>
                      <span className="text-[10px] text-[#D4A853]">{rolledNpc.role}</span>
                    </div>
                    <p className="text-[11px] text-[#9AA8A1]">{rolledNpc.trait}</p>
                    <p className="text-[11px] text-[#CFC8B9]">
                      <strong>Amacı:</strong> {rolledNpc.motive} · <strong>Eşya:</strong> {rolledNpc.carriedItem}
                    </p>
                    {onMeetProceduralNpc && (
                      <button
                        type="button"
                        onClick={() => {
                          onMeetProceduralNpc(rolledNpc, location.id);
                          setRolledNpc(null);
                        }}
                        className="mt-1 w-full rounded border border-[#67C7C0]/40 bg-[#132520] px-2.5 py-1.5 text-[11px] font-medium text-[#9CE3DD] hover:bg-[#19322B] cursor-pointer"
                      >
                        Tanış ve İlişki Kur (Parti / İlişkiler)
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* Active Problems */}
              <div>
                <h4 className="text-xs font-semibold text-[#E29D72]">
                  {labels.problemsHeading} ({ls.activeProblems.length})
                </h4>
                {problemFeedback && (
                  <p className="mt-1.5 rounded border border-[#67C7C0]/30 bg-[#101D19] px-2.5 py-1.5 text-[11px] text-[#9CE3DD]">
                    {problemFeedback}
                  </p>
                )}
                {ls.activeProblems.length === 0 ? (
                  <p className="mt-1 text-xs text-[#8E9C95]">
                    {labels.noProblemsText}
                  </p>
                ) : (
                  <div className="mt-2 space-y-2">
                    {ls.activeProblems.map((prob) => (
                      <div
                        key={prob.id}
                        className="rounded-md border border-[#E29D72]/25 bg-[#1A201D] p-3 text-xs"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="font-semibold text-[#F8F3E6]">{prob.title}</p>
                            <p className="mt-0.5 font-mono text-[10px] text-[#9AA8A1] tabular-nums">
                              Önem: {prob.severity} · Deneme: {prob.attempts} · Başlangıç: {prob.startedAt}
                            </p>
                          </div>
                          {onResolveVillageProblem && (
                            <button
                              type="button"
                              onClick={() => {
                                const msg = onResolveVillageProblem(location.id, prob.id);
                                if (typeof msg === 'string') setProblemFeedback(msg);
                              }}
                              className="inline-flex shrink-0 items-center gap-1 rounded border border-[#67C7C0]/35 bg-[#132520] px-2 py-1 text-[11px] font-medium text-[#9CE3DD] hover:bg-[#19322B] whitespace-nowrap cursor-pointer"
                            >
                              <CheckCircle2 className="h-3 w-3" />
                              Müdahale Et (+3s)
                            </button>
                          )}
                        </div>
                        <p className="mt-1.5 leading-relaxed text-[#CFC8B9]">{prob.description}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Roaming Units currently parked at this location */}
              {(() => {
                const localUnits = (protagonist?.roamingUnits ?? []).filter(
                  (u) => Math.hypot(u.x - location.x, u.y - location.y) < 1.8
                );
                if (localUnits.length === 0) return null;
                return (
                  <div className="space-y-2">
                    <h4 className="text-xs font-semibold text-[#D4A853]">
                      Bölgedeki Hareketli Gruplar ({localUnits.length})
                    </h4>
                    {roamFeedback && (
                      <p className="rounded border border-[#D4A853]/30 bg-[#15201B] px-2.5 py-1.5 text-[11px] text-[#E8C472]">
                        {roamFeedback}
                      </p>
                    )}
                    {localUnits.map((unit) => (
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
                        <p className="text-[11px] text-[#CFC8B9]">{unit.cargoOrHook}</p>
                        {isPartyHere && onInteractRoamingUnit ? (
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
                            Etkileşim için bu konuma seyahat etmelisin.
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                );
              })()}

              {/* Rumors */}
              {ls.rumors.length > 0 && (
                <div>
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-[#A3B1AA]">
                    <MessageSquare className="h-3.5 w-3.5 text-[#D4A853]" />
                    <span>{labels.rumorsHeading}</span>
                  </div>
                  <ul className="mt-1.5 space-y-1.5 text-xs leading-relaxed text-[#D9D3C4]">
                    {ls.rumors.map((rumor, idx) => (
                      <li key={idx} className="border-b border-[#D4A853]/10 pb-1.5 last:border-b-0 last:pb-0">
                        “{rumor}”
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Notable Emergent Residents */}
              {ls.notableResidents.length > 0 && (
                <div>
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-[#67C7C0]">
                    <Users className="h-3.5 w-3.5" />
                    <span>{labels.residentsHeading}</span>
                  </div>
                  <div className="mt-2 space-y-2">
                    {ls.notableResidents.map((res) => (
                      <div
                        key={res.id}
                        className="rounded border border-[#67C7C0]/20 bg-[#101B17] px-3 py-2 text-xs"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold text-[#F3EBD8]">{res.name}</span>
                          <span className="text-[11px] text-[#D4A853]">{res.role}</span>
                        </div>
                        <p className="mt-0.5 text-[11px] text-[#9AA8A1]">{res.trait}</p>
                        <p className="mt-1 text-[11px] text-[#CFC8B9]">{res.renownNote}</p>
                        {onMeetResident && (
                          <button
                            type="button"
                            onClick={() => onMeetResident(res, location.id)}
                            className="mt-1.5 rounded border border-[#67C7C0]/30 bg-[#13241F] px-2 py-1 text-[10px] font-medium text-[#9CE3DD] hover:bg-[#19322B] cursor-pointer"
                          >
                            Tanış / İlişkilere Ekle
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Establishments */}
              <div>
                <h4 className="text-xs font-semibold text-[#A3B1AA]">{labels.establishmentsHeading}</h4>
                <p className="mt-1 text-xs leading-relaxed text-[#EDE6D6]">
                  {ls.establishments.join(' · ')}
                </p>
              </div>

              {/* Dynamic Hooks from Living Events */}
              {ls.dynamicHooks.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold text-[#D4A853]">
                    Olaylardan Doğan Görev ve Tanışma Fırsatları
                  </h4>
                  <ul className="mt-1.5 space-y-1 text-xs text-[#D9D3C4]">
                    {ls.dynamicHooks.map((hk, i) => (
                      <li key={i}>• {hk}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Chronicle */}
              <div>
                <h4 className="text-xs font-semibold text-[#A3B1AA]">
                  {labels.chronicleHeading} (Son {ls.chronicle.length})
                </h4>
                <ol className="mt-2 max-h-56 space-y-2 overflow-y-auto pr-1">
                  {ls.chronicle.map((ev) => (
                    <li
                      key={ev.id}
                      className="border-b border-[#D4A853]/10 pb-2 text-xs last:border-b-0 last:pb-0"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium text-[#EDE6D6]">
                          <span className="text-[#D4A853]">{ev.kind}</span> · {ev.title}
                        </span>
                        <span className="shrink-0 font-mono text-[10px] text-[#8E9C95] tabular-nums">
                          {ev.timestamp}
                        </span>
                      </div>
                      <p className="mt-0.5 leading-relaxed text-[#A3B1AA]">{ev.detail}</p>
                    </li>
                  ))}
                </ol>
              </div>
            </div>
          );
        })()}

        {/* Connected Routes */}
        {connectedRoutes.length > 0 && (
          <div className="border-t border-[#D4A853]/15 pt-4">
            <h3 className="text-xs font-semibold tracking-wide text-[#A3B1AA]">Bağlantılı Yollar</h3>
            <div className="mt-2 space-y-1.5">
              {connectedRoutes.map((rt) => {
                const targetId = rt.fromId === location.id ? rt.toId : rt.fromId;
                const targetLoc = allLocations.find((l) => l.id === targetId);
                if (!targetLoc) return null;
                if (fogOfWar && !targetLoc.discovered) return null;
                return (
                  <button
                    key={rt.id}
                    type="button"
                    onClick={() => onSelectLocation(targetLoc.id)}
                    className="flex w-full items-center justify-between rounded-md bg-[#192621] px-3 py-2 text-left text-xs transition-colors hover:bg-[#22332C] cursor-pointer"
                  >
                    <span className="font-medium text-[#EDE6D6]">
                      {targetLoc.name} <span className="text-[#8E9C95]">({rt.name})</span>
                    </span>
                    <span className="font-mono text-[#D4A853] tabular-nums">
                      {rt.travelHours >= 24
                        ? `${(rt.travelHours / 24).toFixed(rt.travelHours % 24 === 0 ? 0 : 1)} Gün`
                        : `${rt.travelHours} Saat`}{' '}
                      · {rt.hazard}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </aside>
  );
};
