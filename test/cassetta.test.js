// Quello che si incolla nella cassetta: capirlo senza chiedere niente a
// nessuno. Sbagliare qui vuol dire andare a bussare al sito di qualcun altro
// perché uno ha scritto «chiedere a Paolo di park4night».
import test from 'node:test';
import assert from 'node:assert/strict';
import { capisciIncollato } from '../src/lib/cassetta.js';

test('un indirizzo di park4night è un posto', () => {
  const r = capisciIncollato('https://park4night.com/it/place/277443');
  assert.equal(r.tipo, 'park4night');
  assert.equal(r.p4n_id, '277443');
});

test('il solo numero è un posto di park4night', () => {
  assert.equal(capisciIncollato('277443').tipo, 'park4night');
});

test('un link di Google Maps con un punto solo è un posto', () => {
  assert.equal(capisciIncollato('https://www.google.com/maps/dir/?api=1&destination=45.0956,7.3474').tipo, 'maps-punto');
});

test('un link di Google Maps con partenza e arrivo è un percorso', () => {
  const r = capisciIncollato('https://www.google.com/maps/dir/?api=1&origin=45.0,7.0&destination=46.0,8.0');
  assert.equal(r.tipo, 'maps-percorso');
  assert.equal(r.punti.length, 2);
});

test('un link accorciato di Maps va seguito prima di leggerlo', () => {
  assert.equal(capisciIncollato('https://maps.app.goo.gl/abc123').tipo, 'maps-corto');
});

test('un altro indirizzo è un link', () => {
  assert.equal(capisciIncollato('https://www.visitnorway.com/lofoten').tipo, 'link');
});

test('del testo è un appunto, anche se dentro c’è la parola park4night', () => {
  assert.equal(capisciIncollato('chiedere a Paolo di park4night').tipo, 'nota');
  assert.equal(capisciIncollato('').tipo, 'nota');
  assert.equal(capisciIncollato(null).tipo, 'nota');
});
