// I giorni teorici che diventano date. Si fissa la partenza una volta, e
// «giorno 3» diventa un giorno vero. Sbagliare di uno qui vuol dire spostare
// tutto il viaggio, e non accorgersene.
import test from 'node:test';
import assert from 'node:assert/strict';
import { dataDelGiorno, giornoDellaData } from '../src/lib/giorni.js';

test('il giorno 1 è il giorno della partenza', () => {
  assert.equal(dataDelGiorno('2027-06-20', 1), '2027-06-20');
});

test('il giorno 3 è due giorni dopo, non tre', () => {
  assert.equal(dataDelGiorno('2027-06-20', 3), '2027-06-22');
});

test('passa i mesi e passa gli anni', () => {
  assert.equal(dataDelGiorno('2027-06-29', 4), '2027-07-02');
  assert.equal(dataDelGiorno('2027-12-30', 5), '2028-01-03');
});

test('il 29 febbraio esiste negli anni che ce l’hanno', () => {
  assert.equal(dataDelGiorno('2028-02-28', 2), '2028-02-29');
  assert.equal(dataDelGiorno('2027-02-28', 2), '2027-03-01');
});

test('non sposta niente di un’ora: la data è la stessa a qualunque fuso', () => {
  assert.equal(dataDelGiorno('2027-03-28', 2), '2027-03-29'); // la notte dell’ora legale
  assert.equal(dataDelGiorno('2027-10-31', 2), '2027-11-01');
});

test('senza un giorno, o con un giorno che non è un giorno, non c’è data', () => {
  for (const g of [null, undefined, 0, -3, 'domani', NaN, 1.5]) assert.equal(dataDelGiorno('2027-06-20', g), null, `giorno ${g}`);
});

test('senza una partenza vera non si inventa una data', () => {
  for (const p of [null, '', 'quando sarà', '2027-13-45']) assert.equal(dataDelGiorno(p, 2), null, `partenza ${p}`);
});

test('accetta anche una data che arriva come oggetto, come la dà il database', () => {
  assert.equal(dataDelGiorno(new Date(Date.UTC(2027, 5, 20)), 2), '2027-06-21');
});

test('e sa tornare indietro: da una data al suo numero di giorno', () => {
  assert.equal(giornoDellaData('2027-06-20', '2027-06-22'), 3);
  assert.equal(giornoDellaData('2027-06-20', '2027-06-20'), 1);
  assert.equal(giornoDellaData('2027-06-20', '2027-06-19'), null); // prima della partenza
  assert.equal(giornoDellaData('2027-06-20', null), null);
});
