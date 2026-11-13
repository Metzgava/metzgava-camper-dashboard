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

// Un codice di park4night sbagliato si deve poter togliere: prima il campo
// svuotato ricadeva su quello vecchio, e il posto restava quello sbagliato.
import { datiProposta } from '../src/lib/proposte.js';

test('svuotando il codice park4night, il codice se ne va', () => {
  const vecchia = { nome: 'Un posto', p4n_id: '277443', link: 'https://park4night.com/it/place/277443' };
  const d = datiProposta({ p4n_id: null }, vecchia);
  assert.equal(d.p4n_id, null);
  assert.equal(d.link, null);
});

test('un campo che non arriva tiene quello che c’era', () => {
  const vecchia = { nome: 'Un posto', p4n_id: '277443' };
  assert.equal(datiProposta({ nome: 'Un posto' }, vecchia).p4n_id, '277443');
});
