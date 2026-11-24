// Quanto stanno prendendo i carichi del camper, dedotto.
//
// **Nessuno li misura.** Non c'e' un contatore sulla linea a 12 V: l'app sa
// solo quanto esce dalle batterie, e quando il sole copre tutto dalle
// batterie non esce niente. Il 24/11/2026 il proprietario: «ora vedo flussi
// da sole ma non consumi, come mai». Giusto: le batterie non stavano pagando
// nulla.
//
// Ma in quel caso il numero si **deduce**: il sole lo misura il Victron,
// quanto entra lo misurano le Ective, e la differenza e' quel che prendono i
// carichi. L'app faceva gia' il ragionamento speculare -- fonti **meno** di
// quel che entra: la differenza viene dalla 220 -- e non copriva l'opposto.
//
// **E c'e' un caso in cui non si puo' dedurre niente**, ed e' quello in cui
// oggi si deduce la 220: se entra piu' di quanto le fonti viste diano, c'e'
// una fonte che non vediamo, e quella potrebbe alimentare anche i carichi. Un
// caricatore da 50 W mentre i consumi ne prendono 100 non si vede da qui: li'
// la risposta onesta e' «non so», non «zero».
import test from 'node:test';
import assert from 'node:assert/strict';
// `conti.js` tira dentro il database: l'archivio finto lo sostituisce, come
// fanno le altre prove che lo importano.
import './aiuto/archivio-finto.js';
import { consumiDedotti } from '../src/lib/conti.js';

test('col sole che copre tutto, i consumi sono il surplus', () => {
  // 200 dal sole, 150 nelle batterie: 50 se li prendono i carichi.
  const c = consumiDedotti({ entra: 150, esce: 0, sole: 200, motore: 0 });
  assert.equal(c.watt, 50);
  assert.equal(c.base, 'dedotto');
});

test('mentre le batterie si scaricano, i carichi prendono tutto', () => {
  // Quel che esce dalle batterie piu' quel che danno le fonti.
  const c = consumiDedotti({ entra: 0, esce: 40, sole: 30, motore: 0 });
  assert.equal(c.watt, 70);
});

test('se entra piu’ di quanto le fonti diano, non si sa', () => {
  // C'e' una fonte che non vediamo -- la 220 -- e potrebbe alimentare anche i
  // carichi. Rispondere «zero» direbbe «ho guardato e non consuma niente».
  assert.equal(consumiDedotti({ entra: 200, esce: 0, sole: 50, motore: 0 }), null);
});

test('senza sapere una fonte non si deduce niente', () => {
  assert.equal(consumiDedotti({ entra: 150, esce: 0, sole: null, motore: 0 }), null);
  assert.equal(consumiDedotti({ entra: 150, esce: 0, sole: 200, motore: null }), null);
});

test('senza letture delle batterie non si deduce niente', () => {
  assert.equal(consumiDedotti({ entra: null, esce: null, sole: 200, motore: 0 }), null);
});

test('tutto fermo: uno zero che si conosce', () => {
  // Niente sole, niente alternatore, niente che entra o esce: i carichi non
  // stanno prendendo niente, e questo si sa.
  const c = consumiDedotti({ entra: 0, esce: 0, sole: 0, motore: 0 });
  assert.equal(c.watt, 0);
});

test('l’alternatore conta come il sole', () => {
  const c = consumiDedotti({ entra: 100, esce: 0, sole: 20, motore: 150 });
  assert.equal(c.watt, 70);
});

test('i conti si fermano a zero, non vanno sotto', () => {
  // Le misure vengono da apparecchi diversi in istanti diversi: una
  // differenza di pochi watt al rovescio e' rumore, non un consumo negativo.
  const c = consumiDedotti({ entra: 100, esce: 0, sole: 100, motore: 0 });
  assert.equal(c.watt, 0);
});

// ---------------------------------------------------------------------------
// Il cablaggio: la regola deve arrivare in pagina, non restare in un cassetto
// ---------------------------------------------------------------------------
import { readFileSync } from 'node:fs';

test('i conti espongono i consumi dedotti', () => {
  const conti = readFileSync(new URL('../src/lib/conti.js', import.meta.url), 'utf8');
  assert.match(conti, /consumi_camper\s*=/,
    'la regola esiste ma nessuno la chiama: in pagina non arriva niente');
  const i = conti.indexOf('consumi_camper');
  assert.match(conti.slice(Math.max(0, i - 400), i + 400), /consumiDedotti\(/);
});

test('la pagina li mostra, col bollino di dedotto', () => {
  const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const i = app.indexOf('Dentro e fuori dalle batterie');
  assert.ok(i > 0, 'la figura non si trova piu’');
  const figura = app.slice(i, i + 5200);
  assert.match(figura, /consumi_camper/, 'la figura non dice cosa prendono i carichi');
  assert.match(figura, /dedotto|dedott/i, 'il numero passa per misurato');
});

test('quando non si puo’ dedurre, la pagina non scrive uno zero', () => {
  // `null` vuol dire «non so»: scrivere 0 direbbe «ho guardato e non si
  // consuma niente», mentre magari c'e' una fonte che non vediamo.
  const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const i = app.indexOf('consumi_camper');
  assert.ok(i > 0);
  assert.match(app.slice(i - 200, i + 600), /\?\.|&&|!= null|== null/,
    'la pagina non distingue il «non so» dallo zero');
});
