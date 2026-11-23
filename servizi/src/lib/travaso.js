// Il travaso: quando il 220 del Bluetti alimenta il caricabatterie del camper
// e le batterie di servizio si ricaricano dall'inverter, senza colonnina
// attaccata.
//
// Non e' un guasto, ed e' una cosa che si puo' voler fare. Ma costa, e di
// solito nessuno se ne accorge, per tre ragioni che si sommano:
//
// - **si perde un quinto dell'energia.** Batteria → inverter → caricatore →
//   batteria: ogni passaggio scalda, e alla fine arriva meno di quattro
//   quinti di quel che e' partito.
// - **col litio non finisce da se'.** Una batteria al piombo quasi carica fa
//   calare la corrente da sola dopo poco. Le LiFePO4 accettano la corrente
//   piena quasi fino in cima: quattrocento watt restano quattrocento watt per
//   un'ora o due.
// - **non si vede.** Nessuna spia si accende, nessun rumore cambia. Il Bluetti
//   si svuota mentre il camper sembra spento.
//
// Il 17/11/2026 il proprietario ha letto 430 W in uscita e ha spento il 220
// per prudenza. Aveva ragione a guardare, e quel numero era un caricatore da
// circa 25 A a pieno regime. Da quel giorno lo guarda l'app.
//
// **Quel che non si sa non si dice.** Senza misure non c'e' avviso; una sola
// lettura alta non e' un avviso, perche' potrebbe essere il bollitore.

// Sopra questa potenza l'uscita 220 non e' piu' una spia o un caricatore da
// telefono: e' un apparecchio che lavora.
export const SOGLIA_W = 150;
// Sopra questa potenza in ingresso c'e' la rete, e allora la corrente la paga
// la colonnina: non e' un travaso, e non si avvisa.
export const SOGLIA_RETE_W = 50;
// Il server legge ogni quarto d'ora. Due letture di fila e' il periodo piu'
// corto che si possa misurare: chiedere «dieci minuti» sarebbe una promessa
// che il ritmo delle letture non puo' mantenere.
export const LETTURE_MINIME = 2;
// Oltre questa eta' l'ultima lettura non racconta piu' il presente: tre giri
// persi. Senza questo paletto un avviso scattato prima che il cloud cadesse
// resterebbe appeso per ore, a parlare di un fatto finito.
export const ETA_MASSIMA_MIN = 50;
// Rendimenti di targa, non misurati. Servono a dare un ordine di grandezza
// della perdita, e la pagina lo dice: «circa».
export const RENDIMENTO_INVERTER = 0.90;
export const RENDIMENTO_CARICATORE = 0.875;

const NUM = v => (v == null || Number.isNaN(Number(v)) ? null : Number(v));

// Il travaso scomposto in tre, per la figura.
//
// Disegno: docs/superpowers/specs/2026-11-23-travaso-scomposto-design.md
//
// Il buco fra «escono 447 W» e «ne entrano 199» non e' fatto di una cosa sola:
// una parte si **disperde** in calore nel caricatore e non torna piu', il
// resto si **consuma** -- il frigo, lo Starlink, le luci -- e sta facendo il
// suo lavoro. Chiamarle insieme «perdite» farebbe sembrare spreco anche il
// secondo.
//
// `uscitaW` sono i watt **alla presa**, gia' dopo l'inverter (e' la stessa
// convenzione di `travasoInCorso`, che per risalire alla batteria interna
// divide per `RENDIMENTO_INVERTER`). Quindi qui si applica **solo** quello del
// caricatore, e i tre numeri sommano esattamente il misurato: chi guarda puo'
// controllare il conto a occhio.
//
// **Mai un negativo.** Se nelle batterie entra piu' di quanto possa arrivare
// -- rendimento vero migliore di quello di targa, o una terza fonte che carica
// insieme -- la sottrazione va sotto zero. «Consumi: -20 W» e' un'assurdita'
// che farebbe dubitare di tutto il resto della pagina: si torna
// `torna: false` e `consumi: null`, che vuol dire «non so», non «zero».
export function scomposizione(uscitaW, nelleEctiveW, { caricatore = RENDIMENTO_CARICATORE } = {}) {
  const uscita = NUM(uscitaW), entra = NUM(nelleEctiveW);
  if (uscita == null || entra == null || !(uscita > 0)) return null;
  const arriva = uscita * caricatore;
  const consumi = arriva - entra;
  return {
    dispersi: uscita - arriva,
    nelle_ective: entra,
    consumi: consumi < 0 ? null : consumi,
    torna: consumi >= 0,
  };
}

// Dal formato lungo del database (una riga per grandezza) alle letture: le
// righe di una stessa lettura sono scritte nello stesso istante, ma non al
// millesimo uguale, perche' sono INSERT diversi.
export function raggruppa(righe, finestraMs = 90_000) {
  const ordinate = [...(righe || [])]
    .filter(r => r && r.quando)
    .map(r => ({ ...r, t: new Date(r.quando).getTime() }))
    .sort((a, b) => b.t - a.t);

  const letture = [];
  let gruppo = null;
  for (const r of ordinate) {
    if (!gruppo || gruppo.t - r.t > finestraMs) {
      gruppo = { t: r.t, quando: new Date(r.t).toISOString() };
      letture.push(gruppo);
    }
    if (r.grandezza) gruppo[r.grandezza] = NUM(r.valore);
  }
  return letture;
}

const eTravaso = l => NUM(l.uscita_ac_w) != null
  && l.uscita_ac_w >= SOGLIA_W
  && (NUM(l.rete_w) ?? 0) < SOGLIA_RETE_W;

// Le letture arrivano con la piu' recente per prima. Si guarda solo la fila
// che tocca adesso: se la lettura di adesso non e' un travaso, il travaso e'
// finito e non c'e' niente da dire.
export function travasoInCorso(letture, { ora = new Date(), etaMassimaMin = ETA_MASSIMA_MIN } = {}) {
  const l = [...(letture || [])].sort((a, b) =>
    new Date(b.quando).getTime() - new Date(a.quando).getTime());
  if (!l.length || !eTravaso(l[0])) return null;

  const eta = (new Date(ora).getTime() - new Date(l[0].quando).getTime()) / 60000;
  if (eta > etaMassimaMin) return null;

  const fila = [];
  for (const x of l) {
    if (!eTravaso(x)) break;
    fila.push(x);
  }
  if (fila.length < LETTURE_MINIME) return null;

  const t = x => new Date(x.quando).getTime();
  const minuti = Math.round((t(fila[0]) - t(fila[fila.length - 1])) / 60000);

  // L'energia si integra fra una lettura e l'altra, con la media dei due
  // valori. Moltiplicare l'ultima potenza per tutta la durata sarebbe comodo
  // e sbagliato: il carico cambia.
  let wh = 0;
  for (let i = 0; i < fila.length - 1; i++) {
    const ore = (t(fila[i]) - t(fila[i + 1])) / 3_600_000;
    wh += ((fila[i].uscita_ac_w + fila[i + 1].uscita_ac_w) / 2) * ore;
  }

  const whDallaBatteria = wh / RENDIMENTO_INVERTER;
  const whAlleServizio = wh * RENDIMENTO_CARICATORE;
  return {
    watt: fila[0].uscita_ac_w,
    minuti,
    letture: fila.length,
    da: fila[fila.length - 1].quando,
    wh,
    wh_dalla_batteria: whDallaBatteria,
    wh_alle_servizio: whAlleServizio,
    persi_wh: whDallaBatteria - whAlleServizio,
    carica: NUM(fila[0].carica),
  };
}

// La lettura dall'archivio. `q` arriva da fuori invece di importare `db.js`:
// cosi' questo file resta provabile senza database, e chi chiama — la rotta
// della pagina e il giro periodico — usa il suo.
export const GRANDEZZE = ['uscita_ac_w', 'rete_w', 'carica'];

export async function leggiTravaso(q, sn, opzioni = {}) {
  const r = await q(
    `SELECT quando, grandezza, valore FROM misure
      WHERE apparecchio = $1 AND grandezza IN ('uscita_ac_w','rete_w','carica')
        AND quando > now() - interval '6 hours'
      ORDER BY quando DESC`, [sn]);
  return travasoInCorso(raggruppa(r.rows || []), opzioni);
}
