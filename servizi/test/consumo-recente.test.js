// Il consumo recente: la media su cui si calcolano le durate.
//
// Disegno: docs/superpowers/specs/2026-11-21-durata-consumo-vivo-design.md
//
// **Un istante non e' un consumo.** Aprire la pagina mentre parte il
// compressore del frigo dava tre ore di autonomia; un minuto dopo, a frigo
// spento, quaranta. Nessuno dei due e' sbagliato come misura e tutti e due
// sono inutili come durata: la domanda «quanto duro» non si risponde con la
// potenza di un secondo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { consumoRecente, CAMPIONI_MINIMI, COPERTURA_MINIMA } from '../src/lib/consumo.js';

const BATT = ['NWJ1', 'NWJ2'];
const A = new Date('2026-11-21T20:00:00Z');
const prima = minuti => new Date(A.getTime() - minuti * 60000).toISOString();
const finestra = minuti => ({ da: prima(minuti), a: A.toISOString(), batterie: BATT });

// Una lettura del pacco: `watt` per batteria, col segno della scatoletta --
// **positivo quando la batteria carica**, come in agente.py.
const riga = (minuti, watt, chi) => ({
  quando: prima(minuti), apparecchio: chi, grandezza: 'watt', valore: watt,
});
const letture = (minuti, wattPacco) =>
  BATT.map(b => riga(minuti, -wattPacco / BATT.length, b));

// Le finestre si costruiscono contando dall'**inizio** della finestra e non
// dalla fine, e si tengono dentro i bordi.
//
// Prima stesura: contava i minuti indietro da `A` e metteva una lettura anche
// a `m = 0`. Due guai, entrambi miei e non del codice. La lettura a `m = 0`
// cade **fuori** finestra, perche' l'ultimo intervallo e' aperto a destra. E
// lo spartiacque fra scarica e carica cadeva in mezzo a un intervallo da
// cinque minuti, che finiva mezzo e mezzo e dava una media a meta' strada:
// l'una e l'altra insieme facevano 13,3 W invece di 15.
//
// La prova diceva il vero e il conto era giusto: era la giornata inventata a
// non essere quella che la prova raccontava.
const dallInizio = (pos, wattPacco) => letture(60 - pos, wattPacco);

// Un'ora: la prima mezz'ora in scarica a `esce` watt, la seconda in carica.
// Lo spartiacque a trenta minuti cade su un confine di intervallo, quindi
// nessun intervallo e' mezzo e mezzo.
const mezzaEMezza = esce => {
  const fuori = [];
  for (let pos = 1; pos < 60; pos += 2) {
    fuori.push(...dallInizio(pos, pos < 30 ? esce : -esce));
  }
  return fuori;
};

// Letture nei `minuti` piu' recenti, sempre allo stesso regime, e tutte
// dentro i bordi.
const tranquillo = (esce, minuti = 60) => {
  const fuori = [];
  for (let m = minuti - 1; m >= 1; m -= 2) fuori.push(...letture(m, esce));
  return fuori;
};

test('la media tiene solo quel che esce, e lo tiene PRIMA di mediare', () => {
  // Mediare il netto **con il segno** darebbe zero, cioe' autonomia infinita
  // su un pacco che si sta svuotando. E' il difetto trovato il 21/11/2026 sui
  // grafici della Storia, dove novanta giorni davano 0,35 kWh e trenta 5,44:
  // la scarica della notte si annullava con la carica del giorno.
  const r = consumoRecente(mezzaEMezza(30), finestra(60));
  assert.ok(Math.abs(r.watt - 15) < 0.5, `watt = ${r.watt}`);
});

test('si divide per la finestra intera, non per i soli intervalli in scarica', () => {
  // Quindici e non trenta. E' un fattore due, e sbagliarlo va nel verso
  // ottimista: un'autonomia doppia. «Quanto duro» vuol dire *a che velocita'
  // ho perso carica*, e in un'ora ne ho persa mezz'ora a trenta watt.
  const r = consumoRecente(mezzaEMezza(30), finestra(60));
  assert.ok(r.watt < 20, `watt = ${r.watt}`);
});

test('la frase puo’ dire quanto della finestra era in carica', () => {
  // Serve perche' a mezzogiorno col sole la media e' quasi nulla e
  // l'autonomia sembra di settimane. Il numero non si cambia: si dice da
  // dove viene.
  const r = consumoRecente(mezzaEMezza(30), finestra(60));
  assert.ok(Math.abs(r.in_carica_minuti - 30) <= 5, `in carica = ${r.in_carica_minuti}`);
});

test('un intervallo in equilibrio non si conta «in carica»', () => {
  // Zero netto non e' carica: il taglio a zero li rende identici, ed e' per
  // questo che `usciteDelPacco` torna anche i netti col segno.
  const r = consumoRecente(tranquillo(0), finestra(60));
  assert.equal(r.in_carica_minuti, 0);
});

test('pochi campioni non fanno una media', () => {
  const r = consumoRecente(letture(1, 30), finestra(120));
  assert.equal(r.watt, null);
  assert.ok(r.campioni < CAMPIONI_MINIMI, `campioni = ${r.campioni}`);
});

test('un buco nella finestra non fa una media: la copertura conta', () => {
  // Campioni fitti in venti minuti su due ore: **tanti campioni, finestra
  // scoperta**. Una media di venti minuti spacciata per due ore e' una
  // durata inventata, e il conteggio dei campioni da solo non lo vede.
  const r = consumoRecente(tranquillo(30, 20), finestra(120));
  assert.ok(r.campioni >= CAMPIONI_MINIMI, `campioni = ${r.campioni}`);
  assert.ok(r.copertura < COPERTURA_MINIMA, `copertura = ${r.copertura}`);
  assert.equal(r.watt, null);
});

test('un valore assurdo in archivio non avvelena la media', () => {
  // `ingresso.js` setaccia quel che **entra** da oggi; l'archivio ha anche un
  // passato, scritto da versioni precedenti della scatoletta. Una riga a
  // -5000 W sposta la media, e con lei l'autonomia.
  const r = consumoRecente([...tranquillo(30), riga(5, -5000, BATT[0])], finestra(60));
  assert.ok(Math.abs(r.watt - 30) < 1, `watt = ${r.watt}`);
});

test('se ha parlato una batteria sola, quell’intervallo e’ un buco', () => {
  // Mezzo pacco spacciato per il pacco intero e' un consumo dimezzato, cioe'
  // un'autonomia doppia.
  const solaUna = tranquillo(30).filter(r => r.apparecchio === BATT[0]);
  const r = consumoRecente(solaUna, finestra(60));
  assert.equal(r.watt, null);
  assert.equal(r.copertura, 0);
});

test('senza righe la media e’ null, non zero', () => {
  const r = consumoRecente([], finestra(120));
  assert.equal(r.watt, null);
  assert.equal(r.campioni, 0);
});

test('la finestra si dice, perche’ la frase la deve scrivere', () => {
  const r = consumoRecente(tranquillo(30), finestra(60));
  assert.equal(r.finestra_minuti, 60);
});

test('chi non e’ del pacco non entra nella media', () => {
  // `watt` e' una grandezza di tutti: lo SmartSolar e la Bluetti ne mandano
  // anche loro, e contarli dentro il pacco sarebbe un numero falso.
  const estranei = tranquillo(30).map(r => ({ ...r, apparecchio: 'SmartSolar' }));
  const r = consumoRecente(estranei, finestra(60));
  assert.equal(r.watt, null);
});
