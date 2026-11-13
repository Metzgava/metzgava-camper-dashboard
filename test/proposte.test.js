// Come un posto della lavagna diventa una sosta del viaggio. Sbagliare qui non
// si vede subito: si vede fra sei mesi, quando il parcheggio sterrato risulta
// fra le spese di campeggio.
import test from 'node:test';
import assert from 'node:assert/strict';
import { tipoSostaDa } from '../src/lib/park4night.js';

test('dormire in un campeggio è un campeggio', () => {
  assert.equal(tipoSostaDa('pernotto', 'Campeggio'), 'camping');
});

test('dormire altrove è un’area di sosta', () => {
  assert.equal(tipoSostaDa('pernotto', 'Area di servizio'), 'area_sosta');
  assert.equal(tipoSostaDa('pernotto', 'Parcheggio giorno e notte'), 'area_sosta');
  assert.equal(tipoSostaDa('pernotto', null), 'area_sosta');
});

test('la sosta breve è una sosta, e anche la visita', () => {
  assert.equal(tipoSostaDa('sosta', null), 'sosta');
  assert.equal(tipoSostaDa('sosta', 'Campeggio'), 'sosta');
  assert.equal(tipoSostaDa('visita', 'Campeggio'), 'sosta');
});
