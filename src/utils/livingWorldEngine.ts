import type {
  MapLocation,
  MapRoute,
  ProtagonistState,
  SettlementArchetype,
  SettlementEventRecord,
  SettlementLivingState,
  SettlementMood,
  SettlementProblem,
  SettlementResident,
} from '../types/map';
import { INITIAL_GAME_TIME_MS, formatGameDateTime } from './gameTime';
import {
  generateProceduralLivingProblem,
  generateProceduralRumorText,
  type ProceduralSceneCard,
} from './proceduralWorldDeck';
import { getFactionForLocation } from './protagonistEngine';

export const SIMULATION_TICK_MS = 12 * 60 * 60 * 1000; // 12 saatlik dünya adımı
const MAX_TICKS_PER_JUMP = 16; // Tek sıçramada en fazla 16 adım (8 gün)
const MAX_CHRONICLE = 8;
const MAX_RUMORS = 3;
const MAX_ACTIVE_PROBLEMS = 2;
const MAX_NOTABLE_RESIDENTS = 5;
const MAX_DYNAMIC_HOOKS = 4;

interface RumorTemplate {
  id: string;
  text: string;
  moodImpact: number;
  questHook?: string;
}

interface ProblemTemplate {
  id: string;
  title: string;
  description: string;
  severity: 'Düşük' | 'Orta' | 'Yüksek';
  moodImpact: number;
  villagerSolveDetail: string;
  questHook: string;
}

interface HeroCandidate {
  id: string;
  name: string;
  role: string;
  trait: string;
  renownTemplate: (problemTitle: string) => string;
}

interface MilestoneTemplate {
  id: string;
  kind: 'Yaşam' | 'Çözüm';
  title: string;
  detail: string;
  moodImpact: number;
  establishmentToAdd?: string;
  populationDelta?: number;
  residentToAdd?: Omit<SettlementResident, 'addedAt'>;
  questHook: string;
}

interface ArchetypeBlueprint {
  labels: {
    heading: string;
    problemsHeading: string;
    noProblemsText: string;
    rumorsHeading: string;
    residentsHeading: string;
    establishmentsHeading: string;
    chronicleHeading: string;
  };
  routines: {
    morning: { peaceful: string; fearful: string; happy: string };
    midday: { peaceful: string; fearful: string; happy: string };
    evening: { peaceful: string; fearful: string; happy: string };
    night: { peaceful: string; fearful: string; happy: string };
  };
  rumors: RumorTemplate[];
  problems: ProblemTemplate[];
  heroes: HeroCandidate[];
  milestones: MilestoneTemplate[];
  baselineMorale: number;
  milestoneCooldownTicks: number;
}

const ARCHETYPE_BLUEPRINTS: Record<SettlementArchetype, ArchetypeBlueprint> = {
  border_fortress: {
    labels: {
      heading: 'Yaşayan Kale ve Garnizon Durumu',
      problemsHeading: 'Garnizon ve Sınır Sorunları',
      noProblemsText: 'Surlar sağlam ve sınır ikmali düzenli; nöbetler olağan akışında.',
      rumorsHeading: 'Kale İçi Duyumlar ve Raporlar',
      residentsHeading: 'Öne Çıkan Asker ve Kasabalılar',
      establishmentsHeading: 'Kale İçi Yapılar ve İşletmeler',
      chronicleHeading: 'Kale Olay Kaydı',
    },
    baselineMorale: 70,
    milestoneCooldownTicks: 8,
    routines: {
      morning: {
        peaceful: 'Palizad kapıları açıldı; Komutan Balthor doğu yolu devriyesini ve Derebaşı kervanını uğurluyor.',
        fearful: 'Kapılar yalnızca tek kanattan açılıyor; sur üstündeki okçular batı ve kuzey yolunu çift vardiya gözetliyor.',
        happy: 'Sabah borusuyla kapılar açıldı; Kulova’dan gelen yün arabaları ve Derebaşı kerestecileri avluda pazar kurdu.',
      },
      midday: {
        peaceful: 'Demirci Mira’nın örsünden çekiç sesleri yükseliyor; taş meydandaki esir ve köle pazarında kâtip Varen yeni borçlu sözleşmelerini mühürlüyor.',
        fearful: 'Avluda silah talimi hızlandırılmış; hancı Torin erzak fıçılarını sur içine çektiriyor.',
        happy: 'Pazar ve köle tezgâhları dolu; tüccarlar Gümüş Köprü’ye gidecek kervan için rehber ve hamal kiralıyor.',
      },
      evening: {
        peaceful: 'Devriye atları ahırlara çekiliyor, sur meşaleleri yakılıyor ve handa sıcak yahni kazanları kaynıyor.',
        fearful: 'Hava kararmadan kapı sürgüleri indiriliyor; sivil halk evlerine çekilip devriye parolasını bekliyor.',
        happy: 'Handa yolcular ve muhafızlar doğu ormanından gelen haberleri konuşuyor; demir kapı nöbeti düzenli.',
      },
      night: {
        peaceful: 'Dış kulelerde fener nöbeti sürüyor; avluda yalnızca nöbet değişimi yapan iki muhafızın adımları duyuluyor.',
        fearful: 'Sur boyunca ek meşaleler yakılmış; en küçük çalı hışırtısında kulelerden okçular uyarılıyor.',
        happy: 'Kale içinde ateşler sakin yanıyor; fırtına fenerleri altında gece nöbeti sorunsuz geçiyor.',
      },
    },
    rumors: [
      {
        id: 'bf-rum-1',
        text: 'Kuzeydeki Batakhan yolundan dönen izci, vergi arabasının haftalardır görünmediğini komutanlığa bildirmiş.',
        moodImpact: -5,
        questHook: 'Komutan Balthor’dan Batakhan’da kaybolan vergi arabası için resmi görev almak.',
      },
      {
        id: 'bf-rum-2',
        text: 'Derebaşı’ndan gelen salcılar Gümüş Köprü’ye kadar nehrin sakin aktığını, yük taşımanın kolaylaştığını söylemiş.',
        moodImpact: +5,
      },
      {
        id: 'bf-rum-3',
        text: 'Güneybatıdaki Paslıçukur İnleri tarafından gece vakti duman yükseldiği gözcü raporuna yazılmış.',
        moodImpact: -6,
        questHook: 'Güney sınırındaki goblin hareketliliğini gözetlemek üzere keşif koluna katılmak.',
      },
      {
        id: 'bf-rum-4',
        text: 'Külköy esir pazarına batıdan iki borçlu arabacı ile devriyelerin yakaladığı üç kuzeyli haydut getirilmiş.',
        moodImpact: +2,
      },
    ],
    problems: [
      {
        id: 'bf-prob-palisade',
        title: 'Doğu Sur Palizadında Çürüme',
        description: 'Nemli sis yüzünden doğu kapısının yanındaki beş kalın kütük direk yumuşamış; acil kereste değişimi gerekiyor.',
        severity: 'Orta',
        moodImpact: -6,
        villagerSolveDetail: 'Derebaşı’ndan getirilen taze meşe kütükleriyle kale marangozları doğu surunu bir günde yeniledi.',
        questHook: 'Derebaşı’ndan kaleye sağlam sur kütüğü taşınmasına eşlik etmek.',
      },
      {
        id: 'bf-prob-caravan-raid',
        title: 'Geciken Tuz Kervanı',
        description: 'Büyük Doğu Yolu’ndan Gümüş Köprü’ye giden tuz arabası vaktinde dönmedi; yolda araba kırığı veya pusu ihtimali var.',
        severity: 'Yüksek',
        moodImpact: -9,
        villagerSolveDetail: 'Kaleden çıkan atlı devriye kırık dingili ormanda bulup kervanı sağ salim kaleye çekti.',
        questHook: 'Büyük Doğu Yolu boyunca kayıp tuz kervanının izini sürmek.',
      },
      {
        id: 'bf-prob-grain',
        title: 'Kışlık Tahıl Ambarında Nem',
        description: 'Yağmur sonrası ambar çatısından sızan su iki çuval unu bozdu; fırıncılar yeni tahıl sevkiyatı bekliyor.',
        severity: 'Düşük',
        moodImpact: -4,
        villagerSolveDetail: 'Kasaba halkı ambarı boşaltıp kiremitleri aktardı; Kulova’dan ek arpa unu alındı.',
        questHook: 'Kasaba ambarı için çevre köylerden kuru erzak temin etmek.',
      },
    ],
    heroes: [
      {
        id: 'bf-h-tarik',
        name: 'Onbaşı Tarık',
        role: 'Sınır Devriye Çavuşu',
        trait: 'Yol haritalarını ezbere bilir, gece yürüyüşünde disiplinli',
        renownTemplate: (p) => `${p} sırasında garnizon ekibini yönetip komutandan takdir aldı.`,
      },
      {
        id: 'bf-h-selin',
        name: 'İzci Selin',
        role: 'Doğu Yolu Kılavuzu',
        trait: 'Siste araba tekeri ve goblin ayak izini kolayca ayırır',
        renownTemplate: (p) => `${p} meselesinde iz sürerek kalede adını duyurdu.`,
      },
      {
        id: 'bf-h-kaan',
        name: 'Demirci Kaan',
        role: 'Mira’nın Baş Kalfası',
        trait: 'Kapı menteşesinden mızrak ucuna kadar her demir işi hızlıca çıkarır',
        renownTemplate: (p) => `${p} onarımında gece gündüz çalışıp kasabada saygı kazandı.`,
      },
    ],
    milestones: [
      {
        id: 'bf-ms-stables',
        kind: 'Yaşam',
        title: 'Kervan Ahırı Genişletildi',
        detail: 'Doğu yolcuları arttığı için Hancı Torin’in avlusuna altı atlık yeni ahır sundurması eklendi.',
        moodImpact: +7,
        establishmentToAdd: 'Genişletilmiş Kervan Ahırı',
        questHook: 'Yeni kervan ahırında at nallatan doğulu rehberden harita bilgisi almak.',
      },
      {
        id: 'bf-ms-archers',
        kind: 'Çözüm',
        title: 'Gönüllü Okçu Nöbeti Kuruldu',
        detail: 'Kasabalı avcılar haftada iki gece kule nöbetine destek vermeye başladı; sur güvenliği arttı.',
        moodImpact: +8,
        populationDelta: 3,
        questHook: 'Gönüllü okçuların güney orman kenarında gördüğü hareketliliği araştırmak.',
      },
    ],
  },

  shepherd_village: {
    labels: {
      heading: 'Yaşayan Köy Durumu',
      problemsHeading: 'Köy Sorunları',
      noProblemsText: 'Şu anda köyde acil bir sorun yok; halk günlük işlerine odaklanıyor.',
      rumorsHeading: 'Köy Dedikoduları ve Duyumlar',
      residentsHeading: 'Nam Yapan Köylüler ve Yeni Sakinler',
      establishmentsHeading: 'Köydeki İşletmeler ve Yapılar',
      chronicleHeading: 'Köy Olay Kaydı',
    },
    baselineMorale: 66,
    milestoneCooldownTicks: 8,
    routines: {
      morning: {
        peaceful: 'Sabah sağımı yapılıyor, bakır güğümler taşınıyor ve koyun sürüleri sırt eteklerindeki otlağa sürülüyor.',
        fearful: 'Sürüler taş ağıllardan yalnızca iki silahlı çoban ve köpekler eşliğinde çıkarılıyor; kuledeki gözcü kuzey yolunu dürbünlüyor.',
        happy: 'Taş ağılların kapıları neşeyle açıldı; koyunlar sağılıyor, taze peynirler mahzene indiriliyor ve sürüler rüzgarlı meraya çıkıyor.',
      },
      midday: {
        peaceful: 'Dokuma tezgahlarından ritmik sesler geliyor; Helga keçe yünleri boyuyor, çobanlar merada kaval ve köpek sesleriyle sürüyü topluyor.',
        fearful: 'Kadınlar dokuma damında kapılar yarı aralık çalışırken, erkekler ahşap çitleri ve kule merdivenlerini sağlamlaştırıyor.',
        happy: 'Kırkım yünleri güneşte kurutuluyor; Külköy’den gelen katırcılarla peynir ve keçe takası yapılıyor.',
      },
      evening: {
        peaceful: 'Meradan dönen sürüler taş ağıllara alınıyor, kırkım yünleri balyalanıyor ve akşam çorbası için büyük ocaklar tutuşturuluyor.',
        fearful: 'Hava kararmadan sürüler aceleyle taş ağıla çekiliyor; Muhtar Doren hane kapılarının sürgülerini ve meşale yağlarını kontrol ediyor.',
        happy: 'Akşam ocağında otlu peynir ve sıcak arpa çorbası paylaşılıyor; çocuklar ağıl duvarında oynuyor.',
      },
      night: {
        peaceful: 'Sürüler taş ağıllarda uyuyor; ahşap gözcü kulesinde fener nöbeti tutuluyor, çoban köpekleri çit çevresinde devriye geziyor.',
        fearful: 'Tüm köy kapıları sıkıca sürgülü; ahşap gözcü kulesinde iki fenerli nöbetçi kuzeydeki Batakhan patikasını tetikte izliyor.',
        happy: 'Kulede tek gözcü feneri yanarken köy huzur içinde dinleniyor; köpekler sürünün başında sakin.',
      },
    },
    rumors: [
      {
        id: 'sv-rum-1',
        text: 'Gece nöbetçisi kuzeydeki Batakhan yolu yönünden birkaç atlı geçtiğini görmüş; kimse köyün içine girmemiş.',
        moodImpact: -5,
        questHook: 'Batakhan yolundaki gece atlılarının izini sürmek ve kim olduklarını öğrenmek.',
      },
      {
        id: 'sv-rum-2',
        text: 'Külköy Sınır Kalesi garnizonu kış öncesi kalın keçe pelerin ve yün çorap için ön ödeme göndermiş.',
        moodImpact: +6,
        questHook: 'Külköy’e gidecek yün yük arabasına eşlik ederek sınır devriyesiyle tanışmak.',
      },
      {
        id: 'sv-rum-3',
        text: 'Doğu sınırındaki Söğütlü Bataklık’tan dönen ot toplayıcı Soren, sazlıklarda eski bir araba tekerleği bulduğunu anlatıyor.',
        moodImpact: 0,
        questHook: 'Ot toplayıcı Soren’den Söğütlü Bataklık’taki batık kervanın yerini öğrenmek.',
      },
      {
        id: 'sv-rum-4',
        text: 'Çoban İlyas’ın genç kangal köpeği sisin içinde kaybolan dört kuzuyu tek başına ağıla geri getirmiş; köyde keyifler yerinde.',
        moodImpact: +5,
      },
      {
        id: 'sv-rum-5',
        text: 'Kuzey yamaçtaki taş sırtlarda dün gece iki kez kurt uluması duyulmuş; sürüleri erkenden ağıla çekmek konuşuluyor.',
        moodImpact: -4,
        questHook: 'Kuzey yamacındaki kurt sürüsünün ini veya göç yönünü araştırmak.',
      },
    ],
    problems: [
      {
        id: 'sv-prob-theft',
        title: 'Gece Ağıl Hırsızlığı',
        description: 'Kuzey yamacındaki taş ağıldan üç koyun sessizce çalınmış. Çitin yanında çamurlu yabancı çizme izleri ve kuzeye uzanan ayak izleri var.',
        severity: 'Yüksek',
        moodImpact: -10,
        villagerSolveDetail: 'Köylüler gece fenerli pusu kurup kuzeyden sızan iki hırsızı taş ağılın önünde kovalayarak sürüyü geri kurtardı.',
        questHook: 'Çalınan koyunların izini Batakhan yönüne doğru takip etmek.',
      },
      {
        id: 'sv-prob-wolf',
        title: 'Meraya İnen Kurt İzi',
        description: 'Sisin yoğunlaştığı sabah saatlerinde kuzey orman kenarından iki gri kurt meraya kadar inmiş; çobanlar sürüleri uzak otlağa çıkaramıyor.',
        severity: 'Orta',
        moodImpact: -8,
        villagerSolveDetail: 'Köyün genç avcıları ve çoban köpekleri merayı tarayıp kurtların sığındığı kayalık yarığı dumanla boşalttı.',
        questHook: 'Merayı tehdit eden gri kurt sürüsünü uzaklaştırıp ödül almak.',
      },
      {
        id: 'sv-prob-roof',
        title: 'Dokuma Damında Çatı Akıntısı',
        description: 'Sert doğu rüzgarı ve soğuk çiy yağmuru Helga’nın yün dokuma damının kuzey kiremitlerini kaydırmış; yün balyaları nem kapma tehlikesinde.',
        severity: 'Düşük',
        moodImpact: -4,
        villagerSolveDetail: 'Köy halkı imece usulü toplanıp sağlam çam kalasları ve kuru otlarla damın çatısını yağmurdan önce onardı.',
        questHook: 'Dokuma damı onarımı için sağlam çam kerestesi sağlamak.',
      },
      {
        id: 'sv-prob-fountain',
        title: 'Taş Çeşme Oluğu Tıkandı',
        description: 'Yukarı dereden su getiren ahşap oluk çamurla ve devrik dallarla dolmuş; hem hanelere hem hayvan yalaklarına bulanık su akıyor.',
        severity: 'Düşük',
        moodImpact: -5,
        villagerSolveDetail: 'Sabahın ilk ışığında dere başına çıkan köylüler oluktaki devrik kütüğü temizleyip temiz suyu tekrar bağladı.',
        questHook: 'Dere başındaki tıkanıklığın yukarısında yuva yapan kunduzları incelemek.',
      },
    ],
    heroes: [
      {
        id: 'sv-h-altan',
        name: 'Genç Çoban Altan',
        role: 'Sürü İzci ve Sapan Ustası',
        trait: 'Siste yolunu kaybetmez, taş sapanını isabetle kullanır',
        renownTemplate: (p) => `${p} meselesinde ön safa çıkıp köyde nam saldı.`,
      },
      {
        id: 'sv-h-suna',
        name: 'Dokumacı Suna',
        role: 'İmece Öncüsü ve Şifacı Çırağı',
        trait: 'Soğukkanlı, el becerisi yüksek ve tüm hanelerce sayılan bir kadın',
        renownTemplate: (p) => `${p} sırasında köy halkını örgütleyip krizi çözdü.`,
      },
      {
        id: 'sv-h-demir',
        name: 'Kılavuz Demir',
        role: 'Kuzey Sınır Gözcüsü',
        trait: 'Batakhan tarafındaki patikaları ve kurt izlerini avucunun içi gibi bilir',
        renownTemplate: (p) => `${p} olayında gece nöbetiyle köyü koruyup ün kazandı.`,
      },
      {
        id: 'sv-h-merve',
        name: 'Çoban Merve',
        role: 'Sürü Sahibi ve Köpek Eğiticisi',
        trait: 'Üç çoban köpeğini tek ıslıkla yönetir',
        renownTemplate: (p) => `${p} sırasında köpekleriyle tehlikeyi savuşturup nam yaptı.`,
      },
    ],
    milestones: [
      {
        id: 'sv-ms-inn',
        kind: 'Yaşam',
        title: 'Küçük Çoban Ocağı (Han) Açıldı',
        detail: 'Köyden Dul Ayla ve kardeşi, meydandaki taş ahırın yanına Külköy yolcuları için sıcak çorba ve yatak veren mütevazı bir han açtı.',
        moodImpact: +9,
        establishmentToAdd: 'Ayla’nın Çoban Ocağı (Yolcu Hanı)',
        residentToAdd: {
          id: 'sv-res-ayla',
          name: 'Hancı Ayla',
          role: 'Çoban Ocağı İşletmecisi',
          trait: 'Kuzeyden ve güneyden gelen her yolcunun haberini toplar',
          renownNote: 'Köyün ilk yolcu ocağını ve sıcak çorba tezgahını açtı.',
        },
        questHook: 'Yeni açılan Çoban Ocağı’nda geceleyen sessiz tüccarla tanışmak.',
      },
      {
        id: 'sv-ms-smithy',
        kind: 'Yaşam',
        title: 'Nalbant ve Kırkım Demircisi Kuruldu',
        detail: 'Genç usta Ozan, Külköy’den getirdiği örs ve körükle köyde küçük bir nalbant ocağı kurdu; artık kırkım makasları ve katır nalları köyde dövülüyor.',
        moodImpact: +8,
        establishmentToAdd: 'Ozan’ın Nalbant ve Tamir Ocağı',
        residentToAdd: {
          id: 'sv-res-ozan',
          name: 'Nalbant Ozan',
          role: 'Köy Demircisi ve Nalbant',
          trait: 'Az konuşur ama sağlam çivi, nal ve kırkım bıçağı döver',
          renownNote: 'Köye kendi imkanlarıyla küçük bir nalbant ocağı kurdu.',
        },
        questHook: 'Nalbant Ozan’ın Külköy’den beklediği ham demir çubuklarını taşımak.',
      },
      {
        id: 'sv-ms-child',
        kind: 'Yaşam',
        title: 'Köyde Yeni Bir Bebek Dünyaya Geldi',
        detail: 'Genç çoban ailesinin ilk çocuğu sağlıklı biçimde dünyaya geldi; taş evlerin kapılarına beyaz yün kurdeleler bağlandı.',
        moodImpact: +10,
        populationDelta: 1,
        questHook: 'Yeni doğan bebek şenliği sırasında köy yaşlısından eski sınır hikayeleri dinlemek.',
      },
    ],
  },

  lumber_village: {
    labels: {
      heading: 'Yaşayan Oduncu Köyü Durumu',
      problemsHeading: 'Köy ve Nehir Sorunları',
      noProblemsText: 'Su değirmeni ve kömür ocakları düzenli çalışıyor; tomruk salı hazır.',
      rumorsHeading: 'Nehir ve Orman Duyumları',
      residentsHeading: 'Nam Yapan Oduncu ve Salcılar',
      establishmentsHeading: 'Köydeki Atölye ve Ocaklar',
      chronicleHeading: 'Köy Olay Kaydı',
    },
    baselineMorale: 64,
    milestoneCooldownTicks: 8,
    routines: {
      morning: {
        peaceful: 'Baltalar bileniyor, su değirmeni çarkı dönüyor ve tomruk kızakları güney orman sınırına çekiliyor.',
        fearful: 'Oduncular ağaç kesmeye yalnız çıkmıyor; iki baltacı nöbet tutarken diğerleri yalnızca nehir kıyısındaki kütükleri işliyor.',
        happy: 'Kömür ocaklarından taze meşe kokusu yükseliyor; Tobi tomruk salını Külköy sevkiyatı için bağlıyor.',
      },
      midday: {
        peaceful: 'Testere sesleri nehir şırıltısına karışıyor; ustabaşı Mara Külköy’e gidecek kalasları damgalıyor.',
        fearful: 'Uzak çamlıktan gelen her çıtırtıda iş duruyor; köylüler nehir salını kaçış için hazır tutuyor.',
        happy: 'Kadınlar reçine ve zift kaynatıyor; salcılar Gümüş Köprü’ye gidecek kereste destelerini bağladı.',
      },
      evening: {
        peaceful: 'Odun kömürü ocaklarının ağzı toprakla kapatılıyor, işçiler sıcak fırın ekmeği için köy meydanında toplanıyor.',
        fearful: 'Orman içindeki ekipler güneş inmeden köye dönüyor; kıyıda meşale nöbeti başlıyor.',
        happy: 'İsli ocak başlarında çay ve közde balık yeniyor; yeni kereste siparişleri kutlanıyor.',
      },
      night: {
        peaceful: 'Kömür ocaklarının başında tek nöbetçi bekliyor; su değirmeni gece boyunca ağır ağır dönüyor.',
        fearful: 'Güneydeki Dev Çamlar yönüne bakan ahşap barikatta fenerli nöbetçiler tetikte bekliyor.',
        happy: 'Nehir kıyısındaki evlerde kandiller sönmüş; köy yağmurlu orman gecesinde dinleniyor.',
      },
    },
    rumors: [
      {
        id: 'lv-rum-1',
        text: 'Genç salcı Tobi nehrin doğu dirseğinde suya kapılmış kırık bir goblin mızrağı bulmuş.',
        moodImpact: -5,
        questHook: 'Nehir boyunca yukarı çıkarak goblin izcilerinin geçtiği sığ geçidi bulmak.',
      },
      {
        id: 'lv-rum-2',
        text: 'Külköy Sınır Kalesi, sur onarımı için yüksek fiyattan meşe kalası sipariş etmiş.',
        moodImpact: +6,
      },
      {
        id: 'lv-rum-3',
        text: 'Dev Çamlar sınırında tek başına dolaşan devasa bir bozayının taze pençe izleri görülmüş.',
        moodImpact: -6,
        questHook: 'Dev Çamlar sınırındaki yaşlı bozayının izini sürüp oduncuların yolunu açmak.',
      },
    ],
    problems: [
      {
        id: 'lv-prob-wheel',
        title: 'Su Değirmeni Çarkı Kırıldı',
        description: 'Nehirdeki devrik bir kütük gece su değirmeninin iki meşe kanadını kırdı; kalas biçme işi durdu.',
        severity: 'Orta',
        moodImpact: -7,
        villagerSolveDetail: 'Marangozlar dere suyunu geçici bentte kesip sağlam gürgen kanatlarla çarkı onardı.',
        questHook: 'Değirmen çarkı onarımı için nehirdeki devrik kütüğü halatla çekmek.',
      },
      {
        id: 'lv-prob-kiln',
        title: 'Kömür Ocağında Aşırı Alevlenme',
        description: 'Rüzgar ters esince iki numaralı odun kömürü ocağının bacası parladı; yakınındaki kuru tomruk yığını tehlikede.',
        severity: 'Yüksek',
        moodImpact: -8,
        villagerSolveDetail: 'Köylüler nehir kovalarıyla zincir kurup ocağı ıslak toprakla örterek yangını söndürdü.',
        questHook: 'Kömür ocaklarının yanındaki yangın riskini söndürmeye yardım etmek.',
      },
      {
        id: 'lv-prob-logjam',
        title: 'Nehir Geçidinde Tomruk Sıkışması',
        description: 'Gümüş Köprü yönüne bırakılan tomruklar kayalık dirsekte birbirine kenetlendi; su seviyesi yükseliyor.',
        severity: 'Orta',
        moodImpact: -5,
        villagerSolveDetail: 'Cesur salcılar kancalı sırıklarla sıkışan ana gövdeyi çözüp nehri yeniden açtı.',
        questHook: 'Nehir dirseğinde sıkışan tomrukları açmak için kancalı sırıklarla çalışmak.',
      },
    ],
    heroes: [
      {
        id: 'lv-h-kerem',
        name: 'Baltacı Kerem',
        role: 'Usta Tomrukçu',
        trait: 'Tek başına yarım günde koca meşeyi devirip budar',
        renownTemplate: (p) => `${p} sırasında öne çıkıp köyün en güvenilen adamı oldu.`,
      },
      {
        id: 'lv-h-ipek',
        name: 'Ziftçi İpek',
        role: 'Su Yalıtım ve Merhem Ustası',
        trait: 'Çam reçinesinden yanmaz zift ve kesik merhemi yapar',
        renownTemplate: (p) => `${p} krizinde hızlı müdahalesiyle köyde saygınlık kazandı.`,
      },
      {
        id: 'lv-h-yavuz',
        name: 'Salcı Yavuz',
        role: 'Nehir Kılavuzu',
        trait: 'Sirkad akıntısındaki her sığ kayayı tanır',
        renownTemplate: (p) => `${p} işini tek başına çözüp salcıların önderi sayıldı.`,
      },
    ],
    milestones: [
      {
        id: 'lv-ms-bakery',
        kind: 'Yaşam',
        title: 'Ortak Taş Fırın ve Aşevi Açıldı',
        detail: 'Kadınların öncülüğünde kömür ocaklarının yanına oduncular için sıcak ekmek ve çorba çıkaran ortak taş fırın kuruldu.',
        moodImpact: +8,
        establishmentToAdd: 'Oduncu Taş Fırını ve Aşevi',
        questHook: 'Taş fırında çalışan fırıncıdan Dev Çamlar’da kaybolan çırağın son sözlerini dinlemek.',
      },
      {
        id: 'lv-ms-dock',
        kind: 'Yaşam',
        title: 'Yeni Tomruk Kızak İskelesi Yapıldı',
        detail: 'Salcıların nehir yüklemesini kolaylaştıran sağlam meşe iskele tamamlandı.',
        moodImpact: +7,
        populationDelta: 2,
        questHook: 'Yeni iskeleden Gümüş Köprü’ye inen kereste salıyla hızlı yolculuk yapmak.',
      },
    ],
  },

  bandit_hamlet: {
    labels: {
      heading: 'Tekin Olmayan Köy Durumu',
      problemsHeading: 'Köy İçi Gerilim ve Sorunlar',
      noProblemsText: 'Sahte hancı ve adamları yolları gözetliyor; gerçek köylüler sessizce evlerinde.',
      rumorsHeading: 'Fısıltılar ve Yol Haberleri',
      residentsHeading: 'Köyde Öne Çıkan Şüpheli İsimler',
      establishmentsHeading: 'Köydeki Yapılar ve Gizli Noktalar',
      chronicleHeading: 'Köy Olay Kaydı',
    },
    baselineMorale: 42,
    milestoneCooldownTicks: 9,
    routines: {
      morning: {
        peaceful: 'Yıkık hanın önü sessiz; korkmuş iki köylü dere kenarından su taşırken eşkıyalar ahırda uyuyor.',
        fearful: 'Külköy tarafından atlı devriye geleceği söylentisi yüzünden eşkıyalar çalıntı malları kilere saklıyor.',
        happy: 'Sahte Hancı Vorn gece soydukları kervanın baharat ve gümüşünü ahırda keyifle bölüştürüyor.',
      },
      midday: {
        peaceful: 'Çalınmış atların nalları ahır arkasında değiştiriliyor; meydandaki paslı çan rüzgarda gıcırdıyor.',
        fearful: 'Gözcüler kuzey tepesine çıkıp Kulova yolunu izliyor; gerçek köylülere dışarı çıkma yasağı konmuş.',
        happy: 'Hanın ocağında çalıntı koyun çevriliyor; yoldan geçecek yalnız yolcular için yemlik hazırlanıyor.',
      },
      evening: {
        peaceful: 'Hanın penceresine sahte bir konuksever fener asılıyor; kiler kapısı kalın asma kilitle kapatılıyor.',
        fearful: 'Çete kendi içinde fısıltıyla tartışıyor; kapı arkalarına kazıklar dayanıyor.',
        happy: 'Zarif görünümlü sahte hancı, akşam karanlığında yaklaşan yolculara sıcak çorba daveti çıkarıyor.',
      },
      night: {
        peaceful: 'Yıkık evlerin arasında iki haydut fenerleri söndürülmüş biçimde nöbet tutuyor; kilerden boğuk sesler geliyor.',
        fearful: 'Silahlı nöbetçiler ahır çatısında bekliyor; en ufak seste hanın alt kapısından kaçmaya hazırlar.',
        happy: 'Han içinde sarhoş kahkahaları ve zar sesleri yükseliyor; köylüler karanlıkta kepenklerini kilitli tutuyor.',
      },
    },
    rumors: [
      {
        id: 'bh-rum-1',
        text: 'Ahırın altındaki taş kilerde Külköy’den gelen bir vergi memurunun zincirli tutulduğu fısıldanıyor.',
        moodImpact: -4,
        questHook: 'Ahır kilerindeki esir vergi memurunu gece sessizce kurtarmak.',
      },
      {
        id: 'bh-rum-2',
        text: 'Kulova çobanları koyun hırsızlarının izinizi bu köyün güney çalılıklarına kadar sürmüş.',
        moodImpact: -6,
        questHook: 'Kulova’dan çalınan koyunların izini Batakhan ahırlarında aramak.',
      },
      {
        id: 'bh-rum-3',
        text: 'Kuzey Dağ Geçidi’ndeki donmuş kervan enkazından çıkacak gümüş için çete içinde paylaşım kavgası çıkmış.',
        moodImpact: -3,
      },
    ],
    problems: [
      {
        id: 'bh-prob-escape',
        title: 'Kilerdeki Esir Kaçmaya Çalıştı',
        description: 'Kilerdeki esir paslı menteşeyi gevşetip dışarı seslenmeye çalıştı; nöbetçiler köy yaşlılarını sorguluyor.',
        severity: 'Yüksek',
        moodImpact: -8,
        villagerSolveDetail: 'Haydutlar kiler kapısını yeni demir sürgüyle güçlendirip nöbeti ikiye çıkardı.',
        questHook: 'Sorgu altındaki köy yaşlısına ulaşıp kiler anahtarının yerini öğrenmek.',
      },
      {
        id: 'bh-prob-patrol',
        title: 'Külköy Atlı Devriyesi Söylentisi',
        description: 'Güneyde atlı Külköy gözcülerinin görüldüğü haberi çeteyi panikletti; mallar bataklığa taşınmak isteniyor.',
        severity: 'Orta',
        moodImpact: -7,
        villagerSolveDetail: 'Devriye Kulova’dan geri dönünce çete rahatlayıp nöbeti normale döndürdü.',
        questHook: 'Panik halindeki eşkıyaların bataklığa taşıdığı çalıntı kasaları ele geçirmek.',
      },
    ],
    heroes: [
      {
        id: 'bh-h-rauf',
        name: 'Tekgöz Rauf',
        role: 'Eski Paralı Asker ve Çete Gözcüsü',
        trait: 'Paraya bakar; iyi teklif gelirse sahte hancıyı bile satabilir',
        renownTemplate: (p) => `${p} karmaşasında soğukkanlı davranıp çete içinde söz sahibi oldu.`,
      },
      {
        id: 'bh-h-zeliha',
        name: 'Sessiz Zeliha',
        role: 'Esir Köylülerin Sözcüsü',
        trait: 'Eşkıyalara fark ettirmeden yolculara gizli uyarı işareti bırakır',
        renownTemplate: (p) => `${p} sırasında iki köy çocuğunu gizlice koruyup gizli saygı kazandı.`,
      },
    ],
    milestones: [
      {
        id: 'bh-ms-tunnel',
        kind: 'Yaşam',
        title: 'Ahır Altında Gizli Kaçış Tüneli Açıldı',
        detail: 'Haydutlar olası bir kale baskınına karşı ahır samanlığının altından dere kıyısına açılan dar bir tünel kazdı.',
        moodImpact: +5,
        establishmentToAdd: 'Ahır Altı Gizli Kaçış Tüneli',
        questHook: 'Dere kıyısındaki gizli tünel ağzını bulup köydeki çeteyi arkadan basmak.',
      },
    ],
  },

  elf_canopy: {
    labels: {
      heading: 'Yaşayan Elf Yerleşimi Durumu',
      problemsHeading: 'Vadi ve Koruma Sorunları',
      noProblemsText: 'Yüksek dallar sessiz; asma köprüler sağlam ve devriye patikaları gizli.',
      rumorsHeading: 'Gözcü Raporları ve Fısıltılar',
      residentsHeading: 'Nam Yapan Elf Avcı ve Zanaatkarlar',
      establishmentsHeading: 'Ağaç Platformları ve İşlikler',
      chronicleHeading: 'Yerleşim Kaydı',
    },
    baselineMorale: 72,
    milestoneCooldownTicks: 10,
    routines: {
      morning: {
        peaceful: 'Sis çam tepelerini sararken yay kirişleri yağlanıyor; halat köprülerden reçine ve kuru meyve sepetleri taşınıyor.',
        fearful: 'Yüksek gözcü dallarından hiç inilmiyor; zemin seviyesindeki tüm izler çam iğneleriyle kapatılmış.',
        happy: 'Sedir platformlarda ince ahşap oymacılığı yapılıyor; genç okçular uzak dallar arasında sessiz atış talimi yapıyor.',
      },
      midday: {
        peaceful: 'Baş Avcı Seraphina devriyelerden rapor alıyor; marangoz Thalen asma köprü halatlarını geriyor.',
        fearful: 'Kuzeydoğudaki Çakmaktaşı Oyukları yönünden duman beklendiği için tüm yabancı geçitleri kapatılmış.',
        happy: 'Şifalı çam reçinesi merhemleri kavanozlanıyor; eski taş yazıt arşivinde kayıtlar gözden geçiriliyor.',
      },
      evening: {
        peaceful: 'Zeminle bağlantı sağlayan ip merdivenler yukarı çekiliyor; dallar arasında duman çıkarmayan küçük ocaklar yanıyor.',
        fearful: 'Hava kararmadan tüm nöbetçiler üst dallara çekiliyor; alt patikalara sessiz alarm ipleri geriliyor.',
        happy: 'Platformlarda kuru meyve ve sıcak bitki çayı eşliğinde eski orman ezgileri fısıldanıyor.',
      },
      night: {
        peaceful: 'Ay ve sis altında yüksek dallarda keskin kulaklı iki gözcü ormanı dinliyor.',
        fearful: 'Tam karartma uygulanmış; en hafif yabancı adımında yüksekten ok yağdırılmaya hazır bekleniyor.',
        happy: 'Yüksek çamların rüzgar hışırtısı eşliğinde yerleşim dingin bir gece geçiriyor.',
      },
    },
    rumors: [
      {
        id: 'ec-rum-1',
        text: 'Kuzeydoğudaki Çakmaktaşı Oyukları’ndan çıkan koboldların elinde eski bronz baltalar görülmüş.',
        moodImpact: -6,
        questHook: 'Çakmaktaşı Oyukları’ndaki kobold madeninin derinliğini araştırmak.',
      },
      {
        id: 'ec-rum-2',
        text: 'Kızılşahin Kayalıkları’ndaki elf gözcüsü doğu kıyısında kaçakçı teknelerinin fener işareti verdiğini görmüş.',
        moodImpact: -2,
        questHook: 'Doğu kıyısındaki kaçakçılar hakkında elf gözcülerinden bilgi almak.',
      },
      {
        id: 'ec-rum-3',
        text: 'Bu yıl sedir ağaçlarından toplanan şifalı reçine verimi son on yılın en kalitelisi olmuş.',
        moodImpact: +6,
      },
    ],
    problems: [
      {
        id: 'ec-prob-kobold',
        title: 'Sınırda Kobold Gece Baskını',
        description: 'Çakmaktaşı Oyukları’ndan sızan bir kobold takımı kuzey ağacının altındaki tuzakları bozup kuru et sepetini çaldı.',
        severity: 'Yüksek',
        moodImpact: -9,
        villagerSolveDetail: 'Seraphina ve genç okçular koboldları vadi sınırından geri püskürtüp yeni alarm telleri çekti.',
        questHook: 'Elf devriyesiyle işbirliği yaparak kuzey kobold gözcü kulesini susturmak.',
      },
      {
        id: 'ec-prob-bridge',
        title: 'Yüksek Asma Köprü Halatı Aşındı',
        description: 'Ağır sis nemi ana sedir platformunu bağlayan iki kenevir halatı zayıflatmış; yük taşınamıyor.',
        severity: 'Orta',
        moodImpact: -5,
        villagerSolveDetail: 'Marangoz Thalen ve yardımcıları taze yağlanmış keten halatlarla köprüyü yeniden ördü.',
        questHook: 'Yeni asma köprü için dayanıklı keten halat veya balmumu sağlamak.',
      },
    ],
    heroes: [
      {
        id: 'ec-h-elenya',
        name: 'Okçu Elenya',
        role: 'Yüksek Dal Gözcüsü',
        trait: 'Sisli havada bile 80 metreden sesin yönünü şaşırmadan vurur',
        renownTemplate: (p) => `${p} sırasında vadiyi koruyarak yaşlılardan onur yayı aldı.`,
      },
      {
        id: 'ec-h-caelen',
        name: 'Dal Yürüyücü Caelen',
        role: 'Tuzakçı ve Halat Ustası',
        trait: 'Çam dalları arasında hiç ses çıkarmadan koşar',
        renownTemplate: (p) => `${p} işini tek gecede çözüp yerleşimde adını duyurdu.`,
      },
    ],
    milestones: [
      {
        id: 'ec-ms-platform',
        kind: 'Yaşam',
        title: 'Yeni Sedir Gözcü Platformu Kuruldu',
        detail: 'Doğu vadisine bakan en yüksek çam gövdesine yeni bir ahşap gözetleme balkonu eklendi.',
        moodImpact: +7,
        establishmentToAdd: 'Doğu Vadisi Sedir Gözcü Balkonu',
        questHook: 'Yeni gözcü balkonundan Doğu Falezleri’ne kadar uzanan gizli patikayı görmek.',
      },
      {
        id: 'ec-ms-child',
        kind: 'Yaşam',
        title: 'Vadide Yeni Bir Elf Çocuğu Doğdu',
        detail: 'Uzun yıllar sonra yerleşimde ilk kez bir bebek dünyaya geldi; yüksek dallara beyaz sedir yaprakları asıldı.',
        moodImpact: +10,
        populationDelta: 1,
        questHook: 'Kutlama günü sırasında Sözcü Aelindor’dan eski taş yazıtların anlamını dinlemek.',
      },
    ],
  },

  beastkin_clan: {
    labels: {
      heading: 'Yaşayan Klan Köyü Durumu',
      problemsHeading: 'Klan ve Av Sorunları',
      noProblemsText: 'Av hayvanı bol ve tütsü ocakları dolu; klan gözcüleri kıyıda nöbette.',
      rumorsHeading: 'Avcı Haberleri ve Duyumlar',
      residentsHeading: 'Nam Yapan Klan Avcıları',
      establishmentsHeading: 'Klan Kulübeleri ve İşlikler',
      chronicleHeading: 'Klan Olay Kaydı',
    },
    baselineMorale: 69,
    milestoneCooldownTicks: 9,
    routines: {
      morning: {
        peaceful: 'Göl kıyısındaki balık ağları toplanıyor; vaşak ve kurt kulaklı izciler nemli çam izlerini koklayarak av sınırını kontrol ediyor.',
        fearful: 'Kulübelerin önündeki kürk askıları toplanmış; Şef Karok güney orman sınırına çift sıra mızraklı gözcü dizmiş.',
        happy: 'Tütsü ocaklarından göl alabalığı kokusu yükseliyor; gençler kemik av bıçaklarını bileyip şarkı söylüyor.',
      },
      midday: {
        peaceful: 'Tabakçı Lyra kurt ve geyik derilerini işliyor; balıkçı tekneleri Ayna Gölü sazlıklarına ağ bırakıyor.',
        fearful: 'Klan dışından yaklaşan yabancılara karşı uyarma boruları hazır tutuluyor; çocuklar kulübe önünden ayrılmıyor.',
        happy: 'Kürk ve isli balık denkleri hazırlanıyor; Külköy ya da kıyı kaçakçılarıyla adil takas pazarlığı konuşuluyor.',
      },
      evening: {
        peaceful: 'Avdan dönen kollar meydan ateşinin başında avı bölüşüyor; keskin kulaklı gözcüler orman sessizliğini dinliyor.',
        fearful: 'Büyük ahşap ateş yakılıp etrafında nöbet sırası belirleniyor; kürk depolarına kilit vuruluyor.',
        happy: 'Ateş başında av hikayeleri anlatılıyor; isli balık ve sıcak bitki suyu herkese dağıtılıyor.',
      },
      night: {
        peaceful: 'Karanlıkta insanlardan çok daha iyi gören klan nöbetçileri kulübelerin etrafında sessizce tur atıyor.',
        fearful: 'Bütün klan tetikte; göl kıyısındaki kayıklar karaya çekilmiş ve nöbet boruları elde tutuluyor.',
        happy: 'Göl rüzgarı kütük kulübelerin üzerinden eserken klan derin ve güvenli bir uykuda.',
      },
    },
    rumors: [
      {
        id: 'bk-rum-1',
        text: 'Külköy’deki insan tüccarların kürk alım fiyatını gizlice kırmak için anlaştığı klan kulağına gelmiş.',
        moodImpact: -5,
        questHook: 'Bozpençe klanının kürk takası için adil bir alıcı bulmak veya Gri Kaya Koyu kaptanıyla görüşmek.',
      },
      {
        id: 'bk-rum-2',
        text: 'Paslıçukur goblinlerinin klanın kışlık tuz çuvallarına göz diktiği izciler tarafından bildirilmiş.',
        moodImpact: -6,
        questHook: 'Batıdaki goblin inlerinden çalınan kışlık tuz ve demir tuzaklarını geri almak.',
      },
      {
        id: 'bk-rum-3',
        text: 'Ayna Gölü’nün doğu sazlıklarında bu hafta iri alabalık sürüsü yakalanmış; kışlık isli balık erzağı tamamlanmış.',
        moodImpact: +7,
      },
    ],
    problems: [
      {
        id: 'bk-prob-salt',
        title: 'Kışlık Tuz Stoku Azaldı',
        description: 'Balıkları ve kürkleri korumak için gereken kaya tuzu tükenmek üzere; takas kervanı hâlâ gelmedi.',
        severity: 'Orta',
        moodImpact: -7,
        villagerSolveDetail: 'Klan izcileri Gri Kaya Koyu’ndan gelen bir denizciyle iki çuval deniz tuzu karşılığında kürk takası yaptı.',
        questHook: 'Bozpençe klanına Külköy’den veya kıyıdan tuz çuvalları ulaştırmak.',
      },
      {
        id: 'bk-prob-boar',
        title: 'Güney Patikasında Azgın Yaban Domuzu',
        description: 'Kütük vadisinden çıkan dev bir yaban domuzu klanın tuzak hattını dağıttı ve iki toplayıcıyı yaraladı.',
        severity: 'Yüksek',
        moodImpact: -8,
        villagerSolveDetail: 'Avcı kolu mızraklı çember kurarak dev domuzu devirdi; eti klan kışlığına ayrıldı.',
        questHook: 'Kütük vadisindeki dev yaban domuzunu avlayıp klanın saygısını kazanmak.',
      },
    ],
    heroes: [
      {
        id: 'bk-h-nira',
        name: 'Tilki-Kulaklı Nira',
        role: 'Gece İzci ve Haberci',
        trait: 'Ayna Gölü sazlıklarındaki gizli sığ geçitleri ezbere bilir',
        renownTemplate: (p) => `${p} sırasında klanı kurtararak Şef Karok’un sağ kolu oldu.`,
      },
      {
        id: 'bk-h-tarkan',
        name: 'Vaşak Okçu Tarkan',
        role: 'Usta Tuzakçı',
        trait: 'Tek okla hareket eden avı durdurur, kürk işlemeden anlar',
        renownTemplate: (p) => `${p} başarısından sonra klanda büyük avcı unvanı aldı.`,
      },
    ],
    milestones: [
      {
        id: 'bk-ms-shed',
        kind: 'Yaşam',
        title: 'Yeni Kürk ve Takas Sundurması Yapıldı',
        detail: 'Dışarıdan gelen tüccarlarla köy içine sokmadan güvenli takas yapılabilen ahşap sundurma kuruldu.',
        moodImpact: +8,
        establishmentToAdd: 'Kıyı Kürk ve Takas Sundurması',
        questHook: 'Takas sundurmasında sergilenen nadir av haritalarını ve kurt kürklerini incelemek.',
      },
      {
        id: 'bk-ms-pups',
        kind: 'Yaşam',
        title: 'Klanda Yeni Çocuklar Dünyaya Geldi',
        detail: 'Kurt ve tilki kulaklı iki ailenin yeni doğan çocukları klan ateşi başında isimlendirildi.',
        moodImpact: +9,
        populationDelta: 2,
        questHook: 'İsim koyma ateşi sırasında yaşlı şifacının sakladığı eski gümüş tılsımı sormak.',
      },
    ],
  },

  goblin_burrow: {
    labels: {
      heading: 'Goblin ve Kobold İni Durumu',
      problemsHeading: 'İn İçi Çekişmeler ve Tehlikeler',
      noProblemsText: 'Tünellerde kazma ve hurda dövme sesleri sürüyor; gözcüler çalılıkta gizli.',
      rumorsHeading: 'İn İçi Fısıltılar ve Gözlemler',
      residentsHeading: 'Öne Çıkan Goblin ve Koboldlar',
      establishmentsHeading: 'Tünel Bölümleri ve Barikatlar',
      chronicleHeading: 'İn Olay Kaydı',
    },
    baselineMorale: 50,
    milestoneCooldownTicks: 8,
    routines: {
      morning: {
        peaceful: 'Gündüz ışığı in ağzından uzak tutuluyor; goblinler çalılıktaki deri çadırlarda uyurken koboldlar alt tünelleri kazıyor.',
        fearful: 'İn ağzındaki sivri kazık barikatlar sıklaştırılmış; bir dış baskından korkulduğu için alarm çıngırakları gerilmiş.',
        happy: 'Çalınmış kervan kasasından çıkan kuru et ve paslı çiviler yüzünden alt galeride gürültülü bir paylaşım var.',
      },
      midday: {
        peaceful: 'Koboldlar taş oyukları genişletiyor, kırık kervan tekerleklerinden sapan ve mızrak ucu yapılıyor.',
        fearful: 'Kazılar durmuş; mağara köpekleri giriş tüneline bağlanmış ve gözcüler kayalık tepeden etrafı kolluyor.',
        happy: 'Kemik yığınlarının yanında ateş yakılmış; goblinler yakaladıkları yaban domuzunu çeviriyor.',
      },
      evening: {
        peaceful: 'Alacakaranlıkla in canlanıyor; yağmacı goblinler sapanlarını ve çalıntı hançerlerini kuşanıp dışarı sızmaya hazırlanıyor.',
        fearful: 'Şef tünellerde bağırarak nöbetçileri azarlıyor; yalnızca üç sapanlı gözcü dışarı çıkarılıyor.',
        happy: 'Gece baskını için iki küçük yağma kolu patika yönüne gönderiliyor; koboldlar kapı tuzaklarını kuruyor.',
      },
      night: {
        peaceful: 'Gece karanlığında in çevresinde cılız ateşler yanıyor; yağmacılar yakındaki yol ve köylere pusu atmak üzere dağılmış.',
        fearful: 'Dış devriye korkusuyla tünellerin alt katına çekilmişler; girişteki tuzaklar her an patlamaya hazır.',
        happy: 'Ganimetlerle dönen baskıncılar tünellerde bağrışarak kavga edip eğleniyor.',
      },
    },
    rumors: [
      {
        id: 'gb-rum-1',
        text: 'Kobold kazıcıları ile goblin yağmacıları son baskından kalan demir çivilerin paylaşımı yüzünden kavga etmiş.',
        moodImpact: -6,
        questHook: 'Goblin ve koboldlar arasındaki bölünmeden yararlanıp esirleri kurtarmak.',
      },
      {
        id: 'gb-rum-2',
        text: 'İn ağzının altındaki karanlık hücrede yakalanmış bir tüccar çırağı veya izci tutulduğu görülüyormuş.',
        moodImpact: +2,
        questHook: 'Alt tünelde tutulan esiri karanlıktan yararlanarak çıkarmak.',
      },
      {
        id: 'gb-rum-3',
        text: 'Alt galerilerden birinde eski bir krallık maden damarına ve paslanmamış bronz baltalara denk gelmişler.',
        moodImpact: +6,
      },
    ],
    problems: [
      {
        id: 'gb-prob-collapse',
        title: 'Alt Tünelde Göçük Oldu',
        description: 'Koboldların destek direksiz kazdığı doğu galerisi çöktü; iki kazıcı ve bir sandık hurda demir içeride kaldı.',
        severity: 'Orta',
        moodImpact: -7,
        villagerSolveDetail: 'Koboldlar dar bir yan oyuk açıp göçük altındaki kazıcıları çıkardı ve tavanı çam kütükleriyle destekledi.',
        questHook: 'Göçük nedeniyle zayıflayan yan tünelden doğrudan inin merkezine sızmak.',
      },
      {
        id: 'gb-prob-feud',
        title: 'Goblin – Kobold Erzak Kavgası',
        description: 'Goblinler avlanan eti koboldlarla paylaşmayı reddedince koboldlar girişteki alarm tuzaklarını sökmekle tehdit etti.',
        severity: 'Yüksek',
        moodImpact: -9,
        villagerSolveDetail: 'İn lideri iki tarafın da başını ezerek zorla geçici bir düzen sağladı.',
        questHook: 'İki grup kavga halindeyken barikatları aşıp çalıntı erzak ve kasayı almak.',
      },
    ],
    heroes: [
      {
        id: 'gb-h-zipir',
        name: 'Kırık Kulak Zıpır',
        role: 'Sinsi Tuzakçı Goblin',
        trait: 'Çalıların arasına görünmez ip tuzakları ve kemik çanlar kurar',
        renownTemplate: (p) => `${p} sonrası in liderinin baş tuzakçısı seçildi.`,
      },
      {
        id: 'gb-h-kitir',
        name: 'Kazıcı Kıtır',
        role: 'Kobold Tünel Ustası',
        trait: 'Karanlıkta taş damarlarını kokusundan ayırt eder',
        renownTemplate: (p) => `${p} işini çözüp koboldların sözcüsü haline geldi.`,
      },
    ],
    milestones: [
      {
        id: 'gb-ms-pit',
        kind: 'Yaşam',
        title: 'Yeni Tuzaklı Barikat Çukuru Kazıldı',
        detail: 'Giriş patikasının önüne yapraklarla örtülü iki metrelik sivri kazık çukuru kazıldı.',
        moodImpact: +6,
        establishmentToAdd: 'Yaprak Örtülü Kazık Çukuru',
        populationDelta: 4,
        questHook: 'İne yaklaşırken girişteki yeni tuzak çukuruna düşmeden yan patikayı bulmak.',
      },
    ],
  },

  river_crossing: {
    labels: {
      heading: 'Geçit ve Konaklama Durumu',
      problemsHeading: 'Geçit ve Yol Sorunları',
      noProblemsText: 'Geçit açık; yolcular kuru ocak başında dinlenip geçebiliyor.',
      rumorsHeading: 'Yolcu Haberleri',
      residentsHeading: 'Geçitte Bulunan Sürekli İsimler',
      establishmentsHeading: 'Geçit Yapıları ve Barınaklar',
      chronicleHeading: 'Geçit Kaydı',
    },
    baselineMorale: 58,
    milestoneCooldownTicks: 9,
    routines: {
      morning: {
        peaceful: 'Sabah sisi su veya vadi üzerinde dağılıyor; nöbetçi yolun taşlarını kontrol edip akşamdan kalan közü eşeliyor.',
        fearful: 'Geçit kulübesinin kapısı kapalı; yakın yamaçta kurt veya eşkıya izi görüldüğü için kervanlar tek başına geçmiyor.',
        happy: 'İki kervan arabası geçitte soluklanıyor; sıcak çay ve taze yol haberleri paylaşılıyor.',
      },
      midday: {
        peaceful: 'Yolcular nehir ya da geçit kenarında atlarını dinlendirip mataralarını dolduruyor.',
        fearful: 'Yol ıssız; yalnızca hızlı geçen iki atlı ulak durmadan devam ediyor.',
        happy: 'Rehberler doğu ve batı arasındaki patikalar hakkında yolculara ücret karşılığı kılavuzluk yapıyor.',
      },
      evening: {
        peaceful: 'Kuru taş ocaklar yakılıyor; geceyi geçitte geçirecek kervanlar arabalarını çember yapıyor.',
        fearful: 'Kimse açıkta ateş yakmıyor; yolcular harabe gümrük kulübesinin içine sığınıp sırayla nöbet tutuyor.',
        happy: 'Ateş başında sıcak çorba kaynıyor; yolcular Külköy ve Ayna Gölü haberlerini değiş tokuş ediyor.',
      },
      night: {
        peaceful: 'Geçit sessiz; rüzgar taş korkuluklardan veya kayalıklardan ıslık çalarak geçiyor.',
        fearful: 'Karanlıkta geçidin öte yakasında hareketlenen gölgeler yüzünden nöbetçi gözünü kırpmıyor.',
        happy: 'Fener ışığı altında düzenli nöbet tutuluyor; yolcular güvenli biçimde sabahı bekliyor.',
      },
    },
    rumors: [
      {
        id: 'rc-rum-1',
        text: 'Dün gece geçitten geçen bir tuz arabası güneydeki taşocağı patikasında meşale ışıkları gördüğünü söylemiş.',
        moodImpact: -5,
        questHook: 'Geçit yakınındaki şüpheli meşale izlerini araştırmak.',
      },
      {
        id: 'rc-rum-2',
        text: 'Külköy’den yeni bir devriye birliğinin yakında geçide taş tamir ekibi göndereceği duyulmuş.',
        moodImpact: +5,
      },
    ],
    problems: [
      {
        id: 'rc-prob-crack',
        title: 'Geçit Zemininde Kayma ve Çatlak',
        description: 'Son yağmur ve suların aşındırmasıyla geçiş yolunun kenar taşları kaymış; yüklü arabalar zorlanıyor.',
        severity: 'Orta',
        moodImpact: -7,
        villagerSolveDetail: 'Kervancılar ve gözcüler taş kama çakıp gevşek kayaları sabitleyerek yolu açtı.',
        questHook: 'Hasarlı geçitten ağır bir kervan arabasını halatlarla karşıya geçirmek.',
      },
      {
        id: 'rc-prob-ambush',
        title: 'Yakın Ormanda Yolkesen İzi',
        description: 'Geçidin hemen doğusundaki ağaçlık boğazda iki haydutun pusu kurduğuna dair taze kamp izi bulundu.',
        severity: 'Yüksek',
        moodImpact: -9,
        villagerSolveDetail: 'Silahlı bir kervan muhafız takımı haydutları korkutup vadiden uzaklaştırdı.',
        questHook: 'Geçit önündeki yolkesen pususunu temizleyip ticaret yolunu açmak.',
      },
    ],
    heroes: [
      {
        id: 'rc-h-harun',
        name: 'Rehber Harun',
        role: 'Kıdemli Kervan Kılavuzu',
        trait: 'Geçidin her mevsimdeki gizli yan patikalarını bilir',
        renownTemplate: (p) => `${p} olayında üç arabayı kurtarıp yolcuların güvendiği rehber oldu.`,
      },
      {
        id: 'rc-h-eda',
        name: 'Muhafız Eda',
        role: 'Kervan Koruma Okçusu',
        trait: 'Yüksek taşların üstünden yolu gözetlemekte ustadır',
        renownTemplate: (p) => `${p} tehlikesini tek başına boşa çıkarıp nam yaptı.`,
      },
    ],
    milestones: [
      {
        id: 'rc-ms-shelter',
        kind: 'Yaşam',
        title: 'Kuru Yolcu Barınağı Onarıldı',
        detail: 'Geçit kenarındaki yarı yıkık taş kulübenin çatısı çam dalları ve kiremitlerle kapatıldı.',
        moodImpact: +7,
        establishmentToAdd: 'Onarılmış Kuru Yolcu Barınağı',
        questHook: 'Barınak duvarına kazınmış yeni bir gizli yolcu işaretini çözmek.',
      },
    ],
  },

  mist_ruin: {
    labels: {
      heading: 'Harabe ve Issız Yapı Durumu',
      problemsHeading: 'Yapıdaki Tehlike ve Olaylar',
      noProblemsText: 'Taş duvarlar soğuk rüzgara karşı sessiz; yalnızca kuşlar ve sis var.',
      rumorsHeading: 'Gözlem ve Söylentiler',
      residentsHeading: 'Harabeyi Kullanan Kişiler',
      establishmentsHeading: 'Harabe Bölümleri',
      chronicleHeading: 'Bölge Kaydı',
    },
    baselineMorale: 46,
    milestoneCooldownTicks: 10,
    routines: {
      morning: {
        peaceful: 'Yosunlu taşların üzerinden yoğun sabah sisi süzülüyor; avlu boş ve soğuk.',
        fearful: 'Yıkık kemerlerin altında gece gizlenmiş kişilerin taze ayak izleri ve sönmemiş küller görülüyor.',
        happy: 'Güneş sisi biraz araladığında burç veya kemer tepesinden çevre vadiler netçe seçilebiliyor.',
      },
      midday: {
        peaceful: 'Kaya kartalları ve martılar yıkık taşların tepesinde dönüyor; içeride kimse görünmüyor.',
        fearful: 'Alt mahzende veya kule dibinde saklanan kaçakçı/haydut gözcüleri yaklaşanları sessizce izliyor.',
        happy: 'Gezgin bir haritacı veya avcı öğle güneşinde duvar dibinde soluklanıyor.',
      },
      evening: {
        peaceful: 'Sis yeniden çöküyor; soğuk taş avluda rüzgar uğultusundan başka ses yok.',
        fearful: 'Duman çıkarmayan küçük bir gizli ateş yakılmış; silah sesleri veya fısıltılar duvarlarda yankılanıyor.',
        happy: 'Yırtıcı kuşlar yuvalarına dönüyor; harabe alacakaranlığa gömülüyor.',
      },
      night: {
        peaceful: 'Zifiri karanlık ve soğuk taş sessizliği; pusula iğneleri eski taşların yanında hafifçe titriyor.',
        fearful: 'Eşkıyalar veya kaçakçılar gece buluşması için harabeyi kullanıyor; içeriden fener sızmaması için battaniye gerilmiş.',
        happy: 'Ay ışığı yıkık mazgalların arasından avluya vuruyor; gece sakin.',
      },
    },
    rumors: [
      {
        id: 'mr-rum-1',
        text: 'Harabenin alt mahzeninde fırtınadan saklanan yabancıların kilitli bir sandık taşıdığı görülmüş.',
        moodImpact: -4,
        questHook: 'Harabenin alt mahzenini inceleyip gizli sandığın veya buluşmanın izini sürmek.',
      },
      {
        id: 'mr-rum-2',
        text: 'Taş duvarın dibinde yüzlerce yıllık eski bir sınır işareti ve paslanmamış demir kılıç kabzası bulunmuş.',
        moodImpact: +3,
        questHook: 'Eski mührü inceleyip bölgenin unutulmuş tarihine dair ipucu bulmak.',
      },
    ],
    problems: [
      {
        id: 'mr-prob-bandits',
        title: 'Harabeye Haydut Takımı Yerleşti',
        description: 'Dört kişilik kaçak bir grup yağmurdan kaçıp harabenin sağlam odasına kamp kurmuş; yaklaşanlara taş atıyorlar.',
        severity: 'Orta',
        moodImpact: -7,
        villagerSolveDetail: 'Erzakları biten haydutlar kavga edip harabeyi terk ederek doğuya dağıldı.',
        questHook: 'Harabedeki haydut kampını bastırıp alanı güvenli sığınak haline getirmek.',
      },
      {
        id: 'mr-prob-collapse',
        title: 'Kemer Taşlarında Çökme',
        description: 'Don ve nem yüzünden eski taş kemerin iki kilit taşı avluya düştü; mahzen girişi yarı kapandı.',
        severity: 'Düşük',
        moodImpact: -5,
        villagerSolveDetail: 'Geçen bir dağcı ekibi düşen taşları kenara yuvarlayıp dar geçidi yeniden açtı.',
        questHook: 'Yarı kapanmış mahzen girişini açıp alt odayı araştırmak.',
      },
    ],
    heroes: [
      {
        id: 'mr-h-selim',
        name: 'Haritacı Selim',
        role: 'Gezgin Eski Eser Araştırmacısı',
        trait: 'Eski krallık taş mühürlerini ve sınır haritalarını okur',
        renownTemplate: (p) => `${p} sırasında harabede önemli bir taş kayıt çözüp çevre köylerde tanındı.`,
      },
    ],
    milestones: [
      {
        id: 'mr-ms-cache',
        kind: 'Yaşam',
        title: 'Kuru Sığınak Köşesi Düzenlendi',
        detail: 'Avcılar harabenin rüzgar almayan köşesine kuru odun ve acil durum yağ feneri bıraktı.',
        moodImpact: +6,
        establishmentToAdd: 'Acil Durum Kuru Odun Zulası',
        questHook: 'Harabedeki acil durum zulasına bırakılmış şifreli pusulayı okumak.',
      },
    ],
  },

  smuggler_cove: {
    labels: {
      heading: 'Yaşayan Kıyı Koyu Durumu',
      problemsHeading: 'Kıyı ve Kaçakçılık Sorunları',
      noProblemsText: 'Dalgalar sakin; sandallar kayalık iskelede demirli ve tayfalar yük bekliyor.',
      rumorsHeading: 'Denizci Söylentileri',
      residentsHeading: 'Öne Çıkan Tayfa ve Kaptanlar',
      establishmentsHeading: 'Koy Yapıları ve İskeleler',
      chronicleHeading: 'Koy Olay Kaydı',
    },
    baselineMorale: 56,
    milestoneCooldownTicks: 9,
    routines: {
      morning: {
        peaceful: 'Medcezir çekilirken sandalların altı kontrol ediliyor; Kaptan Morvain tuz ve kürk fıçılarının sayımını yapıyor.',
        fearful: 'Falez burcundaki gözcüden tehlike çanı uyarısı bekleniyor; yelkenler yarı indirilmiş hazır tutuluyor.',
        happy: 'Doğu adalarından gelen tekne baharat ve tuz kasalarını kıyıya indiriyor; tayfalar neşeli.',
      },
      midday: {
        peaceful: 'Ağlar onarılıyor, tekne gövdeleri ziftle kalafatlanıyor; kıyı mağaraları serin tutuluyor.',
        fearful: 'Yabancı bir gemi ufukta göründüğü için fıçılar hızla kaya mağaralarına saklanıyor.',
        happy: 'Bozpençe klanından gelen kürk denkleri adalara gidecek tekneye yükleniyor.',
      },
      evening: {
        peaceful: 'Falez tepesindeki fener işareti bekleniyor; gece kürek çekecek sandallar suya itiliyor.',
        fearful: 'Koy tamamen karanlıkta bırakılmış; tayfalar kayaların arasında tüfek ve kılıçla nöbet bekliyor.',
        happy: 'Kıyı mağarasında denizci ateşinde sıcak balık ve rom paylaşılıyor.',
      },
      night: {
        peaceful: 'Kürekleri bezle sarılmış sandallar sisin içinde sessizce açık denize açılıyor.',
        fearful: 'Dalgalar kayalara çarparken fener yakılmıyor; nöbetçiler falez patikasını kolluyor.',
        happy: 'Gece seyri açık havada sorunsuz ilerliyor; koy sakin.',
      },
    },
    rumors: [
      {
        id: 'sc-rum-1',
        text: 'Sisli Fok Kayalıkları’nda karaya oturmuş eski geminin bir kurşun sandığı daha henüz açılmamış.',
        moodImpact: +2,
        questHook: 'Kaçakçı teknesiyle Sisli Fok Kayalıkları’na geçip batık sandığı çıkarmak.',
      },
      {
        id: 'sc-rum-2',
        text: 'Batı kalelerinden doğu kıyılarına vergi müfettişi gönderileceği liman meyhanelerinde konuşuluyormuş.',
        moodImpact: -6,
        questHook: 'Kaptanı müfettiş baskınına karşı uyarmak veya müfettiş adına kanıt toplamak.',
      },
    ],
    problems: [
      {
        id: 'sc-prob-hull',
        title: 'Yük Teknesinin Omurgası Çatladı',
        description: 'Sert doğu akıntısı küçük yelkenliyi keskin resife vurdu; tekne su alıyor ve acil zift ile kereste lazım.',
        severity: 'Orta',
        moodImpact: -7,
        villagerSolveDetail: 'Marangoz tayfalar medcezir çekilince tekneyi karaya çekip meşe yamasıyla onardı.',
        questHook: 'Tekne onarımı için ormandan zift ve dayanıklı kalas getirmek.',
      },
      {
        id: 'sc-prob-mutiny',
        title: 'Tayfa Arasında Pay Kavgası',
        description: 'Son kürk sevkiyatından düşen gümüş payı az bulununca iki tayfa kaptana diklendi.',
        severity: 'Yüksek',
        moodImpact: -8,
        villagerSolveDetail: 'Kaptan Morvain iki tayfaya fazla tuz kasası vererek isyanı bastırdı.',
        questHook: 'Gergin tayfalar arasında aracılık yaparak adalara geçiş izni koparmak.',
      },
    ],
    heroes: [
      {
        id: 'sc-h-yasin',
        name: 'Dümenci Yasin',
        role: 'Kıyı Kılavuzu',
        trait: 'Kör siste bile resifleri dalga sesinden tanıyıp tekne yanaştırır',
        renownTemplate: (p) => `${p} krizinde tekneyi kurtarıp koyun en aranılan dümencisi oldu.`,
      },
      {
        id: 'sc-h-nazli',
        name: 'Fenerci Nazlı',
        role: 'İşaret ve Gözcü Uzmanı',
        trait: 'Falez burcu ile koy arasındaki gizli ayna ve fener kodlarını yönetir',
        renownTemplate: (p) => `${p} sırasında koyu ele verilmekten kurtarıp nam yaptı.`,
      },
    ],
    milestones: [
      {
        id: 'sc-ms-slipway',
        kind: 'Yaşam',
        title: 'Gizli Sandal Çekek Yeri Yapıldı',
        detail: 'Kayalık mağaranın içine dışarıdan görünmeyen ahşap kızaklı bir sandal çekek rampası kuruldu.',
        moodImpact: +7,
        establishmentToAdd: 'Mağara İçi Gizli Sandal Rampası',
        questHook: 'Gizli sandal rampasını kullanarak açık denize fark edilmeden açılmak.',
      },
    ],
  },

  wild_nature: {
    labels: {
      heading: 'Yaşayan Doğa ve Vahşi Yaşam Durumu',
      problemsHeading: 'Bölgedeki Doğa Olayı ve Tehlikeler',
      noProblemsText: 'Doğal denge sakin; yalnızca yaban hayvanları ve mevsimsel sis akışı var.',
      rumorsHeading: 'İzler, Duyumlar ve Gezgin Notları',
      residentsHeading: 'Bölgede Görülen Gezgin ve Avcılar',
      establishmentsHeading: 'Doğal Noktalar ve Geçici Kamplar',
      chronicleHeading: 'Bölge Doğa Kaydı',
    },
    baselineMorale: 60,
    milestoneCooldownTicks: 10,
    routines: {
      morning: {
        peaceful: 'Sabah çiyi ve beyaz sis tabakası çukurlara çökmüş; su kuşları ve geyik sürüleri su kenarına iniyor.',
        fearful: 'Bölgedeki yaban hayvanları olağandışı biçimde tedirgin; yırtıcı izleri patika üzerine kadar inmiş.',
        happy: 'Sis hafifçe dağılmış, güneş ışığı ağaç tepelerinden veya göl yüzeyinden süzülüyor; av ve şifalı bitki toplamak için elverişli.',
      },
      midday: {
        peaceful: 'Doğal yaşam kendi ritminde akıyor; rüzgar yaprakları ve sazlıkları hışırdatıyor.',
        fearful: 'Yoğun sis görüşü daraltmış; çamurlu zemin ve kaygan kayalar ilerlemeyi ağırlaştırıyor.',
        happy: 'Gezgin bir bitki toplayıcı veya balıkçı gün ışığından faydalanıp ağ ve kök topluyor.',
      },
      evening: {
        peaceful: 'Gündüz kuşları susarken ağaç altları kararıyor; yırtıcılar av için hareketlenmeye başlıyor.',
        fearful: 'Fırtına rüzgarı sertleşti; sığınacak kuru bir kaya kovuğu veya adacık bulmak şart.',
        happy: 'Akşam kızıllığı su ve çam tepelerine vuruyor; akşam yeli hafif.',
      },
      night: {
        peaceful: 'Gece ayazı çökmüş; uzaktan kurt veya baykuş sesleri sisin içinde yankılanıyor.',
        fearful: 'Karanlıkta büyük bir yırtıcı sürüsü veya fırtına bölgedeki tüm geçici izleri tehdit ediyor.',
        happy: 'Ay ışığı altında durgun ve berrak bir doğa gecesi.',
      },
    },
    rumors: [
      {
        id: 'wn-rum-1',
        text: 'Bölgenin kenarında gece sönmemiş bir kamp ateşi ve unutulmuş deri bir matara bulunmuş.',
        moodImpact: -3,
        questHook: 'Terk edilmiş kamp ateşinin izini sürüp gezginin akıbetini öğrenmek.',
      },
      {
        id: 'wn-rum-2',
        text: 'Nadir bulunan şifalı beyaz kabuk mantarı ve ateş düşürücü köklerin bu hafta yeniden filizlendiği söyleniyor.',
        moodImpact: +5,
        questHook: 'Şifalı bitki ve mantar toplayarak çevre köylerdeki şifacılara ulaştırmak.',
      },
      {
        id: 'wn-rum-3',
        text: 'İri pençe izleri büyük bir bozayının veya kurt sürüsünün av sahasını bu bölgeye kaydırdığını gösteriyor.',
        moodImpact: -5,
        questHook: 'Yırtıcı sürüsünün inini tespit edip patikayı güvenli kılmak.',
      },
    ],
    problems: [
      {
        id: 'wn-prob-predator',
        title: 'Patikaya İnen Yırtıcı Tehdidi',
        description: 'Aç kalan büyük bir kurt sürüsü veya bozayı geçiş noktalarını mesken tutmuş; yalnız gezginlere saldırıyor.',
        severity: 'Yüksek',
        moodImpact: -8,
        villagerSolveDetail: 'Hayvan sürüsü göç ederek daha doğudaki derin vadilere çekildi; yol yeniden sakinleşti.',
        questHook: 'Yaralı bir avcıyı veya gezgini yırtıcı tehdidinin ortasından çıkarmak.',
      },
      {
        id: 'wn-prob-storm',
        title: 'Devrik Ağaç ve Su Taşkını',
        description: 'Sert rüzgar ve yağmur yaşlı bir çamı patikanın üzerine devirdi; taban suyunu yükseltti.',
        severity: 'Orta',
        moodImpact: -6,
        villagerSolveDetail: 'Sular çekildi ve geçen tuzakçılar ağaç gövdesinin etrafından yeni bir yan iz açtı.',
        questHook: 'Taşkın altında kalan eski bir araba kalıntısının kilitli sandığını kurtarmak.',
      },
    ],
    heroes: [
      {
        id: 'wn-h-aras',
        name: 'Tuzakçı Aras',
        role: 'Gezgin Kürk Avcısı',
        trait: 'Hangi mantarın zehirli, hangi suyun içilebilir olduğunu anında bilir',
        renownTemplate: (p) => `${p} sırasında kaybolan bir yolcuyu kurtarıp bölgede nam saldı.`,
      },
      {
        id: 'wn-h-melis',
        name: 'Bitkici Melis',
        role: 'Gezgin Şifacı Toplayıcı',
        trait: 'Sazlık ve derin orman otlarından etkili panzehirler hazırlar',
        renownTemplate: (p) => `${p} tehlikesinden sağ çıkıp çevre köylere yol haritası çizdi.`,
      },
    ],
    milestones: [
      {
        id: 'wn-ms-lean',
        kind: 'Yaşam',
        title: 'Kuru Taş Üstünde Rüzgar Siperi Yapıldı',
        detail: 'Gezgin avcılar yüksek ve kuru bir noktanın yanına üç duvarlı basit bir çam dalı sığınağı ördü.',
        moodImpact: +6,
        establishmentToAdd: 'Gezgin Rüzgar Siperi ve Kuru Ocak',
        questHook: 'Rüzgar siperinin içinde bırakılmış yarım günlük ve çizilmiş bölge krokisini incelemek.',
      },
    ],
  },
};

interface LocationLivingSeed {
  archetype: SettlementArchetype;
  populationEstimate: number;
  unitLabel: string;
  morale: number;
  establishments: string[];
  initialRumor: string;
  initialEventTitle: string;
  initialEventDetail: string;
  initialHook: string;
}

const LOCATION_LIVING_SEEDS: Record<string, LocationLivingSeed> = {
  'loc-kuldere': {
    archetype: 'border_fortress',
    populationEstimate: 185,
    unitLabel: 'Kişi',
    morale: 72,
    establishments: [
      'Ahşap Palizad Suru',
      'Torin’in Sınır Hanı',
      'Mira’nın Demirci Ocağı',
      'Garnizon Kışlası',
      'Sınır Köle ve Tutsak Pazarı',
    ],
    initialRumor: 'Gümüş Köprü üzerinden gelecek tuz kervanı için kalede iki izci bekleniyor.',
    initialEventTitle: 'Garnizon Sabah Nöbeti Devraldı',
    initialEventDetail: 'Komutan Balthor doğu ve kuzey yollarına ikişer kişilik atlı gözcü çıkardı.',
    initialHook: 'Batakhan’dan haftalardır dönmeyen vergi arabasını sormak.',
  },
  'loc-kulova-koyu': {
    archetype: 'shepherd_village',
    populationEstimate: 62,
    unitLabel: 'Kişi',
    morale: 68,
    establishments: ['Taş Ağıllar (15 Hane)', 'Helga’nın Yün Dokuma Damı', 'Peynir ve Tuz Mahzeni', 'Ahşap Gözcü Kulesi'],
    initialRumor: 'Külköy Sınır Kalesi’nden gelecek tuz ve demir katırı için köyde yün balyaları hazırlanıyor.',
    initialEventTitle: 'Normal Sınır Hayatı Sürüyor',
    initialEventDetail: 'Kulova Çoban Köyü’nde 15 hane sabah sağımını tamamladı; sürüler rüzgarlı sınır merasına çıkarıldı.',
    initialHook: 'Kuzeydeki Batakhan yoluna çıkmadan önce köyün ahşap kulesinden bölgeyi gözlemlemek.',
  },
  'loc-derebasi-koyu': {
    archetype: 'lumber_village',
    populationEstimate: 78,
    unitLabel: 'Kişi',
    morale: 64,
    establishments: ['Nehir Su Değirmeni', 'Odun Kömürü Ocakları', 'Tomruk Kızak Rampası', 'Salcı İskelesi'],
    initialRumor: 'Ustabaşı Mara güneydeki Dev Çamlar’a giden iki genç çırağı hâlâ bekliyor.',
    initialEventTitle: 'Değirmen ve Kömür Ocakları Çalışıyor',
    initialEventDetail: 'Sirkad Nehri kıyısında tomruk biçme işi erken saatte başladı; nehir salı Külköy yüküne hazır.',
    initialHook: 'Güney ormanda kaybolan iki oduncu çırağının izini sürmek.',
  },
  'loc-batakhan': {
    archetype: 'bandit_hamlet',
    populationEstimate: 34,
    unitLabel: 'Kişi',
    morale: 41,
    establishments: ['Yıkık Han ve Taş Ahır', 'Kilitli Yeraltı Kileri', 'Paslı Meydan Çanı'],
    initialRumor: 'Dün gece ahırlara dışarıdan iki yüklü at çekilmiş; köylülerden kimse pencereden bakmaya cesaret edememiş.',
    initialEventTitle: 'Şüpheli Sessizlik Sürüyor',
    initialEventDetail: 'Sahte Hancı Vorn yıkık hanın önünde sabah ateşini yakmış; silahlı adamları ahır kapısında nöbette.',
    initialHook: 'Misafirperver görünen hancının alt kilerdeki sırrını açığa çıkarmak.',
  },
  'loc-sogutlu-batak': {
    archetype: 'wild_nature',
    populationEstimate: 3,
    unitLabel: 'Gezgin',
    morale: 56,
    establishments: ['Kuru Taş Adacık Kampı', 'Batık Kervan Tekeri'],
    initialRumor: 'Sazlıkların ortasındaki adacıkta gezgin bitki toplayıcısı Soren duman çıkarmadan ateş yakmış.',
    initialEventTitle: 'Sabah Sisi Sazlıklara Çöktü',
    initialEventDetail: 'Nehir sığlaşıp adacıkları sardı; bataklık kuşları ve su yılanları hareket halinde.',
    initialHook: 'Soren’den batık tüccar arabasının kilitli sandığının yerini sormak.',
  },
  'loc-yasli-meselik': {
    archetype: 'wild_nature',
    populationEstimate: 4,
    unitLabel: 'Avcı İzleri',
    morale: 52,
    establishments: ['Devrik Çam İnleri', 'Bozpençe Av İşaretleri'],
    initialRumor: 'Yaşlı dev bir bozayı ve altı kurtluk sürü kuzey sınırındaki geyik yatağını paylaşmaya çalışıyor.',
    initialEventTitle: 'Büyük Ormanda Av Sessizliği',
    initialEventDetail: 'Dev çamların altında yoğun gölge ve soğuk nem var; ağaç gövdelerinde taze pençe izleri görülüyor.',
    initialHook: 'Ağaçlara kazınmış Bozpençe av işaretlerini okuyarak güney geçişini bulmak.',
  },
  'loc-gumus-kopru': {
    archetype: 'river_crossing',
    populationEstimate: 14,
    unitLabel: 'Yolcu/Gözcü',
    morale: 62,
    establishments: ['Eski Taş Kemer Köprü', 'Terk Edilmiş Gümrük Kulübesi', 'Kuru Taş Ocaklar'],
    initialRumor: 'Son yağmurdan sonra güney köprü ayağında ince bir çatlak görülmüş.',
    initialEventTitle: 'Köprü Geçişleri Açık',
    initialEventDetail: 'Gözcü Halen sabah sisinde köprü taşlarını kontrol etti; ilk tuz kervanı batıdan bekleniyor.',
    initialHook: 'Köprü korkuluğuna bırakılmış yanık tahta uyarı işaretini incelemek.',
  },
  'loc-sisli-koyak': {
    archetype: 'mist_ruin',
    populationEstimate: 2,
    unitLabel: 'Geçici İz',
    morale: 48,
    establishments: ['Yıkık Taş Kemer', 'Yosunlu Kuru Kuyu'],
    initialRumor: 'Vahşi hayvanların nedense yosunlu kuyunun üç adım yakınına bile girmediği anlatılıyor.',
    initialEventTitle: 'Vadi Tabanı Sisle Örtülü',
    initialEventDetail: 'Koyakta yalnızca damlayan çiy suları ve rüzgarın taş kemerde çıkardığı uğultu duyuluyor.',
    initialHook: 'Taş kemerin dibinde saklanmış yağlı deri paketi aramak.',
  },
  'loc-elf-koyu': {
    archetype: 'elf_canopy',
    populationEstimate: 96,
    unitLabel: 'Kişi',
    morale: 74,
    establishments: ['Yüksek Sedir Platformları', 'Asma Halat Köprüler', 'Eski Yazıt Arşivi', 'Reçine ve Yay İşliği'],
    initialRumor: 'Doğu sırtlarındaki Çakmaktaşı Oyukları’nda yeni kobold kazıları başladığı gözcülerce rapor edilmiş.',
    initialEventTitle: 'Yüksek Dallarda Sabah Nöbeti',
    initialEventDetail: 'Baş Avcı Seraphina devriyeleri kuzey yamaçlarına gönderdi; marangoz Thalen halatları kontrol ediyor.',
    initialHook: 'Elflerin güvenini kazanıp kuzey dağ geçidi için geçiş işareti almak.',
  },
  'loc-beastkin-koyu': {
    archetype: 'beastkin_clan',
    populationEstimate: 88,
    unitLabel: 'Kişi',
    morale: 70,
    establishments: ['Kütük ve Deri Kulübeler', 'Kürk Kurutma Askıları', 'İsli Balık Ocakları', 'Sazlık Kayık İskelesi'],
    initialRumor: 'Batıdaki Paslıçukur goblinlerinin çaldığı kışlık tuz ve demir tuzaklar klanda hâlâ gündemde.',
    initialEventTitle: 'Klan Sabah Avına Çıktı',
    initialEventDetail: 'İzci Lyra ve balıkçı Vorn gün doğmadan göl kıyısındaki ağları ve güney izlerini kontrole çıktı.',
    initialHook: 'Klan şefi Karok ile kürk, balık ve orman haritası takası yapmak.',
  },
  'loc-goblin-inleri': {
    archetype: 'goblin_burrow',
    populationEstimate: 64,
    unitLabel: 'Yaratık',
    morale: 50,
    establishments: ['Sivri Kazık Barikatları', 'Kobold Kazı Galerileri', 'Yırtık Deri Çadırlar', 'Alt Esir Hücresi'],
    initialRumor: 'Lider Kırıkdiş ile kobold kazıcıları son çalınan demir külçeler yüzünden birbirine diş biliyor.',
    initialEventTitle: 'Alt Tünellerde Kazı Sürüyor',
    initialEventDetail: 'Gündüz sıcağından ve ışıktan kaçan goblinler çalılıktaki gölgelere çekilmiş, koboldlar derini kazıyor.',
    initialHook: 'İki grup arasındaki erzak çekişmesinden faydalanıp esir tüccar çırağını kurtarmak.',
  },
  'loc-goblin-kuzey-ini': {
    archetype: 'goblin_burrow',
    populationEstimate: 54,
    unitLabel: 'Yaratık',
    morale: 52,
    establishments: ['Çakmaktaşı Damar Mağarası', 'Çıngıraklı Alarm İpleri', 'Eski Bronz Maden Galerisi'],
    initialRumor: 'Kazıcı Başı Tıkır’ın ekibi derinlerden eski bronz madenci baltaları çıkarmış.',
    initialEventTitle: 'Mağara Ağzı Çıngıraklarla Korunuyor',
    initialEventDetail: 'Kaya köpekleri girişteki kütük barikata bağlanmış; koboldlar eski maden yolunu genişletiyor.',
    initialHook: 'Yüksekçam Elf Köyü adına gözcü kulesini etkisiz hale getirmek.',
  },
  'loc-kuzey-gecit': {
    archetype: 'river_crossing',
    populationEstimate: 8,
    unitLabel: 'Gezgin',
    morale: 48,
    establishments: ['Dar Boğaz Keçi Yolu', 'Mahsur Vergi Arabası Enkazı'],
    initialRumor: 'Karlı boğazdaki eski vergi arabası enkazının etrafında gri dağ kurtlarının yavruladığı söyleniyor.',
    initialEventTitle: 'Soğuk Dağ Sisi Geçidi Kapladı',
    initialEventDetail: 'Yukarı zirvelerden esen ayaz ve taş kayması riski yüzünden geçit yalnızca kılavuzlarla aşılabiliyor.',
    initialHook: 'Buz tutmuş arabadaki kapalı kasa defterini kurtarmak.',
  },
  'loc-fisildayan-gol': {
    archetype: 'wild_nature',
    populationEstimate: 9,
    unitLabel: 'Balıkçı',
    morale: 68,
    establishments: ['Ahşap Balıkçı İskeleleri', 'Kurutma Direkleri', 'Sazlık Geçidi'],
    initialRumor: 'Sular çekildiğinde gölün kuzey ucunda yüzlerce yıllık eski bir taş rıhtım temeli görünüyormuş.',
    initialEventTitle: 'Durgun Suda Sabah Sisi',
    initialEventDetail: 'Yaşlı Balıkçı Gorim kıyı sazlıklarında ağlarını topluyor; su yüzeyi bembeyaz sisle kaplı.',
    initialHook: 'Gorim’den kayık kiralayıp Bozpençe köyüne geçmek.',
  },
  'loc-mantar-vadisi': {
    archetype: 'wild_nature',
    populationEstimate: 5,
    unitLabel: 'Toplayıcı/İz',
    morale: 54,
    establishments: ['Dev Devrik Kütükler', 'Mantar Yatakları'],
    initialRumor: 'Paslıçukur goblinleri ile Bozpençe toplayıcılarının vadi tabanında zaman zaman karşılaştığı biliniyor.',
    initialEventTitle: 'Nemli Vadi Tabanında Sessizlik',
    initialEventDetail: 'Güneş ışığı eğrelti otlarının altına inmiyor; kütüklerin etrafında taze yaban domuzu izleri var.',
    initialHook: 'Külköy hekimi için nadir beyaz kabuk mantarı toplamak.',
  },
  'loc-kartal-kayaligi': {
    archetype: 'wild_nature',
    populationEstimate: 4,
    unitLabel: 'Gözcü/Dağcı',
    morale: 64,
    establishments: ['Kireçtaşı Gözlem Sırtı', 'Kaya Kartalı Yuvaları', 'Gizli Taş Siper'],
    initialRumor: 'Yüksekçam elf gözcüleri açık havalarda bu sırttan doğu kıyısındaki gemileri izliyormuş.',
    initialEventTitle: 'Yüksek Sırtta Berrak Görüş',
    initialEventDetail: 'Ağaç sınırının üstünde sert rüzgar esiyor; dev kaya kartalları uçurum kenarında süzülüyor.',
    initialHook: 'Tepedeki taş siperden doğu kıyısındaki kaçakçı hareketlerini gözetlemek.',
  },
  'loc-run-harabeleri': {
    archetype: 'mist_ruin',
    populationEstimate: 11,
    unitLabel: 'Eşkıya/İz',
    morale: 44,
    establishments: ['Yıkık Taş Mazgallar', 'Soğuk Taş Avlu', 'Alt Zırh Mahzeni'],
    initialRumor: 'Hisarın alt mahzeninde doğu sınırından kaçan bir haydut grubunun kışlık erzak sakladığı fısıldanıyor.',
    initialEventTitle: 'Dağ Rüzgarı Hisarı Sarıyor',
    initialEventDetail: 'Terk edilmiş taş karakolun yıkık burçlarında yaban keçileri dolaşıyor; mahzen kapısı aralık.',
    initialHook: 'Eski garnizon mahzenindeki çalıntı erzak ve zırh deposunu kontrol etmek.',
  },
  'loc-dogu-falezleri': {
    archetype: 'mist_ruin',
    populationEstimate: 6,
    unitLabel: 'Gözcü',
    morale: 58,
    establishments: ['Tuz Aşınmış Gözetleme Burcu', 'Bakır İşaret Çanağı'],
    initialRumor: 'Açık denizdeki kaçakçı tekneleri karaya yanaşmadan önce bu burçtan fener işareti bekliyormuş.',
    initialEventTitle: 'Okyanus Rüzgarı Falezleri Dövüyor',
    initialEventDetail: 'Gözcü Varek kulenin üst katından doğu ufkunu tarıyor; tuzlu deniz sisi kayalara vuruyor.',
    initialHook: 'Bakır işaret çanağını inceleyip kıyıdaki gizli iskeleyi öğrenmek.',
  },
  'loc-hayalet-koy': {
    archetype: 'smuggler_cove',
    populationEstimate: 28,
    unitLabel: 'Denizci',
    morale: 58,
    establishments: ['Gizli Kayalık İskele', 'Tuz ve Barut Mağaraları', 'Kaçakçı Yelkenlisi'],
    initialRumor: 'Kaptan Morvain bu hafta Bozpençe kürklerini doğu adalarına taşımak için tayfa topluyormuş.',
    initialEventTitle: 'Koyda Yükleme Hazırlığı',
    initialEventDetail: 'Çalkantılı suya rağmen korunaklı koyda iki sandal demirli; tuz fıçıları kayalık altına dizilmiş.',
    initialHook: 'Doğu adalarına geçmek için Kaptan Morvain ile pazarlık yapmak.',
  },
  'loc-fok-adalari': {
    archetype: 'wild_nature',
    populationEstimate: 3,
    unitLabel: 'Balıkçı',
    morale: 55,
    establishments: ['Fok Kayalıkları', 'Eski Ticaret Gemisi İskeleti'],
    initialRumor: 'Rüzgar almayan koyda karaya oturmuş geminin su almamış birkaç kurşun sandığı duruyormuş.',
    initialEventTitle: 'Soğuk Akıntıda Deniz Sisi',
    initialEventDetail: 'Fok kolonileri kayalıklarda dinleniyor; açık deniz rüzgarı adacıkları dövüyor.',
    initialHook: 'Karaya oturmuş ticaret gemisi enkazındaki kurşun sandıkları araştırmak.',
  },
};

export function computeMoodFromMorale(morale: number): SettlementMood {
  if (morale >= 82) return 'Mutlu';
  if (morale >= 62) return 'Huzurlu';
  if (morale >= 44) return 'Temkinli';
  if (morale >= 26) return 'Endişeli';
  return 'Korkulu';
}

export function getLivingSectionLabels(archetype: SettlementArchetype) {
  return ARCHETYPE_BLUEPRINTS[archetype].labels;
}

export function getDailyRoutineForLocation(
  location: MapLocation,
  gameTimeMs: number
): { timeSlot: string; activity: string } {
  const archetype = location.livingState?.archetype;
  if (!archetype) {
    return {
      timeSlot: 'Günlük Akış',
      activity: 'Bölge sakinleri olağan günlük işleriyle meşgul.',
    };
  }

  const bp = ARCHETYPE_BLUEPRINTS[archetype];
  const hour = new Date(gameTimeMs).getUTCHours();
  const mood = location.livingState?.mood ?? 'Huzurlu';
  const moodBucket =
    mood === 'Endişeli' || mood === 'Korkulu'
      ? 'fearful'
      : mood === 'Mutlu'
      ? 'happy'
      : 'peaceful';

  if (hour >= 5 && hour < 10) {
    return { timeSlot: 'Sabah Vakti (05:00–10:00)', activity: bp.routines.morning[moodBucket] };
  }
  if (hour >= 10 && hour < 15) {
    return { timeSlot: 'Öğle Mesaisi (10:00–15:00)', activity: bp.routines.midday[moodBucket] };
  }
  if (hour >= 15 && hour < 19) {
    return { timeSlot: 'Akşamüstü (15:00–19:00)', activity: bp.routines.evening[moodBucket] };
  }
  return { timeSlot: 'Gece Düzeni (19:00–05:00)', activity: bp.routines.night[moodBucket] };
}

export function createInitialLivingStateForLocation(locationId: string): SettlementLivingState | undefined {
  const seed = LOCATION_LIVING_SEEDS[locationId];
  if (!seed) return undefined;

  const startLabel = formatGameDateTime(INITIAL_GAME_TIME_MS);
  return {
    enabled: true,
    archetype: seed.archetype,
    lastSimulatedMs: INITIAL_GAME_TIME_MS,
    lastProblemTick: -2,
    lastRumorTick: 0,
    lastMilestoneTick: -4,
    populationEstimate: seed.populationEstimate,
    unitLabel: seed.unitLabel,
    morale: seed.morale,
    mood: computeMoodFromMorale(seed.morale),
    establishments: seed.establishments,
    activeProblems: [],
    rumors: [seed.initialRumor],
    notableResidents: [],
    chronicle: [
      {
        id: `ev-init-${locationId}`,
        timestamp: startLabel,
        kind: 'Olay',
        title: seed.initialEventTitle,
        detail: seed.initialEventDetail,
        moodImpact: 0,
      },
    ],
    dynamicHooks: [seed.initialHook],
  };
}

function pushChronicle(
  list: SettlementEventRecord[],
  entry: SettlementEventRecord
): SettlementEventRecord[] {
  return [entry, ...list].slice(0, MAX_CHRONICLE);
}

function pushUniqueHook(list: string[], hook?: string): string[] {
  if (!hook) return list;
  const filtered = list.filter((h) => h !== hook);
  return [hook, ...filtered].slice(0, MAX_DYNAMIC_HOOKS);
}

function simulateSingleLocationTick(
  state: SettlementLivingState,
  locationId: string,
  tickIndex: number,
  tickTimeMs: number,
  coreNpcNames: string[]
): SettlementLivingState {
  const bp = ARCHETYPE_BLUEPRINTS[state.archetype];
  const timestamp = formatGameDateTime(tickTimeMs);

  let morale = state.morale;
  let populationEstimate = state.populationEstimate;
  let establishments = state.establishments;
  let activeProblems = state.activeProblems;
  let rumors = state.rumors;
  let notableResidents = state.notableResidents;
  let chronicle = state.chronicle;
  let dynamicHooks = state.dynamicHooks;
  let lastProblemTick = state.lastProblemTick;
  let lastRumorTick = state.lastRumorTick;
  let lastMilestoneTick = state.lastMilestoneTick;

  let eventHappened = false;

  // 1) Problem resolution attempt
  if (activeProblems.length > 0 && Math.random() < 0.28) {
    const targetProb = activeProblems[0];
    const template = bp.problems.find((p) => p.id === targetProb.templateId);
    const solveBonus = morale >= 60 ? 0.1 : morale <= 35 ? -0.1 : 0;
    const successChance = Math.min(0.8, 0.5 + targetProb.attempts * 0.12 + solveBonus);

    if (Math.random() < successChance) {
      activeProblems = activeProblems.slice(1);
      morale = Math.min(95, morale + 10);
      chronicle = pushChronicle(chronicle, {
        id: `ev-sol-${locationId}-${tickIndex}`,
        timestamp,
        kind: 'Çözüm',
        title: `${targetProb.title} Çözüldü`,
        detail:
          template?.villagerSolveDetail ??
          `${targetProb.title} meselesi bölgedekiler tarafından çözüme kavuşturuldu.`,
        moodImpact: +10,
      });
      eventHappened = true;

      // Low-probability renown gain
      const usedNames = new Set([
        ...coreNpcNames,
        ...notableResidents.map((r) => r.name),
      ]);
      const availableHeroes = bp.heroes.filter((h) => !usedNames.has(h.name));

      if (
        availableHeroes.length > 0 &&
        notableResidents.length < MAX_NOTABLE_RESIDENTS &&
        Math.random() < 0.30
      ) {
        const hero = availableHeroes[Math.floor(Math.random() * availableHeroes.length)];
        const renownNote = hero.renownTemplate(targetProb.title);
        notableResidents = [
          ...notableResidents,
          {
            id: hero.id,
            name: hero.name,
            role: hero.role,
            trait: hero.trait,
            renownNote,
            addedAt: timestamp,
          },
        ];
        morale = Math.min(96, morale + 4);
        const heroHook = `${hero.name} ile tanışıp öne çıktığı "${targetProb.title}" hakkında konuşmak.`;
        dynamicHooks = pushUniqueHook(dynamicHooks, heroHook);
        chronicle = pushChronicle(chronicle, {
          id: `ev-hero-${locationId}-${tickIndex}`,
          timestamp,
          kind: 'Nam',
          title: `${hero.name} Nam Kazandı`,
          detail: renownNote,
          moodImpact: +4,
          questHook: heroHook,
        });
      }
    } else {
      activeProblems = activeProblems.map((p, idx) =>
        idx === 0 ? { ...p, attempts: p.attempts + 1 } : p
      );
      morale = Math.max(15, morale - 4);
      chronicle = pushChronicle(chronicle, {
        id: `ev-fail-${locationId}-${tickIndex}`,
        timestamp,
        kind: 'Olay',
        title: `${targetProb.title} Sürüyor`,
        detail: 'Sorunu çözme girişimi sonuçsuz kaldı; bölgedeki tedirginlik biraz daha arttı.',
        moodImpact: -4,
      });
      eventHappened = true;
    }
  }

  // 2) Rare new problem emergence (cooldown >= 4 ticks = 48h, max 2 active)
  if (
    !eventHappened &&
    activeProblems.length < MAX_ACTIVE_PROBLEMS &&
    tickIndex - lastProblemTick >= 4 &&
    Math.random() < 0.11
  ) {
    const activeIds = new Set(activeProblems.map((p) => p.templateId));
    const candidates = bp.problems.filter((p) => !activeIds.has(p.id));
    if (candidates.length > 0 && Math.random() < 0.68) {
      const picked = candidates[Math.floor(Math.random() * candidates.length)];
      const newProblem: SettlementProblem = {
        id: `prob-${locationId}-${tickIndex}-${picked.id}`,
        templateId: picked.id,
        title: picked.title,
        description: picked.description,
        severity: picked.severity,
        startedAt: timestamp,
        attempts: 0,
      };
      activeProblems = [...activeProblems, newProblem];
      morale = Math.max(15, morale + picked.moodImpact);
      lastProblemTick = tickIndex;
      dynamicHooks = pushUniqueHook(dynamicHooks, picked.questHook);
      chronicle = pushChronicle(chronicle, {
        id: `ev-prob-${locationId}-${tickIndex}`,
        timestamp,
        kind: 'Sorun',
        title: `Yeni Sorun: ${picked.title}`,
        detail: picked.description,
        moodImpact: picked.moodImpact,
        questHook: picked.questHook,
      });
      eventHappened = true;
    } else {
      const proc = generateProceduralLivingProblem(state.archetype);
      const procMood = proc.severity === 'Yüksek' ? -9 : -5;
      const newProblem: SettlementProblem = {
        id: `prob-proc-${locationId}-${tickIndex}`,
        templateId: `proc-${tickIndex}`,
        title: proc.title,
        description: proc.description,
        severity: proc.severity,
        startedAt: timestamp,
        attempts: 0,
      };
      activeProblems = [...activeProblems, newProblem];
      morale = Math.max(15, morale + procMood);
      lastProblemTick = tickIndex;
      dynamicHooks = pushUniqueHook(dynamicHooks, proc.questHook);
      chronicle = pushChronicle(chronicle, {
        id: `ev-prob-${locationId}-${tickIndex}`,
        timestamp,
        kind: 'Sorun',
        title: `Yeni Sorun: ${proc.title}`,
        detail: proc.description,
        moodImpact: procMood,
        questHook: proc.questHook,
      });
      eventHappened = true;
    }
  }

  // 3) Very rare life/regional milestones
  if (
    !eventHappened &&
    tickIndex - lastMilestoneTick >= bp.milestoneCooldownTicks &&
    Math.random() < 0.07
  ) {
    const eligible = bp.milestones.filter((ms) => {
      if (ms.establishmentToAdd && establishments.includes(ms.establishmentToAdd)) return false;
      if (ms.residentToAdd && notableResidents.some((r) => r.name === ms.residentToAdd?.name)) {
        return false;
      }
      return true;
    });

    if (eligible.length > 0) {
      const ms = eligible[Math.floor(Math.random() * eligible.length)];
      lastMilestoneTick = tickIndex;
      morale = Math.max(15, Math.min(98, morale + ms.moodImpact));
      if (ms.populationDelta) populationEstimate += ms.populationDelta;
      if (ms.establishmentToAdd) establishments = [...establishments, ms.establishmentToAdd];
      if (ms.residentToAdd && notableResidents.length < MAX_NOTABLE_RESIDENTS) {
        notableResidents = [
          ...notableResidents,
          { ...ms.residentToAdd, addedAt: timestamp },
        ];
      }
      dynamicHooks = pushUniqueHook(dynamicHooks, ms.questHook);
      chronicle = pushChronicle(chronicle, {
        id: `ev-ms-${locationId}-${tickIndex}`,
        timestamp,
        kind: ms.kind,
        title: ms.title,
        detail: ms.detail,
        moodImpact: ms.moodImpact,
        questHook: ms.questHook,
      });
      eventHappened = true;
    }
  }

  // 4) Occasional context-valid rumors (cooldown >= 3 ticks = 36h)
  if (
    !eventHappened &&
    tickIndex - lastRumorTick >= 3 &&
    Math.random() < 0.18
  ) {
    const unseen = bp.rumors.filter((r) => !rumors.includes(r.text));
    if (unseen.length > 0 && Math.random() < 0.68) {
      const picked = unseen[Math.floor(Math.random() * unseen.length)];
      rumors = [picked.text, ...rumors.filter((r) => r !== picked.text)].slice(0, MAX_RUMORS);
      morale = Math.max(15, Math.min(96, morale + picked.moodImpact));
      lastRumorTick = tickIndex;
      if (picked.questHook) {
        dynamicHooks = pushUniqueHook(dynamicHooks, picked.questHook);
      }
      chronicle = pushChronicle(chronicle, {
        id: `ev-rum-${locationId}-${tickIndex}`,
        timestamp,
        kind: 'Dedikodu',
        title: 'Yeni Duyum Yayıldı',
        detail: picked.text,
        moodImpact: picked.moodImpact,
        questHook: picked.questHook,
      });
    } else {
      const procText = generateProceduralRumorText(state.archetype);
      const procImpact = Math.random() < 0.5 ? -2 : 2;
      rumors = [procText, ...rumors.filter((r) => r !== procText)].slice(0, MAX_RUMORS);
      morale = Math.max(15, Math.min(96, morale + procImpact));
      lastRumorTick = tickIndex;
      chronicle = pushChronicle(chronicle, {
        id: `ev-rum-${locationId}-${tickIndex}`,
        timestamp,
        kind: 'Dedikodu',
        title: 'Yeni Duyum Yayıldı',
        detail: procText,
        moodImpact: procImpact,
      });
    }
  }

  // Gentle natural drift back toward archetype baseline morale when calm
  if (activeProblems.length === 0 && morale !== bp.baselineMorale) {
    morale = morale < bp.baselineMorale ? morale + 1 : morale - 1;
  }

  return {
    ...state,
    lastSimulatedMs: tickTimeMs,
    lastProblemTick,
    lastRumorTick,
    lastMilestoneTick,
    populationEstimate,
    morale,
    mood: computeMoodFromMorale(morale),
    establishments,
    activeProblems,
    rumors,
    notableResidents,
    chronicle,
    dynamicHooks,
  };
}

export function advanceLivingLocations(
  locations: MapLocation[],
  nextTimeMs: number,
  routes: MapRoute[] = [],
  protagonist?: ProtagonistState
): MapLocation[] {
  const targetTick = Math.floor((nextTimeMs - INITIAL_GAME_TIME_MS) / SIMULATION_TICK_MS);
  let didAnyLocationChange = false;
  const tickedIds = new Set<string>();

  const updated = locations.map((loc) => {
    const ls = loc.livingState;
    if (!ls || !ls.enabled) return loc;

    const currentTick = Math.floor((ls.lastSimulatedMs - INITIAL_GAME_TIME_MS) / SIMULATION_TICK_MS);
    if (targetTick <= currentTick) {
      return loc;
    }

    const totalTicks = targetTick - currentTick;
    const ticksToRun = Math.min(MAX_TICKS_PER_JUMP, totalTicks);
    const startTick = targetTick - ticksToRun + 1;

    let nextState = ls;
    for (let t = startTick; t <= targetTick; t++) {
      const tickMs = INITIAL_GAME_TIME_MS + t * SIMULATION_TICK_MS;
      nextState = simulateSingleLocationTick(
        nextState,
        loc.id,
        t,
        tickMs,
        loc.npcsOrFoes
      );
    }

    // Protagonist presence subtly stabilizes friendly settlements during time passage
    if (protagonist && protagonist.locationId === loc.id) {
      const faction = getFactionForLocation(loc);
      const rep = protagonist.reputation[faction] ?? 0;
      if (rep >= 20 && nextState.morale < 96) {
        const stabilizedMorale = Math.min(96, nextState.morale + 1);
        nextState = {
          ...nextState,
          morale: stabilizedMorale,
          mood: computeMoodFromMorale(stabilizedMorale),
        };
      }
    }

    tickedIds.add(loc.id);
    didAnyLocationChange = true;
    return {
      ...loc,
      livingState: nextState,
    };
  });

  if (!didAnyLocationChange) return locations;

  // Cross-location neighbor spillover along active map routes
  if (routes.length === 0) return updated;

  const byId = new Map(updated.map((l) => [l.id, l]));
  const neighborLookup = new Map<string, string[]>();
  for (const r of routes) {
    const listA = neighborLookup.get(r.fromId) ?? [];
    listA.push(r.toId);
    neighborLookup.set(r.fromId, listA);

    const listB = neighborLookup.get(r.toId) ?? [];
    listB.push(r.fromId);
    neighborLookup.set(r.toId, listB);
  }

  const timestamp = formatGameDateTime(nextTimeMs);
  return updated.map((loc) => {
    const ls = loc.livingState;
    if (!ls || !ls.enabled || !tickedIds.has(loc.id)) return loc;

    const connectedIds = neighborLookup.get(loc.id) ?? [];
    if (connectedIds.length === 0) return loc;

    const neighbors = connectedIds
      .map((cid) => byId.get(cid))
      .filter((n): n is MapLocation => Boolean(n && n.livingState));

    // Troubled or low-morale connected neighbors spread low-probability rumors/tension
    const troubledNeighbor = neighbors.find(
      (n) => (n.livingState?.activeProblems.length ?? 0) > 0 || (n.livingState?.morale ?? 60) <= 38
    );
    if (troubledNeighbor && Math.random() < 0.14) {
      const probTitle = troubledNeighbor.livingState?.activeProblems[0]?.title;
      const rumorText = probTitle
        ? `${troubledNeighbor.name} yönünden gelen yolcular "${probTitle}" yüzünden yolun gergin olduğunu anlatıyor.`
        : `${troubledNeighbor.name} çevresinde halkın tedirgin olduğu ve nöbetlerin sıkılaştığı duyulmuş.`;
      if (!ls.rumors.includes(rumorText)) {
        const nextMorale = Math.max(15, ls.morale - 2);
        const hook = probTitle
          ? `${troubledNeighbor.name} tarafındaki "${probTitle}" durumunu yerinde araştırmak.`
          : `${troubledNeighbor.name} yolundaki gerginliğin nedenini öğrenmek.`;
        return {
          ...loc,
          livingState: {
            ...ls,
            morale: nextMorale,
            mood: computeMoodFromMorale(nextMorale),
            rumors: [rumorText, ...ls.rumors].slice(0, MAX_RUMORS),
            dynamicHooks: pushUniqueHook(ls.dynamicHooks, hook),
            chronicle: pushChronicle(ls.chronicle, {
              id: `ev-spill-${loc.id}-${targetTick}`,
              timestamp,
              kind: 'Dedikodu',
              title: `${troubledNeighbor.name} Haberleri Ulaştı`,
              detail: rumorText,
              moodImpact: -2,
              questHook: hook,
            }),
          },
        };
      }
    }

    // Calm high-morale neighbors occasionally bring positive trade rumors
    const thrivingNeighbor = neighbors.find(
      (n) =>
        n.category === 'village' &&
        (n.livingState?.morale ?? 0) >= 80 &&
        (n.livingState?.activeProblems.length ?? 0) === 0
    );
    if (thrivingNeighbor && Math.random() < 0.08) {
      const rumorText = `${thrivingNeighbor.name} yönünde yolların açık olduğu, kervan ve takasın canlandığı konuşuluyor.`;
      if (!ls.rumors.includes(rumorText)) {
        const nextMorale = Math.min(96, ls.morale + 2);
        return {
          ...loc,
          livingState: {
            ...ls,
            morale: nextMorale,
            mood: computeMoodFromMorale(nextMorale),
            rumors: [rumorText, ...ls.rumors].slice(0, MAX_RUMORS),
            chronicle: pushChronicle(ls.chronicle, {
              id: `ev-spill-ok-${loc.id}-${targetTick}`,
              timestamp,
              kind: 'Dedikodu',
              title: `${thrivingNeighbor.name} Yolundan İyi Haber`,
              detail: rumorText,
              moodImpact: +2,
            }),
          },
        };
      }
    }

    return loc;
  });
}

export function resolveSettlementProblemByParty(
  location: MapLocation,
  problemId: string,
  gameTimeMs: number
): MapLocation {
  const ls = location.livingState;
  if (!ls) return location;
  const target = ls.activeProblems.find((p) => p.id === problemId);
  if (!target) return location;

  const timestamp = formatGameDateTime(gameTimeMs);
  const nextMorale = Math.min(98, ls.morale + 14);
  const hook = `${target.title} çözümünden sonra bölgede grubun adı saygıyla anılmaya başlandı.`;

  return {
    ...location,
    livingState: {
      ...ls,
      morale: nextMorale,
      mood: computeMoodFromMorale(nextMorale),
      activeProblems: ls.activeProblems.filter((p) => p.id !== problemId),
      dynamicHooks: pushUniqueHook(ls.dynamicHooks, hook),
      chronicle: pushChronicle(ls.chronicle, {
        id: `ev-party-solve-${Date.now()}`,
        timestamp,
        kind: 'Çözüm',
        title: `${target.title} Grup Tarafından Çözüldü`,
        detail:
          'Maceracı grubun müdahalesi sorunu kesin olarak çözdü; bölgenin morali ve güvenliği yükseldi.',
        moodImpact: +14,
        questHook: hook,
      }),
    },
  };
}

export function recordProceduralSceneOnLocation(
  location: MapLocation,
  scene: ProceduralSceneCard,
  gameTimeMs: number
): MapLocation {
  const ls = location.livingState;
  if (!ls) return location;

  const timestamp = formatGameDateTime(gameTimeMs);
  const nextMorale = Math.max(15, Math.min(98, ls.morale + scene.moodImpact));
  const hook = `${scene.title} — ${scene.tactic} (${scene.checkLabel})`;

  return {
    ...location,
    livingState: {
      ...ls,
      morale: nextMorale,
      mood: computeMoodFromMorale(nextMorale),
      dynamicHooks: pushUniqueHook(ls.dynamicHooks, hook),
      chronicle: pushChronicle(ls.chronicle, {
        id: `ev-proc-scene-${Date.now()}`,
        timestamp,
        kind: scene.category === 'Tehlike ve Çatışma' ? 'Sorun' : 'Olay',
        title: scene.title,
        detail: `${scene.description} ${scene.complication}`,
        moodImpact: scene.moodImpact,
        questHook: hook,
      }),
    },
  };
}

export function applyExternalMoraleShift(
  location: MapLocation,
  moraleDelta: number,
  gameTimeMs: number,
  noteTitle?: string,
  noteDetail?: string
): MapLocation {
  const ls = location.livingState;
  if (!ls || (!moraleDelta && !noteDetail)) return location;

  const timestamp = formatGameDateTime(gameTimeMs);
  const nextMorale = Math.max(15, Math.min(98, ls.morale + moraleDelta));

  return {
    ...location,
    livingState: {
      ...ls,
      morale: nextMorale,
      mood: computeMoodFromMorale(nextMorale),
      chronicle: noteDetail
        ? pushChronicle(ls.chronicle, {
            id: `ev-protag-${Date.now()}`,
            timestamp,
            kind: moraleDelta >= 0 ? 'Olay' : 'Sorun',
            title: noteTitle ?? 'Yolcu Etkisi',
            detail: noteDetail,
            moodImpact: moraleDelta,
          })
        : ls.chronicle,
    },
  };
}

export function recordRoamingArrivalOnLocation(
  location: MapLocation,
  unitName: string,
  unitKind: 'patrol' | 'caravan' | 'raider' | 'scout',
  detail: string,
  moraleDelta: number,
  gameTimeMs: number,
  spawnRaidProblem = false
): MapLocation {
  const ls = location.livingState;
  if (!ls || !ls.enabled) return location;

  const timestamp = formatGameDateTime(gameTimeMs);
  const nextMorale = Math.max(15, Math.min(98, ls.morale + moraleDelta));
  let activeProblems = ls.activeProblems;

  if (spawnRaidProblem && activeProblems.length < 2 && unitKind === 'raider') {
    const alreadyRaid = activeProblems.some((p) => p.title.includes(unitName));
    if (!alreadyRaid) {
      activeProblems = [
        ...activeProblems,
        {
          id: `prob-roam-${location.id}-${Date.now()}`,
          templateId: `roam-raid-${unitKind}`,
          title: `${unitName} Tacizi`,
          description: `${unitName} yerleşimin dış patikalarında erzak ve gümüş yoklaması yapıyor.`,
          severity: 'Orta',
          startedAt: timestamp,
          attempts: 0,
        },
      ];
    }
  }

  return {
    ...location,
    livingState: {
      ...ls,
      morale: nextMorale,
      mood: computeMoodFromMorale(nextMorale),
      activeProblems,
      rumors: [detail, ...ls.rumors.filter((r) => r !== detail)].slice(0, MAX_RUMORS),
      chronicle: pushChronicle(ls.chronicle, {
        id: `ev-roam-${location.id}-${Date.now()}-${Math.floor(Math.random() * 99)}`,
        timestamp,
        kind: unitKind === 'raider' ? 'Sorun' : 'Olay',
        title: `${unitName} Bölgeye Ulaştı`,
        detail,
        moodImpact: moraleDelta,
      }),
    },
  };
}


