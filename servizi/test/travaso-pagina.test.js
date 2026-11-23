// Quel che la pagina dice della scomposizione del travaso.
//
// Disegno: docs/superpowers/specs/2026-11-23-travaso-scomposto-design.md
//
// Sta **sotto** il disegno, non dentro: l'SVG e' 304x148 con tre righe gia'
// fitte, e tre sotto-voci infilate li' si accavallerebbero.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const figura = (() => {
  const i = app.indexOf('Dentro e fuori dalle batterie');
  assert.ok(i > 0, 'la figura non si trova piu’');
  return app.slice(i, i + 4000);
})();

test('la scomposizione compare sotto la figura', () => {
  assert.match(figura, /scomposizione/,
    'la figura non dice di cosa e’ fatto il buco fra quel che esce e quel che entra');
});

test('i tre pezzi hanno il loro simbolo', () => {
  // Il sorgente scrive i caratteri non ASCII come sequenze di fuga, che e' la
  // convenzione di quel file: si accettano tutte e due le forme.
  const c = (carattere, fuga, cosa) =>
    assert.ok(figura.includes(carattere) || figura.includes(fuga),
      `manca il simbolo di ${cosa}`);
  c('♨', '2668', 'quel che si disperde in calore');
  c('🏠', '1F3E0', 'quel che si consuma');
  c('🔋', '1F50B', 'quel che resta nelle batterie');
});

test('«dispersi» e «consumi e altro» non si confondono', () => {
  // I watt che vanno al frigo stanno lavorando: chiamarli perdite insieme a
  // quelli che scaldano il caricatore farebbe sembrare spreco anche loro.
  assert.match(figura, /dispers/i);
  assert.match(figura, /consumi e altro/i,
    'il ramo per differenza si chiama «consumi», che e’ piu’ preciso di quanto ci siamo guadagnati');
});

test('si dice che i dispersi sono una stima, non una misura', () => {
  // Vengono dal rendimento **di targa** del caricatore. Nessuno li ha misurati.
  assert.match(figura, /stima|di targa|circa/i,
    'i watt dispersi passano per misurati');
});

test('quando il conto non torna non si mostra un numero inventato', () => {
  assert.match(figura, /torna/,
    'il caso del rendimento peggiore di quello dichiarato non e’ previsto');
});
