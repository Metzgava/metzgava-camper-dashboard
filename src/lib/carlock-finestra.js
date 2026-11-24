// Fin dove si è già guardato: quale periodo chiedere a CarLock, e quando il
// cartello ha senso.
//
// Disegno: docs/superpowers/specs/2026-11-24-rubinetto-carlock-design.md
//
// La prima versione del disegno faceva comparire il cartello «quando il
// viaggio ha almeno una tappa che non viene dal tracker». Sbagliava, e il
// proprietario l'ha detto in una frase: *«io posso stabilire le date di un
// viaggio prima di compiere tragitti»*. Un viaggio futuro non ha nessuna
// tappa, e uno in corso ne acquista un giorno per volta: serve una regola che
// funzioni **mentre il viaggio accade**.
//
// Il viaggio porta un segno, `carlock_chiesto_fino_a`. La finestra va dal
// segno -- o dall'inizio del viaggio, se non c'è -- al più piccolo fra la fine
// del viaggio e **adesso**. Dopo una richiesta il segno avanza fino alla fine
// della finestra, **anche se non si è trovato niente**: così un giorno di
// sosta non ripropone lo stesso cartello per sempre.
//
// Perché non si chiede mai per giorni futuri: non ci sono dati, e sarebbe
// traffico per niente verso un servizio che ci sta già facendo un favore e
// che non ci ha promesso nulla.

import { mezzanotteNelFuso } from './carlock-api.js';

const GIORNO_MS = 24 * 60 * 60 * 1000;

// **Le mezzanotti sono quelle del VEICOLO, non del server.**
//
// Il piano diceva di riusare `periodoDelViaggio` di `tracciati.js` per i capi
// del viaggio. Sbagliava, e l'ha fatto vedere la suite girata con `TZ=UTC`:
// quella funzione costruisce la mezzanotte locale, che col file va bene --
// entrambi i lati del confronto sono storti uguale -- ma qui i capi vanno a
// CarLock come **istanti assoluti**. Su Railway, che gira a UTC, la finestra
// sarebbe cominciata un'ora dopo la mezzanotte vera di Roma: un tragitto
// partito alle 00:30 del primo giorno del viaggio resterebbe fuori, e nessuno
// lo saprebbe.
//
// E' la stessa trappola dell'orologio, un livello piu' su.

/** I capi del viaggio: le sue date, o il primo e l'ultimo giorno delle tappe. */
function periodoNelFuso(trip, tappe, fuso) {
  const giorni = (tappe || []).map(l => giornoDi(l?.date)).filter(Boolean).sort();
  const da = mezzanotteNelFuso(giornoDi(trip?.start_date) || giorni[0], fuso);
  const a = mezzanotteNelFuso(giornoDi(trip?.end_date) || giorni[giorni.length - 1], fuso);
  if (da == null || a == null) return null;
  return { da, a: a + GIORNO_MS - 1 };
}

const giornoDi = d => {
  if (d == null || d === '') return null;
  if (d instanceof Date) return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  return String(d).slice(0, 10);
};


/**
 * Quanti mesi di storico dà il piano dell'abbonamento.
 *
 * Misurato il 24/11/2026: il campo è `subscription_tier` su
 * `/user/vehicles`, e il nostro è `STANDARD_PLUS`. La prima versione del
 * disegno diceva «3 mesi» per tutti, e avrebbe fatto tacere il cartello su
 * viaggi che si possono ancora chiedere.
 *
 * Un piano che non conosciamo vale **3**: nel dubbio si chiede meno, non si
 * inventa. Tornare dodici per ottimismo farebbe comparire il cartello su
 * viaggi per cui CarLock non ha più niente, e un cartello che non porta nulla
 * è rumore.
 */
export function mesiDiStorico(tier) {
  return String(tier || '').toUpperCase() === 'STANDARD_PLUS' ? 12 : 3;
}

// Il primo istante ancora chiedibile. Si contano i mesi a ritroso da adesso.
const limiteDelloStorico = (adesso, mesiStorico) => {
  const d = new Date(adesso);
  d.setMonth(d.getMonth() - Math.max(0, Number(mesiStorico) || 0));
  return d.getTime();
};

const segnoDi = trip => {
  const s = trip?.carlock_chiesto_fino_a;
  if (!s) return null;
  const t = s instanceof Date ? s.getTime() : Date.parse(String(s));
  return Number.isFinite(t) ? t : null;
};

/**
 * Il periodo da chiedere: `{ da, a }` in millisecondi, oppure `null` quando
 * non c'è niente da chiedere.
 *
 * `null` in quattro casi, e sono tutti «non chiedere», non «non lo so»:
 * il viaggio non ha date né tappe datate; è tutto nel futuro; il segno è già
 * arrivato alla fine; sta tutto oltre lo storico. Chi vuole distinguere
 * l'ultimo usa `oltreLoStorico`, perché «non c'è più» è un'informazione e
 * non comparire la nasconde.
 */
export function finestraDaChiedere(trip, tappe, { adesso = Date.now(), mesiStorico = 3, fuso = 'Europe/Rome' } = {}) {
  const p = periodoNelFuso(trip, tappe, fuso);
  if (!p) return null;
  const limite = limiteDelloStorico(adesso, mesiStorico);
  // Il più tardi fra: l'inizio del viaggio, il segno, e il limite dello
  // storico. Il segno dice dove si era arrivati; il limite, da dove CarLock
  // ha ancora qualcosa.
  const da = Math.max(p.da, segnoDi(trip) ?? 0, limite);
  // Il più presto fra la fine del viaggio e adesso: **mai domani**.
  const a = Math.min(p.a, adesso);
  return a > da ? { da, a } : null;
}

/**
 * Se il viaggio è tutto oltre lo storico: non si può chiedere, e la ragione
 * va detta.
 *
 * Un viaggio **futuro** non è «oltre lo storico»: non è vecchio, è solo non
 * ancora accaduto. Confonderli vorrebbe dire dire a chi parte domani che i
 * suoi tragitti non ci sono più.
 */
export function oltreLoStorico(trip, tappe, { adesso = Date.now(), mesiStorico = 3, fuso = 'Europe/Rome' } = {}) {
  const p = periodoNelFuso(trip, tappe, fuso);
  if (!p) return false;
  if (p.da > adesso) return false;
  return p.a < limiteDelloStorico(adesso, mesiStorico);
}

/**
 * Fin dove scrivere il segno dopo una richiesta: la fine della finestra che
 * si è chiesta.
 *
 * Avanza **anche quando non si è trovato niente**, ed è il punto: un giorno di
 * sosta, senza tragitti, altrimenti riproporrebbe lo stesso cartello per
 * sempre.
 */
export function segnoDopo(finestra) {
  return finestra ? new Date(finestra.a).toISOString() : null;
}

export { GIORNO_MS };
