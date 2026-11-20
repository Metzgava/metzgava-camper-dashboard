// I conti dello scorrimento dei numeri.
//
// Il movimento in se' si guarda in un browser; qui si prova quel che si puo'
// sbagliare senza accorgersene: la curva e la scrittura del numero.
//
// La scrittura conta piu' di quanto sembri. Durante la corsa la cifra la
// riscrive `scorri`, non piu' `num()` della pagina: se le due non scrivessero
// allo stesso modo, ogni numero cambierebbe forma per sette decimi di secondo
// — 1.240 che diventa 1240 e poi di nuovo 1.240 — e sarebbe peggio che non
// animare niente.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aFrazione, scritto } from '../public/scorri.js';

test('all’inizio sta alla partenza, alla fine all’arrivo', () => {
  assert.equal(aFrazione(20, 80, 0), 20);
  assert.equal(aFrazione(20, 80, 1), 80);
});

test('parte svelto: a metà tempo ha fatto più di metà strada', () => {
  // E' il senso della curva: la lettura nuova si annuncia subito, e l'ultimo
  // pezzo serve solo a non sbattere sul valore finale.
  assert.ok(aFrazione(0, 100, 0.5) > 50);
  assert.ok(aFrazione(0, 100, 0.5) < 100);
});

test('non torna mai indietro', () => {
  let prima = aFrazione(10, 90, 0);
  for (let t = 0.05; t <= 1.0001; t += 0.05) {
    const ora = aFrazione(10, 90, t);
    assert.ok(ora >= prima, `a ${t.toFixed(2)}: ${ora} viene prima di ${prima}`);
    prima = ora;
  }
});

test('funziona anche in discesa', () => {
  assert.equal(aFrazione(80, 20, 0), 80);
  assert.equal(aFrazione(80, 20, 1), 20);
  assert.ok(aFrazione(80, 20, 0.5) < 50);
});

test('un tempo fuori strada non manda il numero fuori scala', () => {
  // Un fotogramma in ritardo — scheda tornata in primo piano, telefono che
  // rallenta — puo' dare una frazione sopra 1 o sotto 0. Il numero mostrato
  // non deve superare l’arrivo: su una carica, 103 % e' un guasto.
  assert.equal(aFrazione(20, 80, 1.7), 80);
  assert.equal(aFrazione(20, 80, -0.3), 20);
});

test('scrive i numeri come li scrive la pagina', () => {
  assert.equal(scritto(0), '0');
  assert.equal(scritto(77), '77');
  // L'italiano non separa le migliaia a quattro cifre e le separa a cinque:
  // 1240 resta intero, 12400 si spezza. Non e' un capriccio nostro, e' la
  // regola della lingua, e `num()` nella pagina la segue identica — che e' il
  // punto: durante la corsa la cifra non deve cambiare forma.
  assert.equal(scritto(1240), '1240');
  assert.equal(scritto(12400), '12.400');
});

test('i decimali si rispettano, con la virgola', () => {
  assert.equal(scritto(13.67, 2), '13,67');
  assert.equal(scritto(3.456, 1), '3,5');
  // Chiesto un decimale, un intero lo porta comunque: 14 e 14,0 nella stessa
  // colonna fanno ballare la riga.
  assert.equal(scritto(14, 1), '14,0');
});
