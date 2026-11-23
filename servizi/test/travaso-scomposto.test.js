// Il travaso scomposto in tre: dispersi, consumati, immagazzinati.
//
// Disegno: docs/superpowers/specs/2026-11-23-travaso-scomposto-design.md
//
// Il proprietario, guardando l'animazione: «se escono 447 W dalla Bluetti ne
// entrano solo il 45%, cioe' 199». La figura mostrava i due capi e lasciava il
// buco in mezzo senza dire di cosa fosse fatto. Ed e' fatto di **due** cose
// diverse: quel che si disperde in calore e non torna piu', e quel che si
// consuma -- il frigo, lo Starlink -- che sta facendo il suo lavoro.
// Chiamarle insieme «perdite» farebbe sembrare spreco anche il secondo.
//
// `uscita_ac_w` sono i watt **alla presa**, gia' dopo l'inverter: lo dice
// `travasoInCorso`, che per risalire alla batteria interna divide per il
// rendimento dell'inverter. Quindi qui si applica **solo** quello del
// caricatore, e i tre numeri sommano esattamente il misurato -- cosi' chi
// guarda puo' controllare il conto a occhio.
import test from 'node:test';
import assert from 'node:assert/strict';
import { scomposizione, RENDIMENTO_CARICATORE } from '../src/lib/travaso.js';

test('i tre pezzi sommano esattamente quel che e’ stato misurato', () => {
  const s = scomposizione(447, 199);
  assert.equal(Math.round(s.dispersi + s.consumi + s.nelle_ective), 447);
});

test('il caso del proprietario, 23/11/2026', () => {
  const s = scomposizione(447, 199);
  assert.equal(Math.round(s.dispersi), 56);       // 447 x 0,125
  assert.equal(Math.round(s.nelle_ective), 199);
  assert.equal(Math.round(s.consumi), 192);       // 447 x 0,875 - 199
  assert.equal(s.torna, true);
});

test('senza consumi, tutto quel che arriva finisce nelle batterie', () => {
  const s = scomposizione(400, 400 * RENDIMENTO_CARICATORE);
  assert.ok(Math.abs(s.consumi) < 0.5, `restano ${s.consumi} W di consumi fantasma`);
});

test('se nelle batterie entra piu’ di quanto puo’ arrivare, non si inventa un negativo', () => {
  // Succede quando il rendimento vero e' migliore di quello di targa, o
  // quando una terza fonte sta caricando insieme alla 220. «Consumi: -20 W»
  // e' un'assurdita' che farebbe dubitare di tutto il resto della pagina.
  const s = scomposizione(200, 190);              // 200 x 0,875 = 175 < 190
  assert.equal(s.torna, false);
  assert.equal(s.consumi, null, 'ha mostrato un consumo negativo');
});

test('un consumo che non si sa non e’ un consumo zero', () => {
  // `null` vuol dire «non so»; `0` direbbe «ho guardato e non si consuma
  // niente», che e' un'altra affermazione.
  assert.equal(scomposizione(200, 190).consumi, null);
  assert.notEqual(scomposizione(200, 190).consumi, 0);
});

test('senza numeri non si scompone niente', () => {
  assert.equal(scomposizione(null, 199), null);
  assert.equal(scomposizione(447, null), null);
  assert.equal(scomposizione(0, 0), null, 'una presa spenta non ha niente da scomporre');
});

test('i dispersi non dipendono da quanto si consuma', () => {
  // Sono una proprieta' del caricatore, non di chi tira corrente: a parita'
  // di watt alla presa restano gli stessi.
  assert.equal(scomposizione(447, 199).dispersi, scomposizione(447, 50).dispersi);
});
