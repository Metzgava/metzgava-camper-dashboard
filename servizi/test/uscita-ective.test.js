// Quanto esce dalle Ective, e per quanto.
//
// Il conto che esisteva, `sommaPos`, tiene solo le correnti positive: e' nato
// per la figura «Cosa carica le batterie», e del verso opposto -- cioe' del
// consumo del camper -- non sapeva niente. Qui si misura quel verso.
//
// Disegno: docs/superpowers/specs/2026-11-20-uscita-ective-design.md
import { test } from 'node:test';
import assert from 'node:assert/strict';
import './aiuto/archivio-finto.js';

const { uscitaEctive, etaEctiveMinuti } = await import('../src/lib/conti.js');

// Una batteria come la manda la scatoletta. `celle_mv` e' quel che la fa
// riconoscere come batteria in tutto il progetto.
const batt = (volt, ampere, extra = {}) => ({
  apparecchio: extra.nome || 'NWJ1', quando: extra.quando,
  dati: { volt, ampere, celle_mv: [3200, 3201, 3199, 3200], ...extra.dati },
});

test('due batterie che si scaricano: i watt in uscita sono la somma', () => {
  const u = uscitaEctive([batt(12.8, -8), batt(12.9, -3)]);
  // 12,8x8 = 102,4 e 12,9x3 = 38,7
  assert.ok(Math.abs(u.watt - 141.1) < 0.01, `watt = ${u.watt}`);
  assert.ok(Math.abs(u.ampere - 11) < 0.01, `ampere = ${u.ampere}`);
});

test('una in carica e una in scarica: il netto, non la somma delle negative', () => {
  // E' la decisione del disegno. +3 A da una parte e -25 A dall'altra vogliono
  // dire che dal pacco escono 22 A: quei 3 A si sono solo spostati fra le due
  // batterie, e contarli come consumo del camper sarebbe un numero inventato.
  const u = uscitaEctive([batt(12.8, 3), batt(12.8, -25)]);
  assert.ok(Math.abs(u.ampere - 22) < 0.01, `ampere = ${u.ampere}`);
  assert.ok(Math.abs(u.watt - 281.6) < 0.01, `watt = ${u.watt}`);
});

test('tutte in carica: niente esce, e «niente» non e’ «non so»', () => {
  // Zero, non null. E' la regola della casa, rovesciata: qui un null direbbe
  // «non lo so» mentre invece lo si sa benissimo.
  const u = uscitaEctive([batt(12.8, 12), batt(12.8, 9)]);
  assert.equal(u.watt, 0);
  assert.equal(u.ampere, 0);
});

test('nessuna lettura: null, che e’ l’unico caso di «non so»', () => {
  assert.equal(uscitaEctive([]).watt, null);
  assert.equal(uscitaEctive(null).watt, null);
  assert.equal(uscitaEctive([]).ore, null);
});

test('una riga senza volt o senza ampere non conta, e si sa quante hanno parlato', () => {
  // Mezzo pacco spacciato per il pacco intero e' un consumo dimezzato, cioe'
  // un'autonomia doppia: l'errore ottimista, il solo che fa restare fermi una
  // notte in piu' contando su ore che non ci sono.
  const u = uscitaEctive([batt(12.8, -10), batt(null, null)]);
  assert.equal(u.lette, 1);
  assert.equal(u.totali, 2);
  assert.ok(Math.abs(u.watt - 128) < 0.01, `watt = ${u.watt}`);
});

test('i Wh residui si fanno coi volt misurati, non con quelli di catalogo', () => {
  // La tensione vera del pacco in questo momento, non i 12,8 nominali della
  // tabella: la si sta misurando, sarebbe sciocco non usarla.
  const u = uscitaEctive([
    batt(13.2, -5, { dati: { capacita_ah: 95, carica: 50 } }),
    batt(13.0, -5, { dati: { capacita_ah: 95, carica: 100 } }),
  ]);
  // 95 x 0,50 x 13,2 = 627 e 95 x 1,00 x 13,0 = 1235
  assert.ok(Math.abs(u.residuo_wh - 1862) < 1, `residuo = ${u.residuo_wh}`);
});

test('le ore sono i Wh residui diviso i watt che escono', () => {
  const u = uscitaEctive([batt(12.8, -10, { dati: { capacita_ah: 100, carica: 50 } })]);
  // 100 x 0,50 x 12,8 = 640 Wh, a 128 W -> 5 ore
  assert.ok(Math.abs(u.ore - 5) < 0.01, `ore = ${u.ore}`);
});

test('se niente esce non c’e’ un’autonomia da dare, e nemmeno un infinito', () => {
  // Un «infinito» in pagina e' falso: appena si accende una luce finisce. Il
  // numero da dare in quel momento e' nessuno, e la spiegazione la da' il
  // conto che lo contiene.
  const u = uscitaEctive([batt(12.8, 5, { dati: { capacita_ah: 100, carica: 50 } })]);
  assert.equal(u.watt, 0);
  assert.equal(u.ore, null);
});

test('senza capacita’ o senza carica non si inventa un’autonomia', () => {
  const u = uscitaEctive([batt(12.8, -10)]);
  assert.equal(u.residuo_wh, null);
  assert.equal(u.ore, null);
  // Ma i watt si sanno: quelli non dipendono dalla capacita'.
  assert.ok(Math.abs(u.watt - 128) < 0.01);
});

test('la ripartizione dice quanto da’ ciascuna, col suo nome e col suo segno', () => {
  const u = uscitaEctive([batt(12.8, -8, { nome: 'NWJ...310' }),
                          batt(12.8, 2, { nome: 'NWJ...323' })]);
  assert.equal(u.per_batteria.length, 2);
  assert.equal(u.per_batteria[0].nome, 'NWJ...310');
  // Il segno resta quello della batteria: -8 A vuol dire che da' corrente.
  // Cambiarlo qui farebbe sparire la differenza fra le due righe, che e'
  // l'unica cosa interessante quando una carica e l'altra scarica.
  assert.ok(Math.abs(u.per_batteria[0].ampere + 8) < 0.01);
  assert.ok(Math.abs(u.per_batteria[1].ampere - 2) < 0.01);
});

test('non sono batterie le righe che non mandano le celle', () => {
  // SmartSolar e Orion XS stanno nella stessa tabella e hanno volt e ampere:
  // senza il filtro entrerebbero nel consumo del pacco.
  const solare = { apparecchio: 'SmartSolar', dati: { volt: 13.4, ampere: 6, pannelli_w: 80 } };
  assert.equal(uscitaEctive([solare]).watt, null);
  assert.equal(uscitaEctive([solare]).totali, 0);
});

test('l’eta’ e’ quella della lettura piu’ fresca, in minuti', () => {
  const ora = Date.parse('2026-11-20T15:00:00Z');
  const righe = [
    batt(12.8, -5, { quando: '2026-11-20T14:50:00Z' }),
    batt(12.8, -5, { quando: '2026-11-20T14:58:00Z' }),
  ];
  assert.ok(Math.abs(etaEctiveMinuti(righe, ora) - 2) < 0.01);
});

test('non sapere l’eta’ non e’ «vecchio»', () => {
  // La figura della carica si regola su questo: un null la lascia andare come
  // prima, uno zero la spegnerebbe per sempre.
  assert.equal(etaEctiveMinuti([]), null);
  assert.equal(etaEctiveMinuti(null), null);
  assert.equal(etaEctiveMinuti([batt(12.8, -5, { quando: null })]), null);
});

test('lo scarto fra i due istanti sommati si misura', () => {
  const u = uscitaEctive([
    batt(12.8, -5, { quando: '2026-11-20T15:00:00Z' }),
    batt(12.8, -5, { quando: '2026-11-20T14:20:00Z' }),
  ]);
  assert.ok(Math.abs(u.scarto_minuti - 40) < 0.01, `scarto = ${u.scarto_minuti}`);
});

test('una batteria sola non ha uno scarto, e non sapere non e’ «lontane»', () => {
  // Con una sola non c'e' niente da confrontare; e se a una manca la data, lo
  // scarto non si sa -- e un numero inventato qui farebbe comparire o sparire
  // un avviso a caso.
  assert.equal(uscitaEctive([batt(12.8, -5, { quando: '2026-11-20T15:00:00Z' })]).scarto_minuti, null);
  assert.equal(uscitaEctive([
    batt(12.8, -5, { quando: '2026-11-20T15:00:00Z' }),
    batt(12.8, -5, { quando: null }),
  ]).scarto_minuti, null);
});
