import type { MapLocation, MazgalCell, MazgalTerrain, SettlementArchetype } from '../types/map';
import { rollDie } from './diceEngine';
import { getDayPhaseLabel } from './gameTime';

export type SceneCategoryFilter = 'auto' | 'daily' | 'danger' | 'discovery';

export interface ProceduralSceneCard {
  id: string;
  roll1d100: number;
  locationId: string;
  locationName: string;
  archetype: SettlementArchetype;
  category: 'Günlük Yaşam' | 'Tehlike ve Çatışma' | 'Keşif ve İz';
  timePhase: string;
  title: string;
  threatLabel: string;
  checkLabel: string;
  description: string;
  complication: string;
  tactic: string;
  reward: string;
  moodImpact: number;
  comboSpaceSize: number;
}

export interface ProceduralNpcCard {
  id: string;
  name: string;
  cultureLabel: string;
  role: string;
  trait: string;
  motive: string;
  carriedItem: string;
}

export interface MazgalProceduralEvent {
  roll1d20: number;
  cellId: string;
  terrainLabel: string;
  kind: 'Tehlike' | 'İz ve Keşif' | 'Hava ve Arazi' | 'Karşılaşma';
  title: string;
  detail: string;
  checkHint: string;
  outcomeNote: string;
}

interface CombinatorialDeck {
  dailySubjects: string[];
  dangerSubjects: string[];
  discoverySubjects: string[];
  dailySituations: string[];
  dangerSituations: string[];
  discoverySituations: string[];
  twists: string[];
  tactics: { label: string; check: string }[];
  rewards: string[];
  rumorOpeners: string[];
  rumorBodies: string[];
}

const ARCHETYPE_DECKS: Record<SettlementArchetype, CombinatorialDeck> = {
  border_fortress: {
    dailySubjects: [
      'Külköy tuz kervanından iki yorgun arabacı',
      'Sur kapısında nöbet tutan genç sınır muhafızı',
      'Demirci Mira’nın ocağına kömür getiren Derebaşı arabası',
      'Kulova’dan yün balyası indiren yaşlı dokumacı',
      'Garnizon yazıcısı ile tartışan gezgin haritacı',
      'Hancı Torin’in avlusunda atını nallayan ulak',
    ],
    dangerSubjects: [
      'Palizad dışı çalılıklara yaklaşan iki goblin gözcüsü',
      'Sahte sınır mührüyle içeri sızmaya çalışan haydut kuryesi',
      'Kervan yolunda tekeri kırılmış arabayı yağmalayan başıboş eşkıyalar',
      'Kuzey ormanından aç inen üç iri gri kurt',
      'Depo kapısının kilidini zorlayan gizli kaçakçı ortağı',
    ],
    discoverySubjects: [
      'Eski garnizon defterinin sayfaları arasına sıkışmış mühürlü emir',
      'Doğu yolundan dönen izcinin getirdiği çamurlu ok ucu',
      'Palizad dibindeki yağmur oluğunda bulunan yanık uyarı tahtası',
      'Tüccar arabası kasasının altında gizlenmiş isimsiz harita rulosu',
      'Ahır duvarının arkasında unutulmuş paslı krallık nişanı',
    ],
    dailySituations: [
      'erzak tartımı sırasında eksik çuval fark edildiği için avluda hararetli bir tartışma başlatıyor',
      'yarın şafakta Gümüş Köprü’ye çıkacak konvoy için silahlı refakatçi aradığını duyuruyor',
      'batıdan gelen yeni yolcuların geçiş belgelerini tek tek kontrol etmeye çalışıyor',
      'kışlık tuz ve kurutulmuş et stokunu mahzene indirirken yardım istiyor',
      'kuzey yolundan günlerdir haber gelmemesi üzerine komutanlığa rapor sunuyor',
    ],
    dangerSituations: [
      'akşamüstü değişim saatini kollayarak kapı dışındaki ahırlara yaklaşmaya çalışıyor',
      'sis bastırdığı anda yük arabalarının arasından sıyrılıp erzak sandıklarına yöneliyor',
      'dış devriye kolunu yanıltmak için yol kenarına sahte kamp ateşi kurmuş',
      'nöbetçi kulesinin kör noktasından sur hendeğine halat sarkıtmaya hazırlanıyor',
      'tüccarlar arasındaki kargaşadan yararlanıp gümüş kesesini alıp kaçmaya çalışıyor',
    ],
    discoverySituations: [
      'son yağmurlarla birlikte toprağın altından veya eski sandığın içinden gün yüzüne çıkıyor',
      'bir izci tarafından kapıdaki nöbet kulübesine teslim edilip incelenmeyi bekliyor',
      'üzerindeki yarı silinmiş işaretler yüzünden kale sakinleri arasında merak uyandırıyor',
      'yakınlardaki bir yol veya geçit hakkında eski ama hâlâ geçerli bir ipucu barındırıyor',
      'Balthor’un yıllardır aradığı kayıp vergi kervanının iziyle örtüşüyor',
    ],
    twists: [
      'Ancak yoğun sabah sisi yüzünden kapı dışındaki elli metre ötesi seçilemiyor.',
      'Üstelik taraflardan biri kimliğini gizlemek için Derebaşı oduncularının adını kullanıyor.',
      'Olay tam vardiya değişimine denk geldiği için muhafızların yarısı başka kanatta bekliyor.',
      'Kayıp eşyanın aslında tüccar loncasının gizli anlaşmasıyla bağlantılı olduğu anlaşılıyor.',
      'Yağmur nedeniyle avlu çamura döndüğünden izler hızla siliniyor.',
    ],
    tactics: [
      { label: 'Tanıkları dinleyip belgeleri karşılaştırarak gerçeği ortaya çıkarmak', check: 'İnceleme / Algı DC 13' },
      { label: 'Komutanlık adına araya girip tarafları uzlaştırmak', check: 'İkna / Otorite DC 12' },
      { label: 'Kapı dışındaki ayak izlerini orman sınırına kadar sürmek', check: 'İz Sürme DC 14' },
      { label: 'Şüpheliyi sessizce köşeye sıkıştırıp sorgulamak', check: 'Gözdağı / Sezgi DC 13' },
      { label: 'Nöbet düzenini sıkılaştırıp tuzak veya pusu kurmak', check: 'Taktik / Gizlilik DC 12' },
    ],
    rewards: [
      'Kale komutanlığından güven nişanı ve 15 Gümüş Sikke ödeme',
      'Demirci Mira’dan ücretsiz silah bileme ve 2 adet yağlı fırtına feneri',
      'Gümüş Köprü yönündeki güncel tehlike haritası ve 5 günlük kuru erzak',
      'Tüccar loncasının doğu yolu gizli geçit notu',
    ],
    rumorOpeners: [
      'Sur dışındaki nöbetçiler',
      'Demirci ocağındaki çıraklar',
      'Kervan arabacıları',
      'Handa sabah çorbası içen muhafızlar',
    ],
    rumorBodies: [
      'kuzey yolunda eski bir vergi arabasının boş tekerlek izine rastlandığını konuşuyor.',
      'Bozpençe kürk fiyatlarının bu hafta gizlice düşürülmeye çalışıldığını fısıldıyor.',
      'Gümüş Köprü tarafından gelen iki yolcunun ormanda davul değil ama demir tıngırtısı duyduğunu anlatıyor.',
      'Kulova çobanlarının gece ağıl başında nöbet tutmaya başladığını söylüyor.',
    ],
  },

  shepherd_village: {
    dailySubjects: [
      'Çoban İlyas ve koyun sürüsünü güden iki çoban köpeği',
      'Yün Dokumacısı Helga ile tezgah başında çalışan genç kızı',
      'Muhtar Doren ve taş ağılın duvarını onaran üç köylü',
      'Peynir mahzeninden taze teker çıkaran yaşlı mandıracı',
      'Külköy’e yün götürmek için kağnıyı yağlayan genç köy sakini',
      'Köyün tek ahşap gözetleme kulesinde çay demleyen nöbetçi',
    ],
    dangerSubjects: [
      'Kuzey yamacından ağıla doğru süzülen üç aç kurt',
      'Gece karanlığında sürüden kuzu çalmaya çalışan Batakhan hırsızları',
      'Yolunu kaybetmiş yaralı ama saldırgan bir yaban domuzu',
      'Köy merasının sınırındaki dereye inen iki serseri yağmacı',
      'Siste sürüyü dağıtan kurnaz tilki ve ardındaki kurt sürüsü başı',
    ],
    discoverySubjects: [
      'Taş ağılın arka duvarında çamura batmış yabancı çizme izleri',
      'Çoban sopasının ucuna takılmış yırtık siyah haydut kumaşı',
      'Kuru dere yatağında yarı gömülü paslı bir kervan çanı',
      'Eski meradaki dev taşın altında unutulmuş su geçirmez deri kese',
      'Köy kulesinin tavan arasında sararmış eski sınır haritası',
    ],
    dailySituations: [
      'kışlık keçe ve yün dokuma işlerini hızlandırmak için dışarıdan sağlam halat ve çıkrık parçası arıyor',
      'sabah sayımında iki koyunun eksik çıktığını fark edip merayı taramaya hazırlanıyor',
      'tuzlanmış peynir fıçılarını Külköy pazarına indirmek için yola çıkacak eşlikçi bekliyor',
      'yağmurda gevşeyen taş ağıl duvarını akşam olmadan örmek için yardım topluyor',
      'köy gençlerinin düğün veya hasat şenliği için ateş başında toplanmasını organize ediyor',
    ],
    dangerSituations: [
      'köpeklerin dikkatini başka yöne çekip meradaki en semiz hayvanları ayırmaya çalışıyor',
      'dere boyundaki çalılıklara sinip yalnız çobanın uzaklaşmasını bekliyor',
      'sürü korkutup dağılsın diye rüzgar yönünden çalıları tutuşturmaya yelteniyor',
      'köy kulesindeki nöbetçiyi yanıltmak için uzak tepeden ıslık sesi çıkarıyor',
      'karanlık çöktüğünde peynir mahzeninin tahta sürgüsünü zorluyor',
    ],
    discoverySituations: [
      'çobanların sabah otlatması sırasında meranın kuzey ucunda dikkat çekiyor',
      'yağmur sularının toprağı aşındırmasıyla birlikte dere kenarında ortaya çıkıyor',
      'köy yaşlılarının anlattığı eski bir sınır baskınıyla doğrudan örtüşüyor',
      'yakındaki Batakhan veya Söğütlü Bataklık yönüne giden gizli bir izi işaret ediyor',
      'kaybolan hayvanların ya da gezginlerin hangi yöne götürüldüğünü ele veriyor',
    ],
    twists: [
      'Ancak sürü paniklediği için koyunlar sisin içinde orman sınırına doğru dağılmaya başlıyor.',
      'Köylüler bunun sıradan bir kurt işi olduğunu düşünse de izler iki ayaklı hırsızları gösteriyor.',
      'Köyün gençlerinden biri tek başına peşlerine düşmüş ve henüz geri dönmemiş.',
      'Soğuk rüzgar ve sis nedeniyle meşale ışığı on adımdan öteyi aydınlatamıyor.',
      'Muhtar Doren, köyün adının çıkmasından çekindiği için olayı gizli çözmek istiyor.',
    ],
    tactics: [
      { label: 'Dere boyunca ayak izlerini ve yün kalıntılarını sürmek', check: 'İz Sürme / Hayatta Kalma DC 12' },
      { label: 'Çoban köpeklerini yönlendirip sürüyü güvenli taş ağıla toplamak', check: 'Hayvan İdaresi DC 11' },
      { label: 'Ağıl çevresinde sessizce gece nöbeti ve pusu kurmak', check: 'Gizlilik / Algı DC 13' },
      { label: 'Köylüleri örgütleyip meşaleli arama kolu oluşturmak', check: 'İkna / Liderlik DC 12' },
      { label: 'Yabancı izcileri veya hırsızları yol ayrımında durdurmak', check: 'Çeviklik / Savaş DC 13' },
    ],
    rewards: [
      'Köy dokuma tezgahından kalın yün pelerin ve 2 kalıp tuzlanmış koyun peyniri',
      'Kulova köyünde ücretsiz sıcak ahır konaklaması ve +10 köy morali',
      'Kuzey patikasının güvenli geçiş noktalarını bilen çoban rehberliği',
      'Ağıl duvarını onaran ustadan 12 Gümüş Sikke teşekkür payı',
    ],
    rumorOpeners: [
      'Ağıl başında süt sağan kadınlar',
      'Kule nöbetçisi genç',
      'Dokuma tezgahındaki Helga',
      'Akşam ateşinde oturan çobanlar',
    ],
    rumorBodies: [
      'kuzeydeki Batakhan köyünden haftalardır ne bir araba ne de dürüst bir haber geldiğini söylüyor.',
      'Söğütlü Bataklık kıyısında gece fener gezdiren bir yabancı görüldüğünü konuşuyor.',
      'dere yatağında iki farklı çizme izine rastlandığını, birinin demir ökçeli olduğunu anlatıyor.',
      'bu yaz yün satışları iyi giderse köye küçük bir taş fırın yapılacağını müjdeliyor.',
    ],
  },

  lumber_village: {
    dailySubjects: [
      'Oduncu Ustabaşı Mara ve balta bileyen üç çırağı',
      'Kömürcü Orak ile tüten odun kömürü ocağının işçileri',
      'Salcı Genç Tobi ve Sirkad Nehri kıyısındaki tomruk salı',
      'Su değirmeninin dişlilerini yağlayan yaşlı marangoz',
      'Külköy kalesine kereste taşıyacak katır arabası sürücüsü',
    ],
    dangerSubjects: [
      'Dev Çamlar sınırından kereste kampına yaklaşan aç bozayı',
      'Tomruk kızaklarının halatlarını kesmeye çalışan güney goblin izcileri',
      'Nehir taşkınında zinciri kopup sürüklenen ağır tomruk kütlesi',
      'Kömür ocağına dadanmış iri gri kurt sürüsü',
      'Sal geçişinden zorla haraç kesmeye kalkışan serseri nehir eşkıyası',
    ],
    discoverySubjects: [
      'Kesilen dev çamın kovuğunda sıkışmış eski demir balta başı',
      'Nehir kıyısına vurmuş kırık bir tüccar sandığı parçası',
      'Orman sınırında kaybolan çırağın ağaca kazıdığı yön işareti',
      'Değirmen çarkının altında suyun getirdiği mühürlü bakır tüp',
      'Tomruk patikasında Bozpençe avcılarının bıraktığı uyarı oku',
    ],
    dailySituations: [
      'Gümüş Köprü yönüne tomruk salı indirmek için akıntının durulmasını bekliyor',
      'kömür ocaklarının hava deliklerini açıp yeni meşe odunu yığıyor',
      'su değirmeninin kırılan bir kanadını akşama kadar değiştirmeye çalışıyor',
      'güney orman sınırında devrilmiş kuru ağaçları kesip Külköy’e hazırlıyor',
      'ıslak zeminde kayan bir yük arabasını halatlarla yola çekmeye uğraşıyor',
    ],
    dangerSituations: [
      'nehir uğultusunun bastırdığı gürültüden yararlanıp kampa sokuluyor',
      'odun kesim alanında tek başına kalan çırağın yolunu kesiyor',
      'tomruk bağlarını çözerek kerestelerin nehre savrulmasına yol açmak üzere',
      'kömür dumanından ürken katırları kaçırıp arabayı yağmalamaya hazırlanıyor',
      'çamlık sınırında gizlenerek oduncuların akşam dönüşünü bekliyor',
    ],
    discoverySituations: [
      'sabah nehir suları biraz çekilince kıyıda veya çarkın dibinde göze çarpıyor',
      'oduncuların devirdiği yaşlı ağacın hemen arkasındaki patikada beliriyor',
      'Derebaşı sakinlerinin haftalardır kayıp saydığı iki çırağın izini işaret ediyor',
      'güneydeki Paslıçukur veya Dev Çamlar yönünden gelen yeni bir hareketliliği gösteriyor',
    ],
    twists: [
      'Sirkad Nehri’nin hızlı akıntısı yüzünden suya düşen her şey birkaç dakikada gözden kayboluyor.',
      'Elf devriyelerinin ağaç kesim sınırına dair sert uyarısı işçileri tedirgin etmiş durumda.',
      'Kömür ocaklarının kesif dumanı çevredeki sisi daha da yoğunlaştırıyor.',
      'Ustabaşı Mara, kaleden azar işitmemek için kayıp çırağı herkese duyurmak istemiyor.',
    ],
    tactics: [
      { label: 'Sağlam urgan ve kanca ile tomrukları veya salı sabitlemek', check: 'Atletizm / Güç DC 12' },
      { label: 'Nehir kıyısı ve orman sınırındaki taze balta/ayak izini okumak', check: 'İz Sürme DC 13' },
      { label: 'Meşale ve gürültüyle vahşi hayvanı kamp dışına sürmek', check: 'Hayatta Kalma / Gözdağı DC 12' },
      { label: 'Nehir salıyla Gümüş Köprü yönüne hızlı takip başlatmak', check: 'Denge / Çeviklik DC 13' },
    ],
    rewards: [
      'Gümüş Köprü yönüne ücretsiz tomruk salı geçişi (yarı sürede ulaşım)',
      'Çift ağızlı sağlam oduncu baltası ve 4 adet ziftli meşale',
      'Ustabaşı Mara’dan 14 Gümüş Sikke ve kuru odun kömürü ikmali',
      'Güney ormanındaki gizli avcı patikalarının tarifi',
    ],
    rumorOpeners: [
      'Değirmen başındaki işçiler',
      'Salcı Tobi',
      'Kömür ocağı nöbetçileri',
      'Kereste taşıyan arabacılar',
    ],
    rumorBodies: [
      'Dev Çamlar sınırında akşamları çok iri bir ayı kükremesi duyulduğunu anlatıyor.',
      'nehirden aşağı kırık ahşap sandık tahtaları aktığını söylüyor.',
      'Yüksekçam elflerinin sınırı aşan odunculara uyarı oku attığını konuşuyor.',
      'Paslıçukur goblinlerinin gece köprü başını gözetlediğini fısıldıyor.',
    ],
  },

  bandit_hamlet: {
    dailySubjects: [
      'Sahte Hancı Vorn ve ocak başında kılıç bileyen iki adamı',
      'Kapı aralığından sokağı gizlice gözetleyen korkmuş köy yaşlısı',
      'Ahırda yabancı atların eyerlerini karıştıran genç haydut çırağı',
      'Paslı köy çanının altında nöbet tutan kapüşonlu gözcü',
      'Yıkık fırının önünde kuru ekmek bölüşen çaresiz iki köylü',
    ],
    dangerSubjects: [
      'Gece ahırlarda uyuyan yolcuları soymaya hazırlanan dört eşkıya',
      'Kiler kapısında Külköy vergi memurunu esir tutan silahlı muhafız',
      'Köy çıkışındaki köprüde pusu kurmuş arbaletli iki gözcü',
      'Bataklıktan dönen öfkeli çete lideri ve kürk çalmış adamları',
      'Misafir çorbasına uyku otu karıştırmaya çalışan mutfak yardımcısı',
    ],
    discoverySubjects: [
      'Ahır samanlığının altında saklı mühürlü Külköy vergi kesesi',
      'Han kilerindeki gevşek taşların ardına gizlenmiş kaçış tüneli',
      'Kuzey bataklığından geçen gizli geçitlerin çizildiği deri parşömen',
      'Çetenin soyduğu tüccarlardan kalan damgalı gümüş yüzükler',
      'Yaşlı köylünün duvar oyuğuna sakladığı gerçek köy muhtarı mührü',
    ],
    dailySituations: [
      'gelen yabancıların silahlarını ve altın keselerini uzaktan tartmaya çalışıyor',
      'gerçek köylülerin dışarıya tek kelime etmemesi için meydanda gözdağı veriyor',
      'Kulova merasından çalınan koyunların etini han mutfağında tuzluyor',
      'kuzey geçidinden gelecek yeni bir kervan haberi için atları eyerli tutuyor',
      'kendi aralarında son ganimetin paylaşımı yüzünden seslerini yükseltiyor',
    ],
    dangerSituations: [
      'misafirpervermiş gibi davranıp grubu gece ahır veya üst kat odalarına çekmeye çalışıyor',
      'arka kapıdan çıkıp köy girişindeki tek kaçış yolunu kesmeye hazırlanıyor',
      'esir tutulan köylüleri kalkan yaparak grubun geri çekilmesini sağlamaya çalışıyor',
      'sis çöktüğünde meşaleleri söndürüp yıkık evlerin arasından pusu atıyor',
    ],
    discoverySituations: [
      'handa kısa bir dikkatsizlik anında döşeme tahtasının veya samanlığın altından fark ediliyor',
      'korkmuş bir köylü tarafından gizli el işaretiyle gruba gösteriliyor',
      'çetenin bir sonraki hedefinin Kulova mı yoksa Külköy mü olduğunu açığa çıkarıyor',
    ],
    twists: [
      'Gerçek köylüler haydutların misillemesinden korktuğu için ilk anda gruba karşı soğuk davranır.',
      'Meydandaki paslı çan çalınırsa dağılmış olan eşkıyalar iki dakika içinde toplanır.',
      'Sahte hancı Vorn pazarlık yapmayı sever; gücü yetmeyeceğini anlarsa suçu adamlarına atar.',
      'Kilerdeki esir yaralıdır ve sessizce taşınması gerekir.',
    ],
    tactics: [
      { label: 'Sahte hancının bakışlarını ve çorbadaki kokuyu sezmek', check: 'Sezgi / Algı DC 13' },
      { label: 'Çete içindeki paylaşım kavgasını körükleyip onları bölmek', check: 'İkna / Aldatma DC 14' },
      { label: 'Gece karanlığında ahır ve kiler kilidini sessizce açmak', check: 'Gizlilik / Hırsızlık DC 13' },
      { label: 'Paslı çanı susturup çete gözcülerini tek tek etkisiz bırakmak', check: 'Taktik / Çeviklik DC 14' },
    ],
    rewards: [
      '60 Gümüş Sikkeli çalıntı vergi kesesi ve kuzey yol haritası',
      'Külköy’de esir vergi memurunu kurtarma ödülü (30 Gümüş + Kale Onuru)',
      'Gerçek köylülerin minnettarlığı ve güvenli kuzey sığınağı',
      'Siyah deri haydut pelerinleri ve 2 adet kurulu arbalet',
    ],
    rumorOpeners: [
      'Han köşesinde fısıldaşan iki haydut',
      'Kuyu başında su çeken yaşlı kadın',
      'Kapı nöbetçisi',
    ],
    rumorBodies: [
      'Kulova ağıllarına yapılan son baskının neredeyse yakalanmak üzere olduğunu konuşuyor.',
      'Kuzey Dağ Geçidi’nde donmuş bir vergi arabası enkazı kaldığını fısıldıyor.',
      'Vorn’un ganimetten en büyük payı sakladığını ve adamların homurdandığını anlatıyor.',
    ],
  },

  elf_canopy: {
    dailySubjects: [
      'Köy Sözcüsü Aelindor ve yüksek sedir platformunda toplanan iki yaşlı',
      'Baş Avcı Seraphina ile yay kirişlerini mumlayan üç elf okçusu',
      'Marangoz Thalen ve dev çam gövdeleri arasındaki asma köprü onarımcıları',
      'Şifalı reçine kaynatan sessiz elf bitki bilimcisi',
      'Kuzey yamacından dönen iki ses çıkarmayan keçe çizmeli izci',
    ],
    dangerSubjects: [
      'Çakmaktaşı Oyukları’ndan gece sızan üç kobold tuzakçısı',
      'Ağaç kesim sınırını ihlal eden silahlı insan oduncu birliği',
      'Yüksek dalların altında avlanan büyük bir orman vaşağı',
      'Köyün güney asma köprüsünün halatlarını aşındıran fırtına hasarı',
      'Eski arşiv kulübesine gizlice yaklaşan yabancı bir harita hırsızı',
    ],
    discoverySubjects: [
      'Eski ağaç kabuğuna oyulmuş kadim kuzey geçidi işaretleri',
      'Arşiv platformunda saklı Taşburun Hisarı döneminden kalma harita parçası',
      'Orman dibinde bulunan koboldların bronz maden baltası',
      'Sedir reçinesiyle korunmuş yüz yıllık bir sınır antlaşması rulosu',
    ],
    dailySituations: [
      'asma halat köprülerin kış öncesi gerilimini kontrol ediyor',
      'insanlarla ticaret yapmadan kuzeydoğudaki kobold sürüsünü nasıl uzaklaştıracağını tartışıyor',
      'orman dibinden toplanan beyaz kabuk ve reçineleri şifa merhemine dönüştürüyor',
      'yabancı yolcuların köy koruma sınırına fazla yaklaşıp yaklaşmadığını gözetliyor',
      'genç izcilere sis içinde iz bırakmadan yürüme talimi yaptırıyor',
    ],
    dangerSituations: [
      'yüksek platformların altındaki sis perdesini kullanarak nöbetçilerden saklanıyor',
      'yanlış anlama yüzünden insan devriyesi ile elf okçuları arasında silah çekilmesine yol açıyor',
      'köyün su ve reçine topladığı kaynak vadisini kirletmek veya tuzaklamak üzere',
      'ağaç gövdeleri arasındaki ana halat bağlantısını kesme tehlikesi yaratıyor',
    ],
    discoverySituations: [
      'yüksek dallardan inen devriyenin getirdiği raporla birlikte arşive taşınıyor',
      'orman tabanındaki yosun tabakası kaldırıldığında ortaya çıkıyor',
      'kuzeydeki Taşburun Hisarı ve maden oyuklarıyla doğrudan bağlantı kuruyor',
    ],
    twists: [
      'Elfler insanlara kolay güvenmez; silahlar kınında ve ateş yakılmamış olmalıdır.',
      'Köydeki genç okçular doğrudan çatışma isterken Sözcü Aelindor sessiz diplomasiyi savunur.',
      'Yoğun vadi sisi içinde yüksek platformların merdivenleri dışarıdan görünmez.',
      'Ziyaretçilerden biri daha önce Derebaşı’ndan gelmişse elfler önce niyetini sınar.',
    ],
    tactics: [
      { label: 'Silahları indirip elf geleneklerine uygun saygıyla niyet bildirmek', check: 'Diplomasi / İkna DC 13' },
      { label: 'Çakmaktaşı koboldlarının izini dağ eteğine kadar sessizce sürmek', check: 'Gizlilik / İz Sürme DC 14' },
      { label: 'Asma köprü halatlarını fırtına altında yeniden bağlamak', check: 'Akrobasi / El Becerisi DC 13' },
      { label: 'İnsan oduncular ile elf gözcüler arasında sınır çizgisi üzerinde uzlaşmak', check: 'Arabuluculuk DC 14' },
    ],
    rewards: [
      'Yüksekçam Köyü güvenli geçiş nişanı ve kuzey dağ patikası izni',
      'Şifalı reçine merhemi (2 doz) ve uzun porsuk yayı oku demeti',
      'Ses çıkarmayan keçe çizme yapımı veya tamiri',
      'Taşburun Hisarı hakkında kadim arşiv notu',
    ],
    rumorOpeners: [
      'Asma köprü gözcüleri',
      'Reçine toplayıcıları',
      'Marangoz Thalen’in çırakları',
    ],
    rumorBodies: [
      'Çakmaktaşı Oyukları’ndaki koboldların eski bir maden galerisine denk gelip bronz baltalar çıkardığını konuşuyor.',
      'Kızılşahin Kayalıkları’ndan doğu kıyısındaki kaçakçı fenerlerinin görüldüğünü bildiriyor.',
      'İnsan sınır kalesinin yakında doğuya büyük bir odun konvoyu çıkaracağı duyumunu değerlendiriyor.',
    ],
  },

  beastkin_clan: {
    dailySubjects: [
      'Klan Şefi Kurt-Kulak Karok ve kütük meydanda toplanan yaşlı avcılar',
      'Tabakçı ve İzci Tilki-Kulak Lyra ile kürk askılarını düzenleyen çıraklar',
      'Balıkçı Vorn ve Ayna Gölü iskelesinde isli balık dumanlayan ocakçılar',
      'Şifacı yaşlının yanında ot kurutan vaşak kulaklı iki genç',
      'Göl kıyısından sazlık geçidini kontrol edip dönen klan gözcüsü',
    ],
    dangerSubjects: [
      'Klanın tuz ve demir tuzaklarını çalan Paslıçukur goblin baskıncıları',
      'Güneydeki Dev Eğrelti Vadisi’nden kürk kokusuna gelen yaşlı dev bozayı',
      'Kürk fiyatlarını kırmaya çalışan silahlı kaçakçı simsarlar',
      'Sazlık geçidinde balıkçı teknelerine saldıran iri yaban domuzu sürüsü',
    ],
    discoverySubjects: [
      'Kurt kürkü denklerinin arasında bulunan Külköy lonca mühürlü borç senedi',
      'Ayna Gölü doğu kıyısında gizli sazlık geçidinin yeni işaret taşları',
      'Şifacı kulübesinde saklanan çok nadir gümüş tılsımın üzerindeki eski çizim',
      'Mantar vadisinden getirilen panzehir etkili nadir kök demetleri',
    ],
    dailySituations: [
      'kışlık isli balık ve kurt kürkü stoklarını kurutma askılarında sayıyor',
      'batıdaki goblin inlerinden çalınan demir tuzakları geri almak için av kolu topluyor',
      'Ayna Gölü üzerinden gelecek gezginlerle tuz ve bakır takası hazırlıyor',
      'genç klan üyelerinin güney ormanındaki rüşt avı için izin töreni düzenliyor',
    ],
    dangerSituations: [
      'tütsü ocaklarının dumanı arasında göl kıyısındaki tuz sandıklarına sokuluyor',
      'avdan dönen tek bir izcinin etrafını Dev Eğrelti Vadisi sınırında sarıyor',
      'klanla insan tüccarları birbirine düşürecek sahte bir hırsızlık izi bırakıyor',
    ],
    discoverySituations: [
      'göl suyu alçaldığında sazlık iskelesinin hemen yanında ortaya çıkıyor',
      'Lyra’nın güney izciliği sırasında çalılıkların arasında bulunuyor',
      'klanın kış ticaretini doğrudan etkileyecek bir sırrı açığa çıkarıyor',
    ],
    twists: [
      'Klan dışarıya karşı temkinlidir ancak sözünün eri olan yabancılara derin saygı duyar.',
      'Klan içinde tuz ticareti için Külköy ile mi yoksa Gri Kaya Koyu kaçakçılarıyla mı anlaşılacağı tartışmalıdır.',
      'Keskin kulakları sayesinde klan gözcüleri yaklaşan ayak seslerini yüz metreden duyar.',
    ],
    tactics: [
      { label: 'Dürüst tuz ve demir takası teklifiyle Şef Karok’un güvenini kazanmak', check: 'İkna / Ticaret DC 12' },
      { label: 'Sazlık geçidinde iz sürerek goblin hırsızların yolunu kesmek', check: 'İz Sürme / Algı DC 13' },
      { label: 'Klan avcılarıyla omuz omuza durup yaşlı bozayıyı uzaklaştırmak', check: 'Savaş / Cesaret DC 14' },
    ],
    rewards: [
      'Soğuğa direnç sağlayan kalın kurt kürkü pelerin veya 4 günlük isli balık',
      'Bozpençe Klanı dostluk nişanı ve göl kıyısı kayık geçişi',
      'Güney ormanının ve mantar vadisinin ayrıntılı avcı haritası',
    ],
    rumorOpeners: [
      'Tütsü ocakları başındaki balıkçılar',
      'Tabakçı Lyra',
      'İskele nöbetçileri',
    ],
    rumorBodies: [
      'Külköy tüccar loncasının Bozpençe kürklerinin fiyatını gizlice kırmaya çalıştığını konuşuyor.',
      'Gri Kaya Koyu’ndaki kaçakçı kaptanının iyi tuz karşılığı kürk aradığını söylüyor.',
      'Dev Eğrelti Vadisi’nde goblin toplayıcılarının sayısının arttığını bildiriyor.',
    ],
  },

  goblin_burrow: {
    dailySubjects: [
      'Paslı kazık barikatında uyuklayan sapanlı iki goblin gözcüsü',
      'Tünel ağzında el arabasıyla taş ve toprak taşıyan üç kobold kazıcı',
      'Çalınmış kervan fıçısının başında et kavgası yapan goblin yağmacılar',
      'Hurda demirden kaba ok ucu döven tek gözlü goblin demircisi',
      'Kaya köpeklerini kemikle besleyen eğitmen kobold',
    ],
    dangerSubjects: [
      'Çete başı veya kazıcı başının yönettiği silahlı mağara baskın kolu',
      'Dar tünel girişine kurulmuş gergin ipli taş düşürme tuzağı',
      'Alarm çıngıraklarını çalmaya koşan çevik mağara gözcüsü',
      'Alt galeride zincire vurulmuş esir tüccar çırağını koruyan muhafızlar',
    ],
    discoverySubjects: [
      'Çöken eski krallık galerisinde bulunmuş sağlam bronz baltalar',
      'Kervan kasasından çıkma 45 gümüş sikke ve kilitli tüccar defteri',
      'Koboldların çizdiği ilkel ama doğru yeraltı kaçış tüneli kroki taşı',
      'Bozpençe klanından çalınmış tuz çuvalları ve demir ayı tuzakları',
    ],
    dailySituations: [
      'tavan destek direklerini yenilemeden yan galeriyi kazmaya devam ediyor',
      'çalıntı erzakın en iyi kısmını kimin alacağı konusunda goblinlerle koboldlar arasında kavga çıkarıyor',
      'gece yakın yollara çıkacak hırsızlık kolu için paslı silahları yağlıyor',
      'tünellerin girişindeki kemik ve teneke çıngırakları yeniden diziyor',
    ],
    dangerSituations: [
      'düşmanlarını dar ve tuzaklı tünel boğazına çekip üstten taş yuvarlamaya hazırlanıyor',
      'alarm çıngırağını çekip tüm alt galeriyi aynı anda ayaklandırmak üzere',
      'gece karanlığında yakındaki köprüye veya elf sınırına sızmak için yola çıkıyor',
    ],
    discoverySituations: [
      'üstteki hurda yığını kaldırıldığında veya yan galeri incelendiğinde bulunuyor',
      'iki grubun tartışmasından yararlanıp alt odaya sızıldığında ele geçiriliyor',
    ],
    twists: [
      'Goblinler ile koboldlar arasındaki ittifak son derece kırılgandır; lider düşerse dağılırlar.',
      'Tüneller dar olduğu için büyük kalkan ve uzun mızrak savurmak zordur.',
      'İnlerdeki ganimetin bir kısmı Külköy ve Bozpençe halkına aittir; geri götürülmesi itibar kazandırır.',
    ],
    tactics: [
      { label: 'Girişteki ipten alarm çıngıraklarını fark edip kesmek', check: 'Algı / El Becerisi DC 13' },
      { label: 'Goblin ve kobold grupları arasındaki erzak kavgasını körüklemek', check: 'Aldatma / İkna DC 13' },
      { label: 'Duman veya meşale kullanarak tünelleri dışarıdan kontrol altına almak', check: 'Taktik / Hayatta Kalma DC 12' },
    ],
    rewards: [
      'Çalıntı demir külçeler, tuz çuvalları ve 25–45 Gümüş Sikke',
      'Esir tüccar çırağının veya klan eşyalarının iadesiyle kazanılan bölge onuru',
      'Eski maden galerisinden çıkma sağlam bronz balta ve çakmaktaşı kutu',
    ],
    rumorOpeners: [
      'Tünel ağzındaki gözcüler',
      'Kazıcı koboldlar',
    ],
    rumorBodies: [
      'lider Kırıkdiş’in payı az verdiği için koboldların alt tüneli kilitlemeyi düşündüğünü gıcırdıyor.',
      'yakında Gümüş Köprü’den yalnız bir araba geçeceği bilgisini paylaşıyor.',
    ],
  },

  river_crossing: {
    dailySubjects: [
      'Taş köprünün ayağını inceleyen Köprü Gözcüsü Halen',
      'Geçit başındaki kuru taş ocakta çay kaynatan iki kervan öncüsü',
      'Nehir kenarında sığ geçit derinliğini ölçen genç izci',
      'Karlı dağ patikasından inen yorgun katır sürücüsü',
    ],
    dangerSubjects: [
      'Geçit daraldığında arbaletle pusu kuran dört yolkesen eşkıya',
      'Sığ geçitten gece kaçak mal geçiren silahlı nehir teknesi',
      'Köprü korkuluğunun altına sinmiş iki goblin izcisi',
      'Soğuk dağ geçidinde avlanan aç gri kurt sürüsü',
    ],
    discoverySubjects: [
      'Köprü korkuluğuna çakılmış yanık tahta uyarı işareti',
      'Gümrük kulübesinin döşemesi altında su geçirmez harita silindiri',
      'Buz tutmuş veya çamura saplanmış eski vergi arabası enkazı',
    ],
    dailySituations: [
      'son yağmurlardan sonra kabaran nehrin köprü ayağındaki çatlağı büyütüp büyütmediğini ölçüyor',
      'geçitten geçecek kervanlar için en sağlam kuru kamp taşlarını temizliyor',
      'heyelan veya kar birikintisi yüzünden kapanan yan patikayı taşlarla işaretliyor',
    ],
    dangerSituations: [
      'sisli geçiş anında köprünün iki ucunu birden tutarak geçiş ücreti dayatmaya çalışıyor',
      'akıntının gürültüsünü fırsat bilip kervan katırlarını ürkütmeye hazırlanıyor',
      'geçit dar boğazında taş yuvarlayarak yolu kesmeyi planlıyor',
    ],
    discoverySituations: [
      'kulübenin içi arandığında veya nehir kenarındaki buz/çamur temizlendiğinde ortaya çıkıyor',
      'bir sonraki vadideki tehlike hakkında kritik zaman kazandırıyor',
    ],
    twists: [
      'Nehir akıntısı hızlıdır; düşen biri çelik halat olmadan kıyıya zor çıkar.',
      'Geçit başındaki kuru taş ocak dumanı kilometrelerce öteden rüzgarla fark edilebilir.',
      'Köprü ayağındaki çatlak ağır yük arabaları için risk oluşturmaktadır.',
    ],
    tactics: [
      { label: 'Çelik halat ve kanca ile geçit güvenliğini veya araç çekimini sağlamak', check: 'Atletizm / Taktik DC 12' },
      { label: 'Köprü çevresindeki pusu noktalarını dürbün veya gözle taramak', check: 'Algı DC 13' },
      { label: 'Yolkesenlerin lideriyle sert pazarlık veya ani karşı baskın yapmak', check: 'Gözdağı / Savaş DC 13' },
    ],
    rewards: [
      'Çelik halat, kanca ve su geçirmez harita silindiri',
      'Kervan yolunun güvenli kullanımı ve 18 Gümüş geçiş ödülü',
      'Donmuş enkazdan çıkarılan kapalı kasa defteri',
    ],
    rumorOpeners: [
      'Köprü gözcüsü',
      'Geçitten geçen kervancılar',
    ],
    rumorBodies: [
      'güney taşocağı yolunda geceleri goblin meşaleleri görüldüğünü anlatıyor.',
      'Kuzey Dağ Geçidi’nde geçen kıştan kalma bir vergi arabası enkazı durduğunu söylüyor.',
    ],
  },

  mist_ruin: {
    dailySubjects: [
      'Fırtınadan korunmak için yıkık taş kemerin altına sığınmış iki gezgin avcı',
      'Taşburun hisar avlusunda dolaşan ürkek dağ keçisi sürüsü',
      'Falez burcunun üst katında ufku süzen kaçakçı gözcüsü Varek',
      'Yosunlu kuyu başında mola vermiş yalnız bitki toplayıcısı',
    ],
    dangerSubjects: [
      'Hisar mahzeninde çalıntı zırh ve kışlık erzak saklayan altı dağ eşkıyası',
      'Yıkıntıyı gizli buluşma noktası yapan iki rakip haydut grubu',
      'Falez uçurumunda yuvasını koruyan dev kaya kartalı ve kaygan taşlar',
      'Kuledeki bakır işaret çanıyla açık denizdeki kaçakçılara fener sallayan gözcüler',
    ],
    discoverySubjects: [
      'Taş kemer dibinde gizlenmiş su geçirmez yağlı deri paket ve gümüş mühür yüzüğü',
      'Hisar mahzeninde paslanmamış eski garnizon çelik kılıcı ve kalkanı',
      'Çağlar öncesinden kalma, pusula ibresini hafifçe titreten nadir taş mühür izi',
      'Falez kulesinden çekilmiş doğu kıyı ve ada sığlıklarını gösteren seyir krokisi',
    ],
    dailySituations: [
      'ıslak taşların arasında kuru yakacak ve rüzgar almayan bir köşe arıyor',
      'uçurum kenarından veya yıkık mazgallardan çevredeki hareketliliği gözlüyor',
      'eski krallık taşlarının üzerindeki silinmiş yazıtları kömürle kopyalamaya çalışıyor',
    ],
    dangerSituations: [
      'fırtına gürültüsü altında harabeye sığınan herkesi tehdit görüp silah çekiyor',
      'kuledeki işaret çanını çalıp kıyıdaki silahlı tayfaları uyarmaya hazırlanıyor',
      'yıkık duvarın arkasından grup ateşinin etrafını sarmaya çalışıyor',
    ],
    discoverySituations: [
      'çöken moloz taşlarının altı veya mahzenin dip duvarı incelendiğinde ortaya çıkıyor',
      'bölgenin eski tarihine ve haydutların sakladığı ganimetlere ışık tutuyor',
    ],
    twists: [
      'Bu harabelerde canavar veya aktif büyü yoktur; asıl tehlike soğuk, rüzgar, çökme riski ve burada saklanan insanlardır.',
      'Pusula ibresinin hafifçe titremesi dışında her şey somut ve fizikseldir.',
      'İki farklı grup aynı gece yağmurdan kaçıp aynı çatı altına sığınabilir.',
    ],
    tactics: [
      { label: 'Yıkık duvar gölgelerinden ilerleyip mahzen nöbetçilerini şaşırtmak', check: 'Gizlilik DC 13' },
      { label: 'Gece fırtınasında ateş yakıp diğer sığınmacılarla temkinli ateşkes kurmak', check: 'İkna / Sezgi DC 13' },
      { label: 'Mahzen taşlarındaki gizli bölmeyi veya eski zırh deposunu açmak', check: 'Araştırma / Güç DC 13' },
    ],
    rewards: [
      'İyi korunmuş çelik uzun kılıç, demir kalkan veya eski gümüş mühür yüzüğü',
      'Pirinç denizci dürbünü ve eski sınır garnizonu haritası',
      'Kaçakçıların kıyıdaki gizli iskele şifresi',
    ],
    rumorOpeners: [
      'Harabeye sığınan izciler',
      'Kule gözcüleri',
    ],
    rumorBodies: [
      'hisarın alt mahzeninde hâlâ kullanılmamış kışlık zırh sandıkları bulunduğunu fısıldıyor.',
      'falez burcundan üç gece üst üste deniz yönüne kırmızı fener işareti verildiğini anlatıyor.',
    ],
  },

  smuggler_cove: {
    dailySubjects: [
      'Kaçakçı Kaptan Morvain ve kıyı mağarasında tuz fıçısı yuvarlayan iki tayfa',
      'Sisli iskelede yelken bezini yamayan deneyimli denizci',
      'Bozpençe kürk denklerini tekneye yüklemek için bekleyen aracı tüccar',
      'Koy ağzındaki kayalıklarda gelgit yüksekliğini ölçen gözcü',
    ],
    dangerSubjects: [
      'Gümrük casusu sandıkları yolcuyu kıyı mağarasına çekmeye çalışan silahlı tayfalar',
      'Paylaşım anlaşmazlığı yüzünden Kaptan Morvain’e bıçak çeken isyancı mürettebat',
      'Kayıp kürk sandığının hesabını sormaya gelmiş öfkeli silahlı klan temsilcileri',
      'Barut fıçılarının yakınında dikkatsizce meşale tutan sarhoş gözcü',
    ],
    discoverySubjects: [
      'Kıyı mağarasının dibinde gizlenmiş iki kasa baharat, tuz ve doğu ada seyir defteri',
      'Külköy sınır kalesindeki gizli bir tüccar ortağına yazılmış mühürlü mektup',
      'Sisli Fok Kayalıkları’ndaki batık geminin koordinatlarını gösteren denizci pusulası',
    ],
    dailySituations: [
      'sis açılmadan önce sandalları yükleyip doğu adalarına yelken açmaya hazırlanıyor',
      'Doğu Falezleri Burcu’ndan gelecek bakır çan veya fener işaretini bekliyor',
      'su almayan mağara oyuğunda tuz ve barut fıçılarını istifliyor',
    ],
    dangerSituations: [
      'kayalıkların tek dar iniş yolunu tutup gelenleri silahsızlandırmaya kalkışıyor',
      'pazarlık bozulduğu anda barut fıçılarını veya tekne halatlarını kesmekle tehdit ediyor',
      'gece gelgit yükselirken esirleri sığ mağarada bırakıp denize açılmak üzere',
    ],
    discoverySituations: [
      'tayfalar yük taşırken mağara duvarındaki sandıkların arkasında görülüyor',
      'Kaptan Morvain’in kamara sandığından veya seyir defterinden çıkıyor',
    ],
    twists: [
      'Kaçakçılar altından çok tuza, iyi çeliğe ve sınır kalesindeki devriye saatlerine değer verir.',
      'Şiddetli doğu rüzgarı çıkarsa koydan açılmak ertesi güne ertelenir.',
    ],
    tactics: [
      { label: 'Kaptan Morvain ile tekne geçişi veya takas için soğukkanlı pazarlık yapmak', check: 'İkna / Pazarlık DC 14' },
      { label: 'Kayalık inişten gizlice sızıp mağara ağzını kontrol altına almak', check: 'Gizlilik / Akrobasi DC 13' },
      { label: 'Gelgit ve rüzgar yönünü okuyarak yelkenlinin hareket vaktini hesaplamak', check: 'Denizcilik / Algı DC 12' },
    ],
    rewards: [
      'Denizci pusulası, 2 kasa tuz/baharat ve Sisli Fok Kayalıkları’na tekne geçişi',
      'Kıyı seyir defteri ve Külköy’deki gizli işbirlikçinin adı',
    ],
    rumorOpeners: [
      'İskeledeki tayfalar',
      'Kaptan Morvain’in dümencisi',
    ],
    rumorBodies: [
      'Sisli Fok Kayalıkları’nda karaya oturmuş gemide hâlâ kuru kurşun sandıklar durduğunu konuşuyor.',
      'orman kerestesinin bu sezon adalarda iki kat fiyat ettiğini anlatıyor.',
    ],
  },

  wild_nature: {
    dailySubjects: [
      'Sazlık kıyıda ağlarını toplayan Yaşlı Balıkçı Gorim',
      'Bataklık adacığında şifalı kök kurutan Bitki Toplayıcısı Soren',
      'Ağaç gövdelerindeki av işaretlerini yenileyen Bozpençe izcisi',
      'Kızılşahin Kayalıkları’nın sırtından dürbünle ufku tarayan Elf gözlemci',
      'Fok kayalıklarında fırtınanın dinmesini bekleyen açık deniz balıkçıları',
    ],
    dangerSubjects: [
      'Bölgesini koruyan dev orman bozayısı veya iri yaban domuzu sürüsü',
      'Yaralı avcıyı kuşatmış altı aç gri kurt',
      'Kütüklerin altında yuvalanmış zehirli dikenli sürüngen ve dev bataklık sülükleri',
      'Nadir beyaz mantar toplarken karşılaşan goblin ve Bozpençe devriyesi',
      'Kayalık sırtlarda yuvasına yaklaşılan dev kaya kartalı',
    ],
    discoverySubjects: [
      'Çamura saplanmış eski tüccar arabasının içinden sağlam kalmış şarap ve harita kasası',
      'Külköy hekiminin aradığı şifalı beyaz kabuk mantarları ve ateş düşürücü otlar',
      'Sular çekildiğinde göl dibinde beliren yüzlerce yıllık taş rıhtım temeli',
      'Fok adasındaki batık gemi iskeletinde su almamış kurşun sandık ve kehribar',
    ],
    dailySituations: [
      'sabah sisi dağılmadan önce ağlarını ve tuzaklarını kontrol ediyor',
      'vahşi hayvan izlerini okuyup bu gece hangi yöne kamp kurulmayacağını belirliyor',
      'soğuk akıntı veya bataklık çamuru arasından güvenli taş basamakları işaretliyor',
    ],
    dangerSituations: [
      'yoğun sis veya eğrelti otlarının arasından aniden grubun yoluna çıkıyor',
      'zırhlı veya ağır yüklü yolcuların bataklık çamuruna saplandığı anda saldırıyor',
      'iki farklı avcı/toplayıcı grubun gerilimli bir karşılaşmasına sahne oluyor',
    ],
    discoverySituations: [
      'sular çekildiğinde veya devrik kütüğün altı yoklandığında gün yüzüne çıkıyor',
      'bölgeye özgü nadir şifalı otları veya kestirme geçişi açığa çıkarıyor',
    ],
    twists: [
      'Burada kalıcı insan yerleşimi yoktur; gece bastırırsa kendi ateşini ve barınağını kurmak zorundasın.',
      'Yoğun doğa dokusu yüzünden iz sürmek kolaylaşır ancak ağır zırhla hızlı hareket etmek zordur.',
      'Fırtına veya sis bastırdığında kıyı/patika yönü dakikalar içinde kaybedilebilir.',
    ],
    tactics: [
      { label: 'Doğal örtüyü ve devrik kütükleri siper alarak hayvandan uzaklaşmak', check: 'Hayatta Kalma / Gizlilik DC 13' },
      { label: 'Sağlam ip ve sırıkla bataklığa batan sandığı veya yolcuyu çekmek', check: 'Güç / Atletizm DC 12' },
      { label: 'Şifalı kök ve kabuk mantarlarını zehirli türlerden ayırt etmek', check: 'Doğa Bilgisi DC 13' },
    ],
    rewards: [
      'Ateş düşürücü otlar, beyaz kabuk mantarları veya taze göl alabalığı/et',
      'Batık araba/gemi sandığından kaliteli malzeme ve yön pusulası',
      'Güvenli kestirme patika veya gizli sazlık geçidinin haritada açılması',
    ],
    rumorOpeners: [
      'Gezgin toplayıcılar',
      'Göl kıyısı balıkçıları',
    ],
    rumorBodies: [
      'bataklık adacığındaki eski arabanın hâlâ açılmamış kilitli bir sandığı olduğunu anlatıyor.',
      'gölün suları çekilince kuzey ucunda eski taş rıhtım basamaklarının göründüğünü söylüyor.',
    ],
  },
};

interface NpcCulturePool {
  cultureLabel: string;
  firstNames: string[];
  surnamesOrTitles: string[];
  roles: string[];
  traits: string[];
  motives: string[];
  items: string[];
}

const NPC_CULTURES: Record<
  'human_frontier' | 'elf' | 'beastkin' | 'goblinoid' | 'outlaw_sailor',
  NpcCulturePool
> = {
  human_frontier: {
    cultureLabel: 'İnsan Sınır Halkı',
    firstNames: ['Altan', 'Doren', 'Mert', 'Kaya', 'Bora', 'Selin', 'Halen', 'Yaren', 'Torin', 'Mira', 'Orhan', 'Nehir'],
    surnamesOrTitles: ['Kültepeli', 'Demirkol', 'Yünören', 'Sazlıklı', 'Aktaş', 'Oduncu', 'Dereboyu', 'Sınırgözü'],
    roles: ['Kervan İzci Rehberi', 'Gezgin Çerçi', 'Sınır Muhafızı', 'Yün Dokumacısı', 'Nalbant Çırağı', 'Hancı Yardımcısı'],
    traits: ['Gözleri sürekli sis sınırını tarar', 'Az konuşur ama sözünün eridir', 'Eski bir diz aksaması vardır', 'Sıcak çorba ve tütün kokar', 'Defterine her duyduğu haberi not eder'],
    motives: ['Kayıp katırını ve tuz çuvallarını bulmak', 'Külköy’e kış öncesi güvenli dönüş yapmak', 'Bir önceki kervandan alacağı gümüşü tahsil etmek', 'Yeğeni için sağlam kışlık çizme almak'],
    items: ['Yağlı bezde kuru ekmek ve peynir', '3 Gümüş 7 Bakır Sikke', 'Külköy geçiş damgalı kağıt', 'Çakmaktaşı ve küçük bileği taşı'],
  },
  elf: {
    cultureLabel: 'Yüksekçam Elf Halkı',
    firstNames: ['Aelindor', 'Seraphina', 'Thalen', 'Lirien', 'Caelum', 'Elowen', 'Faelar', 'Sylvaria'],
    surnamesOrTitles: ['Yüksekdal', 'Çamgölgesi', 'Sisokçusu', 'Sedirkesen', 'Sessizadım', 'Geyikizi'],
    roles: ['Sınır Okçusu', 'Reçine Toplayıcısı', 'Asma Köprü Ustası', 'Arşiv Yazmanı', 'Gece Gözcüsü'],
    traits: ['Keçe çizmeleriyle taşta bile ses çıkarmaz', 'İnsanları mesafeli ama keskin bir dikkatle süzer', 'Konuşurken ormanın rüzgarını dinler', 'Porsuk yayını hiç elinden bırakmaz'],
    motives: ['Koboldların hangi maden galerisini açtığını anlamak', 'Oduncuların sınırı aşmamasını sağlamak', 'Eski bir taş antlaşma kopyasını doğrulamak'],
    items: ['Şifalı çam reçinesi merhemi', '6 adet gümüş uçlu porsuk oku', 'Sedir ağacına oyulmuş geçit işareti'],
  },
  beastkin: {
    cultureLabel: 'Bozpençe Klanı (Hayvan Kulaklı)',
    firstNames: ['Karok', 'Lyra', 'Vorn', 'Rokan', 'Sira', 'Tark', 'Nira', 'Bozkurt'],
    surnamesOrTitles: ['Kurt-Kulak', 'Tilki-Adım', 'Vaşak-Göz', 'Sazlık-Avcısı', 'Kürk-Büken', 'Demir-Pençe'],
    roles: ['Klan Avcısı', 'Kürk Tabakçısı', 'Göl Balıkçısı', 'Tuzak Kurucu', 'Genç Rüşt İzci'],
    traits: ['Kulakları en küçük dal çıtırtısına döner', 'İsli balık ve çam dumanı kokar', 'Sözü doğrudan ve süssüz söyler', 'Yabancıya el uzatmadan önce kokusunu ve silahını tartar'],
    motives: ['Goblinlerin çaldığı demir tuzakları geri almak', 'Kış için iyi fiyat veren dürüst bir tuz tüccarı bulmak', 'Genç kardeşinin ilk yalnız avını sağ tamamlamasını beklemek'],
    items: ['Kemik saplı keskin yüzme bıçağı', '2 porsiyon isli göl alabalığı', 'Kurt derisinden tuz kesesi'],
  },
  goblinoid: {
    cultureLabel: 'Goblin ve Kobold Kabileleri',
    firstNames: ['Kırıkdiş', 'Tıkır', 'Zıpkın', 'Çapak', 'Kazık', 'Hırt', 'Cırt', 'Paslı'],
    surnamesOrTitles: ['Çukurkazan', 'Hurda-Toplayan', 'Sapanlı', 'Kömür-Burun', 'Taş-Kemiren'],
    roles: ['Tünel Kazıcısı', 'Sapanlı Gözcü', 'Hurda Demircisi', 'Kaya Köpeği Eğitmeni', 'Kervan Gözetmeni'],
    traits: ['Sürekli dişlerini gıcırdatıp etrafı koklar', 'Kendi boyundan büyük bir nesneyi sürükler', 'Korkunca çabuk yaltaklanır ama sırtını dönünce taş atar', 'Paslı zırh parçalarını iple göğsüne bağlamıştır'],
    motives: ['Liderine götürecek parlak veya tuzlu bir ganimet kapmak', 'Rakip kobold grubunun açtığı odayı gizlice yağmalamak', 'Kaya köpeklerine taze et bulmak'],
    items: ['Eğri çivi torbası ve deri sapan', 'Çalıntı 4 Bakır Sikke ve yarım mum', 'Eski kervan sandığından çıkma bakır düğme'],
  },
  outlaw_sailor: {
    cultureLabel: 'Kuzey Haydutları ve Doğu Kaçakçıları',
    firstNames: ['Vorn', 'Morvain', 'Varek', 'Darek', 'Kors', 'Maren', 'Soren', 'Garrick'],
    surnamesOrTitles: ['Tuz-Sakal', 'Kara-Yelken', 'Batak-Yürüyen', 'Falez-Gözü', 'Gümüş-Kesen'],
    roles: ['Kıyı Gözcüsü', 'Sandal Dümencisi', 'Sahte Han İşletmecisi', 'Yolkesen Öncüsü', 'Fıçı Taşıyıcısı'],
    traits: ['Ceketinin altında her zaman ikinci bir hançer saklar', 'Konuşurken karşısındakinin kemerindeki keseye bakar', 'Deniz tuzu veya ucuz tütün kokar', 'Kendi canı söz konusu olunca pazarlığa hemen açıklaşır'],
    motives: ['Gümrük devriyesine yakalanmadan son kürk kasalarını tekneye atmak', 'Çete içinde kendi payını gizlice büyütmek', 'Açık denizdeki adaya güvenli bir dümenci bulmak'],
    items: ['Mühürsüz kıyı geçiş notu', 'Paslanmamış ince denizci hançeri', 'Küçük şişede ucuz rom ve 8 Gümüş Sikke'],
  },
};

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function generateProceduralScene(
  location: MapLocation,
  gameTimeMs: number,
  filter: SceneCategoryFilter = 'auto',
  safetyScore = 50
): ProceduralSceneCard {
  const archetype: SettlementArchetype = location.livingState?.archetype ?? 'wild_nature';
  const deck = ARCHETYPE_DECKS[archetype];
  const roll1d100 = rollDie(100);
  const timePhase = getDayPhaseLabel(gameTimeMs);

  let mode: 'daily' | 'danger' | 'discovery' = 'daily';
  if (filter === 'daily') mode = 'daily';
  else if (filter === 'danger') mode = 'danger';
  else if (filter === 'discovery') mode = 'discovery';
  else {
    // Otomatik seçim: güvenlik düşükse veya tehlike yüksekse tehlike şansı artar
    const dangerThreshold = Math.min(60, Math.max(20, 100 - safetyScore));
    if (roll1d100 <= dangerThreshold) mode = 'danger';
    else if (roll1d100 <= dangerThreshold + 32) mode = 'discovery';
    else mode = 'daily';
  }

  const subjects =
    mode === 'danger'
      ? deck.dangerSubjects
      : mode === 'discovery'
      ? deck.discoverySubjects
      : deck.dailySubjects;
  const situations =
    mode === 'danger'
      ? deck.dangerSituations
      : mode === 'discovery'
      ? deck.discoverySituations
      : deck.dailySituations;

  const subject = pick(subjects);
  const situation = pick(situations);
  const twist = pick(deck.twists);
  const tacticObj = pick(deck.tactics);
  const reward = pick(deck.rewards);

  const category: ProceduralSceneCard['category'] =
    mode === 'danger'
      ? 'Tehlike ve Çatışma'
      : mode === 'discovery'
      ? 'Keşif ve İz'
      : 'Günlük Yaşam';

  const comboSpaceSize =
    (deck.dailySubjects.length + deck.dangerSubjects.length + deck.discoverySubjects.length) *
    (deck.dailySituations.length + deck.dangerSituations.length + deck.discoverySituations.length) *
    deck.twists.length *
    deck.tactics.length *
    deck.rewards.length;

  const shortSubject = subject.split(' ').slice(0, 4).join(' ');
  const titlePrefix =
    mode === 'danger' ? 'Gerilim' : mode === 'discovery' ? 'Keşif İzi' : 'Yerel Olay';

  const moodImpact = mode === 'danger' ? -6 : mode === 'discovery' ? 2 : 3;

  return {
    id: `scene-${Date.now()}-${roll1d100}`,
    roll1d100,
    locationId: location.id,
    locationName: location.name,
    archetype,
    category,
    timePhase,
    title: `${titlePrefix}: ${shortSubject}`,
    threatLabel:
      mode === 'danger'
        ? `Tehlike ${location.dangerLevel}/5 · Çatışma/Pusu İhtimali`
        : mode === 'discovery'
        ? 'İpucu / Çevre Araştırması'
        : 'Sosyal Karşılaşma / Günlük İş',
    checkLabel: tacticObj.check,
    description: `${timePhase} vaktinde ${location.name} çevresinde ${subject}, ${situation}.`,
    complication: twist,
    tactic: tacticObj.label,
    reward,
    moodImpact,
    comboSpaceSize,
  };
}

export function generateProceduralNpc(archetype: SettlementArchetype): ProceduralNpcCard {
  let cultureKey: keyof typeof NPC_CULTURES = 'human_frontier';
  if (archetype === 'elf_canopy') cultureKey = 'elf';
  else if (archetype === 'beastkin_clan') cultureKey = 'beastkin';
  else if (archetype === 'goblin_burrow') cultureKey = 'goblinoid';
  else if (archetype === 'bandit_hamlet' || archetype === 'smuggler_cove') {
    cultureKey = 'outlaw_sailor';
  }

  const pool = NPC_CULTURES[cultureKey];
  return {
    id: `npc-${Date.now()}-${rollDie(999)}`,
    name: `${pick(pool.firstNames)} ${pick(pool.surnamesOrTitles)}`,
    cultureLabel: pool.cultureLabel,
    role: pick(pool.roles),
    trait: pick(pool.traits),
    motive: pick(pool.motives),
    carriedItem: pick(pool.items),
  };
}

export function generateProceduralRumorText(archetype: SettlementArchetype): string {
  const deck = ARCHETYPE_DECKS[archetype];
  return `${pick(deck.rumorOpeners)} ${pick(deck.rumorBodies)}`;
}

export function generateProceduralLivingProblem(archetype: SettlementArchetype): {
  title: string;
  description: string;
  severity: 'Düşük' | 'Orta' | 'Yüksek';
  questHook: string;
} {
  const deck = ARCHETYPE_DECKS[archetype];
  const subj = pick(deck.dangerSubjects);
  const sit = pick(deck.dangerSituations);
  const twist = pick(deck.twists);
  const tactic = pick(deck.tactics);
  const shortTitle = subj.split(' ').slice(0, 4).join(' ');

  return {
    title: `${shortTitle} Sorunu`,
    description: `${subj}, ${sit}. ${twist}`,
    severity: Math.random() < 0.35 ? 'Yüksek' : 'Orta',
    questHook: `${tactic.label} (${tactic.check})`,
  };
}

const MAZGAL_TERRAIN_EVENTS: Record<
  MazgalTerrain,
  { title: string; detail: string; checkHint: string; outcome: string }[]
> = {
  plain: [
    {
      title: 'Rüzgarlı Otlakta Taze At İzi',
      detail: 'Çimenlerin ezildiği noktada üç nal izi ve düşürülmüş bir eyer kayışı bulunuyor.',
      checkHint: 'İz Sürme DC 11',
      outcome: 'İzlerin Külköy mü yoksa Kulova yönüne mi gittiği netleşir.',
    },
    {
      title: 'Yalnız Çoban veya Gezgin Arabası',
      detail: 'Ufuk çizgisinde duman tüten küçük bir mola ateşi ve iki katır seçiliyor.',
      checkHint: 'İkna DC 10',
      outcome: 'Güncel yol durumu ve 1 günlük taze su paylaşımı alınabilir.',
    },
  ],
  road: [
    {
      title: 'Çamura Saplanmış Teker İzi ve Kırık Dingil',
      detail: 'Yol kenarında yakın zamanda onarılmış bir araba izi ve unutulmuş tahta takoz var.',
      checkHint: 'Araştırma DC 11',
      outcome: 'Yolu kullanan son kervanın yükü ve geçiş zamanı anlaşılır.',
    },
    {
      title: 'Yol Kenarı Devriye Kontrolü veya Pusu İzi',
      detail: 'Çalı diplerinde yere saplanmış iki kırık ok ve ezilmiş çim öbeği görülüyor.',
      checkHint: 'Algı DC 13',
      outcome: 'Yaklaşan eşkıya veya devriye grubu 40 metre öteden fark edilir.',
    },
  ],
  forest: [
    {
      title: 'Çam Dallarında Yırtık Kumaş ve Avcı İşareti',
      detail: 'Gövdeye bıçakla kazınmış yön oku, yakında bir avcı veya elf izcisi geçtiğini gösteriyor.',
      checkHint: 'Doğa / İz Sürme DC 12',
      outcome: 'Güvenli kuru kamp kovuğu bulunur; pusu riski düşer.',
    },
    {
      title: 'Çalılıktan Çıkan Aç Kurt veya Yaban Domuzu',
      detail: 'İnce sisin içinden dal kırılma sesiyle iri bir orman hayvanı patikaya çıkar.',
      checkHint: 'Hayvan İdaresi / Savaş DC 13',
      outcome: 'Hayvan uzaklaştırılırsa 2 günlük taze et veya post elde edilir.',
    },
  ],
  deep_forest: [
    {
      title: 'Güneş Görmeyen Kütük Altında Eski Tuzak',
      detail: 'Eğreltilerin altına gizlenmiş paslı bir demir kapana rastlanır.',
      checkHint: 'Algı / El Becerisi DC 14',
      outcome: 'Tuzak bozulup sağlam demir yay ve zincir alınabilir.',
    },
    {
      title: 'Ağır Siste Yön Şaşırtan Çapraz İzler',
      detail: 'Büyük çamların gölgesi ve sis yüzünden kuzey-doğu yönü karışır.',
      checkHint: 'Yön Bulma DC 14',
      outcome: 'Başarısızlıkta 1d4 saat ek yürüyüş kaybı yaşanır.',
    },
  ],
  mountain: [
    {
      title: 'Gevşek Çakıllı Keçi Patikası ve Taş Düşmesi',
      detail: 'Üst yamaçtan yuvarlanan taşlar dar geçidi yarım kapatmıştır.',
      checkHint: 'Çeviklik / Atletizm DC 13',
      outcome: 'Dikkatli tırmanışla yan sırt gözetleme noktasına ulaşılır.',
    },
    {
      title: 'Kaya Kovuğunda Kuru Odun ve Eski Kamp Külü',
      detail: 'Rüzgar almayan taş oyukta birkaç gün önce sönmüş ateş izi duruyor.',
      checkHint: 'İnceleme DC 12',
      outcome: 'Geceyi güvenli ve sıcak geçirmek için ideal barınak sağlanır.',
    },
  ],
  river: [
    {
      title: 'Hızlı Akıntıda Sığ Taş Geçidi',
      detail: 'Nehir tabanındaki iri taşlar üzerinden halatsız geçmek kayganlık nedeniyle risklidir.',
      checkHint: 'Atletizm DC 12',
      outcome: 'Karşı kıyıya geçilir ve taze içme suyu doldurulur.',
    },
    {
      title: 'Kıyı Çalılıklarına Takılmış Kırık Sandık veya Ağ',
      detail: 'Yukarı akıntıdan sürüklenmiş ahşap parçalar kıyıda toplanmıştır.',
      checkHint: 'Araştırma DC 12',
      outcome: '1d4 gümüşlük hurda eşya veya ip/balık ağı kurtarılır.',
    },
  ],
  marsh: [
    {
      title: 'Yumuşak Balçık ve Sazlık Çukuru',
      detail: 'Üstü yosun kaplı çamur tabakası ağır adımlı yolcuların çizmesini içine çeker.',
      checkHint: 'Hayatta Kalma DC 13',
      outcome: 'Sağlam söğüt kökleri üzerinden güvenli kuru şerit bulunur.',
    },
    {
      title: 'Sis İçinde Ateş Düşürücü Bataklık Kökleri',
      detail: 'Kuru bir tümsek üzerinde şifacıların aradığı nadir kökler yetişmiştir.',
      checkHint: 'Doğa Bilgisi DC 12',
      outcome: '2 dozluk şifalı bataklık otu kesesi toplanır.',
    },
  ],
  lake: [
    {
      title: 'Durgun Gölde Aniden Çöken Kıyı Sisi',
      detail: 'Kürek sesleri yankılanırken karşı kıyının ağaç silueti kaybolur.',
      checkHint: 'Yön Bulma / Denizcilik DC 13',
      outcome: 'Fener veya kıyı kamışları takip edilerek güvenli iskeleye çıkılır.',
    },
    {
      title: 'Sazlıkta Terk Edilmiş Küçük Balıkçı Sepeti',
      detail: 'Ahşap şamandıraya bağlı sepetin içinde taze göl alabalıkları vardır.',
      checkHint: 'Algı DC 10',
      outcome: '2 porsiyon taze balık ve sağlam hasır ip elde edilir.',
    },
  ],
  coast: [
    {
      title: 'Falez Altında Gelgit Mağarası ve Tuz Tabakası',
      detail: 'Sular çekildiğinde kayalık oyukta beyaz deniz tuzu ve sürüklenmiş gemi halatı görülür.',
      checkHint: 'Atletizm / İnceleme DC 13',
      outcome: '2 kese deniz tuzu ve 10 metre kalın gemi halatı toplanır.',
    },
    {
      title: 'Açık Denizden Gelen Fener İşareti',
      detail: 'Uzak falez sisinin içinde ritmik olarak iki kez yanıp sönen sarı bir fener görülür.',
      checkHint: 'Algı / Sezgi DC 13',
      outcome: 'Kaçakçı teknesinin kıyıya yaklaşma saati tahmin edilir.',
    },
  ],
  sea: [
    {
      title: 'Soğuk Doğu Akıntısı ve Sert Dalga Kabarması',
      detail: 'Rüzgar doğudan sert esmeye başlar; küçük kayıklar su alma tehlikesi yaşar.',
      checkHint: 'Denizcilik / Güç DC 14',
      outcome: 'Tekne fok kayalıklarının rüzgar altı koyuna sağ salim girer.',
    },
    {
      title: 'Su Yüzeyinde Yüzen Mühürlü Fıçı',
      detail: 'Eski bir gemiden düşmüş ziftli meşe fıçısı dalgalarla tekneye yaklaşır.',
      checkHint: 'El Becerisi DC 12',
      outcome: 'İçinden su almamış 3 günlük tuzlu et veya baharat çıkar.',
    },
  ],
};

export function generateMazgalEvent(
  cell: MazgalCell,
  gameTimeMs: number
): MazgalProceduralEvent {
  const roll1d20 = rollDie(20);
  const pool = MAZGAL_TERRAIN_EVENTS[cell.terrain];
  const base = pool[roll1d20 % pool.length];
  const phase = getDayPhaseLabel(gameTimeMs);

  let kind: MazgalProceduralEvent['kind'] = 'İz ve Keşif';
  if (roll1d20 <= 5 || (cell.safetyScore < 40 && roll1d20 <= 9)) {
    kind = 'Tehlike';
  } else if (roll1d20 >= 16) {
    kind = 'Karşılaşma';
  } else if (roll1d20 >= 11) {
    kind = 'Hava ve Arazi';
  }

  const safetyNote =
    cell.safetyScore >= 65
      ? 'Bölge devriye etkisi altında olduğu için tehdit kolay bastırılır.'
      : cell.safetyScore <= 38
      ? 'Tehlikeli mazgal: hazırlıksız yakalanılırsa pusu dezavantajı doğar.'
      : 'Temkinli ilerleme gerektiren sınır arazisi.';

  return {
    roll1d20,
    cellId: cell.id,
    terrainLabel: cell.terrainLabel,
    kind,
    title: `${base.title} (${phase})`,
    detail: `${base.detail} ${safetyNote}`,
    checkHint: base.checkHint,
    outcomeNote: base.outcome,
  };
}
