// La pagina di prova è quella vera di park4night, salvata il 13 novembre 2026.
// Se un giorno cambiano com'è fatta, è qui che lo si scopre - e non dall'utente
// che incolla un codice e si ritrova il posto in mezzo al mare.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { estraiDaPagina } from '../src/lib/park4night.js';

const pagina = fs.readFileSync(new URL('./fixtures/p4n-277443.html', import.meta.url), 'utf8');

test('prende le coordinate dal collegamento di Google Maps', () => {
  const r = estraiDaPagina(pagina);
  assert.equal(r.lat, 45.09557);
  assert.equal(r.lon, 7.347378);
});

test('prende il nome senza il codice di avviamento postale', () => {
  assert.equal(estraiDaPagina(pagina).nome, 'Avigliana - 1 Strada Provinciale 188');
});

test('da una pagina senza coordinate non inventa niente', () => {
  assert.equal(estraiDaPagina('<html><title>park4night - 404</title></html>'), null);
});

test('da una pagina vuota o spezzata non lancia', () => {
  for (const x of ['', null, undefined, '<<<']) assert.equal(estraiDaPagina(x), null);
});
