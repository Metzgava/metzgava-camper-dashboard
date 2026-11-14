// Una strada possibile diventa tappe. Le tratte le ha già misurate il
// calcolatore quando la strada è nata: qui si traducono, non si ricontano.
// Sbagliare qui vuol dire mettere sulla mappa una strada che nessuno ha scelto.
import test from 'node:test';
import assert from 'node:assert/strict';
import { tappeDaPercorso } from '../src/lib/tappe.js';

const tratta = (a, b, km, min) => ({
  from: { name: a, lat: 45 + km / 100, lon: 12 + km / 100 },
  to: { name: b, lat: 46 + km / 100, lon: 11 + km / 100 },
  distance_km: km, duration_min: min, geometry: [[45, 12], [46, 11]],
});

const percorso = {
  id: 7, scelta: 'senza_pedaggi',
  varianti: [
    { chiave: 'rapido', distance_km: 269, tratte: [tratta('Susegana', 'Innsbruck', 269, 276)] },
    { chiave: 'senza_pedaggi', distance_km: 300, tratte: [tratta('Susegana', 'Trento', 120, 130), tratta('Trento', 'Innsbruck', 180, 200)] },
  ],
};

test('diventa tappe la variante scelta, non la prima della lista', () => {
  const t = tappeDaPercorso(percorso);
  assert.equal(t.length, 2);
  assert.deepEqual(t.map(x => [x.from_name, x.to_name]), [['Susegana', 'Trento'], ['Trento', 'Innsbruck']]);
});

test('senza una scelta vale la prima variante: è quella che si vede in cima', () => {
  const t = tappeDaPercorso({ ...percorso, scelta: null });
  assert.equal(t.length, 1);
  assert.equal(t[0].to_name, 'Innsbruck');
});

test('ogni tappa si porta i suoi numeri e la sua linea', () => {
  const t = tappeDaPercorso(percorso);
  assert.equal(t[1].distance_km, 180);
  assert.equal(t[1].duration_min, 200);
  assert.deepEqual(t[1].geometry, [[45, 12], [46, 11]]);
  assert.deepEqual(t.map(x => x.posizione), [0, 1]);
});

test('una strada senza varianti non diventa niente, e non lancia', () => {
  assert.deepEqual(tappeDaPercorso({ varianti: null }), []);
  assert.deepEqual(tappeDaPercorso({ varianti: [{ chiave: 'rapido' }] }), []);
  assert.deepEqual(tappeDaPercorso(null), []);
});

test('una tratta senza coordinate si salta: una tappa senza posto non si disegna', () => {
  const t = tappeDaPercorso({ scelta: 'rapido', varianti: [{ chiave: 'rapido', tratte: [
    { from: { name: 'Susegana' }, to: { name: 'Trento', lat: 46, lon: 11 }, distance_km: 120 },
    tratta('Trento', 'Innsbruck', 180, 200),
  ] }] });
  assert.equal(t.length, 1);
  assert.equal(t[0].from_name, 'Trento');
  assert.equal(t[0].posizione, 0);
});

test('un punto senza nome si chiama con le sue coordinate, non «undefined»', () => {
  const t = tappeDaPercorso({ scelta: 'r', varianti: [{ chiave: 'r', tratte: [
    { from: { lat: 45.8512, lon: 12.2466 }, to: { name: 'Trento', lat: 46.07, lon: 11.12 }, distance_km: 90, duration_min: 70 },
  ] }] });
  assert.equal(t[0].from_name, '45.851, 12.247');
});

test('i chilometri che non arrivano valgono zero, non NaN', () => {
  const t = tappeDaPercorso({ scelta: 'r', varianti: [{ chiave: 'r', tratte: [
    { from: { lat: 45, lon: 12 }, to: { lat: 46, lon: 11 } },
  ] }] });
  assert.equal(t[0].distance_km, 0);
  assert.equal(t[0].duration_min, 0);
});
