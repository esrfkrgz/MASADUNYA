import React, { useState } from 'react';
import {
  Briefcase,
  Coins,
  Compass,
  Edit3,
  Eye,
  Flag,
  Heart,
  HeartHandshake,
  MessageSquare,
  Package,
  Shield,
  Skull,
  Sparkles,
  Swords,
  Tent,
  User,
  UserCheck,
  UserMinus,
  UserPlus,
  Users,
  Wrench,
  X,
  Zap,
} from 'lucide-react';
import type {
  ActiveContract,
  FactionKey,
  InventoryItemId,
  LivingNpcContact,
  MapLocation,
  MazgalCell,
  NpcMemoryMoment,
  ProtagonistActionType,
  ProtagonistState,
} from '../types/map';
import { formatGameDateTime } from '../utils/gameTime';
import {
  type NpcInteractionType,
  computeNpcMood,
  getMoralityProfile,
  getNpcMorality,
  getNpcMoodTone,
  getPartyBonusSummary,
  getTrustScaleProfile,
} from '../utils/partyAndRelationsEngine';
import {
  ACTION_HOURS,
  FACTION_LABELS,
  getProtagonistModifiers,
  getReputationLabel,
} from '../utils/protagonistEngine';
import {
  type ShadowActionType,
  getAvailableContractsAtLocation,
  getEquipmentBonuses,
  getMarketListingsForLocation,
  getNpcGrudgeTag,
  getPlayerMoralityProfile,
  getSlaveMarketForLocation,
} from '../utils/worldSystemsEngine';

interface ProtagonistDrawerProps {
  protagonist: ProtagonistState;
  currentLocation: MapLocation | undefined;
  currentMazgal: MazgalCell;
  allLocations: MapLocation[];
  gameTimeMs: number;
  initialTab?: 'status' | 'bag' | 'party' | 'relations' | 'moments';
  onRenameProtagonist: (name: string, title: string) => void;
  onPerformAction: (action: ProtagonistActionType) => void;
  onShadowAction?: (action: ShadowActionType) => string | void;
  onUseItem?: (itemId: InventoryItemId) => string | void;
  onBuyItem?: (itemId: 'rations' | InventoryItemId) => string | void;
  onSellItem?: (itemId: 'rations' | InventoryItemId) => string | void;
  onBuySlave?: (listingId: string, mode: 'bond_retainer' | 'manumit') => string | void;
  onSellCaptive?: () => string | void;
  onSellBondedNpc?: (contactId: string) => string | void;
  onFreeBondedNpc?: (contactId: string) => string | void;
  onAcceptContract?: (contract: ActiveContract) => string | void;
  onCompleteContract?: (contractId: string) => string | void;
  onPayBounty?: () => string | void;
  onEatRation: () => void;
  onMoveToLocation: (locationId: string) => void;
  onNpcInteraction?: (contactId: string, action: NpcInteractionType) => string | void;
  onInspectCurrentLocation: () => void;
  onInspectCurrentMazgal: () => void;
  onClose: () => void;
}

type DrawerTab = 'status' | 'bag' | 'party' | 'relations' | 'moments';

export const ProtagonistDrawer: React.FC<ProtagonistDrawerProps> = ({
  protagonist,
  currentLocation,
  currentMazgal,
  allLocations,
  gameTimeMs,
  initialTab = 'status',
  onRenameProtagonist,
  onPerformAction,
  onShadowAction,
  onUseItem,
  onBuyItem,
  onSellItem,
  onBuySlave,
  onSellCaptive,
  onSellBondedNpc,
  onFreeBondedNpc,
  onAcceptContract,
  onCompleteContract,
  onPayBounty,
  onEatRation,
  onMoveToLocation,
  onNpcInteraction,
  onInspectCurrentLocation,
  onInspectCurrentMazgal,
  onClose,
}) => {
  const [drawerTab, setDrawerTab] = useState<DrawerTab>(initialTab);
  const [editingIdentity, setEditingIdentity] = useState(false);
  const [draftName, setDraftName] = useState(protagonist.name);
  const [draftTitle, setDraftTitle] = useState(protagonist.title);
  const [interactionFeedback, setInteractionFeedback] = useState<string | null>(null);
  const [relationsFilter, setRelationsFilter] = useState<'all' | 'near' | 'trusted' | 'wary'>('all');
  const [momentsNpcFilter, setMomentsNpcFilter] = useState<string>('all');
  const [momentsCatFilter, setMomentsCatFilter] = useState<
    'all' | 'milestones' | 'critical' | 'romance' | 'trade' | 'conflict' | 'party'
  >('all');
  const [quickDestId, setQuickDestId] = useState(
    allLocations.find((l) => l.id !== protagonist.locationId)?.id ?? allLocations[0]?.id ?? ''
  );

  const mods = getProtagonistModifiers(protagonist, currentLocation, currentMazgal);
  const contacts = protagonist.contacts ?? [];
  const npcMoments: NpcMemoryMoment[] = protagonist.npcMoments ?? [];
  const partyBonus = getPartyBonusSummary(contacts);
  const eqBonuses = getEquipmentBonuses(protagonist.inventory ?? []);
  const playerMoralVal = protagonist.playerMorality ?? 10;
  const playerMoralInfo = getPlayerMoralityProfile(playerMoralVal);
  const marketInfo = getMarketListingsForLocation(currentLocation, protagonist);
  const slaveMarketInfo = getSlaveMarketForLocation(currentLocation, protagonist);
  const locationContracts = getAvailableContractsAtLocation(
    currentLocation,
    allLocations,
    gameTimeMs
  );
  const activeContracts = (protagonist.contracts ?? []).filter((c) => c.status === 'active');

  const runFeedback = (fn: (() => string | void) | undefined) => {
    if (!fn) return;
    const msg = fn();
    if (typeof msg === 'string' && msg) {
      setInteractionFeedback(msg);
    }
  };

  const moodColor =
    protagonist.mood === 'Dinç'
      ? 'text-[#67C7C0]'
      : protagonist.mood === 'Temkinli'
      ? 'text-[#D4A853]'
      : 'text-[#E89898]';

  const handleSaveIdentity = (e: React.FormEvent) => {
    e.preventDefault();
    onRenameProtagonist(
      draftName.trim() || 'Gezgin İzci',
      draftTitle.trim() || 'Doğu Sınırı Yolcusu'
    );
    setEditingIdentity(false);
  };

  const isNpcNearby = (c: LivingNpcContact) => {
    if (c.partyRelation !== 'independent') return true;
    if (protagonist.locationId && c.currentLocationId) {
      return c.currentLocationId === protagonist.locationId;
    }
    return c.currentMazgalId === protagonist.mazgalId;
  };

  const sortedContacts = [...contacts].sort((a, b) => {
    const aActive = a.partyRelation !== 'independent' ? 1 : 0;
    const bActive = b.partyRelation !== 'independent' ? 1 : 0;
    if (aActive !== bActive) return bActive - aActive;
    const aNear = isNpcNearby(a) ? 1 : 0;
    const bNear = isNpcNearby(b) ? 1 : 0;
    if (aNear !== bNear) return bNear - aNear;
    return b.affection + b.trust - (a.affection + a.trust);
  });

  const nearbyIndependent = sortedContacts.filter(
    (c) => c.partyRelation === 'independent' && isNpcNearby(c)
  );

  const triggerNpcAction = (contactId: string, action: NpcInteractionType) => {
    if (!onNpcInteraction) return;
    const msg = onNpcInteraction(contactId, action);
    if (typeof msg === 'string' && msg) {
      setInteractionFeedback(msg);
    }
  };

  const getLocName = (locId: string | null, mazgalId: string) => {
    if (!locId) return `Mazgal ${mazgalId}`;
    return allLocations.find((l) => l.id === locId)?.name ?? `Mazgal ${mazgalId}`;
  };

  const relationLabel = (rel: LivingNpcContact['partyRelation'], isBonded?: boolean) => {
    if (isBonded) return 'Bağlı Köle (0g/gün)';
    switch (rel) {
      case 'companion':
        return 'Yoldaş (Partinde)';
      case 'hired_by_player':
        return 'Kiralık (Ücret Ödüyorsun)';
      case 'hired_player':
        return 'İşveren (Seni Kiraladı)';
      case 'party_leader':
        return 'Parti Liderin';
      default:
        return 'Bağımsız';
    }
  };

  const moralityToneColor = (tone: ReturnType<typeof getMoralityProfile>['tone']) => {
    switch (tone) {
      case 'depraved':
      case 'corrupt':
        return 'text-[#E89898]';
      case 'selfish':
      case 'pragmatic':
        return 'text-[#D4A853]';
      default:
        return 'text-[#67C7C0]';
    }
  };

  return (
    <aside
      aria-label="Karakterim, Parti ve İlişkiler Paneli"
      className="flex flex-col gap-4 rounded-lg border border-[#67C7C0]/25 bg-[#141F1B] p-5"
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3 border-b border-[#D4A853]/15 pb-3.5">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-[#67C7C0]/40 bg-[#10201C] text-[#67C7C0]">
            <User className="h-5 w-5" />
          </div>
          <div>
            {!editingIdentity ? (
              <>
                <div className="flex items-center gap-2">
                  <h2 className="font-display text-lg font-semibold text-[#F8F3E6]">
                    {protagonist.name}
                  </h2>
                  <button
                    type="button"
                    onClick={() => {
                      setDraftName(protagonist.name);
                      setDraftTitle(protagonist.title);
                      setEditingIdentity(true);
                    }}
                    aria-label="İsim ve unvanı düzenle"
                    className="text-[#8E9C95] hover:text-[#D4A853] cursor-pointer"
                  >
                    <Edit3 className="h-3.5 w-3.5" />
                  </button>
                </div>
                <p className="text-xs text-[#D4A853]">
                  {protagonist.title} · <span className={moodColor}>{protagonist.mood}</span> ·{' '}
                  <span className="text-[#67C7C0]">{partyBonus.modeLabel}</span>
                </p>
                {protagonist.appearanceNote && (
                  <p className="mt-1 text-[11px] leading-relaxed text-[#A3B1AA]">
                    {protagonist.appearanceNote}
                  </p>
                )}
              </>
            ) : (
              <form onSubmit={handleSaveIdentity} className="space-y-1.5">
                <input
                  type="text"
                  value={draftName}
                  onChange={(e) => setDraftName(e.target.value)}
                  placeholder="Adınız"
                  className="w-full rounded border border-[#D4A853]/35 bg-[#0D1512] px-2 py-1 text-xs text-[#F8F3E6] focus:outline-none"
                />
                <input
                  type="text"
                  value={draftTitle}
                  onChange={(e) => setDraftTitle(e.target.value)}
                  placeholder="Unvan / Rol"
                  className="w-full rounded border border-[#D4A853]/35 bg-[#0D1512] px-2 py-1 text-xs text-[#D9D3C4] focus:outline-none"
                />
                <div className="flex gap-1.5">
                  <button
                    type="submit"
                    className="rounded bg-[#D4A853] px-2.5 py-1 text-[11px] font-semibold text-[#111916] cursor-pointer"
                  >
                    Kaydet
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingIdentity(false)}
                    className="rounded px-2 py-1 text-[11px] text-[#9AA8A1] cursor-pointer"
                  >
                    İptal
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>

        <button
          type="button"
          onClick={onClose}
          aria-label="Karakter panelini kapat"
          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[#D4A853]/25 bg-[#101A16] text-[#F3EBD8] hover:bg-[#192621] cursor-pointer"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Sub-navigation Tabs */}
      <div className="flex flex-wrap gap-1 rounded-md bg-[#0E1613] p-1 text-[11px]">
        <button
          type="button"
          onClick={() => setDrawerTab('status')}
          className={`flex-1 min-w-fit rounded px-2 py-1.5 font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
            drawerTab === 'status'
              ? 'bg-[#1D2D27] text-[#F8F3E6]'
              : 'text-[#9AA8A1] hover:text-[#EDE6D6]'
          }`}
        >
          Durum
        </button>
        <button
          type="button"
          onClick={() => setDrawerTab('bag')}
          className={`flex-1 min-w-fit rounded px-2 py-1.5 font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
            drawerTab === 'bag'
              ? 'bg-[#1D2D27] text-[#F8F3E6]'
              : 'text-[#9AA8A1] hover:text-[#EDE6D6]'
          }`}
        >
          Çanta & İş
        </button>
        <button
          type="button"
          onClick={() => setDrawerTab('party')}
          className={`flex-1 min-w-fit rounded px-2 py-1.5 font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
            drawerTab === 'party'
              ? 'bg-[#1D2D27] text-[#F8F3E6]'
              : 'text-[#9AA8A1] hover:text-[#EDE6D6]'
          }`}
        >
          Parti ({partyBonus.companions.length + (partyBonus.leaderOrEmployer ? 1 : 0)})
        </button>
        <button
          type="button"
          onClick={() => setDrawerTab('relations')}
          className={`flex-1 min-w-fit rounded px-2 py-1.5 font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
            drawerTab === 'relations'
              ? 'bg-[#1D2D27] text-[#F8F3E6]'
              : 'text-[#9AA8A1] hover:text-[#EDE6D6]'
          }`}
        >
          İlişkiler ({contacts.length})
        </button>
        <button
          type="button"
          onClick={() => setDrawerTab('moments')}
          className={`flex-1 min-w-fit rounded px-2 py-1.5 font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
            drawerTab === 'moments'
              ? 'bg-[#1D2D27] text-[#F8F3E6]'
              : 'text-[#9AA8A1] hover:text-[#EDE6D6]'
          }`}
        >
          Önemli Anlar ({npcMoments.length})
        </button>
      </div>

      {interactionFeedback && (
        <div className="rounded-md border border-[#67C7C0]/35 bg-[#101E1A] px-3 py-2 text-xs text-[#9CE3DD]">
          {interactionFeedback}
        </div>
      )}

      {/* TAB 1: STATUS */}
      {drawerTab === 'status' && (
        <>
          {/* Current Position */}
          <div className="rounded-md border border-[#D4A853]/18 bg-[#101A16] p-3 text-xs space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[#9AA8A1]">Bulunduğun Konum</span>
              <span className="font-mono text-[#D4A853] tabular-nums">
                Mazgal {protagonist.mazgalId}
              </span>
            </div>
            <p className="font-display text-sm font-semibold text-[#F8F3E6]">
              {currentLocation
                ? currentLocation.name
                : `${currentMazgal.terrainLabel} (Açık Arazi)`}
            </p>
            <div className="flex flex-wrap gap-2 pt-1">
              {currentLocation && (
                <button
                  type="button"
                  onClick={onInspectCurrentLocation}
                  className="rounded border border-[#D4A853]/25 bg-[#182520] px-2.5 py-1 text-[11px] font-medium text-[#E8C472] hover:border-[#D4A853]/60 cursor-pointer"
                >
                  Mekan Detayını Aç
                </button>
              )}
              <button
                type="button"
                onClick={onInspectCurrentMazgal}
                className="rounded border border-[#67C7C0]/25 bg-[#13241F] px-2.5 py-1 text-[11px] font-medium text-[#9CE3DD] hover:border-[#67C7C0]/60 cursor-pointer"
              >
                Mazgalı İncele ({protagonist.mazgalId})
              </button>
            </div>
          </div>

          {/* Vital Meters & Supplies */}
          <div className="space-y-3 border-t border-[#D4A853]/15 pt-4 text-xs">
            <div className="grid grid-cols-3 gap-2 tabular-nums">
              <div className="rounded bg-[#101A16] p-2.5 border border-[#D4A853]/12">
                <span className="inline-flex items-center gap-1 text-[10px] text-[#9AA8A1]">
                  <Heart className="h-3 w-3 text-[#E89898]" />
                  Can
                </span>
                <p className="mt-1 font-mono text-sm font-semibold text-[#F8F3E6]">
                  {protagonist.health}/100
                </p>
              </div>
              <div className="rounded bg-[#101A16] p-2.5 border border-[#D4A853]/12">
                <span className="inline-flex items-center gap-1 text-[10px] text-[#9AA8A1]">
                  <Zap className="h-3 w-3 text-[#67C7C0]" />
                  Zindelik
                </span>
                <p className="mt-1 font-mono text-sm font-semibold text-[#F8F3E6]">
                  {protagonist.stamina}/100
                </p>
              </div>
              <div className="rounded bg-[#101A16] p-2.5 border border-[#D4A853]/12">
                <span className="inline-flex items-center gap-1 text-[10px] text-[#9AA8A1]">
                  <Sparkles className="h-3 w-3 text-[#D4A853]" />
                  Açlık
                </span>
                <p className="mt-1 font-mono text-sm font-semibold text-[#F8F3E6]">
                  {protagonist.hunger}/100
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 rounded bg-[#101A16] px-3 py-2 border border-[#D4A853]/12 tabular-nums">
              <div className="flex flex-wrap items-center gap-3">
                <span className="inline-flex items-center gap-1.5 text-[#EDE6D6]">
                  <Package className="h-3.5 w-3.5 text-[#67C7C0]" />
                  Erzak: <strong className="font-mono">{protagonist.rations}</strong> Porsiyon
                </span>
                <span className="inline-flex items-center gap-1.5 text-[#EDE6D6]">
                  <Coins className="h-3.5 w-3.5 text-[#D4A853]" />
                  <strong className="font-mono">{protagonist.silver}</strong> Gümüş
                </span>
                {(protagonist.capturedCaptives ?? 0) > 0 && (
                  <span className="inline-flex items-center gap-1 text-[#E29D72]">
                    Tutsak: <strong className="font-mono">{protagonist.capturedCaptives}</strong>
                  </span>
                )}
              </div>
              <button
                type="button"
                disabled={protagonist.rations <= 0 || protagonist.hunger <= 5}
                onClick={onEatRation}
                className="rounded border border-[#67C7C0]/35 bg-[#132520] px-2 py-1 text-[11px] font-medium text-[#9CE3DD] hover:bg-[#19322B] disabled:opacity-40 cursor-pointer disabled:cursor-default"
              >
                1 Erzak Ye
              </button>
            </div>

            {protagonist.activeConditions.length > 0 && (
              <p className="text-[11px] text-[#B7C4BE]">
                <strong className="text-[#D4A853]">Aktif Durum:</strong>{' '}
                {protagonist.activeConditions.join(' · ')}
              </p>
            )}

            <div className="rounded bg-[#101A16] px-3 py-2 border border-[#D4A853]/12 space-y-1 text-[11px] tabular-nums">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[#9AA8A1]">Kişisel Ahlak & Nam</span>
                <span
                  className={
                    playerMoralInfo.tone === 'dark' || playerMoralInfo.tone === 'wicked'
                      ? 'font-semibold text-[#E89898]'
                      : playerMoralInfo.tone === 'hero' || playerMoralInfo.tone === 'good'
                      ? 'font-semibold text-[#67C7C0]'
                      : 'font-semibold text-[#D4A853]'
                  }
                >
                  {playerMoralInfo.label} ({playerMoralVal > 0 ? `+${playerMoralVal}` : playerMoralVal})
                </span>
              </div>

              {(protagonist.bountySilver ?? 0) > 0 && (
                <div className="flex items-center justify-between gap-2 pt-1 border-t border-[#D4A853]/10">
                  <span className="text-[#E89898]">
                    Aranma Ödülü: <strong className="font-mono">{protagonist.bountySilver}g</strong>
                  </span>
                  {onPayBounty && currentLocation && (
                    <button
                      type="button"
                      onClick={() => runFeedback(() => onPayBounty())}
                      className="rounded border border-[#E89898]/40 bg-[#251718] px-2 py-0.5 text-[10px] font-medium text-[#F2B8B8] hover:bg-[#311F20] cursor-pointer"
                    >
                      Kefaret Öde ({protagonist.bountySilver}g)
                    </button>
                  )}
                </div>
              )}

              {(protagonist.injuries ?? []).length > 0 && (
                <p className="text-[#E89898] pt-1 border-t border-[#D4A853]/10">
                  <strong>Kalıcı Yara / Hastalık:</strong> {(protagonist.injuries ?? []).join(' · ')}
                </p>
              )}

              {protagonist.activeWorldWave && (
                <div className="pt-1 border-t border-[#D4A853]/10">
                  <p className="font-semibold text-[#E29D72]">
                    Aktif Dalga: {protagonist.activeWorldWave.title}
                  </p>
                  <p className="text-[#B7C4BE]">{protagonist.activeWorldWave.description}</p>
                </div>
              )}
            </div>
          </div>

          {/* Protagonist Actions */}
          <div className="space-y-2 border-t border-[#D4A853]/15 pt-4">
            <h3 className="text-xs font-semibold tracking-wide text-[#D4A853]">
              Bireysel Eylemler (Zamanı İlerletir)
            </h3>
            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => onPerformAction('observe')}
                className="inline-flex items-center justify-between rounded bg-[#192621] px-3 py-2 text-xs text-[#EDE6D6] hover:bg-[#22332C] cursor-pointer"
              >
                <span className="inline-flex items-center gap-1.5">
                  <Eye className="h-3.5 w-3.5 text-[#D4A853]" />
                  Gözlem Yap
                </span>
                <span className="font-mono text-[10px] text-[#9AA8A1]">+{ACTION_HOURS.observe}s</span>
              </button>

              <button
                type="button"
                onClick={() => onPerformAction('converse')}
                className="inline-flex items-center justify-between rounded bg-[#192621] px-3 py-2 text-xs text-[#EDE6D6] hover:bg-[#22332C] cursor-pointer"
              >
                <span className="inline-flex items-center gap-1.5">
                  <MessageSquare className="h-3.5 w-3.5 text-[#67C7C0]" />
                  Yerlilerle Konuş
                </span>
                <span className="font-mono text-[10px] text-[#9AA8A1]">+{ACTION_HOURS.converse}s</span>
              </button>

              <button
                type="button"
                onClick={() => onPerformAction('forage_or_work')}
                className="inline-flex items-center justify-between rounded bg-[#192621] px-3 py-2 text-xs text-[#EDE6D6] hover:bg-[#22332C] cursor-pointer"
              >
                <span className="inline-flex items-center gap-1.5">
                  <Wrench className="h-3.5 w-3.5 text-[#D4A853]" />
                  {currentLocation?.category === 'village' ? 'İş Yap / Kazan' : 'Avlan / Topla'}
                </span>
                <span className="font-mono text-[10px] text-[#9AA8A1]">+{ACTION_HOURS.forage_or_work}s</span>
              </button>

              <button
                type="button"
                onClick={() => onPerformAction('help_settlement')}
                className="inline-flex items-center justify-between rounded bg-[#192621] px-3 py-2 text-xs text-[#EDE6D6] hover:bg-[#22332C] cursor-pointer"
              >
                <span className="inline-flex items-center gap-1.5">
                  <Shield className="h-3.5 w-3.5 text-[#67C7C0]" />
                  {currentLocation ? 'Bölgeye Destek Ol' : 'Araziyi İşaretle'}
                </span>
                <span className="font-mono text-[10px] text-[#9AA8A1]">+{ACTION_HOURS.help_settlement}s</span>
              </button>

              <button
                type="button"
                onClick={() => onPerformAction('rest_camp')}
                className="sm:col-span-2 inline-flex items-center justify-between rounded border border-[#67C7C0]/30 bg-[#13241F] px-3 py-2 text-xs font-medium text-[#9CE3DD] hover:bg-[#19302A] cursor-pointer"
              >
                <span className="inline-flex items-center gap-1.5">
                  <Tent className="h-3.5 w-3.5" />
                  Dinlen / Kamp Kur (Can & Zindelik Topla)
                </span>
                <span className="font-mono text-[10px]">+{ACTION_HOURS.rest_camp} Saat</span>
              </button>
            </div>

            {onShadowAction && (
              <div className="pt-2 border-t border-[#DC6B6B]/15 space-y-1.5">
                <p className="text-[11px] font-semibold text-[#E89898]">
                  Karanlık / Yasa Dışı Eylemler (Nam & Ödül Riski)
                </p>
                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => runFeedback(() => onShadowAction('extort_locals'))}
                    className="rounded border border-[#DC6B6B]/30 bg-[#231718] px-2 py-1.5 text-[11px] text-[#F2B8B8] hover:bg-[#2F1E20] cursor-pointer"
                  >
                    Haraç Kes (+2s)
                  </button>
                  <button
                    type="button"
                    onClick={() => runFeedback(() => onShadowAction('raid_supply'))}
                    className="rounded border border-[#DC6B6B]/30 bg-[#231718] px-2 py-1.5 text-[11px] text-[#F2B8B8] hover:bg-[#2F1E20] cursor-pointer"
                  >
                    Ambar Yağmala (+2s)
                  </button>
                  <button
                    type="button"
                    onClick={() => runFeedback(() => onShadowAction('blackmail_or_trade'))}
                    className="rounded border border-[#DC6B6B]/30 bg-[#231718] px-2 py-1.5 text-[11px] text-[#F2B8B8] hover:bg-[#2F1E20] cursor-pointer"
                  >
                    Şantaj & Yeraltı İşi (+2s)
                  </button>
                  <button
                    type="button"
                    onClick={() => runFeedback(() => onShadowAction('spread_discord'))}
                    className="rounded border border-[#DC6B6B]/30 bg-[#231718] px-2 py-1.5 text-[11px] text-[#F2B8B8] hover:bg-[#2F1E20] cursor-pointer"
                  >
                    Fitne Yay (+1s)
                  </button>
                  <button
                    type="button"
                    onClick={() => runFeedback(() => onShadowAction('capture_captive'))}
                    className="sm:col-span-2 rounded border border-[#D4A853]/35 bg-[#201A14] px-2 py-1.5 text-[11px] text-[#E8C472] hover:bg-[#2A221A] cursor-pointer"
                  >
                    Haydut / Tutsak Yakala (Pazarlık İçin +2s)
                  </button>
                </div>
              </div>
            )}
          </div>

          {activeContracts.length > 0 && (
            <div className="space-y-2 border-t border-[#D4A853]/15 pt-4 text-xs">
              <h3 className="text-xs font-semibold tracking-wide text-[#D4A853]">
                Aktif Süreli Kontratlar ({activeContracts.length})
              </h3>
              <div className="space-y-2">
                {activeContracts.map((cnt) => {
                  const atTarget = currentLocation?.id === cnt.targetLocationId;
                  return (
                    <div
                      key={cnt.id}
                      className="rounded border border-[#D4A853]/20 bg-[#101A16] p-2.5 space-y-1"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-[#F8F3E6]">{cnt.title}</span>
                        <span className="font-mono text-[10px] text-[#D4A853] tabular-nums">
                          +{cnt.rewardSilver}g
                        </span>
                      </div>
                      <p className="text-[11px] text-[#B7C4BE]">{cnt.description}</p>
                      <div className="flex items-center justify-between gap-2 pt-1 text-[10px] text-[#9AA8A1] tabular-nums">
                        <span>Son Teslim: {formatGameDateTime(cnt.deadlineMs)}</span>
                        {onCompleteContract && atTarget && (
                          <button
                            type="button"
                            onClick={() => runFeedback(() => onCompleteContract(cnt.id))}
                            className="rounded border border-[#67C7C0]/45 bg-[#132520] px-2 py-0.5 text-[11px] font-medium text-[#9CE3DD] hover:bg-[#1A332C] cursor-pointer"
                          >
                            Kontratı Teslim Et
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Quick Move */}
          <div className="space-y-2 border-t border-[#D4A853]/15 pt-4 text-xs">
            <h3 className="text-xs font-semibold tracking-wide text-[#A3B1AA]">
              Başka Konuma Hareket Et
            </h3>
            <div className="flex gap-2">
              <select
                value={quickDestId}
                onChange={(e) => setQuickDestId(e.target.value)}
                className="flex-1 rounded-md border border-[#D4A853]/25 bg-[#0F1815] px-2.5 py-2 text-xs text-[#EDE6D6] focus:border-[#D4A853] focus:outline-none"
              >
                {allLocations.map((loc) => (
                  <option key={loc.id} value={loc.id}>
                    {loc.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={!quickDestId || quickDestId === protagonist.locationId}
                onClick={() => onMoveToLocation(quickDestId)}
                className="inline-flex items-center gap-1.5 rounded-md bg-[#D4A853] px-3 py-2 text-xs font-semibold text-[#111916] hover:bg-[#E0B96B] disabled:opacity-45 cursor-pointer"
              >
                <Compass className="h-3.5 w-3.5" />
                Yürü
              </button>
            </div>
          </div>

          {/* Last Observation & Dialogue */}
          <div className="space-y-2.5 border-t border-[#D4A853]/15 pt-4 text-xs">
            <div className="rounded-md border border-[#D4A853]/15 bg-[#101A16] p-3">
              <p className="font-semibold text-[#D4A853]">Son Gözlemin</p>
              <p className="mt-1 leading-relaxed text-[#D9D3C4]">{protagonist.lastObservation}</p>
            </div>
            <div className="rounded-md border border-[#67C7C0]/20 bg-[#101A16] p-3">
              <p className="font-semibold text-[#67C7C0]">Son Konuşma / Karşılama</p>
              <p className="mt-1 leading-relaxed text-[#D9D3C4]">{protagonist.lastDialogue}</p>
            </div>
          </div>

          {/* Bidirectional Modifiers */}
          <div className="space-y-2 border-t border-[#D4A853]/15 pt-4 text-xs">
            <h3 className="text-xs font-semibold tracking-wide text-[#67C7C0]">
              Çevren ve Partinle Toplam Etki
            </h3>
            <p className="font-mono text-[11px] text-[#EDE6D6] tabular-nums">
              Fiziksel {mods.physicalMod >= 0 ? `+${mods.physicalMod}` : mods.physicalMod} · Sosyal{' '}
              {mods.socialMod >= 0 ? `+${mods.socialMod}` : mods.socialMod} · Algı{' '}
              {mods.perceptionMod >= 0 ? `+${mods.perceptionMod}` : mods.perceptionMod}
            </p>
            <ul className="space-y-1 text-[11px] text-[#CFC8B9]">
              {mods.notes.map((n, i) => (
                <li key={i}>• {n}</li>
              ))}
            </ul>
          </div>

          {/* Faction Reputations */}
          <div className="space-y-2 border-t border-[#D4A853]/15 pt-4 text-xs">
            <h3 className="text-xs font-semibold tracking-wide text-[#A3B1AA]">
              Bölgesel İtibarın
            </h3>
            <div className="space-y-1.5">
              {(Object.keys(FACTION_LABELS) as FactionKey[]).map((key) => {
                const val = protagonist.reputation[key] ?? 0;
                const info = getReputationLabel(val);
                const valColor =
                  info.tone === 'ally' || info.tone === 'warm'
                    ? 'text-[#67C7C0]'
                    : info.tone === 'cold' || info.tone === 'hostile'
                    ? 'text-[#E89898]'
                    : 'text-[#D4A853]';
                return (
                  <div
                    key={key}
                    className="flex items-center justify-between gap-2 border-b border-[#D4A853]/10 pb-1 last:border-b-0 text-[11px]"
                  >
                    <span className="text-[#D9D3C4]">{FACTION_LABELS[key]}</span>
                    <span className={`font-mono tabular-nums ${valColor}`}>
                      {val > 0 ? `+${val}` : val} ({info.label})
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Journal */}
          <div className="space-y-2 border-t border-[#D4A853]/15 pt-4">
            <h3 className="text-xs font-semibold tracking-wide text-[#A3B1AA]">
              Kişisel Günlüğün (Son {protagonist.journal.length})
            </h3>
            <ol className="max-h-56 space-y-2 overflow-y-auto pr-1 text-xs">
              {protagonist.journal.map((entry) => (
                <li
                  key={entry.id}
                  className="border-b border-[#D4A853]/10 pb-2 last:border-b-0 last:pb-0"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-[#F3EBD8]">
                      <span className="text-[#67C7C0]">{entry.kind}</span> · {entry.title}
                    </span>
                    <span className="shrink-0 font-mono text-[10px] text-[#8E9C95] tabular-nums">
                      {entry.timestamp}
                    </span>
                  </div>
                  <p className="mt-0.5 leading-relaxed text-[#A3B1AA]">{entry.detail}</p>
                </li>
              ))}
            </ol>
          </div>
        </>
      )}

      {/* TAB 2: BAG, EQUIPMENT, TRADE & CONTRACTS */}
      {drawerTab === 'bag' && (
        <div className="space-y-4 text-xs">
          {/* Inventory & Equipment */}
          <div className="space-y-2 rounded-md border border-[#D4A853]/18 bg-[#101A16] p-3.5">
            <div className="flex items-center justify-between gap-2">
              <h3 className="font-semibold text-[#D4A853]">Taşıdığın Çanta & Donanım</h3>
              <span className="font-mono text-[11px] text-[#EDE6D6] tabular-nums">
                {protagonist.silver} Gümüş · {protagonist.rations} Erzak
              </span>
            </div>
            {eqBonuses.notes.length > 0 && (
              <p className="text-[11px] text-[#67C7C0]">
                Etkin Donanım Katkısı: {eqBonuses.notes.join(' · ')}
              </p>
            )}
            <div className="space-y-1.5 pt-1">
              {(protagonist.inventory ?? []).length === 0 ? (
                <p className="text-[11px] text-[#8E9C95]">Çantanda hiç eşya yok.</p>
              ) : (
                (protagonist.inventory ?? []).map((item) => (
                  <div
                    key={item.id}
                    className="flex items-start justify-between gap-2 border-t border-[#D4A853]/10 pt-2 first:border-t-0 first:pt-0"
                  >
                    <div>
                      <p className="font-medium text-[#F8F3E6] tabular-nums">
                        {item.name} <span className="font-mono text-[#D4A853]">×{item.qty}</span>
                      </p>
                      <p className="text-[11px] text-[#9AA8A1]">
                        {item.category} · {item.description}
                      </p>
                    </div>
                    {item.category === 'Tüketim' && onUseItem && (
                      <button
                        type="button"
                        onClick={() => runFeedback(() => onUseItem(item.id))}
                        className="shrink-0 rounded border border-[#67C7C0]/35 bg-[#132520] px-2.5 py-1 text-[11px] font-medium text-[#9CE3DD] hover:bg-[#19322B] cursor-pointer"
                      >
                        Kullan
                      </button>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Regional Supply-Demand Market */}
          <div className="space-y-2 rounded-md border border-[#67C7C0]/20 bg-[#101A16] p-3.5">
            <div className="flex items-center justify-between gap-2">
              <h3 className="font-semibold text-[#67C7C0]">
                Bölge Pazarı {currentLocation ? `(${currentLocation.name})` : ''}
              </h3>
              {protagonist.activeWorldWave && (
                <span className="font-mono text-[10px] text-[#E29D72]">
                  Dalga Çarpanı ×{protagonist.activeWorldWave.priceMultiplier}
                </span>
              )}
            </div>

            {!marketInfo.marketOpen ? (
              <p className="text-[11px] text-[#9AA8A1]">{marketInfo.refusalReason}</p>
            ) : (
              <div className="space-y-2 pt-1">
                {marketInfo.listings.map((item) => {
                  const ownedQty =
                    item.id === 'rations'
                      ? protagonist.rations
                      : (protagonist.inventory ?? []).find((i) => i.id === item.id)?.qty ?? 0;
                  return (
                    <div
                      key={item.id}
                      className="flex items-center justify-between gap-2 border-t border-[#67C7C0]/12 pt-2 first:border-t-0 first:pt-0"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-medium text-[#F3EBD8]">{item.name}</p>
                        <p className="text-[10px] text-[#9AA8A1] tabular-nums">
                          {item.stockNote} · Elinde: {ownedQty}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5 tabular-nums">
                        {item.canBuy && onBuyItem && (
                          <button
                            type="button"
                            disabled={protagonist.silver < item.buyPrice}
                            onClick={() => runFeedback(() => onBuyItem(item.id))}
                            className="rounded border border-[#D4A853]/35 bg-[#1B251E] px-2 py-1 text-[11px] font-medium text-[#E8C472] hover:border-[#D4A853] disabled:opacity-40 cursor-pointer disabled:cursor-default"
                          >
                            Al {item.buyPrice}g
                          </button>
                        )}
                        {ownedQty > 0 && onSellItem && (
                          <button
                            type="button"
                            onClick={() => runFeedback(() => onSellItem(item.id))}
                            className="rounded border border-[#67C7C0]/35 bg-[#13241F] px-2 py-1 text-[11px] font-medium text-[#9CE3DD] hover:border-[#67C7C0] cursor-pointer"
                          >
                            Sat +{item.sellPrice}g
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Frontier Slave & Debtor Market */}
          <div className="space-y-2 rounded-md border border-[#D4A853]/25 bg-[#101A16] p-3.5">
            <div className="flex items-center justify-between gap-2">
              <h3 className="font-semibold text-[#E8C472]">{slaveMarketInfo.marketTitle}</h3>
              {(protagonist.capturedCaptives ?? 0) > 0 && (
                <span className="font-mono text-[10px] text-[#E29D72] tabular-nums">
                  Elindeki Tutsak: {protagonist.capturedCaptives}
                </span>
              )}
            </div>

            {!slaveMarketInfo.marketOpen ? (
              <p className="text-[11px] text-[#9AA8A1]">{slaveMarketInfo.closedReason}</p>
            ) : (
              <div className="space-y-2.5 pt-1">
                <p className="text-[11px] leading-relaxed text-[#B7C4BE]">
                  {slaveMarketInfo.isLegalHumanMarket
                    ? 'İnsan sınır yasaları uyarınca borçlu sözleşmeleri, savaş tutsakları ve yakalanan haydutlar burada yasal olarak alınıp satılır. Köle yoldaşlar günlük gümüş ücreti istemez.'
                    : 'Kaçakçı ve haydut ağları aracılığıyla tutsak alınıp satılır.'}
                </p>

                {(protagonist.capturedCaptives ?? 0) > 0 && onSellCaptive && (
                  <div className="flex items-center justify-between gap-2 rounded border border-[#D4A853]/25 bg-[#17221B] px-2.5 py-2">
                    <span className="text-[11px] text-[#EDE6D6]">
                      Yakalanan tutsağı esir mübaşirine teslim et
                    </span>
                    <button
                      type="button"
                      onClick={() => runFeedback(() => onSellCaptive())}
                      className="shrink-0 rounded border border-[#D4A853]/45 bg-[#242919] px-2.5 py-1 text-[11px] font-medium text-[#E8C472] hover:border-[#D4A853] cursor-pointer tabular-nums"
                    >
                      Tutsağı Sat (+{slaveMarketInfo.captiveSellPrice}g)
                    </button>
                  </div>
                )}

                {slaveMarketInfo.listings.length === 0 ? (
                  <p className="text-[11px] text-[#8E9C95]">
                    Bu tezgâhtaki tüm kayıtlı tutsak ve borçlular zaten seninle tanışıyor veya partinde.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {slaveMarketInfo.listings.map((s) => (
                      <div
                        key={s.id}
                        className="border-t border-[#D4A853]/12 pt-2 first:border-t-0 first:pt-0 space-y-1.5"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold text-[#F8F3E6]">{s.name}</span>
                          <span className="font-mono text-[10px] text-[#D4A853] tabular-nums">
                            {s.priceSilver} Gümüş
                          </span>
                        </div>
                        <p className="text-[10px] text-[#9AA8A1] tabular-nums">
                          {s.originLabel} · {s.role} · Savaş +{s.combatBonus} / Algı +{s.scoutBonus} / Sosyal +{s.socialBonus}
                        </p>
                        <p className="text-[11px] text-[#B7C4BE]">{s.trait}</p>
                        {onBuySlave && (
                          <div className="flex flex-wrap gap-1.5 pt-0.5 tabular-nums">
                            <button
                              type="button"
                              disabled={protagonist.silver < s.priceSilver}
                              onClick={() => runFeedback(() => onBuySlave(s.id, 'bond_retainer'))}
                              className="rounded border border-[#D4A853]/35 bg-[#1F2417] px-2.5 py-1 text-[11px] font-medium text-[#E8C472] hover:border-[#D4A853] disabled:opacity-40 cursor-pointer disabled:cursor-default"
                            >
                              Satın Al ({s.priceSilver}g · 0g/gün)
                            </button>
                            <button
                              type="button"
                              disabled={protagonist.silver < s.priceSilver}
                              onClick={() => runFeedback(() => onBuySlave(s.id, 'manumit'))}
                              className="rounded border border-[#67C7C0]/35 bg-[#132520] px-2.5 py-1 text-[11px] font-medium text-[#9CE3DD] hover:border-[#67C7C0] disabled:opacity-40 cursor-pointer disabled:cursor-default"
                            >
                              Satın Al &amp; Azat Et ({s.priceSilver}g)
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Location Contract Board */}
          <div className="space-y-2 rounded-md border border-[#D4A853]/18 bg-[#101A16] p-3.5">
            <h3 className="font-semibold text-[#D4A853]">
              Süreli Kontrat İlanları {currentLocation ? `(${currentLocation.name})` : ''}
            </h3>
            {locationContracts.length === 0 ? (
              <p className="text-[11px] text-[#8E9C95]">
                Bu noktada açık iş veya kervan kontratı yok. Yerleşim ve kalelerde yeni kontratlar bulabilirsin.
              </p>
            ) : (
              <div className="space-y-2 pt-1">
                {locationContracts.map((cnt) => {
                  const alreadyActive = activeContracts.some((a) => a.id === cnt.id);
                  return (
                    <div
                      key={cnt.id}
                      className="border-t border-[#D4A853]/10 pt-2 first:border-t-0 first:pt-0 space-y-1"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-[#F8F3E6]">{cnt.title}</span>
                        <span className="font-mono text-[10px] text-[#D4A853] tabular-nums">
                          +{cnt.rewardSilver}g · +{cnt.repReward} İtibar
                        </span>
                      </div>
                      <p className="text-[11px] text-[#B7C4BE]">{cnt.description}</p>
                      <div className="flex items-center justify-between gap-2 pt-1">
                        <span className="font-mono text-[10px] text-[#8E9C95] tabular-nums">
                          Hedef: {cnt.targetLocationName}
                        </span>
                        {onAcceptContract && (
                          <button
                            type="button"
                            disabled={alreadyActive}
                            onClick={() => runFeedback(() => onAcceptContract(cnt))}
                            className="rounded border border-[#D4A853]/40 bg-[#1D281E] px-2.5 py-1 text-[11px] font-medium text-[#E8C472] disabled:opacity-45 cursor-pointer disabled:cursor-default"
                          >
                            {alreadyActive ? 'Aktif Kontrat' : 'Kontratı Al'}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 3: PARTY MODE */}
      {drawerTab === 'party' && (
        <div className="space-y-4 text-xs">
          <div className="rounded-md border border-[#D4A853]/22 bg-[#101A16] p-3.5 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 font-semibold text-[#D4A853]">
                <Users className="h-3.5 w-3.5" />
                Mevcut Parti Modu
              </span>
              <span className="font-mono text-[#67C7C0]">{partyBonus.modeLabel}</span>
            </div>
            <p className="font-mono text-[11px] text-[#EDE6D6] tabular-nums">
              Katkı: Fiziksel +{partyBonus.combatBonus} · Algı +{partyBonus.scoutBonus} · Sosyal +
              {partyBonus.socialBonus}
            </p>
            {(partyBonus.dailyExpenseSilver > 0 || partyBonus.dailyIncomeSilver > 0) && (
              <p className="font-mono text-[11px] text-[#D4A853] tabular-nums">
                {partyBonus.dailyExpenseSilver > 0
                  ? `Günlük Gider: -${partyBonus.dailyExpenseSilver} Gümüş`
                  : ''}
                {partyBonus.dailyIncomeSilver > 0
                  ? `Günlük Kazancın: +${partyBonus.dailyIncomeSilver} Gümüş`
                  : ''}
              </p>
            )}
            <ul className="space-y-1 text-[11px] text-[#B7C4BE]">
              {partyBonus.summaryNotes.map((n, i) => (
                <li key={i}>• {n}</li>
              ))}
            </ul>
          </div>

          {/* Leader / Employer if player joined someone or was hired */}
          {partyBonus.leaderOrEmployer && (
            <div className="space-y-2">
              <h3 className="font-semibold text-[#67C7C0]">
                {partyBonus.leaderOrEmployer.partyRelation === 'hired_player'
                  ? 'Seni Kiralayan İşveren'
                  : 'Partisine Katıldığın Lider'}
              </h3>
              <div className="rounded-md border border-[#67C7C0]/30 bg-[#101D19] p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-[#F8F3E6]">
                    {partyBonus.leaderOrEmployer.name}
                  </span>
                  <span className="text-[11px] text-[#D4A853]">
                    {partyBonus.leaderOrEmployer.role}
                  </span>
                </div>
                <p className="text-[11px] text-[#CFC8B9]">
                  {partyBonus.leaderOrEmployer.lastReaction}
                </p>
                <div className="flex flex-wrap gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => triggerNpcAction(partyBonus.leaderOrEmployer!.id, 'talk')}
                    className="rounded border border-[#D4A853]/30 bg-[#182520] px-2.5 py-1 text-[11px] text-[#E8C472] cursor-pointer"
                  >
                    Konuş (+1s)
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      triggerNpcAction(partyBonus.leaderOrEmployer!.id, 'confront_or_test')
                    }
                    className="rounded border border-[#E29D72]/35 bg-[#221C18] px-2.5 py-1 text-[11px] text-[#E29D72] cursor-pointer"
                  >
                    Yüzleş / Sına (+1s)
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      triggerNpcAction(partyBonus.leaderOrEmployer!.id, 'leave_or_dismiss')
                    }
                    className="inline-flex items-center gap-1 rounded border border-[#DC6B6B]/35 bg-[#241819] px-2.5 py-1 text-[11px] text-[#E89898] cursor-pointer"
                  >
                    <UserMinus className="h-3 w-3" />
                    Bağımsızlığa Dön
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Active Companions in Player's Party */}
          {partyBonus.companions.length > 0 && (
            <div className="space-y-2">
              <h3 className="font-semibold text-[#D4A853]">
                Partindeki Yoldaş ve Kiralıklar ({partyBonus.companions.length})
              </h3>
              <div className="space-y-2">
                {partyBonus.companions.map((c) => (
                  <div
                    key={c.id}
                    className="rounded-md border border-[#D4A853]/20 bg-[#101A16] p-3 space-y-2"
                  >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-[#F8F3E6]">{c.name}</span>
                        <span className="font-mono text-[10px] text-[#67C7C0]">
                          {relationLabel(c.partyRelation, c.isBonded)}
                        </span>
                      </div>
                      <p className="text-[11px] text-[#A3B1AA] tabular-nums">
                        {c.role} · Güven {Math.max(0, Math.min(100, Math.round(c.trust)))}/100 · Ruh Hali:{' '}
                        <span className="text-[#EDE6D6]">
                          {c.mood ?? computeNpcMood(c, { locationMood: currentLocation?.livingState?.mood })}
                        </span>
                        {c.romanceStatus !== 'Yok' ? ` · ${c.romanceStatus}` : ''}
                      </p>
                      <p className="text-[11px] text-[#CFC8B9]">{c.lastReaction}</p>
                      <div className="flex flex-wrap gap-1.5">
                        <button
                          type="button"
                          onClick={() => triggerNpcAction(c.id, 'talk')}
                          className="rounded border border-[#D4A853]/25 bg-[#182520] px-2 py-1 text-[11px] text-[#EDE6D6] cursor-pointer"
                        >
                          Konuş (+1s)
                        </button>
                        <button
                          type="button"
                          onClick={() => triggerNpcAction(c.id, 'confront_or_test')}
                          className="rounded border border-[#E29D72]/30 bg-[#221C18] px-2 py-1 text-[11px] text-[#E29D72] cursor-pointer"
                        >
                          Yüzleş / Sına (+1s)
                        </button>
                        {c.openToRomance && (
                          <button
                            type="button"
                            onClick={() => triggerNpcAction(c.id, 'flirt_or_romance')}
                            className="rounded border border-[#E89898]/30 bg-[#22181B] px-2 py-1 text-[11px] text-[#F2B8B8] cursor-pointer"
                          >
                            Yakınlaş (+1s)
                          </button>
                        )}
                        {c.isBonded ? (
                          <>
                            {onFreeBondedNpc && (
                              <button
                                type="button"
                                onClick={() => runFeedback(() => onFreeBondedNpc(c.id))}
                                className="rounded border border-[#67C7C0]/35 bg-[#132520] px-2 py-1 text-[11px] text-[#9CE3DD] cursor-pointer"
                              >
                                Azat Et (Özgür Bırak)
                              </button>
                            )}
                            {onSellBondedNpc && slaveMarketInfo.marketOpen && (
                              <button
                                type="button"
                                onClick={() => runFeedback(() => onSellBondedNpc(c.id))}
                                className="rounded border border-[#D4A853]/35 bg-[#221F16] px-2 py-1 text-[11px] text-[#E8C472] cursor-pointer"
                              >
                                Pazara Sat
                              </button>
                            )}
                          </>
                        ) : (
                          <button
                            type="button"
                            onClick={() => triggerNpcAction(c.id, 'leave_or_dismiss')}
                            className="rounded border border-[#DC6B6B]/30 bg-[#241819] px-2 py-1 text-[11px] text-[#E89898] cursor-pointer"
                          >
                            Yolu Ayır
                          </button>
                        )}
                      </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Nearby Candidates on Map to Recruit / Hire / Be Hired / Join */}
          <div className="space-y-2 border-t border-[#D4A853]/15 pt-3">
            <h3 className="font-semibold text-[#A3B1AA]">
              Bulunduğun Bölgedeki Olası Parti ve İş Bağlantıları ({nearbyIndependent.length})
            </h3>
            {nearbyIndependent.length === 0 ? (
              <p className="text-[11px] text-[#8E9C95]">
                Bu noktada henüz partine alabileceğin veya katılabileceğin bağımsız bir tanıdık yok. Konumları gezerek yeni kişilerle tanışabilirsin.
              </p>
            ) : (
              <div className="space-y-2">
                {nearbyIndependent.map((c) => (
                  <div
                    key={c.id}
                    className="rounded-md border border-[#D4A853]/18 bg-[#101A16] p-3 space-y-2"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-[#F3EBD8]">{c.name}</span>
                      <span className="font-mono text-[10px] text-[#D4A853]">
                        Ücret: {c.dailyWageSilver} Gümüş/gün
                      </span>
                    </div>
                    <p className="text-[11px] text-[#9AA8A1] tabular-nums">
                      {c.role} · Güven {Math.max(0, Math.min(100, Math.round(c.trust)))}/100 · Savaş +{c.combatBonus} / Algı +{c.scoutBonus} / Sosyal +{c.socialBonus}
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      <button
                        type="button"
                        onClick={() => triggerNpcAction(c.id, 'invite_companion')}
                        className="inline-flex items-center gap-1 rounded border border-[#67C7C0]/35 bg-[#132520] px-2 py-1 text-[11px] text-[#9CE3DD] cursor-pointer"
                      >
                        <UserPlus className="h-3 w-3" />
                        Partiye Davet Et
                      </button>
                      <button
                        type="button"
                        onClick={() => triggerNpcAction(c.id, 'hire_npc')}
                        className="inline-flex items-center gap-1 rounded border border-[#D4A853]/35 bg-[#1F2417] px-2 py-1 text-[11px] text-[#E8C472] cursor-pointer"
                      >
                        <Coins className="h-3 w-3" />
                        Kirala ({c.dailyWageSilver}g)
                      </button>
                      <button
                        type="button"
                        onClick={() => triggerNpcAction(c.id, 'take_hire_offer')}
                        className="inline-flex items-center gap-1 rounded border border-[#D4A853]/25 bg-[#182520] px-2 py-1 text-[11px] text-[#D9D3C4] cursor-pointer"
                      >
                        <Briefcase className="h-3 w-3" />
                        Beni Kirala (+{c.dailyWageSilver}g/gün)
                      </button>
                      <button
                        type="button"
                        onClick={() => triggerNpcAction(c.id, 'join_npc_party')}
                        className="inline-flex items-center gap-1 rounded border border-[#67C7C0]/25 bg-[#111E1B] px-2 py-1 text-[11px] text-[#B7D8D4] cursor-pointer"
                      >
                        <UserCheck className="h-3 w-3" />
                        Partisine Katıl
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 3: LIVING RELATIONSHIPS (INDEPENDENT OF PARTY!) */}
      {drawerTab === 'relations' && (() => {
        const nearCount = sortedContacts.filter((c) => isNpcNearby(c)).length;
        const trustedCount = sortedContacts.filter((c) => c.trust >= 60).length;
        const waryCount = sortedContacts.filter((c) => c.trust < 40).length;
        const filteredContacts = sortedContacts.filter((c) => {
          if (relationsFilter === 'near') return isNpcNearby(c);
          if (relationsFilter === 'trusted') return c.trust >= 60;
          if (relationsFilter === 'wary') return c.trust < 40;
          return true;
        });

        return (
        <div className="space-y-3 text-xs">
          <p className="text-[11px] leading-relaxed text-[#9AA8A1]">
            Haritada tanıştığın kişiler kendi hayatlarını sürdürür. Her etkileşim ve kararın NPC’lerin seninle ilişkisine göre <strong className="text-[#EDE6D6]">Ruh Hali</strong> ve <strong className="text-[#EDE6D6]">Güven Skalası (0–100)</strong> değerlerini dinamik olarak değiştirir.
          </p>

          {/* Relationship Summary & Filter Strip */}
          <div className="rounded-md border border-[#D4A853]/18 bg-[#101A16] p-2.5 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-[#B7C4BE] tabular-nums">
              <span>Yakınında: <strong className="font-mono text-[#F8F3E6]">{nearCount}</strong></span>
              <span aria-hidden="true" className="text-[#56665F]">·</span>
              <span>Güvenilir (60+): <strong className="font-mono text-[#67C7C0]">{trustedCount}</strong></span>
              <span aria-hidden="true" className="text-[#56665F]">·</span>
              <span>Kuşkulu (&lt;40): <strong className="font-mono text-[#E89898]">{waryCount}</strong></span>
            </div>
            <div className="grid grid-cols-4 gap-1 text-[10px]">
              <button
                type="button"
                onClick={() => setRelationsFilter('all')}
                className={`rounded px-1.5 py-1 font-medium cursor-pointer whitespace-nowrap ${
                  relationsFilter === 'all'
                    ? 'bg-[#1D2D27] text-[#F8F3E6]'
                    : 'bg-[#0C1411] text-[#9AA8A1] hover:text-[#EDE6D6]'
                }`}
              >
                Tümü ({sortedContacts.length})
              </button>
              <button
                type="button"
                onClick={() => setRelationsFilter('near')}
                className={`rounded px-1.5 py-1 font-medium cursor-pointer whitespace-nowrap ${
                  relationsFilter === 'near'
                    ? 'bg-[#1D2D27] text-[#F8F3E6]'
                    : 'bg-[#0C1411] text-[#9AA8A1] hover:text-[#EDE6D6]'
                }`}
              >
                Yakında ({nearCount})
              </button>
              <button
                type="button"
                onClick={() => setRelationsFilter('trusted')}
                className={`rounded px-1.5 py-1 font-medium cursor-pointer whitespace-nowrap ${
                  relationsFilter === 'trusted'
                    ? 'bg-[#132924] text-[#67C7C0]'
                    : 'bg-[#0C1411] text-[#9AA8A1] hover:text-[#EDE6D6]'
                }`}
              >
                Güven 60+
              </button>
              <button
                type="button"
                onClick={() => setRelationsFilter('wary')}
                className={`rounded px-1.5 py-1 font-medium cursor-pointer whitespace-nowrap ${
                  relationsFilter === 'wary'
                    ? 'bg-[#291719] text-[#E89898]'
                    : 'bg-[#0C1411] text-[#9AA8A1] hover:text-[#EDE6D6]'
                }`}
              >
                Riskli &lt;40
              </button>
            </div>
          </div>

          <div className="space-y-3">
            {filteredContacts.length === 0 ? (
              <p className="rounded border border-[#D4A853]/12 bg-[#101A16] p-3 text-[11px] text-[#8E9C95]">
                Seçili filtreye uyan bir kişi bulunmuyor.
              </p>
            ) : (
            filteredContacts.map((c) => {
              const near = isNpcNearby(c);
              const locLabel = getLocName(c.currentLocationId, c.currentMazgalId);
              const moralVal = getNpcMorality(c);
              const moralInfo = getMoralityProfile(moralVal);
              const trustInfo = getTrustScaleProfile(c.trust);
              const locMood = c.currentLocationId
                ? allLocations.find((l) => l.id === c.currentLocationId)?.livingState?.mood
                : undefined;
              const npcMood = c.mood ?? computeNpcMood(c, { locationMood: locMood });
              const moodTone = getNpcMoodTone(npcMood);
              const romanceColor =
                c.romanceStatus === 'Sevgili / Bağlı'
                  ? 'text-[#F29BA8]'
                  : c.romanceStatus === 'Flört / Yakınlık'
                  ? 'text-[#E8B498]'
                  : 'text-[#8E9C95]';

              return (
                <div
                  key={c.id}
                  className="rounded-md border border-[#D4A853]/18 bg-[#101A16] p-3.5 space-y-2.5"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold text-[#F8F3E6]">{c.name}</p>
                      <p className="text-[11px] text-[#D4A853]">
                        {c.role} · {near ? 'Yakınında' : `Konumu: ${locLabel}`}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <span className="font-mono text-[10px] text-[#67C7C0]">
                        {relationLabel(c.partyRelation, c.isBonded)}
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          setMomentsNpcFilter(c.id);
                          setMomentsCatFilter('all');
                          setDrawerTab('moments');
                        }}
                        className="text-[10px] font-medium text-[#D4A853] underline-offset-2 hover:underline cursor-pointer whitespace-nowrap"
                      >
                        Anılar ({npcMoments.filter((m) => m.npcId === c.id).length})
                      </button>
                    </div>
                  </div>

                  {/* Dynamic Mood & 0-100 Trust Scale Gauge */}
                  <div className="rounded border border-[#D4A853]/14 bg-[#0B120F] p-2.5 space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-[10px] font-medium uppercase tracking-wider text-[#9AA8A1]">
                        Ruh Hali
                      </span>
                      <span
                        className={`rounded border px-2 py-0.5 text-[10px] font-semibold ${moodTone.boxClass} ${moodTone.textClass}`}
                      >
                        {npcMood}
                      </span>
                    </div>

                    <div className="space-y-1">
                      <div className="flex items-center justify-between gap-2 text-[11px] tabular-nums">
                        <span className="text-[#9AA8A1]">Güven Skalası</span>
                        <span className={`font-mono font-semibold ${trustInfo.textHex}`}>
                          {trustInfo.value}/100 · {trustInfo.label}
                        </span>
                      </div>
                      <svg
                        viewBox="0 0 100 6"
                        preserveAspectRatio="none"
                        role="img"
                        aria-label={`Güven Skalası ${trustInfo.value}/100`}
                        className="h-2 w-full rounded-sm border border-[#D4A853]/18 bg-[#070C0A]"
                      >
                        <rect x={0} y={0} width={trustInfo.value} height={6} fill={trustInfo.barHex} />
                        <line x1={25} y1={0} x2={25} y2={6} stroke="#141F1B" strokeWidth={0.8} />
                        <line x1={50} y1={0} x2={50} y2={6} stroke="#141F1B" strokeWidth={0.8} />
                        <line x1={75} y1={0} x2={75} y2={6} stroke="#141F1B" strokeWidth={0.8} />
                      </svg>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 font-mono text-[11px] text-[#CFC8B9] tabular-nums">
                    <span>Yakınlık {c.affection}</span>
                    <span aria-hidden="true">·</span>
                    <span className={romanceColor}>Aşk: {c.romanceStatus}</span>
                  </div>

                  <p className="text-[11px] text-[#A3B1AA] tabular-nums">
                    <span>Mizaç: {c.temperament}</span>
                    <span aria-hidden="true"> · </span>
                    <span className={moralityToneColor(moralInfo.tone)}>
                      {moralInfo.label} ({moralVal > 0 ? `+${moralVal}` : moralVal})
                    </span>
                  </p>

                  {getNpcGrudgeTag(c) && (
                    <p className="text-[11px] font-semibold text-[#E89898]">
                      Aranan Borçlu: {getNpcGrudgeTag(c)} · İzi: {locLabel}
                    </p>
                  )}

                  <p className="text-[11px] text-[#B7C4BE]">
                    <strong className="text-[#9AA8A1]">Niyet / Tavır:</strong>{' '}
                    <span className={c.intentSuspected ? 'text-[#E89898] font-medium' : 'text-[#D9D3C4]'}>
                      {c.intentSuspected
                        ? `${c.lastIntent} (Sezildi / Açığa Çıktı)`
                        : c.lastIntent}
                    </span>
                  </p>

                  <p className="leading-relaxed text-[11px] text-[#D9D3C4]">{c.lastReaction}</p>

                  {near ? (
                    <div className="flex flex-wrap gap-1.5 border-t border-[#D4A853]/10 pt-2">
                      <button
                        type="button"
                        onClick={() => triggerNpcAction(c.id, 'talk')}
                        className="rounded border border-[#D4A853]/25 bg-[#182520] px-2 py-1 text-[11px] text-[#EDE6D6] hover:border-[#D4A853]/60 cursor-pointer"
                      >
                        Konuş (+1s)
                      </button>
                      <button
                        type="button"
                        onClick={() => triggerNpcAction(c.id, 'confront_or_test')}
                        className="rounded border border-[#E29D72]/30 bg-[#221C18] px-2 py-1 text-[11px] text-[#E29D72] hover:border-[#E29D72]/60 cursor-pointer"
                      >
                        Yüzleş / Sına (+1s)
                      </button>
                      <button
                        type="button"
                        onClick={() => triggerNpcAction(c.id, 'flirt_or_romance')}
                        className="inline-flex items-center gap-1 rounded border border-[#E89898]/30 bg-[#22181B] px-2 py-1 text-[11px] text-[#F2B8B8] hover:border-[#E89898]/60 cursor-pointer"
                      >
                        <HeartHandshake className="h-3 w-3" />
                        Romantik Yakınlaş (+1s)
                      </button>
                      <button
                        type="button"
                        onClick={() => triggerNpcAction(c.id, 'seduce_or_charm')}
                        className="rounded border border-[#E89898]/35 bg-[#25181C] px-2 py-1 text-[11px] text-[#F2B8B8] hover:border-[#E89898]/70 cursor-pointer"
                      >
                        Baştan Çıkar / Cazibe (+1s)
                      </button>
                      <button
                        type="button"
                        onClick={() => triggerNpcAction(c.id, 'gift_silver')}
                        className="rounded border border-[#D4A853]/25 bg-[#192621] px-2 py-1 text-[11px] text-[#D4A853] cursor-pointer"
                      >
                        3 Gümüş Ver
                      </button>
                      <button
                        type="button"
                        onClick={() => triggerNpcAction(c.id, 'share_ration')}
                        className="rounded border border-[#67C7C0]/25 bg-[#13241F] px-2 py-1 text-[11px] text-[#9CE3DD] cursor-pointer"
                      >
                        1 Erzak Paylaş
                      </button>
                      <button
                        type="button"
                        onClick={() => triggerNpcAction(c.id, 'exploit_or_rob_npc')}
                        className="rounded border border-[#DC6B6B]/35 bg-[#241819] px-2 py-1 text-[11px] text-[#E89898] hover:border-[#DC6B6B]/70 cursor-pointer"
                      >
                        Gasp Et / Sömür (+1s)
                      </button>
                      {c.isBonded && onFreeBondedNpc && (
                        <button
                          type="button"
                          onClick={() => runFeedback(() => onFreeBondedNpc(c.id))}
                          className="rounded border border-[#67C7C0]/35 bg-[#132520] px-2 py-1 text-[11px] text-[#9CE3DD] cursor-pointer"
                        >
                          Azat Et (Özgür Bırak)
                        </button>
                      )}
                      {c.isBonded && onSellBondedNpc && slaveMarketInfo.marketOpen && (
                        <button
                          type="button"
                          onClick={() => runFeedback(() => onSellBondedNpc(c.id))}
                          className="rounded border border-[#D4A853]/35 bg-[#221F16] px-2 py-1 text-[11px] text-[#E8C472] cursor-pointer"
                        >
                          Pazara Sat
                        </button>
                      )}
                    </div>
                  ) : (
                    c.currentLocationId && (
                      <div className="flex items-center justify-between gap-2 border-t border-[#D4A853]/10 pt-2">
                        <span className="text-[10px] text-[#8E9C95]">
                          Yüz yüze konuşmak veya yakınlaşmak için yanına gitmelisin.
                        </span>
                        <button
                          type="button"
                          onClick={() => onMoveToLocation(c.currentLocationId!)}
                          className="rounded border border-[#D4A853]/30 bg-[#182520] px-2 py-1 text-[11px] font-medium text-[#E8C472] hover:border-[#D4A853]/65 cursor-pointer"
                        >
                          Yanına Yürü
                        </button>
                      </div>
                    )
                  )}
                </div>
              );
            })
            )}
          </div>
        </div>
        );
      })()}

      {/* TAB 5: IMPORTANT MOMENTS JOURNAL WITH NPCS */}
      {drawerTab === 'moments' && (() => {
        const sortedMoments = [...npcMoments].sort((a, b) => b.timestampMs - a.timestampMs);
        const criticalCount = sortedMoments.filter((m) => m.significance === 'kritik').length;

        const getMilestoneInfo = (
          m: NpcMemoryMoment
        ): { isMilestone: boolean; label?: string; tone: 'gold' | 'crimson' | 'teal' } => {
          if (m.category === 'İhanet / Gasp') {
            return {
              isMilestone: true,
              label: m.milestoneLabel ?? 'İhanet / Gasp Kırılması',
              tone: 'crimson',
            };
          }
          if (m.isMilestone) {
            const isBetrayalOrDrop =
              (m.milestoneLabel ?? '').includes('Çöküş') ||
              (m.milestoneLabel ?? '').includes('Devri');
            const isPositiveBond =
              (m.milestoneLabel ?? '').includes('Sadakat') ||
              (m.milestoneLabel ?? '').includes('Güven') ||
              (m.milestoneLabel ?? '').includes('Özgürlük') ||
              (m.milestoneLabel ?? '').includes('Fedakârlığı');
            return {
              isMilestone: true,
              label: m.milestoneLabel ?? 'Kritik İlişki Eşiği',
              tone: isBetrayalOrDrop ? 'crimson' : isPositiveBond ? 'teal' : 'gold',
            };
          }
          if (typeof m.trustAfter === 'number' && m.trustAfter > 80) {
            return {
              isMilestone: true,
              label: 'Sarsılmaz Sadakat (80+ Güven)',
              tone: 'teal',
            };
          }
          if (typeof m.trustAfter === 'number' && m.trustAfter < 20) {
            return {
              isMilestone: true,
              label: 'Güven Çöküşü (<20 Güven)',
              tone: 'crimson',
            };
          }
          if (m.significance === 'kritik') {
            return {
              isMilestone: true,
              label: m.category === 'Yakınlaşma / Aşk' ? 'Derin Bağ Eşiği' : 'Dönüm Noktası',
              tone: 'gold',
            };
          }
          return { isMilestone: false, tone: 'gold' };
        };

        const milestoneCount = sortedMoments.filter((m) => getMilestoneInfo(m).isMilestone).length;

        const npcOptionsMap = new Map<string, string>();
        for (const m of sortedMoments) {
          if (!npcOptionsMap.has(m.npcId)) npcOptionsMap.set(m.npcId, m.npcName);
        }
        for (const c of contacts) {
          if (!npcOptionsMap.has(c.id)) npcOptionsMap.set(c.id, c.name);
        }
        const npcOptions = Array.from(npcOptionsMap.entries()).sort((a, b) =>
          a[1].localeCompare(b[1], 'tr')
        );

        const isCommercialMoment = (m: NpcMemoryMoment) => {
          const text = `${m.title} ${m.summary}`.toLowerCase();
          return (
            m.category === 'Kölelik / Azat' ||
            (m.category === 'Parti / Sözleşme' &&
              (text.includes('kiral') || text.includes('ücret') || text.includes('gümüş'))) ||
            (m.category === 'Yardım / Fedakârlık' && text.includes('gümüş')) ||
            (m.category === 'Yakınlaşma / Aşk' && text.includes('çıkar'))
          );
        };

        const getMomentVisual = (m: NpcMemoryMoment) => {
          if (m.category === 'İhanet / Gasp') {
            return {
              Icon: Skull,
              typeLabel: 'Çatışma / İhanet',
              textClass: 'text-[#E89898]',
              frameClass: 'border-[#DC6B6B]/40 bg-[#261517] text-[#E89898]',
            };
          }
          if (m.category === 'Yüzleşme') {
            return {
              Icon: Swords,
              typeLabel: 'Çatışma / Yüzleşme',
              textClass: 'text-[#E29D72]',
              frameClass: 'border-[#E29D72]/35 bg-[#241A14] text-[#E29D72]',
            };
          }
          if (m.category === 'Yakınlaşma / Aşk') {
            return {
              Icon: Heart,
              typeLabel: isCommercialMoment(m) ? 'Romantik / Çıkar' : 'Romantik',
              textClass: 'text-[#F29BA8]',
              frameClass: 'border-[#E89898]/35 bg-[#24151A] text-[#F29BA8]',
            };
          }
          if (m.category === 'Kölelik / Azat') {
            const isFree = m.title.toLowerCase().includes('azat');
            return {
              Icon: isFree ? Shield : Coins,
              typeLabel: isFree ? 'Azat / Özgürlük' : 'Ticari / Pazar',
              textClass: isFree ? 'text-[#67C7C0]' : 'text-[#E8C472]',
              frameClass: isFree
                ? 'border-[#67C7C0]/35 bg-[#122420] text-[#67C7C0]'
                : 'border-[#D4A853]/35 bg-[#221D13] text-[#E8C472]',
            };
          }
          if (m.category === 'Parti / Sözleşme') {
            const commercial = isCommercialMoment(m);
            return {
              Icon: commercial ? Briefcase : Users,
              typeLabel: commercial ? 'Ticari / Sözleşme' : 'Parti',
              textClass: commercial ? 'text-[#E8C472]' : 'text-[#67C7C0]',
              frameClass: commercial
                ? 'border-[#D4A853]/35 bg-[#221D13] text-[#E8C472]'
                : 'border-[#67C7C0]/30 bg-[#11221E] text-[#67C7C0]',
            };
          }
          if (m.category === 'Yardım / Fedakârlık') {
            const commercial = isCommercialMoment(m);
            return {
              Icon: commercial ? Coins : HeartHandshake,
              typeLabel: commercial ? 'Ticari / Hediye' : 'Destek / Fedakârlık',
              textClass: commercial ? 'text-[#E8C472]' : 'text-[#67C7C0]',
              frameClass: commercial
                ? 'border-[#D4A853]/35 bg-[#221D13] text-[#E8C472]'
                : 'border-[#67C7C0]/35 bg-[#122420] text-[#67C7C0]',
            };
          }
          if (m.category === 'Tanışma') {
            return {
              Icon: UserPlus,
              typeLabel: 'Tanışma',
              textClass: 'text-[#9CE3DD]',
              frameClass: 'border-[#67C7C0]/25 bg-[#0F1E1A] text-[#9CE3DD]',
            };
          }
          return {
            Icon: MessageSquare,
            typeLabel: 'Sohbet',
            textClass: 'text-[#B7C4BE]',
            frameClass: 'border-[#D4A853]/22 bg-[#131E1A] text-[#B7C4BE]',
          };
        };

        const matchesCategory = (m: NpcMemoryMoment) => {
          if (momentsCatFilter === 'milestones') return getMilestoneInfo(m).isMilestone;
          if (momentsCatFilter === 'critical') return m.significance === 'kritik';
          if (momentsCatFilter === 'romance') return m.category === 'Yakınlaşma / Aşk';
          if (momentsCatFilter === 'trade') return isCommercialMoment(m);
          if (momentsCatFilter === 'conflict') {
            return m.category === 'Yüzleşme' || m.category === 'İhanet / Gasp';
          }
          if (momentsCatFilter === 'party') {
            return (
              m.category === 'Parti / Sözleşme' ||
              m.category === 'Yardım / Fedakârlık' ||
              m.category === 'Tanışma'
            );
          }
          return true;
        };

        const filteredMoments = sortedMoments.filter((m) => {
          if (momentsNpcFilter !== 'all' && m.npcId !== momentsNpcFilter) return false;
          return matchesCategory(m);
        });

        return (
          <div className="space-y-3 text-xs">
            <p className="text-[11px] leading-relaxed text-[#9AA8A1]">
              Tanıştığın kişilerle yaşadığın sohbetler, yakınlaşmalar, ticari anlaşmalar ve kritik ilişki eşikleri (80+ güven, derin bağ, yoldaşlık yemini veya ihanet) burada kronolojik olarak saklanır.
            </p>

            {/* Summary & Filter Controls */}
            <div className="space-y-2.5 rounded-md border border-[#D4A853]/18 bg-[#101A16] p-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-[#B7C4BE] tabular-nums">
                <span>
                  Anı: <strong className="font-mono text-[#F8F3E6]">{sortedMoments.length}</strong>
                </span>
                <span aria-hidden="true" className="text-[#56665F]">·</span>
                <span>
                  Kilometre Taşı:{' '}
                  <strong className="font-mono text-[#F2CB74]">{milestoneCount}</strong>
                </span>
                <span aria-hidden="true" className="text-[#56665F]">·</span>
                <span>
                  Kişi: <strong className="font-mono text-[#67C7C0]">{npcOptions.length}</strong>
                </span>
              </div>

              <div className="flex items-center gap-2">
                <label htmlFor="moments-npc-select" className="shrink-0 text-[10px] text-[#9AA8A1]">
                  Kişi:
                </label>
                <select
                  id="moments-npc-select"
                  value={momentsNpcFilter}
                  onChange={(e) => setMomentsNpcFilter(e.target.value)}
                  className="flex-1 rounded border border-[#D4A853]/25 bg-[#0C1411] px-2 py-1 text-[11px] text-[#EDE6D6] focus:border-[#D4A853] focus:outline-none"
                >
                  <option value="all">Tüm Kişiler ({sortedMoments.length})</option>
                  {npcOptions.map(([id, name]) => (
                    <option key={id} value={id}>
                      {name} ({sortedMoments.filter((m) => m.npcId === id).length})
                    </option>
                  ))}
                </select>
                {momentsNpcFilter !== 'all' && (
                  <button
                    type="button"
                    onClick={() => setMomentsNpcFilter('all')}
                    className="shrink-0 rounded px-2 py-1 text-[10px] text-[#D4A853] hover:bg-[#192621] cursor-pointer whitespace-nowrap"
                  >
                    Sıfırla
                  </button>
                )}
              </div>

              <div className="flex flex-wrap gap-1 text-[10px]">
                <button
                  type="button"
                  onClick={() => setMomentsCatFilter('all')}
                  className={`inline-flex items-center gap-1 rounded px-2 py-1 font-medium cursor-pointer whitespace-nowrap shrink-0 ${
                    momentsCatFilter === 'all'
                      ? 'bg-[#1D2D27] text-[#F8F3E6]'
                      : 'bg-[#0C1411] text-[#9AA8A1] hover:text-[#EDE6D6]'
                  }`}
                >
                  Tümü
                </button>
                <button
                  type="button"
                  onClick={() => setMomentsCatFilter('milestones')}
                  className={`inline-flex items-center gap-1 rounded border px-2 py-1 font-semibold cursor-pointer whitespace-nowrap shrink-0 ${
                    momentsCatFilter === 'milestones'
                      ? 'border-[#D4A853]/55 bg-[#2B2212] text-[#F2CB74]'
                      : 'border-[#D4A853]/22 bg-[#141A13] text-[#E8C472] hover:border-[#D4A853]/45'
                  }`}
                >
                  <Flag className="h-3 w-3" />
                  Kilometre Taşları ({milestoneCount})
                </button>
                <button
                  type="button"
                  onClick={() => setMomentsCatFilter('critical')}
                  className={`inline-flex items-center gap-1 rounded px-2 py-1 font-medium cursor-pointer whitespace-nowrap shrink-0 ${
                    momentsCatFilter === 'critical'
                      ? 'bg-[#262014] text-[#E8C472]'
                      : 'bg-[#0C1411] text-[#9AA8A1] hover:text-[#EDE6D6]'
                  }`}
                >
                  <Sparkles className="h-3 w-3" />
                  Kritik ({criticalCount})
                </button>
                <button
                  type="button"
                  onClick={() => setMomentsCatFilter('romance')}
                  className={`inline-flex items-center gap-1 rounded px-2 py-1 font-medium cursor-pointer whitespace-nowrap shrink-0 ${
                    momentsCatFilter === 'romance'
                      ? 'bg-[#28181D] text-[#F29BA8]'
                      : 'bg-[#0C1411] text-[#9AA8A1] hover:text-[#EDE6D6]'
                  }`}
                >
                  <Heart className="h-3 w-3" />
                  Romantik
                </button>
                <button
                  type="button"
                  onClick={() => setMomentsCatFilter('trade')}
                  className={`inline-flex items-center gap-1 rounded px-2 py-1 font-medium cursor-pointer whitespace-nowrap shrink-0 ${
                    momentsCatFilter === 'trade'
                      ? 'bg-[#241F13] text-[#E8C472]'
                      : 'bg-[#0C1411] text-[#9AA8A1] hover:text-[#EDE6D6]'
                  }`}
                >
                  <Coins className="h-3 w-3" />
                  Ticari
                </button>
                <button
                  type="button"
                  onClick={() => setMomentsCatFilter('conflict')}
                  className={`inline-flex items-center gap-1 rounded px-2 py-1 font-medium cursor-pointer whitespace-nowrap shrink-0 ${
                    momentsCatFilter === 'conflict'
                      ? 'bg-[#291719] text-[#E89898]'
                      : 'bg-[#0C1411] text-[#9AA8A1] hover:text-[#EDE6D6]'
                  }`}
                >
                  <Swords className="h-3 w-3" />
                  Çatışma
                </button>
                <button
                  type="button"
                  onClick={() => setMomentsCatFilter('party')}
                  className={`inline-flex items-center gap-1 rounded px-2 py-1 font-medium cursor-pointer whitespace-nowrap shrink-0 ${
                    momentsCatFilter === 'party'
                      ? 'bg-[#132924] text-[#67C7C0]'
                      : 'bg-[#0C1411] text-[#9AA8A1] hover:text-[#EDE6D6]'
                  }`}
                >
                  <Users className="h-3 w-3" />
                  Parti & Destek
                </button>
              </div>
            </div>

            {/* Chronological Moments List */}
            {filteredMoments.length === 0 ? (
              <p className="rounded-md border border-[#D4A853]/14 bg-[#101A16] p-3.5 text-[11px] text-[#8E9C95]">
                Seçili filtrelere uyan bir an kaydı henüz oluşmadı.
              </p>
            ) : (
              <ol className="space-y-2.5">
                {filteredMoments.map((m) => {
                  const hasContact = contacts.some((c) => c.id === m.npcId);
                  const visual = getMomentVisual(m);
                  const MomentIcon = visual.Icon;
                  const milestone = getMilestoneInfo(m);
                  const cardSurfaceClass = milestone.isMilestone
                    ? milestone.tone === 'crimson'
                      ? 'border-[#DC6B6B]/45 bg-[#1B1315]'
                      : milestone.tone === 'teal'
                      ? 'border-[#67C7C0]/45 bg-[#111E1A]'
                      : 'border-[#D4A853]/45 bg-[#171B13]'
                    : 'border-[#D4A853]/16 bg-[#101A16]';
                  const milestoneTextClass =
                    milestone.tone === 'crimson'
                      ? 'text-[#E89898]'
                      : milestone.tone === 'teal'
                      ? 'text-[#84E3DB]'
                      : 'text-[#F2CB74]';

                  return (
                    <li
                      key={m.id}
                      className={`rounded-md border p-3 space-y-2 ${cardSurfaceClass}`}
                    >
                      {milestone.isMilestone && (
                        <div className="flex items-center justify-between gap-2 border-b border-[#D4A853]/12 pb-1.5 text-[10px]">
                          <span className={`inline-flex items-center gap-1 font-semibold ${milestoneTextClass}`}>
                            <Flag className="h-3 w-3 shrink-0" aria-hidden="true" />
                            Kilometre Taşı · {milestone.label}
                          </span>
                          {typeof m.trustAfter === 'number' && (
                            <span className="font-mono text-[#CFC8B9] tabular-nums">
                              Güven {m.trustAfter}/100
                            </span>
                          )}
                        </div>
                      )}

                      <div className="flex items-start gap-2.5">
                        <div
                          title={visual.typeLabel}
                          className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md border ${visual.frameClass}`}
                        >
                          <MomentIcon className="h-4 w-4" aria-hidden="true" />
                        </div>

                        <div className="min-w-0 flex-1 space-y-0.5">
                          <div className="flex flex-wrap items-center justify-between gap-1.5 text-[10px]">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className={`font-semibold ${visual.textClass}`}>
                                {visual.typeLabel}
                              </span>
                              {!milestone.isMilestone && m.significance === 'kritik' && (
                                <>
                                  <span aria-hidden="true" className="text-[#56665F]">·</span>
                                  <span className="font-semibold text-[#E8C472]">Kritik İz</span>
                                </>
                              )}
                            </div>
                            <span className="font-mono text-[#8E9C95] tabular-nums">{m.timestamp}</span>
                          </div>

                          <p className="font-semibold leading-snug text-[#F8F3E6]">{m.title}</p>
                          <p className="text-[11px] text-[#D4A853]">
                            {m.npcName} ({m.npcRole}) · {m.locationLabel}
                          </p>
                        </div>
                      </div>

                      <p className="leading-relaxed text-[11px] text-[#CFC8B9]">{m.summary}</p>

                      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#D4A853]/10 pt-1.5 text-[10px]">
                        <div className="flex flex-wrap items-center gap-1.5 font-mono tabular-nums text-[#9AA8A1]">
                          {typeof m.trustDelta === 'number' && m.trustDelta !== 0 && (
                            <span className={m.trustDelta > 0 ? 'text-[#67C7C0]' : 'text-[#E89898]'}>
                              Güven {m.trustDelta > 0 ? `+${m.trustDelta}` : m.trustDelta}
                            </span>
                          )}
                          {typeof m.affectionDelta === 'number' && m.affectionDelta !== 0 && (
                            <>
                              {typeof m.trustDelta === 'number' && m.trustDelta !== 0 && (
                                <span aria-hidden="true" className="text-[#56665F]">·</span>
                              )}
                              <span className={m.affectionDelta > 0 ? 'text-[#F29BA8]' : 'text-[#E89898]'}>
                                Yakınlık {m.affectionDelta > 0 ? `+${m.affectionDelta}` : m.affectionDelta}
                              </span>
                            </>
                          )}
                          {m.moodAfter && (
                            <>
                              {((typeof m.trustDelta === 'number' && m.trustDelta !== 0) ||
                                (typeof m.affectionDelta === 'number' && m.affectionDelta !== 0)) && (
                                <span aria-hidden="true" className="text-[#56665F]">·</span>
                              )}
                              <span>Ruh Hali: {m.moodAfter}</span>
                            </>
                          )}
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          {momentsNpcFilter !== m.npcId && (
                            <button
                              type="button"
                              onClick={() => setMomentsNpcFilter(m.npcId)}
                              className="font-medium text-[#D4A853] hover:underline underline-offset-2 cursor-pointer whitespace-nowrap"
                            >
                              Kişiyi Filtrele
                            </button>
                          )}
                          {hasContact && (
                            <button
                              type="button"
                              onClick={() => {
                                setRelationsFilter('all');
                                setDrawerTab('relations');
                              }}
                              className="font-medium text-[#67C7C0] hover:underline underline-offset-2 cursor-pointer whitespace-nowrap"
                            >
                              İlişkilerde Gör
                            </button>
                          )}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </div>
        );
      })()}
    </aside>
  );
};
