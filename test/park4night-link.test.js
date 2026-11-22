// Inserito il numero, il collegamento si deve poter toccare.
//
// Il proprietario: «una volta inserito il numero di park4night il campo con il
// link sia cliccabile e si apra sulla pagina corrispondente su app park4night
// con tutte le info».
//
// L'indirizzo che il programma costruisce e' gia' quello giusto. Chiesto a
// park4night stesso, nel file che dichiara quali indirizzi aprono l'app:
//
//   "paths": [ "*/lieu/*", "*/place/*", "*/map/*" ]
//
// `*/place/*` copre `/it/place/277443`, quindi sull'iPhone l'app si apre da
// se'. Il difetto era un altro: quando si scrive il numero e si esce dal
// campo, il programma cerca il posto e scrive l'esito con `textContent` --
// cioe' **testo**, non un collegamento. Il link cliccabile compariva solo dopo
// aver salvato, nella scheda del posto, non li' dove si e' appena scritto.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { linkPark4nightPosto, numeroPark4night } from '../src/lib/geo.js';

const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');

test('l’indirizzo e’ quello che park4night dichiara di aprire nell’app', () => {
  // `*/place/*`: il segmento della lingua davanti non da' fastidio.
  assert.match(linkPark4nightPosto('277443'), /\/place\/277443$/);
  assert.equal(linkPark4nightPosto(null), null);
});

test('il numero si riconosce nudo, col cancelletto o dentro un indirizzo', () => {
  assert.equal(numeroPark4night('277443'), '277443');
  assert.equal(numeroPark4night('#277443'), '277443');
  assert.equal(numeroPark4night('https://park4night.com/it/place/277443'), '277443');
  assert.equal(numeroPark4night('https://park4night.com/fr/lieu/277443'), '277443');
});

test('l’esito del campo e’ un collegamento, non del testo', () => {
  // `textContent` mette del testo: un indirizzo scritto li' non si tocca. Il
  // link deve comparire **mentre** si scrive il numero, non dopo aver
  // salvato.
  const i = app.indexOf('p4n-esito');
  assert.ok(i > 0, 'il campo del codice park4night non si trova piu’');
  const intorno = app.slice(i, i + 4000);
  assert.match(intorno, /esito\.innerHTML/,
    'l’esito e’ ancora testo: il collegamento non si puo’ toccare');
  assert.match(intorno, /place\//,
    'l’esito non porta l’indirizzo della scheda');
});
