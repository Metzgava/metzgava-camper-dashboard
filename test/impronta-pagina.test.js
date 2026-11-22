// Il numero di versione dei file di pagina non si scrive piu' a mano.
//
// E' la seconda volta che questo difetto morde il proprietario. Il 18/11/2026
// nell'app dei servizi aveva pubblicato e continuava a vedere la versione di
// prima; li' l'abbiamo chiuso calcolando l'**impronta** dei file. Il
// 22/11/2026, qui, stessa cosa: «ridisegna senza chiedermi da dove sono
// passato» -- il tasto nuovo c'era sul server e lui aveva ancora quello
// vecchio in mano.
//
// `index.html` chiamava `app.js?v=125`, e quel numero andava alzato a mano a
// ogni modifica. Dimenticarlo non da' nessun segnale: la pubblicazione
// riesce, il server e' aggiornato, e la pagina mostra il file di prima.
//
// Il modulo e' lo **stesso** dell'app dei servizi, copiato. Una prova tiene le
// due copie uguali: una regola che vive in due posti con due forme e' il modo
// di farle divergere senza accorgersene.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { conImpronta } from '../src/lib/pagina.js';

const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const server = readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');

test('il numero scritto a mano diventa l’impronta dei file', () => {
  const fuori = conImpronta('<script src="app.js?v=125"></script>', 'abc1234567');
  assert.ok(fuori.includes('app.js?v=abc1234567'));
  assert.ok(!fuori.includes('v=125'));
});

test('un indirizzo di qualcun altro non si tocca', () => {
  const esterno = '<script src="https://unpkg.com/leaflet/leaflet.js"></script>';
  assert.equal(conImpronta(esterno, 'abc1234567'), esterno);
});

test('senza impronta la pagina resta quella che era', () => {
  const h = '<script src="app.js?v=125"></script>';
  assert.equal(conImpronta(h, null), h);
});

test('il server calcola l’impronta e serve la pagina con quella', () => {
  assert.match(server, /conImpronta/, 'il server non mette l’impronta nella pagina');
  assert.match(server, /createHash/, 'il server non calcola nessuna impronta');
  assert.match(server, /versione: IMPRONTA/,
    'l’impronta non esce da /api/health: la pagina non puo’ accorgersi di essere vecchia');
});

test('le due copie del modulo sono identiche', () => {
  const qui = readFileSync(new URL('../src/lib/pagina.js', import.meta.url), 'utf8');
  const la = readFileSync(new URL('../servizi/src/lib/pagina.js', import.meta.url), 'utf8');
  assert.equal(qui, la, 'le due copie sono divergute: una regola, due forme');
});

test('la pagina si accorge da sola quando non e’ piu’ quella del server', () => {
  const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.match(app, /api\/health/,
    'nessuno chiede al server quale versione sta servendo');
  assert.match(app, /versione nuova/i,
    'la pagina non ha niente da dire a chi sta guardando una copia vecchia');
});
