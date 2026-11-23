// I manometri delle Ective si chiamano col loro numero.
//
// Disegno: docs/superpowers/specs/2026-11-23-travaso-scomposto-design.md
//
// «Ective 1» e «Ective 2» erano la loro posizione nell'elenco, non la loro
// identita': se un giorno l'ordine cambia, la numero 1 diventa la 2 e nessuno
// se ne accorge. Le ultime tre cifre del numero di serie -- 310 e 323 -- sono
// scritte sulle batterie e non si spostano.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const quadrante = (() => {
  const i = app.indexOf('const quadrante =');
  assert.ok(i > 0, 'la funzione del quadrante non si trova piu’');
  return app.slice(i, i + 1200);
})();

test('il nome viene dal numero di serie, non dalla posizione', () => {
  assert.doesNotMatch(quadrante, /Ective \$\{i \+ 1\}/,
    'i manometri si chiamano ancora col posto in elenco');
  assert.match(quadrante, /apparecchio/,
    'il nome non guarda il numero di serie della batteria');
});

test('si usano le ultime tre cifre', () => {
  assert.match(quadrante, /slice\(-3\)/,
    'non si prendono le ultime tre cifre del numero');
});

test('senza numero di serie resta un nome, non un buco', () => {
  // Una batteria che non si e' ancora presentata deve avere un'etichetta:
  // due quadranti senza nome non si distinguono.
  assert.match(quadrante, /Ective \$\{/,
    'il ripiego non scrive piu’ la parola Ective');
});
