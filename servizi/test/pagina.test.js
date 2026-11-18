// Il 18/11 ho cambiato app.js e stile.css, pubblicato, e il proprietario ha
// continuato a vedere la versione di prima: niente conto alla rovescia,
// lancette ancora bianche. Nessuno dei due pezzi era rotto.
//
// La causa: index.html chiama `app.js?v=16`, un numero scritto a mano, e i due
// file sono serviti con un'ora di cache. Cambiare il codice senza toccare quel
// numero vuol dire pubblicare qualcosa che nessuno vedra' per un'ora — e non
// c'e' nessun segnale che lo dica, perche' il server e' aggiornato, la
// pubblicazione e' riuscita, e il browser mostra senza fiatare quel che ha in
// tasca.
//
// Il rimedio non e' ricordarselo: e' togliere il numero a mano. L'impronta dei
// file c'e' gia', calcolata all'avvio, e cambia da se' quando cambiano i file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { conImpronta } from '../src/lib/pagina.js';

test('la versione scritta a mano diventa l’impronta dei file', () => {
  const html = '<link rel="stylesheet" href="stile.css?v=16">\n<script src="app.js?v=16" type="module"></script>';
  const fuori = conImpronta(html, 'abc1234567');
  assert.ok(fuori.includes('stile.css?v=abc1234567'));
  assert.ok(fuori.includes('app.js?v=abc1234567'));
  assert.ok(!fuori.includes('v=16'));
});

test('applicarla due volte non raddoppia niente', () => {
  const html = '<script src="app.js?v=16"></script>';
  const una = conImpronta(html, 'abc1234567');
  assert.equal(conImpronta(una, 'abc1234567'), una);
});

test('una nuova impronta sostituisce la precedente', () => {
  const html = '<script src="app.js?v=16"></script>';
  const prima = conImpronta(html, 'aaaaaaaaaa');
  assert.ok(conImpronta(prima, 'bbbbbbbbbb').includes('app.js?v=bbbbbbbbbb'));
});

test('quel che non ha una versione resta com’e’', () => {
  const html = '<img src="icona.svg"><a href="https://esempio.it/?v=16">fuori</a>';
  // Si tocca solo `?v=` attaccato a un file del sito: un indirizzo altrui che
  // per caso ha la stessa forma non e' affar nostro.
  assert.equal(conImpronta(html, 'abc1234567'), html);
});

test('senza impronta la pagina non si rompe: resta quella che era', () => {
  const html = '<script src="app.js?v=16"></script>';
  assert.equal(conImpronta(html, ''), html);
  assert.equal(conImpronta(html, null), html);
});
