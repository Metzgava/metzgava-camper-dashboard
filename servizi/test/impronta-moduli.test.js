// Il 18/11/2026 `index.html` chiamava `app.js?v=16` e quel numero andava alzato
// a mano: dimenticarlo voleva dire pubblicare qualcosa che nessuno vedeva per
// un'ora, senza nessun segnale. Il rimedio fu l'impronta dei file, in
// `conImpronta`.
//
// Oggi la stessa trappola si ripresenta da un'altra porta. `app.js` diventa un
// modulo che importa un altro file della pagina:
//
//     import { rifondi } from './rifondi.js';
//
// Quell'indirizzo non passa da `index.html`, quindi `conImpronta` non lo vede:
// il browser chiede `rifondi.js` liscio, lo static lo serve con un'ora di
// cache, e dopo una modifica il telefono continua a far girare il pezzo
// vecchio dentro un `app.js` nuovo. Peggio del guasto di prima, perche' i due
// file non sarebbero nemmeno della stessa eta'.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { conImprontaNeiModuli } from '../src/lib/pagina.js';

test('un import relativo porta l’impronta', () => {
  const js = "import { rifondi } from './rifondi.js';";
  assert.equal(conImprontaNeiModuli(js, 'abc1234567'),
    "import { rifondi } from './rifondi.js?v=abc1234567';");
});

test('le virgolette doppie valgono quanto le singole', () => {
  const js = 'import { x } from "./y.js";';
  assert.ok(conImprontaNeiModuli(js, 'abc1234567').includes('"./y.js?v=abc1234567"'));
});

test('applicarla due volte non raddoppia niente', () => {
  const js = "import { x } from './y.js';";
  const una = conImprontaNeiModuli(js, 'abc1234567');
  assert.equal(conImprontaNeiModuli(una, 'abc1234567'), una);
});

test('una nuova impronta sostituisce la precedente', () => {
  const js = "import { x } from './y.js';";
  const prima = conImprontaNeiModuli(js, 'aaaaaaaaaa');
  assert.ok(conImprontaNeiModuli(prima, 'bbbbbbbbbb').includes("'./y.js?v=bbbbbbbbbb'"));
});

test('un import dinamico lo porta anche lui', () => {
  const js = "const m = await import('./tardi.js');";
  assert.ok(conImprontaNeiModuli(js, 'abc1234567').includes("'./tardi.js?v=abc1234567'"));
});

test('un «export … from» lo porta anche lui', () => {
  const js = "export { a } from './altro.js';";
  assert.ok(conImprontaNeiModuli(js, 'abc1234567').includes("'./altro.js?v=abc1234567'"));
});

test('un modulo di fuori non si tocca', () => {
  // Non sono file nostri: l'impronta della nostra pagina non dice niente su di
  // loro, e appiccicargliela romperebbe l'indirizzo.
  const js = [
    "import express from 'express';",
    "import x from 'https://esempio.it/x.js';",
    "import y from '/assoluto/z.js';",
  ].join('\n');
  assert.equal(conImprontaNeiModuli(js, 'abc1234567'), js);
});

test('senza impronta il file resta com’è', () => {
  const js = "import { x } from './y.js';";
  assert.equal(conImprontaNeiModuli(js, null), js);
});

test('una stringa che somiglia a un import non viene toccata', () => {
  // `esc()` e i commenti della pagina parlano di file: non devono diventare
  // indirizzi da riscrivere.
  const js = "const t = \"si importa da './y.js' come si vede\";";
  assert.equal(conImprontaNeiModuli(js, 'abc1234567'), js);
});
