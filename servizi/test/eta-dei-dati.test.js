// L'orario in testata diceva una cosa e ne sembrava un'altra.
//
// In cima alla pagina c'era «letto alle 12:43», e nel server quel valore era
// `letto_il: new Date()` -- **l'istante in cui il server ha composto la
// risposta**. Cioe': quanto fa hai ricaricato la pagina. Dell'eta' dei dati
// del camper non diceva niente.
//
// Il 28/11/2026 il proprietario ha guardato quell'orario per sapere se la
// scatoletta stesse mandando, dopo un cambio di SIM. Gliel'avevo chiesto io.
// Diceva 12:43 ed erano le 12:43:59: sembrava la conferma che tutto andava, e
// non era una conferma di niente.
//
// E' il verso sbagliato -- quello che rassicura -- lo stesso del quadrante
// fermo al 100% mentre la Bluetti erogava 400 W. Un numero vecchio accanto a
// un'etichetta che suona fresca e' peggio di nessun numero: nessuno lo mette
// in dubbio.
//
// La pagina **aveva gia'** il meccanismo onesto: la riga ambra nel riquadro
// delle batterie, «Non e' di adesso: l'ultima lettura e' di tot minuti fa».
// Ma stava in basso dentro un riquadro, mentre in cima c'era un orario che
// rassicurava.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { etaDeiDati } from '../src/lib/eta-dati.js';

const ADESSO = new Date('2026-11-28T12:43:59Z');
const fa = minuti => new Date(ADESSO.getTime() - minuti * 60000);

// `fonte` la sceglie la scatoletta (`conf["nome"]`), quindi non si puo'
// scrivere nel codice quale sia. Si sa invece con certezza quale **non** e':
// il cloud Bluetti scrive sempre `'bluetti'`.
const dalCamper = (minuti, fonte = 'bergava-scatoletta') =>
  ({ apparecchio: 'x', fonte, quando: fa(minuti) });
const dalCloud = minuti => ({ apparecchio: 'EL300', fonte: 'bluetti', quando: fa(minuti) });

test('l’eta’ e’ quella della lettura piu’ fresca arrivata dal camper', () => {
  const e = etaDeiDati([dalCamper(2), dalCamper(40)], ADESSO);
  assert.equal(e.eta_minuti, 2);
});

test('il cloud Bluetti non conta: non dice niente sulla scatoletta', () => {
  // **La prova che regge tutto.** Il cloud puo' essere freschissimo mentre la
  // scatoletta tace da un'ora: sono due strade diverse, e il cloud non passa
  // dal camper. Contarlo rifarebbe esattamente il difetto che si sta
  // togliendo, un piano piu' in basso.
  const e = etaDeiDati([dalCloud(0), dalCamper(55)], ADESSO);
  assert.equal(e.eta_minuti, 55);
});

test('una scatoletta che si chiama in un altro modo conta lo stesso', () => {
  // Il nome sta in `config.json` e lui lo puo' cambiare. La regola e'
  // negativa apposta: tutto quel che non e' `bluetti` viene dal camper.
  assert.equal(etaDeiDati([dalCamper(3, 'scatoletta-nuova')], ADESSO).eta_minuti, 3);
});

test('senza nessuna lettura dal camper l’eta’ e’ null, non zero', () => {
  // Zero vorrebbe dire «freschissima». La verita' e' «non ne ho mai avute»,
  // ed e' un'altra affermazione.
  const e = etaDeiDati([dalCloud(1)], ADESSO);
  assert.equal(e.eta_minuti, null);
  assert.equal(e.quando, null);
});

test('un elenco vuoto non fa esplodere niente', () => {
  assert.equal(etaDeiDati([], ADESSO).eta_minuti, null);
  assert.equal(etaDeiDati(null, ADESSO).eta_minuti, null);
});

test('una data storta si salta invece di diventare un’eta’ assurda', () => {
  const e = etaDeiDati([{ fonte: 'x', quando: 'non una data' }, dalCamper(7)], ADESSO);
  assert.equal(e.eta_minuti, 7);
});

test('un orologio avanti non produce un’eta’ negativa', () => {
  // La scatoletta e il server hanno due orologi. Un «dati di -3 minuti fa»
  // non si puo' leggere, e non e' un errore che valga la pena mostrare.
  assert.equal(etaDeiDati([dalCamper(-3)], ADESSO).eta_minuti, 0);
});

// ---------------------------------------------------------------------------
// E in pagina
// ---------------------------------------------------------------------------

const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');

test('in testata non c’e’ piu’ «letto alle»', () => {
  // Si cerca la **stringa nel codice**, con il suo apice, non la frase: nel
  // commento sopra la funzione quella frase va citata, perche' e' il difetto
  // che il commento racconta. Una prova che vietasse anche di nominarlo
  // costringerebbe a cancellare la spiegazione per far passare la prova.
  assert.doesNotMatch(app, /'letto alle/,
    'la testata compone ancora «letto alle», che e’ quando hai ricaricato, non l’eta’ dei dati');
});

test('la testata mostra l’eta’ dei dati del camper', () => {
  assert.match(app, /dati_eta_minuti/,
    'la testata non usa l’eta’ delle letture del camper');
});

test('quando non e’ mai arrivato niente lo si dice, invece di tacere', () => {
  assert.match(app, /nessun dato dal camper/i);
});

test('nessuno scrive «fa» dopo dilloInMinuti, che ce l’ha gia’ dentro', () => {
  // Trovato guardando la pagina vera: la testata diceva «dati di 7 giorni fa
  // **fa**». `dilloInMinuti` restituisce gia' «... fa» in tutti i suoi rami,
  // e aggiungerne un altro e' un errore che si fa una volta per ogni posto
  // in cui la si chiama. Le prove sui valori non lo vedono: il numero era
  // giusto.
  assert.doesNotMatch(app, /dilloInMinuti\([^)]*\)\}\s*fa\b/,
    'da qualche parte si scrive «fa» dopo dilloInMinuti, che lo mette gia’ lei');
});
