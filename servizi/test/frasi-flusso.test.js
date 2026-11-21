// La frase sotto la figura dice la cosa giusta per lo stato giusto.
//
// Disegno: docs/superpowers/specs/2026-11-21-potenza-netta-ective-design.md
//
// Il 21/11/2026 la pagina scriveva «sono gia' cariche, e quella corrente sta
// andando ai consumi del camper» con i quadranti delle Ective al 95 % e 98 %.
// Non erano cariche: si stavano scaricando, e il sole copriva una parte dei
// consumi. La frase era una sola per due situazioni opposte, e quella scelta
// era la rassicurante.
//
// Lo **stato** lo decide `flusso.js` e lo provano le prove di `flusso.test.js`.
// Qui si guarda l'unica cosa che quelle non vedono: che `app.js` abbia
// davvero tre rami, e che la frase di prima viva soltanto dentro quello dove
// e' vera. E' lo stesso genere di prova di `tacche-sicurezza.test.js`: non
// guarda un pixel, guarda che una cosa sia nominata dove serve.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');

// Il corpo di `vistaFlusso`, da `function vistaFlusso` alla funzione dopo.
const vistaFlusso = (() => {
  const da = app.indexOf('function vistaFlusso(');
  assert.ok(da > 0, 'vistaFlusso non si trova in app.js');
  const a = app.indexOf('\nfunction ', da + 1);
  return app.slice(da, a > 0 ? a : undefined);
})();

test('la figura ha un ramo per ciascuno dei tre stati', () => {
  for (const stato of ['piene', 'scarica', 'non_so']) {
    assert.match(vistaFlusso, new RegExp(`'${stato}'`), `manca il ramo ${stato}`);
  }
});

test('«gia’ cariche» si dice soltanto nel ramo «piene»', () => {
  // La prova vera di questo lavoro. La frase resta -- in quel ramo e' giusta
  // ed e' utile -- ma non deve piu' essere quel che la pagina dice **per
  // esclusione**, cioe' ogni volta che non sta entrando corrente.
  // Si cerca la forma **con le entita' HTML**, che e' quella che si stampa:
  // `cariche` da solo pesca anche i commenti che la citano, e un commento non
  // e' una frase che il proprietario legge.
  const dove = vistaFlusso.indexOf('gi&agrave; cariche');
  assert.ok(dove > 0, 'la frase di «piene» non si trova');
  // Il ramo si riconosce dal confronto sullo stato, che deve stare prima
  // della frase e piu' vicino di quanto stiano gli altri due stati.
  const prima = vistaFlusso.slice(0, dove);
  const posti = ['piene', 'scarica', 'non_so']
    .map(s => [s, prima.lastIndexOf(`'${s}'`)])
    .filter(([, i]) => i >= 0);
  // Senza questo, con zero stati nel file `lastIndexOf` torna -1 per tutti e
  // la prova passerebbe per caso, premiando il primo nome dell'elenco.
  assert.ok(posti.length, 'nessuno stato nominato prima della frase');
  const ultimoStato = posti.sort((x, y) => y[1] - x[1])[0][0];
  assert.equal(ultimoStato, 'piene',
    'la frase «gia’ cariche» non sta nel ramo «piene»');
});

test('la frase della scarica non promette un totale dei consumi', () => {
  // Fonti invisibili sul 12 V -- il rele' separatore di fabbrica, la Bluetti
  // sul 12 V -- aggiungono corrente che non misuriamo. Dei consumi si puo'
  // dire «almeno tanto», non «tanto»: un totale esatto sarebbe piu' basso del
  // vero, cioe' l'errore nel verso ottimista.
  const da = vistaFlusso.indexOf("'scarica'");
  assert.ok(da > 0);
  const ramo = vistaFlusso.slice(da, da + 1200);
  assert.match(ramo, /almeno/, 'il ramo «scarica» non dice «almeno»');
});

test('a figura ferma la frase non si dice al presente', () => {
  // Lo stato si calcola anche su letture vecchie (e' la scelta di flusso.js):
  // qui si guarda che `app.js` usi `ferma` per cambiare il tempo del verbo,
  // invece di affermare al presente una cosa di un'ora prima.
  const da = vistaFlusso.indexOf('f.spiegazione');
  assert.ok(da > 0, 'app.js non guarda lo stato');
  assert.match(vistaFlusso.slice(da, da + 2000), /f\.ferma/,
    'la frase dello stato non tiene conto di «ferma»');
});
