// «Non ancora collegati» e' l'elenco degli apparecchi che esistono in camper
// ma non parlano ancora con noi. Il commento che lo introduce dice la cosa
// giusta: elencarli non e' un difetto, e' la differenza fra «non c'e'» e «non
// lo so».
//
// Pero' l'elenco era fisso, e chi cominciava a parlare restava dentro. Il
// 19/11/2026, mezz'ora dopo aver messo le chiavi, SmartSolar e Orion XS
// mandavano volt e ampere **e la pagina continuava a dire che sarebbero
// arrivati con la scatoletta**: lo stesso apparecchio due volte, una come dato
// e una come promessa. Solo le Ective venivano nascoste, da un filtro scritto
// a mano nell'app.
//
// Un elenco di promesse che non si accorge di essere stato mantenuto invecchia
// male: ogni apparecchio nuovo avrebbe richiesto di ricordarsi di togliere una
// riga, e nessuno si ricorda. Quindi ora ogni atteso porta la propria spia:
// se fra le istantanee c'e' qualcosa che gli somiglia, non e' piu' atteso.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import './aiuto/archivio-finto.js';

const { ancoraAttesi } = await import('../src/routes/stato.js');

const ATTESI = [
  { id: 'ective', nome: 'Batterie Ective', spia: /^NWJ/i },
  { id: 'smartsolar', nome: 'SmartSolar MPPT', spia: /smartsolar/i },
  { id: 'starlink', nome: 'Starlink' },   // senza spia: non sappiamo ancora leggerla
];

const ids = elenco => elenco.map(a => a.id);

test('chi ha mandato una lettura non e’ piu’ atteso', () => {
  const fuori = ancoraAttesi(ATTESI, [{ apparecchio: 'SmartSolar HQ2222PUNT4' }]);
  assert.ok(!ids(fuori).includes('smartsolar'));
});

test('chi non ha mandato niente resta atteso', () => {
  const fuori = ancoraAttesi(ATTESI, [{ apparecchio: 'SmartSolar HQ2222PUNT4' }]);
  assert.ok(ids(fuori).includes('ective'));
});

test('il nome dell’apparecchio si confronta senza badare alle maiuscole', () => {
  // L'id che manda la scatoletta e' il nome Bluetooth dell'apparecchio, e
  // quello lo decide Victron: non e' detto che resti scritto come oggi.
  const fuori = ancoraAttesi(ATTESI, [{ apparecchio: 'smartsolar hq2222punt4' }]);
  assert.ok(!ids(fuori).includes('smartsolar'));
});

test('le Ective si riconoscono dal prefisso del loro nome', () => {
  // Non si chiamano «ective»: si chiamano NWJ20220412010310. Era il motivo del
  // filtro scritto a mano nell'app.
  const fuori = ancoraAttesi(ATTESI, [{ apparecchio: 'NWJ20220412010310' }]);
  assert.ok(!ids(fuori).includes('ective'));
});

test('un atteso senza spia resta sempre atteso', () => {
  // Starlink si legge solo dalla rete del piatto: nessuna istantanea potra'
  // mai somigliarle, e dire che e' arrivata sarebbe una bugia.
  const fuori = ancoraAttesi(ATTESI, [{ apparecchio: 'Starlink' }]);
  assert.ok(ids(fuori).includes('starlink'));
});

test('la spia non viene spedita al browser', () => {
  // Un'espressione regolare in JSON diventa `{}`: inutile da una parte e
  // confondente dall'altra.
  const fuori = ancoraAttesi(ATTESI, []);
  for (const a of fuori) assert.equal(a.spia, undefined);
});

test('senza nessuna istantanea restano tutti', () => {
  assert.deepEqual(ids(ancoraAttesi(ATTESI, [])), ['ective', 'smartsolar', 'starlink']);
});
