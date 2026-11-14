// I conti del budget. Un numero mostrato deve dire da dove viene: un totale
// senza i suoi pezzi è un budget che mente, e un budget che mente è peggio di
// nessun budget.
import test from 'node:test';
import assert from 'node:assert/strict';
import { gasolioPrevisto, campeggiPrevisti, pedaggiPrevisti } from '../src/lib/budget.js';

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

// I pedaggi: il calcolatore dice quanti chilometri di autostrada, non quanto
// costano. Il costo è una stima a tariffa fissa, e si dice che lo è.
test('i pedaggi si contano sui chilometri di autostrada', () => {
  const r = pedaggiPrevisti({ kmPedaggio: 250, tariffa: 0.09 });
  assert.equal(r.importo, 22.5);
  assert.match(r.conto, /stima/);
});

test('zero chilometri di autostrada sono zero euro di pedaggi: qui lo zero è un dato', () => {
  assert.equal(pedaggiPrevisti({ kmPedaggio: 0, tariffa: 0.09 }).importo, 0);
});

test('senza i chilometri di pedaggio, o senza tariffa, non si inventa un costo', () => {
  assert.equal(pedaggiPrevisti({ kmPedaggio: null, tariffa: 0.09 }), null);
  assert.equal(pedaggiPrevisti({ tariffa: 0.09 }), null);
  assert.equal(pedaggiPrevisti({ kmPedaggio: 250, tariffa: 0 }), null);
  assert.equal(pedaggiPrevisti({ kmPedaggio: 250 }), null);
});
