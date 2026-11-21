// Il percorso che passa dai punti dichiarati.
//
// Disegno: docs/superpowers/specs/2026-11-21-strada-ricostruita-design.md
//
// CarLock manda solo partenza e arrivo, e fra le strade possibili il
// programma prende quella che misura quanto i chilometri veri. Ma i candidati
// sono due al massimo -- la piu' rapida e quella senza pedaggi -- e la strada
// che il proprietario ha fatto davvero puo' non essere nessuna delle due:
// «siamo passati per vidor e pieve di soligo».
//
// Quell'informazione la ha solo lui. Qui si prende e si usa.
//
// La rete non si tocca: le varianti arrivano da un finto, perche' una suite
// che martella i servizi gratuiti di percorsi e' un modo di farseli chiudere.
import test from 'node:test';
import assert from 'node:assert/strict';
import { percorsoPerIPunti, piuVicinaAiKm } from '../src/lib/geo.js';

const NOVALEDO = { lat: 46.0167, lon: 11.3167 };
const VIDOR = { lat: 45.8833, lon: 12.0167 };
const PIEVE = { lat: 45.8972, lon: 12.2944 };
const UDINE = { lat: 46.0633, lon: 13.2358 };

// Una variante come la fa `percorsiConTappe`: le tratte, ciascuna con la sua
// geometria, e i totali gia' sommati.
const variante = (chiave, km, min, tratte) => ({
  chiave, nome: chiave, distance_km: km, duration_min: min, pedaggio_km: null, tratte,
});
const tratta = (punti, km, min) => ({ distance_km: km, duration_min: min, geometry: punti });
const qq = p => [p.lat, p.lon];

// Il finto: due varianti, come quando la chiave di OpenRouteService c'e'.
const finto = (km1, km2) => async punti => [
  variante('rapido', km1, 120,
    punti.slice(0, -1).map((p, i) => tratta([qq(p), qq(punti[i + 1])], km1 / (punti.length - 1), 60))),
  variante('senza_pedaggi', km2, 200,
    punti.slice(0, -1).map((p, i) => tratta([qq(p), qq(punti[i + 1])], km2 / (punti.length - 1), 100))),
];

test('il percorso passa dai punti dichiarati', () => {
  // E' la prova che il lavoro fa quel che dice.
  return percorsoPerIPunti(NOVALEDO, [VIDOR], UDINE, 187, 142, { percorsi: finto(190, 230) })
    .then(r => {
      const tocca = p => r.geometry.some(([la, lo]) =>
        Math.abs(la - p.lat) < 0.01 && Math.abs(lo - p.lon) < 0.01);
      assert.ok(tocca(VIDOR), 'non passa da Vidor');
      assert.ok(tocca(NOVALEDO) && tocca(UDINE), 'ha perso un capo della tappa');
    });
});

test('due punti si attraversano nell’ordine scritto', async () => {
  // L'ordine non si raddrizza di nascosto: chi guarda la mappa se ne accorge
  // subito, il programma no.
  const r = await percorsoPerIPunti(NOVALEDO, [VIDOR, PIEVE], UDINE, 187, 142,
    { percorsi: finto(190, 230) });
  const dove = p => r.geometry.findIndex(([la, lo]) =>
    Math.abs(la - p.lat) < 0.01 && Math.abs(lo - p.lon) < 0.01);
  assert.ok(dove(VIDOR) >= 0 && dove(PIEVE) >= 0);
  assert.ok(dove(VIDOR) < dove(PIEVE), 'l’ordine scritto non e’ rispettato');
});

test('fra le strade passanti si prende quella che misura quanto i km veri', async () => {
  // La stessa regola del percorso diretto: usarne una diversa a seconda che
  // il proprietario abbia parlato o no vorrebbe dire due regole per lo stesso
  // numero.
  const r = await percorsoPerIPunti(NOVALEDO, [VIDOR], UDINE, 228, 220,
    { percorsi: finto(190, 230) });
  assert.equal(r.chiave, 'senza_pedaggi', 'ha preso la piu’ rapida invece della piu’ vicina ai km');
  assert.ok(Math.abs(r.scarto_km - 2) < 0.1, `scarto = ${r.scarto_km}`);
});

test('una strada che nel tempo vero non ci sta si scarta, per quanto i km tornino', async () => {
  // E' l'accorgimento gia' pagato con un difetto: fra Piacenza e Treviso la
  // statale misura meno dell'autostrada, e scegliendo per i soli chilometri
  // si disegnava la statale a chi era corso in A4. A smentirla e' il tempo.
  const r = await percorsoPerIPunti(NOVALEDO, [VIDOR], UDINE, 228, 120,
    { percorsi: finto(190, 230) });
  assert.equal(r.chiave, 'rapido', 'la strada da duecento minuti non ci sta in due ore');
});

test('senza chilometri veri si prende la prima e lo si dice', async () => {
  const r = await percorsoPerIPunti(NOVALEDO, [VIDOR], UDINE, null, null,
    { percorsi: finto(190, 230) });
  assert.equal(r.scelta_per_km, false);
});

test('la regola della scelta e’ una sola, condivisa col percorso diretto', () => {
  // Estratta e non copiata: due copie della stessa regola un giorno divergono,
  // su un numero che disegna una strada.
  const varianti = [
    { chiave: 'a', distance_km: 190, duration_min: 120 },
    { chiave: 'b', distance_km: 230, duration_min: 200 },
  ];
  assert.equal(piuVicinaAiKm(varianti, 228, 220).chiave, 'b');
  assert.equal(piuVicinaAiKm(varianti, 228, 120).chiave, 'a');
});

// ---------------------------------------------------------------------------
// I nomi scritti a mano diventano punti
// ---------------------------------------------------------------------------

import { puntiDichiarati } from '../src/lib/geo.js';

const finsceGeocoder = trovati => async testo =>
  (trovati[testo] ? [trovati[testo]] : []);

test('i nomi diventano punti, nell’ordine scritto', async () => {
  const r = await puntiDichiarati(['Vidor', 'Pieve di Soligo'], {
    cerca: finsceGeocoder({ Vidor: VIDOR, 'Pieve di Soligo': PIEVE }), pausa: 0 });
  assert.deepEqual(r.punti.map(p => p.nome), ['Vidor', 'Pieve di Soligo']);
  assert.ok(Math.abs(r.punti[0].lat - VIDOR.lat) < 0.001);
  assert.deepEqual(r.non_trovati, []);
});

test('un nome che non si trova non spegne gli altri', async () => {
  // E resta scritto: buttarlo in silenzio vorrebbe dire fargli riscrivere una
  // cosa che ha gia' scritto, senza dirgli perche'.
  const r = await puntiDichiarati(['Vidor', 'Posto Che Non Esiste 9x'], {
    cerca: finsceGeocoder({ Vidor: VIDOR }), pausa: 0 });
  assert.deepEqual(r.non_trovati, ['Posto Che Non Esiste 9x']);
  assert.equal(r.punti.length, 2, 'il nome non trovato deve restare scritto');
  assert.equal(r.punti[1].lat, null);
  assert.ok(Math.abs(r.punti[0].lat - VIDOR.lat) < 0.001, 'il punto buono doveva restare');
});

test('un geocoder che si lamenta non fa cadere tutto', async () => {
  // I servizi gratuiti rifiutano, ogni tanto. Un nome che non si e' potuto
  // cercare e' un nome non trovato, non un errore che svuota la tappa.
  const r = await puntiDichiarati(['Vidor'], {
    cerca: async () => { throw new Error('troppe richieste'); }, pausa: 0 });
  assert.deepEqual(r.non_trovati, ['Vidor']);
  assert.equal(r.punti.length, 1);
});

test('i nomi vuoti si buttano, gli spazi si tolgono', async () => {
  const r = await puntiDichiarati(['  Vidor  ', '', '   '], {
    cerca: finsceGeocoder({ Vidor: VIDOR }), pausa: 0 });
  assert.equal(r.punti.length, 1);
  assert.equal(r.punti[0].nome, 'Vidor');
});
