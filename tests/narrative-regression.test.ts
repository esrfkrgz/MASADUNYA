/**
 * Anlatıcı kalitesi regresyon testleri.
 * Bu testler, log'da görülen hataların tekrar etmesini engeller:
 *  - "çalışıyorsun" -> 3 saatlik toplama / hırsızlık yanlış tetiklemesi
 *  - "1 gün" isteğinin 5 dakikada kalması
 *  - üçüncü şahıs anlatım, tekrar, uydurma iz/ip
 *  - seçeneklerin ikinci şahıstan birinci şahsa geçmemesi
 *
 * Çalıştır: npm run test:narrative
 */

import assert from 'node:assert/strict';
import { forceFirstPersonAction, guardNarrativeText } from '../src/utils/narrativeGuard';
import {
  hasForageIntent,
  hasStealIntent,
  parseRequestedDurationMinutes,
} from '../src/utils/narrativeIntent';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void): void {
  try {
    fn();
    passed += 1;
    console.log(`  OK  ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`  HATA ${name}\n       ${(error as Error).message}`);
  }
}

console.log('\nAnlatıcı regresyon testleri\n');

// ---------------------------------------------------------------------------
// 1. Yanlış niyet tetiklemesi ("çalışıyorsun" = denemek, iş yapmak değil)
// ---------------------------------------------------------------------------
console.log('Niyet tetikleyicileri:');

test('"Ağaçtan inmeye çalışıyorsun" toplama sayılmaz', () => {
  assert.equal(hasForageIntent('agactan inmeye calisiyorsun'), false);
});

test('"Ağaçtan inmeye çalışıyorsun" hırsızlık sayılmaz', () => {
  assert.equal(hasStealIntent('agactan inmeye calisiyorsun'), false);
});

test('"çalışmaya devam ediyorum" toplama/hırsızlık sayılmaz', () => {
  assert.equal(hasForageIntent('calismaya devam ediyorum'), false);
  assert.equal(hasStealIntent('calismaya devam ediyorum'), false);
});

test('gerçek toplama ve hırsızlık hâlâ tetikleniyor', () => {
  assert.equal(hasForageIntent('odun topluyorum'), true, 'odun topluyorum');
  assert.equal(hasForageIntent('sifa bitkileri topluyorum'), true, 'şifalı bitki toplama');
  assert.equal(hasForageIntent('avliyorum'), true, 'avlıyorum');
  assert.equal(hasStealIntent('kesesini caliyorum'), true, 'kesesini çalıyorum');
});

// ---------------------------------------------------------------------------
// 2. Oyuncunun ilan ettiği süre
// ---------------------------------------------------------------------------
console.log('\nSüre ayrıştırma:');

test('"1 gün boyunca" 1440 dakika', () => {
  assert.equal(parseRequestedDurationMinutes('1 gün boyunca doğuya yürüyeceğim'), 1440);
});

test('"3 saat" 180 dakika', () => {
  assert.equal(parseRequestedDurationMinutes('3 saat boyunca iz sürüyorum'), 180);
});

test('"yarım gün" 720 dakika', () => {
  assert.equal(parseRequestedDurationMinutes('yarım gün dinleneceğim'), 720);
});

test('süre bildirmeyen eylem 0 döner', () => {
  assert.equal(parseRequestedDurationMinutes('biraz ilerliyorum'), 0);
});

// ---------------------------------------------------------------------------
// 3. Modelden bağımsız anlatım koruması
// ---------------------------------------------------------------------------
console.log('\nAnlatım koruması:');

test('"Eşref, ...topluyor" ikinci şahsa çevrilir', () => {
  const out = guardNarrativeText({
    text: 'Eşref, elindeki bitkileri dikkatlice topluyor.',
    recentNarratorTexts: [],
    engineFacts: ['Üç şifalı dağ kekiği toplandı.'],
    fallback: 'Eylemin tamamlandı.',
  });
  assert.ok(!out.includes('Eşref'), out);
  assert.ok(out.includes('topluyorsun'), out);
});

test('son turlardaki cümle tekrar edilmez', () => {
  const out = guardNarrativeText({
    text: 'Meşe kütüğünün ardında nemli toprak görüyorsun. İleriye doğru bir adım atıyorsun.',
    recentNarratorTexts: ['Meşe kütüğünün ardında nemli toprak görüyorsun.'],
    engineFacts: ['Bir adım ilerlendi.'],
    fallback: 'Eylemin tamamlandı.',
  });
  assert.ok(!out.includes('kütük'), out);
  assert.ok(out.includes('adım'), out);
});

test('motor sonucunda olmayan iz/ip uydurması ayıklanır', () => {
  const out = guardNarrativeText({
    text: 'Bitkileri topluyorsun. Kütüğün yanında geyik izleri ve kalın bir ip parçası fark ediyorsun.',
    recentNarratorTexts: [],
    engineFacts: ['Bitki toplandı.'],
    fallback: 'Bitki toplandı.',
  });
  assert.ok(out.includes('Bitkileri topluyorsun'), out);
  assert.ok(!out.includes('iz'), out);
  assert.ok(!out.includes('ip'), out);
});

test('anlatım 60 kelimeyi aşmaz', () => {
  const out = guardNarrativeText({
    text: `${'Sisli ormanın nemli toprağında yavaşça ilerliyorsun ve her adımda yeni bir şey görüyorsun. '.repeat(8)}`,
    recentNarratorTexts: [],
    engineFacts: [],
    fallback: 'Eylemin tamamlandı.',
  });
  assert.ok(out.split(/\s+/).length <= 60, `kelime sayısı: ${out.split(/\s+/).length}`);
});

test('her cümle tekrarsa motor gerçeğine düşülür', () => {
  const out = guardNarrativeText({
    text: 'Meşe kütüğünün ardında nemli toprak görüyorsun.',
    recentNarratorTexts: ['Meşe kütüğünün ardında nemli toprak görüyorsun.'],
    engineFacts: ['İki adım ilerlendi.'],
    fallback: 'İki adım ilerlendi.',
  });
  assert.equal(out, 'İki adım ilerlendi.');
});

// ---------------------------------------------------------------------------
// 4. Seçenekleri birinci şahsa zorlama
// ---------------------------------------------------------------------------
console.log('\nSeçenek kişisi:');

test('"çalışıyorsun" -> "çalışıyorum"', () => {
  assert.equal(forceFirstPersonAction('Ağaçtan inmeye çalışıyorsun.'), 'Ağaçtan inmeye çalışıyorum.');
});

test('"yürüyorsun" -> "yürüyorum"', () => {
  assert.equal(forceFirstPersonAction('Kuzeye doğru yürüyorsun.'), 'Kuzeye doğru yürüyorum.');
});

test('zaten birinci şahıs olan metin bozulmaz', () => {
  assert.equal(
    forceFirstPersonAction('Üstümü başımı dikkatle inceliyorum.'),
    'Üstümü başımı dikkatle inceliyorum.'
  );
});

// ---------------------------------------------------------------------------
console.log(`\n${passed} geçti, ${failed} hata\n`);
if (failed > 0) process.exitCode = 1;
