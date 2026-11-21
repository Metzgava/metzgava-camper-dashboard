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

// --- «non entra niente» non e' «non so niente» ---
//
// `sommaPos` in conti.js torna **null**, non zero, quando nessun valore e'
// positivo. Quindi a camper fermo con le batterie piene il totale e' null
// esattamente come quando le Ective non si leggono affatto.
//
// La prima stesura di questa funzione guardava solo il totale, e la figura
// spariva nello stato piu' comune della giornata. Sono le due condizioni che
// in tutto il resto del progetto teniamo separate, e qui le avevo confuse.

test('con le letture ma senza carica la figura si disegna, ferma', () => {
  const fuori = ramiDellaCarica({ valore: null, sole_w: null, motore_w: null, rete_w: null },
                                { letture: true });
  assert.ok(fuori, 'la figura deve esserci: sparire direbbe «non lo so»');
  assert.equal(fuori.totale, 0);
  assert.equal(fuori.rami.filter(r => r.attivo).length, 0);
});

test('senza letture non si disegna niente, come prima', () => {
  assert.equal(ramiDellaCarica({ valore: null }, { letture: false }), null);
  assert.equal(ramiDellaCarica({ valore: null }), null);
});

test('una fonte che produce mentre nelle batterie non entra niente si vede', () => {
  // Il caso vero del 19/11: i pannelli davano sei watt e le Ective non ne
  // prendevano. Quella corrente non sparisce: va ai consumi del camper. Il
  // numero della fonte resta, il ramo no.
  const fuori = ramiDellaCarica({ valore: null, sole_w: 6, motore_w: 0, rete_w: null },
                                { letture: true });
  const sole = fuori.rami.find(r => r.id === 'sole');
  assert.equal(sole.watt, 6, 'il sole produce sei watt e va scritto');
  assert.equal(sole.attivo, false, 'ma nelle batterie non sta entrando');
  // La pagina deve poter dire dove va. Senza la carica e senza il consumo non
  // puo' dire **perche'**: e' «non so», non «sono gia' cariche».
  assert.equal(fuori.spiegazione, 'non_so');
});

test('quando entra corrente non c’e’ niente da spiegare', () => {
  assert.equal(ramiDellaCarica(fonti(6, 0, 1)).spiegazione, null);
});

// ---------------------------------------------------------------------------
// I tre stati della spiegazione
// ---------------------------------------------------------------------------
//
// Disegno: docs/superpowers/specs/2026-11-21-potenza-netta-ective-design.md
//
// Qui c'era un booleano, `altrove`, e la pagina ne ricavava **una frase sola**:
// «sono gia' cariche, e quella corrente sta andando ai consumi». Il 21/11/2026
// il proprietario ha letto quella frase con le Ective al 95 % e 98 %: non
// erano cariche, si stavano scaricando, e il sole copriva una parte dei
// consumi. Un errore nel verso ottimista, il solo che faccia danno.

// Le fonti producono e nelle batterie non entra niente: `valore` e' lo zero
// **misurato** che `conti.js` da' da quando i due versi vengono dallo stesso
// netto.
const niente = sole => ({ valore: 0, sole_w: sole, motore_w: 0, rete_w: null,
                          base: 'misurato' });

test('pacco pieno e fermo: lo stato e’ «piene»', () => {
  const f = ramiDellaCarica(niente(8), { letture: true, consumo: 2, carica: 100 });
  assert.equal(f.spiegazione, 'piene');
});

test('pacco che si scarica mentre le fonti producono: lo stato e’ «scarica»', () => {
  // Il caso vero del 21/11/2026: 8 W dal sole, Ective a 95 e 98, in scarica.
  const f = ramiDellaCarica(niente(8), { letture: true, consumo: 37, carica: 96.5 });
  assert.equal(f.spiegazione, 'scarica');
});

test('senza la carica non si attribuisce una causa', () => {
  const f = ramiDellaCarica(niente(8), { letture: true, consumo: 37, carica: null });
  assert.equal(f.spiegazione, 'non_so');
});

test('senza il consumo non si attribuisce una causa', () => {
  const f = ramiDellaCarica(niente(8), { letture: true, consumo: null, carica: 100 });
  assert.equal(f.spiegazione, 'non_so');
});

test('i quattro watt del riposo non fanno «scarica»', () => {
  // Servono DUE soglie, non una. Un pacco davvero pieno non legge zero: il
  // 16/11/2026 il proprietario ha misurato -0,29 A a riposo, cioe' ~3,8 W che
  // escono. Con «non esce niente» inteso come zero esatto, «piene» non
  // sarebbe scattato mai e la soglia sulla carica non avrebbe deciso niente.
  const f = ramiDellaCarica(niente(8), { letture: true, consumo: 3.8, carica: 100 });
  assert.equal(f.spiegazione, 'piene');
});

test('carica alta ma non piena, con consumo vero: «scarica»', () => {
  const f = ramiDellaCarica(niente(8), { letture: true, consumo: 30, carica: 96 });
  assert.equal(f.spiegazione, 'scarica');
});

test('pacco pieno che perde trenta watt: «scarica», non «piene»', () => {
  // La carica alta da sola non basta: un pacco pieno che si sta svuotando a
  // trenta watt si sta svuotando.
  const f = ramiDellaCarica(niente(8), { letture: true, consumo: 30, carica: 100 });
  assert.equal(f.spiegazione, 'scarica');
});

test('nessuna fonte che produce: non c’e’ un altrove da spiegare', () => {
  // Resta il caso della pagina di oggi: «non e' un guasto, e' quel che
  // succede a motore spento, senza sole e senza 220». Quella frase la scrive
  // app.js quando nessun ramo e' attivo, e non ha bisogno di uno stato.
  const f = ramiDellaCarica({ valore: 0, sole_w: 0, motore_w: 0, rete_w: null },
                            { letture: true, consumo: 37, carica: 96 });
  assert.equal(f.spiegazione, null);
});

test('la spiegazione si calcola anche a figura ferma: e’ il tempo del verbo che cambia', () => {
  // Il vecchio `altrove` si spegneva quando la figura era ferma, e la pagina
  // ricadeva su «nessuna fonte sta caricando» -- un'affermazione al presente
  // su letture di un'ora prima. Lo stato resta, e chi scrive la frase sa dal
  // campo `ferma` che non va detta al presente.
  const f = ramiDellaCarica(niente(8), { letture: true, consumo: 37, carica: 96, minuti: 90 });
  assert.equal(f.ferma, true);
  assert.equal(f.spiegazione, 'scarica');
});
