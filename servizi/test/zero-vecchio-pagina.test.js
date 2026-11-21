// La pagina non deve rimettere lo zero che `bluetti.js` ha appena togliuto.
//
// Disegno: docs/superpowers/specs/2026-11-21-zero-vecchio-design.md
//
// La regola sta dove sta il dato -- in `bluetti.js`, dove girano le prove -- e
// oltre cinque minuti le quattro potenze a zero diventano `null`. Ma in
// `app.js` c'erano due punti che un `null` lo **riportavano a zero** e poi
// affermavano l'assenza:
//
//   - i totali «Entra» e «Esce», sommati con `(b.rete_w || 0)`: quattro «non
//     so» diventavano uno zero sicuro di se';
//   - la frase sotto la figura, «Non entra e non esce niente», che e'
//     un'affermazione e non puo' stare su dati che non abbiamo.
//
// Questa prova non guarda un pixel: guarda che quei due punti non tornino.
// Stesso stampo di `tacche-sicurezza.test.js` e `frasi-flusso.test.js`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');

test('i totali «Entra» e «Esce» non riportano a zero un «non so»', () => {
  // `(b.rete_w || 0)` su quattro null da' zero, e lo zero in pagina dice
  // «non sta succedendo niente» -- esattamente l'affermazione che si sta
  // togliendo. Serve una somma che torni `null` quando non sa niente.
  for (const campo of ['fotovoltaico_w', 'rete_w', 'uscita_ac_w', 'uscita_dc_w']) {
    assert.doesNotMatch(app, new RegExp(`\\(b\\.${campo} \\|\\| 0\\)`),
      `${campo} viene ancora riportato a zero`);
  }
});

test('la frase sotto la figura della Bluetti distingue «niente» da «non so»', () => {
  const da = app.indexOf('function vistaFlussoBluetti(');
  assert.ok(da > 0);
  const a = app.indexOf('\nfunction ', da + 1);
  const vista = app.slice(da, a > 0 ? a : undefined);

  // `ignoto` da solo non basta come prova: compare gia' nei rami, per il
  // tratteggio, prima della frase. Serve che la figura chieda **se sono tutti
  // ignoti**, cioe' se dei quattro numeri non ne conosce nessuno.
  assert.match(vista, /every\(r => r\.ignoto\)/,
    'la figura non chiede se tutti i rami sono ignoti');
  // «Non entra e non esce niente» e' un'affermazione: puo' restare, ma solo
  // dove i numeri si conoscono.
  assert.ok(vista.includes('Non entra e non esce niente'),
    'la frase dei numeri conosciuti e’ sparita');
  // E ci vuole l'altra frase, quella che non afferma niente.
  assert.match(vista, /non so se entra/i,
    'manca la frase per quando i numeri non si conoscono');
});
