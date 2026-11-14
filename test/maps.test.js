// Un nome non è un punto: «Susegana» non sta da nessuna parte finché qualcuno
// non dice dove. Google nei suoi link scrive i nomi, non le coordinate, e una
// strada senza coordinate non si può contare: è qui che si colma la differenza.
import test from 'node:test';
import assert from 'node:assert/strict';
import { completaPunti, centroDelLink } from '../src/lib/maps.js';

const finto = posti => async nome => (posti[nome] ? [posti[nome]] : []);

test('i nomi diventano coordinate, nell’ordine in cui stavano', async () => {
  const cerca = finto({
    'Susegana': { name: 'Susegana, TV', lat: 45.8512, lon: 12.2466 },
    'Innsbruck': { name: 'Innsbruck, Austria', lat: 47.2692, lon: 11.4041 },
  });
  const r = await completaPunti([{ name: 'Susegana' }, { name: 'Innsbruck' }], cerca);
  assert.equal(r.mancanti.length, 0);
  assert.deepEqual(r.punti.map(p => p.name), ['Susegana', 'Innsbruck']);
  assert.equal(r.punti[0].lat, 45.8512);
  assert.equal(r.punti[1].lon, 11.4041);
});

test('un punto che ha già le sue coordinate non si va a cercare', async () => {
  let chiamate = 0;
  const r = await completaPunti([{ name: '45.1, 12.2', lat: 45.1, lon: 12.2 }], async () => { chiamate++; return []; });
  assert.equal(chiamate, 0);
  assert.equal(r.punti[0].lat, 45.1);
});

test('il nome che non si trova si dice, e gli altri passano comunque', async () => {
  const cerca = finto({ 'Innsbruck': { lat: 47.2692, lon: 11.4041 } });
  const r = await completaPunti([{ name: 'Via di casa di Carlo' }, { name: 'Innsbruck' }], cerca);
  assert.deepEqual(r.mancanti, ['Via di casa di Carlo']);
  assert.equal(r.punti.length, 1);
});

test('se il geocoder non risponde il punto resta senza posto, senza far crollare tutto', async () => {
  const r = await completaPunti([{ name: 'Susegana' }], async () => { throw new Error('geocoder muto'); });
  assert.deepEqual(r.mancanti, ['Susegana']);
  assert.equal(r.punti.length, 0);
});

test('coordinate finte dal geocoder non passano per buone', async () => {
  const r = await completaPunti([{ name: 'Susegana' }], async () => [{ lat: 'chissà', lon: null }]);
  assert.deepEqual(r.mancanti, ['Susegana']);
});

// Dopo la @ Google scrive dov'era centrata la mappa: non è il posto, ma gli
// sta vicino. Serve a scegliere fra i tre «Bolzano» che il geocoder propone,
// invece di prendere sempre il primo e metterne uno venti chilometri in là.
test('il centro della mappa si legge dal collegamento', () => {
  assert.deepEqual(centroDelLink('https://maps.google.com/maps/dir//Bolzano/@46.49,11.35,12z'), { lat: 46.49, lon: 11.35 });
  assert.equal(centroDelLink('https://www.google.com/maps/dir/?api=1&origin=Susegana&destination=Trento'), null);
  assert.equal(centroDelLink('non è un indirizzo'), null);
});

test('fra più posti con lo stesso nome vince quello vicino al centro della mappa', async () => {
  const cerca = async () => [
    { name: 'Bolzano (provincia)', lat: 46.6559, lon: 11.2301 },
    { name: 'Bolzano', lat: 46.4983, lon: 11.3548 },
  ];
  const r = await completaPunti([{ name: 'Bolzano' }], cerca, { lat: 46.49, lon: 11.35 });
  assert.equal(r.punti[0].lat, 46.4983);
});

test('senza un centro da cui giudicare si prende il primo che il geocoder propone', async () => {
  const cerca = async () => [{ lat: 1, lon: 1 }, { lat: 2, lon: 2 }];
  const r = await completaPunti([{ name: 'Qualunque' }], cerca);
  assert.equal(r.punti[0].lat, 1);
});
