// Il consumo a riposo, misurato dalle notti invece che battuto a mano.
//
// Disegno: docs/superpowers/specs/2026-11-21-durata-consumo-vivo-design.md
//
// In tabella c'erano **11 W**, col bollino «misurato». Lo erano: misurati il
// 16/11/2026, «batterie -0,29 A piu' pannelli +0,5 A». Ma da allora in camper
// sono arrivate la scatoletta e Starlink, e un numero misurato una volta e poi
// mai piu' e' una stima travestita da misura, che invecchia senza dirlo.
//
// Due attenzioni, ed entrambe sono la stessa: **non misurare il consumo al
// netto di qualcosa che lo stava pagando**. Di giorno lo paga il sole; di
// notte puo' pagarlo la Bluetti dalla sua uscita a 12 V. In tutti e due i casi
// il pavimento verrebbe piu' basso del vero, cioe' l'errore nel verso
// ottimista.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { consumoARiposo } from '../src/lib/consumo.js';

const BATT = ['NWJ1', 'NWJ2'];
const A = new Date('2026-11-21T08:00:00Z');
const quando = m => new Date(A.getTime() - m * 60000);
const riga = (m, apparecchio, grandezza, valore) =>
  ({ quando: quando(m), apparecchio, grandezza, valore });
const dove = { a: A, batterie: BATT };

// Un tratto di storia: da `daMin` a `aMin` minuti prima di adesso (daMin e' il
// piu' lontano), col pacco che eroga `esce` watt, i pannelli a `sole`, e --
// quando si vuole -- l'uscita a 12 V della Bluetti a `bluettiDc`.
//
// Le letture ogni due minuti, come il passo vero della scatoletta. `pannelli_w`
// c'e' **sempre**, anche di notte a zero: e' cosi' che lo scrive agente.py, e
// la differenza fra uno zero scritto e una riga che manca e' tutto quel che
// distingue «era notte» da «non lo so».
const tratto = (daMin, aMin, { esce, sole = 0, bluettiDc = null, pannelli = true }) => {
  const fuori = [];
  for (let m = daMin; m > aMin; m -= 2) {
    for (const b of BATT) fuori.push(riga(m, b, 'watt', -esce / BATT.length));
    if (pannelli) fuori.push(riga(m, 'SmartSolar', 'pannelli_w', sole));
    if (bluettiDc != null) fuori.push(riga(m, 'EL300', 'uscita_dc_w', bluettiDc));
  }
  return fuori;
};

const notte = (giorniFa, esce, extra = {}) => {
  const base = giorniFa * 1440;
  return tratto(base + 720, base + 480, { esce, sole: 0, ...extra });
};
const giorno = (giorniFa, esce) => {
  const base = giorniFa * 1440;
  return tratto(base + 300, base + 120, { esce, sole: 300 });
};

test('il riposo esclude le ore col sole', () => {
  // Di giorno si misurerebbe il consumo **al netto del sole**, piu' basso del
  // vero. E' la stessa attenzione che il proprietario ha avuto il 16/11/2026,
  // quando ha sommato i +0,5 A dei pannelli ai -0,29 A delle batterie.
  const r = consumoARiposo([...notte(0, 12), ...giorno(0, 2)], dove);
  assert.ok(Math.abs(r.watt - 12) < 1.5, `watt = ${r.watt}`);
});

test('il riposo esclude le notti in cui la Bluetti alimentava il 12 V', () => {
  // Un'altra fonte invisibile. Con la Bluetti sul 12 V il pavimento scende
  // sotto il vero: lo stesso errore del sole, con un altro nome.
  const r = consumoARiposo(
    [...notte(0, 12), ...notte(1, 2, { bluettiDc: 50 })], dove);
  assert.ok(Math.abs(r.watt - 12) < 1.5, `watt = ${r.watt}`);
});

test('il riposo e’ il PAVIMENTO, non la media: un’ora di Truma non lo alza', () => {
  // Una media notturna che include un'ora di stufa non e' un consumo a
  // riposo: e' la media di una notte in cui si e' consumato.
  const r = consumoARiposo(
    [...notte(0, 12), ...tratto(600, 540, { esce: 900, sole: 0 })], dove);
  assert.ok(r.watt < 30, `watt = ${r.watt}`);
});

test('una notte sola e strana non decide', () => {
  const r = consumoARiposo(
    [...notte(0, 12), ...notte(1, 12), ...notte(2, 12), ...notte(3, 60)], dove);
  assert.ok(Math.abs(r.watt - 12) < 3, `watt = ${r.watt}`);
});

test('senza notti buone il numero NON si da’, e non si ricade sugli 11 W', () => {
  const r = consumoARiposo(giorno(0, 2), dove);
  assert.equal(r.watt, null);
  assert.ok(r.perche_manca, 'manca la ragione');
});

test('se lo SmartSolar tace, la ragione e’ «non so quando era notte»', () => {
  // L'assenza di `pannelli_w` **non e' notte**: il Bluetooth perde annunci
  // anche in pieno giorno, e leggerla come notte farebbe entrare ore diurne
  // nel campione -- ancora il verso ottimista. Evita anche di dover sapere
  // che ora e' dove sei: il server gira in UTC e il camper si sposta.
  const r = consumoARiposo(
    tratto(720, 480, { esce: 12, pannelli: false }), dove);
  assert.equal(r.watt, null);
  assert.match(r.perche_manca, /quando era notte/);
});

test('una notte troppo corta non e’ una notte', () => {
  // Mezz'ora di buio non basta a trovare un pavimento: ci sta dentro un solo
  // ciclo del frigo, e il pavimento sarebbe quello di quel ciclo.
  const r = consumoARiposo(tratto(60, 30, { esce: 12, sole: 0 }), dove);
  assert.equal(r.watt, null);
  assert.ok(r.perche_manca);
});

test('dice su quante notti e’ fatto', () => {
  const r = consumoARiposo([...notte(0, 12), ...notte(1, 12)], dove);
  assert.equal(r.notti, 2);
  assert.ok(r.campioni > 0);
});

test('senza righe il numero non si da’', () => {
  const r = consumoARiposo([], dove);
  assert.equal(r.watt, null);
  assert.ok(r.perche_manca);
});
