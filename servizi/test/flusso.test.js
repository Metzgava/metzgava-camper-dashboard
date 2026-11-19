// Lo schema di cosa carica le batterie: quali rami sono attivi, quanto spessi,
// quanto veloci. Disegno in docs/superpowers/specs/2026-11-19-flusso-carica-ective-design.md
//
// Il conto sta qui e non in `public/app.js` per due ragioni: li' non girano
// prove, e questa e' logica che va tenuta ferma. Un ramo a zero watt che si
// anima direbbe che sta entrando corrente quando non entra; e il ramo dedotto
// che perde il suo bollino direbbe misurato quel che e' una sottrazione.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ramiDellaCarica, SPESSORE, SECONDI } from '../src/lib/flusso.js';

const ramo = (fuori, id) => fuori.rami.find(r => r.id === id);

// Come arriva da conti.js quando le Ective si leggono.
const fonti = (sole, motore, rete) => ({
  valore: (sole || 0) + (motore || 0) + (rete || 0),
  sole_w: sole, motore_w: motore, rete_w: rete, base: 'misurato',
});

test('i tre rami ci sono sempre, anche quelli fermi', () => {
  // Un ramo che sparisce quando e' a zero fa credere che quella fonte non
  // esista. Esiste: non sta portando niente.
  const fuori = ramiDellaCarica(fonti(6, 0, 1));
  assert.deepEqual(fuori.rami.map(r => r.id), ['sole', 'motore', 'rete']);
});

test('un ramo a zero watt non e’ attivo', () => {
  assert.equal(ramo(ramiDellaCarica(fonti(6, 0, 1)), 'motore').attivo, false);
});

test('un ramo che porta corrente e’ attivo', () => {
  assert.equal(ramo(ramiDellaCarica(fonti(6, 0, 1)), 'sole').attivo, true);
});

test('pochi watt, se sono tutto quel che c’e’, si muovono comunque', () => {
  // Il caso del 19/11: sei watt dai pannelli sotto la pioggia. Su una scala
  // assoluta sarebbero un filo immobile; in scala sul totale sono quasi tutto,
  // e devono vedersi.
  const sole = ramo(ramiDellaCarica(fonti(6, 0, 1)), 'sole');
  assert.ok(sole.spessore > (SPESSORE.min + SPESSORE.max) / 2,
    `spessore ${sole.spessore}: sei watt su sette devono essere un ramo grosso`);
  assert.ok(sole.secondi < (SECONDI.lento + SECONDI.veloce) / 2,
    `${sole.secondi}s: sei watt su sette devono scorrere svelti`);
});

test('il ramo dalla 220 resta marcato come dedotto', () => {
  // Anche quando porta piu' corrente di tutti: non si misura, si ottiene
  // togliendo sole e alternatore dal totale, e potrebbe venire da una terza
  // fonte che non vediamo.
  const fuori = ramiDellaCarica(fonti(1, 1, 300));
  assert.equal(ramo(fuori, 'rete').certezza, 'dedotto');
  assert.equal(ramo(fuori, 'sole').certezza, 'misurato');
  assert.equal(ramo(fuori, 'motore').certezza, 'misurato');
});

test('con il totale a zero nessun ramo e’ attivo e non si divide per zero', () => {
  const fuori = ramiDellaCarica(fonti(0, 0, 0));
  assert.equal(fuori.totale, 0);
  assert.equal(fuori.rami.filter(r => r.attivo).length, 0);
  for (const r of fuori.rami) {
    assert.ok(Number.isFinite(r.spessore), `spessore ${r.spessore}`);
    assert.equal(r.secondi, null);
  }
});

test('un valore assente non diventa zero', () => {
  // Prima regola del progetto. Un ramo di cui non si sa niente non e' un ramo
  // a zero: va disegnato diverso e senza numero.
  const fuori = ramiDellaCarica({ valore: 7, sole_w: 7, motore_w: null, rete_w: 0 });
  const motore = ramo(fuori, 'motore');
  assert.equal(motore.watt, null);
  assert.equal(motore.ignoto, true);
  assert.equal(motore.attivo, false);
  assert.notEqual(ramo(fuori, 'rete').ignoto, true);
});

test('senza letture delle Ective non c’e’ niente da disegnare', () => {
  // E' il `manca()` di conti.js: la figura non si disegna affatto, e la pagina
  // mostra la spiegazione di cosa manca.
  assert.equal(ramiDellaCarica({ valore: null }), null);
  assert.equal(ramiDellaCarica(null), null);
  assert.equal(ramiDellaCarica(undefined), null);
});

test('spessore e velocita’ restano dentro i limiti con numeri assurdi', () => {
  // Una somma delle parti maggiore del totale e' possibile: il totale e'
  // misurato sulle batterie, le parti su apparecchi diversi, e i tre istanti
  // non coincidono. Non deve uscirne un ramo da trenta pixel.
  for (const f of [fonti(1e6, 0, 0), { valore: 1, sole_w: 500, motore_w: 500, rete_w: 0 },
                   { valore: -5, sole_w: -5, motore_w: 0, rete_w: 0 }]) {
    for (const r of (ramiDellaCarica(f)?.rami || [])) {
      assert.ok(r.spessore >= SPESSORE.min && r.spessore <= SPESSORE.max,
        `spessore fuori scala: ${r.spessore}`);
      if (r.secondi != null) {
        assert.ok(r.secondi >= SECONDI.veloce && r.secondi <= SECONDI.lento,
          `velocita' fuori scala: ${r.secondi}`);
      }
    }
  }
});

test('una corrente negativa non e’ una carica', () => {
  // Le Ective che si scaricano: il verso e' l'altro, e questa figura mostra
  // solo quel che entra.
  const fuori = ramiDellaCarica({ valore: 0, sole_w: 0, motore_w: -12, rete_w: 0 });
  assert.equal(ramo(fuori, 'motore').attivo, false);
});

test('porta con se’ il totale, per scriverlo sul nodo delle batterie', () => {
  assert.equal(ramiDellaCarica(fonti(6, 0, 1)).totale, 7);
});
