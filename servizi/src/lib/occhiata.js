// Chi sta guardando la pagina, e che passo chiedere alla scatoletta.
//
// Disegno: docs/superpowers/specs/2026-11-19-dal-vivo-design.md
//
// La scatoletta sta dietro il router del camper: nessuno puo' bussarle da
// fuori, deve chiedere lei. Quindi il server si limita a ricordare **l'istante
// dell'ultima occhiata**, e a chi lo interroga dice quale passo tenere.
//
// Niente database. Un'occhiata ogni tre secondi diventerebbe una scrittura
// ogni tre secondi per un dato che non serve a nessuno fra un minuto: sta in
// memoria, e se il contenitore si riavvia si riparte da «nessuno guarda», che
// e' il lato giusto dove sbagliare.

// Quanto dura il ricordo di un'occhiata. Novanta secondi: la pagina chiede
// ogni tre, quindi trenta richieste perse di fila prima di rallentare. Se il
// telefono va in tasca nessuno dice «ho finito» -- il silenzio basta.
export const FINESTRA_MS = 90_000;

// Il passo svelto, in secondi. Non si scende: un giro svelto deve ascoltare
// gli annunci per qualche secondo, e sotto i cinque i giri si accavallano.
export const SVELTO_S = 10;

// Tolleranza fra l'orologio del server e quello di chi guarda. Qualche secondo
// di scarto e' normale; un anno nel futuro e' un orologio rotto.
const SCARTO_MS = 30_000;

/**
 * Il passo da chiedere alla scatoletta.
 *
 * `secondi: null` non vuol dire «fermati»: vuol dire **tieni il tuo passo**.
 * Il ritmo lento lo decide lei, nel suo `config.json`; il server non deve
 * possedere un numero che non gli appartiene.
 *
 * **Si sbaglia sempre verso il lento.** Vale per ogni caso strano qui dentro:
 * nessuna occhiata, una data illeggibile, un orologio sballato. Il passo
 * svelto costa corrente alla batteria servizi, e nessuno se ne accorgerebbe
 * finche' il camper non resta al buio.
 */
export function ritmoRichiesto(ultimaOcchiata, adesso = Date.now()) {
  const quando = Number(ultimaOcchiata);
  if (!Number.isFinite(quando)) return { guarda: false, secondi: null };
  const eta = adesso - quando;
  const guarda = eta < FINESTRA_MS && eta > -SCARTO_MS;
  return { guarda, secondi: guarda ? SVELTO_S : null };
}

// Il ricordo, in memoria.
let ultima = null;

export const segnaOcchiata = (adesso = Date.now()) => { ultima = adesso; };
export const ultimaOcchiata = () => ultima;
