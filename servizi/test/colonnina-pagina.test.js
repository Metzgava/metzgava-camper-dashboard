// Gli ampere della colonnina si **scelgono**, non si battono.
//
// Disegno: docs/superpowers/specs/2026-11-21-colonnina-ampere-design.md
//
// Il campo c'era, e il difetto era il suo comportamento: `oninput`
// ricostruiva il riquadro e **sostituiva il nodo** dell'input a ogni tasto.
// Per mettere 4 dove c'era 16 bisogna prima cancellare, e al primo backspace
// il nodo veniva rifatto, il cursore si perdeva e su iPad la tastiera se ne
// andava. Tutti i valori che il proprietario ha nominato -- 2, 4, 6 -- sono di
// una cifra sola, cioe' piu' corti del 16 che c'era.
//
// Un elenco non ha cursore, non ha tastiera, e non si puo' sbagliare di una
// cifra: `max="32"` era solo un suggerimento di validazione, e battendo si
// arrivava a 164 A.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TAGLIE_A } from '../src/lib/colonnina.js';

const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');

test('gli ampere si scelgono da un elenco, non si battono in un campo', () => {
  assert.doesNotMatch(app, /id="c-a-amp"[^>]*type="number"/,
    'gli ampere sono ancora un campo da battere');
  assert.match(app, /<select[^>]*id="c-a-amp"/,
    'manca l’elenco degli ampere');
});

test('l’elenco in pagina e’ lo stesso di colonnina.js', () => {
  // La duplicazione e' inevitabile -- `app.js` e' servito statico e non puo'
  // importare da `src/lib` -- quindi la tiene ferma una prova. Una soglia che
  // vive in due posti con due valori diversi e' il modo di far dire a due
  // parti della pagina cose contrarie sullo stesso istante.
  const m = app.match(/const TAGLIE_A = \[([^\]]*)\]/);
  assert.ok(m, 'in app.js non si trova TAGLIE_A');
  const inPagina = m[1].split(',').map(x => Number(x.trim())).filter(x => !Number.isNaN(x));
  assert.deepEqual(inPagina, TAGLIE_A);
});

test('gli ampere non compaiono fra «i dati fissi»', () => {
  // Ogni altra riga di quella tabella cambia quando cambi un pezzo di camper.
  // Questa cambia a ogni piazzola: sarebbe l'unica da toccare in viaggio, e
  // metterla li' vuol dire farsi tre schermate per un numero che si legge sul
  // palo mentre attacchi il cavo.
  const da = app.indexOf('function vistaImpianto(');
  assert.ok(da > 0);
  const a = app.indexOf('\nfunction ', da + 1);
  const vista = app.slice(da, a > 0 ? a : undefined);
  assert.match(vista, /colonnina_a/,
    'vistaImpianto non dice niente di colonnina_a: deve escluderla di proposito');
});

test('il tempo delle Ective dalla colonnina e’ in pagina', () => {
  // Era la meta' della richiesta che non esisteva affatto: «i tempi di
  // ricarica stimati **sia di bluetti che di ective** da colonnina».
  assert.match(app, /ore_colonnina_ective/);
});

test('la pagina dice che la presa e’ un piatto solo', () => {
  // Caricare Bluetti ed Ective insieme su 4 A non raddoppia niente, ed e'
  // esattamente l'errore che uno fa in piazzola. La Truma elettrica mangia
  // dallo stesso piatto: 1800 W di resistenza su una presa da 6 A non
  // lasciano niente per caricare.
  assert.match(app, /stesso piatto|si divide|lo stesso budget/i);
});
