// L'istantanea e' quel che l'app mostra nel riquadro «adesso». Lo storico e'
// protetto da `AMMESSE`: una lettura fuori scala non si scrive, misura per
// misura, con una riga negli eventi. L'istantanea no: fino al 19/11 si
// scriveva due righe prima del controllo, intera e senza guardarla.
//
// Quindi un numero assurdo veniva **rifiutato dai grafici e mostrato in
// pagina**. Trovato il 19/11: un termometro del quartiere diceva 127.0 gradi
// (non una temperatura: il valore che quei sensori mandano quando non hanno
// una lettura). Quello era di un estraneo e la scatoletta lo scarta da se',
// ma la stessa strada e' aperta a tutti gli apparecchi veri — Victron,
// Ective, Bluetti — il giorno che un decodificatore perde un byte.
//
// Qui si butta solo il valore sbagliato, non tutta la lettura, al contrario di
// quel che fa la scatoletta. Non e' incoerenza: la scatoletta sa che un byte
// perso sposta i byte dopo **nello stesso pacchetto**, e butta il pacchetto.
// Il server riceve campi gia' decodificati da apparecchi diversi e non puo'
// fare quella deduzione: tolto il valore assurdo, il resto resta buono. E un
// valore assente e' onesto — «non si sa» — mentre un valore sbagliato no.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { archivio } from './aiuto/archivio-finto.js';

process.env.INGEST_TOKEN = 'chiave-di-prova';
const { setaccia, router } = await import('../src/routes/ingresso.js');

test('un valore fuori scala non entra nell’istantanea', () => {
  const { puliti } = setaccia({ volt: 999, carica: 80 });
  assert.equal(puliti.volt, undefined);
  assert.equal(puliti.carica, 80);
});

test('dice quali valori ha tolto, per la riga negli eventi', () => {
  const { fuori } = setaccia({ temperatura: 127.0 });
  assert.deepEqual(fuori, ['temperatura=127']);
});

test('una lettura credibile passa intatta', () => {
  const dentro = { volt: 13.2, carica: 84, temperatura: 7.5 };
  const { puliti, fuori } = setaccia(dentro);
  assert.deepEqual(puliti, dentro);
  assert.deepEqual(fuori, []);
});

test('una grandezza senza scala passa intatta', () => {
  // Nell’istantanea ci sono anche cose che non sono misure: lo stato del
  // caricabatterie, l’elenco delle tensioni di cella, il nome. Non avere un
  // limite per loro non e' un motivo per toglierle.
  const { puliti, fuori } = setaccia({ stato: 'in carica', celle_mv: [3301, 3299] });
  assert.equal(puliti.stato, 'in carica');
  assert.deepEqual(puliti.celle_mv, [3301, 3299]);
  assert.deepEqual(fuori, []);
});

test('gli estremi della scala sono buoni', () => {
  const { fuori } = setaccia({ temperatura: -40, umidita: 100, rssi: -120 });
  assert.deepEqual(fuori, []);
});

test('un valore che non e’ un numero viene tolto', () => {
  const { puliti, fuori } = setaccia({ volt: 'tredici' });
  assert.equal(puliti.volt, undefined);
  assert.equal(fuori.length, 1);
});

test('un valore assente resta assente, non diventa zero', () => {
  // `agente.py` mette `null` dove l’apparecchio non ha risposto: e' la prima
  // regola del progetto, un valore che non si sa non si inventa. `Number(null)`
  // fa 0, che e' dentro quasi tutte le scale: senza un controllo esplicito un
  // «non lo so» passerebbe per uno zero credibile.
  const { puliti, fuori } = setaccia({ volt: null, ampere: undefined });
  assert.equal(puliti.volt, null);
  assert.deepEqual(fuori, []);
});

test('non modifica la lettura che riceve', () => {
  const dentro = { volt: 999 };
  setaccia(dentro);
  assert.equal(dentro.volt, 999);
});

// --- e adesso la parte che conta: che la rotta la usi davvero ---

function manoDellaRotta() {
  // Si pesca il gestore del POST dalla pila del router invece di far partire
  // un server: una funzione di controllo perfetta e non collegata e' il
  // difetto piu' facile da scrivere e il piu' difficile da vedere.
  for (const strato of router.stack) {
    if (strato.route && strato.route.path === '/' && strato.route.methods.post) {
      return strato.route.stack[strato.route.stack.length - 1].handle;
    }
  }
  throw new Error('non trovo il gestore del POST');
}

test('la rotta scrive l’istantanea senza il valore assurdo', async () => {
  const fatte = archivio([]);
  const gestore = manoDellaRotta();
  const req = {
    body: {
      fonte: 'scatoletta',
      apparecchi: [{
        id: 'victron-solare', nome: 'SmartSolar', tipo: 'victron',
        dati: { volt: 13.4, pannelli_w: 99999 },
        misure: { volt: 13.4, pannelli_w: 99999 },
      }],
    },
    get: () => 'Bearer chiave-di-prova',
  };
  let risposta = null;
  const res = { json: d => { risposta = d; }, status() { return this; } };
  await gestore(req, res, e => { throw e; });

  const istantanea = fatte.find(f => f.s.includes('INSERT INTO istantanee'));
  assert.ok(istantanea, 'nessuna istantanea scritta');
  const dati = istantanea.parametri[2];
  assert.equal(dati.volt, 13.4, 'il valore buono deve restare');
  assert.equal(dati.pannelli_w, undefined,
    'i 99999 W sono finiti nell’istantanea: e’ quel che l’app mostra');
  assert.ok(risposta && risposta.ok);
});
