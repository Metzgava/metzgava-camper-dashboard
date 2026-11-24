// Quante volte il cloud di Bluetti ci lascia a piedi, e per quanto.
//
// Il 19/11/2026 e' stato in avaria **due ore**: il quadrante mostrava una
// carica di novanta minuti prima. E' l'argomento piu' forte per leggere la
// Bluetti via Bluetooth invece che dal loro server -- ma e' **un** episodio.
// Se capita una volta ogni sei mesi il guadagno e' modesto; se capita ogni due
// settimane e' la prima cosa da fare. Quel numero non ce l'abbiamo, e senza
// misurarlo la scelta sarebbe un gusto, non una decisione.
//
// Si segnano i **passaggi**, non i tentativi: un evento quando cade e uno
// quando torna, con quanto e' durata. Scrivere una riga a ogni lettura fallita
// riempirebbe la tabella di rumore e non direbbe comunque la durata, che e' la
// cosa che conta.
import test from 'node:test';
import assert from 'node:assert/strict';
import { passaggioCloud } from '../src/lib/avarie.js';

const T0 = new Date('2026-11-19T08:00:00Z').getTime();
const min = n => T0 + n * 60_000;

test('la prima lettura andata bene non e’ una notizia', () => {
  assert.equal(passaggioCloud(null, true, T0), null);
});

test('la prima che fallisce apre un’avaria', () => {
  const p = passaggioCloud(null, false, T0, 'timeout');
  assert.equal(p.tipo, 'cloud-giu');
  assert.match(p.testo, /timeout/);
});

test('mentre resta giu’ non si riscrive niente', () => {
  // Una riga per ogni tentativo fallito sarebbe rumore: l'avaria e' una sola.
  const giu = { da: T0, ok: false };
  assert.equal(passaggioCloud(giu, false, min(5)), null);
  assert.equal(passaggioCloud(giu, false, min(90)), null);
});

test('quando torna si segna quanto e’ durata', () => {
  const p = passaggioCloud({ da: T0, ok: false }, true, min(120));
  assert.equal(p.tipo, 'cloud-su');
  assert.match(p.testo, /2 ore|120 minuti/i, `testo: ${p.testo}`);
  assert.equal(p.minuti, 120);
});

test('mentre va non si riscrive niente', () => {
  assert.equal(passaggioCloud({ da: T0, ok: true }, true, min(30)), null);
});

test('lo stato nuovo viaggia col passaggio, per non tenerlo altrove', () => {
  const p = passaggioCloud(null, false, T0, 'codice 805');
  assert.equal(p.stato.ok, false);
  assert.equal(p.stato.da, T0);
});

test('un’avaria lunga si racconta in ore, una corta in minuti', () => {
  // «135 minuti» si legge peggio di «2 ore e un quarto» quando si scorre
  // l'elenco degli eventi per capire quanto spesso succede.
  assert.match(passaggioCloud({ da: T0, ok: false }, true, min(7)).testo, /7 minuti/);
  assert.match(passaggioCloud({ da: T0, ok: false }, true, min(180)).testo, /3 ore/);
});

// ---------------------------------------------------------------------------
// Il cablaggio: la regola deve girare sul serio, non stare in un cassetto
// ---------------------------------------------------------------------------
import { readFileSync } from 'node:fs';

test('la lettura periodica segna i passaggi negli eventi', () => {
  const s = readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');
  const i = s.indexOf('const leggi = async');
  assert.ok(i > 0, 'la lettura periodica non si trova piu’');
  const blocco = s.slice(i, i + 1200);
  assert.match(blocco, /passaggioCloud\(/,
    'le avarie del cloud non si segnano: fra un mese non sapremo quante sono state');
  assert.match(blocco, /segna\(/, 'il passaggio si calcola ma non si scrive da nessuna parte');
});
