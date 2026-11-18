import type {
  ActiveContract,
  FactionKey,
  ForestEncounter,
  InventoryItem,
  InventoryItemId,
  LivingNpcContact,
  MapLocation,
  MapRoute,
  MazgalCell,
  NpcTemperament,
  ProtagonistEventRecord,
  ProtagonistState,
  SettlementArchetype,
  WeatherConditionKey,
  WorldRoamingUnit,
  WorldWave,
  WorldWaveKind,
} from '../types/map';
import { rollDie } from './diceEngine';
import { INITIAL_GAME_TIME_MS, addGameHours, formatGameDateTime, getDayPhaseLabel } from './gameTime';
import { getCellForCoords } from './gridEngine';
import { recordRoamingArrivalOnLocation } from './livingWorldEngine';
import { appendNpcMoment, createNpcMomentRecord } from './partyAndRelationsEngine';
import type { ProceduralSceneCard } from './proceduralWorldDeck';
import {
  FACTION_LABELS,
  computeProtagonistMood,
  getFactionForLocation,
  getProtagonistModifiers,
} from './protagonistEngine';

const MAX_JOURNAL = 12;

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function pushJournal(
  journal: ProtagonistEventRecord[],
  entry: ProtagonistEventRecord
): ProtagonistEventRecord[] {
  return [entry, ...journal].slice(0, MAX_JOURNAL);
}

export const ITEM_CATALOG: Record<InventoryItemId, Omit<InventoryItem, 'qty'>> = {
  rust_sword: {
    id: 'rust_sword',
    name: 'Sınır Kısa Kılıcı',
    category: 'Silah/Zırh',
    basePrice: 10,
    physBonus: 1,
    description: 'Basit ama güvenilir çelik kısa kılıç (+1 Fiziksel).',
  },
  iron_blade: {
    id: 'iron_blade',
    name: 'Usta Çeliği Uzun Kılıç',
    category: 'Silah/Zırh',
    basePrice: 24,
    physBonus: 2,
    description: 'Külköy veya kaçakçı demirhanesinden çıkma dengeli kılıç (+2 Fiziksel).',
  },
  leather_armor: {
    id: 'leather_armor',
    name: 'Pekiştirilmiş Deri Zırh',
    category: 'Silah/Zırh',
    basePrice: 20,
    armorReduction: 4,
    description: 'Çatışma ve pusularda alınan fiziksel hasarı azaltır (-4 Hasar).',
  },
  elven_cloak: {
    id: 'elven_cloak',
    name: 'Yüksekçam Sis Pelerini',
    category: 'Teçhizat',
    basePrice: 24,
    percBonus: 1,
    socBonus: 1,
    description: 'Orman ve sis içinde iz gizlemeyi kolaylaştırır (+1 Algı, +1 Sosyal).',
  },
  trail_map: {
    id: 'trail_map',
    name: 'Ayrıntılı Mazgal Krokisi',
    category: 'Teçhizat',
    basePrice: 12,
    percBonus: 1,
    description: 'Gizli geçitleri ve pusu noktalarını gösterir (+1 Algı).',
  },
  healing_herb: {
    id: 'healing_herb',
    name: 'Şifalı Dağ Kekiği & Sargı',
    category: 'Tüketim',
    basePrice: 8,
    description: 'Kullanıldığında +22 Can iyileştirir ve Derin Kesik yarasını kapatır.',
  },
  antidote_vial: {
    id: 'antidote_vial',
    name: 'Panzehir & Arındırıcı İksir',
    category: 'Tüketim',
    basePrice: 10,
    description: 'Uyku otu, zehir veya Bataklık Sıtması etkisini temizler (+12 Can).',
  },
  torch_bundle: {
    id: 'torch_bundle',
    name: 'Reçineli Meşale Demeti',
    category: 'Tüketim',
    basePrice: 4,
    description: 'Karanlık ve sisli gecede moral ve +15 Zindelik sağlar.',
  },
  wool_bale: {
    id: 'wool_bale',
    name: 'Kulova Yün Balyası',
    category: 'Ticaret Malı',
    basePrice: 7,
    description: 'Kulova’da ucuz, Külköy ve kıyıda yüksek kârla satılan ticaret yükü.',
  },
  timber_crate: {
    id: 'timber_crate',
    name: 'Derebaşı İşlenmiş Kereste',
    category: 'Ticaret Malı',
    basePrice: 8,
    description: 'Kale ve sur tamiratında aranan ağır kereste sandığı.',
  },
  smuggler_salt: {
    id: 'smuggler_salt',
    name: 'Kıyı Tuz & Baharat Çuvalı',
    category: 'Ticaret Malı',
    basePrice: 9,
    description: 'Kaçakçı Koyu’nda bol, iç orman ve köylerde çok değerli ticaret malı.',
  },
};

export function createInitialInventory(): InventoryItem[] {
  return [
    { ...ITEM_CATALOG.rust_sword, qty: 1 },
    { ...ITEM_CATALOG.healing_herb, qty: 1 },
    { ...ITEM_CATALOG.torch_bundle, qty: 1 },
  ];
}

export function addInventoryItem(
  inventory: InventoryItem[] = [],
  itemId: InventoryItemId,
  delta: number
): InventoryItem[] {
  const existing = inventory.find((i) => i.id === itemId);
  if (existing) {
    const nextQty = existing.qty + delta;
    if (nextQty <= 0) {
      return inventory.filter((i) => i.id !== itemId);
    }
    return inventory.map((i) => (i.id === itemId ? { ...i, qty: nextQty } : i));
  }
  if (delta <= 0) return inventory;
  return [...inventory, { ...ITEM_CATALOG[itemId], qty: delta }];
}

export function getEquipmentBonuses(inventory: InventoryItem[] = []): {
  physBonus: number;
  percBonus: number;
  socBonus: number;
  armorReduction: number;
  notes: string[];
} {
  let bestWeaponPhys = 0;
  let percBonus = 0;
  let socBonus = 0;
  let armorReduction = 0;
  const notes: string[] = [];

  for (const item of inventory) {
    if (item.qty <= 0) continue;
    if ((item.physBonus ?? 0) > bestWeaponPhys) {
      bestWeaponPhys = item.physBonus ?? 0;
    }
    if (item.percBonus) percBonus += item.percBonus;
    if (item.socBonus) socBonus += item.socBonus;
    if ((item.armorReduction ?? 0) > armorReduction) {
      armorReduction = item.armorReduction ?? 0;
    }
  }

  percBonus = Math.min(2, percBonus);
  socBonus = Math.min(2, socBonus);

  if (bestWeaponPhys > 0) notes.push(`Silah (+${bestWeaponPhys} Fiziksel)`);
  if (armorReduction > 0) notes.push(`Zırh (-${armorReduction} Hasar)`);
  if (percBonus > 0) notes.push(`Teçhizat (+${percBonus} Algı)`);

  return { physBonus: bestWeaponPhys, percBonus, socBonus, armorReduction, notes };
}

export function getPlayerMoralityProfile(score: number): {
  label: string;
  tone: 'hero' | 'good' | 'grey' | 'dark' | 'wicked';
} {
  if (score >= 55) return { label: 'Yüce Gönüllü / Kahraman', tone: 'hero' };
  if (score >= 20) return { label: 'Dürüst / Onurlu Yolcu', tone: 'good' };
  if (score > -20) return { label: 'Ölçülü / Hayatta Kalmacı', tone: 'grey' };
  if (score > -55) return { label: 'Acımasız / Karanlık Namlı', tone: 'dark' };
  return { label: 'Yozlaşmış / Korkulan Haydut', tone: 'wicked' };
}

export function useInventoryItem(
  protagonist: ProtagonistState,
  itemId: InventoryItemId,
  gameTimeMs: number
): { nextProtagonist: ProtagonistState; message: string } {
  const inv = protagonist.inventory ?? [];
  const item = inv.find((i) => i.id === itemId);
  if (!item || item.qty <= 0) {
    return { nextProtagonist: protagonist, message: 'Bu eşyadan çantanda kalmadı.' };
  }

  let health = protagonist.health;
  let stamina = protagonist.stamina;
  let injuries = [...(protagonist.injuries ?? [])];
  let activeConditions = [...protagonist.activeConditions];
  let message = '';

  if (itemId === 'healing_herb') {
    health = Math.min(100, health + 22);
    injuries = injuries.filter((inj) => inj !== 'Derin Kesik' && inj !== 'Kırık Kaburga');
    activeConditions = activeConditions.filter(
      (c) => !c.includes('Yaralı') && !c.includes('Gasp')
    );
    message = 'Şifalı dağ kekiği ve sargı kullanıldı (+22 Can, derin kesikler kapandı).';
  } else if (itemId === 'antidote_vial') {
    health = Math.min(100, health + 12);
    injuries = injuries.filter((inj) => inj !== 'Bataklık Sıtması' && inj !== 'Zehir Kalıntısı');
    activeConditions = activeConditions.filter((c) => !c.includes('Uyku Otu') && !c.includes('Zehir'));
    message = 'Panzehir içildi; zehir/uyku otu ve sıtma belirtileri temizlendi (+12 Can).';
  } else if (itemId === 'torch_bundle') {
    stamina = Math.min(100, stamina + 15);
    if (!activeConditions.includes('Meşale Işığı')) {
      activeConditions = ['Meşale Işığı', ...activeConditions].slice(0, 4);
    }
    message = 'Reçineli meşale yakıldı; sis ve soğuk dağıldı (+15 Zindelik).';
  } else {
    return {
      nextProtagonist: protagonist,
      message: `${item.name} çantanda taşınan donanım/ticaret malıdır; kullanılmaz, bonus verir veya satılır.`,
    };
  }

  const nextInv = addInventoryItem(inv, itemId, -1);
  const ts = formatGameDateTime(gameTimeMs);

  return {
    nextProtagonist: {
      ...protagonist,
      health,
      stamina,
      injuries,
      activeConditions,
      inventory: nextInv,
      lastObservation: message,
      journal: pushJournal(protagonist.journal, {
        id: `pj-use-${Date.now()}`,
        timestamp: ts,
        kind: 'Eylem',
        locationLabel: `Mazgal ${protagonist.mazgalId}`,
        title: `${item.name} Kullanıldı`,
        detail: message,
      }),
    },
    message,
  };
}

// ==========================================
// 2. DYNAMIC REGIONAL SUPPLY-DEMAND TRADE
// ==========================================

export interface MarketListing {
  id: 'rations' | InventoryItemId;
  name: string;
  category: string;
  buyPrice: number;
  sellPrice: number;
  stockNote: string;
  canBuy: boolean;
}

const ARCHETYPE_STOCK: Record<SettlementArchetype, ('rations' | InventoryItemId)[]> = {
  border_fortress: ['rations', 'iron_blade', 'leather_armor', 'trail_map', 'healing_herb', 'torch_bundle'],
  shepherd_village: ['rations', 'wool_bale', 'healing_herb', 'torch_bundle'],
  lumber_village: ['rations', 'timber_crate', 'torch_bundle', 'rust_sword'],
  bandit_hamlet: ['rations', 'rust_sword', 'iron_blade', 'smuggler_salt', 'antidote_vial'],
  elf_canopy: ['rations', 'elven_cloak', 'healing_herb', 'antidote_vial', 'trail_map'],
  beastkin_clan: ['rations', 'leather_armor', 'healing_herb', 'torch_bundle'],
  goblin_burrow: ['rust_sword', 'smuggler_salt', 'torch_bundle'],
  river_crossing: ['rations', 'timber_crate', 'trail_map', 'torch_bundle'],
  mist_ruin: [],
  smuggler_cove: ['rations', 'smuggler_salt', 'iron_blade', 'antidote_vial', 'trail_map'],
  wild_nature: [],
};

export function getMarketListingsForLocation(
  location: MapLocation | undefined,
  protagonist: ProtagonistState
): {
  marketOpen: boolean;
  refusalReason?: string;
  listings: MarketListing[];
} {
  if (!location || !location.livingState) {
    return { marketOpen: false, refusalReason: 'Açık arazide pazar tezgâhı yok.', listings: [] };
  }

  const arch = location.livingState.archetype;
  if (arch === 'mist_ruin' || arch === 'wild_nature') {
    return {
      marketOpen: false,
      refusalReason: `${location.name} içinde düzenli ticaret veya pazar kurulmaz.`,
      listings: [],
    };
  }

  const faction = getFactionForLocation(location);
  const rep = protagonist.reputation[faction] ?? 0;
  const bounty = protagonist.bountySilver ?? 0;
  const huntedHere = (protagonist.bountyFactions ?? []).includes(faction);

  if (faction !== 'outlaws' && (rep <= -40 || (huntedHere && bounty >= 25))) {
    return {
      marketOpen: false,
      refusalReason: `${FACTION_LABELS[faction]} seni istenmeyen kişi/aranan suçlu ilan etti; tüccarlar tezgâhını kapattı.`,
      listings: [],
    };
  }

  const stockIds = ARCHETYPE_STOCK[arch] ?? ['rations', 'torch_bundle'];
  const mood = location.livingState.mood;
  const crisisFactor =
    mood === 'Korkulu'
      ? 1.32
      : mood === 'Endişeli'
      ? 1.18
      : mood === 'Mutlu'
      ? 0.9
      : 1.0;
  const waveFactor = protagonist.activeWorldWave?.priceMultiplier ?? 1.0;
  const repFactor = rep >= 25 ? 0.85 : rep <= -15 ? 1.25 : 1.0;

  // Include both local stock AND items currently held in player's inventory (so player can sell anywhere with a market!)
  const ownedIds = (protagonist.inventory ?? [])
    .filter((i) => i.qty > 0)
    .map((i) => i.id);
  const allIds = Array.from(new Set<('rations' | InventoryItemId)>([...stockIds, ...ownedIds]));

  const listings: MarketListing[] = allIds.map((id) => {
    const isLocallyProduced =
      (arch === 'shepherd_village' && id === 'wool_bale') ||
      (arch === 'lumber_village' && id === 'timber_crate') ||
      (arch === 'smuggler_cove' && id === 'smuggler_salt') ||
      (arch === 'elf_canopy' && (id === 'elven_cloak' || id === 'healing_herb')) ||
      (arch === 'border_fortress' && (id === 'iron_blade' || id === 'leather_armor'));

    const isHighLocalDemand =
      (arch === 'border_fortress' && (id === 'wool_bale' || id === 'timber_crate' || id === 'smuggler_salt')) ||
      (arch === 'shepherd_village' && (id === 'smuggler_salt' || id === 'iron_blade')) ||
      (arch === 'lumber_village' && (id === 'wool_bale' || id === 'rations')) ||
      (arch === 'elf_canopy' && id === 'smuggler_salt');

    const basePrice = id === 'rations' ? 3 : ITEM_CATALOG[id].basePrice;
    const supplyMod = isLocallyProduced ? 0.72 : isHighLocalDemand ? 1.38 : 1.0;
    const rawBuy = Math.round(basePrice * supplyMod * crisisFactor * waveFactor * repFactor);
    const buyPrice = Math.max(2, rawBuy);
    const sellPrice = Math.max(
      1,
      Math.round(basePrice * (isHighLocalDemand ? 1.35 : isLocallyProduced ? 0.52 : 0.72) * waveFactor)
    );

    const stockNote = isLocallyProduced
      ? 'Bölge Üretimi (Ucuz)'
      : isHighLocalDemand
      ? 'Yüksek Talep (Kârlı Satış)'
      : stockIds.includes(id)
      ? 'Mevcut Stok'
      : 'Yalnızca Satılabilir';

    return {
      id,
      name: id === 'rations' ? '1 Porsiyon Kuru Erzak' : ITEM_CATALOG[id].name,
      category: id === 'rations' ? 'Tüketim' : ITEM_CATALOG[id].category,
      buyPrice,
      sellPrice,
      stockNote,
      canBuy: stockIds.includes(id),
    };
  });

  return { marketOpen: true, listings };
}

export function buyMarketItem(
  protagonist: ProtagonistState,
  location: MapLocation | undefined,
  itemId: 'rations' | InventoryItemId,
  gameTimeMs: number
): { nextProtagonist: ProtagonistState; message: string } {
  const market = getMarketListingsForLocation(location, protagonist);
  if (!market.marketOpen) {
    return { nextProtagonist: protagonist, message: market.refusalReason ?? 'Pazar kapalı.' };
  }
  const listing = market.listings.find((l) => l.id === itemId && l.canBuy);
  if (!listing) {
    return { nextProtagonist: protagonist, message: 'Bu mal burada satılmıyor.' };
  }
  if (protagonist.silver < listing.buyPrice) {
    return {
      nextProtagonist: protagonist,
      message: `${listing.name} almak için ${listing.buyPrice} Gümüş gerekiyor.`,
    };
  }

  const silver = protagonist.silver - listing.buyPrice;
  let rations = protagonist.rations;
  let inventory = protagonist.inventory ?? createInitialInventory();
  if (itemId === 'rations') {
    rations += 1;
  } else {
    inventory = addInventoryItem(inventory, itemId, 1);
  }

  const msg = `${location?.name ?? 'Pazar'} tezgâhından ${listing.buyPrice} Gümüşe ${listing.name} aldın.`;
  return {
    nextProtagonist: {
      ...protagonist,
      silver,
      rations,
      inventory,
      lastObservation: msg,
      journal: pushJournal(protagonist.journal, {
        id: `pj-buy-${Date.now()}`,
        timestamp: formatGameDateTime(gameTimeMs),
        kind: 'Eylem',
        locationLabel: location?.name ?? `Mazgal ${protagonist.mazgalId}`,
        title: 'Ticaret Alımı',
        detail: msg,
      }),
    },
    message: msg,
  };
}

export function sellMarketItem(
  protagonist: ProtagonistState,
  location: MapLocation | undefined,
  itemId: 'rations' | InventoryItemId,
  gameTimeMs: number
): { nextProtagonist: ProtagonistState; message: string } {
  const market = getMarketListingsForLocation(location, protagonist);
  if (!market.marketOpen) {
    return { nextProtagonist: protagonist, message: market.refusalReason ?? 'Pazar kapalı.' };
  }
  const listing = market.listings.find((l) => l.id === itemId);
  if (!listing) return { nextProtagonist: protagonist, message: 'Alıcı bulunamadı.' };

  let rations = protagonist.rations;
  let inventory = protagonist.inventory ?? createInitialInventory();
  if (itemId === 'rations') {
    if (rations <= 0) return { nextProtagonist: protagonist, message: 'Satacak erzağın yok.' };
    rations -= 1;
  } else {
    const owned = inventory.find((i) => i.id === itemId);
    if (!owned || owned.qty <= 0) {
      return { nextProtagonist: protagonist, message: 'Çantanda bu eşyadan yok.' };
    }
    inventory = addInventoryItem(inventory, itemId, -1);
  }

  const silver = protagonist.silver + listing.sellPrice;
  const msg = `${location?.name ?? 'Pazar'} içinde ${listing.name} satarak +${listing.sellPrice} Gümüş kazandın.`;
  return {
    nextProtagonist: {
      ...protagonist,
      silver,
      rations,
      inventory,
      lastObservation: msg,
    },
    message: msg,
  };
}

// ==========================================
// 3. TWO-WAY FREEDOM: DARK / SHADOW ACTIONS
// ==========================================

export type ShadowActionType =
  | 'extort_locals'
  | 'raid_supply'
  | 'spread_discord'
  | 'blackmail_or_trade'
  | 'capture_captive';

export function performShadowAction(
  protagonist: ProtagonistState,
  action: ShadowActionType,
  location: MapLocation | undefined,
  cell: MazgalCell,
  nextTimeMs: number,
  playerMods: { physicalMod: number; socialMod: number; perceptionMod: number }
): {
  nextProtagonist: ProtagonistState;
  locationMoraleDelta: number;
  locationNoteTitle?: string;
  locationNoteDetail?: string;
  feedbackText: string;
} {
  const ts = formatGameDateTime(nextTimeMs);
  const faction = getFactionForLocation(location);
  const placeName = location ? location.name : `Mazgal ${cell.id}`;

  let health = protagonist.health;
  let stamina = Math.max(5, protagonist.stamina - 12);
  let rations = protagonist.rations;
  let silver = protagonist.silver;
  let inventory = protagonist.inventory ?? createInitialInventory();
  let playerMorality = protagonist.playerMorality ?? 10;
  let bountySilver = protagonist.bountySilver ?? 0;
  let bountyFactions = [...(protagonist.bountyFactions ?? [])];
  const reputation = { ...protagonist.reputation };
  let locationMoraleDelta = 0;
  let locationNoteTitle = '';
  let locationNoteDetail = '';
  let feedbackText = '';

  let capturedCaptives = protagonist.capturedCaptives ?? 0;

  const roll =
    rollDie(20) +
    (action === 'raid_supply' || action === 'capture_captive'
      ? playerMods.physicalMod
      : playerMods.socialMod);

  if (action === 'extort_locals') {
    const gain = 6 + rollDie(8);
    silver += gain;
    playerMorality = clamp(playerMorality - 12, -100, 100);
    if (faction !== 'outlaws') {
      reputation[faction] = clamp((reputation[faction] ?? 0) - 9, -100, 100);
      reputation.outlaws = clamp((reputation.outlaws ?? 0) + 4, -100, 100);
    }
    locationMoraleDelta = -5;
    if (roll < 13 && faction !== 'outlaws' && location) {
      const addedBounty = 10 + rollDie(6);
      bountySilver += addedBounty;
      if (!bountyFactions.includes(faction)) bountyFactions.push(faction);
      feedbackText = `${placeName} halkından zorla ${gain} Gümüş haraç kestin; nöbetçilere şikayet edildin (+${addedBounty}g Ödül)!`;
    } else {
      feedbackText = `${placeName} çevresinde korku salarak +${gain} Gümüş haraç topladın.`;
    }
    locationNoteTitle = `${protagonist.name} Haraç Kesti`;
    locationNoteDetail = `${protagonist.name}, ${placeName} civarında zayıfları tehdit edip zorla gümüş topladı.`;
  } else if (action === 'raid_supply') {
    const lootPool: InventoryItemId[] =
      faction === 'elf'
        ? ['healing_herb', 'antidote_vial']
        : faction === 'outlaws'
        ? ['smuggler_salt', 'rust_sword']
        : ['wool_bale', 'timber_crate', 'torch_bundle'];
    const lootId = lootPool[Math.floor(Math.random() * lootPool.length)];
    const stolenRations = 1 + (Math.random() < 0.6 ? 1 : 0);

    playerMorality = clamp(playerMorality - 15, -100, 100);
    reputation.outlaws = clamp((reputation.outlaws ?? 0) + 5, -100, 100);
    locationMoraleDelta = -7;

    if (roll >= 12) {
      rations += stolenRations;
      inventory = addInventoryItem(inventory, lootId, 1);
      if (faction !== 'outlaws') {
        reputation[faction] = clamp((reputation[faction] ?? 0) - 10, -100, 100);
      }
      feedbackText = `Gece baskınıyla ${placeName} ambarından +${stolenRations} Erzak ve 1x ${ITEM_CATALOG[lootId].name} yağmaladın!`;
    } else {
      const guardDmg = 12 + rollDie(10);
      health = Math.max(5, health - guardDmg);
      rations += 1;
      if (faction !== 'outlaws') {
        reputation[faction] = clamp((reputation[faction] ?? 0) - 16, -100, 100);
        bountySilver += 16;
        if (!bountyFactions.includes(faction)) bountyFactions.push(faction);
      }
      feedbackText = `${placeName} baskınında yakalandın! Nöbetçilerle çatışıp (-${guardDmg} Can, +16g Ödül) 1 erzak kaparak kaçtın.`;
    }
    locationNoteTitle = `${placeName} Ambar Yağması`;
    locationNoteDetail = `${protagonist.name} yerleşim erzak ve mallarına gece baskını düzenledi.`;
  } else if (action === 'blackmail_or_trade') {
    const gain = 7 + rollDie(8);
    silver += gain;
    playerMorality = clamp(playerMorality - 11, -100, 100);
    reputation.outlaws = clamp((reputation.outlaws ?? 0) + 5, -100, 100);
    locationMoraleDelta = -4;
    if (roll < 12 && faction !== 'outlaws' && location) {
      const addedBounty = 12;
      bountySilver += addedBounty;
      if (!bountyFactions.includes(faction)) bountyFactions.push(faction);
      reputation[faction] = clamp((reputation[faction] ?? 0) - 8, -100, 100);
      feedbackText = `${placeName} arka odalarında borçlu ve zayıfları şantajla sömürdün (+${gain} Gümüş), ama muhafızlar izini buldu (+${addedBounty}g Ödül)!`;
    } else {
      feedbackText = `${placeName} yeraltı ağında şantaj ve gizli aracılık işlerinden +${gain} Gümüş kazandın.`;
    }
    locationNoteTitle = `${placeName} Yeraltı Şantajı`;
    locationNoteDetail = `${protagonist.name} yerleşimdeki çaresiz borçlular ve gölgeli simsarlarla gizli çıkar pazarlıkları yürüttü.`;
  } else if (action === 'capture_captive') {
    const isWildOrHostile =
      !location ||
      location.dangerLevel >= 2 ||
      faction === 'outlaws' ||
      faction === 'goblinoids';
    const dc = isWildOrHostile ? 11 : 16;
    if (roll >= dc) {
      capturedCaptives += 1;
      if (isWildOrHostile) {
        playerMorality = clamp(playerMorality - 3, -100, 100);
        feedbackText = `${placeName} yakınlarında bir haydut/kaçağı sağ yakalayıp bağladın (+1 Tutsak; Külköy veya yeraltı pazarında satabilirsin, Zar ${roll}).`;
      } else {
        playerMorality = clamp(playerMorality - 14, -100, 100);
        bountySilver += 14;
        if (!bountyFactions.includes(faction)) bountyFactions.push(faction);
        reputation[faction] = clamp((reputation[faction] ?? 0) - 10, -100, 100);
        feedbackText = `${placeName} sınırında borçlu bir serseriyi zorla esir aldın (+1 Tutsak), ama kapı nöbetçileri peşine ödül koydu (+14g Ödül)!`;
      }
      locationMoraleDelta = isWildOrHostile ? 0 : -5;
    } else {
      const dmg = 8 + rollDie(8);
      health = Math.max(5, health - dmg);
      if (!isWildOrHostile && location) {
        bountySilver += 14;
        if (!bountyFactions.includes(faction)) bountyFactions.push(faction);
        reputation[faction] = clamp((reputation[faction] ?? 0) - 10, -100, 100);
        feedbackText = `${placeName} devriyeleri esir alma girişimini bastırdı! Arbedede yaralandın (-${dmg} Can, +14g Ödül, Zar ${roll}).`;
      } else {
        feedbackText = `${placeName} civarındaki hedef elinden kurtuldu ve direnirken seni yaraladı (-${dmg} Can, Zar ${roll}).`;
      }
    }
    locationNoteTitle = `${placeName} Esir / Tutsak Avı`;
    locationNoteDetail = `${protagonist.name}, ${placeName} civarında köle ve esir pazarı için canlı tutsak yakalamaya çalıştı.`;
  } else {
    // spread_discord
    playerMorality = clamp(playerMorality - 9, -100, 100);
    reputation.outlaws = clamp((reputation.outlaws ?? 0) + 4, -100, 100);
    locationMoraleDelta = -9;
    locationNoteTitle = `${placeName} İçinde Fitne ve Kumpas`;
    locationNoteDetail = `${protagonist.name} komşu yerleşimler ve kıtlık hakkında zehirli söylentiler yayarak halkı paniğe sürükledi.`;
    feedbackText = `${placeName} halkı arasında korku ve güvensizlik tohumları ektin (-9 Bölge Morali).`;
  }

  return {
    nextProtagonist: {
      ...protagonist,
      health,
      stamina,
      rations,
      silver,
      inventory,
      capturedCaptives,
      playerMorality,
      bountySilver,
      bountyFactions,
      reputation,
      mood: computeProtagonistMood(health, stamina, protagonist.hunger, cell.safetyScore),
      lastObservation: feedbackText,
      lastUpdatedMs: nextTimeMs,
      journal: pushJournal(protagonist.journal, {
        id: `pj-shd-${Date.now()}`,
        timestamp: ts,
        kind: 'Eylem',
        locationLabel: placeName,
        title: locationNoteTitle,
        detail: feedbackText,
      }),
    },
    locationMoraleDelta,
    locationNoteTitle,
    locationNoteDetail,
    feedbackText,
  };
}

// ==========================================
// 4. INTERACTIVE MULTI-CHOICE ENCOUNTER RESOLVER
// ==========================================

export type EncounterChoiceId =
  | 'attack_force'
  | 'negotiate_intimidate'
  | 'stealth_evade'
  | 'dirty_trick';

export function resolveInteractiveEncounterChoice(
  protagonist: ProtagonistState,
  choice: EncounterChoiceId,
  title: string,
  baseDc: number,
  location: MapLocation | undefined,
  cell: MazgalCell,
  nextTimeMs: number,
  mods: { physicalMod: number; socialMod: number; perceptionMod: number }
): {
  nextProtagonist: ProtagonistState;
  moraleDelta: number;
  summaryText: string;
} {
  const ts = formatGameDateTime(nextTimeMs);
  const faction = getFactionForLocation(location);
  const eq = getEquipmentBonuses(protagonist.inventory ?? []);

  let health = protagonist.health;
  let stamina = Math.max(5, protagonist.stamina - 8);
  let silver = protagonist.silver;
  let rations = protagonist.rations;
  let inventory = protagonist.inventory ?? createInitialInventory();
  let playerMorality = protagonist.playerMorality ?? 10;
  let bountySilver = protagonist.bountySilver ?? 0;
  let bountyFactions = [...(protagonist.bountyFactions ?? [])];
  let injuries = [...(protagonist.injuries ?? [])];
  const reputation = { ...protagonist.reputation };
  let moraleDelta = 0;

  const d20 = rollDie(20);
  let modUsed = 0;
  let label = '';

  if (choice === 'attack_force') {
    modUsed = mods.physicalMod + eq.physBonus;
    label = 'Saldır / Güç Kullan';
  } else if (choice === 'negotiate_intimidate') {
    modUsed = mods.socialMod + eq.socBonus;
    label = 'Pazarlık / Gözdağı';
  } else if (choice === 'stealth_evade') {
    modUsed = mods.perceptionMod + eq.percBonus;
    label = 'Siste Gizlen / Sıvış';
  } else {
    modUsed = Math.max(mods.socialMod, mods.perceptionMod) + 2;
    label = 'Kirli Oyun / Pusu Kur';
  }

  const total = d20 + modUsed;
  const success = total >= baseDc;
  let summaryText = '';

  if (choice === 'attack_force') {
    if (success) {
      const gainedSilver = 4 + rollDie(8);
      silver += gainedSilver;
      reputation[faction] = clamp((reputation[faction] ?? 0) + 4, -100, 100);
      moraleDelta = 3;
      const dropPool: InventoryItemId[] = ['healing_herb', 'torch_bundle', 'smuggler_salt', 'antidote_vial'];
      const dropId = dropPool[Math.floor(Math.random() * dropPool.length)];
      const gotDrop = Math.random() < 0.55;
      if (gotDrop) inventory = addInventoryItem(inventory, dropId, 1);
      summaryText = `[${label}: Zar ${d20}+${modUsed}=${total} ≥ DC ${baseDc}] Çatışmayı kazandın! +${gainedSilver} Gümüş${gotDrop ? ` ve 1x ${ITEM_CATALOG[dropId].name}` : ''} ele geçirdin.`;
    } else {
      const rawDmg = 10 + rollDie(12);
      const dmg = Math.max(3, rawDmg - eq.armorReduction);
      health = Math.max(4, health - dmg);
      stamina = Math.max(5, stamina - 10);
      if (dmg >= 14 && !injuries.includes('Derin Kesik')) {
        injuries.push('Derin Kesik');
      }
      summaryText = `[${label}: Zar ${d20}+${modUsed}=${total} < DC ${baseDc}] Darbe aldın (-${dmg} Can${eq.armorReduction ? `, zırh ${eq.armorReduction} emdi` : ''}) ve zorlukla sıyrıldın.`;
    }
  } else if (choice === 'negotiate_intimidate') {
    if (success) {
      const gained = 2 + rollDie(5);
      silver += gained;
      reputation[faction] = clamp((reputation[faction] ?? 0) + 3, -100, 100);
      playerMorality = clamp(playerMorality + 2, -100, 100);
      moraleDelta = 2;
      summaryText = `[${label}: Zar ${d20}+${modUsed}=${total} ≥ DC ${baseDc}] Kan dökmeden uzlaştın veya geri adım attırdın (+${gained} Gümüş, +3 İtibar).`;
    } else {
      const toll = Math.min(silver, 3 + rollDie(4));
      silver -= toll;
      summaryText = `[${label}: Zar ${d20}+${modUsed}=${total} < DC ${baseDc}] Sözün geçmedi; yolu açmak için ${toll} Gümüş ödemek zorunda kaldın.`;
    }
  } else if (choice === 'stealth_evade') {
    if (success) {
      rations += Math.random() < 0.35 ? 1 : 0;
      summaryText = `[${label}: Zar ${d20}+${modUsed}=${total} ≥ DC ${baseDc}] Sis içine ustalıkla süzülüp tehlikeden yara almadan uzaklaştın.`;
    } else {
      const dmg = Math.max(2, 5 + rollDie(6) - eq.armorReduction);
      health = Math.max(4, health - dmg);
      stamina = Math.max(5, stamina - 10);
      summaryText = `[${label}: Zar ${d20}+${modUsed}=${total} < DC ${baseDc}] Fark edildin; kaçarken sıyrık aldın (-${dmg} Can).`;
    }
  } else {
    // dirty_trick
    playerMorality = clamp(playerMorality - 7, -100, 100);
    reputation.outlaws = clamp((reputation.outlaws ?? 0) + 3, -100, 100);
    if (success) {
      const lootSilver = 6 + rollDie(8);
      silver += lootSilver;
      rations += 1;
      if (faction !== 'outlaws' && faction !== 'goblinoids' && Math.random() < 0.45) {
        bountySilver += 10;
        if (!bountyFactions.includes(faction)) bountyFactions.push(faction);
      }
      summaryText = `[${label}: Zar ${d20}+${modUsed}=${total} ≥ DC ${baseDc}] Kirli numarayla karşı tarafı tuzağa düşürdün (+${lootSilver} Gümüş, +1 Erzak).`;
    } else {
      const dmg = Math.max(4, 12 + rollDie(8) - eq.armorReduction);
      health = Math.max(4, health - dmg);
      if (faction !== 'outlaws' && faction !== 'goblinoids') {
        reputation[faction] = clamp((reputation[faction] ?? 0) - 8, -100, 100);
        bountySilver += 12;
        if (!bountyFactions.includes(faction)) bountyFactions.push(faction);
      }
      summaryText = `[${label}: Zar ${d20}+${modUsed}=${total} < DC ${baseDc}] Tuzak ters tepti! Ağır darbe aldın (-${dmg} Can, -8 İtibar).`;
    }
  }

  return {
    nextProtagonist: {
      ...protagonist,
      health,
      stamina,
      silver,
      rations,
      inventory,
      playerMorality,
      bountySilver,
      bountyFactions,
      injuries,
      reputation,
      mood: computeProtagonistMood(health, stamina, protagonist.hunger, cell.safetyScore),
      lastObservation: summaryText,
      lastUpdatedMs: nextTimeMs,
      journal: pushJournal(protagonist.journal, {
        id: `pj-choice-${Date.now()}`,
        timestamp: ts,
        kind: 'Karşılaşma',
        locationLabel: location?.name ?? `Mazgal ${cell.id}`,
        title: `${title} · ${label}`,
        detail: summaryText,
      }),
    },
    moraleDelta,
    summaryText,
  };
}

// ==========================================
// 5. TIMED CONTRACTS & WORLD WAVES
// ==========================================

export function getAvailableContractsAtLocation(
  location: MapLocation | undefined,
  allLocations: MapLocation[],
  gameTimeMs: number
): ActiveContract[] {
  if (!location || !location.livingState) return [];
  const arch = location.livingState.archetype;
  if (arch === 'mist_ruin' || arch === 'wild_nature' || arch === 'goblin_burrow') return [];

  const faction = getFactionForLocation(location);
  const ts = formatGameDateTime(gameTimeMs);
  const candidates: ActiveContract[] = [];

  const kulkoy = allLocations.find((l) => l.id === 'loc-kuldere');
  const kulova = allLocations.find((l) => l.id === 'loc-kulova-koyu');
  const derebasi = allLocations.find((l) => l.id === 'loc-derebasi-koyu');
  const gumus = allLocations.find((l) => l.id === 'loc-gumus-kopru');

  // Dynamic contracts linked directly to settlement's living activeProblems
  for (const prob of location.livingState.activeProblems.slice(0, 2)) {
    const titleLower = prob.title.toLowerCase();
    const needsTimber =
      titleLower.includes('sur') ||
      titleLower.includes('duvar') ||
      titleLower.includes('köprü') ||
      titleLower.includes('kereste');
    const needsHerb =
      titleLower.includes('salgın') ||
      titleLower.includes('hastalık') ||
      titleLower.includes('zehir') ||
      titleLower.includes('su') ||
      titleLower.includes('ateş');
    const isRaidRelated =
      titleLower.includes('akın') ||
      titleLower.includes('haydut') ||
      titleLower.includes('goblin') ||
      titleLower.includes('taciz') ||
      titleLower.includes('pusu');

    const hostileSource = allLocations.find(
      (l) =>
        l.id !== location.id &&
        (l.category === 'danger' || l.category === 'burrow')
    );

    if (isRaidRelated && hostileSource) {
      candidates.push({
        id: `cnt-prob-hunt-${location.id}-${prob.id}`,
        title: `Kriz Müdahalesi: ${prob.title}`,
        description: `${location.name} içindeki "${prob.title}" krizini bastırmak için ${hostileSource.name} hattına baskın/keşif seferi yap (3 gün içinde ulaş).`,
        originLocationId: location.id,
        originLocationName: location.name,
        targetLocationId: hostileSource.id,
        targetLocationName: hostileSource.name,
        faction,
        kind: 'Eskort / Devriye',
        rewardSilver: prob.severity === 'Yüksek' ? 28 : 20,
        repReward: prob.severity === 'Yüksek' ? 10 : 7,
        deadlineMs: addGameHours(gameTimeMs, 72),
        createdAt: ts,
        status: 'active',
      });
    } else {
      const supplyId: InventoryItemId = needsTimber
        ? 'timber_crate'
        : needsHerb
        ? 'healing_herb'
        : 'torch_bundle';
      const supplyName = ITEM_CATALOG[supplyId].name;
      candidates.push({
        id: `cnt-prob-sup-${location.id}-${prob.id}`,
        title: `Acil İkmal: ${prob.title}`,
        description: `"${prob.title}" krizini hafifletmek için ${location.name} merkezine 1 adet ${supplyName} teslim et (3 gün süre).`,
        originLocationId: location.id,
        originLocationName: location.name,
        targetLocationId: location.id,
        targetLocationName: location.name,
        faction,
        kind: 'Kargo / Takas',
        requiredItemId: supplyId,
        requiredItemQty: 1,
        rewardSilver: prob.severity === 'Yüksek' ? 24 : 18,
        repReward: 8,
        deadlineMs: addGameHours(gameTimeMs, 72),
        createdAt: ts,
        status: 'active',
      });
    }
  }

  if (arch === 'shepherd_village' && kulkoy) {
    candidates.push({
      id: `cnt-wool-${location.id}`,
      title: `${kulkoy.name} Garnizonuna Yün Teslimatı`,
      description: 'Kulova’dan 1 adet Yün Balyası alıp 3 gün içinde Külköy Kalesi’ne ulaştır.',
      originLocationId: location.id,
      originLocationName: location.name,
      targetLocationId: kulkoy.id,
      targetLocationName: kulkoy.name,
      faction,
      kind: 'Kargo / Takas',
      requiredItemId: 'wool_bale',
      requiredItemQty: 1,
      rewardSilver: 16,
      repReward: 6,
      deadlineMs: addGameHours(gameTimeMs, 72),
      createdAt: ts,
      status: 'active',
    });
  } else if (arch === 'lumber_village' && kulkoy) {
    candidates.push({
      id: `cnt-timber-${location.id}`,
      title: `${kulkoy.name} Sur Onarım Kerestesi`,
      description: `${derebasi?.name ?? 'Derebaşı'} tezgahından 1 adet İşlenmiş Kereste temin edip 3 gün içinde kaleye teslim et.`,
      originLocationId: location.id,
      originLocationName: location.name,
      targetLocationId: kulkoy.id,
      targetLocationName: kulkoy.name,
      faction,
      kind: 'Kargo / Takas',
      requiredItemId: 'timber_crate',
      requiredItemQty: 1,
      rewardSilver: 18,
      repReward: 7,
      deadlineMs: addGameHours(gameTimeMs, 72),
      createdAt: ts,
      status: 'active',
    });
  } else if (arch === 'smuggler_cove' && (gumus || kulova)) {
    const dest = gumus ?? kulova!;
    candidates.push({
      id: `cnt-salt-${location.id}`,
      title: `${dest.name} Hattına Kaçak Tuz Sevkiyatı`,
      description: `1 adet Kıyı Tuz Çuvalını 4 gün içinde ${dest.name} noktasına gizlice ulaştır.`,
      originLocationId: location.id,
      originLocationName: location.name,
      targetLocationId: dest.id,
      targetLocationName: dest.name,
      faction,
      kind: 'Kargo / Takas',
      requiredItemId: 'smuggler_salt',
      requiredItemQty: 1,
      rewardSilver: 22,
      repReward: 6,
      deadlineMs: addGameHours(gameTimeMs, 96),
      createdAt: ts,
      status: 'active',
    });
  }

  // Captive Rescue & Ransom Contracts (non-explicit dark fantasy)
  const captiveDen = allLocations.find(
    (l) =>
      l.id !== location.id &&
      (l.livingState?.archetype === 'goblin_burrow' ||
        l.livingState?.archetype === 'bandit_hamlet')
  );
  if (captiveDen && arch !== 'bandit_hamlet' && arch !== 'smuggler_cove') {
    candidates.push({
      id: `cnt-rescue-${location.id}-${captiveDen.id}`,
      title: `${captiveDen.name} Esir Kurtarma Seferi`,
      description: `Bölgeden kaçırılıp ${captiveDen.name} tünellerinde/mahzeninde fidye ve zorunlu çalışma için tutulan esirlerin izini sür (4 gün içinde hedefe ulaş).`,
      originLocationId: location.id,
      originLocationName: location.name,
      targetLocationId: captiveDen.id,
      targetLocationName: captiveDen.name,
      faction,
      kind: 'Kurtarma / Fidye',
      rewardSilver: 26,
      repReward: 10,
      deadlineMs: addGameHours(gameTimeMs, 96),
      createdAt: ts,
      status: 'active',
    });
  } else if ((arch === 'bandit_hamlet' || arch === 'smuggler_cove') && kulkoy) {
    candidates.push({
      id: `cnt-ransom-${location.id}`,
      title: `Karanlık Fidye Mektubu Teslimi`,
      description: `Kaçırılan tüccar kafilesinin fidye şartlarını 3 gün içinde gizlice ${kulkoy.name} kapısındaki aracıya ulaştır.`,
      originLocationId: location.id,
      originLocationName: location.name,
      targetLocationId: kulkoy.id,
      targetLocationName: kulkoy.name,
      faction: 'outlaws',
      kind: 'Kurtarma / Fidye',
      rewardSilver: 24,
      repReward: 6,
      deadlineMs: addGameHours(gameTimeMs, 72),
      createdAt: ts,
      status: 'active',
    });
  }

  // Universal regional patrol/scout contract to a neighboring or unsafe spot
  const other =
    allLocations.find((l) => l.id !== location.id && l.dangerLevel >= 3) ??
    allLocations.find((l) => l.id !== location.id);
  if (other) {
    candidates.push({
      id: `cnt-scout-${location.id}-${other.id}`,
      title: `${other.name} Yönü Keşif & Rapor`,
      description: `${other.name} noktasına 4 gün içinde bizzat ulaş ve yol güvenliğini denetle.`,
      originLocationId: location.id,
      originLocationName: location.name,
      targetLocationId: other.id,
      targetLocationName: other.name,
      faction,
      kind: 'Keşif / İz',
      rewardSilver: 12 + other.dangerLevel * 2,
      repReward: 5,
      deadlineMs: addGameHours(gameTimeMs, 96),
      createdAt: ts,
      status: 'active',
    });
  }

  return candidates;
}

export function acceptContract(
  protagonist: ProtagonistState,
  contract: ActiveContract
): { nextProtagonist: ProtagonistState; message: string } {
  const existing = protagonist.contracts ?? [];
  if (existing.some((c) => c.status === 'active' && c.id === contract.id)) {
    return { nextProtagonist: protagonist, message: 'Bu kontrat zaten üzerinde aktif.' };
  }
  if (existing.filter((c) => c.status === 'active').length >= 3) {
    return { nextProtagonist: protagonist, message: 'Aynı anda en fazla 3 aktif kontrat taşıyabilirsin.' };
  }
  return {
    nextProtagonist: {
      ...protagonist,
      contracts: [contract, ...existing].slice(0, 8),
    },
    message: `"${contract.title}" kontratı kabul edildi (Son teslim: ${formatGameDateTime(contract.deadlineMs)}).`,
  };
}

export function tryCompleteContractAtLocation(
  protagonist: ProtagonistState,
  contractId: string,
  currentLocation: MapLocation | undefined,
  gameTimeMs: number
): {
  nextProtagonist: ProtagonistState;
  message: string;
  locationMoraleDelta: number;
} {
  if (!currentLocation) {
    return {
      nextProtagonist: protagonist,
      message: 'Kontratı teslim etmek için hedef konumda bulunmalısın.',
      locationMoraleDelta: 0,
    };
  }
  const contracts = protagonist.contracts ?? [];
  const target = contracts.find((c) => c.id === contractId && c.status === 'active');
  if (!target) {
    return { nextProtagonist: protagonist, message: 'Aktif kontrat bulunamadı.', locationMoraleDelta: 0 };
  }
  if (currentLocation.id !== target.targetLocationId) {
    return {
      nextProtagonist: protagonist,
      message: `Teslimat için ${target.targetLocationName} konumuna gitmelisin.`,
      locationMoraleDelta: 0,
    };
  }

  let inventory = protagonist.inventory ?? createInitialInventory();
  if (target.requiredItemId) {
    const qtyNeed = target.requiredItemQty ?? 1;
    const owned = inventory.find((i) => i.id === target.requiredItemId);
    if (!owned || owned.qty < qtyNeed) {
      return {
        nextProtagonist: protagonist,
        message: `Teslimat için çantanda ${qtyNeed} adet ${ITEM_CATALOG[target.requiredItemId].name} bulunmalı.`,
        locationMoraleDelta: 0,
      };
    }
    inventory = addInventoryItem(inventory, target.requiredItemId, -qtyNeed);
  }

  const silver = protagonist.silver + target.rewardSilver;
  const playerMorality = clamp((protagonist.playerMorality ?? 10) + 4, -100, 100);
  const reputation = { ...protagonist.reputation };
  reputation[target.faction] = clamp((reputation[target.faction] ?? 0) + target.repReward, -100, 100);

  const nextContracts = contracts.map((c) =>
    c.id === target.id ? { ...c, status: 'completed' as const } : c
  );

  const msg = `"${target.title}" zamanında tamamlandı (+${target.rewardSilver} Gümüş, +${target.repReward} İtibar)!`;

  return {
    nextProtagonist: {
      ...protagonist,
      silver,
      inventory,
      playerMorality,
      reputation,
      contracts: nextContracts,
      lastObservation: msg,
      journal: pushJournal(protagonist.journal, {
        id: `pj-cnt-${Date.now()}`,
        timestamp: formatGameDateTime(gameTimeMs),
        kind: 'Eylem',
        locationLabel: currentLocation.name,
        title: `Kontrat Tamamlandı`,
        detail: msg,
      }),
    },
    message: msg,
    locationMoraleDelta: 5,
  };
}

const WAVE_BLUEPRINTS: {
  kind: WorldWaveKind;
  title: string;
  description: string;
  affectedFactions: FactionKey[];
  priceMultiplier: number;
  dangerShift: number;
  moraleShiftPerDay: number;
  durationHours: number;
}[] = [
  {
    kind: 'Sis Fırtınası',
    title: 'Doğu Vadisi Ağır Sis Dalgası',
    description: 'Yoğun soğuk sis 4 gün boyunca görüşü düşürüyor, yolları yavaşlatıp fiyatlara +20% ekliyor.',
    affectedFactions: ['border_human', 'elf'],
    priceMultiplier: 1.2,
    dangerShift: 1,
    moraleShiftPerDay: -2,
    durationHours: 96,
  },
  {
    kind: 'Goblin Akını',
    title: 'Güney İnlerinden Goblin Taşkını',
    description: 'Paslıçukur yönünden keşif grupları sızıyor; çevre köylerde korku artıyor.',
    affectedFactions: ['border_human', 'beastkin'],
    priceMultiplier: 1.25,
    dangerShift: 1,
    moraleShiftPerDay: -3,
    durationHours: 72,
  },
  {
    kind: 'Ticaret Şenliği',
    title: 'Külköy – Kulova Kervan Haftası',
    description: 'Batıdan gelen tüccar arabaları fiyatları %15 düşürüp yerleşim moralini yükseltiyor.',
    affectedFactions: ['border_human', 'elf'],
    priceMultiplier: 0.85,
    dangerShift: 0,
    moraleShiftPerDay: 3,
    durationHours: 96,
  },
  {
    kind: 'Kıtlık Dalgası',
    title: 'Kuru Tahıl ve İlaç Darboğazı',
    description: 'Nem ve yol kesintisi yüzünden erzak ve şifalı ot fiyatları %35 yükseldi.',
    affectedFactions: ['border_human', 'beastkin', 'outlaws'],
    priceMultiplier: 1.35,
    dangerShift: 0,
    moraleShiftPerDay: -2,
    durationHours: 84,
  },
  {
    kind: 'Eşkıya İttifakı',
    title: 'Kuzey Yolu Haydut Hareketliliği',
    description: 'Kuzey ormanı ve kaçakçılar arasında gizli anlaşma yapıldı; yol güvenliği düştü.',
    affectedFactions: ['outlaws', 'border_human'],
    priceMultiplier: 1.18,
    dangerShift: 1,
    moraleShiftPerDay: -2,
    durationHours: 72,
  },
];

export function advanceContractsAndWaves(
  protagonist: ProtagonistState,
  prevTimeMs: number,
  nextTimeMs: number
): { nextProtagonist: ProtagonistState; waveAnnouncement?: string } {
  const prevDay = Math.floor((prevTimeMs - INITIAL_GAME_TIME_MS) / (24 * 60 * 60 * 1000));
  const nextDay = Math.floor((nextTimeMs - INITIAL_GAME_TIME_MS) / (24 * 60 * 60 * 1000));
  const daysCrossed = Math.max(0, nextDay - prevDay);

  let contracts = protagonist.contracts ?? [];
  let reputation = { ...protagonist.reputation };
  let journal = protagonist.journal;
  let expiredNote: string | null = null;

  contracts = contracts.map((c) => {
    if (c.status === 'active' && nextTimeMs > c.deadlineMs) {
      reputation[c.faction] = clamp((reputation[c.faction] ?? 0) - 6, -100, 100);
      expiredNote = `"${c.title}" kontratının süresi doldu (-6 ${FACTION_LABELS[c.faction]} İtibarı).`;
      return { ...c, status: 'failed' as const };
    }
    return c;
  });

  if (expiredNote) {
    journal = pushJournal(journal, {
      id: `pj-exp-${Date.now()}`,
      timestamp: formatGameDateTime(nextTimeMs),
      kind: 'Durum',
      locationLabel: `Mazgal ${protagonist.mazgalId}`,
      title: 'Kontrat Süresi Doldu',
      detail: expiredNote,
    });
  }

  let activeWave = protagonist.activeWorldWave ?? null;
  let waveAnnouncement: string | undefined;

  if (activeWave && nextTimeMs >= activeWave.endMs) {
    waveAnnouncement = `${activeWave.title} sona erdi; bölge olağan ritmine dönüyor.`;
    activeWave = null;
  }

  if (!activeWave && daysCrossed > 0 && Math.random() < 0.28 * daysCrossed) {
    const bp = WAVE_BLUEPRINTS[Math.floor(Math.random() * WAVE_BLUEPRINTS.length)];
    activeWave = {
      id: `wave-${Date.now()}`,
      kind: bp.kind,
      title: bp.title,
      description: bp.description,
      affectedFactions: bp.affectedFactions,
      startMs: nextTimeMs,
      endMs: addGameHours(nextTimeMs, bp.durationHours),
      priceMultiplier: bp.priceMultiplier,
      dangerShift: bp.dangerShift,
      moraleShiftPerDay: bp.moraleShiftPerDay,
    };
    waveAnnouncement = `Bölgesel Dalga Başladı: ${activeWave.title}`;
    journal = pushJournal(journal, {
      id: `pj-wave-${Date.now()}`,
      timestamp: formatGameDateTime(nextTimeMs),
      kind: 'Durum',
      locationLabel: 'Doğu Vadisi Geneli',
      title: activeWave.title,
      detail: activeWave.description,
    });
  }

  return {
    nextProtagonist: {
      ...protagonist,
      reputation,
      contracts,
      activeWorldWave: activeWave,
      journal,
    },
    waveAnnouncement,
  };
}

// ==========================================
// 6. GUARD INTERCEPTION, NPC ROBBERY & CRITICAL RECOVERY
// ==========================================

export function checkGuardEncounterOnArrival(
  protagonist: ProtagonistState,
  location: MapLocation | undefined,
  gameTimeMs: number,
  mods: { perceptionMod: number; socialMod: number }
): { nextProtagonist: ProtagonistState; alertNote?: string } {
  if (!location) return { nextProtagonist: protagonist };
  const bounty = protagonist.bountySilver ?? 0;
  if (bounty <= 0) return { nextProtagonist: protagonist };

  const faction = getFactionForLocation(location);
  if (faction === 'outlaws' || !(protagonist.bountyFactions ?? []).includes(faction)) {
    return { nextProtagonist: protagonist };
  }

  const arch = location.livingState?.archetype;
  if (arch === 'wild_nature' || arch === 'mist_ruin' || arch === 'goblin_burrow') {
    return { nextProtagonist: protagonist };
  }

  const evadeRoll = rollDie(20) + Math.max(mods.perceptionMod, mods.socialMod);
  if (evadeRoll >= 14) {
    return {
      nextProtagonist: protagonist,
      alertNote: `${location.name} kapısında arananlar ilanını gördün ama kalabalığa karışıp fark edilmeden içeri sızdın (Zar ${evadeRoll}).`,
    };
  }

  // Guards intercept! Pay bounty if affordable, or suffer arrest scuffle!
  let silver = protagonist.silver;
  let health = protagonist.health;
  let nextBounty = bounty;
  let nextBountyFactions = [...(protagonist.bountyFactions ?? [])];
  let alertNote = '';

  if (silver >= bounty) {
    silver -= bounty;
    nextBounty = 0;
    nextBountyFactions = [];
    alertNote = `${location.name} muhafızları seni tanıdı! Kefaret olan ${bounty} Gümüşü ödeyip serbest kaldın.`;
  } else {
    const taken = silver;
    silver = 0;
    nextBounty = Math.max(5, bounty - taken);
    const dmg = 10 + rollDie(8);
    health = Math.max(5, health - dmg);
    alertNote = `${location.name} muhafızlarıyla kapıda arbede çıktı! ${taken} Gümüşüne el konuldu ve yaralanarak (-${dmg} Can) ara sokaktan kaçtın.`;
  }

  return {
    nextProtagonist: {
      ...protagonist,
      silver,
      health,
      bountySilver: nextBounty,
      bountyFactions: nextBountyFactions,
      lastObservation: alertNote,
      journal: pushJournal(protagonist.journal, {
        id: `pj-grd-${Date.now()}`,
        timestamp: formatGameDateTime(gameTimeMs),
        kind: 'Karşılaşma',
        locationLabel: location.name,
        title: 'Muhafız Çevirmesi',
        detail: alertNote,
      }),
    },
    alertNote,
  };
}

export function payBountyAtSettlement(
  protagonist: ProtagonistState,
  location: MapLocation | undefined,
  gameTimeMs: number
): { nextProtagonist: ProtagonistState; message: string } {
  const bounty = protagonist.bountySilver ?? 0;
  if (bounty <= 0) {
    return { nextProtagonist: protagonist, message: 'Üzerinde aktif bir yakalama ödülü yok.' };
  }
  if (protagonist.silver < bounty) {
    return {
      nextProtagonist: protagonist,
      message: `Kefareti kapatmak için ${bounty} Gümüş gerekiyor.`,
    };
  }

  const reputation = { ...protagonist.reputation };
  for (const f of protagonist.bountyFactions ?? []) {
    reputation[f] = Math.max(-10, (reputation[f] ?? 0) + 8);
  }

  const msg = `${location?.name ?? 'Garnizon'} aracılığıyla ${bounty} Gümüş kefaret ödeyip hakkındaki aranma kaydını sildirdin.`;
  return {
    nextProtagonist: {
      ...protagonist,
      silver: protagonist.silver - bounty,
      bountySilver: 0,
      bountyFactions: [],
      reputation,
      lastObservation: msg,
      journal: pushJournal(protagonist.journal, {
        id: `pj-bnt-${Date.now()}`,
        timestamp: formatGameDateTime(gameTimeMs),
        kind: 'Durum',
        locationLabel: location?.name ?? `Mazgal ${protagonist.mazgalId}`,
        title: 'Ödül / Kefaret Ödendi',
        detail: msg,
      }),
    },
    message: msg,
  };
}

export function evaluateCriticalHealthRecovery(
  protagonist: ProtagonistState,
  currentLocation: MapLocation | undefined,
  cell: MazgalCell,
  gameTimeMs: number
): { nextProtagonist: ProtagonistState; recoveryNotice?: string } {
  if (protagonist.health > 8) return { nextProtagonist: protagonist };

  const contacts = protagonist.contacts ?? [];
  const savior = contacts.find(
    (c) =>
      (c.partyRelation !== 'independent' ||
        c.currentLocationId === protagonist.locationId) &&
      ((c.morality ?? 0) >= 45 || c.romanceStatus === 'Sevgili / Bağlı')
  );

  const faction = getFactionForLocation(currentLocation);
  const localRep = protagonist.reputation[faction] ?? 0;
  const ts = formatGameDateTime(gameTimeMs);

  let health = 26;
  let stamina = Math.max(25, protagonist.stamina);
  let silver = protagonist.silver;
  let rations = protagonist.rations;
  let injuries = [...(protagonist.injuries ?? [])];
  let recoveryNotice = '';

  if (savior) {
    health = 34;
    recoveryNotice = `Ağır yaralanıp bilincini kaybettin! ${savior.name} başından ayrılmayıp kanamanı durdurdu ve seni hayatta tuttu (Can 34/100).`;
  } else if (currentLocation && faction !== 'outlaws' && faction !== 'goblinoids' && localRep >= -10) {
    const fee = Math.min(silver, 5);
    silver -= fee;
    health = 28;
    recoveryNotice = `${currentLocation.name} şifacıları baygın halini bulup revire aldı (${fee} Gümüş bakım bedeli, Can 28/100).`;
  } else {
    const stolenSilver = silver > 0 ? Math.max(1, Math.round(silver * 0.6)) : 0;
    const lostRations = Math.min(rations, 2);
    silver -= stolenSilver;
    rations -= lostRations;
    health = 22;
    if (!injuries.includes('Derin Kesik')) injuries.push('Derin Kesik');
    recoveryNotice = `Ağır darbeyle kendinden geçtin! Yağmacılar ${stolenSilver} Gümüş ve ${lostRations} erzağını alıp seni yaralı bıraktı ('Derin Kesik', Can 22/100).`;
  }

  return {
    nextProtagonist: {
      ...protagonist,
      health,
      stamina,
      silver,
      rations,
      injuries,
      mood: computeProtagonistMood(health, stamina, protagonist.hunger, cell.safetyScore),
      lastObservation: recoveryNotice,
      journal: pushJournal(protagonist.journal, {
        id: `pj-crit-${Date.now()}`,
        timestamp: ts,
        kind: 'Durum',
        locationLabel: currentLocation?.name ?? `Mazgal ${cell.id}`,
        title: 'Kritik Yaralanma & Kurtulma',
        detail: recoveryNotice,
      }),
    },
    recoveryNotice,
  };
}

export function buildInteractiveSummaryForScene(
  scene: ProceduralSceneCard
): { title: string; dc: number } {
  const dcMatch = scene.checkLabel.match(/DC\s*(\d+)/i);
  const dc = dcMatch ? Number(dcMatch[1]) : 13;
  return { title: scene.title, dc };
}

export function buildInteractiveSummaryForEncounter(
  enc: ForestEncounter
): { title: string; dc: number } {
  const dc = enc.defense > 0 ? clamp(enc.defense, 10, 18) : 12;
  return { title: enc.title, dc };
}

export function getNpcGrudgeTag(c: LivingNpcContact): string | null {
  if (c.isWantedByPlayer && (c.stoleFromPlayerSilver ?? 0) > 0) {
    return `Seni ${c.stoleFromPlayerSilver} Gümüş soydu`;
  }
  return null;
}

// ==========================================
// 7. FRONTIER SLAVERY & BONDED CAPTIVE MARKET
// ==========================================

export interface SlaveListing {
  id: string;
  name: string;
  originLabel: string;
  role: string;
  temperament: NpcTemperament;
  morality: number;
  basePriceSilver: number;
  priceSilver: number;
  dailyWageIfFreed: number;
  combatBonus: number;
  scoutBonus: number;
  socialBonus: number;
  trait: string;
}

const SLAVE_POOL: Omit<SlaveListing, 'priceSilver'>[] = [
  {
    id: 'slave-reno-arabaci',
    name: 'Borçlu Arabacı Reno',
    originLabel: 'Batı Kervan Borçlusu',
    role: 'Yük Arabacısı ve Kamp Hizmetkârı',
    temperament: 'Dürüst',
    morality: 22,
    basePriceSilver: 18,
    dailyWageIfFreed: 2,
    combatBonus: 0,
    scoutBonus: 1,
    socialBonus: 1,
    trait: 'Kervan vergisini ödeyemediği için Külköy mahkemesince borç köleliğine verilmiş; yolları iyi bilir.',
  },
  {
    id: 'slave-kaelen-tutsak',
    name: 'Savaş Tutsağı Kaelen',
    originLabel: 'Kuzey Sınır Çatışması Esiri',
    role: 'Mızrakçı ve Sınır Nöbetçisi',
    temperament: 'Gözüpek',
    morality: 10,
    basePriceSilver: 26,
    dailyWageIfFreed: 3,
    combatBonus: 1,
    scoutBonus: 1,
    socialBonus: 0,
    trait: 'Kış baskınında esir düşmüş disiplinli eski sınır eri; emirlere uyar ama onuruna düşkündür.',
  },
  {
    id: 'slave-garrick-haydut',
    name: 'Hükümlü İzci Garrick',
    originLabel: 'Yakalanan Kuzey Haydutu',
    role: 'Öncü Gözcü ve Tuzakçı',
    temperament: 'Kurnaz',
    morality: -42,
    basePriceSilver: 22,
    dailyWageIfFreed: 2,
    combatBonus: 1,
    scoutBonus: 1,
    socialBonus: 0,
    trait: 'Külköy devriyelerince zincirlenip pazara çıkarılmış eski eşkıya; gözcülüğü keskindir ama gözü hep fırsattadır.',
  },
  {
    id: 'slave-doran-demirci',
    name: 'Ocak Çırağı Doran',
    originLabel: 'Taşköprü Borç Sözleşmesi',
    role: 'Silah Bakımı ve Ağır Muhafız',
    temperament: 'Şefkatli',
    morality: 48,
    basePriceSilver: 24,
    dailyWageIfFreed: 2,
    combatBonus: 1,
    scoutBonus: 0,
    socialBonus: 1,
    trait: 'Ailesinin vergi borcunu kapatmak için mühürlü köle senedine imza atmış güçlü demirci çırağı.',
  },
  {
    id: 'slave-sable-kurekci',
    name: 'Kaçakçı Kâtibi Sable',
    originLabel: 'Doğu Kıyısı Esiri',
    role: 'Hesap Tutucu ve Gece Gözcüsü',
    temperament: 'Çıkarcı',
    morality: -28,
    basePriceSilver: 20,
    dailyWageIfFreed: 2,
    combatBonus: 0,
    scoutBonus: 1,
    socialBonus: 1,
    trait: 'Hayalet Koy baskınında yakalanmış kurnaz tüccar yamağı; pazarlık ve kaçış yollarını iyi hesaplar.',
  },
];

export function getSlaveMarketForLocation(
  location: MapLocation | undefined,
  protagonist: ProtagonistState
): {
  marketOpen: boolean;
  isLegalHumanMarket: boolean;
  marketTitle: string;
  closedReason?: string;
  captiveSellPrice: number;
  listings: SlaveListing[];
} {
  if (!location || !location.livingState) {
    return {
      marketOpen: false,
      isLegalHumanMarket: false,
      marketTitle: 'Köle & Tutsak Pazarı',
      closedReason: 'Açık arazide köle veya esir pazarı kurulmaz.',
      captiveSellPrice: 0,
      listings: [],
    };
  }

  const arch = location.livingState.archetype;
  const faction = getFactionForLocation(location);

  if (arch === 'elf_canopy' || arch === 'beastkin_clan') {
    return {
      marketOpen: false,
      isLegalHumanMarket: false,
      marketTitle: 'Köle & Tutsak Pazarı',
      closedReason: `${location.name} gelenekleri insan sınırlarındaki gibi köle ticaretini kabul etmez.`,
      captiveSellPrice: 0,
      listings: [],
    };
  }

  if (arch === 'shepherd_village' || arch === 'lumber_village' || arch === 'river_crossing') {
    return {
      marketOpen: false,
      isLegalHumanMarket: false,
      marketTitle: 'Köle & Tutsak Pazarı',
      closedReason: `Küçük köylerde mühürlü esir mezatı kurulmaz; yasal köle pazarı için Külköy Sınır Kalesi’ne gitmelisin.`,
      captiveSellPrice: 0,
      listings: [],
    };
  }

  if (arch === 'mist_ruin' || arch === 'wild_nature' || arch === 'goblin_burrow') {
    return {
      marketOpen: false,
      isLegalHumanMarket: false,
      marketTitle: 'Köle & Tutsak Pazarı',
      closedReason: `${location.name} içinde düzenli esir alım-satım tezgâhı yok.`,
      captiveSellPrice: 0,
      listings: [],
    };
  }

  const isLegalHumanMarket = arch === 'border_fortress';
  const waveMod = protagonist.activeWorldWave?.priceMultiplier ?? 1.0;
  const rep = protagonist.reputation[faction] ?? 0;
  const repMod = rep >= 20 ? 0.9 : rep <= -20 ? 1.2 : 1.0;
  const blackMarketMod = isLegalHumanMarket ? 1.0 : 1.12;

  const existingIds = new Set((protagonist.contacts ?? []).map((c) => c.id));
  const poolSubset = isLegalHumanMarket
    ? SLAVE_POOL.slice(0, 4)
    : SLAVE_POOL.slice(2, 5);

  const listings: SlaveListing[] = poolSubset
    .filter((entry) => !existingIds.has(entry.id))
    .map((entry) => ({
      ...entry,
      priceSilver: Math.max(10, Math.round(entry.basePriceSilver * waveMod * repMod * blackMarketMod)),
    }));

  const captiveSellPrice = Math.max(
    12,
    Math.round((isLegalHumanMarket ? 18 : 16) * waveMod * (rep >= 15 ? 1.1 : 1.0))
  );

  return {
    marketOpen: true,
    isLegalHumanMarket,
    marketTitle: isLegalHumanMarket
      ? `${location.name} · Yasal Köle ve Borçlu Pazarı`
      : `${location.name} · Yeraltı Esir Tezgâhı`,
    captiveSellPrice,
    listings,
  };
}

export function buySlaveForParty(
  protagonist: ProtagonistState,
  location: MapLocation | undefined,
  listingId: string,
  mode: 'bond_retainer' | 'manumit',
  gameTimeMs: number
): { nextProtagonist: ProtagonistState; message: string } {
  const market = getSlaveMarketForLocation(location, protagonist);
  if (!market.marketOpen || !location) {
    return {
      nextProtagonist: protagonist,
      message: market.closedReason ?? 'Burada köle pazarı açık değil.',
    };
  }
  const listing = market.listings.find((l) => l.id === listingId);
  if (!listing) {
    return { nextProtagonist: protagonist, message: 'Bu esir artık tezgahta değil.' };
  }
  if (protagonist.silver < listing.priceSilver) {
    return {
      nextProtagonist: protagonist,
      message: `${listing.name} için ${listing.priceSilver} Gümüş gerekiyor.`,
    };
  }

  const ts = formatGameDateTime(gameTimeMs);
  const cell = getCellForCoords(location.x, location.y);
  const faction = getFactionForLocation(location);
  const silver = protagonist.silver - listing.priceSilver;
  const isBonded = mode === 'bond_retainer';

  const newContact: LivingNpcContact = {
    id: listing.id,
    name: listing.name,
    role: isBonded ? `${listing.role} (Bağlı Köle)` : listing.role,
    cultureLabel: listing.originLabel,
    faction,
    trait: listing.trait,
    motive: isBonded
      ? 'Mühürlü köle senedi gereği sahibinin emrinde yol almak'
      : 'Azat edilmenin minnetiyle özgür yaşamını sürdürmek',
    temperament: listing.temperament,
    morality: listing.morality,
    trust: isBonded ? 34 : 74,
    affection: isBonded ? 0 : 18,
    mood: isBonded ? 'Baskı Altında / Çekingen' : 'Minnettar',
    romanceStatus: 'Yok',
    partyRelation: isBonded ? 'hired_by_player' : 'independent',
    dailyWageSilver: isBonded ? 0 : listing.dailyWageIfFreed,
    combatBonus: listing.combatBonus,
    scoutBonus: listing.scoutBonus,
    socialBonus: listing.socialBonus,
    currentLocationId: location.id,
    currentMazgalId: cell.id,
    homeLocationId: location.id,
    openToRomance: !isBonded,
    isBonded,
    lastIntent: isBonded ? 'Kuşkulu Mesafe' : 'Samimi Dostluk',
    lastReaction: isBonded
      ? `${location.name} köle kâtibi mührü bastı; ${listing.name} artık ücret istemeden partinle yürüyor.`
      : `${listing.name} özgürlük belgesini eline alınca başını eğip minnetle teşekkür etti.`,
    intentSuspected: false,
    metAt: ts,
    lastUpdatedMs: gameTimeMs,
    memoryNotes: [
      isBonded
        ? `${location.name} pazarından ${listing.priceSilver} Gümüşe bağlı hizmetkâr olarak alındı.`
        : `${location.name} pazarından ${listing.priceSilver} Gümüşe satın alınıp azat edildi.`,
    ],
  };

  const playerMorality = clamp(
    (protagonist.playerMorality ?? 10) + (isBonded ? -2 : 10),
    -100,
    100
  );

  const msg = isBonded
    ? `${location.name} pazarından ${listing.priceSilver} Gümüşe ${listing.name} satın alındı (0g/gün bağlı yoldaş).`
    : `${listing.name} ${listing.priceSilver} Gümüş ödenerek satın alınıp özgür bırakıldı (+10 Ahlak, +28 Güven)!`;

  return {
    nextProtagonist: {
      ...protagonist,
      silver,
      playerMorality,
      contacts: [newContact, ...(protagonist.contacts ?? [])],
      npcMoments: appendNpcMoment(
        protagonist.npcMoments,
        createNpcMomentRecord({
          npcId: newContact.id,
          npcName: newContact.name,
          npcRole: newContact.role,
          timestamp: ts,
          timestampMs: gameTimeMs,
          locationLabel: location.name,
          category: 'Kölelik / Azat',
          title: isBonded
            ? `${newContact.name} Köle Pazarından Alındı`
            : `${newContact.name} Satın Alınıp Azat Edildi`,
          summary: msg,
          trustDelta: isBonded ? undefined : 24,
          trustAfter: newContact.trust,
          moodAfter: newContact.mood,
          significance: 'kritik',
          isMilestone: true,
          milestoneLabel: isBonded ? 'Mühürlü Bağlılık' : 'Özgürlük ve Minnet',
        })
      ),
      lastObservation: msg,
      journal: pushJournal(protagonist.journal, {
        id: `pj-slv-${Date.now()}`,
        timestamp: ts,
        kind: 'Eylem',
        locationLabel: location.name,
        title: isBonded ? 'Köle Pazarından Alım' : 'Esir Satın Alıp Azat Etme',
        detail: msg,
      }),
    },
    message: msg,
  };
}

export function sellCaptiveAtMarket(
  protagonist: ProtagonistState,
  location: MapLocation | undefined,
  gameTimeMs: number
): { nextProtagonist: ProtagonistState; message: string } {
  const captives = protagonist.capturedCaptives ?? 0;
  if (captives <= 0) {
    return { nextProtagonist: protagonist, message: 'Elinde satılacak yakalanmış tutsak yok.' };
  }
  const market = getSlaveMarketForLocation(location, protagonist);
  if (!market.marketOpen || !location) {
    return {
      nextProtagonist: protagonist,
      message: market.closedReason ?? 'Bu konumda tutsak alacak bir köle pazarı yok.',
    };
  }

  const gain = market.captiveSellPrice;
  const ts = formatGameDateTime(gameTimeMs);
  const msg = `${location.name} esir mübaşirine 1 tutsak teslim edip +${gain} Gümüş aldın (yasalar gereği yasal satış).`;

  return {
    nextProtagonist: {
      ...protagonist,
      silver: protagonist.silver + gain,
      capturedCaptives: captives - 1,
      playerMorality: clamp((protagonist.playerMorality ?? 10) - 3, -100, 100),
      lastObservation: msg,
      journal: pushJournal(protagonist.journal, {
        id: `pj-scap-${Date.now()}`,
        timestamp: ts,
        kind: 'Eylem',
        locationLabel: location.name,
        title: 'Pazara Tutsak Satışı',
        detail: msg,
      }),
    },
    message: msg,
  };
}

export function sellBondedRetainerAtMarket(
  protagonist: ProtagonistState,
  contactId: string,
  location: MapLocation | undefined,
  gameTimeMs: number
): { nextProtagonist: ProtagonistState; message: string } {
  const contacts = protagonist.contacts ?? [];
  const target = contacts.find((c) => c.id === contactId);
  if (!target || !target.isBonded) {
    return { nextProtagonist: protagonist, message: 'Yalnızca bağlı köle/esir statüsündeki kişiler satılabilir.' };
  }
  const market = getSlaveMarketForLocation(location, protagonist);
  if (!market.marketOpen || !location) {
    return {
      nextProtagonist: protagonist,
      message: market.closedReason ?? 'Satış için Külköy veya yeraltı köle pazarına gitmelisin.',
    };
  }

  const resale = Math.max(10, Math.round(market.captiveSellPrice * 0.85));
  const ts = formatGameDateTime(gameTimeMs);
  const msg = `${target.name}, ${location.name} pazarında +${resale} Gümüş karşılığı yeni efendiye devredildi.`;

  return {
    nextProtagonist: {
      ...protagonist,
      silver: protagonist.silver + resale,
      playerMorality: clamp((protagonist.playerMorality ?? 10) - 5, -100, 100),
      contacts: contacts.filter((c) => c.id !== contactId),
      npcMoments: appendNpcMoment(
        protagonist.npcMoments,
        createNpcMomentRecord({
          npcId: target.id,
          npcName: target.name,
          npcRole: target.role,
          timestamp: ts,
          timestampMs: gameTimeMs,
          locationLabel: location.name,
          category: 'Kölelik / Azat',
          title: `${target.name} Köle Pazarında Devredildi`,
          summary: msg,
          significance: 'kritik',
          isMilestone: true,
          milestoneLabel: 'Bağlılık Devri',
        })
      ),
      lastObservation: msg,
      journal: pushJournal(protagonist.journal, {
        id: `pj-sres-${Date.now()}`,
        timestamp: ts,
        kind: 'Eylem',
        locationLabel: location.name,
        title: 'Bağlı Köle Devri',
        detail: msg,
      }),
    },
    message: msg,
  };
}

export function freeBondedRetainer(
  protagonist: ProtagonistState,
  contactId: string,
  gameTimeMs: number
): { nextProtagonist: ProtagonistState; message: string } {
  const contacts = protagonist.contacts ?? [];
  const target = contacts.find((c) => c.id === contactId);
  if (!target || !target.isBonded) {
    return { nextProtagonist: protagonist, message: 'Bu kişi zaten özgür.' };
  }

  const ts = formatGameDateTime(gameTimeMs);
  const msg = `${target.name} için azat mührünü kırdın! Artık özgür ve sana minnet duyuyor (+8 Ahlak, +28 Güven).`;

  const nextContacts = contacts.map((c) =>
    c.id === contactId
      ? {
          ...c,
          isBonded: false,
          role: c.role.replace(' (Bağlı Köle)', ''),
          partyRelation: 'independent' as const,
          dailyWageSilver: Math.max(2, c.dailyWageSilver),
          trust: clamp(c.trust + 28, 0, 100),
          affection: clamp(c.affection + 16, -100, 100),
          mood: 'Minnettar' as const,
          openToRomance: true,
          lastIntent: 'Samimi Dostluk' as const,
          lastReaction: 'Zinciri ve borç senedini açtığın için gözleri doldu; artık kendi iradesiyle dostun.',
          memoryNotes: [`${ts}: Tarafından azat edilip özgürlüğüne kavuştu.`, ...c.memoryNotes].slice(0, 8),
        }
      : c
  );

  return {
    nextProtagonist: {
      ...protagonist,
      playerMorality: clamp((protagonist.playerMorality ?? 10) + 8, -100, 100),
      contacts: nextContacts,
      npcMoments: appendNpcMoment(
        protagonist.npcMoments,
        createNpcMomentRecord({
          npcId: target.id,
          npcName: target.name,
          npcRole: target.role.replace(' (Bağlı Köle)', ''),
          timestamp: ts,
          timestampMs: gameTimeMs,
          locationLabel: `Mazgal ${protagonist.mazgalId}`,
          category: 'Kölelik / Azat',
          title: `${target.name} Azat Edildi ve Özgürleşti`,
          summary: msg,
          trustDelta: 28,
          trustAfter: clamp(target.trust + 28, 0, 100),
          affectionDelta: 16,
          moodAfter: 'Minnettar',
          significance: 'kritik',
          isMilestone: true,
          milestoneLabel: 'Özgürlük ve Minnet',
        })
      ),
      lastObservation: msg,
      journal: pushJournal(protagonist.journal, {
        id: `pj-free-${Date.now()}`,
        timestamp: ts,
        kind: 'Eylem',
        locationLabel: `Mazgal ${protagonist.mazgalId}`,
        title: 'Köle Azat Edildi',
        detail: msg,
      }),
    },
    message: msg,
  };
}

// ==========================================
// 8. SETTLEMENT PROBLEM CHECK, AUTONOMOUS WEATHER & ROAMING UNITS
// ==========================================

export function resolveSettlementProblemAttempt(
  protagonist: ProtagonistState,
  location: MapLocation | undefined,
  problemId: string,
  cell: MazgalCell,
  nextTimeMs: number
): {
  nextProtagonist: ProtagonistState;
  solved: boolean;
  message: string;
} {
  if (!location || !location.livingState) {
    return { nextProtagonist: protagonist, solved: false, message: 'Geçerli yerleşim bulunamadı.' };
  }
  const prob = location.livingState.activeProblems.find((p) => p.id === problemId);
  if (!prob) {
    return { nextProtagonist: protagonist, solved: false, message: 'Bu sorun zaten çözülmüş.' };
  }

  const ts = formatGameDateTime(nextTimeMs);
  const faction = getFactionForLocation(location);
  const mods = getProtagonistModifiers(protagonist, location, cell);
  const eq = getEquipmentBonuses(protagonist.inventory ?? []);

  const dc = prob.severity === 'Yüksek' ? 15 : prob.severity === 'Orta' ? 13 : 11;
  const bestMod = Math.max(mods.physicalMod, mods.socialMod, mods.perceptionMod);
  const d20 = rollDie(20);
  const total = d20 + bestMod;
  const solved = d20 === 20 || (d20 !== 1 && total >= dc);

  let health = protagonist.health;
  let stamina = Math.max(5, protagonist.stamina - 12);
  let silver = protagonist.silver;
  let playerMorality = protagonist.playerMorality ?? 10;
  const reputation = { ...protagonist.reputation };
  let message = '';

  if (solved) {
    const reward = prob.severity === 'Yüksek' ? 14 : prob.severity === 'Orta' ? 10 : 7;
    silver += reward;
    playerMorality = clamp(playerMorality + 4, -100, 100);
    reputation[faction] = clamp((reputation[faction] ?? 0) + 8, -100, 100);
    message = `[Zar ${d20}${bestMod >= 0 ? `+${bestMod}` : bestMod}=${total} ≥ DC ${dc}] "${prob.title}" krizini çözdün! (+${reward} Gümüş, +8 ${FACTION_LABELS[faction]} İtibarı)`;
  } else {
    const dmg = Math.max(2, rollDie(6) + 3 - eq.armorReduction);
    health = Math.max(5, health - dmg);
    stamina = Math.max(5, stamina - 6);
    reputation[faction] = clamp((reputation[faction] ?? 0) - 2, -100, 100);
    message = `[Zar ${d20}${bestMod >= 0 ? `+${bestMod}` : bestMod}=${total} < DC ${dc}] "${prob.title}" müdahalesinde zorlandın (-${dmg} Can, -18 Zindelik); sorun hâlâ sürüyor.`;
  }

  return {
    nextProtagonist: {
      ...protagonist,
      health,
      stamina,
      silver,
      playerMorality,
      reputation,
      mood: computeProtagonistMood(health, stamina, protagonist.hunger, cell.safetyScore),
      lastObservation: message,
      lastUpdatedMs: nextTimeMs,
      journal: pushJournal(protagonist.journal, {
        id: `pj-prob-${Date.now()}`,
        timestamp: ts,
        kind: 'Eylem',
        locationLabel: location.name,
        title: solved ? `${prob.title} Çözüldü` : `${prob.title} Başarısız Müdahale`,
        detail: message,
      }),
    },
    solved,
    message,
  };
}

const WEATHER_LABELS: Record<WeatherConditionKey, string> = {
  clear: 'Açık / Soğuk Rüzgar',
  mist: 'Yoğun Doğu Sisi',
  rain: 'Soğuk Orman Yağmuru',
  storm: 'Sert Vadi Fırtınası',
};

export interface WeatherContextHint {
  terrain?: MazgalCell['terrain'];
  safetyScore?: number;
  inSettlement?: boolean;
}

function pickWeightedWeather(weights: Record<WeatherConditionKey, number>): WeatherConditionKey {
  const entries = Object.entries(weights) as Array<[WeatherConditionKey, number]>;
  const total = entries.reduce((acc, [, w]) => acc + Math.max(0, w), 0);
  if (total <= 0) return 'mist';
  let roll = Math.random() * total;
  for (const [key, w] of entries) {
    roll -= Math.max(0, w);
    if (roll <= 0) return key;
  }
  return 'mist';
}

export function advanceRegionalWeatherWithTime(
  currentWeather: WeatherConditionKey,
  activeWave: WorldWave | null | undefined,
  prevTimeMs: number,
  nextTimeMs: number,
  context?: WeatherContextHint
): { nextWeather: WeatherConditionKey; weatherNotice?: string } {
  if (nextTimeMs <= prevTimeMs) {
    return { nextWeather: currentWeather };
  }

  const prevSlot = Math.floor((prevTimeMs - INITIAL_GAME_TIME_MS) / (12 * 60 * 60 * 1000));
  const nextSlot = Math.floor((nextTimeMs - INITIAL_GAME_TIME_MS) / (12 * 60 * 60 * 1000));
  const crossedSlot = nextSlot > prevSlot;
  const hoursElapsed = Math.max(0, (nextTimeMs - prevTimeMs) / (60 * 60 * 1000));
  const terrain = context?.terrain;
  const highExposureTerrain =
    terrain === 'mountain' ||
    terrain === 'sea' ||
    terrain === 'lake' ||
    terrain === 'coast' ||
    terrain === 'marsh';

  if (!crossedSlot && hoursElapsed < 0.4) {
    return { nextWeather: currentWeather };
  }

  if (activeWave?.kind === 'Sis Fırtınası') {
    const waveShiftProb = currentWeather === 'clear' ? 0.78 : crossedSlot ? 0.5 : 0.28;
    if (Math.random() < waveShiftProb) {
      const nextW: WeatherConditionKey =
        currentWeather === 'storm' && Math.random() < 0.45
          ? 'mist'
          : currentWeather === 'mist' && Math.random() < 0.35
          ? 'storm'
          : 'mist';
      if (nextW !== currentWeather) {
        return {
          nextWeather: nextW,
          weatherNotice: `Sis Fırtınası dalgası gökyüzünü kapladı: ${WEATHER_LABELS[nextW]}.`,
        };
      }
    }
    return { nextWeather: currentWeather };
  }

  let shiftChance = crossedSlot
    ? 0.58
    : hoursElapsed >= 6
    ? 0.44
    : hoursElapsed >= 2
    ? 0.3
    : hoursElapsed >= 1
    ? 0.18
    : 0.08;
  if (highExposureTerrain) {
    shiftChance = Math.min(0.82, shiftChance + 0.1);
  }

  if (Math.random() > shiftChance) {
    return { nextWeather: currentWeather };
  }

  const phase = getDayPhaseLabel(nextTimeMs);
  const weights: Record<WeatherConditionKey, number> = {
    clear: phase === 'Öğle' ? 38 : phase === 'Sabah' || phase === 'Gece' ? 18 : 26,
    mist: phase === 'Sabah' || phase === 'Gece' || phase === 'Akşam' ? 44 : 28,
    rain: 22,
    storm: 10,
  };

  if (terrain === 'mountain') {
    weights.clear -= 10;
    weights.mist += 8;
    weights.rain += 6;
    weights.storm += 14;
  } else if (terrain === 'sea' || terrain === 'coast') {
    weights.clear -= 6;
    weights.mist += 10;
    weights.rain += 8;
    weights.storm += 10;
  } else if (terrain === 'lake' || terrain === 'river' || terrain === 'marsh') {
    weights.clear -= 8;
    weights.mist += 18;
    weights.rain += 8;
  } else if (terrain === 'forest') {
    weights.clear -= 6;
    weights.mist += 14;
    weights.rain += 6;
  } else if (terrain === 'plain' || terrain === 'road') {
    weights.clear += 12;
    weights.mist -= 6;
    weights.storm -= 4;
  }

  if (typeof context?.safetyScore === 'number' && context.safetyScore <= 38) {
    weights.clear -= 6;
    weights.mist += 8;
    weights.storm += 6;
  }

  if (activeWave?.kind === 'Eşkıya İttifakı' || activeWave?.kind === 'Goblin Akını') {
    weights.clear -= 8;
    weights.rain += 8;
    weights.storm += 6;
  } else if (activeWave?.kind === 'Ticaret Şenliği') {
    weights.clear += 10;
    weights.storm -= 4;
  }

  // Slight inertia so weather doesn't jump unnaturally back and forth
  weights[currentWeather] = Math.max(4, Math.round(weights[currentWeather] * 0.45));

  const nextW = pickWeightedWeather(weights);
  if (nextW === currentWeather) {
    return { nextWeather: currentWeather };
  }

  const reasonPrefix =
    terrain === 'mountain' && nextW === 'storm'
      ? 'Yüksek geçitlerde rüzgar sertleşti'
      : (terrain === 'forest' || terrain === 'marsh' || terrain === 'lake') && nextW === 'mist'
      ? 'Nemli zemin ve su kıyısı sis topladı'
      : nextW === 'clear'
      ? 'Bulutlar aralandı'
      : 'Hava duruma göre değişti';

  return {
    nextWeather: nextW,
    weatherNotice: `${reasonPrefix}: ${WEATHER_LABELS[nextW]}.`,
  };
}

export function createInitialRoamingUnits(locations: MapLocation[]): WorldRoamingUnit[] {
  const pickLoc = (id: string) => locations.find((l) => l.id === id) ?? locations[0];
  const defs: {
    id: string;
    name: string;
    kind: WorldRoamingUnit['kind'];
    faction: FactionKey;
    fromId: string;
    toId: string;
    strength: number;
    cargoOrHook: string;
  }[] = [
    {
      id: 'roam-kulkoy-patrol',
      name: 'Külköy Atlı Devriyesi',
      kind: 'patrol',
      faction: 'border_human',
      fromId: 'loc-kuldere',
      toId: 'loc-gumus-kopru',
      strength: 3,
      cargoOrHook: 'Garnizon geçiş mühürleri ve yol güvenliği raporu',
    },
    {
      id: 'roam-wool-caravan',
      name: 'Kulova–Külköy Yün Kervanı',
      kind: 'caravan',
      faction: 'border_human',
      fromId: 'loc-kulova-koyu',
      toId: 'loc-kuldere',
      strength: 2,
      cargoOrHook: 'Yün balyası, tuzlu et ve taze köy dedikoduları',
    },
    {
      id: 'roam-timber-convoy',
      name: 'Derebaşı Kereste Katarı',
      kind: 'caravan',
      faction: 'border_human',
      fromId: 'loc-derebasi-koyu',
      toId: 'loc-kuldere',
      strength: 2,
      cargoOrHook: 'Sur onarım kerestesi ve meşale reçinesi',
    },
    {
      id: 'roam-elf-scouts',
      name: 'Yüksekçam Sınır Gözcüleri',
      kind: 'scout',
      faction: 'elf',
      fromId: 'loc-elf-koyu',
      toId: 'loc-sisli-gecit',
      strength: 3,
      cargoOrHook: 'Sis pelerini, okçu işareti ve kuzey yolu istihbaratı',
    },
    {
      id: 'roam-bandit-raiders',
      name: 'Kuzey Yolu Haydut Müfrezesi',
      kind: 'raider',
      faction: 'outlaws',
      fromId: 'loc-haydut-kampi',
      toId: 'loc-gumus-kopru',
      strength: 4,
      cargoOrHook: 'Çalıntı kervan sandıkları ve fidye mektupları',
    },
    {
      id: 'roam-goblin-raiders',
      name: 'Paslıçukur Goblin Akıncıları',
      kind: 'raider',
      faction: 'goblinoids',
      fromId: 'loc-goblin-ini',
      toId: 'loc-kulova-koyu',
      strength: 3,
      cargoOrHook: 'Hurda silahlar, paslı tuzaklar ve yağma torbaları',
    },
  ];

  return defs.map((d) => {
    const start = pickLoc(d.fromId);
    const dest = pickLoc(d.toId);
    const cell = start ? getCellForCoords(start.x, start.y) : { id: 'B5' };
    return {
      id: d.id,
      name: d.name,
      kind: d.kind,
      faction: d.faction,
      currentLocationId: start?.id ?? d.fromId,
      destinationLocationId: dest?.id ?? d.toId,
      mazgalId: cell.id,
      x: start?.x ?? 12,
      y: start?.y ?? 55,
      strength: d.strength,
      cargoOrHook: d.cargoOrHook,
      statusNote: `${start?.name ?? d.fromId} noktasından ${dest?.name ?? d.toId} yönüne harekete hazır.`,
      lastMovedMs: INITIAL_GAME_TIME_MS,
    };
  });
}

function getNextDestinationForUnit(
  unit: WorldRoamingUnit,
  currentLocId: string,
  locations: MapLocation[],
  routes: MapRoute[]
): string {
  const connected = routes
    .filter((r) => r.fromId === currentLocId || r.toId === currentLocId)
    .map((r) => (r.fromId === currentLocId ? r.toId : r.fromId));

  const poolByKind: Record<WorldRoamingUnit['kind'], string[]> = {
    patrol: ['loc-kuldere', 'loc-gumus-kopru', 'loc-kulova-koyu', 'loc-derebasi-koyu'],
    caravan: ['loc-kuldere', 'loc-kulova-koyu', 'loc-derebasi-koyu', 'loc-gumus-kopru'],
    scout: ['loc-elf-koyu', 'loc-sisli-gecit', 'loc-derebasi-koyu', 'loc-kurt-kayaligi'],
    raider:
      unit.faction === 'goblinoids'
        ? ['loc-goblin-ini', 'loc-kulova-koyu', 'loc-kurt-kayaligi', 'loc-sisli-gecit']
        : ['loc-haydut-kampi', 'loc-gumus-kopru', 'loc-kacakci-koyu', 'loc-sisli-gecit'],
  };

  const preferred = poolByKind[unit.kind].filter((id) => id !== currentLocId);
  const validConnected = connected.filter((id) => preferred.includes(id));
  const candidates =
    validConnected.length > 0
      ? validConnected
      : preferred.filter((id) => locations.some((l) => l.id === id));

  if (candidates.length === 0) return currentLocId;
  return candidates[Math.floor(Math.random() * candidates.length)];
}

export interface RoamingArrivalEvent {
  locationId: string;
  unitName: string;
  unitKind: 'patrol' | 'caravan' | 'raider' | 'scout';
  detail: string;
  moraleDelta: number;
  spawnRaid: boolean;
}

export function advanceRoamingUnitsWithTime(
  units: WorldRoamingUnit[],
  locations: MapLocation[],
  routes: MapRoute[],
  prevTimeMs: number,
  nextTimeMs: number
): {
  nextUnits: WorldRoamingUnit[];
  nextLocations: MapLocation[];
  arrivals: RoamingArrivalEvent[];
  notices: string[];
} {
  const STEP_MS = 6 * 60 * 60 * 1000; // Every 6 hours roaming units advance 1 leg (road <-> settlement)
  const prevStep = Math.floor((prevTimeMs - INITIAL_GAME_TIME_MS) / STEP_MS);
  const nextStep = Math.floor((nextTimeMs - INITIAL_GAME_TIME_MS) / STEP_MS);
  if (nextStep <= prevStep || units.length === 0) {
    return { nextUnits: units, nextLocations: locations, arrivals: [], notices: [] };
  }

  let updatedLocations = locations;
  const arrivals: RoamingArrivalEvent[] = [];
  const notices: string[] = [];

  const nextUnits = units.map((unit) => {
    const dest = updatedLocations.find((l) => l.id === unit.destinationLocationId);
    const curr = updatedLocations.find((l) => l.id === unit.currentLocationId);
    if (!dest) return unit;

    // If currently at a settlement (x/y matches currentLocationId), first move to route midpoint (en route)
    const isAtCurrentLoc =
      curr && Math.hypot(unit.x - curr.x, unit.y - curr.y) < 1.5;

    if (isAtCurrentLoc && dest.id !== curr.id) {
      const midX = Number(((curr.x + dest.x) / 2).toFixed(1));
      const midY = Number(((curr.y + dest.y) / 2).toFixed(1));
      const cell = getCellForCoords(midX, midY);
      return {
        ...unit,
        x: midX,
        y: midY,
        mazgalId: cell.id,
        statusNote: `${curr.name} → ${dest.name} yolunda ilerliyor (Mazgal ${cell.id}).`,
        lastMovedMs: nextTimeMs,
      };
    }

    // Arrive at destination!
    const destCell = getCellForCoords(dest.x, dest.y);
    let arrivalDetail = '';
    let moraleDelta = 0;
    let spawnRaid = false;

    if (unit.kind === 'caravan') {
      moraleDelta = 3;
      arrivalDetail = `${unit.name}, ${dest.name} meydanına erzak ve takas yükü getirdi (+3 Moral).`;
    } else if (unit.kind === 'patrol' || unit.kind === 'scout') {
      moraleDelta = 2;
      arrivalDetail = `${unit.name}, ${dest.name} çevresinde devriye turunu tamamladı (+2 Moral).`;
    } else {
      moraleDelta = dest.category === 'village' ? -4 : 0;
      spawnRaid = dest.category === 'village' && Math.random() < 0.45;
      arrivalDetail =
        dest.category === 'village'
          ? `${unit.name} ${dest.name} dış mahallesine sızıp gerginlik yarattı (${moraleDelta} Moral).`
          : `${unit.name} ${dest.name} yakınlarında gözcülük yapıyor.`;
    }

    if (dest.livingState?.enabled && moraleDelta !== 0) {
      arrivals.push({
        locationId: dest.id,
        unitName: unit.name,
        unitKind: unit.kind,
        detail: arrivalDetail,
        moraleDelta,
        spawnRaid,
      });
      updatedLocations = updatedLocations.map((l) =>
        l.id === dest.id
          ? recordRoamingArrivalOnLocation(
              l,
              unit.name,
              unit.kind,
              arrivalDetail,
              moraleDelta,
              nextTimeMs,
              spawnRaid
            )
          : l
      );
      if (unit.kind === 'raider' && spawnRaid) {
        notices.push(`${unit.name} ${dest.name} yakınına sızdı!`);
      }
    }

    const nextDestId = getNextDestinationForUnit(unit, dest.id, updatedLocations, routes);
    const nextDestName = updatedLocations.find((l) => l.id === nextDestId)?.name ?? nextDestId;

    return {
      ...unit,
      currentLocationId: dest.id,
      destinationLocationId: nextDestId,
      mazgalId: destCell.id,
      x: dest.x,
      y: dest.y,
      statusNote: `${dest.name} noktasında mola verdi; sonraki rota: ${nextDestName}.`,
      lastMovedMs: nextTimeMs,
    };
  });

  return { nextUnits, nextLocations: updatedLocations, arrivals, notices };
}

export function interactWithRoamingUnit(
  protagonist: ProtagonistState,
  unitId: string,
  mode: 'greet_trade' | 'escort_aid' | 'ambush_raid',
  cell: MazgalCell,
  nextTimeMs: number
): { nextProtagonist: ProtagonistState; message: string } {
  const units = protagonist.roamingUnits ?? [];
  const unit = units.find((u) => u.id === unitId);
  if (!unit) {
    return { nextProtagonist: protagonist, message: 'Bu hareketli birlik artık yakında değil.' };
  }

  const ts = formatGameDateTime(nextTimeMs);
  const mods = getProtagonistModifiers(protagonist, undefined, cell);
  const eq = getEquipmentBonuses(protagonist.inventory ?? []);

  let health = protagonist.health;
  let stamina = Math.max(5, protagonist.stamina - 8);
  let silver = protagonist.silver;
  let rations = protagonist.rations;
  let playerMorality = protagonist.playerMorality ?? 10;
  let bountySilver = protagonist.bountySilver ?? 0;
  const bountyFactions = [...(protagonist.bountyFactions ?? [])];
  let capturedCaptives = protagonist.capturedCaptives ?? 0;
  const reputation = { ...protagonist.reputation };
  let message = '';

  if (mode === 'greet_trade') {
    if (unit.kind === 'raider') {
      const d20 = rollDie(20) + mods.socialMod;
      if (d20 >= 13) {
        reputation[unit.faction] = clamp((reputation[unit.faction] ?? 0) + 4, -100, 100);
        rations += 1;
        message = `[Zar ${d20}] ${unit.name} ile soğukkanlı bir takas/parola alışverişi yaptın (+1 Erzak, +4 ${FACTION_LABELS[unit.faction]} İtibarı).`;
      } else {
        const bribe = Math.min(silver, 5);
        silver -= bribe;
        message = `[Zar ${d20}] ${unit.name} seni sıkıştırdı; ${bribe} Gümüş geçiş payı verip ayrıldın.`;
      }
    } else {
      rations += 1;
      reputation[unit.faction] = clamp((reputation[unit.faction] ?? 0) + 3, -100, 100);
      message = `${unit.name} ile yol haberlerini paylaştın; ikram olarak +1 Erzak ve +3 ${FACTION_LABELS[unit.faction]} İtibarı aldın.`;
    }
  } else if (mode === 'escort_aid') {
    const d20 = rollDie(20) + mods.perceptionMod;
    if (unit.kind === 'raider') {
      playerMorality = clamp(playerMorality - 5, -100, 100);
      reputation[unit.faction] = clamp((reputation[unit.faction] ?? 0) + 6, -100, 100);
      silver += 8;
      message = `${unit.name} birliğine sahte yol gözcülüğü yaptın (+8 Gümüş, +6 Yeraltı İtibarı, -5 Ahlak).`;
    } else if (d20 >= 11) {
      const pay = 6 + unit.strength * 2;
      silver += pay;
      playerMorality = clamp(playerMorality + 4, -100, 100);
      reputation[unit.faction] = clamp((reputation[unit.faction] ?? 0) + 6, -100, 100);
      message = `[Zar ${d20}] ${unit.name} koluna bir süre eşlik edip yolu kolladın (+${pay} Gümüş, +6 İtibar).`;
    } else {
      reputation[unit.faction] = clamp((reputation[unit.faction] ?? 0) + 2, -100, 100);
      message = `[Zar ${d20}] ${unit.name} ile birlikte yürüdün ama kayda değer bir tehdit çıkmadı (+2 İtibar).`;
    }
  } else {
    // ambush_raid
    const dc = 11 + unit.strength;
    const d20 = rollDie(20) + mods.physicalMod;
    const won = d20 >= dc;
    if (unit.kind !== 'raider') {
      playerMorality = clamp(playerMorality - 10, -100, 100);
      reputation[unit.faction] = clamp((reputation[unit.faction] ?? 0) - 18, -100, 100);
      bountySilver += 16;
      if (!bountyFactions.includes(unit.faction)) bountyFactions.push(unit.faction);
    }
    if (won) {
      const loot = 9 + unit.strength * 3;
      silver += loot;
      rations += 2;
      if (unit.kind === 'raider' && Math.random() < 0.65) {
        capturedCaptives += 1;
        message = `[Zar ${d20} ≥ DC ${dc}] ${unit.name} birliğini dağıttın! (+${loot} Gümüş, +2 Erzak, +1 Esir Tutsak)`;
      } else {
        message = `[Zar ${d20} ≥ DC ${dc}] ${unit.name} baskınını başarıyla tamamladın (+${loot} Gümüş, +2 Erzak).`;
      }
      if (unit.kind === 'raider') {
        reputation.border_human = clamp((reputation.border_human ?? 0) + 6, -100, 100);
      }
    } else {
      const dmg = Math.max(4, 8 + unit.strength * 2 - eq.armorReduction);
      health = Math.max(4, health - dmg);
      message = `[Zar ${d20} < DC ${dc}] ${unit.name} karşılık verdi! Yaralanarak geri çekildin (-${dmg} Can).`;
    }
  }

  return {
    nextProtagonist: {
      ...protagonist,
      health,
      stamina,
      silver,
      rations,
      playerMorality,
      bountySilver,
      bountyFactions,
      capturedCaptives,
      reputation,
      mood: computeProtagonistMood(health, stamina, protagonist.hunger, cell.safetyScore),
      lastObservation: message,
      lastUpdatedMs: nextTimeMs,
      journal: pushJournal(protagonist.journal, {
        id: `pj-roam-${Date.now()}`,
        timestamp: ts,
        kind: 'Karşılaşma',
        locationLabel: `Mazgal ${cell.id}`,
        title: `${unit.name} Etkileşimi`,
        detail: message,
      }),
    },
    message,
  };
}

