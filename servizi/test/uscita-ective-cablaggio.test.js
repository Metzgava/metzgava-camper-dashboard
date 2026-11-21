// Il cablaggio, non la funzione pura.
//
// La funzione pura e' provata in `uscita-ective.test.js`. Qui si prova quel
// che sta fra lei e la pagina, ed e' dove si sbaglia davvero: il nome di una
// colonna nella query, un campo che la scatoletta chiama diversamente, un
// conto che resta la frase di prima perche' nessuno l'ha ricablato.
//
// Il 20/11/2026 `tempo_residuo_ective` era ancora «arriva quando la scatoletta
// sara' a bordo» con la scatoletta a bordo da un giorno. Una prova come questa
// l'avrebbe preso.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { archivio } from './aiuto/archivio-finto.js';

const { tuttiIConti } = await import('../src/lib/conti.js');

// Due batterie come le manda la scatoletta, con i nomi veri.
// `quando2` serve a datare **una sola** delle due: e' il caso in cui una
// batteria ha smesso di rispondere e resta in `istantanee` coi suoi numeri di
// prima, mentre l'altra e' fresca. La somma di due istanti lontani non e' una
// fotografia sola, ed e' la trappola che il 19/11/2026 ha prodotto
// «esce 0 W, arriva 201 W» fra Bluetti ed Ective -- qui dentro lo stesso pacco.
const istantanee = (ampere1, ampere2, quando = new Date().toISOString(),
                    quando2 = quando) => [
  { apparecchio: 'NWJ20220412010310', quando,
    dati: { volt: 13.1, ampere: ampere1, carica: 80, capacita_ah: 95,
            celle_mv: [3275, 3276, 3274, 3275], watt: 13.1 * ampere1 } },
  { apparecchio: 'NWJ20220412010323', quando: quando2,
    dati: { volt: 13.1, ampere: ampere2, carica: 80, capacita_ah: 95,
            celle_mv: [3275, 3275, 3276, 3274], watt: 13.1 * ampere2 } },
];

// Lo SmartSolar come lo manda la scatoletta: non e' una batteria (non ha
// `celle_mv`), e si riconosce da `pannelli_w`. I watt li ricava `pot()` da
// volt per ampere, quindi i tre numeri devono essere coerenti fra loro.
const smartSolar = (watt, quando = new Date().toISOString()) => ({
  apparecchio: 'SmartSolar', quando,
  dati: { volt: 13.5, ampere: watt / 13.5, pannelli_w: watt },
});

const impianto = [
  { chiave: 'ective_ah', valore: 190, unita: 'Ah', nota: '', misurato: true },
  { chiave: 'ective_v', valore: 12.8, unita: 'V', nota: '', misurato: true },
];

const conti = async righe => {
  archivio([
    ['FROM impianto', impianto],
    ['FROM istantanee', righe],
  ]);
  return tuttiIConti(null);
};

test('due batterie che scaricano: i watt arrivano in pagina', async () => {
  const c = await conti(istantanee(-6, -4));
  // 13,1 x 10 = 131 W
  assert.ok(Math.abs(c.consumo_ective.valore - 131) < 0.5,
    `valore = ${c.consumo_ective.valore}`);
  assert.equal(c.consumo_ective.base, 'misurato');
  assert.match(c.consumo_ective.detto, /131 W/);
});

test('la spiegazione nomina entrambe le batterie coi loro ampere', async () => {
  const c = await conti(istantanee(-6, -4));
  assert.match(c.consumo_ective.perche, /NWJ20220412010310/);
  assert.match(c.consumo_ective.perche, /NWJ20220412010323/);
  assert.match(c.consumo_ective.perche, /-6[.,]00 A/);
});

test('l’autonomia non e’ piu’ una promessa: e’ un numero misurato', async () => {
  const c = await conti(istantanee(-6, -4));
  // 2 x (95 x 0,80 x 13,1) = 1991 Wh a 131 W -> circa 15 ore
  assert.ok(c.tempo_residuo_ective.valore > 14 && c.tempo_residuo_ective.valore < 16,
    `ore = ${c.tempo_residuo_ective.valore}`);
  assert.equal(c.tempo_residuo_ective.base, 'misurato');
  assert.ok(c.tempo_residuo_ective.detto, 'deve avere un «detto» da mostrare');
  // La frase che c'era prima non deve piu' comparire da nessuna parte.
  assert.doesNotMatch(c.tempo_residuo_ective.perche, /sarà a bordo|sara’ a bordo/);
});

test('batterie in carica: niente esce, e non e’ un dato che manca', async () => {
  const c = await conti(istantanee(11, 9));
  assert.equal(c.consumo_ective.valore, 0);
  assert.equal(c.consumo_ective.detto, 'niente esce');
  // L'autonomia non si da', ma il motivo e' «non esce niente», non «manca una
  // lettura»: sono due caselle vuote che vogliono dire cose opposte.
  assert.equal(c.tempo_residuo_ective.valore, null);
  assert.match(c.tempo_residuo_ective.perche, /non esce niente/);
  assert.deepEqual(c.tempo_residuo_ective.mancano, []);
});

test('senza istantanee resta un «manca», con scritto cosa manca', async () => {
  const c = await conti([]);
  assert.equal(c.consumo_ective.valore, null);
  assert.equal(c.consumo_ective.base, 'incompleto');
  assert.deepEqual(c.consumo_ective.mancano, ['letture delle Ective']);
});

test('letture vecchie: il numero resta, con la sua eta’', async () => {
  const unOra = new Date(Date.now() - 60 * 60000).toISOString();
  const c = await conti(istantanee(-6, -4, unOra));
  // Il valore non si nasconde: era vero, di un'ora fa. E' l'eta' che va detta.
  assert.ok(Math.abs(c.consumo_ective.valore - 131) < 0.5);
  assert.equal(c.consumo_ective.vecchia, true);
  assert.ok(c.consumo_ective.eta_minuti > 55);
});

test('letture fresche non sono vecchie', async () => {
  const c = await conti(istantanee(-6, -4));
  assert.equal(c.consumo_ective.vecchia, false);
  assert.ok(c.consumo_ective.eta_minuti < 2);
});

// ---------------------------------------------------------------------------
// I due versi vengono dallo stesso netto
// ---------------------------------------------------------------------------
//
// Disegno: docs/superpowers/specs/2026-11-21-potenza-netta-ective-design.md
//
// Qui c'era la prova «la figura della carica non e' stata toccata», che
// pinnava `fonti_ective` alla **somma delle positive** e diceva nel suo
// commento: «se un giorno si unificano i due versi, questa prova cade per
// prima e dice che quel disegno sta cambiando». Il 21/11/2026 e' quel giorno,
// e il disegno sta cambiando perche' quella somma dava due numeri falsi.

test('una carica e l’altra scarica: in ingresso e’ il NETTO, non la somma delle positive', async () => {
  // Prima di oggi: 13,1 x 11 = 144 W «in ingresso» col bollino misurato,
  // mentre nel pacco ne entrano 92. I 52 W di differenza non entrano da
  // nessuna parte: si spostano da una batteria all'altra.
  const c = await conti(istantanee(11, -4));
  assert.ok(Math.abs(c.fonti_ective.valore - 13.1 * 7) < 0.5,
    `fonti_ective = ${c.fonti_ective.valore}`);
  // E il verso in uscita non si muove di un watt: e' il non obiettivo.
  assert.equal(c.consumo_ective.valore, 0);
});

test('pacco in scarica: in ingresso e’ uno ZERO MISURATO, non un «non so»', async () => {
  const c = await conti(istantanee(-6, -4));
  assert.equal(c.fonti_ective.valore, 0);
  assert.equal(c.fonti_ective.base, 'misurato');
  assert.deepEqual(c.fonti_ective.mancano, []);
  // Il 21/11/2026 qui si leggeva «oggi nessuno misura la loro corrente»,
  // mentre la corrente la misuravamo: era negativa.
  assert.doesNotMatch(c.fonti_ective.perche, /nessuno misura/);
});

test('il ramo dedotto della 220 e’ IGNOTO quando il pacco non carica, non zero', async () => {
  // Si ottiene per differenza da quel che entra; se non entra niente, la
  // differenza non esiste. Uno zero direbbe «ho escluso la 220», e non
  // l'abbiamo esclusa: un caricatore da 50 W con i consumi a 100 non si vede.
  const c = await conti(istantanee(-6, -4));
  assert.equal(c.fonti_ective.rete_w, null);
});

test('sole e alternatore restano misurati anche mentre il pacco scarica', async () => {
  const c = await conti([...istantanee(-6, -4), smartSolar(8)]);
  assert.ok(Math.abs(c.fonti_ective.sole_w - 8) < 1,
    `sole_w = ${c.fonti_ective.sole_w}`);
});

test('senza letture «in ingresso» resta un «manca», con scritto cosa manca', async () => {
  const c = await conti([]);
  assert.equal(c.fonti_ective.valore, null);
  assert.equal(c.fonti_ective.base, 'incompleto');
  assert.deepEqual(c.fonti_ective.mancano, ['letture delle Ective']);
});

test('due letture lontane: «in ingresso» porta l’avviso, come fa l’uscita', async () => {
  // Nasce dallo stesso netto, quindi eredita la stessa fragilita': se le due
  // batterie sono state lette a venti minuti di distanza, quel netto mescola
  // due momenti. L'avviso c'era solo sull'uscita.
  const adesso = new Date().toISOString();
  const venti = new Date(Date.now() - 20 * 60000).toISOString();
  const c = await conti(istantanee(-6, -4, adesso, venti));
  assert.match(c.fonti_ective.avviso, /non sono state lette insieme/);
});

test('i numeri della spiegazione si scrivono all’italiana, con la virgola', async () => {
  // Il 20/11/2026 la pagina mostrava «13.08 V, -8.40 A» nella ripartizione e
  // «13,08 V · -8,40 A» nel quadrante due centimetri sopra, perche' qui
  // scrivevo con `toFixed`. Due forme per lo stesso numero nella stessa
  // scheda sembrano un guasto.
  //
  // La virgola si mette a mano invece che con `toLocaleString`: quello dipende
  // dai dati di lingua compilati in Node, e un server con l'ICU ridotto
  // tornerebbe il punto senza protestare.
  const c = await conti(istantanee(-8.4, -3.2));
  assert.match(c.consumo_ective.perche, /13,10 V/);
  assert.match(c.consumo_ective.perche, /-8,40 A/);
  assert.doesNotMatch(c.consumo_ective.perche, /\d\.\d/);
});

// Il caso «mezzo pacco», scritto bene alla seconda stesura.
//
// La prima prova modellava una riga senza volt ne' ampere, e non scattava mai:
// `istantanee` tiene l'**ultima** lettura di ciascun apparecchio, quindi una
// batteria che smette di rispondere non sparisce e non resta senza numeri --
// resta li' con quelli di prima, e invecchia da sola mentre l'altra e' fresca.
//
// Sommarle da' un netto fatto con due istanti diversi: lo stesso errore che il
// 19/11 ha prodotto «esce 0 W, arriva 201 W» fra Bluetti e Ective, qui dentro
// lo stesso pacco. E sbaglia nella direzione ottimista, perche' la batteria
// ferma porta il consumo di quando andava tutto bene.

test('due batterie lette a dieci minuti di distanza: lo si dice', async () => {
  const righe = istantanee(-8.4, -3.2);
  righe[1].quando = new Date(Date.now() - 40 * 60000).toISOString();
  const c = await conti(righe);
  assert.ok(c.consumo_ective.avviso, 'deve esserci un avviso');
  assert.match(c.consumo_ective.avviso, /istant|distanza|minut/i);
});

test('l’avviso vale anche sull’autonomia, che e’ dove fa danno', async () => {
  // Un consumo preso male vuol dire ore sbagliate: e' l'errore che fa restare
  // fermi una notte in piu' contando su ore che non ci sono.
  const righe = istantanee(-8.4, -3.2);
  righe[1].quando = new Date(Date.now() - 40 * 60000).toISOString();
  const c = await conti(righe);
  assert.ok(c.tempo_residuo_ective.avviso);
});

test('letture dello stesso giro non sono due istanti diversi', async () => {
  // Due minuti di scarto sono il passo normale della scatoletta, non un
  // guasto: un avviso che compare sempre e' un avviso che nessuno legge.
  const righe = istantanee(-8.4, -3.2);
  righe[1].quando = new Date(Date.now() - 2 * 60000).toISOString();
  const c = await conti(righe);
  assert.equal(c.consumo_ective.avviso, null);
});

test('col pacco letto insieme non c’e’ nessun avviso da dare', async () => {
  const c = await conti(istantanee(-8.4, -3.2));
  assert.equal(c.consumo_ective.avviso, null);
  assert.equal(c.tempo_residuo_ective.avviso, null);
});
