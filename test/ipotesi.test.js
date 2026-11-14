// Il conto di un'ipotesi di viaggio: quanto costerebbe andare da quella parte.
// È il numero su cui si confrontano due direzioni, quindi ogni pezzo porta con
// sé come è stato contato — e quando un dato manca si dice che manca, invece di
// mettere zero. Zero vuol dire «non costa niente», e non è quello che si sta
// dicendo.
import test from 'node:test';
import assert from 'node:assert/strict';
import { contoIpotesi } from '../src/lib/ipotesi.js';

const guida = (km, min, pedKm) => ({
  scelta: 'r',
  varianti: [{ chiave: 'r', distance_km: km, duration_min: min, pedaggio_km: pedKm ?? null }],
});
const CAMPER = { kmPerLitro: 10, prezzoLitro: 1.75, tariffaPedaggio: 0.09 };

test('somma i chilometri e le ore delle tratte di ogni giorno', () => {
  const c = contoIpotesi({ giorni: [
    { numero: 1, percorsi: [guida(200, 150)] },
    { numero: 2, percorsi: [guida(100, 80), guida(50, 40)] },
    { numero: 3, percorsi: [] },
  ], ...CAMPER });
  assert.equal(c.km, 350);
  assert.equal(c.minuti, 270);
  assert.equal(c.giorni, 3);
});

test('un giorno fermo è un giorno: non guida, ma c’è', () => {
  const c = contoIpotesi({ giorni: [{ numero: 1, percorsi: [] }, { numero: 2, percorsi: [] }], ...CAMPER });
  assert.equal(c.giorni, 2);
  assert.equal(c.km, 0);
  assert.equal(c.gasolio, null, 'senza chilometri il gasolio non è zero: non c’è');
});

test('il gasolio si conta sui chilometri, e dice come', () => {
  const c = contoIpotesi({ giorni: [{ numero: 1, percorsi: [guida(100, 60)] }], ...CAMPER });
  assert.equal(c.gasolio.importo, 17.5);
  assert.match(c.gasolio.conto, /100 km/);
});

test('senza il consumo del camper il gasolio manca, e si dice', () => {
  const c = contoIpotesi({ giorni: [{ numero: 1, percorsi: [guida(100, 60)] }], prezzoLitro: 1.75 });
  assert.equal(c.gasolio, null);
  assert.ok(c.mancano.some(x => /consumo|gasolio/i.test(x)), c.mancano.join(' | '));
});

test('i pedaggi si contano sui chilometri di autostrada che le strade dichiarano', () => {
  const c = contoIpotesi({ giorni: [{ numero: 1, percorsi: [guida(300, 200, 250)] }], ...CAMPER });
  assert.equal(c.pedaggi.importo, 22.5);
  assert.match(c.pedaggi.conto, /250/);
});

test('una strada che evita i pedaggi costa zero di pedaggi, e zero qui vuol dire zero', () => {
  const c = contoIpotesi({ giorni: [{ numero: 1, percorsi: [guida(300, 240, 0)] }], ...CAMPER });
  assert.equal(c.pedaggi.importo, 0);
});

test('se nessuna strada dice i suoi pedaggi, i pedaggi non si inventano', () => {
  const c = contoIpotesi({ giorni: [{ numero: 1, percorsi: [guida(300, 200)] }], ...CAMPER });
  assert.equal(c.pedaggi, null);
  assert.ok(c.mancano.some(x => /pedagg/i.test(x)));
});

test('conta la variante scelta, non la prima che capita', () => {
  const c = contoIpotesi({ giorni: [{ numero: 1, percorsi: [{
    scelta: 'senza_pedaggi',
    varianti: [
      { chiave: 'rapido', distance_km: 269, duration_min: 276, pedaggio_km: 200 },
      { chiave: 'senza_pedaggi', distance_km: 300, duration_min: 360, pedaggio_km: 0 },
    ],
  }] }], ...CAMPER });
  assert.equal(c.km, 300);
  assert.equal(c.pedaggi.importo, 0);
});

test('le notti sono quelle dove si dorme, e i prezzi che si sanno fanno il conto', () => {
  const c = contoIpotesi({ giorni: [
    { numero: 1, percorsi: [guida(100, 60)], notte: 'Camping Tignes', prezzo_notte: 30 },
    { numero: 2, percorsi: [], notte: 'area sosta', prezzo_notte: 10 },
  ], ...CAMPER });
  assert.equal(c.notti, 2);
  assert.equal(c.campeggi.importo, 40);
});

test('le notti senza prezzo si contano sulla media di quelle che il prezzo ce l’hanno', () => {
  const c = contoIpotesi({ giorni: [
    { numero: 1, notte: 'Camping', prezzo_notte: 30, percorsi: [] },
    { numero: 2, notte: 'un altro campeggio', percorsi: [] },
  ], ...CAMPER });
  assert.equal(c.campeggi.importo, 60);
  assert.match(c.campeggi.conto, /media/);
});

test('se non si sa il prezzo di nessuna notte, i campeggi mancano', () => {
  const c = contoIpotesi({ giorni: [{ numero: 1, notte: 'da decidere', percorsi: [] }], ...CAMPER });
  assert.equal(c.campeggi, null);
});

test('il totale è la somma di quello che si sa, non di quello che manca', () => {
  const c = contoIpotesi({ giorni: [
    { numero: 1, percorsi: [guida(100, 60, 50)], notte: 'Camping', prezzo_notte: 30 },
  ], ...CAMPER });
  assert.equal(c.totale, 17.5 + 4.5 + 30);
});

test('un’ipotesi vuota non ha un totale di zero euro: non ha un totale', () => {
  const c = contoIpotesi({ giorni: [], ...CAMPER });
  assert.equal(c.totale, null);
  assert.equal(c.giorni, 0);
});
