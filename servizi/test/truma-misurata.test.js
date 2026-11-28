// I watt della Truma, misurati invece che letti dal manuale.
//
// Il 28/11/2026, con il 220 del camper alimentato dalla Bluetti, i consumi
// della Combi si sono **misurati** leggendo il registro `[142]` della Bluetti
// e confrontandolo con la sua app nello stesso minuto:
//
//     fondo (Truma spenta)   0 W      app: 0 W
//     EL1                  885 W      app: 889 W
//     solo boiler          884 W      app: 884 W
//     EL2 (aria affamata) 1733 W      app: 1,8 kW
//
// Le due resistenze vengono fuori quasi gemelle, e nessuno dei due numeri e'
// stato scelto a mano: 1733 - 884 = 849 W per quella dell'aria, contro gli
// 885 W di quella dell'acqua da sola.
//
// In archivio c'erano 900 e 1800 «dal manuale Truma», **con la bandierina del
// misurato alzata**. E il file stesso, venti righe sopra, scrive la regola:
// «misurato = false vuol dire che il valore viene da un catalogo». Non era
// cosmetico: `ore_truma_el1` e `ore_truma_el2` decidono il bollino guardando
// quel campo, quindi la pagina ha scritto `misurato` su ore calcolate da un
// numero di catalogo.
//
// Si prova dalla migrazione invece che dalla tabella, perche' la tabella non
// e' esportata e perche' **il seme da solo non basta**: le righe esistono in
// produzione dal 16/11 e l'inserimento e' `ON CONFLICT DO NOTHING`, quindi un
// valore nuovo non arriverebbe mai da la'.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { archivio } from './aiuto/archivio-finto.js';

const { migrate } = await import('../src/lib/db.js');

// Le righe seminate, con i loro parametri: [chiave, valore, unita, nota, misurato].
async function seminate() {
  const fatte = archivio([]);
  await migrate();
  return fatte
    .filter(f => f.s.includes('INSERT INTO impianto'))
    .map(f => {
      const [chiave, valore, unita, nota, misurato] = f.parametri;
      return { chiave, valore, unita, nota, misurato };
    });
}

// Gli aggiornamenti mirati che la migrazione fa sulle righe gia' esistenti.
async function aggiornamenti() {
  const fatte = archivio([]);
  await migrate();
  return fatte.filter(f => f.s.includes('UPDATE impianto'));
}

const riga = (righe, chiave) => righe.find(r => r.chiave === chiave);

test('nessun valore di catalogo porta la bandierina del misurato', async () => {
  // **La prova che vale piu' di tutte, e non riguarda solo la Truma.** E' la
  // regola scritta nel file, resa controllabile: una nota che dice «dal
  // manuale» o «catalogo» non puo' stare accanto a `misurato: true`.
  //
  // `charger_w` non ci casca e non deve: la sua nota dice «Riferito il
  // 16/11/2026», ed e' un'osservazione sull'impianto vero, non un dato di
  // catalogo. Il file lo spiega.
  const righe = await seminate();
  // Senza questa riga la prova passerebbe **a vuoto** il giorno in cui
  // `migrate` cambiasse forma e non seminasse piu' niente: un ciclo su una
  // lista vuota non fallisce mai. E una prova che non puo' fallire e' peggio
  // che non averla, perche' si continua a crederle.
  assert.ok(righe.length > 10, `semina solo ${righe.length} righe: la prova girerebbe a vuoto`);
  for (const r of righe) {
    if (/manuale|catalogo/i.test(String(r.nota || ''))) {
      assert.equal(r.misurato, false,
        `«${r.chiave}» dice di venire da un catalogo e si dichiara misurato`);
    }
  }
});

test('i watt della Truma in archivio sono quelli misurati, non quelli del manuale', async () => {
  const righe = await seminate();
  assert.equal(riga(righe, 'truma_el1_w').valore, 889);
  assert.equal(riga(righe, 'truma_el2_w').valore, 1733);
  for (const chiave of ['truma_el1_w', 'truma_el2_w']) {
    assert.equal(riga(righe, chiave).misurato, true, `«${chiave}» non si dichiara misurato`);
    assert.doesNotMatch(riga(righe, chiave).nota, /manuale/i,
      `la nota di «${chiave}» dice ancora che viene dal manuale`);
    assert.match(riga(righe, chiave).nota, /28\/11\/2026/,
      `la nota di «${chiave}» non dice quando e’ stata presa la misura`);
  }
});

test('la nota di EL2 dice che e’ un campione solo', async () => {
  // Il proprietario ha scelto di scriverlo senza altre misure, dopo che gli
  // ho detto che 1733 contro i 1800 dell'app viene da **una** lettura. La
  // scelta e' sua; dire da dove viene il numero e' il mestiere della nota.
  // Senza questa riga, fra sei mesi 1733 sembrera' una misura ripetuta.
  const nota = riga(await seminate(), 'truma_el2_w').nota;
  assert.match(nota, /un solo campione|campione solo|una sola lettura/i,
    `la nota di EL2 non dice che dietro c’e’ una lettura sola: «${nota}»`);
});

test('il boiler da solo ha la sua riga: in EL2 la seconda resistenza non lavora', async () => {
  // Scoperto misurando: con l'abitacolo gia' a temperatura, EL2 **non**
  // consuma il doppio, perche' la resistenza dell'aria non ha lavoro. Sono
  // 885 W in qualunque modalita', ed e' la condizione piu' comune di una
  // notte in sosta. Senza questa riga il conto delle ore, in quello stato,
  // sbaglia di un fattore due -- e sbaglia verso il pessimismo in EL2.
  const r = riga(await seminate(), 'truma_boiler_w');
  assert.ok(r, 'manca la riga del boiler da solo');
  assert.equal(r.valore, 885);
  assert.equal(r.unita, 'W');
  assert.equal(r.misurato, true);
});

test('il rendimento dell’inverter prende il valore sotto carico, non il migliore', async () => {
  // Misurato il 28/11 ai due capi, confrontando i watt in uscita `[142]` con
  // quelli dal lato batteria `[101]`:
  //
  //     885 W in uscita  -> 973 W dalla batteria  = 0,91
  //    1733 W in uscita  -> 1986 W dalla batteria = 0,87
  //
  // **Dipende dal carico**, e un numero solo non lo rappresenta. Fra i due si
  // prende il **peggiore**, non la media e non il migliore: questo numero
  // divide un'autonomia, e un rendimento troppo generoso promette ore che non
  // ci sono. E' lo stesso verso di prudenza di `copreLaTappa` nei tracciati.
  //
  // E il carico alto e' proprio quello che interessa: la Truma in EL2.
  const r = riga(await seminate(), 'rendimento_inverter_bluetti');
  assert.equal(r.valore, 0.87,
    'un rendimento piu’ generoso di quello misurato sotto carico promette ore che non ci sono');
  assert.equal(r.misurato, true);
  assert.match(r.nota, /0[,.]91|885/,
    'la nota non dice che a carico basso il rendimento e’ migliore');
});

test('la migrazione porta i valori nuovi sulle righe che esistono gia’', async () => {
  // Il seme non basta: `ON CONFLICT DO NOTHING`, e quelle righe esistono dal
  // 16/11. Senza un aggiornamento mirato la correzione non arriverebbe mai in
  // produzione, e la prova qui sopra passerebbe mentendo.
  const fatti = await aggiornamenti();
  for (const [chiave, valore] of [['truma_el1_w', 889], ['truma_el2_w', 1733]]) {
    const suo = fatti.filter(f => f.parametri.includes(chiave));
    assert.ok(suo.length, `nessun aggiornamento per «${chiave}»`);
    assert.ok(suo.some(f => f.parametri.includes(valore)),
      `l’aggiornamento di «${chiave}» non porta ${valore}`);
  }
});

test('un valore cambiato a mano non si sovrascrive dall’alto', async () => {
  // La regola di questo archivio, scritta accanto al Charger: «un numero
  // scritto a mano dall'utente vale piu' di uno scritto dal codice, e non si
  // sovrascrive mai dall'alto». Quindi l'aggiornamento deve essere
  // **condizionato al valore di catalogo** che sta sostituendo: se lui ha
  // scritto 1500 perche' ha misurato a modo suo, resta 1500.
  const fatti = await aggiornamenti();
  for (const [chiave, catalogo] of [['truma_el1_w', 900], ['truma_el2_w', 1800]]) {
    const suo = fatti.filter(f => f.parametri.includes(chiave));
    assert.ok(suo.some(f => /valore\s*=\s*\$/.test(f.s) && f.parametri.includes(catalogo)),
      `l’aggiornamento di «${chiave}» non e’ condizionato al vecchio ${catalogo}: `
      + `sovrascriverebbe un numero scritto a mano`);
  }
});

// ---------------------------------------------------------------------------
// E le ore, perche' un valore in archivio che nessuno legge e' un mezzo lavoro
// ---------------------------------------------------------------------------
//
// `ore_truma_el1` e `ore_truma_el2` esistono gia'. La condizione nuova --
// l'acqua da sola, con l'aria a temperatura -- e' la piu' comune di una notte
// in sosta, e senza il suo conto la riga `truma_boiler_w` resterebbe un
// numero che nessuna pagina guarda.
import { archivio as arch2 } from './aiuto/archivio-finto.js';
const { tuttiIConti } = await import('../src/lib/conti.js');
const { dimenticaIlRiposo } = await import('../src/lib/consumo.js');

const IMPIANTO = [
  { chiave: 'bluetti_wh', valore: 3014, unita: 'Wh', nota: '', misurato: true },
  { chiave: 'truma_el1_w', valore: 889, unita: 'W', nota: '', misurato: true },
  { chiave: 'truma_el2_w', valore: 1733, unita: 'W', nota: '', misurato: true },
  { chiave: 'truma_boiler_w', valore: 885, unita: 'W', nota: '', misurato: true },
  { chiave: 'rendimento_inverter_bluetti', valore: 0.87, unita: '', nota: '', misurato: true },
];

const contiCon = async (impianto = IMPIANTO) => {
  dimenticaIlRiposo();
  arch2([
    ['FROM impianto', impianto],
    ['FROM istantanee', []],
    ['FROM misure', []],
  ]);
  return tuttiIConti({ apparecchi: [{ sn: 'EL300', nome: 'Elite 300', carica: 100 }] });
};

test('le ore col solo boiler si contano, come quelle dei due livelli', async () => {
  const c = await contiCon();
  assert.ok(c.ore_truma_boiler, 'manca il conto delle ore col solo boiler');
  // 3014 Wh pieni, inverter a 0,87, 885 W di resistenza: circa 2,96 ore.
  assert.ok(Math.abs(c.ore_truma_boiler.valore - 3014 * 0.87 / 885) < 0.01,
    `ore col boiler: ${c.ore_truma_boiler.valore}`);
});

test('col boiler da solo si sta accesi piu’ a lungo che in EL2, e il doppio e’ l’errore da evitare', async () => {
  // La ragione per cui questa riga esiste: con l'aria a temperatura, EL2 **non**
  // consuma il doppio. Chi usasse `truma_el2_w` in quello stato dimezzerebbe
  // l'autonomia vera -- e sbaglierebbe verso il pessimismo, che e' meno
  // pericoloso dell'altro verso ma e' comunque un numero falso.
  const c = await contiCon();
  assert.ok(c.ore_truma_boiler.valore > c.ore_truma_el2.valore * 1.8,
    'le ore col solo boiler non sono quasi il doppio di quelle in EL2');
});

test('le ore della Truma adesso si dichiarano misurate, e per la ragione giusta', async () => {
  // Prima il bollino diceva `misurato` guardando un valore che la sua stessa
  // nota dichiarava preso dal manuale. Adesso dice il vero.
  const c = await contiCon();
  for (const k of ['ore_truma_el1', 'ore_truma_el2', 'ore_truma_boiler'])
    assert.equal(c[k].base, 'misurato', `«${k}» non si dichiara misurato`);
});

test('se i watt della Truma non ci sono, le ore non si inventano', async () => {
  const c = await contiCon(IMPIANTO.filter(r => r.chiave !== 'truma_boiler_w'));
  assert.equal(c.ore_truma_boiler.valore, null,
    'ha calcolato le ore col solo boiler senza avere i suoi watt');
});

// ---------------------------------------------------------------------------
// E in pagina, dove il numero sbagliato si leggeva a occhio
// ---------------------------------------------------------------------------
//
// Le due righe della Truma portavano l'etichetta «A 900 W — EL 1 e MIX 1» e
// «A 1800 W — EL 2 e MIX 2»: **numeri battuti a mano nel testo**, che adesso
// non corrispondono piu' al valore con cui il conto e' fatto (889 e 1733).
//
// Un watt scritto nell'etichetta e' una copia che puo' divergere, ed e'
// diversa dal valore vero per definizione il giorno in cui qualcuno misura.
// I watt veri stanno gia' nella spiegazione del conto (`perche`), che li
// prende dall'archivio: nell'etichetta non ci devono stare.
import { readFileSync } from 'node:fs';
const sorgente = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');

test('l’etichetta della Truma non porta i watt battuti a mano', () => {
  assert.doesNotMatch(sorgente, /A 900 W/,
    'l’etichetta dice ancora «A 900 W»: un numero di catalogo copiato nel testo');
  assert.doesNotMatch(sorgente, /A 1800 W/,
    'l’etichetta dice ancora «A 1800 W», mentre il conto usa 1733');
});

test('le tre righe della Truma si disegnano, boiler compreso', () => {
  for (const k of ['ore_truma_el1', 'ore_truma_el2', 'ore_truma_boiler'])
    assert.match(sorgente, new RegExp(`c\\.${k}\\b`),
      `la pagina non disegna «${k}»: sarebbe un conto che nessuno vede`);
});
