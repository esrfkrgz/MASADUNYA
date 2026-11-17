import type {
  FactionKey,
  LivingNpcContact,
  MapLocation,
  MapRoute,
  MazgalCell,
  NpcIntent,
  NpcMemoryMoment,
  NpcMomentCategory,
  NpcMood,
  NpcPartyRelation,
  NpcRomanceStatus,
  NpcTemperament,
  PartyModeType,
  ProtagonistEventRecord,
  ProtagonistState,
  SettlementMood,
  SettlementResident,
} from '../types/map';
import { rollDie } from './diceEngine';
import { INITIAL_GAME_TIME_MS, formatGameDateTime, getDayPhaseLabel } from './gameTime';
import { getCellForCoords } from './gridEngine';
import type { ProceduralNpcCard } from './proceduralWorldDeck';
import {
  FACTION_LABELS,
  computeProtagonistMood,
  getFactionForLocation,
} from './protagonistEngine';

export type NpcInteractionType =
  | 'talk'
  | 'flirt_or_romance'
  | 'seduce_or_charm'
  | 'confront_or_test'
  | 'exploit_or_rob_npc'
  | 'gift_silver'
  | 'share_ration'
  | 'invite_companion'
  | 'hire_npc'
  | 'take_hire_offer'
  | 'join_npc_party'
  | 'leave_or_dismiss';

const MAX_MEMORY_NOTES = 8;
const MAX_JOURNAL = 12;
const MAX_NPC_MOMENTS = 80;

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

function pushMemory(notes: string[], line: string): string[] {
  return [line, ...notes].slice(0, MAX_MEMORY_NOTES);
}

export function appendNpcMoment(
  moments: NpcMemoryMoment[] | undefined,
  entry: NpcMemoryMoment
): NpcMemoryMoment[] {
  return [entry, ...(moments ?? [])].slice(0, MAX_NPC_MOMENTS);
}

export function evaluateRelationshipMilestone(params: {
  prevTrust?: number;
  nextTrust?: number;
  prevRomance?: NpcRomanceStatus;
  nextRomance?: NpcRomanceStatus;
  prevPartyRelation?: NpcPartyRelation;
  nextPartyRelation?: NpcPartyRelation;
  category: NpcMomentCategory;
  significance: 'kritik' | 'önemli' | 'olağan';
  title?: string;
}): { isMilestone: boolean; milestoneLabel?: string } {
  const {
    prevTrust,
    nextTrust,
    prevRomance,
    nextRomance,
    prevPartyRelation,
    nextPartyRelation,
    category,
    significance,
    title = '',
  } = params;

  if (category === 'İhanet / Gasp') {
    return { isMilestone: true, milestoneLabel: 'İhanet / Gasp Kırılması' };
  }
  if (typeof prevTrust === 'number' && typeof nextTrust === 'number') {
    if (prevTrust <= 80 && nextTrust > 80) {
      return { isMilestone: true, milestoneLabel: 'Sarsılmaz Sadakat (80+ Güven)' };
    }
    if (prevTrust < 80 && nextTrust >= 80) {
      return { isMilestone: true, milestoneLabel: 'Güven Eşiği Aşıldı (80 Güven)' };
    }
    if (prevTrust >= 20 && nextTrust < 20) {
      return { isMilestone: true, milestoneLabel: 'Güven Çöküşü (<20 Güven)' };
    }
  }
  if (prevRomance !== 'Sevgili / Bağlı' && nextRomance === 'Sevgili / Bağlı') {
    return { isMilestone: true, milestoneLabel: 'Derin Bağ ve Aşk Eşiği' };
  }
  if (
    prevPartyRelation === 'independent' &&
    (nextPartyRelation === 'companion' || nextPartyRelation === 'party_leader')
  ) {
    return {
      isMilestone: true,
      milestoneLabel: nextPartyRelation === 'companion' ? 'Yoldaşlık Yemini' : 'Parti İttifakı',
    };
  }
  if (category === 'Kölelik / Azat') {
    return {
      isMilestone: true,
      milestoneLabel: title.toLowerCase().includes('azat')
        ? 'Özgürlük ve Minnet'
        : 'Mühürlü Bağlılık',
    };
  }
  if (category === 'Yardım / Fedakârlık' && significance === 'kritik') {
    return { isMilestone: true, milestoneLabel: 'Kriz Anı Fedakârlığı' };
  }
  return { isMilestone: false };
}

export function createNpcMomentRecord(params: {
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
}): NpcMemoryMoment {
  return {
    id: `nm-${params.timestampMs}-${Math.floor(Math.random() * 100000)}`,
    ...params,
  };
}

export function buildInitialNpcMoments(
  contacts: LivingNpcContact[],
  locations: MapLocation[]
): NpcMemoryMoment[] {
  return contacts.map((c, idx) => {
    const locName = c.currentLocationId
      ? locations.find((l) => l.id === c.currentLocationId)?.name ?? `Mazgal ${c.currentMazgalId}`
      : `Mazgal ${c.currentMazgalId}`;
    const note = c.memoryNotes[0] ?? c.lastReaction;
    return {
      id: `nm-init-${c.id}-${idx}`,
      npcId: c.id,
      npcName: c.name,
      npcRole: c.role,
      timestamp: c.metAt,
      timestampMs: c.lastUpdatedMs - idx,
      locationLabel: locName,
      category: 'Tanışma',
      title: `${c.name} ile İlk İz / Tanışma`,
      summary: note,
      moodAfter: c.mood,
      significance: 'olağan',
    };
  });
}

function pushJournal(
  journal: ProtagonistEventRecord[],
  entry: ProtagonistEventRecord
): ProtagonistEventRecord[] {
  return [entry, ...journal].slice(0, MAX_JOURNAL);
}

export function getDefaultMoralityForContact(
  temperament: NpcTemperament,
  faction: FactionKey
): number {
  let base = 0;
  switch (temperament) {
    case 'Erdemli':
      base = 74;
      break;
    case 'Şefkatli':
      base = 58;
      break;
    case 'Dürüst':
      base = 35;
      break;
    case 'Romantik':
      base = 24;
      break;
    case 'Gözüpek':
      base = 18;
      break;
    case 'Çıkarcı':
      base = -32;
      break;
    case 'Kurnaz':
      base = -44;
      break;
    case 'Acımasız':
      base = -78;
      break;
  }
  if (faction === 'outlaws') base -= 20;
  if (faction === 'goblinoids') base -= 25;
  if (faction === 'elf') base += 6;
  return clamp(base, -100, 100);
}

export function getNpcMorality(c: LivingNpcContact): number {
  if (typeof c.morality === 'number') return clamp(c.morality, -100, 100);
  return getDefaultMoralityForContact(c.temperament, c.faction);
}

export function getMoralityProfile(morality: number): {
  label: string;
  tone: 'depraved' | 'corrupt' | 'selfish' | 'pragmatic' | 'decent' | 'noble' | 'saintly';
} {
  if (morality <= -65) return { label: 'Tamamen Yozlaşmış / Acımasız', tone: 'depraved' };
  if (morality <= -30) return { label: 'Çürümüş / Vicdansız', tone: 'corrupt' };
  if (morality <= -10) return { label: 'Bencil / Çıkar Odaklı', tone: 'selfish' };
  if (morality < 15) return { label: 'Kayıtsız / Ortama Uyan', tone: 'pragmatic' };
  if (morality < 45) return { label: 'Dürüst / Yardımsever', tone: 'decent' };
  if (morality < 75) return { label: 'İyi Kalpli / Koruyucu', tone: 'noble' };
  return { label: 'Özverili / Sarsılmaz Erdemli', tone: 'saintly' };
}

export function getTrustScaleProfile(trust: number): {
  value: number;
  label: string;
  tone: 'hostile' | 'wary' | 'neutral' | 'trusted' | 'loyal';
  barHex: string;
  textHex: string;
} {
  const value = clamp(Math.round(trust), 0, 100);
  if (value <= 19) {
    return {
      value,
      label: 'Düşman / Güven Yok',
      tone: 'hostile',
      barHex: '#E89898',
      textHex: 'text-[#E89898]',
    };
  }
  if (value <= 39) {
    return {
      value,
      label: 'Kuşkulu / Mesafeli',
      tone: 'wary',
      barHex: '#E29D72',
      textHex: 'text-[#E29D72]',
    };
  }
  if (value <= 59) {
    return {
      value,
      label: 'Temkinli / Nötr',
      tone: 'neutral',
      barHex: '#D4A853',
      textHex: 'text-[#D4A853]',
    };
  }
  if (value <= 79) {
    return {
      value,
      label: 'Güvenilir / Yakın',
      tone: 'trusted',
      barHex: '#67C7C0',
      textHex: 'text-[#67C7C0]',
    };
  }
  return {
    value,
    label: 'Sarsılmaz Sadakat',
    tone: 'loyal',
    barHex: '#84E3DB',
    textHex: 'text-[#84E3DB]',
  };
}

export type NpcMoodEventBias =
  | 'default'
  | 'positive'
  | 'romantic'
  | 'confrontation'
  | 'betrayal'
  | 'exploited'
  | 'unpaid'
  | 'freed';

export function computeNpcMood(
  contact: {
    trust: number;
    affection: number;
    romanceStatus: NpcRomanceStatus;
    temperament: NpcTemperament;
    faction: FactionKey;
    morality?: number;
    partyRelation: NpcPartyRelation;
    lastIntent: NpcIntent;
    intentSuspected?: boolean;
    isWantedByPlayer?: boolean;
    isBonded?: boolean;
  },
  options?: {
    eventBias?: NpcMoodEventBias;
    locationMood?: SettlementMood;
  }
): NpcMood {
  const trust = clamp(contact.trust, 0, 100);
  const morality =
    typeof contact.morality === 'number'
      ? contact.morality
      : getDefaultMoralityForContact(contact.temperament, contact.faction);
  const bias = options?.eventBias ?? 'default';
  const locMood = options?.locationMood;

  if (
    bias === 'exploited' ||
    bias === 'betrayal' ||
    contact.isWantedByPlayer ||
    trust <= 18
  ) {
    return 'Öfkeli / Düşmanca';
  }

  if (bias === 'freed') {
    return 'Minnettar';
  }

  if (
    bias === 'confrontation' ||
    bias === 'unpaid' ||
    contact.romanceStatus === 'Kırgın / Mesafeli' ||
    (trust < 36 && contact.affection < 10)
  ) {
    return 'Kırgın / Mesafeli';
  }

  if (contact.isBonded) {
    if (trust >= 62 || contact.affection >= 24) return 'Temkinli';
    return 'Baskı Altında / Çekingen';
  }

  if (
    bias === 'romantic' ||
    contact.romanceStatus === 'Sevgili / Bağlı' ||
    (contact.romanceStatus === 'Flört / Yakınlık' && trust >= 48 && contact.affection >= 22)
  ) {
    return 'Romantik / Etkilenmiş';
  }

  if (
    contact.intentSuspected ||
    contact.lastIntent === 'Zorbalık ve Şantaj' ||
    contact.lastIntent === 'İftira ve Kumpas' ||
    contact.lastIntent === 'Gasp ve İhanet' ||
    (trust < 44 && morality <= -25)
  ) {
    return 'Gergin / Kuşkulu';
  }

  if (trust >= 78 && (morality >= 15 || contact.partyRelation !== 'independent')) {
    return 'Sadık / Huzurlu';
  }

  if (bias === 'positive' && (trust >= 60 || contact.affection >= 16)) {
    return 'Minnettar';
  }

  if (trust >= 58 || contact.affection >= 14) {
    return 'Neşeli / İstekli';
  }

  if (locMood === 'Korkulu' && trust < 62) {
    return 'Gergin / Kuşkulu';
  }

  return 'Temkinli';
}

export function getNpcMoodTone(mood: NpcMood): {
  textClass: string;
  boxClass: string;
} {
  switch (mood) {
    case 'Sadık / Huzurlu':
    case 'Minnettar':
    case 'Neşeli / İstekli':
      return {
        textClass: 'text-[#84E3DB]',
        boxClass: 'border-[#67C7C0]/35 bg-[#122420]',
      };
    case 'Romantik / Etkilenmiş':
      return {
        textClass: 'text-[#F29BA8]',
        boxClass: 'border-[#E89898]/35 bg-[#24171B]',
      };
    case 'Temkinli':
      return {
        textClass: 'text-[#E8C472]',
        boxClass: 'border-[#D4A853]/30 bg-[#1D2016]',
      };
    case 'Gergin / Kuşkulu':
    case 'Baskı Altında / Çekingen':
      return {
        textClass: 'text-[#E29D72]',
        boxClass: 'border-[#E29D72]/35 bg-[#231B16]',
      };
    case 'Kırgın / Mesafeli':
    case 'Öfkeli / Düşmanca':
      return {
        textClass: 'text-[#E89898]',
        boxClass: 'border-[#DC6B6B]/40 bg-[#261618]',
      };
  }
}

export function derivePartyMode(contacts: LivingNpcContact[]): PartyModeType {
  if (contacts.some((c) => c.partyRelation === 'party_leader')) return 'joined_party';
  if (contacts.some((c) => c.partyRelation === 'hired_player')) return 'hired_mercenary';
  if (
    contacts.some(
      (c) => c.partyRelation === 'companion' || c.partyRelation === 'hired_by_player'
    )
  ) {
    return 'leading';
  }
  return 'solo';
}

export const PARTY_MODE_LABELS: Record<PartyModeType, string> = {
  solo: 'Yalnız Gezgin',
  leading: 'Kendi Partin',
  hired_mercenary: 'Kiralık İş / Sözleşmeli',
  joined_party: 'Başka Bir Partinin Üyesi',
};

export interface PartyBonusSummary {
  mode: PartyModeType;
  modeLabel: string;
  combatBonus: number;
  scoutBonus: number;
  socialBonus: number;
  dailyExpenseSilver: number;
  dailyIncomeSilver: number;
  companions: LivingNpcContact[];
  leaderOrEmployer: LivingNpcContact | undefined;
  summaryNotes: string[];
}

export function getPartyBonusSummary(
  contacts: LivingNpcContact[] = []
): PartyBonusSummary {
  const mode = derivePartyMode(contacts);
  const companions = contacts.filter(
    (c) => c.partyRelation === 'companion' || c.partyRelation === 'hired_by_player'
  );
  const leaderOrEmployer = contacts.find(
    (c) => c.partyRelation === 'party_leader' || c.partyRelation === 'hired_player'
  );

  let combatBonus = 0;
  let scoutBonus = 0;
  let socialBonus = 0;
  let dailyExpenseSilver = 0;
  let dailyIncomeSilver = 0;
  const summaryNotes: string[] = [];

  for (const c of companions) {
    combatBonus += c.combatBonus;
    scoutBonus += c.scoutBonus;
    socialBonus += c.socialBonus;
    if (c.partyRelation === 'hired_by_player') {
      dailyExpenseSilver += c.dailyWageSilver;
    }
  }

  if (leaderOrEmployer) {
    combatBonus += Math.max(0, leaderOrEmployer.combatBonus);
    scoutBonus += Math.max(0, leaderOrEmployer.scoutBonus);
    if (leaderOrEmployer.partyRelation === 'hired_player') {
      dailyIncomeSilver += leaderOrEmployer.dailyWageSilver;
      summaryNotes.push(
        `${leaderOrEmployer.name} seni günlük ${leaderOrEmployer.dailyWageSilver} Gümüş ücretle kiraladı.`
      );
    } else {
      summaryNotes.push(
        `${leaderOrEmployer.name} liderliğindeki partide hareket ediyorsun.`
      );
    }
  }

  combatBonus = Math.min(3, combatBonus);
  scoutBonus = Math.min(3, scoutBonus);
  socialBonus = Math.min(3, socialBonus);

  if (companions.length > 0) {
    summaryNotes.push(
      `Partinde ${companions.length} kişi var (Fiziksel +${combatBonus}, Algı +${scoutBonus}, Sosyal +${socialBonus}).`
    );
  }
  if (dailyExpenseSilver > 0) {
    summaryNotes.push(`Günlük kiralık yoldaş giderin: ${dailyExpenseSilver} Gümüş.`);
  }
  if (summaryNotes.length === 0) {
    summaryNotes.push('Şu an tek başına yol alıyorsun; tüm karar ve risk sende.');
  }

  return {
    mode,
    modeLabel: PARTY_MODE_LABELS[mode],
    combatBonus,
    scoutBonus,
    socialBonus,
    dailyExpenseSilver,
    dailyIncomeSilver,
    companions,
    leaderOrEmployer,
    summaryNotes,
  };
}

export function createInitialContacts(locations: MapLocation[]): LivingNpcContact[] {
  const getLoc = (id: string) => locations.find((l) => l.id === id);
  const cellOf = (id: string) => {
    const l = getLoc(id);
    return l ? getCellForCoords(l.x, l.y).id : 'B5';
  };
  const ts = formatGameDateTime(INITIAL_GAME_TIME_MS);

  return [
    {
      id: 'npc-elif-kulkoy',
      name: 'Şifacı Çırağı Elif',
      role: 'Sınır Reviri ve Bitki Uzmanı',
      cultureLabel: 'İnsan Sınır Halkı',
      faction: 'border_human',
      trait: 'Yaralı ve düşkünlere kendi cebinden verecek kadar merhametli; ama zulme karşı sessiz kalmaz',
      motive: 'Külköy revirine şifalı ot toplamak ve darda kalanlara el uzatmak',
      temperament: 'Erdemli',
      morality: 78,
      trust: 62,
      affection: 14,
      mood: 'Neşeli / İstekli',
      romanceStatus: 'Yok',
      partyRelation: 'independent',
      dailyWageSilver: 2,
      combatBonus: 0,
      scoutBonus: 1,
      socialBonus: 1,
      currentLocationId: 'loc-kuldere',
      currentMazgalId: cellOf('loc-kuldere'),
      homeLocationId: 'loc-kuldere',
      openToRomance: true,
      lastIntent: 'Samimi Dostluk',
      lastReaction: 'Sabah avlusunda çantanı kontrol ettiğini görünce gülümseyip birkaç kuru kekik uzattı.',
      intentSuspected: false,
      metAt: ts,
      lastUpdatedMs: INITIAL_GAME_TIME_MS,
      memoryNotes: ['Külköy Sınır Kalesi avlusunda tanıştınız.'],
    },
    {
      id: 'npc-bora-izci',
      name: 'İzci Bora Kültepeli',
      role: 'Kıdemli Kervan Muhafızı ve Keşif Lideri',
      cultureLabel: 'İnsan Sınır Halkı',
      faction: 'border_human',
      trait: 'Disiplinli, ölçülü ve sözünün eri; haksızlık görmedikçe kendi işine bakar',
      motive: 'Gümüş Köprü yönüne güvenli bir devriye veya ücretli sefer düzenlemek',
      temperament: 'Gözüpek',
      morality: 34,
      trust: 56,
      affection: 4,
      mood: 'Temkinli',
      romanceStatus: 'Yok',
      partyRelation: 'independent',
      dailyWageSilver: 4,
      combatBonus: 2,
      scoutBonus: 1,
      socialBonus: 0,
      currentLocationId: 'loc-kuldere',
      currentMazgalId: cellOf('loc-kuldere'),
      homeLocationId: 'loc-kuldere',
      openToRomance: false,
      lastIntent: 'Ticari Çıkar / Ücret',
      lastReaction: '"Yalnız yürümek cesaret ister ama orman affetmez. İstersen kiralık kılıcım olurum, istersen ekibime gözcü lazım."',
      intentSuspected: false,
      metAt: ts,
      lastUpdatedMs: INITIAL_GAME_TIME_MS,
      memoryNotes: ['Külköy kapısında devriye nöbeti tutarken konuştunuz.'],
    },
    {
      id: 'npc-saim-cerci',
      name: 'Çerçi Saim',
      role: 'Gezgin Takasçı ve Söylenti Simsar',
      cultureLabel: 'İnsan Sınır Halkı',
      faction: 'border_human',
      trait: 'Yüzüne gülerken keseni tartar; köşeye sıkışınca iftira atmaktan ya da şantajdan çekinmez',
      motive: 'Saf yolcuları sömürmek, dedikodu satmak ve borçlu düşürmek',
      temperament: 'Kurnaz',
      morality: -42,
      trust: 43,
      affection: 2,
      mood: 'Gergin / Kuşkulu',
      romanceStatus: 'Yok',
      partyRelation: 'independent',
      dailyWageSilver: 2,
      combatBonus: 0,
      scoutBonus: 1,
      socialBonus: 2,
      currentLocationId: 'loc-kulova-koyu',
      currentMazgalId: cellOf('loc-kulova-koyu'),
      homeLocationId: 'loc-kulova-koyu',
      openToRomance: true,
      lastIntent: 'Kandırma Peşinde',
      lastReaction: '"Ah dostum, şu eski kestirme haritam tam sana göre... tabi küçük bir yol masrafı paylaşırsak."',
      intentSuspected: false,
      metAt: ts,
      lastUpdatedMs: INITIAL_GAME_TIME_MS,
      memoryNotes: ['Kulova Çoban Köyü’nde yün denklerinin başında denk geldiniz.'],
    },
    {
      id: 'npc-elenya-elf',
      name: 'Okçu Elenya Yüksekdal',
      role: 'Yüksekçam Sınır Okçusu',
      cultureLabel: 'Yüksekçam Elf Halkı',
      faction: 'elf',
      trait: 'Gururlu, ilkelere bağlı ve seçicidir; gümüşe değil karakterin tutarlılığına değer verir',
      motive: 'Çakmaktaşı Oyukları sınırındaki kobold hareketlerini izlemek',
      temperament: 'Romantik',
      morality: 56,
      trust: 50,
      affection: 8,
      mood: 'Temkinli',
      romanceStatus: 'Yok',
      partyRelation: 'independent',
      dailyWageSilver: 5,
      combatBonus: 1,
      scoutBonus: 2,
      socialBonus: 0,
      currentLocationId: 'loc-elf-koyu',
      currentMazgalId: cellOf('loc-elf-koyu'),
      homeLocationId: 'loc-elf-koyu',
      openToRomance: true,
      lastIntent: 'Kuşkulu Mesafe',
      lastReaction: '"Ormanın sessizliğini bozmazsan seni dinlerim yolcu; sözlerin değil adımların konuşur."',
      intentSuspected: false,
      metAt: ts,
      lastUpdatedMs: INITIAL_GAME_TIME_MS,
      memoryNotes: ['Yüksekçam asma köprü sınırında adı kulağına çalındı.'],
    },
    {
      id: 'npc-yasin-koy',
      name: 'Dümenci Yasin',
      role: 'Kıyı Kaçakçı Kılavuzu',
      cultureLabel: 'Kıyı Kaçakçısı ve Denizci',
      faction: 'outlaws',
      trait: 'Vicdan yükü taşımaz; zayıf düşeni ıssızda soymaktan, sırtından bıçaklamaktan ya da fidye için satmaktan kaçınmaz',
      motive: 'Sisli kıyı seferlerinde başkalarının sırtından ve canından gümüş devşirmek',
      temperament: 'Acımasız',
      morality: -78,
      trust: 34,
      affection: 0,
      mood: 'Gergin / Kuşkulu',
      romanceStatus: 'Yok',
      partyRelation: 'independent',
      dailyWageSilver: 5,
      combatBonus: 1,
      scoutBonus: 1,
      socialBonus: 1,
      currentLocationId: 'loc-kacakci-koyu',
      currentMazgalId: cellOf('loc-kacakci-koyu'),
      homeLocationId: 'loc-kacakci-koyu',
      openToRomance: false,
      lastIntent: 'Gasp ve İhanet',
      lastReaction: '"İyi kılıç sallıyorsan kervan yüküm var; riskini sen çek, payını ben ayarlarım — tabii sağ dönersen."',
      intentSuspected: false,
      metAt: ts,
      lastUpdatedMs: INITIAL_GAME_TIME_MS,
      memoryNotes: ['Doğu kıyısı kaçakçı hikayelerinde karanlık şöhretiyle geçiyor.'],
    },
  ];
}

function rollContextualMoralityAndTemperament(
  faction: FactionKey,
  location: MapLocation | undefined
): { morality: number; temperament: NpcTemperament } {
  // Base distribution shaped by region/faction/danger/mood—yet still allows extremes on both ends!
  let center = 15;
  if (faction === 'outlaws') center = -42;
  else if (faction === 'goblinoids') center = -52;
  else if (faction === 'elf') center = 28;
  else if (faction === 'beastkin') center = 8;

  if (location) {
    if (location.dangerLevel >= 4) center -= 18;
    else if (location.dangerLevel <= 1) center += 14;

    const mood = location.livingState?.mood;
    if (mood === 'Korkulu') center -= 16;
    else if (mood === 'Endişeli') center -= 8;
    else if (mood === 'Mutlu') center += 16;
    else if (mood === 'Huzurlu') center += 8;
  }

  // Wide bell-like variance so truly depraved (-95) or truly saintly (+90) people can appear anywhere
  const spread = (Math.random() - Math.random()) * 75;
  const morality = clamp(Math.round(center + spread), -98, 95);

  let temperament: NpcTemperament;
  if (morality <= -60) {
    temperament = Math.random() < 0.72 ? 'Acımasız' : 'Kurnaz';
  } else if (morality <= -25) {
    const pool: NpcTemperament[] = ['Kurnaz', 'Çıkarcı', 'Acımasız'];
    temperament = pool[Math.floor(Math.random() * pool.length)];
  } else if (morality < 20) {
    const pool: NpcTemperament[] = ['Gözüpek', 'Çıkarcı', 'Dürüst', 'Kurnaz'];
    temperament = pool[Math.floor(Math.random() * pool.length)];
  } else if (morality < 60) {
    const pool: NpcTemperament[] = ['Dürüst', 'Gözüpek', 'Romantik', 'Şefkatli'];
    temperament = pool[Math.floor(Math.random() * pool.length)];
  } else {
    temperament = Math.random() < 0.6 ? 'Erdemli' : 'Şefkatli';
  }

  return { morality, temperament };
}

export function createContactFromProceduralNpc(
  npc: ProceduralNpcCard,
  location: MapLocation | undefined,
  cell: MazgalCell,
  gameTimeMs: number
): LivingNpcContact {
  const faction = getFactionForLocation(location);
  const { morality, temperament } = rollContextualMoralityAndTemperament(faction, location);
  const ts = formatGameDateTime(gameTimeMs);

  const initialIntent: NpcIntent =
    morality <= -60
      ? 'Gasp ve İhanet'
      : temperament === 'Kurnaz'
      ? 'Kandırma Peşinde'
      : temperament === 'Çıkarcı'
      ? 'Seni Kullanmaya Çalışıyor'
      : morality >= 65
      ? 'Kendi Canını Feda Eder'
      : temperament === 'Şefkatli'
      ? 'Acıyor ve Kolluyor'
      : temperament === 'Romantik'
      ? 'Romantik İlgi'
      : 'Samimi Dostluk';

  const initTrust = morality <= -50 ? 32 : faction === 'goblinoids' ? 28 : 52;
  const initAffection = morality >= 45 || temperament === 'Romantik' ? 8 : 2;
  const baseContact: LivingNpcContact = {
    id: `npc-dyn-${Date.now()}-${Math.floor(Math.random() * 999)}`,
    name: npc.name,
    role: npc.role,
    cultureLabel: npc.cultureLabel,
    faction,
    trait: npc.trait,
    motive: npc.motive,
    temperament,
    morality,
    trust: initTrust,
    affection: initAffection,
    romanceStatus: 'Yok',
    partyRelation: 'independent',
    dailyWageSilver: 2 + rollDie(4),
    combatBonus: temperament === 'Gözüpek' || temperament === 'Acımasız' ? 2 : Math.random() < 0.45 ? 1 : 0,
    scoutBonus: Math.random() < 0.6 ? 1 : 0,
    socialBonus: temperament === 'Kurnaz' || temperament === 'Romantik' ? 1 : 0,
    currentLocationId: location?.id ?? null,
    currentMazgalId: cell.id,
    homeLocationId: location?.id ?? null,
    openToRomance: faction !== 'goblinoids' && Math.random() < 0.72,
    lastIntent: initialIntent,
    lastReaction: `${location?.name ?? `Mazgal ${cell.id}`} noktasında karşılaştınız (${npc.carriedItem}).`,
    intentSuspected: false,
    metAt: ts,
    lastUpdatedMs: gameTimeMs,
    memoryNotes: [`${location?.name ?? `Mazgal ${cell.id}`} bölgesinde tanıştınız.`],
  };
  return {
    ...baseContact,
    mood: computeNpcMood(baseContact, { locationMood: location?.livingState?.mood }),
  };
}

export function createContactFromResident(
  resident: SettlementResident,
  location: MapLocation,
  gameTimeMs: number
): LivingNpcContact {
  const faction = getFactionForLocation(location);
  const cell = getCellForCoords(location.x, location.y);
  const { morality, temperament } = rollContextualMoralityAndTemperament(faction, location);
  // Village heroes lean noticeably more positive unless in outlaw/goblin holes
  const adjustedMorality =
    faction === 'outlaws' || faction === 'goblinoids'
      ? morality
      : clamp(morality + 22, -100, 95);
  const ts = formatGameDateTime(gameTimeMs);

  const initTrust = adjustedMorality < -30 ? 44 : 60;
  const baseContact: LivingNpcContact = {
    id: `npc-res-${resident.id}-${location.id}`,
    name: resident.name,
    role: resident.role,
    cultureLabel: FACTION_LABELS[faction],
    faction,
    trait: resident.trait,
    motive: resident.renownNote,
    temperament: adjustedMorality >= 65 ? 'Erdemli' : temperament,
    morality: adjustedMorality,
    trust: initTrust,
    affection: 6,
    romanceStatus: 'Yok',
    partyRelation: 'independent',
    dailyWageSilver: 3,
    combatBonus: 1,
    scoutBonus: 1,
    socialBonus: adjustedMorality >= 20 ? 1 : 0,
    currentLocationId: location.id,
    currentMazgalId: cell.id,
    homeLocationId: location.id,
    openToRomance: faction !== 'goblinoids',
    lastIntent: adjustedMorality <= -40 ? 'Seni Kullanmaya Çalışıyor' : 'Samimi Dostluk',
    lastReaction: `${location.name} içinde adı anılıyor: ${resident.renownNote}`,
    intentSuspected: false,
    metAt: ts,
    lastUpdatedMs: gameTimeMs,
    memoryNotes: [`${location.name} sakinlerinden biri olarak tanıştınız.`],
  };
  return {
    ...baseContact,
    mood: computeNpcMood(baseContact, { locationMood: location.livingState?.mood }),
  };
}

function moveNpcAwayOnRoutes(
  currentLocId: string | null,
  routes: MapRoute[],
  locations: MapLocation[]
): { nextLocId: string | null; nextMazgalId: string; movedName?: string } {
  if (!currentLocId) return { nextLocId: null, nextMazgalId: 'E5' };
  const neighbors = routes
    .filter((r) => r.fromId === currentLocId || r.toId === currentLocId)
    .map((r) => (r.fromId === currentLocId ? r.toId : r.fromId));
  if (neighbors.length === 0) {
    const loc = locations.find((l) => l.id === currentLocId);
    return {
      nextLocId: currentLocId,
      nextMazgalId: loc ? getCellForCoords(loc.x, loc.y).id : 'B5',
    };
  }
  const destId = neighbors[Math.floor(Math.random() * neighbors.length)];
  const dest = locations.find((l) => l.id === destId);
  if (!dest) return { nextLocId: currentLocId, nextMazgalId: 'B5' };
  return {
    nextLocId: dest.id,
    nextMazgalId: getCellForCoords(dest.x, dest.y).id,
    movedName: dest.name,
  };
}

export function interactWithLivingNpc(
  protagonist: ProtagonistState,
  contactId: string,
  action: NpcInteractionType,
  currentLocation: MapLocation | undefined,
  currentCell: MazgalCell,
  nextTimeMs: number,
  playerMods: { physicalMod?: number; socialMod: number; perceptionMod: number },
  routes: MapRoute[] = [],
  allLocations: MapLocation[] = []
): {
  nextProtagonist: ProtagonistState;
  feedbackText: string;
  hoursSpent: number;
  locationMoraleDelta?: number;
  locationNoteTitle?: string;
  locationNoteDetail?: string;
} {
  const contacts = protagonist.contacts ?? [];
  const target = contacts.find((c) => c.id === contactId);
  if (!target) {
    return {
      nextProtagonist: protagonist,
      feedbackText: 'Kişi kayıtlarda bulunamadı.',
      hoursSpent: 0,
    };
  }

  const ts = formatGameDateTime(nextTimeMs);
  const phase = getDayPhaseLabel(nextTimeMs);
  const isDark = phase === 'Gece' || phase === 'Alacakaranlık';
  const arch = currentLocation?.livingState?.archetype;
  const locMood = currentLocation?.livingState?.mood;
  const isLawlessPlace =
    !currentLocation ||
    currentCell.safetyScore <= 42 ||
    arch === 'bandit_hamlet' ||
    arch === 'smuggler_cove' ||
    arch === 'goblin_burrow' ||
    arch === 'mist_ruin' ||
    arch === 'wild_nature';
  const isSettlementGuarded =
    Boolean(currentLocation) &&
    !isLawlessPlace &&
    (currentCell.safetyScore >= 58 || arch === 'border_fortress' || arch === 'elf_canopy');
  const localRep = protagonist.reputation[target.faction] ?? 0;

  let health = protagonist.health;
  let stamina = protagonist.stamina;
  let rations = protagonist.rations;
  let silver = protagonist.silver;
  let playerMorality = protagonist.playerMorality ?? 10;
  let bountySilver = protagonist.bountySilver ?? 0;
  let bountyFactions = [...(protagonist.bountyFactions ?? [])];
  let activeConditions = [...protagonist.activeConditions];
  const reputation = { ...protagonist.reputation };
  let morality = getNpcMorality(target);
  const prevTrust = clamp(target.trust, 0, 100);
  const prevAffection = target.affection;
  const prevRomance = target.romanceStatus;
  const prevPartyRelation = target.partyRelation;
  let trust = prevTrust;
  let affection = prevAffection;
  let romanceStatus = prevRomance;
  let partyRelation = prevPartyRelation;
  let currentLocationId = target.currentLocationId;
  let currentMazgalId = target.currentMazgalId;
  let lastIntent = target.lastIntent;
  let lastReaction = target.lastReaction;
  let intentSuspected = target.intentSuspected;
  let stoleFromPlayerSilver = target.stoleFromPlayerSilver ?? 0;
  let isWantedByPlayer = target.isWantedByPlayer ?? false;
  let memoryNotes = target.memoryNotes;
  let hoursSpent = 1;
  let feedbackText = '';
  let journalTitle = `${target.name} ile Etkileşim`;
  let locationMoraleDelta = 0;
  let locationNoteTitle: string | undefined;
  let locationNoteDetail: string | undefined;
  let eventBias: NpcMoodEventBias = 'default';
  let momentCategory: NpcMomentCategory = 'Sohbet';
  let momentTitle = `${target.name} ile Görüşme`;
  let momentSignificance: 'kritik' | 'önemli' | 'olağan' = 'olağan';

  const physicalMod = playerMods.physicalMod ?? 0;
  const isPlayerWeak = protagonist.health <= 55 || protagonist.rations === 0 || protagonist.silver <= 4;
  const hasOtherLover = contacts.some(
    (c) => c.id !== target.id && c.romanceStatus === 'Sevgili / Bağlı'
  );

  // Environmental cruelty / nobility pressure modifier
  const crisisPressure =
    locMood === 'Korkulu' || (currentLocation?.livingState?.activeProblems.length ?? 0) >= 2;

  if (action === 'talk') {
    stamina = Math.max(5, stamina - 3);
    const percCheck = rollDie(20) + playerMods.perceptionMod;
    const combatEscapeCheck = rollDie(20) + Math.max(physicalMod, playerMods.perceptionMod);

    // 1) EXTREME CORRUPTION / DEPRAVITY (-55 or worse): Unrestrained malice shaped by location & time!
    if (morality <= -55 && trust < 75 && Math.random() < (isDark || isLawlessPlace ? 0.78 : 0.58)) {
      if (isLawlessPlace || isDark || protagonist.health <= 45) {
        // Isolated/dark/weak -> Open ambush, severe mugging, wounding/poisoning, fleeing!
        lastIntent = 'Gasp ve İhanet';
        eventBias = 'betrayal';
        if (combatEscapeCheck >= 14) {
          intentSuspected = true;
          trust = clamp(trust - 22, 0, 100);
          momentCategory = 'İhanet / Gasp';
          momentTitle = `${target.name} Hançer Tuzak Girişimi`;
          momentSignificance = 'kritik';
          lastReaction = `${target.name} ${isDark ? 'karanlıktan yararlanıp' : 'ıssızlıkta'} elini gizli hançerine attı! Son anda refleksinle (${combatEscapeCheck}) geri sıçrayıp saldırıyı boşa çıkardın.`;
          feedbackText = `${target.name} sana tuzak kurmaya kalktı; son anda kurtuldun!`;
        } else {
          const stolenSilver = silver > 0 ? Math.max(Math.min(silver, 4), Math.round(silver * (0.5 + Math.random() * 0.35))) : 0;
          const stolenRations = Math.min(rations, Math.random() < 0.65 ? 2 : 1);
          const woundDmg = 14 + rollDie(16);
          silver = Math.max(0, silver - stolenSilver);
          rations = Math.max(0, rations - stolenRations);
          health = Math.max(5, health - woundDmg);
          stamina = Math.max(5, stamina - 16);
          trust = clamp(trust - 35, 0, 100);
          partyRelation = 'independent';
          intentSuspected = true;
          momentCategory = 'İhanet / Gasp';
          momentTitle = `${target.name} Tarafından Gasp Edildin`;
          momentSignificance = 'kritik';
          if (stolenSilver > 0) {
            stoleFromPlayerSilver += stolenSilver;
            isWantedByPlayer = true;
          }
          if (!activeConditions.includes('Gasp Edilmiş / Yaralı')) {
            activeConditions = ['Gasp Edilmiş / Yaralı', ...activeConditions].slice(0, 4);
          }

          let fleeNote = '';
          if (routes.length > 0 && allLocations.length > 0) {
            const fled = moveNpcAwayOnRoutes(currentLocationId, routes, allLocations);
            currentLocationId = fled.nextLocId;
            currentMazgalId = fled.nextMazgalId;
            if (fled.movedName) {
              fleeNote = ` Ardından izini kaybettirerek ${fled.movedName} yönüne kaçtı.`;
            }
          }

          lastReaction = `${target.name} merhametsizce üzerine çullanıp seni bıçakladı (-${woundDmg} Can), ${stolenSilver} Gümüş ve ${stolenRations} Erzak gasp edip seni kanlar içinde bıraktı.${fleeNote}`;
          feedbackText = `${target.name} seni vahşice gasp etti (-${woundDmg} Can, -${stolenSilver} Gümüş, -${stolenRations} Erzak)!`;
          journalTitle = `${target.name} Tarafından Gasp`;
        }
        memoryNotes = pushMemory(memoryNotes, lastReaction);
      } else {
        // Guarded settlement in daylight -> Blackmail, extortion or framing you to locals!
        const blackmailDemand = Math.min(silver, 5 + rollDie(6));
        eventBias = 'confrontation';
        momentCategory = 'Yüzleşme';
        momentSignificance = 'önemli';
        if (blackmailDemand >= 4 && Math.random() < 0.5) {
          lastIntent = 'Zorbalık ve Şantaj';
          silver -= blackmailDemand;
          trust = clamp(trust - 12, 0, 100);
          momentTitle = `${target.name} Şantajla Haraç Kesti`;
          lastReaction = `${target.name} çevredeki nöbetçilere seni hırsız veya casus olarak ihbar etmekle tehdit edip ${blackmailDemand} Gümüş haraç kopardı.`;
          feedbackText = `${target.name} şantajla ${blackmailDemand} Gümüşünü aldı.`;
        } else {
          lastIntent = 'İftira ve Kumpas';
          const repLoss = 10 + rollDie(8);
          reputation[target.faction] = clamp((reputation[target.faction] ?? 0) - repLoss, -100, 100);
          trust = clamp(trust - 18, 0, 100);
          locationMoraleDelta = -3;
          momentTitle = `${target.name} Halk Önünde İftira Attı`;
          momentSignificance = 'kritik';
          locationNoteTitle = `${target.name} İftira Yaydı`;
          locationNoteDetail = `${target.name}, ${protagonist.name} hakkında halka kışkırtıcı yalanlar fısıldayarak ortalığı gerginleştirdi.`;
          lastReaction = `${target.name} yerleşim içinde senin hakkında iğrenç bir iftira yaydı (-${repLoss} ${FACTION_LABELS[target.faction]} İtibarı). Halkın bakışları düşmanca sertleşti.`;
          feedbackText = `${target.name} yerel halka iftira atarak itibarını çökertti (-${repLoss} İtibar)!`;
        }
        memoryNotes = pushMemory(memoryNotes, lastReaction);
      }
    }
    // 2) MODERATE CORRUPTION (-54 .. -15): Scamming, exploiting labor, rumor-poisoning
    else if (morality <= -15 && trust < 70 && Math.random() < (crisisPressure ? 0.68 : 0.55)) {
      if (Math.random() < 0.5) {
        lastIntent = 'Kandırma Peşinde';
        if (percCheck >= 13) {
          intentSuspected = true;
          trust = clamp(trust - 6, 0, 100);
          eventBias = 'confrontation';
          momentCategory = 'Yüzleşme';
          momentTitle = `${target.name} Hilesi Ortaya Çıkarıldı`;
          momentSignificance = 'önemli';
          lastReaction = `${target.name} sahte bir borç/harita hikayesiyle kesene göz dikti; Algın (${percCheck}) sayesinde oyunu bozdun.`;
          feedbackText = `Algınla (${percCheck}) ${target.name} kişisinin hilesini yakaladın!`;
        } else {
          const scammed = Math.min(silver, 4 + rollDie(5));
          const lostRation = rations > 0 && Math.random() < 0.35 ? 1 : 0;
          silver -= scammed;
          rations -= lostRation;
          trust = clamp(trust + 1, 0, 100);
          momentCategory = 'İhanet / Gasp';
          momentTitle = `${target.name} Tarafından Dolandırıldın`;
          momentSignificance = 'önemli';
          lastReaction = `${target.name} kurduğu ustaca tezgâhla senden ${scammed} Gümüş${lostRation ? ' ve 1 erzak' : ''} kopardı.`;
          feedbackText = `${target.name} seni kandırdı (-${scammed} Gümüş${lostRation ? ', -1 Erzak' : ''}).`;
        }
      } else {
        lastIntent = 'Seni Kullanmaya Çalışıyor';
        if (percCheck >= 12) {
          intentSuspected = true;
          eventBias = 'confrontation';
          momentCategory = 'Yüzleşme';
          momentTitle = `${target.name} Sömürü Niyeti Sezildi`;
          momentSignificance = 'önemli';
          lastReaction = `${target.name} tüm tehlikeli yükü ve angaryayı senin üstüne yıkıp payı kendine saklamaya çalıştı; niyetini sezdin.`;
          feedbackText = `${target.name} seni sömürmeye çalışıyor — fark ettin!`;
        } else {
          const stain = 12 + rollDie(6);
          stamina = Math.max(5, stamina - stain);
          health = Math.max(5, health - (isLawlessPlace ? 5 : 0));
          momentCategory = 'İhanet / Gasp';
          momentTitle = `${target.name} Seni Angaryaya Koştu`;
          momentSignificance = 'önemli';
          lastReaction = `${target.name} ağır ve tehlikeli işi sırtına yükleyip (-${stain} Zindelik) kazancı tek başına cebine indirdi.`;
          feedbackText = `${target.name} seni acımasızca kullandı (-${stain} Zindelik).`;
        }
      }
      memoryNotes = pushMemory(memoryNotes, lastReaction);
    }
    // 3) HIGH NOBILITY / SELF-SACRIFICING GOODNESS (+50 or higher)
    else if (morality >= 50 && (isPlayerWeak || localRep < 0 || currentCell.dangerLevel >= 4)) {
      lastIntent = morality >= 70 ? 'Kendi Canını Feda Eder' : 'Acıyor ve Kolluyor';
      eventBias = 'positive';
      momentCategory = 'Yardım / Fedakârlık';
      momentTitle = `${target.name} Dar Günde Özveriyle Yardım Etti`;
      momentSignificance = 'kritik';
      let aidParts: string[] = [];
      if (health <= 65) {
        const bigHeal = morality >= 70 ? 18 + rollDie(12) : 12 + rollDie(8);
        health = Math.min(100, health + bigHeal);
        activeConditions = activeConditions.filter(
          (c) => !c.includes('Yaralı') && !c.includes('Gasp') && !c.includes('Zehir')
        );
        aidParts.push(`+${bigHeal} Can iyileştirdi`);
      }
      if (rations <= 1) {
        const givenRations = morality >= 70 ? 2 : 1;
        rations += givenRations;
        aidParts.push(`+${givenRations} Erzak paylaştı`);
      }
      if (silver <= 5) {
        const givenSilver = morality >= 70 ? 6 + rollDie(4) : 3 + rollDie(3);
        silver += givenSilver;
        aidParts.push(`+${givenSilver} Gümüş verdi`);
      }
      if (currentLocation && localRep < 10) {
        reputation[target.faction] = clamp((reputation[target.faction] ?? 0) + 5, -100, 100);
        locationMoraleDelta = +2;
        locationNoteTitle = `${target.name} Yolcuyu Savundu`;
        locationNoteDetail = `${target.name} halkın önünde ${protagonist.name} için kefil oldu ve morali yükseltti.`;
        aidParts.push('+5 İtibar kefilliği');
      }
      trust = clamp(trust + 6, 0, 100);
      affection = clamp(affection + 5, -100, 100);
      const summary = aidParts.length > 0 ? aidParts.join(', ') : 'tehlikeli patikaya karşı seni korudu';
      lastReaction = `${target.name} zor durumunu görünce hiç tereddüt etmeden kendi payından vazgeçti (${summary}).`;
      feedbackText = `${target.name} özveriyle yanında durdu (${summary}).`;
      memoryNotes = pushMemory(memoryNotes, lastReaction);
    }
    // 4) STANDARD CONTEXTUAL CONVERSATION (Honest / Pragmatic / Friendly)
    else {
      trust = clamp(trust + (morality >= 0 ? 5 : 2), 0, 100);
      affection = clamp(affection + (target.temperament === 'Romantik' ? 4 : 2), -100, 100);
      eventBias = 'positive';
      if (morality >= 30 && currentLocation?.livingState?.mood === 'Mutlu') {
        morality = clamp(morality + 1, -100, 100);
      }
      lastIntent =
        affection >= 22 && target.openToRomance
          ? 'Romantik İlgi'
          : morality >= 45
          ? 'Gizlice Kolluyor'
          : 'Samimi Dostluk';
      lastReaction = `${target.name} ile ${currentLocation?.name ?? `Mazgal ${currentCell.id}`} koşulları ve yaklaşan tehlikeler üzerine içten bir sohbet ettin (+Güven).`;
      feedbackText = `${target.name} ile verimli bir sohbet ettin.`;
      memoryNotes = pushMemory(memoryNotes, `Bölge durumu üzerine konuştunuz (${ts}).`);
    }
  } else if (action === 'flirt_or_romance') {
    stamina = Math.max(5, stamina - 3);
    const socialRoll = rollDie(20) + playerMods.socialMod;

    if (!target.openToRomance && morality >= -20) {
      romanceStatus = 'Karşılıksız İlgi';
      lastIntent = 'Kuşkulu Mesafe';
      momentCategory = 'Yakınlaşma / Aşk';
      momentTitle = `${target.name} Romantik Mesafeyi Korudu`;
      lastReaction = `${target.name} saygıyla mesafe koydu: "Yoldaşlık başka, kalp işleri başka. Benim yolum buna kapalı."`;
      feedbackText = `${target.name} romantik yaklaşımına mesafeli kaldı.`;
    } else if (morality <= -45) {
      // Wicked / depraved NPCs weaponize seduction or intimacy without limits!
      const percCheck = rollDie(20) + playerMods.perceptionMod;
      if (percCheck >= 15) {
        intentSuspected = true;
        romanceStatus = 'Kırgın / Mesafeli';
        lastIntent = 'Gasp ve İhanet';
        eventBias = 'betrayal';
        trust = clamp(trust - 14, 0, 100);
        momentCategory = 'İhanet / Gasp';
        momentTitle = `${target.name} Uyku Otu Tuzağı Bozuldu`;
        momentSignificance = 'kritik';
        lastReaction = `${target.name} seni baştan çıkarıp şarabına uyku otu katmaya kalkıştı; kokudan şüphelendin (Algı ${percCheck}) ve masayı devirdin!`;
        feedbackText = `${target.name} yakınlaşma bahanesiyle seni zehirleyip soymaya kalktı!`;
      } else {
        const stolen = silver > 0 ? Math.max(Math.min(silver, 3), Math.round(silver * 0.45)) : 0;
        const dmg = 10 + rollDie(8);
        silver = Math.max(0, silver - stolen);
        health = Math.max(5, health - dmg);
        stamina = Math.max(5, stamina - 14);
        romanceStatus = 'Flört / Yakınlık';
        lastIntent = 'Kandırma Peşinde';
        eventBias = 'betrayal';
        trust = clamp(trust - 22, 0, 100);
        momentCategory = 'İhanet / Gasp';
        momentTitle = `${target.name} İlaçlı Tuzakla Soydu`;
        momentSignificance = 'kritik';
        if (stolen > 0) {
          stoleFromPlayerSilver += stolen;
          isWantedByPlayer = true;
        }
        if (!activeConditions.includes('Uyku Otu / İhanet')) {
          activeConditions = ['Uyku Otu / İhanet', ...activeConditions].slice(0, 4);
        }
        lastReaction = `${target.name} sıcak gülümsemeler ve yakınlıkla gardını indirdi; içkine kattığı otla bayılıp uyandığında ${stolen} Gümüşün kayıptı (-${dmg} Can)!`;
        feedbackText = `${target.name} yakınlaşmanı kullanarak seni ilaçlayıp soydu (-${dmg} Can, -${stolen} Gümüş)!`;
      }
      memoryNotes = pushMemory(memoryNotes, lastReaction);
    } else if (hasOtherLover && morality >= -15) {
      trust = clamp(trust - 12, 0, 100);
      affection = clamp(affection - 14, -100, 100);
      romanceStatus = 'Kırgın / Mesafeli';
      lastIntent = 'Kuşkulu Mesafe';
      eventBias = 'confrontation';
      momentCategory = 'Yakınlaşma / Aşk';
      momentTitle = `${target.name} Sadakat Şüphesiyle Uzaklaştı`;
      momentSignificance = 'önemli';
      lastReaction = `${target.name} başka birine söz verdiğini bildiği için soğukça geri çekildi: "Kalbi bölünmüş olana güvenemem."`;
      feedbackText = `${target.name} başka bir sevgilin olduğunu bilerek uzaklaştı (-12 Güven).`;
    } else if (trust < 52 && socialRoll < 12 && morality < 40) {
      affection = clamp(affection - 2, -100, 100);
      romanceStatus = 'Karşılıksız İlgi';
      momentCategory = 'Yakınlaşma / Aşk';
      momentTitle = `${target.name} ile Zamansız Yakınlaşma`;
      lastReaction = `${target.name} henüz sana yeterince güvenmediği için bu yakınlaşmayı zamansız buldu (Sosyal ${socialRoll}).`;
      feedbackText = `Güven henüz oluşmadığı için yakınlaşma karşılık bulmadı.`;
    } else {
      affection = clamp(affection + 13 + (socialRoll >= 14 ? 4 : 0), -100, 100);
      trust = clamp(trust + 5, 0, 100);
      eventBias = 'romantic';
      momentCategory = 'Yakınlaşma / Aşk';
      if (morality >= 40 && health <= 70) {
        const tenderHeal = 10;
        health = Math.min(100, health + tenderHeal);
        lastReaction = `${target.name} şefkatle yaralarına baktı (+${tenderHeal} Can) ve gözlerinin içine bakarak elini tuttu.`;
      }
      if (affection >= 46 && trust >= 68) {
        romanceStatus = 'Sevgili / Bağlı';
        lastIntent = 'Romantik İlgi';
        momentTitle = `${target.name} ile Derin Aşk Bağlılığı`;
        momentSignificance = 'kritik';
        lastReaction = `${target.name} elini sıkıca tuttu: "Yolun nereye giderse gitsin, ister aynı partide olalım ister ayrı köylerde kalalım — kalbim seninle."`;
        feedbackText = `${target.name} ile aranızda derin bir bağ kuruldu (Sevgili / Bağlı)!`;
      } else {
        romanceStatus = 'Flört / Yakınlık';
        lastIntent = 'Romantik İlgi';
        momentTitle = `${target.name} ile Romantik Yakınlaşma`;
        momentSignificance = 'önemli';
        lastReaction =
          lastReaction ||
          `${target.name} sözlerine içten bir tebessümle karşılık verdi; aranızdaki yakınlık belirgin biçimde arttı.`;
        feedbackText = `${target.name} ile aranızda romantik yakınlık arttı (+13 Yakınlık).`;
      }
      memoryNotes = pushMemory(memoryNotes, `${romanceStatus} bağı güçlendi (${ts}).`);
    }
    journalTitle = `${target.name} ile Yakınlaşma`;
  } else if (action === 'seduce_or_charm') {
    const socialRoll = rollDie(20) + playerMods.socialMod;
    const percCheck = rollDie(20) + playerMods.perceptionMod;
    journalTitle = `${target.name} ile Cazibe ve Yakınlık`;

    if (morality <= -58 && percCheck < 15) {
      // Corrupt NPC turns seduction into a honey-trap mugging (non-explicit)
      const stolen = silver > 0 ? Math.max(Math.min(silver, 4), Math.round(silver * 0.4)) : 0;
      const dmg = 8 + rollDie(6);
      silver = Math.max(0, silver - stolen);
      health = Math.max(5, health - dmg);
      stamina = Math.max(5, stamina - 14);
      romanceStatus = 'Kırgın / Mesafeli';
      lastIntent = 'Kandırma Peşinde';
      intentSuspected = true;
      eventBias = 'betrayal';
      trust = clamp(trust - 20, 0, 100);
      momentCategory = 'İhanet / Gasp';
      momentTitle = `${target.name} Cazibe Tuzağıyla Soydu`;
      momentSignificance = 'kritik';
      if (stolen > 0) {
        stoleFromPlayerSilver += stolen;
        isWantedByPlayer = true;
      }
      if (!activeConditions.includes('Uyku Otu / İhanet')) {
        activeConditions = ['Uyku Otu / İhanet', ...activeConditions].slice(0, 4);
      }
      lastReaction = `${target.name} yakınlığını fırsat bilip içkine uyku otu kattı; gözlerini açtığında ${stolen} Gümüşün alınmıştı (-${dmg} Can)!`;
      feedbackText = `${target.name} cazibeni tuzak olarak kullandı (-${dmg} Can, -${stolen} Gümüş)!`;
    } else if (morality <= -20 && (target.temperament === 'Çıkarcı' || target.temperament === 'Kurnaz' || crisisPressure)) {
      // Pragmatic / desperate underworld pact: silver or favor for warm company + secret tip
      const fee = Math.min(silver, 4);
      momentCategory = 'Yakınlaşma / Aşk';
      if (fee >= 3 && socialRoll >= 10) {
        silver -= fee;
        stamina = Math.min(100, stamina + 12);
        affection = clamp(affection + 8, -100, 100);
        trust = clamp(trust + 2, 0, 100);
        romanceStatus = affection >= 25 ? 'Flört / Yakınlık' : romanceStatus;
        lastIntent = 'Ticari Çıkar / Ücret';
        eventBias = 'romantic';
        momentTitle = `${target.name} ile Çıkar ve Yakınlık Anlaşması`;
        momentSignificance = 'önemli';
        lastReaction = `${target.name} gizli han odasında seninle sıcak bir akşam ve yeraltı duyumlarını paylaştı (-${fee} Gümüş, +12 Zindelik).`;
        feedbackText = `${target.name} ile çıkar ve yakınlık dolu bir gece paylaştınız (-${fee} Gümüş, +12 Zindelik).`;
      } else {
        stamina = Math.max(5, stamina - 4);
        momentTitle = `${target.name} Karşılıksız Cazibeyi Reddetti`;
        lastReaction = `${target.name} soğukça gülümsedi: "Bedava yakınlık devri geçti yolcu; elin boşsa kapı orada."`;
        feedbackText = `${target.name} karşılıksız baştan çıkarmaya yanaşmadı.`;
      }
    } else if (!target.openToRomance && socialRoll < 16) {
      trust = clamp(trust - 5, 0, 100);
      lastIntent = 'Kuşkulu Mesafe';
      eventBias = 'confrontation';
      momentCategory = 'Yakınlaşma / Aşk';
      momentTitle = `${target.name} Sınırı Aşmana Tepki Gösterdi`;
      lastReaction = `${target.name} bakışlarını kaçırıp geri çekildi: "Böyle oyunlara göre biri değilim." (-5 Güven).`;
      feedbackText = `${target.name} yaklaşımını uygunsuz bulup mesafe koydu (-5 Güven).`;
    } else if (socialRoll >= 12) {
      affection = clamp(affection + 16, -100, 100);
      trust = clamp(trust + 4, 0, 100);
      stamina = Math.min(100, stamina + 12);
      if (hasOtherLover && morality >= 0) {
        trust = clamp(trust - 8, 0, 100);
      }
      romanceStatus = affection >= 45 && trust >= 65 ? 'Sevgili / Bağlı' : 'Flört / Yakınlık';
      lastIntent = 'Romantik İlgi';
      eventBias = 'romantic';
      momentCategory = 'Yakınlaşma / Aşk';
      momentTitle =
        romanceStatus === 'Sevgili / Bağlı'
          ? `${target.name} ile Baş Başa Gece ve Bağlılık`
          : `${target.name} ile Ateş Başında Sıcak Yakınlık`;
      momentSignificance = romanceStatus === 'Sevgili / Bağlı' ? 'kritik' : 'önemli';
      lastReaction = `${target.name} fısıltılı sözlerine karşılık verdi; ateş başında baş başa geçen sakin gece sonrası hem bağınız güçlendi hem zindeliğin arttı (+16 Yakınlık, +12 Zindelik).`;
      feedbackText = `${target.name} cazibene kapıldı (+16 Yakınlık, +12 Zindelik, ${romanceStatus}).`;
    } else {
      stamina = Math.max(5, stamina - 4);
      affection = clamp(affection - 2, -100, 100);
      momentCategory = 'Yakınlaşma / Aşk';
      momentTitle = `${target.name} ile Sonuçsuz Flört`;
      lastReaction = `${target.name} sözlerini yarım bir tebessümle geçiştirdi (Sosyal ${socialRoll}); şimdilik sınırı aşmadı.`;
      feedbackText = `Cazibe girişimin karşılık bulmadı (Sosyal ${socialRoll}).`;
    }
    memoryNotes = pushMemory(memoryNotes, lastReaction);
  } else if (action === 'confront_or_test') {
    stamina = Math.max(5, stamina - 6);
    const duelRoll = rollDie(20) + Math.max(physicalMod, playerMods.perceptionMod);
    journalTitle = `${target.name} ile Yüzleşme`;
    momentCategory = 'Yüzleşme';

    if (morality <= -35 || isWantedByPlayer) {
      intentSuspected = true;
      eventBias = 'confrontation';
      if (duelRoll >= 13) {
        const stolenBack = stoleFromPlayerSilver;
        const recovered = stolenBack + 4 + rollDie(6);
        silver += recovered;
        stoleFromPlayerSilver = 0;
        isWantedByPlayer = false;
        trust = clamp(trust - 22, 0, 100);
        morality = clamp(morality - 2, -100, 100);
        lastIntent = 'Gasp ve İhanet';
        momentTitle = `${target.name} ile Hesaplaşma Kazanıldı`;
        momentSignificance = 'kritik';
        if (isSettlementGuarded) {
          reputation[target.faction] = clamp((reputation[target.faction] ?? 0) + 4, -100, 100);
          locationMoraleDelta = +3;
          locationNoteTitle = `${target.name} İfşa Edildi`;
          locationNoteDetail = `${protagonist.name}, ${target.name} kişisinin karanlık kumpasını yerlilerin önünde ortaya çıkardı.`;
        }
        lastReaction = `${target.name} köşeye sıkışınca maskesini düşürüp bıçak çekti ama (${duelRoll}) bileğini büküp ${stolenBack > 0 ? `çaldığı ${stolenBack}g dahil ` : ''}toplam ${recovered} Gümüş söktün!`;
        feedbackText = `${target.name} ile hesaplaştın; üstün gelip +${recovered} Gümüş geri aldın!`;
      } else {
        const dmg = 14 + rollDie(12);
        const lost = Math.min(silver, 5 + rollDie(5));
        health = Math.max(5, health - dmg);
        silver -= lost;
        if (lost > 0) {
          stoleFromPlayerSilver += lost;
          isWantedByPlayer = true;
        }
        trust = clamp(trust - 28, 0, 100);
        partyRelation = 'independent';
        lastIntent = 'Gasp ve İhanet';
        eventBias = 'betrayal';
        momentCategory = 'İhanet / Gasp';
        momentTitle = `${target.name} ile Kanlı Yüzleşme Kaybedildi`;
        momentSignificance = 'kritik';
        lastReaction = `Yüzleşmen kanlı bitti: ${target.name} hiç acımadan sertçe vurdu (-${dmg} Can) ve ${lost} Gümüşünü alıp uzaklaştı.`;
        feedbackText = `Yüzleşme ters tepti; ${target.name} seni ağır yaralayıp (-${dmg} Can) gümüşünü aldı!`;
      }
      memoryNotes = pushMemory(memoryNotes, lastReaction);
    } else {
      intentSuspected = false;
      trust = clamp(trust + 7, 0, 100);
      morality = clamp(morality + 2, -100, 100);
      lastIntent = morality >= 45 ? 'Kendi Canını Feda Eder' : 'Samimi Dostluk';
      eventBias = 'positive';
      momentTitle = `${target.name} ile Kuşkular Temizlendi`;
      momentSignificance = 'önemli';
      lastReaction = `${target.name} açık sözlülüğüne saygı duydu: "Saklayacak karanlık bir hesabım yok. Sana yolda güvenebilirim." (+7 Güven).`;
      feedbackText = `${target.name} ile aradaki tüm kuşkular temizlendi (+7 Güven).`;
      memoryNotes = pushMemory(memoryNotes, `Açık yüzleşmede dürüstlüğü doğrulandı (${ts}).`);
    }
  } else if (action === 'exploit_or_rob_npc') {
    stamina = Math.max(5, stamina - 10);
    const coerceRoll = rollDie(20) + Math.max(physicalMod, playerMods.socialMod);
    journalTitle = `${target.name} Kişisini Soyma / Sömürme`;
    playerMorality = clamp(playerMorality - 14, -100, 100);
    trust = clamp(trust - 40, 0, 100);
    affection = clamp(affection - 40, -100, 100);
    eventBias = 'exploited';
    momentCategory = 'İhanet / Gasp';
    momentSignificance = 'kritik';
    if (romanceStatus === 'Sevgili / Bağlı' || romanceStatus === 'Flört / Yakınlık') {
      romanceStatus = 'Kırgın / Mesafeli';
    }
    partyRelation = 'independent';

    if (coerceRoll >= 11) {
      const takenSilver = 4 + rollDie(8);
      silver += takenSilver;
      rations += Math.random() < 0.55 ? 1 : 0;
      momentTitle = `${target.name} Tarafınla Zorla Gasp Edildi`;
      if (isSettlementGuarded && target.faction !== 'outlaws') {
        reputation[target.faction] = clamp((reputation[target.faction] ?? 0) - 10, -100, 100);
        bountySilver += 14;
        if (!bountyFactions.includes(target.faction)) bountyFactions.push(target.faction);
        locationMoraleDelta = -3;
        locationNoteTitle = `${protagonist.name} Soygun Yaptı`;
        locationNoteDetail = `${protagonist.name}, ${target.name} kişisini tehdit ederek gümüşünü gasp etti.`;
      }
      if (routes.length > 0 && allLocations.length > 0 && Math.random() < 0.55) {
        const fled = moveNpcAwayOnRoutes(currentLocationId, routes, allLocations);
        currentLocationId = fled.nextLocId;
        currentMazgalId = fled.nextMazgalId;
      }
      lastIntent = 'Kuşkulu Mesafe';
      lastReaction = `${target.name} korkuyla veya öfkeyle geri çekildi; kesesindeki ${takenSilver} Gümüşü zorla aldın.`;
      feedbackText = `${target.name} kişisinden zorla +${takenSilver} Gümüş gasp ettin (-14 Ahlak).`;
    } else {
      const dmg = 12 + rollDie(10);
      health = Math.max(5, health - dmg);
      momentTitle = `${target.name} Soygun Girişimini Püskürttü`;
      if (isSettlementGuarded && target.faction !== 'outlaws') {
        reputation[target.faction] = clamp((reputation[target.faction] ?? 0) - 12, -100, 100);
        bountySilver += 16;
        if (!bountyFactions.includes(target.faction)) bountyFactions.push(target.faction);
      }
      lastIntent = 'Gasp ve İhanet';
      lastReaction = `${target.name} karşılık verip seni püskürttü (-${dmg} Can)!`;
      feedbackText = `Soygun girişimi ters tepti; ${target.name} seni yaraladı (-${dmg} Can)!`;
    }
    memoryNotes = pushMemory(memoryNotes, lastReaction);
  } else if (action === 'gift_silver') {
    hoursSpent = 0;
    if (silver < 3) {
      return {
        nextProtagonist: protagonist,
        feedbackText: 'Hediye veya destek vermek için en az 3 Gümüşün olmalı.',
        hoursSpent: 0,
      };
    }
    silver -= 3;
    momentCategory = 'Yardım / Fedakârlık';
    momentSignificance = 'önemli';
    if (morality <= -55) {
      // Corrupt NPC pockets silver greedily and sees you as an easy mark
      trust = clamp(trust + 2, 0, 100);
      lastIntent = 'Seni Kullanmaya Çalışıyor';
      momentTitle = `${target.name} 3 Gümüşü Soğukça Aldı`;
      lastReaction = `${target.name} 3 Gümüşü tek kelime etmeden cebine indirdi; gözlerinde saygı değil, daha fazlasını koparma hesabı var.`;
      feedbackText = `${target.name} 3 Gümüşü kaptı ama niyeti hâlâ karanlık görünüyor.`;
    } else {
      trust = clamp(trust + (morality < 0 ? 8 : 7), 0, 100);
      affection = clamp(affection + (target.temperament === 'Romantik' ? 9 : 5), -100, 100);
      if (crisisPressure && morality < 20) morality = clamp(morality + 2, -100, 100);
      intentSuspected = false;
      eventBias = 'positive';
      lastIntent = morality < 0 ? 'Ticari Çıkar / Ücret' : 'Samimi Dostluk';
      momentTitle = `${target.name} Kişisine 3 Gümüş Hediye`;
      lastReaction = `${target.name} verdiğin 3 Gümüşü minnetle kabul etti (+Güven, +Yakınlık).`;
      feedbackText = `${target.name} kişisine 3 Gümüş verdin; ilişkisi güçlendi.`;
    }
    memoryNotes = pushMemory(memoryNotes, lastReaction);
  } else if (action === 'share_ration') {
    hoursSpent = 0;
    if (rations < 1) {
      return {
        nextProtagonist: protagonist,
        feedbackText: 'Paylaşacak erzağın kalmadı.',
        hoursSpent: 0,
      };
    }
    rations -= 1;
    trust = clamp(trust + 8, 0, 100);
    affection = clamp(affection + 7, -100, 100);
    eventBias = 'positive';
    momentCategory = 'Yardım / Fedakârlık';
    momentTitle = `${target.name} ile Ekmek ve Erzak Paylaşımı`;
    momentSignificance = 'önemli';
    // Sharing food during hardship can genuinely soften someone's heart!
    if (morality < 40) {
      morality = clamp(morality + (crisisPressure ? 4 : 2), -100, 100);
    }
    lastIntent = morality >= 45 ? 'Acıyor ve Kolluyor' : 'Samimi Dostluk';
    lastReaction = `${target.name} paylaştığın ekmeği görünce duraksadı: "Bu devirde ekmeğini bölen pek kalmadı." (+8 Güven, kalbi biraz daha yumuşadı).`;
    feedbackText = `${target.name} ile 1 porsiyon erzak paylaştın.`;
    memoryNotes = pushMemory(memoryNotes, lastReaction);
  } else if (action === 'invite_companion') {
    hoursSpent = 0;
    momentCategory = 'Parti / Sözleşme';
    if (morality >= 50 && localRep <= -35 && trust < 78) {
      momentTitle = `${target.name} Yoldaşlık Teklifini Reddetti`;
      lastReaction = `${target.name} başını çevirdi: "Bölge halkına yaptıkların yüzünden adın kötüye çıkmış. Önce itibarını düzelt, yoksa seninle yürümem."`;
      feedbackText = `${target.name} kötü itibarın yüzünden partine katılmayı reddetti.`;
    } else {
      const canJoinFree =
        trust >= 66 ||
        romanceStatus === 'Sevgili / Bağlı' ||
        affection >= 30 ||
        (morality <= -60 && trust >= 30); // Corrupt NPCs might eagerly join just to backstab you on the road!
      if (!canJoinFree) {
        momentTitle = `${target.name} Henüz Güvenmedi`;
        lastReaction = `${target.name} başını iki yana salladı: "Sana henüz o kadar güvenmiyorum. Ya güvenimi kazan (66+/100) ya da günlük ${target.dailyWageSilver} Gümüşle kirala."`;
        feedbackText = `${target.name} ücretsiz katılmak için en az 66/100 Güven veya güçlü bağ istiyor.`;
      } else {
        partyRelation = 'companion';
        eventBias = 'positive';
        momentTitle = `${target.name} Yoldaş Olarak Partine Katıldı`;
        momentSignificance = 'kritik';
        lastIntent =
          morality <= -60
            ? 'Gasp ve İhanet'
            : romanceStatus === 'Sevgili / Bağlı'
            ? 'Romantik İlgi'
            : 'Samimi Dostluk';
        lastReaction =
          morality <= -60
            ? `${target.name} ince bir gülümsemeyle çantasını aldı: "Seninle ıssız yollara çıkmak kârlı olabilir... Elbette yoldaşın olurum."`
            : `${target.name} çantasını omuzladı: "Seninle aynı yolda yürümeye varım. Partine katılıyorum!"`;
        feedbackText = `${target.name} yoldaş olarak partine katıldı!`;
        memoryNotes = pushMemory(memoryNotes, `Partine yoldaş olarak katıldı.`);
      }
    }
    journalTitle = `${target.name} Partine Katıldı`;
  } else if (action === 'hire_npc') {
    hoursSpent = 0;
    if (silver < target.dailyWageSilver) {
      return {
        nextProtagonist: protagonist,
        feedbackText: `Kiralamak için ilk gün ücreti olan ${target.dailyWageSilver} Gümüş gerekiyor.`,
        hoursSpent: 0,
      };
    }
    silver -= target.dailyWageSilver;
    partyRelation = 'hired_by_player';
    trust = clamp(trust + 4, 0, 100);
    lastIntent = 'Ticari Çıkar / Ücret';
    momentCategory = 'Parti / Sözleşme';
    momentTitle = `${target.name} Kiralık Yoldaş Oldu`;
    momentSignificance = 'önemli';
    lastReaction = `${target.name} ilk gün ücreti olan ${target.dailyWageSilver} Gümüşü alıp el sıkıştı: "Ücretimi ödediğin sürece yol arkadaşınım."`;
    feedbackText = `${target.name} günlük ${target.dailyWageSilver} Gümüşe kiralandı!`;
    memoryNotes = pushMemory(memoryNotes, `Günlük ${target.dailyWageSilver} Gümüşe kiraladın.`);
    journalTitle = `${target.name} Kiralandı`;
  } else if (action === 'take_hire_offer') {
    hoursSpent = 0;
    const signingBonus = morality <= -50 ? 1 : 2;
    silver += signingBonus;
    partyRelation = 'hired_player';
    lastIntent = morality <= -50 ? 'Seni Kullanmaya Çalışıyor' : 'Ticari Çıkar / Ücret';
    momentCategory = 'Parti / Sözleşme';
    momentTitle = `${target.name} Seni Kiraladı (${target.dailyWageSilver}g/gün)`;
    momentSignificance = 'önemli';
    lastReaction =
      morality <= -50
        ? `${target.name} avucuna ${signingBonus} Gümüş sıkıştırdı: "Emirlerimi sorgulamadan yapacaksın; yolun pis işleri senden sorulur."`
        : `${target.name} sana ${signingBonus} Gümüş kapora verdi: "Şimdilik benim hesabıma çalışıyorsun; günlük ${target.dailyWageSilver} Gümüş pay alacaksın."`;
    feedbackText = `${target.name} seni günlük ${target.dailyWageSilver} Gümüşe kiraladı (+${signingBonus} Gümüş kapora)!`;
    memoryNotes = pushMemory(memoryNotes, `Seni günlük ${target.dailyWageSilver} Gümüşe kiraladı.`);
    journalTitle = `${target.name} Seni Kiraladı`;
  } else if (action === 'join_npc_party') {
    hoursSpent = 0;
    if (trust < 30) {
      return {
        nextProtagonist: protagonist,
        feedbackText: `${target.name} aranızdaki düşmanlık yüzünden seni partisine kabul etmiyor (Güven ${trust}/100).`,
        hoursSpent: 0,
      };
    }
    partyRelation = 'party_leader';
    lastIntent = morality <= -50 ? 'Seni Kullanmaya Çalışıyor' : 'Samimi Dostluk';
    momentCategory = 'Parti / Sözleşme';
    momentTitle = `${target.name} Partisine Katıldın`;
    momentSignificance = 'kritik';
    lastReaction = `${target.name} grubuna yer açtı: "Ekibimize hoş geldin! Bizimle yürüdüğün sürece yol ve ganimet kurallarımız geçerli."`;
    feedbackText = `${target.name} liderliğindeki partiye katıldın!`;
    memoryNotes = pushMemory(memoryNotes, `Liderliğindeki partiye katıldın.`);
    journalTitle = `${target.name} Partisine Katıldın`;
  } else if (action === 'leave_or_dismiss') {
    hoursSpent = 0;
    const prevRel = partyRelation;
    partyRelation = 'independent';
    momentCategory = 'Parti / Sözleşme';
    momentTitle = `${target.name} ile Yollar Ayrıldı`;
    momentSignificance = 'önemli';
    if (prevRel === 'companion' || prevRel === 'hired_by_player') {
      trust = clamp(trust - 4, 0, 100);
      eventBias = 'confrontation';
      lastReaction = `${target.name} ile yollarınız şimdilik ayrıldı; artık ${currentLocation?.name ?? `Mazgal ${currentCell.id}`} çevresinde kendi halinde yaşıyor.`;
      feedbackText = `${target.name} partinden ayrıldı (ancak tanıdığın olarak haritada yaşamaya devam ediyor).`;
    } else {
      lastReaction = `${target.name} ile iş/parti bağını sonlandırdın ve yeniden özgürce kendi yoluna döndün.`;
      feedbackText = `${target.name} grubundan ayrıldın; artık yalnız gezginsin.`;
    }
    memoryNotes = pushMemory(memoryNotes, lastReaction);
    journalTitle = `${target.name} ile Yol Ayrımı`;
  }

  const nextMoodNpc = computeNpcMood(
    {
      ...target,
      morality,
      trust,
      affection,
      romanceStatus,
      partyRelation,
      lastIntent,
      intentSuspected,
      isWantedByPlayer,
    },
    {
      eventBias,
      locationMood: locMood,
    }
  );

  const nextContacts = contacts.map((c) => {
    if (c.id === target.id) {
      return {
        ...c,
        morality,
        trust,
        affection,
        mood: nextMoodNpc,
        romanceStatus,
        partyRelation,
        currentLocationId,
        currentMazgalId,
        lastIntent,
        lastReaction,
        intentSuspected,
        stoleFromPlayerSilver,
        isWantedByPlayer,
        lastUpdatedMs: nextTimeMs,
        memoryNotes,
      };
    }
    if (action === 'join_npc_party' || action === 'take_hire_offer') {
      if (c.partyRelation !== 'independent') {
        return { ...c, partyRelation: 'independent' as const };
      }
    }
    if (action === 'invite_companion' || action === 'hire_npc') {
      if (c.partyRelation === 'party_leader' || c.partyRelation === 'hired_player') {
        return { ...c, partyRelation: 'independent' as const };
      }
    }
    return c;
  });

  if (currentLocation && (action === 'talk' || action === 'share_ration') && morality >= 0) {
    reputation[target.faction] = clamp((reputation[target.faction] ?? 0) + 1, -100, 100);
  }

  const nextPartyMode = derivePartyMode(nextContacts);
  const nextMood = computeProtagonistMood(
    health,
    stamina,
    protagonist.hunger,
    currentCell.safetyScore
  );

  const placeLabel = currentLocation?.name ?? `Mazgal ${currentCell.id}`;
  const trustDelta = trust - prevTrust;
  const affectionDelta = affection - prevAffection;
  const milestone = evaluateRelationshipMilestone({
    prevTrust,
    nextTrust: trust,
    prevRomance,
    nextRomance: romanceStatus,
    prevPartyRelation,
    nextPartyRelation: partyRelation,
    category: momentCategory,
    significance: momentSignificance,
    title: momentTitle,
  });
  const nextMoments = appendNpcMoment(
    protagonist.npcMoments,
    createNpcMomentRecord({
      npcId: target.id,
      npcName: target.name,
      npcRole: target.role,
      timestamp: ts,
      timestampMs: nextTimeMs,
      locationLabel: placeLabel,
      category: momentCategory,
      title: momentTitle,
      summary: lastReaction,
      trustDelta: trustDelta !== 0 ? trustDelta : undefined,
      trustAfter: trust,
      affectionDelta: affectionDelta !== 0 ? affectionDelta : undefined,
      moodAfter: nextMoodNpc,
      significance: milestone.isMilestone ? 'kritik' : momentSignificance,
      isMilestone: milestone.isMilestone || undefined,
      milestoneLabel: milestone.milestoneLabel,
    })
  );

  const nextJournal =
    hoursSpent > 0 || action !== 'talk'
      ? pushJournal(protagonist.journal, {
          id: `pj-npc-${Date.now()}`,
          timestamp: ts,
          kind: 'Konuşma',
          locationLabel: placeLabel,
          title: journalTitle,
          detail: feedbackText,
        })
      : protagonist.journal;

  return {
    nextProtagonist: {
      ...protagonist,
      health,
      stamina,
      rations,
      silver,
      playerMorality,
      bountySilver,
      bountyFactions,
      mood: nextMood,
      activeConditions,
      reputation,
      lastDialogue: `${target.name}: ${lastReaction}`,
      lastUpdatedMs: nextTimeMs,
      partyMode: nextPartyMode,
      contacts: nextContacts,
      npcMoments: nextMoments,
      journal: nextJournal,
    },
    feedbackText,
    hoursSpent,
    locationMoraleDelta: locationMoraleDelta || undefined,
    locationNoteTitle,
    locationNoteDetail,
  };
}

export function advancePartyAndContactsWithTime(
  protagonist: ProtagonistState,
  locations: MapLocation[],
  routes: MapRoute[],
  prevTimeMs: number,
  nextTimeMs: number
): ProtagonistState {
  const contacts = protagonist.contacts ?? [];
  if (contacts.length === 0) return protagonist;

  const prevDay = Math.floor((prevTimeMs - INITIAL_GAME_TIME_MS) / (24 * 60 * 60 * 1000));
  const nextDay = Math.floor((nextTimeMs - INITIAL_GAME_TIME_MS) / (24 * 60 * 60 * 1000));
  const daysCrossed = Math.max(0, nextDay - prevDay);
  const hoursPassed = (nextTimeMs - prevTimeMs) / (60 * 60 * 1000);
  const phase = getDayPhaseLabel(nextTimeMs);
  const isNight = phase === 'Gece' || phase === 'Alacakaranlık';

  const currentLoc = protagonist.locationId
    ? locations.find((l) => l.id === protagonist.locationId)
    : undefined;
  const isDangerousPlace =
    !currentLoc ||
    currentLoc.dangerLevel >= 3 ||
    currentLoc.livingState?.archetype === 'bandit_hamlet' ||
    currentLoc.livingState?.archetype === 'smuggler_cove' ||
    currentLoc.livingState?.archetype === 'goblin_burrow' ||
    currentLoc.livingState?.mood === 'Korkulu';

  let silver = protagonist.silver;
  let health = protagonist.health;
  let stamina = protagonist.stamina;
  let rations = protagonist.rations;
  let extraJournalNote: string | null = null;
  const ts = formatGameDateTime(nextTimeMs);
  const placeLabel = currentLoc?.name ?? `Mazgal ${protagonist.mazgalId}`;
  const tickMoments: NpcMemoryMoment[] = [];

  const adj = new Map<string, string[]>();
  for (const r of routes) {
    const a = adj.get(r.fromId) ?? [];
    a.push(r.toId);
    adj.set(r.fromId, a);
    const b = adj.get(r.toId) ?? [];
    b.push(r.fromId);
    adj.set(r.toId, b);
  }

  const nextContacts = contacts.map((c) => {
    let morality = getNpcMorality(c);

    // 1) Active party members / employer / leader move with protagonist!
    if (c.partyRelation !== 'independent') {
      const startTrust = clamp(c.trust, 0, 100);
      let updatedTrust = startTrust;
      let updatedRel: NpcPartyRelation = c.partyRelation;
      let updatedReaction = c.lastReaction;
      let updatedIntent = c.lastIntent;
      let updatedMemoryNotes = c.memoryNotes;
      let nextLocId: string | null = protagonist.locationId;
      let nextMazgalId = protagonist.mazgalId;
      let tickBias: NpcMoodEventBias = 'default';
      let notableMoment: {
        category: NpcMomentCategory;
        title: string;
        summary: string;
        significance: 'kritik' | 'önemli' | 'olağan';
      } | null = null;

      if (daysCrossed > 0) {
        if (c.partyRelation === 'hired_by_player') {
          const totalWage = c.dailyWageSilver * daysCrossed;
          if (silver >= totalWage) {
            silver -= totalWage;
            updatedTrust = clamp(updatedTrust + daysCrossed, 0, 100);
            updatedReaction = `Günlük ${c.dailyWageSilver} Gümüş ücreti ödendi (Toplam ${totalWage} Gümüş).`;
          } else {
            updatedTrust = clamp(updatedTrust - 14, 0, 100);
            updatedRel = 'independent';
            updatedIntent = 'Kuşkulu Mesafe';
            tickBias = 'unpaid';
            updatedReaction = `Ücretini (${totalWage} Gümüş) ödeyemediğin için ${c.name} yolunu ayırdı!`;
            updatedMemoryNotes = pushMemory(updatedMemoryNotes, updatedReaction);
            extraJournalNote = updatedReaction;
            notableMoment = {
              category: 'Parti / Sözleşme',
              title: `${c.name} Ücret Ödenmeyince Ayrıldı`,
              summary: updatedReaction,
              significance: 'önemli',
            };
          }
        } else if (c.partyRelation === 'hired_player') {
          if (morality <= -50 && Math.random() < 0.45) {
            // Corrupt employer abuses, skimps pay or throws player into dangerous labor
            stamina = Math.max(5, stamina - 12);
            health = Math.max(5, health - (isDangerousPlace ? 10 : 0));
            updatedIntent = 'Seni Kullanmaya Çalışıyor';
            updatedReaction = `${c.name} seni tehlikeli yük ve gözcü işine sürdü (-12 Zindelik) ama "zarar yazdık" diyerek günlük ücretini kıstı!`;
            updatedMemoryNotes = pushMemory(updatedMemoryNotes, updatedReaction);
            extraJournalNote = updatedReaction;
            notableMoment = {
              category: 'İhanet / Gasp',
              title: `${c.name} Ücretini Kısıp Ağır İşe Sürdü`,
              summary: updatedReaction,
              significance: 'önemli',
            };
          } else {
            const earned = c.dailyWageSilver * daysCrossed + (morality >= 55 ? 2 : 0);
            silver += earned;
            updatedReaction = `${c.name} günlük anlaşma gereği sana ${earned} Gümüş ödedi.`;
            extraJournalNote = updatedReaction;
          }
        }
      }

      let stolenTotal = c.stoleFromPlayerSilver ?? 0;
      let wantedByPlayer = c.isWantedByPlayer ?? false;

      // Midnight / wilderness betrayal by severely corrupt companions (-55 or worse)
      if (
        updatedRel !== 'independent' &&
        morality <= -55 &&
        (isNight || isDangerousPlace) &&
        hoursPassed >= 3 &&
        Math.random() < 0.28
      ) {
        const stolenSilver = silver > 0 ? Math.max(Math.min(silver, 3), Math.round(silver * 0.6)) : 0;
        const stolenRation = Math.min(rations, 2);
        const stabDmg = 12 + rollDie(12);
        silver = Math.max(0, silver - stolenSilver);
        rations = Math.max(0, rations - stolenRation);
        health = Math.max(5, health - stabDmg);
        updatedRel = 'independent';
        updatedTrust = clamp(updatedTrust - 38, 0, 100);
        updatedIntent = 'Gasp ve İhanet';
        tickBias = 'betrayal';
        if (stolenSilver > 0) {
          stolenTotal += stolenSilver;
          wantedByPlayer = true;
        }

        const flee = moveNpcAwayOnRoutes(protagonist.locationId, routes, locations);
        nextLocId = flee.nextLocId;
        nextMazgalId = flee.nextMazgalId;

        updatedReaction = `${c.name} ${isNight ? 'gece nöbetinde' : 'ıssız yolda'} gerçek yüzünü gösterdi: seni yaralayıp (-${stabDmg} Can) ${stolenSilver} Gümüş ve ${stolenRation} Erzak çalarak kaçtı!`;
        updatedMemoryNotes = pushMemory(updatedMemoryNotes, updatedReaction);
        extraJournalNote = updatedReaction;
        notableMoment = {
          category: 'İhanet / Gasp',
          title: `${c.name} Yolda İhanet Edip Kaçtı`,
          summary: updatedReaction,
          significance: 'kritik',
        };
      } else if (
        updatedRel !== 'independent' &&
        morality <= -20 &&
        morality > -55 &&
        daysCrossed > 0 &&
        Math.random() < 0.3
      ) {
        const skimmed = Math.min(silver, 3);
        if (skimmed > 0) {
          silver -= skimmed;
          updatedIntent = 'Kandırma Peşinde';
          updatedReaction = `Yol molasında kesende ${skimmed} Gümüş eksik olduğunu fark ettin; ${c.name} gözlerini kaçırıyor.`;
          updatedMemoryNotes = pushMemory(updatedMemoryNotes, updatedReaction);
          extraJournalNote = updatedReaction;
          notableMoment = {
            category: 'İhanet / Gasp',
            title: `${c.name} Kesenden Gümüş Aşırdı`,
            summary: updatedReaction,
            significance: 'önemli',
          };
        }
      }

      // Self-sacrificing / noble / loving companion protects & heals in crisis
      if (
        updatedRel !== 'independent' &&
        (morality >= 50 || c.romanceStatus === 'Sevgili / Bağlı') &&
        (daysCrossed > 0 || hoursPassed >= 6) &&
        (health <= 55 || rations === 0 || stamina <= 30)
      ) {
        const healAmt = morality >= 70 ? 16 : 9;
        if (rations === 0) rations += 1;
        if (health <= 55) health = Math.min(100, health + healAmt);
        if (stamina <= 30) stamina = Math.min(100, stamina + 12);
        updatedTrust = clamp(updatedTrust + 4, 0, 100);
        updatedIntent = morality >= 70 ? 'Kendi Canını Feda Eder' : 'Acıyor ve Kolluyor';
        tickBias = 'positive';
        updatedReaction = `${c.name} bitkin haline dayanamayıp gece nöbetini tek başına tuttu, yaranı sardı (+${healAmt} Can) ve erzak paylaştı.`;
        updatedMemoryNotes = pushMemory(updatedMemoryNotes, updatedReaction);
        extraJournalNote = updatedReaction;
        notableMoment = {
          category: 'Yardım / Fedakârlık',
          title: `${c.name} Kriz Anında Seni Korudu`,
          summary: updatedReaction,
          significance: 'kritik',
        };
      }

      const updatedMood = computeNpcMood(
        {
          ...c,
          morality,
          trust: updatedTrust,
          partyRelation: updatedRel,
          lastIntent: updatedIntent,
          isWantedByPlayer: wantedByPlayer,
        },
        {
          eventBias: tickBias,
          locationMood: currentLoc?.livingState?.mood,
        }
      );

      if (notableMoment) {
        const tickMilestone = evaluateRelationshipMilestone({
          prevTrust: startTrust,
          nextTrust: updatedTrust,
          prevRomance: c.romanceStatus,
          nextRomance: c.romanceStatus,
          prevPartyRelation: c.partyRelation,
          nextPartyRelation: updatedRel,
          category: notableMoment.category,
          significance: notableMoment.significance,
          title: notableMoment.title,
        });
        tickMoments.push(
          createNpcMomentRecord({
            npcId: c.id,
            npcName: c.name,
            npcRole: c.role,
            timestamp: ts,
            timestampMs: nextTimeMs,
            locationLabel: placeLabel,
            category: notableMoment.category,
            title: notableMoment.title,
            summary: notableMoment.summary,
            trustDelta: updatedTrust !== startTrust ? updatedTrust - startTrust : undefined,
            trustAfter: updatedTrust,
            moodAfter: updatedMood,
            significance: tickMilestone.isMilestone ? 'kritik' : notableMoment.significance,
            isMilestone: tickMilestone.isMilestone || undefined,
            milestoneLabel: tickMilestone.milestoneLabel,
          })
        );
      }

      return {
        ...c,
        morality,
        currentLocationId: nextLocId,
        currentMazgalId: nextMazgalId,
        trust: updatedTrust,
        mood: updatedMood,
        partyRelation: updatedRel,
        lastIntent: updatedIntent,
        lastReaction: updatedReaction,
        stoleFromPlayerSilver: stolenTotal,
        isWantedByPlayer: wantedByPlayer,
        memoryNotes: updatedMemoryNotes,
        lastUpdatedMs: nextTimeMs,
      };
    }

    // 2) Independent NPCs live on the map: environment nudges their morality & they roam routes!
    const homeOrCurrentLoc = c.currentLocationId
      ? locations.find((l) => l.id === c.currentLocationId)
      : undefined;

    if (daysCrossed > 0 && homeOrCurrentLoc?.livingState) {
      const lArch = homeOrCurrentLoc.livingState.archetype;
      const lMood = homeOrCurrentLoc.livingState.mood;
      if (lArch === 'bandit_hamlet' || lArch === 'smuggler_cove' || lMood === 'Korkulu') {
        morality = clamp(morality - 1, -100, 100);
      } else if (lMood === 'Mutlu' || lMood === 'Huzurlu') {
        if (morality < 50 && morality > -70) {
          morality = clamp(morality + 1, -100, 100);
        }
      }
    }

    if (hoursPassed >= 6 && c.currentLocationId && Math.random() < 0.16) {
      const neighbors = adj.get(c.currentLocationId) ?? [];
      if (neighbors.length > 0) {
        const destId = neighbors[Math.floor(Math.random() * neighbors.length)];
        const destLoc = locations.find((l) => l.id === destId);
        if (destLoc && destLoc.category !== 'burrow') {
          const destCell = getCellForCoords(destLoc.x, destLoc.y).id;
          const updatedMood = computeNpcMood(
            { ...c, morality },
            { locationMood: destLoc.livingState?.mood }
          );
          return {
            ...c,
            morality,
            mood: updatedMood,
            currentLocationId: destLoc.id,
            currentMazgalId: destCell,
            lastUpdatedMs: nextTimeMs,
          };
        }
      }
    }

    const updatedMood = computeNpcMood(
      { ...c, morality },
      { locationMood: homeOrCurrentLoc?.livingState?.mood }
    );

    return {
      ...c,
      morality,
      mood: updatedMood,
    };
  });

  const nextPartyMode = derivePartyMode(nextContacts);
  const nextMoments =
    tickMoments.length > 0
      ? [...tickMoments, ...(protagonist.npcMoments ?? [])].slice(0, MAX_NPC_MOMENTS)
      : protagonist.npcMoments;

  const nextJournal = extraJournalNote
    ? pushJournal(protagonist.journal, {
        id: `pj-pty-${Date.now()}`,
        timestamp: ts,
        kind: 'Durum',
        locationLabel: placeLabel,
        title: 'Parti ve İlişki Gelişmesi',
        detail: extraJournalNote,
      })
    : protagonist.journal;

  return {
    ...protagonist,
    health,
    stamina,
    rations,
    silver,
    partyMode: nextPartyMode,
    contacts: nextContacts,
    npcMoments: nextMoments,
    journal: nextJournal,
  };
}
