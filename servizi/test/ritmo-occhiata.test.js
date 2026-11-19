// Il passo che il server chiede alla scatoletta: svelto mentre qualcuno
// guarda, lento appena smette.
//
// Disegno: docs/superpowers/specs/2026-11-19-dal-vivo-design.md
//
// La scatoletta sta dietro il router del camper e nessuno puo' bussarle da
// fuori: deve chiedere lei. Quindi il server ricorda l'istante dell'ultima
// occhiata, e a chi lo interroga risponde quale passo tenere.
//
// **Si sbaglia sempre verso il lento.** E' la regola che governa tutti i casi
// strani qui sotto. Un guasto, un orologio sballato, una data assurda non
// devono lasciare la radio della scatoletta al massimo mentre il proprietario
// e' a mille chilometri: il massimo costa corrente alla batteria servizi, e
// nessuno se ne accorgerebbe finche' non resta al buio.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ritmoRichiesto, FINESTRA_MS, SVELTO_S } from '../src/lib/occhiata.js';

const ORA = 1_700_000_000_000;

test('chi guarda adesso ottiene il passo svelto', () => {
  const r = ritmoRichiesto(ORA, ORA);
  assert.equal(r.guarda, true);
  assert.equal(r.secondi, SVELTO_S);
});

test('appena dentro la finestra si resta svelti', () => {
  assert.equal(ritmoRichiesto(ORA - FINESTRA_MS + 1000, ORA).guarda, true);
});

test('appena fuori dalla finestra si torna lenti, senza che nessuno chiuda niente', () => {
  // Il caso vero: il telefono va in tasca, la pagina smette di chiedere, e
  // nessuno dice al server «ho finito». Il silenzio basta.
  const r = ritmoRichiesto(ORA - FINESTRA_MS - 1, ORA);
  assert.equal(r.guarda, false);
  assert.equal(r.secondi, null, 'lento vuol dire: tieni il tuo passo, non te ne impongo uno');
});

test('se nessuno ha mai guardato, lento', () => {
  assert.equal(ritmoRichiesto(null, ORA).guarda, false);
  assert.equal(ritmoRichiesto(undefined, ORA).guarda, false);
});

test('una data assurda nel futuro non tiene la radio al massimo per sempre', () => {
  // Un orologio sballato non deve costare corrente per giorni. Piccoli scarti
  // fra due orologi sono normali e si tollerano; un anno nel futuro no.
  assert.equal(ritmoRichiesto(ORA + 2000, ORA).guarda, true, 'due secondi di scarto sono normali');
  assert.equal(ritmoRichiesto(ORA + 365 * 24 * 3600_000, ORA).guarda, false);
});

test('un valore che non e’ una data vale come nessuna occhiata', () => {
  assert.equal(ritmoRichiesto('ieri', ORA).guarda, false);
  assert.equal(ritmoRichiesto(NaN, ORA).guarda, false);
});

test('il passo svelto non e’ piu’ svelto di quanto un giro possa durare', () => {
  // Un giro svelto ascolta gli annunci: dodici secondi di ascolto sarebbero
  // piu' del passo stesso, e i giri si accavallerebbero. Dieci e' il minimo
  // ragionevole, e la scatoletta accorcia l'ascolto di conseguenza.
  assert.ok(SVELTO_S >= 5, 'sotto i cinque secondi i giri si pestano i piedi');
});
