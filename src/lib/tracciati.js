// I tracciati veri di CarLock: dal file ai tragitti coi loro punti.
//
// Disegno: docs/superpowers/specs/2026-11-24-tracciati-veri-design.md
//
// Il tracker misura **quanto** si e' percorso e lo scrive nell'export
// normale; **per dove** non ce lo mette. Su richiesta pero' manda anche le
// posizioni registrate -- 32.069 punti su 143 tragitti, uno ogni quindici
// secondi -- e con quelle la riga sulla mappa smette di essere una
// ricostruzione.
//
// Quanto sbagliava, si e' misurato: su Novaledo -> Udine del 21/11 la riga
// ricostruita passava per Bassano, a **15,6 km** dalla strada vera.
//
//     trip,trip_start,trip_end,time,latitude,longitude,speed_kmh,heading_deg,altitude_m

import { samplePoints, haversineKm } from './util.js';

// Le colonne si trovano per **nome**, non per posizione: e' la stessa scelta
// gia' presa per l'altro export di CarLock, e regge se un giorno ne
// aggiungono una in mezzo.
const quale = (capo, ...nomi) => capo.findIndex(c => nomi.includes(c));

const istante = s => {
  // «2026-07-31 17:20:26» non e' una data ISO: senza la T, Safari e qualche
  // versione di Node la leggono come invalida. Si normalizza.
  const t = new Date(String(s || '').trim().replace(' ', 'T')).getTime();
  return Number.isFinite(t) ? t : null;
};

const numero = s => {
  const v = Number(String(s ?? '').trim());
  return Number.isFinite(v) ? v : null;
};

/**
 * Dal testo del file ai tragitti: `[{ id, da, a, punti: [{ t, lat, lon }] }]`.
 *
 * I punti di ogni tragitto escono **in ordine di tempo**: una riga fuori
 * ordine disegnerebbe un dente nella strada.
 *
 * **Una riga malformata si salta, il tragitto resta.** Buttare settecento
 * punti buoni per un refuso vorrebbe dire perdere la strada per niente.
 */
export function leggiTracciati(testo) {
  const righe = String(testo || '').split(/\r?\n/).filter(r => r.trim());
  if (righe.length < 2) return [];
  const capo = righe[0].split(',').map(c => c.trim().toLowerCase());
  const iTrip = quale(capo, 'trip'), iDa = quale(capo, 'trip_start'), iA = quale(capo, 'trip_end');
  const iT = quale(capo, 'time'), iLat = quale(capo, 'latitude'), iLon = quale(capo, 'longitude');
  if ([iTrip, iDa, iA, iT, iLat, iLon].some(i => i < 0)) return [];

  const per = new Map();
  for (const r of righe.slice(1)) {
    const c = r.split(',');
    const id = c[iTrip]?.trim();
    const lat = numero(c[iLat]), lon = numero(c[iLon]), t = istante(c[iT]);
    if (!id || lat == null || lon == null || t == null) continue;
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
    if (!per.has(id)) per.set(id, { id, da: istante(c[iDa]), a: istante(c[iA]), punti: [] });
    per.get(id).punti.push({ t, lat, lon });
  }
  const fuori = [...per.values()].filter(x => x.punti.length);
  for (const x of fuori) x.punti.sort((a, b) => a.t - b.t);
  return fuori;
}

// ---------------------------------------------------------------------------
// Di quale tappa e' un tragitto
// ---------------------------------------------------------------------------
//
// **Per data e finestra di orari, non per identificativo.** E' la regola che
// regge le tappe unite: quando si importa, i tragitti separati da una sosta
// breve diventano una tappa sola, e nei tracciati restano separati. Con la
// finestra si ritrovano tutti, senza dover smontare l'identificativo.

// I due orologi vengono dalla stessa fonte e dovrebbero combaciare al minuto,
// ma gli orari del riassunto sono troncati ai minuti: tre minuti per lato
// coprono l'arrotondamento senza aprire la finestra a un altro tragitto.
export const TOLLERANZA_MIN = 3;

const giorno = d => {
  if (d == null || d === '') return null;
  if (d instanceof Date) return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  return String(d).slice(0, 10);
};

const orario = s => {
  const m = String(s ?? '').match(/^(\d{1,2}):(\d{2})/);
  return m ? (+m[1]) * 60 + (+m[2]) : null;
};

/**
 * Da quando a quando ha viaggiato una tappa, in millisecondi.
 *
 * `null` quando non si puo' dire, e allora non si aggancia niente:
 *
 *   - **senza data o senza orari** (tipico delle tappe scritte a mano) non
 *     c'e' finestra da costruire, e indovinarne una sarebbe il modo di
 *     attaccare una traccia alla tappa sbagliata;
 *   - **fuori dal camper** -- traghetto, aereo -- una traccia stradale non
 *     c'entra: e' la stessa regola dei luoghi dichiarati.
 *
 * **La mezzanotte si scavalca**: se l'ora di fine viene prima di quella di
 * inizio, la fine sta nel giorno dopo. Senza questo una tappa notturna
 * perderebbe la sua traccia.
 */
export function finestraDellaTappa(tappa) {
  if (String(tappa?.mezzo || 'camper') !== 'camper') return null;
  const g = giorno(tappa?.date);
  const da = orario(tappa?.start_time), a = orario(tappa?.end_time);
  if (!g || da == null || a == null) return null;
  const mezzanotte = new Date(`${g}T00:00:00`).getTime();
  if (!Number.isFinite(mezzanotte)) return null;
  const fine = a < da ? a + 24 * 60 : a;
  const t = TOLLERANZA_MIN * 60_000;
  return { da: mezzanotte + da * 60_000 - t, a: mezzanotte + fine * 60_000 + t };
}

// I tragitti di una tappa, in ordine di tempo. Un tragitto appartiene alla
// tappa se **comincia** dentro la sua finestra: e' l'inizio che dice di chi
// e', perche' la fine puo' cadere oltre la finestra di pochi secondi.
export function tragittiDellaTappa(tragitti, tappa) {
  const f = finestraDellaTappa(tappa);
  if (!f) return [];
  return (tragitti || [])
    .filter(t => t?.da != null && t.da >= f.da && t.da <= f.a)
    .sort((x, y) => x.da - y.da);
}

/**
 * Chi va con chi: `{ perTappa: Map<idTappa, [tragitto]>, fuori: [tragitto] }`.
 *
 * **Un tragitto che cade in due tappe non si attacca a nessuna.** Meglio una
 * tappa senza traccia che una traccia sulla tappa sbagliata: una
 * ricostruzione la si mette in dubbio, un tracciato vero no.
 */
export function assegna(tragitti, tappe) {
  const perTappa = new Map();
  const fuori = [];
  for (const t of (tragitti || [])) {
    const sue = (tappe || []).filter(x => tragittiDellaTappa([t], x).length);
    if (sue.length !== 1) { fuori.push(t); continue; }
    const id = sue[0].id;
    if (!perTappa.has(id)) perTappa.set(id, []);
    perTappa.get(id).push(t);
  }
  for (const v of perTappa.values()) v.sort((x, y) => x.da - y.da);
  return { perTappa, fuori };
}

/**
 * La riga di una tappa, cucita dai suoi tragitti.
 *
 * I buchi delle soste restano: erano spostamenti separati, e una riga dritta
 * sopra la sosta direbbe che si e' guidato mentre si era fermi.
 *
 * Si campiona con lo stesso metro delle strade calcolate -- `samplePoints`
 * tiene sempre l'ultimo punto, quindi i capi non si perdono.
 */
export function cuci(tragitti, { massimo = 600 } = {}) {
  const punti = (tragitti || []).flatMap(t => (t?.punti || []));
  if (!punti.length) return [];
  const riga = punti.map(p => [+p.lat.toFixed(5), +p.lon.toFixed(5)]);
  return samplePoints(riga, massimo);
}

// ---------------------------------------------------------------------------
// Quanto sbagliava la ricostruzione
// ---------------------------------------------------------------------------
//
// Si ottiene gratis mentre si sostituisce, e dopo un centinaio di tappe dice
// quanto vale il ricostruttore -- se indovina nove volte su dieci o sei.
//
// La misura e' **la distanza del punto piu' lontano**: per ogni punto della
// riga vecchia, quanto dista dal punto piu' vicino di quella vera; si tiene
// la maggiore. E' il numero che ha reso evidente il caso di Novaledo ->
// Udine: la ricostruzione passava per Bassano, a 15,6 km dalla strada vera.
//
// Una media direbbe che quasi tutto combaciava, ed e' proprio il pezzo che
// non combacia a essere il difetto.
//
// `null` quando manca una delle due righe: uno zero direbbe «la ricostruzione
// era perfetta», che e' un'altra affermazione.
export function quantoSbagliava(vecchia, vera) {
  const a = (vecchia || []).filter(p => Array.isArray(p) && p.length >= 2);
  const b = (vera || []).filter(p => Array.isArray(p) && p.length >= 2);
  if (!a.length || !b.length) return null;
  let peggio = 0;
  for (const p of a) {
    let vicino = Infinity;
    for (const q of b) {
      const d = haversineKm(p, q);
      if (d < vicino) vicino = d;
    }
    if (vicino > peggio) peggio = vicino;
  }
  return +peggio.toFixed(2);
}
