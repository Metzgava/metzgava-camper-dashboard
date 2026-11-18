// Il ritmo delle letture periodiche, in un posto solo.
//
// Serve alla pagina: un conto alla rovescia fino alla prossima lettura, e la
// ricarica da se' quando scade. Senza questo, la pagina dovrebbe indovinare —
// e indovinerebbe male, perche' l'unico orario che conosce e' quello della
// lettura mostrata, che puo' essere un ripiego vecchio di mezz'ora mentre il
// giro periodico continua a scattare puntuale.
//
// Vive in memoria e basta: a ogni ripubblicazione riparte da zero, e va bene,
// perche' entro un passo il primo giro lo rimette a posto. Un conto alla
// rovescia assente per un minuto e' meglio di una tabella in piu' nel
// database per un dato che vale sessanta secondi.

const RISERVA = 15;

export function passoMinuti() {
  const n = Number(process.env.LETTURE_MINUTI);
  // `Number('')` fa 0 e `Number('un minuto')` fa NaN: nessuno dei due deve
  // passare per «ogni zero minuti». Lo zero esplicito invece e' legittimo e
  // vuol dire «letture periodiche spente».
  if (process.env.LETTURE_MINUTI === undefined || process.env.LETTURE_MINUTI === '') return RISERVA;
  return Number.isFinite(n) && n >= 0 ? n : RISERVA;
}

let ultimo = null;

export function segnaGiro(ora = new Date()) {
  ultimo = new Date(ora);
}

export function prossimoGiro() {
  if (!ultimo) return null;
  const passo = passoMinuti();
  if (!passo) return null;
  return new Date(ultimo.getTime() + passo * 60 * 1000);
}

// Solo per le prove: azzera la memoria fra un caso e l'altro.
export function dimentica() {
  ultimo = null;
}
