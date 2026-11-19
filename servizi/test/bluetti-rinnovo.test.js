// Quando si può tentare un rinnovo del permesso Bluetti.
//
// Il freno esiste per una ragione buona: senza, ogni lettura rifiutata faceva
// un rinnovo, e con la pagina aperta sono tre al minuto -- una grandinata sul
// loro cloud che non ha mai aiutato nessuno. Quindi: non più di uno ogni dieci
// minuti.
//
// Il 19/11/2026 quel freno si è trasformato nel guasto. Cronologia vera:
//
//   13:59:30  il cloud comincia a rifiutare (805)
//   14:17:52  il server rinnova — e il gettone NUOVO viene rifiutato lo stesso
//   14:17:59  da qui in poi: «ho rinnovato meno di 10 minuti fa, non insisto»
//   14:23:52  un riavvio del contenitore azzera il freno, rinnova, e passa
//
// Ventotto minuti di immobilità, e se ne è usciti solo perché una
// pubblicazione ha riavviato il processo per caso. Senza quel riavvio il
// proprietario sarebbe rimasto fermo altri dieci minuti almeno, guardando una
// Bluetti al 100% che stava erogando quattrocento watt.
//
// La prudenza che evita di martellare non deve diventare immobilità: se i
// rifiuti si accumulano, un secondo tentativo si fa anche dentro i dieci
// minuti. Un rinnovo in più ogni tanto costa al loro cloud molto meno di
// mezz'ora di dati fermi a noi.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import './aiuto/archivio-finto.js';

const { sipuoRinnovare, DISTANZA, RIFIUTI_PER_INSISTERE } = await import('../src/lib/bluetti.js');

const ADESSO = 1_000_000_000;

test('passato il tempo di guardia si rinnova', () => {
  assert.equal(sipuoRinnovare({
    adesso: ADESSO, ultimoRinnovo: ADESSO - DISTANZA - 1, rifiutiDiFila: 0 }), true);
});

test('dentro il tempo di guardia, con pochi rifiuti, si aspetta', () => {
  // E' il freno che deve restare: tre letture al minuto non devono diventare
  // tre rinnovi al minuto.
  assert.equal(sipuoRinnovare({
    adesso: ADESSO, ultimoRinnovo: ADESSO - 1000, rifiutiDiFila: 1 }), false);
});

test('dentro il tempo di guardia, ma coi rifiuti che si accumulano, si insiste', () => {
  // Il caso del 19/11: il rinnovo delle 14:17 era stato rifiutato anche col
  // gettone nuovo, e il freno ha impedito di riprovare.
  assert.equal(sipuoRinnovare({
    adesso: ADESSO, ultimoRinnovo: ADESSO - 1000,
    rifiutiDiFila: RIFIUTI_PER_INSISTERE }), true);
});

test('una lettura riuscita azzera il conto, e il freno torna a valere', () => {
  assert.equal(sipuoRinnovare({
    adesso: ADESSO, ultimoRinnovo: ADESSO - 1000, rifiutiDiFila: 0 }), false);
});

test('la soglia non è zero, o il freno non esisterebbe', () => {
  assert.ok(RIFIUTI_PER_INSISTERE >= 2,
    'con una soglia di uno, il primo rifiuto rinnoverebbe sempre: il freno sparirebbe');
});

test('al primo avvio, senza nessun rinnovo alle spalle, si può rinnovare', () => {
  // `ultimoRinnovo` parte da zero: un contenitore appena acceso non deve
  // credere di aver gia' rinnovato.
  assert.equal(sipuoRinnovare({ adesso: ADESSO, ultimoRinnovo: 0, rifiutiDiFila: 0 }), true);
});
