// La dichiarazione sull'autostrada entra nella RICHIESTA, non filtra un
// risultato.
//
// Disegno: docs/superpowers/specs/2026-11-22-pedaggi-dichiarati-design.md
//
// L'alternativa era calcolare le due strade come prima e tenere quella che
// corrisponde a quel che e' stato dichiarato. Ha un buco: la variante senza
// pedaggi entra nell'elenco **solo se differisce** dalla piu' rapida, quindi
// «nessuna candidata senza pedaggi» vorrebbe dire due cose opposte -- *non
// esiste una strada senza pedaggi*, oppure *la piu' rapida gia' non ne fa*.
// E paga un calcolo per buttarlo via: con otto luoghi dichiarati i pezzi di
// strada sono nove, e sarebbero diciotto richieste invece di nove.
//
// La rete non si tocca: i servizi dei percorsi arrivano da finti, perche' una
// suite che li martella e' un modo di farseli chiudere.
import test from 'node:test';
import assert from 'node:assert/strict';
import { variantiTratto, percorsiConTappe, percorsoPerIPunti } from '../src/lib/geo.js';

const NOVALEDO = { lat: 46.0167, lon: 11.3167 };
const VIDOR = { lat: 45.8833, lon: 12.0167 };
const UDINE = { lat: 46.0633, lon: 13.2358 };

// I finti: `ors` segna cosa le e' stato chiesto di evitare. `sannoEvitare`
// finge la chiave del servizio, che nell'ambiente di prova non c'e'.
const finti = () => {
  const chiesto = [];
  const ors = async (from, to, evitare = []) => {
    chiesto.push(evitare);
    return { distance_km: evitare.length ? 230 : 190, duration_min: evitare.length ? 200 : 120,
             pedaggio_km: evitare.length ? 0 : 54, geometry: [[46, 11], [46, 13]] };
  };
  const veloce = async () => { throw new Error('non si deve passare da OSRM'); };
  return { chiesto, ors, veloce, sannoEvitare: true };
};

test('dichiarato «no», si chiede la strada che evita i pedaggi — una sola volta', async () => {
  const f = finti();
  const v = await variantiTratto(NOVALEDO, UDINE, { pedaggi: 'no', ...f });
  assert.deepEqual(f.chiesto, [['tollways']], 'ha chiesto anche la strada che non serviva');
  assert.equal(v.length, 1);
  assert.equal(v[0].evita_pedaggi, true);
});

test('dichiarato «si», si chiede la piu’ rapida e basta', async () => {
  const f = finti();
  const v = await variantiTratto(NOVALEDO, UDINE, { pedaggi: 'si', ...f });
  assert.deepEqual(f.chiesto, [[]]);
  assert.equal(v.length, 1);
  assert.ok(!v[0].evita_pedaggi);
});

test('senza dichiarazione si comporta come prima: due candidate', async () => {
  const f = finti();
  const v = await variantiTratto(NOVALEDO, UDINE, { ...f });
  assert.equal(f.chiesto.length, 2, 'non chiede piu’ le due strade da confrontare');
  assert.equal(v.length, 2);
});

test('se la strada senza pedaggi non si ottiene, lo dice invece di far finta', async () => {
  // Review Focus 4. Dopo un «no», tornare la piu' rapida **in silenzio** e' la
  // direzione rassicurante dell'errore: questo lavoro esiste per chiuderla.
  // La riga si disegna comunque -- i luoghi dichiarati valgono -- ma porta il
  // segno che quel che si e' chiesto non si e' ottenuto.
  const ors = async (f, t, evitare = []) => {
    if (evitare.length) throw new Error('rifiutato');
    return { distance_km: 190, duration_min: 120, pedaggio_km: 54, geometry: [[46, 11], [46, 13]] };
  };
  const v = await variantiTratto(NOVALEDO, UDINE,
    { pedaggi: 'no', ors, veloce: async () => { throw new Error('nemmeno OSRM'); }, sannoEvitare: true });
  assert.equal(v.length, 1);
  assert.equal(v[0].senza_pedaggi_mancata, true, 'la strada con i pedaggi passa per quella senza');
  assert.ok(!v[0].evita_pedaggi, 'si spaccia per una strada senza pedaggi');
});

test('senza la chiave del servizio un «no» non si puo’ chiedere, e si vede', async () => {
  // Senza chiave resta OSRM, che la strada senza pedaggi non la sa evitare --
  // e **dei pedaggi non sa dire niente**. Quindi `pedaggio_km` e' sconosciuto,
  // e dedurre dal numero che la dichiarazione sia stata onorata rimetterebbe
  // dentro l'autostrada silenziosa. Il segno esplicito e' quel che lo impedisce.
  const chiesto = [];
  const ors = async (from, to, evitare = []) => { chiesto.push(evitare); return {}; };
  const veloce = async () => ({ distance_km: 190, duration_min: 120, geometry: [[46, 11], [46, 13]] });
  const v = await variantiTratto(NOVALEDO, UDINE, { pedaggi: 'no', ors, veloce, sannoEvitare: false });
  assert.deepEqual(chiesto, [], 'ha chiesto a un servizio di cui non si ha la chiave');
  assert.equal(v[0].senza_pedaggi_mancata, true);
  assert.equal(v[0].pedaggio_km, undefined, 'si inventa uno zero dove non sa');
});

test('la dichiarazione arriva fino alle tratte di un percorso con punti', async () => {
  const visti = [];
  const varianti = async (from, to, opz = {}) => {
    visti.push(opz.pedaggi);
    return [{ chiave: 'senza_pedaggi', nome: 'Senza pedaggi', evita_pedaggi: true,
              distance_km: 100, duration_min: 90, pedaggio_km: 0, geometry: [[46, 11], [46, 12]] }];
  };
  const r = await percorsiConTappe([NOVALEDO, VIDOR, UDINE], { pedaggi: 'no', varianti });
  assert.deepEqual(visti, ['no', 'no'], 'un pezzo di strada e’ stato calcolato senza la dichiarazione');
  // La chiave con cui si rimettono insieme le tratte **non** e' piu' 'rapido':
  // con quella, `t.find(...) || t[0]` ripesca la strada giusta ma la chiama
  // «Il piu' rapido», cioe' disegna bene e racconta male.
  assert.equal(r.length, 1, 'dichiarato «no» resta una candidata sola');
  assert.equal(r[0].chiave, 'senza_pedaggi');
  assert.equal(r[0].evita_pedaggi, true);
  assert.equal(r[0].pedaggio_km, 0, 'uno zero che si conosce, non un campo vuoto');
});

test('la strada mancata si porta dietro anche quando e’ un pezzo solo', async () => {
  // Nove pezzi e uno che non si e' potuto evitare: la tappa ha i pedaggi.
  const varianti = async (from, to) => [{
    chiave: from === VIDOR ? 'rapido' : 'senza_pedaggi',
    evita_pedaggi: from !== VIDOR, senza_pedaggi_mancata: from === VIDOR,
    distance_km: 100, duration_min: 90, pedaggio_km: from === VIDOR ? 12 : 0,
    geometry: [[46, 11], [46, 12]],
  }];
  const r = await percorsiConTappe([NOVALEDO, VIDOR, UDINE], { pedaggi: 'no', varianti });
  assert.equal(r[0].senza_pedaggi_mancata, true, 'un pezzo con pedaggi sparisce dal racconto');
});

test('percorsoPerIPunti passa la dichiarazione a chi calcola', async () => {
  let vista;
  const percorsi = async (punti, opz = {}) => {
    vista = opz.pedaggi;
    return [{ chiave: 'senza_pedaggi', nome: 'Senza pedaggi', distance_km: 190, duration_min: 140,
              pedaggio_km: 0, tratte: [{ distance_km: 190, duration_min: 140, geometry: [[46, 11], [46, 13]] }] }];
  };
  await percorsoPerIPunti(NOVALEDO, [VIDOR], UDINE, 187, 142, { percorsi, pedaggi: 'no' });
  assert.equal(vista, 'no');
});

// ---------------------------------------------------------------------------
// Un pezzo di strada di cui non si sanno i pedaggi non vale zero
// ---------------------------------------------------------------------------
//
// Trovato il 22/11/2026 dalla revisione. La somma dei chilometri a pedaggio
// diceva «conosciuta» appena **un** pezzo lo era, e ogni pezzo ignoto ci
// metteva dentro uno zero. Con quattro pezzi, tre senza pedaggi da
// OpenRouteService e uno di ripiego da OSRM -- che dei pedaggi non sa niente
// -- il totale usciva `0`: e da li' la stima del pedaggio spariva e il totale
// del viaggio scendeva, su un quarto di strada che nessuno ha misurato.
//
// `0` vuol dire «uno zero che conosco». Fabbricarlo da un «non so» e' il
// difetto contro cui questo programma e' costruito.
test('un pezzo di strada senza pedaggi noti rende ignoto tutto il totale', async () => {
  const varianti = async from => [{
    chiave: 'senza_pedaggi', evita_pedaggi: true, distance_km: 50, duration_min: 45,
    // Il secondo pezzo e' di ripiego: OSRM non dice niente sui pedaggi.
    pedaggio_km: from === VIDOR ? undefined : 0, geometry: [[46, 11], [46, 12]],
  }];
  const r = await percorsiConTappe([NOVALEDO, VIDOR, UDINE], { pedaggi: 'no', varianti });
  assert.equal(r[0].pedaggio_km, null,
    'uno zero fabbricato da un pezzo di strada che nessuno ha misurato');
});

test('quando tutti i pezzi si sanno, il totale resta un numero', async () => {
  const varianti = async () => [{
    chiave: 'rapido', distance_km: 50, duration_min: 45, pedaggio_km: 12, geometry: [[46, 11], [46, 12]],
  }];
  const r = await percorsiConTappe([NOVALEDO, VIDOR, UDINE], { pedaggi: 'si', varianti });
  assert.equal(r[0].pedaggio_km, 24);
});
