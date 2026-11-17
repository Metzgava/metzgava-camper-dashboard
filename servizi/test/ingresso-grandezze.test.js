// Il server accetta solo le grandezze di un elenco, e scarta le altre con una
// riga negli eventi. E' una difesa giusta — una lettura fuori scala sporca i
// grafici per sempre — ma un elenco incompleto fa perdere dati veri in
// silenzio.
//
// Trovato il 17/11 aggiungendo i SwitchBot: `umidita` non era nell'elenco,
// quindi l'umidita' dei termometri che la scatoletta manda da sempre veniva
// scartata a ogni giro. Questa prova esiste perche' non ricapiti: elenca le
// grandezze che la scatoletta manda davvero, e pretende che ci siano.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import './aiuto/archivio-finto.js';

const { AMMESSE } = await import('../src/routes/ingresso.js');

// Quel che i decodificatori di agente.py mettono in `misure`.
const MANDATE = {
  temperatura: 'termometri ATC, BTHome, SwitchBot; Victron',
  umidita: 'termometri ATC, BTHome, SwitchBot',
  pila: 'la pila dei termometri: dice quando cambiarla',
  rssi: 'quanto si sente ogni apparecchio',
  carica: 'Ective, Bluetti',
  volt: 'Ective, Victron, e i volt della pila delle webcam',
  ampere: 'Ective',
  watt: 'Victron',
  pannelli_w: 'Victron solare',
};

for (const [grandezza, chi] of Object.entries(MANDATE)) {
  test(`«${grandezza}» e' ammessa (la manda: ${chi})`, () => {
    const limiti = AMMESSE[grandezza];
    assert.ok(limiti, `${grandezza} non e' nell'elenco: verrebbe scartata in silenzio`);
    assert.equal(limiti.length, 2);
    assert.ok(limiti[0] < limiti[1], `intervallo al rovescio: ${limiti}`);
  });
}

test('umidita’ e pila stanno fra 0 e 100, non oltre', () => {
  assert.deepEqual(AMMESSE.umidita, [0, 100]);
  assert.deepEqual(AMMESSE.pila, [0, 100]);
});
