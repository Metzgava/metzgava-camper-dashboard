// La rotta che attacca i tracciati veri alle tappe di un viaggio.
//
// Disegno: docs/superpowers/specs/2026-11-24-tracciati-veri-design.md
//
// Si guardano **solo i giorni del viaggio**: fuori da quelli si lascia
// perdere. Col file evita che un tragitto di agosto finisca su una tappa di
// novembre; con l'interfaccia di CarLock -- che verra' dopo -- e' educazione
// verso un servizio che ci sta gia' facendo un favore.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { quantoSbagliava } from '../src/lib/tracciati.js';

const rotta = readFileSync(new URL('../src/routes/trips.js', import.meta.url), 'utf8');
const laRotta = (() => {
  const i = rotta.indexOf("router.post('/trips/:id/tracciati'");
  assert.ok(i > 0, 'la rotta dei tracciati non si trova piu’');
  const fine = rotta.indexOf('router.', i + 10);
  assert.ok(fine > i, 'non si delimita la rotta: finestra non affidabile');
  return rotta.slice(i, fine);
})();

test('la misura dello scarto trova il punto piu’ lontano', () => {
  // Il caso vero del 21/11: la ricostruzione passava per Bassano, a una
  // quindicina di chilometri dalla strada percorsa.
  const vera = [[46.0, 11.5], [45.9, 12.0], [45.9, 12.2]];
  const vecchia = [[46.0, 11.5], [45.767, 11.735], [45.9, 12.2]];
  const km = quantoSbagliava(vecchia, vera);
  assert.ok(km > 10 && km < 30, `scarto misurato: ${km}`);
});

test('due righe uguali non sbagliano di niente', () => {
  const r = [[46, 11], [46, 12]];
  assert.ok(quantoSbagliava(r, r) < 0.001);
});

test('senza una delle due righe non si misura niente', () => {
  // `null` vuol dire «non so»: uno zero direbbe «la ricostruzione era
  // perfetta», che e' un'altra affermazione.
  assert.equal(quantoSbagliava(null, [[46, 11]]), null);
  assert.equal(quantoSbagliava([[46, 11]], []), null);
  assert.equal(quantoSbagliava([], []), null);
});

test('si guardano solo i giorni del viaggio', () => {
  assert.match(laRotta, /start_date|periodo|dal|giorni/i,
    'la rotta non delimita il periodo: un tragitto di agosto puo’ finire su una tappa di novembre');
  assert.match(laRotta, /fuori_periodo/, 'non si dice quanti tragitti sono rimasti fuori dalle date');
});

test('la rotta scrive la geometria e i segni, nient’altro', () => {
  // L'anti obiettivo: km, durata, orari e capi sono misure del tracker o
  // decisioni di chi guida.
  const update = laRotta.match(/UPDATE legs SET[^`']*/)[0];
  for (const colonna of ['distance_km', 'duration_min', 'start_time', 'end_time',
                         'source', 'from_lat', 'from_lon', 'to_lat', 'to_lon'])
    assert.doesNotMatch(update, new RegExp(colonna), `la rotta riscrive ${colonna}`);
});

test('se la traccia comincia lontano dal capo salvato, lo si dice', () => {
  // I capi non si spostano -- non c'e' modo di sapere quali ha sistemato lui
  // -- ma quattrocento metri di scarto sono un fatto che merita di sapere.
  assert.match(laRotta, /capi_lontani/,
    'la distanza fra la traccia e il capo salvato non si misura');
});

test('caricare due volte lo stesso file non fa doppioni', () => {
  assert.match(laRotta, /gia_veri/, 'la rotta non distingue una tappa gia’ vera');
});

test('le due colonne nuove esistono', () => {
  const db = readFileSync(new URL('../src/lib/db.js', import.meta.url), 'utf8');
  assert.match(db, /tracciato_vero/, 'niente segno che spenga il puntinato');
  assert.match(db, /scarto_ricostruzione_km/,
    'non si conserva quanto sbagliava la ricostruzione');
});
