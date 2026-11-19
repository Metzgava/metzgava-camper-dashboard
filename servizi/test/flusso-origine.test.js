// Da dove viene il 220 che carica le Ective.
//
// Domanda del proprietario, e giusta: «come faccio a capire quando entra da
// colonnina?». Il ramo si chiamava «Dalla 220» e taceva su chi quella 220 la
// facesse -- e sono due situazioni opposte.
//
// Dalla **colonnina**: energia che arriva da fuori, non costa niente al
// camper, e intanto si carica anche la Bluetti.
// Dalla **Bluetti**: non e' energia nuova, e' energia spostata da una batteria
// all'altra, e per strada se ne perde un quinto fra inverter e caricatore.
//
// La distinzione non richiede nessun dato nuovo: e' gia' scritta in
// `travaso.js` come «eroga e non riceve», con le sue soglie motivate -- sotto
// i 150 W l'uscita 220 non e' un apparecchio che lavora, sopra i 50 W in
// ingresso c'e' la rete e la corrente la paga la colonnina.
//
// Una cosa non cambia: la **quantita'** resta una sottrazione. Sapere da dove
// viene non la rende misurata, e il bollino della stima resta.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ramiDellaCarica } from '../src/lib/flusso.js';

const fonti = { valore: 210, sole_w: 6, motore_w: 0, rete_w: 204, base: 'misurato' };
const ramo220 = fuori => fuori.rami.find(r => r.id === 'rete');

test('la Bluetti riceve dalla rete: la 220 viene dalla colonnina', () => {
  const r = ramo220(ramiDellaCarica(fonti, { bluetti: { rete_w: 900, uscita_ac_w: 0 } }));
  assert.equal(r.origine, 'colonnina');
  assert.match(r.nome, /colonnina/i);
  assert.notEqual(r.travaso, true);
});

test('la Bluetti eroga e non riceve: e’ travaso', () => {
  const r = ramo220(ramiDellaCarica(fonti, { bluetti: { rete_w: 0, uscita_ac_w: 420 } }));
  assert.equal(r.origine, 'bluetti');
  assert.equal(r.travaso, true);
  assert.match(r.nome, /bluetti/i);
});

test('la Bluetti ferma: non si attribuisce niente', () => {
  // Se la 220 risulta comunque, e' il residuo del calcolo per differenza: va
  // guardato con sospetto, non battezzato.
  const r = ramo220(ramiDellaCarica(fonti, { bluetti: { rete_w: 0, uscita_ac_w: 0 } }));
  assert.equal(r.origine, null);
  assert.match(r.nome, /220/);
});

test('un’uscita sotto soglia non e’ un apparecchio che lavora', () => {
  // Una spia, un caricatore da telefono. Non e' la prova che il caricabatterie
  // del camper stia girando sulla Bluetti.
  const r = ramo220(ramiDellaCarica(fonti, { bluetti: { rete_w: 0, uscita_ac_w: 20 } }));
  assert.equal(r.origine, null);
});

test('con la lettura della Bluetti vecchia non si attribuisce', () => {
  // La lezione del 19/11: una lettura di sei minuti fa, messa accanto a watt
  // freschi, aveva gia' prodotto un «esce 0, arriva 201». Battezzare la
  // sorgente su un dato vecchio sarebbe lo stesso errore, travestito meglio.
  const r = ramo220(ramiDellaCarica(fonti,
    { bluetti: { rete_w: 900, uscita_ac_w: 0, vecchia: true } }));
  assert.equal(r.origine, null);
  assert.match(r.nome, /220/);
});

test('senza Bluetti il ramo resta quello di prima', () => {
  assert.match(ramo220(ramiDellaCarica(fonti)).nome, /220/);
  assert.equal(ramo220(ramiDellaCarica(fonti, {})).origine, null);
});

test('sapere da dove viene non lo rende misurato', () => {
  // La quantita' resta il totale meno sole e alternatore: una sottrazione.
  for (const b of [{ rete_w: 900, uscita_ac_w: 0 }, { rete_w: 0, uscita_ac_w: 420 }]) {
    assert.equal(ramo220(ramiDellaCarica(fonti, { bluetti: b })).certezza, 'dedotto');
  }
});
