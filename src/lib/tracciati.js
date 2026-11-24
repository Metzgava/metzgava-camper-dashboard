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
// I giorni del viaggio
// ---------------------------------------------------------------------------
//
// **Si guarda solo il periodo del viaggio**, cosi' un tragitto di agosto non
// puo' finire su una tappa di novembre, e quando i dati arriveranno
// dall'interfaccia di CarLock si chiede soltanto il periodo che serve.
//
// Stava dentro la rotta, come una riga di codice in mezzo. La revisione del
// 24/11/2026 ha trovato che la prova guardava il testo della rotta: cancellata
// la riga che filtra, passava lo stesso. Il vincolo piu' importante del
// disegno non aveva una prova capace di fallire. Adesso e' qui, e si prova sui
// valori.

/**
 * Un giorno di margine ai due capi del periodo.
 *
 * La finestra di una tappa non sta dentro il suo giorno: una tappa notturna
 * arriva nel giorno dopo (`finestraDellaTappa` scavalca la mezzanotte), e la
 * tolleranza di tre minuti puo' sporgere prima della prima mezzanotte.
 * Tagliando al minuto, la tappa del 22 che arriva alle 00:20 perdeva il
 * tragitto delle 00:10: mezza traccia, contata per intera.
 *
 * Aprire di un giorno non fa entrare niente di sbagliato: e' `assegna` a
 * decidere, e rifiuta tutto quel che non cade nella finestra di **una sola**
 * tappa.
 */
export const MARGINE_MS = 24 * 60 * 60 * 1000;

const mezzanotteDi = d => {
  const g = giorno(d);
  if (!g) return null;
  const t = new Date(`${g}T00:00:00`).getTime();
  return Number.isFinite(t) ? t : null;
};

/**
 * Da quando a quando dura il viaggio: `{ da, a }` in millisecondi, oppure
 * `null` quando non si puo' dire.
 *
 * Le date del viaggio comandano; se non le ha, valgono il primo e l'ultimo
 * giorno delle sue tappe. Senza nemmeno quelli il periodo non esiste, e
 * `null` e' la verita': guardare tutto il file sarebbe la risposta comoda,
 * non quella giusta.
 *
 * La mezzanotte e' quella **locale**, come in `finestraDellaTappa`: le due
 * misure si confrontano, e devono venire dallo stesso orologio.
 */
export function periodoDelViaggio(trip, tappe) {
  const giorni = (tappe || []).map(l => giorno(l?.date)).filter(Boolean).sort();
  const da = mezzanotteDi(trip?.start_date || giorni[0]);
  const a = mezzanotteDi(trip?.end_date || giorni[giorni.length - 1]);
  if (da == null || a == null) return null;
  return { da, a: a + 24 * 60 * 60 * 1000 - 1 };
}

/** Se un tragitto riguarda questo viaggio: comincia dentro il periodo, col margine. */
export function dentroIlPeriodo(tragitto, periodo) {
  if (!periodo || tragitto?.da == null) return false;
  return tragitto.da >= periodo.da - MARGINE_MS && tragitto.da <= periodo.a + MARGINE_MS;
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
 * Si campiona con lo stesso metro delle strade calcolate -- `samplePoints`
 * tiene sempre l'ultimo punto, quindi i capi non si perdono.
 *
 * **I buchi delle soste non ci sono.** Il disegno li chiede -- erano
 * spostamenti separati, e una riga dritta sopra la sosta dice che si e'
 * guidato mentre si era fermi -- e qui i punti diventano una riga sola. Il
 * commento di prima diceva il contrario, e la prova che si chiamava come il
 * disegno misurava solo la lunghezza: passava su qualunque concatenazione.
 *
 * Per farli servirebbe cambiare il formato della geometria -- una riga per
 * segmento -- in tutti i posti che la disegnano e la misurano, mappa
 * dell'ospite compresa. Rinviato il 24/11/2026, con questa ragione: fra due
 * tragitti uniti in una tappa sola il camper e' fermo nello stesso posto,
 * quindi il segmento che li unisce e' lungo pochi metri. Il caso in cui si
 * vedrebbe -- un tragitto estraneo finito nella finestra della tappa -- lo
 * dice `tracciaPiuLunga` in pagina, invece di disegnarlo e tacere.
 */
export function cuci(tragitti, { massimo = 600 } = {}) {
  const punti = (tragitti || []).flatMap(t => (t?.punti || []));
  if (!punti.length) return [];
  const riga = punti.map(p => [+p.lat.toFixed(5), +p.lon.toFixed(5)]);
  return samplePoints(riga, massimo);
}

// ---------------------------------------------------------------------------
// Il resoconto
// ---------------------------------------------------------------------------
//
// Revisione del 24/11/2026: `senza_traccia` metteva insieme quattro cose
// diverse e la pagina ne raccontava una sola -- «nel file non c'e' un
// tragitto che le copra». Per un traghetto e' falso, e lascia credere che un
// file migliore sistemerebbe qualcosa.
//
// Ogni tappa finisce in **un** secchio, e il secchio e' la ragione:
//
//   - `attaccati` -- aveva una ricostruzione, adesso ha la traccia;
//   - `gia_veri` -- l'aveva gia' e si e' riscritta uguale;
//   - `vere_intatte` -- l'aveva, e stavolta non si e' agganciata (orari
//     cambiati dopo il primo caricamento, per esempio). Non e' «senza
//     traccia» e non e' stata toccata: senza questo secchio era una tappa di
//     cui non si diceva niente;
//   - `senza_traccia` -- in camper, con i suoi orari, e nel file non c'e'.
//     **Solo per queste** la frase «nel file non c'e'» e' vera;
//   - `senza_finestra` -- non si puo' nemmeno cercare: un traghetto o un
//     aereo (una rotta e un volo non seguono le statali), o una tappa scritta
//     a mano senza orari.
//
// `tappe` viene restituito per poterli ricontare: i secchi devono fare il
// totale, o qualcuno e' sparito.

/** I conti da mostrare: ogni tappa in un secchio, e il secchio dice il perche'. */
export function resoconto(tappe, perTappa) {
  const conti = { tappe: (tappe || []).length, attaccati: 0, gia_veri: 0,
                  vere_intatte: 0, senza_traccia: 0, senza_finestra: 0 };
  for (const l of (tappe || [])) {
    const presi = perTappa?.get?.(l.id)?.length ? true : false;
    if (presi) { if (l.tracciato_vero) conti.gia_veri++; else conti.attaccati++; continue; }
    if (l.tracciato_vero) { conti.vere_intatte++; continue; }
    if (finestraDellaTappa(l)) conti.senza_traccia++;
    else conti.senza_finestra++;
  }
  return conti;
}

// ---------------------------------------------------------------------------
// La traccia copre la tappa, o solo un pezzo?
// ---------------------------------------------------------------------------
//
// Trovato provando sulla pagina vera il 24/11/2026: una tappa di 192 km e'
// nata con 48 punti -- gli 8 chilometri del primo dei due spezzoni uniti -- e
// sopra il bollino «strada vera». La causa stava altrove ed e' corretta, ma
// mancava la **rete**: niente si accorgeva che la riga coprisse il 4% del
// percorso.
//
// In pagina c'e' `tracciaPiuLunga`, che guarda il caso opposto: una riga molto
// piu' lunga dei chilometri veri. Questo e' il verso **rassicurante**, ed e'
// per questo il piu' pericoloso: una riga corta non insospettisce nessuno, si
// disegna pulita, e dice di essere la strada percorsa.
//
// La soglia e' larga in un verso solo: il campionamento taglia le curve,
// quindi la riga disegnata misura sempre un filo meno del contachilometri.
// Meta' del percorso no: quella non e' imprecisione, e' un pezzo che manca.

/** Quanto e' lunga una riga di punti `[lat, lon]`, in chilometri. */
export function lunghezzaKm(riga) {
  const p = (riga || []).filter(x => Array.isArray(x) && x.length >= 2);
  let t = 0;
  for (let i = 1; i < p.length; i++) t += haversineKm(p[i - 1], p[i]);
  return t;
}

/**
 * Se una traccia puo' dirsi la strada di una tappa di `km` chilometri.
 *
 * Senza chilometri da confrontare torna `true`: non vuol dire «la traccia e'
 * buona», vuol dire «non ho motivo di scartarla», e buttare l'unico dato
 * misurato che c'e' per un confronto che non si puo' fare sarebbe peggio.
 * Una riga vuota invece non e' una strada.
 */
export function copreLaTappa(riga, km, { minimo = 0.6 } = {}) {
  const l = lunghezzaKm(riga);
  if (!l) return false;
  const veri = Number(km);
  if (!Number.isFinite(veri) || veri <= 0) return true;
  return l >= veri * minimo;
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
//
// **E `null` anche contro una riga di due punti**, che non e' una
// ricostruzione: e' la linea d'aria fra i capi, quella che si disegna quando i
// percorsi non rispondono. Visto dal vivo il 24/11/2026: su una tappa cosi'
// lo scarto e' venuto 0,00 -- esattamente la lode al ricostruttore che la
// riga qui sopra vuole impedire, soltanto travestita.
export function quantoSbagliava(vecchia, vera) {
  const a = (vecchia || []).filter(p => Array.isArray(p) && p.length >= 2);
  const b = (vera || []).filter(p => Array.isArray(p) && p.length >= 2);
  if (a.length < 3 || !b.length) return null;
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
