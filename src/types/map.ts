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
