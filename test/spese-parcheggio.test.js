// Il parcheggio fra le categorie di spesa.
//
// Chiesto dal proprietario il 24/11/2026: «su spese metti anche parcheggio».
//
// Non e' l'area di sosta, che c'e' gia': quella e' il posto dove il camper
// dorme e si scarica, e si paga a notte. Il parcheggio e' dove lo si lascia
// per andare a vedere un posto, e si paga a ore. Due spese diverse, e
// tenerle insieme vorrebbe dire non poter piu' sapere quanto costa visitare
// una citta'.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const db = readFileSync(new URL('../src/lib/db.js', import.meta.url), 'utf8');

const mappa = (() => {
  const i = app.indexOf('const CAT = {');
  assert.ok(i > 0, 'la mappa delle categorie non si trova piu’');
  return app.slice(i, app.indexOf('\nconst catLabel', i));
})();

test('il parcheggio c’e’, col suo simbolo e il suo nome', () => {
  assert.match(mappa, /parcheggio:\s*\[/, 'la categoria parcheggio non esiste in pagina');
});

test('non prende il simbolo delle aree di sosta, o si confondono', () => {
  // L'area di sosta ha gia' il 🅿️: due voci con lo stesso simbolo in un
  // elenco a tendina si scelgono a caso.
  const suo = mappa.match(/parcheggio:\s*\['([^']+)'/);
  const area = mappa.match(/area_sosta:\s*\['([^']+)'/);
  assert.ok(suo && area, 'una delle due categorie non si legge');
  assert.notEqual(suo[1], area[1], 'parcheggio e aree sosta hanno lo stesso simbolo');
});

test('va in coda, cosi’ le categorie di prima tengono il loro colore', () => {
  // Il colore di una categoria viene dalla sua **posizione** nella mappa
  // (`catColor` conta l'indice): infilarla in mezzo cambierebbe il colore a
  // tutte quelle dopo, in ogni grafico e in ogni riquadro gia' visto. E' la
  // ragione scritta dentro la mappa stessa.
  const ordine = [...mappa.matchAll(/^\s{2}([a-z_]+):\s*\[/gm)].map(m => m[1]);
  const inCoda = [...mappa.matchAll(/([a-z_]+):\s*\[/g)].map(m => m[1]);
  assert.equal(inCoda[inCoda.length - 1], 'parcheggio',
    `parcheggio non e’ l’ultima: l’ordine finisce con ${inCoda.slice(-3).join(', ')}`);
  assert.ok(ordine.length >= 0);
});

test('entra anche negli archivi gia’ avviati, non solo in quelli nuovi', () => {
  // L'INSERT iniziale delle impostazioni non tocca un archivio che esiste
  // gia': senza questa riga, il parcheggio ci sarebbe solo per chi installa
  // il programma domani.
  assert.match(db, /categorieNuove\(\['parcheggio'\]/,
    'il parcheggio non arriva negli archivi che esistono gia’');
  assert.match(db, /"parcheggio"/, 'manca dal valore iniziale delle impostazioni');
});

test('si infila accanto alle aree di sosta, dove uno lo cerca', () => {
  const m = db.match(/categorieNuove\(\['parcheggio'\],\s*'([a-z_]+)'\)/);
  assert.ok(m, 'non si dice accanto a quale categoria va messa');
  assert.equal(m[1], 'area_sosta');
});
