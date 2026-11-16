import type { MapLocation, MapRoute, MazgalCell } from '../types/map';
import { addGameHours, formatGameDateTime, getDayPhaseLabel } from './gameTime';
import { findShortestMazgalPath, formatTravelHours, getCellForCoords } from './gridEngine';
import { rollDie } from './diceEngine';

export type TravelPace = 'stealth' | 'normal' | 'forced';
export type TravelTransport = 'foot' | 'mule' | 'boat';
export type WeatherConditionKey = 'clear' | 'mist' | 'rain' | 'storm';

export interface ExpeditionPlanInput {
  fromLocationId: string;
  toLocationId: string;
  locations: MapLocation[];
  routes: MapRoute[];
  mazgalCells: MazgalCell[];
  gameTimeMs: number;
  partySize: number;
  pace: TravelPace;
  transport: TravelTransport;
  weather: WeatherConditionKey;
}

export interface ExpeditionPlanResult {
  fromName: string;
  toName: string;
  routeSourceLabel: string;
  directRouteName?: string;
  mazgalPath: string[];
  totalFersah: number;
  requiresBoat: boolean;
  baseHours: number;
  adjustedHours: number;
  durationLabel: string;
  arrivalDateTime: string;
  campNights: number;
  rationsNeeded: number;
  waterLitersNeeded: number;
  muleFeedBundles: number;
  avgSafety: number;
  dailyEncounterRiskPct: number;
  navigationDc: number;
  paceNote: string;
  warnings: string[];
}

export interface RegionalWeatherRoll {
  roll2d6: number;
  belt: string;
  name: string;
  visibilityMeters: number;
  travelMultiplierLabel: string;
  weatherKey: WeatherConditionKey;
  tacticalEffect: string;
}

export function calculateExpeditionPlan(input: ExpeditionPlanInput): ExpeditionPlanResult {
  const fromLoc = input.locations.find((l) => l.id === input.fromLocationId) ?? input.locations[0];
  const toLoc = input.locations.find((l) => l.id === input.toLocationId) ?? input.locations[1] ?? fromLoc;

  if (!fromLoc || !toLoc) {
    return {
      fromName: '-',
      toName: '-',
      routeSourceLabel: 'Veri Yok',
      mazgalPath: [],
      totalFersah: 0,
      requiresBoat: false,
      baseHours: 0,
      adjustedHours: 0,
      durationLabel: '0 Saat',
      arrivalDateTime: formatGameDateTime(input.gameTimeMs),
      campNights: 0,
      rationsNeeded: 0,
      waterLitersNeeded: 0,
      muleFeedBundles: 0,
      avgSafety: 50,
      dailyEncounterRiskPct: 10,
      navigationDc: 10,
      paceNote: 'Aynı konumdasınız.',
      warnings: [],
    };
  }

  const fromCell = getCellForCoords(fromLoc.x, fromLoc.y);
  const toCell = getCellForCoords(toLoc.x, toLoc.y);
  const mazgalPlan = findShortestMazgalPath(fromCell.id, toCell.id, input.mazgalCells);

  const directRoute = input.routes.find(
    (r) =>
      (r.fromId === fromLoc.id && r.toId === toLoc.id) ||
      (r.toId === fromLoc.id && r.fromId === toLoc.id)
  );

  let baseHours = mazgalPlan.hours;
  let routeSourceLabel = 'Mazgal En Kısa Arazi Rotası';
  let totalFersah = mazgalPlan.totalFersah;

  if (fromLoc.id === toLoc.id) {
    baseHours = 0;
    totalFersah = 0;
    routeSourceLabel = 'Aynı Konum';
  } else if (directRoute) {
    baseHours = directRoute.travelHours;
    routeSourceLabel = `Kayıtlı Patika (${directRoute.name})`;
    if (totalFersah === 0) {
      totalFersah = Math.max(4, Math.round(Math.hypot(toLoc.x - fromLoc.x, toLoc.y - fromLoc.y) * 2.4));
    }
  } else if (fromCell.id === toCell.id) {
    baseHours = Math.max(2, Math.round(Math.hypot(toLoc.x - fromLoc.x, toLoc.y - fromLoc.y) * 1.5));
    totalFersah = Math.max(2, Math.round(Math.hypot(toLoc.x - fromLoc.x, toLoc.y - fromLoc.y) * 1.8));
    routeSourceLabel = `Aynı Mazgal İçi (${fromCell.id})`;
  }

  let paceMult = 1;
  let paceNote = 'Normal yürüyüş: standart gözcülük ve yorulmadan kamp düzeni.';
  if (input.pace === 'stealth') {
    paceMult = 1.35;
    paceNote = 'Gizli tempo: +2 Gizlenme avantajı, pusu riski %35 azalır, süre uzar.';
  } else if (input.pace === 'forced') {
    paceMult = 0.78;
    paceNote = 'Zorlu yürüyüş: daha erken varış ancak her gün sonunda Dayanıklılık DC 12 testi gerekir.';
  }

  let transportMult = 1;
  if (input.transport === 'mule') {
    transportMult = directRoute ? 0.85 : 1.05; // Yolda hızlı, sık ormanda yavaş
  } else if (input.transport === 'boat') {
    transportMult = mazgalPlan.requiresBoat ? 0.75 : 1.0;
  }

  let weatherMult = 1;
  if (input.weather === 'mist') weatherMult = 1.12;
  else if (input.weather === 'rain') weatherMult = 1.22;
  else if (input.weather === 'storm') weatherMult = 1.4;

  const adjustedHours =
    baseHours === 0 ? 0 : Math.max(1, Math.round(baseHours * paceMult * transportMult * weatherMult));

  const arrivalMs = addGameHours(input.gameTimeMs, adjustedHours);
  const effectiveDays = Math.max(1, Math.ceil(adjustedHours / 12));
  const campNights = adjustedHours <= 10 ? 0 : Math.floor((adjustedHours - 1) / 16);

  const safeParty = Math.max(1, Math.min(12, Math.round(input.partySize)));
  const rationsNeeded = adjustedHours === 0 ? 0 : safeParty * effectiveDays;
  const waterLitersNeeded = adjustedHours === 0 ? 0 : safeParty * effectiveDays * 2;
  const muleFeedBundles = input.transport === 'mule' && adjustedHours > 0 ? effectiveDays * 2 : 0;

  let baseRisk = Math.max(8, Math.min(82, Math.round((100 - mazgalPlan.avgSafety) * 0.85)));
  if (input.pace === 'stealth') baseRisk = Math.max(5, Math.round(baseRisk * 0.65));
  if (input.pace === 'forced') baseRisk = Math.min(90, Math.round(baseRisk * 1.2));
  if (input.weather === 'mist') baseRisk = Math.min(92, baseRisk + 8);
  if (input.weather === 'storm') baseRisk = Math.max(5, baseRisk - 10);

  let navigationDc = 10;
  if (mazgalPlan.avgSafety < 45) navigationDc += 3;
  if (input.weather === 'mist') navigationDc += 2;
  if (input.weather === 'storm') navigationDc += 4;
  if (directRoute) navigationDc -= 2;
  navigationDc = Math.max(8, Math.min(20, navigationDc));

  const warnings: string[] = [];
  if (mazgalPlan.requiresBoat && input.transport !== 'boat') {
    warnings.push('Rota üzerinde su geçişi var: Göl veya deniz aşımı için kayık/tekne gerekir.');
  }
  if (input.transport === 'mule' && !directRoute && mazgalPlan.avgSafety < 48) {
    warnings.push('Katır veya yük arabası sık orman ve bataklık mazgallarında yavaşlar.');
  }
  if (campNights >= 2) {
    warnings.push(`${campNights} gece açık alanda kamp kurulacak; gece nöbet düzeni planlayın.`);
  }
  if (input.weather === 'mist' || input.weather === 'storm') {
    warnings.push('Sis/fırtına nedeniyle görüş mesafesi düşer; yön bulma testi önerilir.');
  }

  return {
    fromName: fromLoc.name,
    toName: toLoc.name,
    routeSourceLabel,
    directRouteName: directRoute?.name,
    mazgalPath: mazgalPlan.pathIds,
    totalFersah,
    requiresBoat: mazgalPlan.requiresBoat,
    baseHours,
    adjustedHours,
    durationLabel: adjustedHours === 0 ? '0 Saat' : formatTravelHours(adjustedHours),
    arrivalDateTime: formatGameDateTime(arrivalMs),
    campNights,
    rationsNeeded,
    waterLitersNeeded,
    muleFeedBundles,
    avgSafety: mazgalPlan.avgSafety,
    dailyEncounterRiskPct: baseRisk,
    navigationDc,
    paceNote,
    warnings,
  };
}

export function rollRegionalWeather(
  location: MapLocation | undefined,
  gameTimeMs: number
): RegionalWeatherRoll {
  const d1 = rollDie(6);
  const d2 = rollDie(6);
  const total = d1 + d2;
  const x = location?.x ?? 45;
  const phase = getDayPhaseLabel(gameTimeMs);

  const belt =
    x >= 75
      ? 'Doğu Okyanus Kıyısı'
      : x >= 35
      ? 'İç Sis Ormanı Kuşağı'
      : 'Batı Sınır Eşiği';

  const isMorningOrNight = phase === 'Sabah' || phase === 'Gece';
  const shift = (x >= 75 ? 1 : 0) + (isMorningOrNight ? 1 : 0);
  const score = total + shift;

  if (score <= 4) {
    return {
      roll2d6: total,
      belt,
      name: 'Açık ve Soğuk Rüzgar',
      visibilityMeters: 85,
      travelMultiplierLabel: 'Normal (1.0x)',
      weatherKey: 'clear',
      tacticalEffect: 'Sis vadi çukurlarına çekilmiş; ok menzili açık ve yön bulma testleri kolay (+2).',
    };
  }
  if (score <= 7) {
    return {
      roll2d6: total,
      belt,
      name: phase === 'Gece' ? 'Ayaz ve İnce Çiy Sisi' : 'Ağaç Arası Sabah Sisi',
      visibilityMeters: 35,
      travelMultiplierLabel: 'Hafif Yavaş (1.12x)',
      weatherKey: 'mist',
      tacticalEffect: '25–35 metre ötesi seçilemez; pusuya yatma ve gizlenme testlerine +2 avantaj.',
    };
  }
  if (score <= 10) {
    return {
      roll2d6: total,
      belt,
      name: x >= 75 ? 'Tuzlu Doğu Sağanağı' : 'Soğuk Orman Yağmuru',
      visibilityMeters: 25,
      travelMultiplierLabel: 'Çamurlu (1.22x)',
      weatherKey: 'rain',
      tacticalEffect: 'Islak zemin iz sürmeyi kolaylaştırır (+1), ancak kamp ateşi yakmayı ve yay kullanımını zorlaştırır (-2).',
    };
  }
  if (score <= 12) {
    return {
      roll2d6: total,
      belt,
      name: 'Kör Edici Yoğun Doğu Sisi',
      visibilityMeters: 12,
      travelMultiplierLabel: 'Temkinli (1.12x)',
      weatherKey: 'mist',
      tacticalEffect: 'Görüş 12 metreye iner; rehbersiz yürüyen gruplar Yön Bulma DC 13 atmazsa 1d4 saat kaybeder.',
    };
  }
  return {
    roll2d6: total,
    belt,
    name: x >= 75 ? 'Kıyı Fırtınası ve Sert Bora' : 'Ağaç Deviren Vadi Fırtınası',
    visibilityMeters: 15,
    travelMultiplierLabel: 'Ağır (1.40x)',
    weatherKey: 'storm',
    tacticalEffect: 'Açıkta yürümek tehlikeli, sığınak gerekir. Kıyı sularında tekne geçişi iptal olur.',
  };
}
