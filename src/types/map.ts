export type LocationCategory = 'village' | 'ruin' | 'nature' | 'danger' | 'crossing' | 'burrow';

export type ActiveTab = 'map' | 'chronicle' | 'encounters' | 'gm';

export type SettlementMood = 'Mutlu' | 'Huzurlu' | 'Temkinli' | 'Endişeli' | 'Korkulu';

export interface SettlementProblem {
  id: string;
  templateId: string;
  title: string;
  description: string;
  severity: 'Düşük' | 'Orta' | 'Yüksek';
  startedAt: string;
  attempts: number;
}

export interface SettlementResident {
  id: string;
  name: string;
  role: string;
  trait: string;
  renownNote: string;
  addedAt: string;
  familyStatus?: string;
}

export interface SettlementEventRecord {
  id: string;
  timestamp: string;
  kind: 'Olay' | 'Dedikodu' | 'Sorun' | 'Çözüm' | 'Nam' | 'Yaşam';
  title: string;
  detail: string;
  moodImpact: number;
  questHook?: string;
}

export type SettlementArchetype =
  | 'border_fortress'
  | 'shepherd_village'
  | 'lumber_village'
  | 'bandit_hamlet'
  | 'elf_canopy'
  | 'beastkin_clan'
  | 'goblin_burrow'
  | 'river_crossing'
  | 'mist_ruin'
  | 'smuggler_cove'
  | 'wild_nature';

export interface SettlementLivingState {
  enabled: boolean;
  archetype: SettlementArchetype;
  lastSimulatedMs: number;
  lastProblemTick: number;
  lastRumorTick: number;
  lastMilestoneTick: number;
  populationEstimate: number;
  unitLabel?: string;
  morale: number;
  mood: SettlementMood;
  establishments: string[];
  activeProblems: SettlementProblem[];
  rumors: string[];
  notableResidents: SettlementResident[];
  chronicle: SettlementEventRecord[];
  dynamicHooks: string[];
}

export interface MapLocation {
  id: string;
  name: string;
  subtitle: string;
  category: LocationCategory;
  x: number; // percentage 0-100
  y: number; // percentage 0-100
  dangerLevel: 1 | 2 | 3 | 4 | 5;
  travelTime: string;
  discovered: boolean;
  isCustom?: boolean;
  imageUrl?: string;
  playerLore: string;
  gmSecret: string;
  hooks: string[];
  npcsOrFoes: string[];
  loot: string[];
  livingState?: SettlementLivingState;
}

export interface MapRoute {
  id: string;
  fromId: string;
  toId: string;
  name: string;
  travelHours: number;
  hazard: string;
}

export interface ForestEncounter {
  id: string;
  rollRange: string;
  title: string;
  type: 'Savaş' | 'Gizem' | 'Karşılaşma' | 'Doğa Olayı';
  threat: string;
  hp: number;
  defense: number;
  weakness: string;
  description: string;
  tactic: string;
  reward: string;
}

export interface MistWeather {
  id: string;
  name: string;
  visibility: string;
  effect: string;
}

export interface JourneyLogEntry {
  id: string;
  locationId: string;
  locationName: string;
  timestamp: string;
  note: string;
}

export type MazgalTerrain =
  | 'plain'
  | 'road'
  | 'forest'
  | 'deep_forest'
  | 'mountain'
  | 'river'
  | 'marsh'
  | 'lake'
  | 'coast'
  | 'sea';

export interface MazgalNeighborSummary {
  direction: string;
  id: string;
  terrainLabel: string;
  safetyScore: number;
  travelHours: number;
  travelLabel: string;
  distanceFersah: number;
  requiresBoat?: 'lake' | 'sea';
  transitionNote: string;
}

export interface MazgalCell {
  id: string;
  col: number;
  row: number;
  terrain: MazgalTerrain;
  terrainLabel: string;
  imageUrl: string;
  centerX: number;
  centerY: number;
  locationsInside: MapLocation[];
  safetyScore: number;
  dangerLevel: 1 | 2 | 3 | 4 | 5;
  travelSpeedLabel: string;
  scaleFersah: number;
  crossingHours: number;
  crossingLabel: string;
  easternBeltLabel: string;
  visibilityMeters: number;
  resourceYield: string;
  summary: string;
  neighborEffects: string[];
  neighbors: MazgalNeighborSummary[];
}

export type ProtagonistMood = 'Dinç' | 'Temkinli' | 'Yorgun' | 'Gergin' | 'Yaralı';

export type FactionKey =
  | 'border_human'
  | 'elf'
  | 'beastkin'
  | 'goblinoids'
  | 'outlaws';

export type ProtagonistActionType =
  | 'observe'
  | 'converse'
  | 'forage_or_work'
  | 'help_settlement'
  | 'rest_camp';

export interface ProtagonistEventRecord {
  id: string;
  timestamp: string;
  kind: 'Gözlem' | 'Konuşma' | 'Yolculuk' | 'Eylem' | 'Karşılaşma' | 'Durum';
  locationLabel: string;
  title: string;
  detail: string;
}

export type NpcTemperament =
  | 'Dürüst'
  | 'Şefkatli'
  | 'Erdemli'
  | 'Çıkarcı'
  | 'Kurnaz'
  | 'Acımasız'
  | 'Gözüpek'
  | 'Romantik';

export type NpcIntent =
  | 'Samimi Dostluk'
  | 'Acıyor ve Kolluyor'
  | 'Gizlice Kolluyor'
  | 'Kendi Canını Feda Eder'
  | 'Seni Kullanmaya Çalışıyor'
  | 'Kandırma Peşinde'
  | 'Zorbalık ve Şantaj'
  | 'İftira ve Kumpas'
  | 'Gasp ve İhanet'
  | 'Ticari Çıkar / Ücret'
  | 'Romantik İlgi'
  | 'Kuşkulu Mesafe';

export type NpcRomanceStatus =
  | 'Yok'
  | 'Flört / Yakınlık'
  | 'Sevgili / Bağlı'
  | 'Karşılıksız İlgi'
  | 'Kırgın / Mesafeli';

export type NpcPartyRelation =
  | 'independent'
  | 'companion'
  | 'hired_by_player'
  | 'hired_player'
  | 'party_leader';

export type PartyModeType =
  | 'solo'
  | 'leading'
  | 'hired_mercenary'
  | 'joined_party';

export type InventoryItemId =
  | 'rust_sword'
  | 'iron_blade'
  | 'leather_armor'
  | 'healing_herb'
  | 'antidote_vial'
  | 'torch_bundle'
  | 'wool_bale'
  | 'timber_crate'
  | 'smuggler_salt'
  | 'elven_cloak'
  | 'trail_map';

export interface InventoryItem {
  id: InventoryItemId;
  name: string;
  category: 'Silah/Zırh' | 'Tüketim' | 'Ticaret Malı' | 'Teçhizat';
  qty: number;
  basePrice: number;
  physBonus?: number;
  percBonus?: number;
  socBonus?: number;
  armorReduction?: number;
  description: string;
}

export interface ActiveContract {
  id: string;
  title: string;
  description: string;
  originLocationId: string;
  originLocationName: string;
  targetLocationId: string;
  targetLocationName: string;
  faction: FactionKey;
  kind: 'Kargo / Takas' | 'Keşif / İz' | 'Eskort / Devriye' | 'Kurtarma / Fidye';
  requiredItemId?: InventoryItemId;
  requiredItemQty?: number;
  rewardSilver: number;
  repReward: number;
  deadlineMs: number;
  createdAt: string;
  status: 'active' | 'completed' | 'failed';
}

export type WorldWaveKind =
  | 'Sis Fırtınası'
  | 'Goblin Akını'
  | 'Ticaret Şenliği'
  | 'Kıtlık Dalgası'
  | 'Eşkıya İttifakı';

export interface WorldWave {
  id: string;
  kind: WorldWaveKind;
  title: string;
  description: string;
  affectedFactions: FactionKey[];
  startMs: number;
  endMs: number;
  priceMultiplier: number;
  dangerShift: number;
  moraleShiftPerDay: number;
}

export type NpcMood =
  | 'Sadık / Huzurlu'
  | 'Neşeli / İstekli'
  | 'Minnettar'
  | 'Romantik / Etkilenmiş'
  | 'Temkinli'
  | 'Gergin / Kuşkulu'
  | 'Kırgın / Mesafeli'
  | 'Baskı Altında / Çekingen'
  | 'Öfkeli / Düşmanca';

export interface LivingNpcContact {
  id: string;
  name: string;
  role: string;
  cultureLabel: string;
  faction: FactionKey;
  trait: string;
  motive: string;
  temperament: NpcTemperament;
  morality?: number; // -100 (tamamen yozlaşmış / acımasız) .. +100 (özverili / erdemli)
  trust: number; // 0-100 Güven Skalası
  affection: number;
  mood?: NpcMood;
  romanceStatus: NpcRomanceStatus;
  partyRelation: NpcPartyRelation;
  dailyWageSilver: number;
  combatBonus: number;
  scoutBonus: number;
  socialBonus: number;
  currentLocationId: string | null;
  currentMazgalId: string;
  homeLocationId: string | null;
  openToRomance: boolean;
  lastIntent: NpcIntent;
  lastReaction: string;
  intentSuspected: boolean;
  stoleFromPlayerSilver?: number;
  isWantedByPlayer?: boolean;
  isBonded?: boolean;
  metAt: string;
  lastUpdatedMs: number;
  memoryNotes: string[];
}

export type NpcMomentCategory =
  | 'Tanışma'
  | 'Sohbet'
  | 'Yakınlaşma / Aşk'
  | 'Yüzleşme'
  | 'İhanet / Gasp'
  | 'Yardım / Fedakârlık'
  | 'Parti / Sözleşme'
  | 'Kölelik / Azat';

export interface NpcMemoryMoment {
  id: string;
  npcId: string;
  npcName: string;
  npcRole: string;
  timestamp: string;
  timestampMs: number;
  locationLabel: string;
  category: NpcMomentCategory;
  title: string;
  summary: string;
  trustDelta?: number;
  trustAfter?: number;
  affectionDelta?: number;
  moodAfter?: NpcMood;
  significance: 'kritik' | 'önemli' | 'olağan';
  isMilestone?: boolean;
  milestoneLabel?: string;
}

export type TravelPace = 'stealth' | 'normal' | 'forced';
export type TravelTransport = 'foot' | 'mule' | 'boat';
export type WeatherConditionKey = 'clear' | 'mist' | 'rain' | 'storm';

export type RoamingUnitKind = 'patrol' | 'caravan' | 'raider' | 'scout';

export interface WorldRoamingUnit {
  id: string;
  name: string;
  kind: RoamingUnitKind;
  faction: FactionKey;
  currentLocationId: string;
  destinationLocationId: string;
  mazgalId: string;
  x: number;
  y: number;
  strength: number;
  cargoOrHook: string;
  statusNote: string;
  lastMovedMs: number;
}

export interface ProtagonistState {
  name: string;
  title: string;
  appearanceNote?: string;
  locationId: string | null; // null if standing on open mazgal terrain between locations
  mazgalId: string;
  x: number;
  y: number;
  health: number; // 0-100
  stamina: number; // 0-100
  hunger: number; // 0-100 (0 = tok, 100 = açlık)
  rations: number;
  silver: number;
  mood: ProtagonistMood;
  playerMorality?: number; // -100 (yozlaşmış/gaspçı) .. +100 (erdemli/kahraman)
  bountySilver?: number;
  bountyFactions?: FactionKey[];
  injuries?: string[];
  inventory?: InventoryItem[];
  contracts?: ActiveContract[];
  activeWorldWave?: WorldWave | null;
  reputation: Record<FactionKey, number>; // -100 to +100
  activeConditions: string[];
  marks: string[];
  lastObservation: string;
  lastDialogue: string;
  journal: ProtagonistEventRecord[];
  lastUpdatedMs: number;
  partyMode?: PartyModeType;
  contacts?: LivingNpcContact[];
  npcMoments?: NpcMemoryMoment[];
  capturedCaptives?: number;
  roamingUnits?: WorldRoamingUnit[];
  travelPace?: TravelPace;
  travelTransport?: TravelTransport;
  lastWeatherUpdateMs?: number;
}

export type NarrativeMessageRole = 'narrator' | 'dialogue' | 'player';

export type NarrativeChoiceKind = 'observe' | 'talk' | 'action' | 'risk' | 'travel' | 'rest';

export interface NarrativeChoice {
  id: string;
  label: string;
  actionPrompt: string;
  kind: NarrativeChoiceKind;
}

export interface NarrativeMessage {
  id: string;
  role: NarrativeMessageRole;
  speaker?: string;
  text: string;
  timestamp: string;
  locationLabel: string;
  choices?: NarrativeChoice[];
}

export type NarrativeAiModelId =
  | 'gemini-4-hydrogen'
  | 'gemini-3.1-flash-lite'
  | 'gemini-4-argon'
  | 'gemini-4-carbon';

export type NarrativeThinkingMode = 'fast' | 'balanced' | 'deep';

export interface NarrativeAiSettings {
  model: NarrativeAiModelId;
  thinkingMode: NarrativeThinkingMode;
}
