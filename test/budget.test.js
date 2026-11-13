// I conti del budget. Un numero mostrato deve dire da dove viene: un totale
// senza i suoi pezzi è un budget che mente, e un budget che mente è peggio di
// nessun budget.
import test from 'node:test';
import assert from 'node:assert/strict';
import { gasolioPrevisto, campeggiPrevisti } from '../src/lib/budget.js';

test('il gasolio si conta dai km, dal consumo e dal prezzo', () => {
  const r = gasolioPrevisto({ km: 1240, kmPerLitro: 10, prezzoLitro: 1.85 });
  assert.equal(r.importo, 229.4);
  assert.match(r.conto, /1\.?240/);
});

test('senza consumo, senza prezzo o senza km il gasolio non si inventa', () => {
  assert.equal(gasolioPrevisto({ km: 1240, kmPerLitro: 0, prezzoLitro: 1.85 }), null);
  assert.equal(gasolioPrevisto({ km: 1240, kmPerLitro: 10, prezzoLitro: null }), null);
  assert.equal(gasolioPrevisto({ km: 0, kmPerLitro: 10, prezzoLitro: 1.85 }), null);
});

test('i campeggi si contano sulla media dei posti scelti per le notti', () => {
  const r = campeggiPrevisti({ prezzi: [30, 20], notti: 10 });
  assert.equal(r.importo, 250);
  assert.match(r.conto, /25/);
});

test('senza posti scelti o senza notti non c’è niente da contare', () => {
  assert.equal(campeggiPrevisti({ prezzi: [], notti: 10 }), null);
  assert.equal(campeggiPrevisti({ prezzi: [30], notti: 0 }), null);
});
