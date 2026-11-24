// Il bollino del tracciato vero si ritira quando la riga viene rifatta.
//
// Disegno: docs/superpowers/specs/2026-11-24-tracciati-veri-design.md
//
// Trovato nella revisione del ramo, 24/11/2026. `tracciato_vero` e'
// un'affermazione **sulla riga**: «questa e' la traccia registrata». Quattro
// rotte sostituiscono la riga con una strada calcolata e nessuna lo
// spegneva, quindi bastavano due tocchi -- carica i tracciati, poi
// «Ridisegna» -- per avere una supposizione disegnata continua, senza
// puntinato, con sopra scritto «Chilometri, orari e strada veri dal
// tracker». E' l'anti-obiettivo numero uno del disegno, ed e' la direzione
// rassicurante dell'errore.
//
// E' lo stesso difetto gia' chiuso una volta per i chilometri del tracker:
// il commento in `trips.js` lo racconta («le rotte che ridisegnano erano
// quattro, non tre»). Il bollino nuovo lo riapriva.
//
// La prova e' **strutturale, non su un elenco di rotte**: ogni `UPDATE legs
// SET` che scrive `geometry` deve anche dire qualcosa di `tracciato_vero`.
// Cosi' si accorge anche della quinta rotta, quella che non c'e' ancora.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const rotte = readFileSync(new URL('../src/routes/trips.js', import.meta.url), 'utf8');

// Ogni statement dall'inizio al suo `WHERE`: il pezzo che decide quali
// colonne vengono scritte.
const scritture = [...rotte.matchAll(/UPDATE legs SET[\s\S]*?WHERE/g)].map(m => m[0]);

test('ci sono statement che scrivono la geometria, altrimenti la prova non guarda niente', () => {
  const conGeometria = scritture.filter(s => /geometry\s*=/.test(s));
  assert.ok(conGeometria.length >= 4,
    `attesi almeno 4 statement che scrivono la geometria, trovati ${conGeometria.length}`);
});

test('chi riscrive la riga ritira il bollino del tracciato vero', () => {
  for (const s of scritture.filter(x => /geometry\s*=/.test(x))) {
    const breve = s.replace(/\s+/g, ' ').slice(0, 90);
    assert.match(s, /tracciato_vero/,
      `questo statement sostituisce la riga senza dire niente del bollino: ${breve}…`);
  }
});

test('chi riscrive la riga butta anche lo scarto, che era misurato su un’altra riga', () => {
  for (const s of scritture.filter(x => /geometry\s*=/.test(x))) {
    const breve = s.replace(/\s+/g, ' ').slice(0, 90);
    assert.match(s, /scarto_ricostruzione_km/,
      `lo scarto resta attaccato a una riga che non c’e’ piu’: ${breve}…`);
  }
});

// E in pagina: non si invita a fare quel che non va fatto.
//
// **Le condizioni si estraggono dal sorgente e si eseguono.** Una prova che
// cerca la parola `tracciato_vero` dentro una finestra di caratteri passa
// anche su una condizione rovesciata, e questo progetto ci e' gia' cascato.
// Qui si prende il testo della guardia com'e' scritto nella pagina, si
// costruisce la funzione e le si danno dei valori: una condizione al
// contrario fallisce.
const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');

const guardia = nome => {
  const m = app.match(new RegExp(`const ${nome} = ([^;]+);`));
  assert.ok(m, `la guardia ${nome} non si trova piu’ nella pagina`);
  // Le guardie della pagina si appoggiano l’una all’altra: si forniscono
  // dall’esterno, cosi’ si prova una regola per volta.
  return new Function('inCamper', 'daCarlock', 'lungaQuanto', `return (${m[1]});`)(
    l => String(l?.mezzo || 'camper') === 'camper',
    l => l?.source === 'carlock' && String(l?.mezzo || 'camper') === 'camper',
    g => (g || []).length * 10);
};

const tappaVera = { source: 'carlock', tracciato_vero: true, distance_km: 187 };
const rigaDellaTappa = () => {
  const i = app.indexOf('const legRow =');
  const j = app.indexOf('${rigaCosti(l)}', i);
  assert.ok(i > 0 && j > i, 'il modello della riga della tappa non si trova piu\u2019');
  return app.slice(i, j);
};
const tappaDedotta = { source: 'carlock', tracciato_vero: false, distance_km: 187 };

test('«strada dedotta» e’ falso su un tracciato vero, e vero su una ricostruzione', () => {
  const stradaDedotta = guardia('stradaDedotta');
  assert.equal(!!stradaDedotta(tappaVera), false,
    'il puntinato resta sulla strada misurata: una supposizione dichiarata dove non c’e’');
  assert.equal(!!stradaDedotta(tappaDedotta), true,
    'la strada ricostruita non si segnala piu’ come ricostruita');
  assert.equal(!!stradaDedotta({ source: 'manual' }), false,
    'una tappa scritta a mano non viene dal tracker');
});

test('il confronto coi chilometri tace su una strada vera e parla su una ricostruzione', () => {
  const stradaSospetta = guardia('stradaSospetta');
  // `lungaQuanto` qui vale 10 km per punto: 60 punti sono 600 km contro 187.
  const riga = { geometry: new Array(60).fill([45, 11]) };
  assert.equal(!!stradaSospetta({ ...tappaVera, ...riga }), false,
    'su una strada misurata si consiglia ancora di ridisegnare');
  assert.equal(!!stradaSospetta({ ...tappaDedotta, ...riga }), true,
    'una ricostruzione lunghissima non si segnala piu’');
});

test('su una strada vera il tasto «Ridisegna» non compare', () => {
  const i = app.indexOf('data-ridisegna=');
  assert.ok(i > 0, 'il tasto Ridisegna non si trova piu’');
  // La condizione che lo accende sta appena prima, nello stesso ramo. Non si
  // cerca la parola `tracciato_vero`: si pretende che il tasto stia dietro la
  // guardia provata qui sopra, cosi’ le due cose non possono divergere.
  const condizione = app.slice(Math.max(0, i - 220), i);
  assert.match(condizione, /stradaDedotta\(l\)/,
    'si consiglia ancora di sostituire una strada misurata con una supposizione');
});

// ---------------------------------------------------------------------------
// La traccia vera che misura troppo
// ---------------------------------------------------------------------------
//
// Zittire `stradaSospetta` sulle strade vere era giusto -- non si consiglia di
// sostituire una misura con una supposizione -- ma ha portato via l'unica
// rete che c'era: il confronto fra la lunghezza della riga e i chilometri del
// tracker. La revisione del 24/11/2026 l'ha notato.
//
// Il caso che serve coprire: la finestra di una tappa si prende un tragitto in
// piu' -- uno che nessun'altra tappa reclama, quindi non ambiguo, quindi
// attaccato -- e la cucitura lo unisce al resto con un segmento dritto. La
// riga diventa molto piu' lunga dei chilometri veri e sulla mappa passa dove
// non si e' passati, con sopra scritto che e' la traccia registrata.
//
// Qui il consiglio e' un altro: non «ridisegna», ma «guarda gli orari di
// questa tappa». La soglia e' larga perche' il campionamento **accorcia**
// (taglia le curve): se la riga misura molto di piu', c'e' dentro roba che non
// e' di questa tappa.
test('su una traccia vera, una riga molto piu’ lunga dei chilometri veri si segnala', () => {
  const tracciaPiuLunga = guardia('tracciaPiuLunga');
  // `lungaQuanto` qui vale 10 km per punto.
  const lunga = { geometry: new Array(60).fill([45, 11]) };   // 600 km
  const giusta = { geometry: new Array(19).fill([45, 11]) };  // 190 km
  assert.equal(!!tracciaPiuLunga({ ...tappaVera, ...lunga }), true,
    'la traccia si e’ presa un tragitto che non e’ di questa tappa e nessuno lo dice');
  assert.equal(!!tracciaPiuLunga({ ...tappaVera, ...giusta }), false,
    'si grida su una traccia che combacia: il campionamento accorcia sempre un po’');
  assert.equal(!!tracciaPiuLunga({ ...tappaDedotta, ...lunga }), false,
    'sulla ricostruzione parla gia’ `stradaSospetta`: due avvisi per lo stesso sospetto');
});

test('la riga della tappa dice quando la traccia vera misura troppo', () => {
  assert.match(rigaDellaTappa(), /tracciaPiuLunga\(l\)/,
    'il controllo esiste ma non compare in pagina: una rete che non si vede non e’ una rete');
});
