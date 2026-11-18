import mapOverworldImg from '../assets/images/eastern_mist_forest_vast_map_hd.webp';
import villageImg from '../assets/images/loc_mist_village_1794773904934.jpg';
import elfVillageImg from '../assets/images/loc_elf_village_1794843688127.jpg';
import beastkinVillageImg from '../assets/images/loc_beastkin_village_1794843688345.jpg';
import goblinBurrowsImg from '../assets/images/loc_goblin_burrows_1794843688278.jpg';
import cliffImg from '../assets/images/loc_cliff_bastion_1794773905499.jpg';
import type { ForestEncounter, LocationCategory, MapLocation, MapRoute, MistWeather } from '../types/map';
import { createInitialLivingStateForLocation } from '../utils/livingWorldEngine';

export const OVERWORLD_MAP_IMAGE = mapOverworldImg;

export const REGION_INFO = {
  title: 'Kadim Sis Ormanı',
  continentPosition: 'Kıtanın Doğu Sınırı · 300 Fersahlık Sınır Bölgesi',
  summary:
    'Kıtanın doğusunda sıradağlardan okyanusa uzanan soğuk, nemli ve yoğun sisli büyük orman bölgesi. Batıda insan sınır kaleleri ve küçük köyler (insan yerleşimlerinde borçlu ve savaş tutsağı köleliği yasal ve olağan bir kurumdur), iç vadilerde çekingen elf ve hayvan kulaklı klan yerleşimleri, kayalık eteklerde ilkel goblin-kobold inleri yer alır.',
};

export const CATEGORY_LABELS: Record<LocationCategory, string> = {
  village: 'Yerleşim',
  burrow: 'İlkel İn',
  ruin: 'Harabe',
  nature: 'Doğa Alanı',
  danger: 'Tehlike Bölgesi',
  crossing: 'Geçit ve Yol',
};

const BASE_LOCATIONS: MapLocation[] = [
  {
    id: 'loc-kuldere',
    name: 'Külköy Sınır Kalesi',
    subtitle: 'İnsan Sınır Kasabası · Batı Eşiği',
    category: 'village',
    x: 11.2,
    y: 55.2,
    dangerLevel: 1,
    travelTime: 'Başlangıç Noktası',
    discovered: false,
    imageUrl: villageImg,
    playerLore:
      'Büyük orman kuşağına girmeden önceki en büyük surlu insan yerleşimi. Ahşap palizadların içinde oduncular, tuz kervanları ve orman rehberleri konaklar. İnsan sınır yasaları gereği Külköy taş meydanında borçlu sözleşmeleri, yakalanan haydutlar ve savaş tutsaklarının alınıp satıldığı yasal bir köle ve esir pazarı da olağan düzenin parçasıdır.',
    gmSecret:
      'Komutan Balthor, güneydeki goblin baskınlarının artması nedeniyle demir sevkiyatını korumak için paralı izci arıyor. Kale mübaşiri ve köle kâtibi Varen ise yakalanan kuzey haydutları için kale başına düzenli alım bedeli ödüyor; tüccar loncası da Bozpençe kürk fiyatlarını gizlice düşürmeye çalışıyor.',
    hooks: [
      'Gümüş Köprü üzerinden gelecek kervana eşlik edip yolu kontrol etmek',
      'Kuzeydeki Batakhan köyünden haftalardır vergi arabası dönmediğini araştırmak',
      'Külköy Köle ve Tutsak Pazarından ücret gerektirmeyen bir bağlı muhafız/hizmetkâr edinmek veya yakalanan haydutları satmak',
    ],
    npcsOrFoes: ['Komutan Balthor (Eski Yüzbaşı)', 'Hancı Torin', 'Demirci Mira', 'Köle Kâtibi Varen'],
    loot: ['Yağlı Fırtına Feneri', 'Mühürlü Sınır Geçiş Belgesi', '15 Günlük Kuru Erzak'],
  },
  {
    id: 'loc-kulova-koyu',
    name: 'Kulova Çoban Köyü',
    subtitle: 'Küçük İnsan Köyü · Kuzeybatı Düzlüğü',
    category: 'village',
    x: 13.8,
    y: 39.2,
    dangerLevel: 1,
    travelTime: 'Külköy\'den 1 Gün',
    discovered: false,
    imageUrl: villageImg,
    playerLore:
      'Külköy\'ün kuzeyindeki rüzgarlı yamaç eteklerinde kurulmuş on beş haneli küçük çoban ve yün dokumacısı köyü. Taş ağılları, kurutulmuş peynir mahzenleri ve orman sınırını gözleyen tek katlı bir ahşap kulesi vardır.',
    gmSecret:
      'Son iki haftadır sürülerden birkaç koyun kayboldu; köylüler bunun sıradan bir kurt sürüsü işi olduğunu sanıyor ancak kuzeydeki Batakhan\'dan gelen hırsızlar geceleri ağıllara sızıyor.',
    hooks: [
      'Kaybolan koyunların izini kuzeydeki sığ dere boyunca sürmek',
      'Kışlık kalın yün pelerin ve keçe bot satın almak',
    ],
    npcsOrFoes: ['Muhtar Doren', 'Çoban İlyas', 'Yün Dokumacısı Helga'],
    loot: ['Yünlü Çoban Kepeneği', 'Tuzlanmış Koyun Peyniri', 'Çoban Sopası ve Sapan'],
  },
  {
    id: 'loc-derebasi-koyu',
    name: 'Derebaşı Oduncu Köyü',
    subtitle: 'Küçük İnsan Köyü · Güneybatı Nehir Kıyısı',
    category: 'village',
    x: 19.2,
    y: 65.2,
    dangerLevel: 2,
    travelTime: 'Külköy\'den Yarım Gün',
    discovered: false,
    imageUrl: villageImg,
    playerLore:
      'Sirkad Nehri\'nin batı kolu üzerinde kurulmuş küçük kereste ve odun kömürü köyü. Nehir boyunca dizili su değirmenleri, tomruk kızakları ve kömür ocaklarından çıkan is kokusu her yere sinmiştir.',
    gmSecret:
      'Oduncu ustabaşı Mara, güneydeki Dev Çamlar bölgesine izinsiz giren iki çırağının geri dönmediğini saklıyor; kaybolanların orman ayılarıyla mı yoksa güney goblinleriyle mi karşılaştığından emin değil.',
    hooks: [
      'Nehirdeki tomruk salıyla Gümüş Köprü\'ye hızlı ulaşım sağlamak',
      'Orman sınırında kaybolan oduncu çıraklarını bulmak',
    ],
    npcsOrFoes: ['Oduncu Ustabaşı Mara', 'Kömürcü Orak', 'Salcı Genç Tobi'],
    loot: ['Çift Ağızlı Oduncu Baltası', 'Ziftli Meşale (6 Adet)', 'Nehir Salı Geçişi'],
  },
  {
    id: 'loc-batakhan',
    name: 'Batakhan Köyü',
    subtitle: 'Tekin Olmayan Kuzey Köyü · Sınır Ötesi',
    category: 'danger',
    x: 17.2,
    y: 16.2,
    dangerLevel: 4,
    travelTime: 'Kulova\'dan 2.5 Gün',
    discovered: false,
    playerLore:
      'Kuzeybatıdaki soğuk dere kıyısına sıkışmış, yarısı yıkık ve terk edilmiş tekin olmayan küçük köy. Yıllar önce yaşanan ağır kış kıtlığından sonra kalan az sayıdaki köylü yabancı gördüğünde kapılarını sürgüler; köy meydanındaki paslı çan rüzgarda kendiliğinden inler.',
    gmSecret:
      'Köyün sağlam kalan hanında ve ahırlarında aslında kuzey yollarını haraca bağlayan soğukkanlı bir haydut çetesi barınıyor. Gerçek köylüler ya çeteye sessizce boyun eğmiş ya da korkudan evlerinden çıkamıyor; dışarıdan gelen yolcuları gece ahırlarda soyup kuzey bataklığına sürerler.',
    hooks: [
      'Görünüşte misafirperver hancının sunduğu sıcak çorbanın ardındaki tuzağı fark etmek',
      'Köyün kilerinde esir tutulan Külköy vergi memurunu kurtarmak',
    ],
    npcsOrFoes: ['Sahte Hancı Vorn', 'Kuzey Eşkıyaları (5 Kişi)', 'Korkmuş Köy Yaşlısı'],
    loot: ['Çalıntı Vergi Kesesi (60 Gümüş)', 'Siyah Deri Haydut Pelerini', 'Kuzey Yol Haritası'],
  },
  {
    id: 'loc-sogutlu-batak',
    name: 'Söğütlü Bataklık Adacıkları',
    subtitle: 'Sığ Göl ve Sazlık Alan · İnsan Yerleşimi Yok',
    category: 'nature',
    x: 30.2,
    y: 43.2,
    dangerLevel: 3,
    travelTime: 'Kulova\'dan 2 Gün',
    discovered: false,
    playerLore:
      'Kuzey dağlarından inen nehrin sığlaşıp onlarca küçük sazlık adacığa ayrıldığı sisli bataklık havzası. Burada kalıcı yerleşim yoktur; yalnızca dev söğüt kökleri, bataklık kamışları, çamura saplanmış eski araba kalıntıları ve soğuk su kuşları bulunur.',
    gmSecret:
      'Bataklığın ortasındaki kuru taş adacıkta gezgin bir bitki toplayıcısı geçici kamp kurmuştur. Sazlıkların içinde ise dev su yılanları ve çamur tuzakları yüzünden zırhlı yolcuların batma tehlikesi vardır.',
    hooks: [
      'Bataklığa batmış eski tüccar arabasının kilitli sandığını çıkarmak',
      'İyileştirici ateş düşürücü bataklık kökleri toplamak',
    ],
    npcsOrFoes: ['Bitki Toplayıcısı Soren', 'Dev Çamur Sülükleri', 'Bataklık Kertenkeleleri'],
    loot: ['Panzehir ve Ateş Düşürücü Otlar', 'Batık Kervandan 1 Kasa Kaliteli Şarap'],
  },
  {
    id: 'loc-yasli-meselik',
    name: 'Dev Çamlar Av Alanı',
    subtitle: 'Vahşi Ormanlık Bölge · İnsan Yerleşimi Yok',
    category: 'nature',
    x: 15.2,
    y: 81.5,
    dangerLevel: 3,
    travelTime: 'Derebaşı\'ndan 2 Gün',
    discovered: false,
    playerLore:
      'Güneybatıdaki balta girmemiş, gökyüzünü kapatan dev çam ve meşelerle dolu sık orman. İnsanların ağaç kesmeye cesaret edemediği bu bölgede yalnızca geyik sürüleri, büyük gri kurtlar ve kayalık kovuklarda yaşayan orman ayıları dolaşır.',
    gmSecret:
      'Ormanın kalbindeki devrilmiş ağaçların altında yaşlı ama devasa bir bozayı in kurmuştur. Bozpençe klanı gençleri rüştlerini ispatlamak için yılın belli dönemlerinde bu bölgeye sessizce av izi bırakır.',
    hooks: [
      'Ağaç gövdelerine kazınmış Bozpençe av işaretlerini takip ederek güney yolunu açmak',
      'Yaralı bir avcıyı dev gri kurt sürüsünün elinden kurtarmak',
    ],
    npcsOrFoes: ['Yaşlı Orman Bozayısı', 'Gri Kurt Sürüsü (6 Adet)'],
    loot: ['Bozayı Postu', 'Sağlam Geyik Boynuzu', 'Kaybolmuş Avcı Çantası'],
  },
  {
    id: 'loc-gumus-kopru',
    name: 'Gümüş Köprü Geçidi',
    subtitle: 'Taş Köprü ve Gümrük Kulübesi',
    category: 'crossing',
    x: 38.2,
    y: 60.2,
    dangerLevel: 2,
    travelTime: 'Külköy\'den 2 Gün',
    discovered: false,
    playerLore:
      'Kuzey dağlarından inen hızlı Sirkad Nehri üzerindeki en sağlam eski taş köprü. Kıyıda terk edilmiş bir gümrük kulübesi ve yolcuların gece konakladığı kuru taş ocaklar bulunur.',
    gmSecret:
      'Son yağmurlardan sonra köprünün güney ayağında çatlak oluştu ve güneydeki goblin izcileri geceleri köprü başından geçen yalnız arabaları gözetliyor.',
    hooks: [
      'Köprü korkuluğuna bırakılmış yanık tahta uyarı işaretini incelemek',
      'Nehrin sığ geçidinden kaçak mal geçiren bir tekneyi durdurmak',
    ],
    npcsOrFoes: ['Köprü Gözcüsü Halen', 'Yolkesen Çetesi (4 Kişi)'],
    loot: ['Su Geçirmez Harita Silindiri', 'Çelik Halat ve Kanca'],
  },
  {
    id: 'loc-sisli-koyak',
    name: 'Yosunlu Koyak ve Taş Kemer',
    subtitle: 'Issız Orman Vadisi · İnsan Yerleşimi Yok',
    category: 'ruin',
    x: 46.2,
    y: 48.2,
    dangerLevel: 3,
    travelTime: 'Köprüden 1.5 Gün',
    discovered: false,
    playerLore:
      'Sisin yıl boyu vadi tabanına çöktüğü derin, sessiz orman koyağı. Çevrede hiçbir yerleşim bulunmaz; yalnızca ormanın ortasında kim tarafından yapıldığı unutulmuş yıkık bir taş kemer ve kuruyup yosun tutmuş eski bir kuyu yer alır.',
    gmSecret:
      'Vahşi hayvanlar bu kuyunun çevresine nedense pek yaklaşmaz ve pusula ibresi burada hafifçe titrer; dünyada çok nadir görülen eski çağ izlerinden biridir. Ancak ortada ne canavar ne de aktif bir büyü vardır — yalnızca haydutların gizli buluşma noktası olarak kullandığı soğuk bir taş yıkıntıdır.',
    hooks: [
      'Taş kemerin dibinde gizlenmiş su geçirmez yağlı deri paketi bulmak',
      'Fırtınalı gecede yıkıntıya sığınan iki farklı grubun gerilimli karşılaşmasına tanık olmak',
    ],
    npcsOrFoes: ['Terk Edilmiş Kamp İzi', 'Orman Vaşağı'],
    loot: ['Eski Gümüş Mühür Yüzüğü', 'Paslanmamış Hançer'],
  },
  {
    id: 'loc-elf-koyu',
    name: 'Yüksekçam Elf Köyü',
    subtitle: 'Elf Orman Yerleşimi · Kuzey İç Orman',
    category: 'village',
    x: 46.8,
    y: 33.5,
    dangerLevel: 2,
    travelTime: 'Koyaktan 2 Gün',
    discovered: false,
    imageUrl: elfVillageImg,
    playerLore:
      'İnsan ticaret yollarından uzak, yüksek çam vadisinin derinliklerine gizlenmiş köklü elf yerleşimi. Dev ağaç gövdelerinin etrafına sedir kalaslarla kurulmuş yüksek platformlar, yosunlu kiremit çatılar ve asma halat köprülerle tamamen ormana uyumlu şekilde inşa edilmiştir.',
    gmSecret:
      'Köyün yaşlı avcıları, kuzeydoğudaki maden oyuklarına yeni bir kobold-goblin sürüsünün yerleştiğini fark etti ancak insanlarla ticaret yapmadan bu tehdidi sessizce bastırmak istiyorlar. Nadir görülen eski taş yazıtlardan bazıları bu köyün arşivinde saklıdır.',
    hooks: [
      'Elflerin güvenini kazanıp kuzey dağ patikasının güvenli geçiş iznini almak',
      'Ağaç kesmeye gelen insan oduncu birliğiyle elf devriyesi arasındaki gerilimi çözmek',
    ],
    npcsOrFoes: ['Köy Sözcüsü Aelindor', 'Baş Avcı Seraphina', 'Marangoz Thalen'],
    loot: ['Uzun Porsuk Yayı (+1 Menzil)', 'Ses Çıkarmayan Keçe Çizme', 'Şifalı Reçine Merhemi'],
  },
  {
    id: 'loc-beastkin-koyu',
    name: 'Bozpençe Klan Köyü',
    subtitle: 'Hayvan Kulaklılar Yerleşimi · Güneydoğu',
    category: 'village',
    x: 71.8,
    y: 72.5,
    dangerLevel: 2,
    travelTime: 'Göl Kıyısından 2 Gün',
    discovered: false,
    imageUrl: beastkinVillageImg,
    playerLore:
      'Büyük iç gölün güneydoğusundaki av hayvanı bol orman yarımadasına kurulmuş vaşak, kurt ve tilki kulaklı kabilelerin köyü. Kütük ve kalın deriden yapılmış sağlam kulübeler, kürk kurutma askıları, tütsülenmiş balık ocakları ve keskin kulaklı gözcüleriyle dışarıya karşı temkinli ama adil bir topluluktur.',
    gmSecret:
      'Klan lideri Kurt-Kulak Karok, batıdaki goblin inlerinden çalınan kışlık tuz ve demir tuzaklarını geri almak istiyor. Köyde çok nadir görülen eski bir gümüş tılsımı şifacı yaşlıya emanet etmişler; kimse nasıl çalıştığını bilmiyor.',
    hooks: [
      'Klanla kürk, kurutulmuş balık ve orman haritası takası yapmak',
      'Kış avını tehdit eden yaşlı bozayıyı veya güney yağmacılarını uzaklaştırmak',
    ],
    npcsOrFoes: ['Klan Şefi Karok', 'Tabakçı ve İzci Lyra (Tilki Kulaklı)', 'Balıkçı Vorn'],
    loot: ['Kalın Kurt Kürkü Pelerin (Soğuğa Direnç)', 'İsli Balık Erzağı', 'Kemik Saplı Av Bıçağı'],
  },
  {
    id: 'loc-goblin-inleri',
    name: 'Paslıçukur İnleri',
    subtitle: 'Goblin ve Kobold Ortak İnleri · Güney',
    category: 'burrow',
    x: 27.2,
    y: 80.6,
    dangerLevel: 4,
    travelTime: 'Köprüden 3 Gün',
    discovered: false,
    imageUrl: goblinBurrowsImg,
    playerLore:
      'Güneydeki çamurlu tepe eteklerine ve eski taş ocaklarına kazılmış ilkel yeraltı inleri. Goblin yağmacılar ile kobold kazıcıların bir arada yaşadığı bu karmaşık tünel ağı; sivri kazık barikatları, yırtık deri çadırları, paslı hurda silahları ve kemik yığınlarıyla çevrilidir.',
    gmSecret:
      'Koboldlar tünelleri kazıp tuzaklı dar geçitler kurarken, goblinler çevredeki kervanlardan gıda ve demir çalmaktadır. Aralarındaki işbirliği kırılgan; liderleri Kırıkdiş devrilirse iki grup birbirine düşer.',
    hooks: [
      'Esir düşen tüccar çırağını tünellerin alt katından sağ çıkarmak',
      'Goblinler ile koboldlar arasındaki erzak anlaşmazlığını körükleyip kampı dağıtmak',
    ],
    npcsOrFoes: ['Goblin Çete Başı Kırıkdiş', 'Kobold Tünel Kazıcıları (8 Adet)', 'Sapanlı Gözcüler'],
    loot: ['Çalınmış Demir Külçeler', 'Kaba Deri Zırh', 'Kervan Kasası (45 Gümüş Sikke)'],
  },
  {
    id: 'loc-goblin-kuzey-ini',
    name: 'Çakmaktaşı Oyukları',
    subtitle: 'Kobold ve Goblin Mağara İni · Kuzeydoğu',
    category: 'burrow',
    x: 68.5,
    y: 24.5,
    dangerLevel: 4,
    travelTime: 'Elf Köyünden 2 Gün',
    discovered: false,
    imageUrl: goblinBurrowsImg,
    playerLore:
      'Kuzeydoğu yamaçlarındaki terk edilmiş çakmaktaşı damarlarının içine yerleşmiş kalabalık bir başka ilkel klan. Mağara ağızları devrilmiş ağaç gövdeleri ve ipten yapılma alarm çıngıraklarıyla korunur.',
    gmSecret:
      'Koboldlar dağın derinlerinde eski bir krallık madenine denk gelmiş ve oradan çıkardıkları eski bronz baltaları kullanıyorlar. Elf köyünün güney sınırına gece avları düzenliyorlar.',
    hooks: [
      'Yüksekçam Elf Köyü adına mağara ağzındaki gözcü kulesini etkisiz hale getirmek',
      'Çöken eski maden galerisinin haritasını çıkarmak',
    ],
    npcsOrFoes: ['Kobold Kazıcı Başı Tıkır', 'Mağara Goblinleri', 'Eğitilmiş Kaya Köpekleri'],
    loot: ['Çakmaktaşı ve Çelik Kutu', 'Eski Bronz Madenci Baltası', 'Ham Bakır Cevheri'],
  },
  {
    id: 'loc-kuzey-gecit',
    name: 'Kuzey Dağ Geçidi',
    subtitle: 'Karlı Sıradağ Etekleri',
    category: 'crossing',
    x: 28.5,
    y: 29.2,
    dangerLevel: 3,
    travelTime: 'Söğütlü Batak\'tan 1.5 Gün',
    discovered: false,
    playerLore:
      'Yüksek karlı zirvelerin eteğinde, eriyen kar sularının beslediği soğuk vadi geçidi. Yoğun dağ sisi ve sık sık yaşanan taş kaymaları yüzünden yalnızca deneyimli kılavuzlar bu yolu kullanır.',
    gmSecret:
      'Geçidin ortasındaki dar boğazda kışın mahsur kalmış bir vergi arabası enkazı var; bölgeyi av sahası yapan vahşi kurt sürüsü enkazın çevresindeki mağaralarda yavrulamış.',
    hooks: [
      'Buz tutmuş kervan arabasındaki kapalı kasa defterini kurtarmak',
      'Taş kaymasının kapattığı patikada güvenli bir yan geçiş bulmak',
    ],
    npcsOrFoes: ['Gri Dağ Kurtları (5 Adet)', 'Donmuş Kervan İzi'],
    loot: ['Kalın Yün Battaniye', 'Demir Kasa Anahtarı', 'Gümüş Sikke Kesesi'],
  },
  {
    id: 'loc-fisildayan-gol',
    name: 'Ayna Gölü Balıkçı Kıyısı',
    subtitle: 'Büyük İç Göl · Ormanın Merkezi',
    category: 'nature',
    x: 58.5,
    y: 54.5,
    dangerLevel: 2,
    travelTime: 'Köprüden 3 Gün',
    discovered: false,
    playerLore:
      'Ormanın tam ortasını kaplayan geniş, durgun tatlı su gölü. Sazlık kıyılarda Bozpençe klanının ve gezgin tuzakçıların kurduğu ahşap iskeleler ile kurutma direkleri yer alır. Göl üzerinde yoğun sabah sisi çöktüğünde kıyıyı kaybetmek kolaydır.',
    gmSecret:
      'Gölün doğu yakasındaki sazlıklar arasında gizlenmiş küçük bir sığ geçit, doğrudan Bozpençe köyüne çıkar. Sular çekildiğinde gölün kuzey ucunda yüzlerce yıllık eski bir taş rıhtım temeli görünür.',
    hooks: [
      'Siste yolunu kaybetmiş balıkçı teknesinin fener sesini takip etmek',
      'Bozpençe köyüne ulaşmak için gölden kayık kiralamak',
    ],
    npcsOrFoes: ['Yaşlı Balıkçı Gorim', 'Sazlık Domuzu Sürüsü'],
    loot: ['Ahşap Kürek ve Kayık', 'Tuzlanmış Göl Alabalığı', 'Yön Pusulası'],
  },
  {
    id: 'loc-mantar-vadisi',
    name: 'Dev Eğrelti ve Kütük Vadisi',
    subtitle: 'Nemli Güney Ormanı · İnsan Yerleşimi Yok',
    category: 'nature',
    x: 54.5,
    y: 75.5,
    dangerLevel: 3,
    travelTime: 'Bozpençe Köyünden 2 Gün',
    discovered: false,
    playerLore:
      'Büyük iç gölün güneyinde güneş ışığının tabana zor ulaştığı nemli, dev devrik kütükler, kalın eğrelti otları ve renkli orman mantarlarıyla kaplı derin vadi. İnsanlar buraya neredeyse hiç girmez; ormanın doğal ekolojisinin en yoğun yaşandığı bölgedir.',
    gmSecret:
      'Paslıçukur goblinleri ve Bozpençe toplayıcıları zaman zaman vadi tabanındaki nadir şifalı mantarları toplarken karşı karşıya gelir. Ayrıca kütüklerin altında zehirli dikenli sürüngenler yuvalanmıştır.',
    hooks: [
      'Külköy hekimi için nadir beyaz kabuk mantarı toplamak',
      'İz süren yaralı bir Bozpençe avcısını vadiden çıkarmak',
    ],
    npcsOrFoes: ['Goblin Mantar Toplayıcıları', 'İri Yaban Domuzu Sürüsü'],
    loot: ['Şifalı Kabuk Mantarları', 'Doğal Reçine ve Zehir Özü'],
  },
  {
    id: 'loc-kartal-kayaligi',
    name: 'Kızılşahin Kayalıkları',
    subtitle: 'Yüksek Orman Sırtı · İnsan Yerleşimi Yok',
    category: 'nature',
    x: 73.2,
    y: 45.2,
    dangerLevel: 3,
    travelTime: 'Göl Kıyısından 2 Gün',
    discovered: false,
    playerLore:
      'İç göl ile doğu deniz uçurumları arasında yükselen sarp kireçtaşı sırtları. Ağaç sınırının üzerinde kaldığı için gölü ve orman denizini kuşbakışı görmek mümkündür; büyük kaya kartalları ve dağ keçileri burada yaşar.',
    gmSecret:
      'Yüksekçam elf gözcüleri doğu kıyısındaki hareketliliği izlemek için zaman zaman bu sırtlardaki gizli taş siperleri kullanır.',
    hooks: [
      'Kayalıkların tepesinden doğu kıyısındaki kaçakçı gemilerinin yerini tespit etmek',
      'Kaya kartalı yuvalarının altındaki eski dağcı halatlarını kullanmak',
    ],
    npcsOrFoes: ['Dev Kaya Kartalları', 'Elf Sırt Gözcüsü'],
    loot: ['Kartal Tüyü', 'Yüksek İrtifa Dürbün Noktası'],
  },
  {
    id: 'loc-run-harabeleri',
    name: 'Taşburun Eski Hisarı',
    subtitle: 'Terk Edilmiş Krallık Garnizonu',
    category: 'ruin',
    x: 56.8,
    y: 12.5,
    dangerLevel: 4,
    travelTime: 'Elf Köyünden 4 Gün',
    discovered: false,
    playerLore:
      'Kuzeydeki sarp dağ sırtına yüzlerce yıl önce sınır karakolu olarak inşa edilmiş, kışı ağır geçtiği için uzun zaman önce boşaltılmış taş hisar. Yıkık mazgalları ve soğuk taş avluları bugün yalnızca dağ rüzgarlarına ve yaban keçilerine ev sahipliği yapar.',
    gmSecret:
      'Hisarın alt mahzeninde, doğu sınırından kaçan bir haydut grubu kışlık erzak ve çalıntı zırh saklıyor. Mahzenin en dip duvarında ise çağlar öncesinden kalma, ne işe yaradığı unutulmuş nadir bir taş mühür izi bulunur.',
    hooks: [
      'Fırtınadan korunmak için hisara sığınan grupla karşılaşmak',
      'Eski garnizonun zırh deposundan paslanmamış sağlam silahlar çıkarmak',
    ],
    npcsOrFoes: ['Dağ Eşkıyaları (6 Kişi)', 'Kaya Kartalı Yuvası'],
    loot: ['İyi Korunmuş Çelik Uzun Kılıç', 'Eski Sınır Garnizonu Haritası', 'Demir Kalkan'],
  },
  {
    id: 'loc-dogu-falezleri',
    name: 'Doğu Falezleri Burcu',
    subtitle: 'Eski Denizci Gözetleme Kulesi',
    category: 'ruin',
    x: 81.2,
    y: 38.5,
    dangerLevel: 3,
    travelTime: 'Kayalıklardan 1.5 Gün',
    discovered: false,
    imageUrl: cliffImg,
    playerLore:
      'Kıtanın en doğusundaki sarp deniz uçurumlarının tepesine kurulmuş, tuzlu deniz rüzgarlarıyla aşınmış taş gözetleme kulesi. Açık havalarda doğu okyanusundaki uzak balıkçı tekneleri ve sisli adacıklar seçilebilir.',
    gmSecret:
      'Kuledeki eski bakır işaret çanağı hâlâ sağlamdır; açık denizdeki kaçakçı tekneleri karaya yaklaşmadan önce bu kuleden fenerle işaret alır.',
    hooks: [
      'Kuledeki kaçakçı gözcüsünü yakalayıp kıyıdaki gizli iskeleyi öğrenmek',
      'Deniz haritasını çıkarmak için kulenin en üst katından ufku gözlemlemek',
    ],
    npcsOrFoes: ['Kaçakçı Gözcüsü Varek', 'Falez Martıları ve Kaya Yılanları'],
    loot: ['Pirinç Denizci Dürbünü', 'Yağmur Geçirmez Muşamba Pelerin'],
  },
  {
    id: 'loc-hayalet-koy',
    name: 'Gri Kaya Koyu',
    subtitle: 'Sisli Kıyı ve Kaçakçı İskelesi',
    category: 'danger',
    x: 85.2,
    y: 56.2,
    dangerLevel: 4,
    travelTime: 'Falezlerden 2 Gün',
    discovered: false,
    playerLore:
      'Doğu uçurumlarının eteklerindeki sisli kıyı şeridinde yer alan gizli kayalık koy. Çalkantılı sulara rağmen büyük dalgalardan korunan bu koyda küçük yelkenliler ve kaçakçı sandalları demirler.',
    gmSecret:
      'Vergiden kaçan deniz tüccarları, Bozpençe klanının kürklerini ve ormandan çıkarılan nadir keresteleri buradan doğu adalarına taşır.',
    hooks: [
      'Doğu adalarına geçmek için kaçakçı kaptanıyla pazarlık yapmak',
      'Kıyı mağaralarındaki tuz ve barut fıçılarını bulmak',
    ],
    npcsOrFoes: ['Kaçakçı Kaptan Morvain', 'Silahlı Tayfalar (6 Kişi)'],
    loot: ['Denizci Pusulası', '2 Kasa Baharat ve Tuz', 'Kıyı Seyir Defteri'],
  },
  {
    id: 'loc-fok-adalari',
    name: 'Sisli Fok Kayalıkları',
    subtitle: 'Issız Doğu Adacıkları · İnsan Yerleşimi Yok',
    category: 'nature',
    x: 89.2,
    y: 17.5,
    dangerLevel: 3,
    travelTime: 'Koydan Tekneyle 1 Gün',
    discovered: false,
    playerLore:
      'Kuzeydoğu açıklarında dalgaların dövdüğü kayalık adacıklar. Kalıcı hiçbir yapı yoktur; soğuk akıntılar nedeniyle fok kolonileri, deniz kuşları ve fırtınada sığınan açık deniz balıkçıları görülür.',
    gmSecret:
      'Büyük adanın rüzgar almayan koyunda yıllar önce karaya oturmuş bir ticaret gemisinin iskeleti ve hâlâ su almamış birkaç mühürlü kurşun sandığı durmaktadır.',
    hooks: [
      'Karaya oturmuş eski ticaret gemisi enkazını araştırmak',
      'Fırtına dinene kadar kayalık mağarada hayatta kalmak',
    ],
    npcsOrFoes: ['Büyük Deniz Fokları', 'Kayalık Yengeçleri'],
    loot: ['Su Geçirmez Denizci Sandığı', 'Kaliteli Kehribar Parçaları'],
  },
];

export const INITIAL_LOCATIONS: MapLocation[] = BASE_LOCATIONS.map((loc) => ({
  ...loc,
  livingState: createInitialLivingStateForLocation(loc.id),
}));

export const INITIAL_ROUTES: MapRoute[] = [
  {
    id: 'rt-1',
    fromId: 'loc-kuldere',
    toId: 'loc-kulova-koyu',
    name: 'Kuzey Çoban Yolu',
    travelHours: 24,
    hazard: 'Düşük',
  },
  {
    id: 'rt-2',
    fromId: 'loc-kuldere',
    toId: 'loc-derebasi-koyu',
    name: 'Kereste İkmal Yolu',
    travelHours: 12,
    hazard: 'Düşük',
  },
  {
    id: 'rt-3',
    fromId: 'loc-kulova-koyu',
    toId: 'loc-batakhan',
    name: 'Eski Vergi Patikası',
    travelHours: 60,
    hazard: 'Yüksek',
  },
  {
    id: 'rt-4',
    fromId: 'loc-kulova-koyu',
    toId: 'loc-sogutlu-batak',
    name: 'Sazlık Sınır İzi',
    travelHours: 48,
    hazard: 'Orta',
  },
  {
    id: 'rt-5',
    fromId: 'loc-derebasi-koyu',
    toId: 'loc-yasli-meselik',
    name: 'Eski Avcı İzi',
    travelHours: 48,
    hazard: 'Yüksek',
  },
  {
    id: 'rt-6',
    fromId: 'loc-kuldere',
    toId: 'loc-gumus-kopru',
    name: 'Büyük Doğu Yolu',
    travelHours: 48,
    hazard: 'Düşük',
  },
  {
    id: 'rt-7',
    fromId: 'loc-sogutlu-batak',
    toId: 'loc-kuzey-gecit',
    name: 'Kuzey Vadi Geçidi',
    travelHours: 36,
    hazard: 'Orta',
  },
  {
    id: 'rt-8',
    fromId: 'loc-gumus-kopru',
    toId: 'loc-sisli-koyak',
    name: 'Koyak Patikası',
    travelHours: 36,
    hazard: 'Orta',
  },
  {
    id: 'rt-9',
    fromId: 'loc-sisli-koyak',
    toId: 'loc-fisildayan-gol',
    name: 'Göl Kıyısı Kervan İzi',
    travelHours: 36,
    hazard: 'Orta',
  },
  {
    id: 'rt-10',
    fromId: 'loc-gumus-kopru',
    toId: 'loc-goblin-inleri',
    name: 'Güney Taşocağı İzi',
    travelHours: 72,
    hazard: 'Yüksek',
  },
  {
    id: 'rt-11',
    fromId: 'loc-kuzey-gecit',
    toId: 'loc-elf-koyu',
    name: 'Yüksek Çam Avcı İzi',
    travelHours: 48,
    hazard: 'Orta',
  },
  {
    id: 'rt-12',
    fromId: 'loc-elf-koyu',
    toId: 'loc-run-harabeleri',
    name: 'Kuzey Zirve Tırmanışı',
    travelHours: 96,
    hazard: 'Yüksek',
  },
  {
    id: 'rt-13',
    fromId: 'loc-elf-koyu',
    toId: 'loc-goblin-kuzey-ini',
    name: 'Çakmaktaşı Yamaç Patikası',
    travelHours: 48,
    hazard: 'Yüksek',
  },
  {
    id: 'rt-14',
    fromId: 'loc-fisildayan-gol',
    toId: 'loc-beastkin-koyu',
    name: 'Sazlık Kıyı Yolu',
    travelHours: 48,
    hazard: 'Düşük',
  },
  {
    id: 'rt-15',
    fromId: 'loc-beastkin-koyu',
    toId: 'loc-mantar-vadisi',
    name: 'Güney Kütük Yolu',
    travelHours: 48,
    hazard: 'Orta',
  },
  {
    id: 'rt-16',
    fromId: 'loc-fisildayan-gol',
    toId: 'loc-kartal-kayaligi',
    name: 'Kireçtaşı Yokuşu',
    travelHours: 48,
    hazard: 'Orta',
  },
  {
    id: 'rt-17',
    fromId: 'loc-kartal-kayaligi',
    toId: 'loc-dogu-falezleri',
    name: 'Doğu Rüzgar Boğazı',
    travelHours: 36,
    hazard: 'Orta',
  },
  {
    id: 'rt-18',
    fromId: 'loc-dogu-falezleri',
    toId: 'loc-hayalet-koy',
    name: 'Uçurum Kıyı İnişi',
    travelHours: 48,
    hazard: 'Yüksek',
  },
  {
    id: 'rt-19',
    fromId: 'loc-hayalet-koy',
    toId: 'loc-fok-adalari',
    name: 'Açık Deniz Tekne Rotası',
    travelHours: 24,
    hazard: 'Orta',
  },
];

export const FOREST_ENCOUNTERS: ForestEncounter[] = [
  {
    id: 'enc-1',
    rollRange: '1 - 2',
    title: 'Goblin ve Kobold Yağma Devriyesi',
    type: 'Savaş',
    threat: 'Seviye 2 · 4 Goblin, 2 Kobold',
    hp: 42,
    defense: 13,
    weakness: 'Disiplin Eksikliği ve Gürültü',
    description:
      'Çalıların arasından paslı mızraklar ve sapanlar taşıyan küçük bir yağmacı grubu çıkar. Başlarındaki iki goblin erzak çuvalını hedeflerken, koboldlar geriden taş atar.',
    tactic: 'Liderleri veya ikisi devrildiğinde kalanlar hızla çalılıklara kaçmaya çalışır.',
    reward: 'Kaba Harita Parçası · 18 Bakır Sikke · 100 XP',
  },
  {
    id: 'enc-2',
    rollRange: '3 - 4',
    title: 'Bozpençe Klanı Avcı Kolu',
    type: 'Karşılaşma',
    threat: 'Tarafsız / Diplomasi',
    hp: 36,
    defense: 14,
    weakness: 'Saygılı Yaklaşım veya Tuz Takası',
    description:
      'Sırtlarında yeni avlanmış geyik ve kürk demetleri taşıyan iki vaşak kulaklı ve bir kurt kulaklı avcı patikada grubun önünü keser. Silahlarını çekmezler ama tetiktedirler.',
    tactic: 'Düşmanca davranılmazsa grubu en yakın güvenli kamp yerine veya köylerine yönlendirirler.',
    reward: 'Kurutulmuş Et · Güncel Patika Bilgisi',
  },
  {
    id: 'enc-3',
    rollRange: '5 - 6',
    title: 'Dev Orman Yaban Domuzu',
    type: 'Savaş',
    threat: 'Seviye 3 · Tek Vahşi Yaratık',
    hp: 68,
    defense: 14,
    weakness: 'Mızraklı Savunma ve Yan Manavra',
    description:
      'Yosunlu köklerin arasından iri dişli, kalın derili dev bir yaban domuzu homurdanarak fırlar. Bölgesini savunmak için doğrudan ilk sıradaki yolcuya hücum eder.',
    tactic: 'Düz hatta hücum ettiğinde ekstra hasar verir; ağaçların veya kayaların arkasına çekilmek hızını keser.',
    reward: '4 Günlük Taze Et · Kalın Domuz Postu',
  },
  {
    id: 'enc-4',
    rollRange: '7 - 8',
    title: 'Siste Yönünü Kaybetmiş Tuz Kervanı',
    type: 'Karşılaşma',
    threat: 'Dost NPC · Yardım Çağrısı',
    hp: 25,
    defense: 11,
    weakness: 'Yok',
    description:
      'Tekerleği çamura saplanmış iki katırlı bir tüccar arabası ve başındaki iki yorgun arabacı yoğun siste yolu seçemedikleri için kamp ateşi yakmaya çalışmaktadır.',
    tactic: 'Arabanın çıkarılmasına yardım edilirse veya Gümüş Köprü\'ye kadar eşlik edilirse ödeme yaparlar.',
    reward: '25 Gümüş Sikke · 1 Çuval Tuz ve İp',
  },
  {
    id: 'enc-5',
    rollRange: '9 - 10',
    title: 'Yüksekçam Elf Gözcü Uyarısı',
    type: 'Karşılaşma',
    threat: 'Gerilimli Diplomasi',
    hp: 40,
    defense: 15,
    weakness: 'Silah İndirmek ve Niyet Bildirmek',
    description:
      'Yüksek çam dallarından iki elf okçusu görünür olmadan seslenir. Grup, elf köyünün koruma sınırına fazla yaklaşmıştır; okları çekili olmasa da yayları hazırdır.',
    tactic: 'Goblin inleri hakkında bilgi paylaşan gruplara karşı yumuşarlar; ateş yakmaya çalışanlara sert tepki verirler.',
    reward: 'Elf Köyü Güvenli Geçiş İşareti',
  },
  {
    id: 'enc-6',
    rollRange: '11 - 12',
    title: 'Nadir Doğa Olayı: Eski Taş Anıtın Soğuk Yankısı',
    type: 'Gizem',
    threat: 'Çok Nadir Olay',
    hp: 0,
    defense: 12,
    weakness: 'Soğukkanlılık',
    description:
      'Patikanın çok dışında, yarı toprağa gömülü eski bir taş işaretin çevresinde rüzgar kesilir ve havadaki sis birkaç dakika boyunca ince buz kristallerine dönüşüp yere çöker.',
    tactic: 'Dünyada çok nadir rastlanan bu açıklanamaz doğa olayı zarar vermez; kısa süreliğine görüşü tamamen açar.',
    reward: 'Çevredeki Gizli Bir Konumu Haritada Keşfetme',
  },
];

export const MIST_WEATHERS: MistWeather[] = [
  {
    id: 'w-1',
    name: 'Yoğun Sabah Sisi',
    visibility: '20 Metre',
    effect: 'Uzak mesafe ok atışları zorlaşır; pusu ve gizlenme testlerine +2 avantaj.',
  },
  {
    id: 'w-2',
    name: 'Açık Ayaz Gecesi',
    visibility: '60 Metre',
    effect: 'Sis tabakası nehir çukurlarına çöker; ateş yakmak ve yön bulmak kolaylaşır.',
  },
  {
    id: 'w-3',
    name: 'Tuzlu Doğu Rüzgarı',
    visibility: '35 Metre',
    effect: 'Okyanustan esen sert rüzgar sis dalgalarını sürükler; kamp ateşlerini korumak gerekir.',
  },
  {
    id: 'w-4',
    name: 'Soğuk Çiy Yağmuru',
    visibility: '30 Metre',
    effect: 'Çamurlu zemin kayganlaşır; iz sürmek kolaylaşır ancak ıslak odun yakmak zorlaşır.',
  },
];
