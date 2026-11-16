import tileCoastImg from '../assets/images/tile_coast_1794845557070.jpg';
import tileForestImg from '../assets/images/tile_forest_1794845554765.jpg';
import tileMountainImg from '../assets/images/tile_mountain_1794845555773.jpg';
import tilePlainImg from '../assets/images/tile_plain_1794845556011.jpg';
import tileRiverImg from '../assets/images/tile_river_1794845556008.jpg';
import tileRoadImg from '../assets/images/tile_road_1794845555536.jpg';
import type { MapLocation, MazgalCell, MazgalTerrain } from '../types/map';

export const GRID_COLS = 16;
export const GRID_ROWS = 9;
export const MAZGAL_SCALE_FERSAH = 18; // Her mazgal ~18x18 Fersah (Doğu-Batı toplam ~288 Fersah)
const COL_LETTERS = 'ABCDEFGHIJKLMNOP';

// 16 columns x 9 rows terrain layout calibrated to eastern_mist_forest_vast_map_hd.webp
// P: plain, R: road, F: forest, D: deep_forest, M: mountain, W: river, S: marsh, L: lake, C: coast, O: sea
const TERRAIN_MATRIX: string[] = [
  'PMMMMMMMMMMMOOOO', // Row 1
  'PPSMMMMMMMCOOOOO', // Row 2
  'PPFMWMFDMFMCOOOO', // Row 3
  'MPPFWFFDDDFFCOOO', // Row 4
  'MPRFWFRDLLLMCOOO', // Row 5 (Kulkoy at B5, Road at C5, Lake I5-K5)
  'PPFWWFRLLLDDCOOO', // Row 6
  'FDFFWFFFDLDFCOOO', // Row 7
  'DDDWWSFMDDDFCOOO', // Row 8
  'FFWSMMMFFDCOOOOO', // Row 9
];

const CHAR_TO_TERRAIN: Record<string, MazgalTerrain> = {
  P: 'plain',
  R: 'road',
  F: 'forest',
  D: 'deep_forest',
  M: 'mountain',
  W: 'river',
  S: 'marsh',
  L: 'lake',
  C: 'coast',
  O: 'sea',
};

interface TerrainProfile {
  label: string;
  imageUrl: string;
  baseSafety: number;
  crossingHours: number;
  travelSpeed: string;
  visibility: number;
  resourceYield: string;
  summary: string;
}

const TERRAIN_PROFILES: Record<MazgalTerrain, TerrainProfile> = {
  plain: {
    label: 'Açık Düzlük ve Mera',
    imageUrl: tilePlainImg,
    baseSafety: 62,
    crossingHours: 14,
    travelSpeed: 'Normal (1.0x)',
    visibility: 65,
    resourceYield: 'Otlak, Küçük Av ve Yakacak Çalı',
    summary:
      'Görüş açısı geniş, rüzgarlı sınır düzlüğü. Pusuya düşme ihtimali düşüktür ancak yaklaşan tehlikeler uzaktan seçilir.',
  },
  road: {
    label: 'Kervan ve Devriye Yolu',
    imageUrl: tileRoadImg,
    baseSafety: 68,
    crossingHours: 9,
    travelSpeed: 'Hızlı (0.75x)',
    visibility: 45,
    resourceYield: 'Yol İşaretleri ve Kuru Kamp Alanı',
    summary:
      'Yük arabalarının tekerlek izleriyle açılmış toprak ticaret yolu. Yolculuk hızlıdır ancak ormanla çevrili kesimlerde pusu riski artar.',
  },
  forest: {
    label: 'Sisli Çam ve Meşe Ormanı',
    imageUrl: tileForestImg,
    baseSafety: 44,
    crossingHours: 22,
    travelSpeed: 'Yavaş (1.4x)',
    visibility: 28,
    resourceYield: 'Kereste, Geyik Avı ve Şifalı Bitki',
    summary:
      'Sık ağaç gövdeleri ve eğrelti otlarıyla kaplı orman dokusu. Doğal örtü saklanmayı kolaylaştırır, yön bulmayı zorlaştırır.',
  },
  deep_forest: {
    label: 'Sık Kadim Orman Derinliği',
    imageUrl: tileForestImg,
    baseSafety: 28,
    crossingHours: 30,
    travelSpeed: 'Zorlu (1.8x)',
    visibility: 16,
    resourceYield: 'Nadir Mantar, Reçine ve Büyük Av',
    summary:
      'Güneş ışığının tabana zor sızdığı ağır sisli orman içi. Yerleşimlerden uzaktır; vahşi hayvanlar ve yön kaybı ciddi tehdit oluşturur.',
  },
  mountain: {
    label: 'Dağlık ve Kayalık Yamaç',
    imageUrl: tileMountainImg,
    baseSafety: 36,
    crossingHours: 38,
    travelSpeed: 'Çok Yavaş (2.2x)',
    visibility: 55,
    resourceYield: 'Taş, Çakmaktaşı ve Gözetleme Noktası',
    summary:
      'Dik kayalıklar ve gevşek taşlı keçi yolları. Tırmanış yorucudur ama yüksek sırtlar çevredeki vadileri gözetlemeye imkân tanır.',
  },
  river: {
    label: 'Dere ve Nehir Yatağı',
    imageUrl: tileRiverImg,
    baseSafety: 48,
    crossingHours: 24,
    travelSpeed: 'Yavaş (1.6x)',
    visibility: 30,
    resourceYield: 'Temiz İçme Suyu, Alabalık ve Kamış',
    summary:
      'Soğuk ve hızlı akan dere yatağı. Su ve balık kaynağı sunar; sabahları yoğun su sisi çöker ve köprüsüz geçişler risklidir.',
  },
  marsh: {
    label: 'Sazlık ve Çamurlu Bataklık',
    imageUrl: tileRiverImg,
    baseSafety: 30,
    crossingHours: 34,
    travelSpeed: 'Ağır (2.0x)',
    visibility: 22,
    resourceYield: 'Bataklık Otları ve Turba Kömürü',
    summary:
      'Yumuşak çamur ve sazlıklarla kaplı su birikintileri. Ağır zırhlı yolcular ve yük arabaları için ilerlemesi en zahmetli arazidir.',
  },
  lake: {
    label: 'İç Göl Suyu',
    imageUrl: tileRiverImg,
    baseSafety: 46,
    crossingHours: 16,
    travelSpeed: 'Kayıkla (1.2x)',
    visibility: 40,
    resourceYield: 'Tatlı Su Balığı ve Kıyı Kamışı',
    summary:
      'Ormanın merkezindeki derin tatlı su gölü. Yalnızca sandal veya sal ile geçilir; açık suda sis bastırdığında kıyı yönü kaybolabilir.',
  },
  coast: {
    label: 'Sarp Kıyı ve Falez',
    imageUrl: tileCoastImg,
    baseSafety: 38,
    crossingHours: 28,
    travelSpeed: 'Zorlu (1.7x)',
    visibility: 50,
    resourceYield: 'Deniz Tuzu, Kıyı Yengeci ve Deniz Yolu',
    summary:
      'Dalgaların dövdüğü kayalık doğu kıyısı. Sert rüzgar ve kaygan taşlar inişi zorlaştırır ancak kaçakçı tekneleri için yanaşma sağlar.',
  },
  sea: {
    label: 'Doğu Okyanusu Açıkları',
    imageUrl: tileCoastImg,
    baseSafety: 34,
    crossingHours: 14,
    travelSpeed: 'Gemiyle (1.0x)',
    visibility: 45,
    resourceYield: 'Açık Deniz Balıkçılığı',
    summary:
      'Soğuk doğu akıntılarının ve deniz sisinin hâkim olduğu açık sular. Yalnızca sağlam teknelerle seyredilebilir.',
  },
};

export function formatTravelHours(hours: number): string {
  const rounded = Math.max(1, Math.round(hours));
  if (rounded < 24) return `${rounded} Saat`;
  const days = Math.floor(rounded / 24);
  const rem = rounded % 24;
  if (rem === 0) return `${days} Gün`;
  return `${days} Gün ${rem} Saat`;
}

function getEasternBeltLabel(col: number): string {
  if (col <= 3) return 'Kıtanın Batı Sınır Eşiği';
  if (col <= 7) return 'Orta Doğu Sis Havzası';
  if (col <= 10) return 'İç Orman ve Göl Kuşağı';
  return 'Kıtanın En Doğu Kıyı ve Okyanus Sınırı';
}

export function getMazgalId(col: number, row: number): string {
  return `${COL_LETTERS[col] ?? 'A'}${row + 1}`;
}

export function getCellForCoords(x: number, y: number): { col: number; row: number; id: string } {
  const col = Math.max(0, Math.min(GRID_COLS - 1, Math.floor((x / 100) * GRID_COLS)));
  const row = Math.max(0, Math.min(GRID_ROWS - 1, Math.floor((y / 100) * GRID_ROWS)));
  return { col, row, id: getMazgalId(col, row) };
}

function getBaseTerrain(col: number, row: number): MazgalTerrain {
  const rowStr = TERRAIN_MATRIX[row] || '';
  const ch = rowStr[col] || 'F';
  return CHAR_TO_TERRAIN[ch] || 'forest';
}

const DIRECTION_OFFSETS: { dx: number; dy: number; label: string }[] = [
  { dx: 0, dy: -1, label: 'Kuzey' },
  { dx: 1, dy: -1, label: 'Kuzeydoğu' },
  { dx: 1, dy: 0, label: 'Doğu' },
  { dx: 1, dy: 1, label: 'Güneydoğu' },
  { dx: 0, dy: 1, label: 'Güney' },
  { dx: -1, dy: 1, label: 'Güneybatı' },
  { dx: -1, dy: 0, label: 'Batı' },
  { dx: -1, dy: -1, label: 'Kuzeybatı' },
];

function computeNeighborTransition(
  origin: MazgalCell,
  target: MazgalCell,
  dx: number,
  dy: number
): {
  travelHours: number;
  travelLabel: string;
  distanceFersah: number;
  requiresBoat?: 'lake' | 'sea';
  transitionNote: string;
} {
  const isDiagonal = dx !== 0 && dy !== 0;
  const distanceFersah = isDiagonal ? Math.round(MAZGAL_SCALE_FERSAH * Math.SQRT2) : MAZGAL_SCALE_FERSAH; // 18 or 25 Fersah

  const originProfile = TERRAIN_PROFILES[origin.terrain];
  const targetProfile = TERRAIN_PROFILES[target.terrain];

  let hours = (originProfile.crossingHours + targetProfile.crossingHours) / 2;
  if (isDiagonal) {
    hours *= 1.4;
  }

  const notes: string[] = [];

  // Water transport check
  let requiresBoat: 'lake' | 'sea' | undefined;
  if (target.terrain === 'sea' || (origin.terrain === 'sea' && target.terrain !== 'coast')) {
    requiresBoat = 'sea';
    if (origin.terrain === 'coast') {
      hours += 4;
      notes.push('Kayalık kıyı açılışı');
    } else {
      notes.push('Doğu akıntısı deniz seyri');
    }
  } else if (target.terrain === 'lake') {
    requiresBoat = 'lake';
    notes.push('Kayık/sal geçişi gerekir');
  }

  // Silver Bridge bonus
  const hasStoneBridge =
    origin.locationsInside.some((l) => l.id === 'loc-gumus-kopru') ||
    target.locationsInside.some((l) => l.id === 'loc-gumus-kopru');

  if (hasStoneBridge && (origin.terrain === 'river' || target.terrain === 'river')) {
    hours -= 5;
    notes.push('Gümüş Köprü kolaylığı');
  } else if (target.terrain === 'river' || target.terrain === 'marsh') {
    hours += 3;
    notes.push(target.terrain === 'marsh' ? 'Çamur ve sazlık gecikmesi' : 'Köprüsüz geçit arayışı');
  }

  // Elevation change
  if (target.terrain === 'mountain' && origin.terrain !== 'mountain') {
    hours += 4;
    notes.push('Dik yamaç tırmanışı');
  } else if (origin.terrain === 'mountain' && (target.terrain === 'plain' || target.terrain === 'road')) {
    hours -= 3;
    notes.push('Vadiden aşağı iniş');
  }

  // Eastern continent mist & oceanic wind penalties
  if (
    dx > 0 &&
    target.col >= 5 &&
    (target.terrain === 'forest' || target.terrain === 'deep_forest')
  ) {
    hours += 2;
    notes.push('Yoğun doğu sisi yön kaybı');
  } else if (
    (target.terrain === 'coast' || target.terrain === 'sea') &&
    origin.terrain !== 'sea'
  ) {
    hours += 2;
    notes.push('Sert doğu okyanus rüzgarı');
  }

  // Maintained road bonus
  if (origin.terrain === 'road' && target.terrain === 'road') {
    notes.push('Bakımlı kervan yolu');
  }

  if (notes.length === 0) {
    notes.push(isDiagonal ? 'Çapraz arazi yürüyüşü' : 'Standart yürüyüş temposu');
  }

  const finalHours = Math.max(8, Math.round(hours));
  const durationText = formatTravelHours(finalHours);
  const travelLabel =
    requiresBoat === 'sea'
      ? `Tekneyle ${durationText}`
      : requiresBoat === 'lake'
      ? `Kayıkla ${durationText}`
      : durationText;

  return {
    travelHours: finalHours,
    travelLabel,
    distanceFersah,
    requiresBoat,
    transitionNote: notes.slice(0, 2).join(' · '),
  };
}

export function buildMazgalGrid(locations: MapLocation[]): MazgalCell[] {
  // Pre-index locations by cell id
  const locMap = new Map<string, MapLocation[]>();
  for (const loc of locations) {
    const { id } = getCellForCoords(loc.x, loc.y);
    const list = locMap.get(id) ?? [];
    list.push(loc);
    locMap.set(id, list);
  }

  // First pass: calculate raw safety score and neighbor effects for all 144 cells
  const rawCells: MazgalCell[] = [];

  for (let row = 0; row < GRID_ROWS; row++) {
    for (let col = 0; col < GRID_COLS; col++) {
      const id = getMazgalId(col, row);
      const terrain = getBaseTerrain(col, row);
      const profile = TERRAIN_PROFILES[terrain];
      const inside = locMap.get(id) ?? [];

      let safety = profile.baseSafety;
      let visibility = profile.visibility;
      const effects: string[] = [];

      // Check locations inside this cell
      for (const loc of inside) {
        if (loc.id === 'loc-kuldere') {
          safety += 32;
          effects.push('Külköy Sınır Kalesi burada bulunuyor; garnizon devriyeleri tam koruma sağlar (+32 Güvenlik).');
        } else if (loc.category === 'village') {
          safety += 22;
          effects.push(`${loc.name} yerleşimi bu mazgalda; yerel gözcüler ve ocak ışıkları güvenliği artırır (+22 Güvenlik).`);
        } else if (loc.category === 'burrow') {
          safety -= 26;
          effects.push(`${loc.name} bu mazgalın içinde; goblin ve kobold tuzakları ciddi tehdit oluşturur (-26 Güvenlik).`);
        } else if (loc.category === 'danger') {
          safety -= 20;
          effects.push(`${loc.name} bu mazgalda yer alıyor; eşkıya ve yağmacı riski yüksek (-20 Güvenlik).`);
        }
      }

      // Check direct 8 neighbors for settlement protection, monster pressure, and terrain synergy
      let nearFriendlySettlement: string | null = null;
      let nearHostileSite: string | null = null;
      let adjacentRiverCount = 0;
      let adjacentForestCount = 0;
      let adjacentMountainCount = 0;

      for (const { dx, dy } of DIRECTION_OFFSETS) {
        const nc = col + dx;
        const nr = row + dy;
        if (nc < 0 || nc >= GRID_COLS || nr < 0 || nr >= GRID_ROWS) continue;
        const nid = getMazgalId(nc, nr);
        const nTerrain = getBaseTerrain(nc, nr);
        const nLocs = locMap.get(nid) ?? [];

        if (nTerrain === 'river' || nTerrain === 'lake') adjacentRiverCount++;
        if (nTerrain === 'forest' || nTerrain === 'deep_forest') adjacentForestCount++;
        if (nTerrain === 'mountain') adjacentMountainCount++;

        for (const nl of nLocs) {
          if (nl.id === 'loc-kuldere') {
            safety += 28;
            nearFriendlySettlement = nl.name;
          } else if (nl.category === 'village' && !nearFriendlySettlement) {
            safety += 16;
            nearFriendlySettlement = nl.name;
          } else if (nl.category === 'burrow' || nl.category === 'danger') {
            safety -= 18;
            nearHostileSite = nl.name;
          }
        }
      }

      // Distance decay from Kulkoy Sınır Kalesi (B5 -> col 1, row 4)
      const distFromKulkoy = Math.hypot(col - 1, row - 4);
      if (distFromKulkoy > 0 && distFromKulkoy <= 2.2 && !nearFriendlySettlement) {
        safety += 12;
        effects.push('Sınır kalesinin dış devriye menzili içinde (+12 Güvenlik).');
      } else if (distFromKulkoy >= 5.5 && (terrain === 'forest' || terrain === 'deep_forest')) {
        safety -= 10;
        effects.push('İnsan sınır karakollarından çok uzak derin orman bölgesi (-10 Güvenlik).');
      }

      if (nearFriendlySettlement) {
        effects.push(`${nearFriendlySettlement} komşuluğu nedeniyle devriye ve haberleşme desteği var.`);
      }
      if (nearHostileSite) {
        effects.push(`Komşu mazgaldaki ${nearHostileSite} nedeniyle gözcü ve pusu tehlikesi mevcut.`);
      }

      // Terrain adjacency synergies
      if ((terrain === 'forest' || terrain === 'deep_forest') && adjacentRiverCount > 0) {
        visibility = Math.max(10, visibility - 6);
        effects.push('Nehir veya göl kıyısına komşu olduğu için sabah sisi daha yoğundur ve av hayvanı boldur.');
      }
      if (terrain === 'road' && adjacentForestCount >= 3) {
        safety -= 8;
        effects.push('İki yanı sık ağaçlarla çevrili yol kesimi; kervanlar için pusu noktası riski taşır (-8 Güvenlik).');
      }
      if (terrain === 'plain' && adjacentMountainCount >= 2) {
        effects.push('Sıradağ eteğine dayanan açık arazi; yüksekten esen soğuk rüzgarlar hâkimdir.');
      }
      if (col >= 11 && (terrain === 'coast' || terrain === 'forest' || terrain === 'deep_forest')) {
        effects.push('Kıtanın en doğu kıyı kuşağı; okyanustan gelen tuzlu rüzgar ve yoğun kıyı sisi ilerlemeyi ağırlaştırır.');
      }
      if (effects.length === 0) {
        effects.push('Komşu mazgallarla benzer arazi karakteri taşır; olağan dışı bir sınır etkisi yoktur.');
      }

      const finalSafety = Math.max(8, Math.min(96, Math.round(safety)));
      const dangerLevel: 1 | 2 | 3 | 4 | 5 =
        finalSafety >= 76
          ? 1
          : finalSafety >= 58
          ? 2
          : finalSafety >= 40
          ? 3
          : finalSafety >= 24
          ? 4
          : 5;

      rawCells.push({
        id,
        col,
        row,
        terrain,
        terrainLabel: profile.label,
        imageUrl: profile.imageUrl,
        centerX: Number((((col + 0.5) / GRID_COLS) * 100).toFixed(2)),
        centerY: Number((((row + 0.5) / GRID_ROWS) * 100).toFixed(2)),
        locationsInside: inside,
        safetyScore: finalSafety,
        dangerLevel,
        travelSpeedLabel: profile.travelSpeed,
        scaleFersah: MAZGAL_SCALE_FERSAH,
        crossingHours: profile.crossingHours,
        crossingLabel: formatTravelHours(profile.crossingHours),
        easternBeltLabel: getEasternBeltLabel(col),
        visibilityMeters: visibility,
        resourceYield: profile.resourceYield,
        summary: profile.summary,
        neighborEffects: effects,
        neighbors: [],
      });
    }
  }

  // Second pass: link neighbor summaries with realistic transition times
  const cellById = new Map(rawCells.map((c) => [c.id, c]));
  for (const cell of rawCells) {
    cell.neighbors = DIRECTION_OFFSETS.flatMap(({ dx, dy, label }) => {
      const nc = cell.col + dx;
      const nr = cell.row + dy;
      if (nc < 0 || nc >= GRID_COLS || nr < 0 || nr >= GRID_ROWS) return [];
      const neighbor = cellById.get(getMazgalId(nc, nr));
      if (!neighbor) return [];
      const transition = computeNeighborTransition(cell, neighbor, dx, dy);
      return [
        {
          direction: label,
          id: neighbor.id,
          terrainLabel: neighbor.terrainLabel,
          safetyScore: neighbor.safetyScore,
          travelHours: transition.travelHours,
          travelLabel: transition.travelLabel,
          distanceFersah: transition.distanceFersah,
          requiresBoat: transition.requiresBoat,
          transitionNote: transition.transitionNote,
        },
      ];
    });
  }

  return rawCells;
}

export function findShortestMazgalHours(
  fromCellId: string,
  toCellId: string,
  cells: MazgalCell[]
): number {
  if (fromCellId === toCellId) return 0;
  const cellById = new Map(cells.map((c) => [c.id, c]));
  if (!cellById.has(fromCellId) || !cellById.has(toCellId)) return 24;

  const dist = new Map<string, number>();
  const visited = new Set<string>();
  for (const c of cells) {
    dist.set(c.id, c.id === fromCellId ? 0 : Infinity);
  }

  while (visited.size < cells.length) {
    let currentId: string | null = null;
    let bestDist = Infinity;
    for (const [id, d] of dist.entries()) {
      if (!visited.has(id) && d < bestDist) {
        bestDist = d;
        currentId = id;
      }
    }
    if (!currentId || bestDist === Infinity) break;
    if (currentId === toCellId) return bestDist;

    visited.add(currentId);
    const current = cellById.get(currentId);
    if (!current) continue;

    for (const nb of current.neighbors) {
      if (visited.has(nb.id)) continue;
      const candidate = bestDist + nb.travelHours;
      if (candidate < (dist.get(nb.id) ?? Infinity)) {
        dist.set(nb.id, candidate);
      }
    }
  }

  return dist.get(toCellId) ?? 24;
}

export interface MazgalRoutePlan {
  hours: number;
  pathIds: string[];
  totalFersah: number;
  requiresBoat: boolean;
  avgSafety: number;
}

export function findShortestMazgalPath(
  fromCellId: string,
  toCellId: string,
  cells: MazgalCell[]
): MazgalRoutePlan {
  const cellById = new Map(cells.map((c) => [c.id, c]));
  const startCell = cellById.get(fromCellId);
  if (fromCellId === toCellId) {
    return {
      hours: 0,
      pathIds: [fromCellId],
      totalFersah: 0,
      requiresBoat: false,
      avgSafety: startCell?.safetyScore ?? 50,
    };
  }

  if (!startCell || !cellById.has(toCellId)) {
    return {
      hours: 24,
      pathIds: [fromCellId, toCellId],
      totalFersah: 18,
      requiresBoat: false,
      avgSafety: 45,
    };
  }

  const dist = new Map<string, number>();
  const prev = new Map<string, string | null>();
  const visited = new Set<string>();

  for (const c of cells) {
    dist.set(c.id, c.id === fromCellId ? 0 : Infinity);
    prev.set(c.id, null);
  }

  while (visited.size < cells.length) {
    let currentId: string | null = null;
    let bestDist = Infinity;
    for (const [id, d] of dist.entries()) {
      if (!visited.has(id) && d < bestDist) {
        bestDist = d;
        currentId = id;
      }
    }
    if (!currentId || bestDist === Infinity) break;
    if (currentId === toCellId) break;

    visited.add(currentId);
    const current = cellById.get(currentId);
    if (!current) continue;

    for (const nb of current.neighbors) {
      if (visited.has(nb.id)) continue;
      const candidate = bestDist + nb.travelHours;
      if (candidate < (dist.get(nb.id) ?? Infinity)) {
        dist.set(nb.id, candidate);
        prev.set(nb.id, currentId);
      }
    }
  }

  const pathIds: string[] = [];
  let cursor: string | null = toCellId;
  while (cursor) {
    pathIds.unshift(cursor);
    cursor = prev.get(cursor) ?? null;
  }

  let totalFersah = 0;
  let requiresBoat = false;
  let safetySum = 0;

  for (let i = 0; i < pathIds.length; i++) {
    const c = cellById.get(pathIds[i]);
    if (c) safetySum += c.safetyScore;
    if (i < pathIds.length - 1 && c) {
      const nb = c.neighbors.find((n) => n.id === pathIds[i + 1]);
      if (nb) {
        totalFersah += nb.distanceFersah;
        if (nb.requiresBoat) requiresBoat = true;
      }
    }
  }

  return {
    hours: dist.get(toCellId) ?? 24,
    pathIds,
    totalFersah,
    requiresBoat,
    avgSafety: Math.round(safetySum / Math.max(1, pathIds.length)),
  };
}

