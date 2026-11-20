// Il lato in uscita della figura delle Ective: quanto esce dal pacco.
//
// Disegno: docs/superpowers/specs/2026-11-20-dentro-e-fuori-ective-design.md
//
// Il lato in entrata non si tocca: e' il disegno approvato il 19/11, e queste
// prove non lo guardano nemmeno.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ramiDellaCarica, SPESSORE, SECONDI, RIFERIMENTO_USCITA_W }
  from '../src/lib/flusso.js';

const fonti = (sole = 0, motore = 0, rete = 0) => ({
  valore: sole + motore + rete, sole_w: sole, motore_w: motore, rete_w: rete,
});
// La figura esiste se le Ective si leggono: e' la stessa condizione del lato
// in entrata.
const figura = (consumo, extra = {}) =>
  ramiDellaCarica(fonti(), { letture: true, consumo, ...extra });
const ramo = f => f.uscita.rami[0];

test('quel che esce e’ un ramo solo, e porta i watt', () => {
  const f = figura(33);
  assert.equal(f.uscita.rami.length, 1);
  assert.equal(f.uscita.totale, 33);
  assert.equal(ramo(f).watt, 33);
  assert.equal(ramo(f).attivo, true);
});

test('il ramo non ha un nome di carico, perche’ non lo sappiamo', () => {
  // Si misura il pacco, non i circuiti. Un «Frigo» qui sarebbe inventato: i
  // nomi arrivano dopo la serata di taratura.
  const r = ramo(figura(33));
  assert.equal(r.id, 'consumi');
  assert.doesNotMatch(r.nome, /frigo|truma|pompa|luci|starlink/i);
});

test('niente esce: zero, non «non so», e il ramo sta fermo', () => {
  const f = figura(0);
  assert.equal(ramo(f).watt, 0);
  assert.equal(ramo(f).attivo, false);
  assert.equal(ramo(f).ignoto, undefined);
  assert.equal(ramo(f).secondi, null);
});

test('nessuna lettura di consumo: ignoto, e il numero non si scrive', () => {
  // `null` e' l'unico caso di «non so». Un ramo a zero disegnato qui direbbe
  // «non esce niente» mentre invece non lo sappiamo.
  const f = figura(null);
  assert.equal(ramo(f).watt, null);
  assert.equal(ramo(f).ignoto, true);
  assert.equal(ramo(f).attivo, false);
});

test('senza nessuna soglia: anche pochi watt sono un flusso vero', () => {
  // A camper fermo il consumo non e' zero -- la scatoletta stessa pesa, e quel
  // peso il progetto lo calcola. `SOGLIA_W` vale per la Bluetti, che dichiara
  // i suoi watt anche da ferma, e non per le Ective.
  assert.equal(ramo(figura(3)).attivo, true);
});

test('lo spessore cresce coi watt su una scala assoluta', () => {
  // Qui la scala **non** puo' essere relativa come in entrata: con un ramo
  // solo, la sua quota sul totale del proprio lato e' sempre uno, e trenta
  // watt si disegnerebbero come trecento. Il riferimento e' dichiarato.
  const sottile = ramo(figura(20)).spessore;
  const grosso = ramo(figura(200)).spessore;
  assert.ok(sottile < grosso, `${sottile} non e' piu' sottile di ${grosso}`);
  assert.ok(sottile >= SPESSORE.min);
});

test('oltre il riferimento lo spessore non sfonda, e la velocita’ nemmeno', () => {
  const r = ramo(figura(RIFERIMENTO_USCITA_W * 4));
  assert.equal(r.spessore, SPESSORE.max);
  assert.equal(r.secondi, SECONDI.veloce);
});

test('piu’ watt escono, piu’ svelti scorrono i puntini', () => {
  assert.ok(ramo(figura(200)).secondi < ramo(figura(20)).secondi);
});

test('letture vecchie: il ramo in uscita si ferma come quelli in entrata', () => {
  // Un disegno che scorre su dati vecchi mente meglio di un numero fermo, e
  // vale nei due versi. Il numero resta scritto: e' l'eta' che va detta.
  const f = figura(120, { minuti: 60 });
  assert.equal(f.ferma, true);
  assert.equal(ramo(f).attivo, false);
  assert.equal(ramo(f).secondi, null);
  assert.equal(ramo(f).watt, 120);
});

test('i due lati si muovono insieme, e non e’ un errore', () => {
  // Una batteria prende e l'altra da': entra ed esce corrente nello stesso
  // istante. E' il travaso fra le due, e la figura lo mostra invece di
  // nasconderlo.
  const f = ramiDellaCarica(fonti(60), { letture: true, consumo: 33 });
  assert.equal(f.rami.find(r => r.id === 'sole').attivo, true);
  assert.equal(ramo(f).attivo, true);
});

test('le due scale sono indipendenti: il lato piccolo non diventa un filo', () => {
  // Sei watt dal sole sotto la pioggia erano quasi tutto quel che entrava, e
  // si devono vedere anche mentre dal pacco escono trecento watt.
  const f = ramiDellaCarica(fonti(6), { letture: true, consumo: 300 });
  assert.equal(f.rami.find(r => r.id === 'sole').spessore, SPESSORE.max);
});

test('senza letture non c’e’ figura, nemmeno il lato in uscita', () => {
  assert.equal(ramiDellaCarica(null, { letture: false, consumo: null }), null);
});

test('chi non passa il consumo non si trova un lato in uscita inventato', () => {
  // Le chiamate che esistono oggi non lo passano: meglio nessun lato che un
  // lato a zero che dice «non esce niente».
  const f = ramiDellaCarica(fonti(6), { letture: true });
  assert.equal(ramo(f).watt, null);
  assert.equal(ramo(f).ignoto, true);
});
