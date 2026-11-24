// Il rubinetto di CarLock: l'unico posto che parla con loro.
//
// Disegno: docs/superpowers/specs/2026-11-24-rubinetto-carlock-design.md
//
// **Quest'interfaccia non e' documentata ne' supportata.** L'hanno scritta
// per il loro programma della pagina, e quel che si sa l'abbiamo misurato il
// 24/11/2026 leggendo il loro programma (pubblico) e provando l'accesso. Le
// forme delle risposte stanno in `test/fixtures/carlock-api-forme.json`, che
// e' l'unica documentazione che esiste: se un giorno qualcosa smette di
// funzionare, si riparte da la'.
//
// Tre paletti del disegno, e stanno tutti qui dentro:
//
//   - **le credenziali non si scrivono mai nei registri**, nemmeno troncate.
//     La via piu' sicura e' che questo file non parli affatto: non c'e' un
//     solo `console` qui sotto, e chi chiama decide cosa dire;
//   - **il gettone non va su disco.** Vive in una variabile di questa
//     chiusura: un riavvio costa un accesso, non un rischio;
//   - **mai due accessi di fila per la stessa richiesta.** Al 401 si rinnova
//     **una volta** e si riprova quella chiamata; se il gettone nuovo viene
//     rifiutato si smette. Col gettone della Bluetti, in Camper Servizi,
//     abbiamo gia' visto cosa fa una grandinata di rinnovi: 805 di fila.
//
// Il `fetch` si passa da fuori, cosi' le prove girano senza rete.

import crypto from 'node:crypto';

const BASE = process.env.CARLOCK_API_URL || 'https://api.carlock.co/v2';

/**
 * Come si dichiara il programma che chiama.
 *
 * Sono i valori del loro programma della pagina, e la nostra e' una pagina:
 * `WEB` e' una descrizione, non un travestimento. Se un giorno rifiutassero
 * una versione vecchia, e' qui che si cambia.
 */
export const CLIENT = { type: 'WEB', version: '3.50.0', locale: 'it' };

/**
 * La password non parte in chiaro: la loro interfaccia vuole `password_hash`,
 * e dal loro programma si legge che e' `CryptoJS.SHA256(password)` in
 * esadecimale.
 */
export function hashPassword(password) {
  return crypto.createHash('sha256').update(String(password ?? ''), 'utf8').digest('hex');
}

// Quante pagine si chiedono al massimo, qualunque cosa dica `total_count`.
// Con 200 tragitti per pagina sono quarantamila tragitti: molto piu' di quel
// che lo storico puo' contenere. E' una cintura contro un ciclo infinito, non
// un limite di funzionamento.
const PAGINE_MASSIME = 200;
const PER_PAGINA = 200;

/**
 * Apre il rubinetto.
 *
 * `uuid` comanda su quello del conto (viene da `CARLOCK_VEHICLE_UUID`): sul
 * conto oggi c'e' un veicolo solo, ma domani, con un secondo tracker, «il
 * primo» porterebbe dentro i tragitti dell'auto senza che niente lo dica.
 */
export function creaRubinetto({ email, password, uuid = null, fetch: f = fetch } = {}) {
  let gettone = null;
  let suo = null;        // il veicolo, letto una volta
  const configurato = !!(String(email || '').trim() && String(password || '').trim());

  const intestazioni = conGettone => ({
    Accept: 'application/json',
    'Content-Type': 'application/json; charset=UTF-8',
    'X-Client-Type': CLIENT.type,
    'X-Client-Version': CLIENT.version,
    'X-Client-Locale': CLIENT.locale,
    ...(conGettone && gettone ? { 'X-Token': gettone } : {}),
  });

  // Un guasto loro si riconosce, e non porta dentro niente di nostro: la
  // rotta e lo stato, non le credenziali e non il gettone.
  const guasto = (via, stato, corpo) => {
    const detto = corpo && typeof corpo === 'object'
      ? String(corpo.description || corpo.code || '').slice(0, 120) : '';
    return new Error(`CarLock ha risposto ${stato} su ${via}${detto ? ': ' + detto : ''}`);
  };

  async function accedi() {
    if (!configurato) throw new Error('Il rubinetto di CarLock non e’ configurato: mancano le credenziali');
    const r = await f(`${BASE}/user/login`, {
      method: 'POST',
      headers: intestazioni(false),
      body: JSON.stringify({ email, password_hash: hashPassword(password) }),
    });
    const d = await r.json().catch(() => null);
    if (r.status !== 200 && r.status !== 201) throw guasto('/user/login', r.status, d);
    if (!d?.token) throw guasto('/user/login', r.status, { description: 'nessun gettone nella risposta' });
    gettone = d.token;
    return d;
  }

  /**
   * Una chiamata autenticata, col rinnovo del gettone **in un posto solo**.
   *
   * Il contatore e' per richiesta (`rinnovato`), non globale: due chiamate
   * diverse possono rinnovare ciascuna una volta, ma nessuna delle due puo'
   * bussare due volte di fila.
   */
  async function chiedi(via, rinnovato = false) {
    if (!gettone) await accedi();
    const r = await f(`${BASE}${via}`, { method: 'GET', headers: intestazioni(true) });
    if (r.status === 401 && !rinnovato) {
      gettone = null;
      await accedi();
      return chiedi(via, true);
    }
    const d = await r.json().catch(() => null);
    if (!r.ok) throw guasto(via, r.status, d);
    return d;
  }

  /** Il veicolo di cui si chiedono i tragitti: fuso e piano dell'abbonamento. */
  async function veicolo() {
    if (suo) return suo;
    const d = await chiedi('/user/vehicles');
    const elenco = d?.vehicles || (Array.isArray(d) ? d : []);
    const scelto = uuid ? elenco.find(v => v?.uuid === uuid) : elenco[0];
    // Con un uuid imposto che il conto non conosce, si tiene l'uuid: chi l'ha
    // scritto sa cosa vuole, e inventare un fuso sarebbe peggio che non
    // averlo.
    suo = scelto || (uuid ? { uuid, name: null, time_zone_id: null, subscription_tier: null } : null);
    if (!suo) throw guasto('/user/vehicles', 200, { description: 'nessun veicolo sul conto' });
    return suo;
  }

  /** L'uuid da usare: quello imposto, o il primo del conto. */
  async function qualeVeicolo(passato) {
    return uuid || passato || (await veicolo()).uuid;
  }

  /**
   * I tragitti di un periodo, `da`/`a` in millisecondi.
   *
   * **Si girano tutte le pagine.** `total_count` dice quanti sono e senza
   * `page_size` ne tornano venti: fermarsi alla prima pagina perderebbe la
   * coda di un viaggio lungo **in silenzio** -- tappe che non vengono
   * proposte, indistinguibile da «CarLock non ha niente per quei giorni».
   *
   * `locations` torna **vuoto** qui: i punti si chiedono un tragitto per
   * volta. E' il fatto che rende leggero il cartello.
   */
  async function tragittiDelPeriodo(uuidVeicolo, da, a) {
    const v = await qualeVeicolo(uuidVeicolo);
    const fuori = [];
    for (let pagina = 0; pagina < PAGINE_MASSIME; pagina++) {
      const d = await chiedi(`/vehicle/${encodeURIComponent(v)}/trips?ascending=true`
        + `&date_from=${da}&date_to=${a}&page=${pagina}&page_size=${PER_PAGINA}`);
      const presi = d?.trips || [];
      fuori.push(...presi);
      // Due condizioni di uscita, e la seconda e' la cintura: un
      // `total_count` sbagliato da parte loro diventerebbe un ciclo infinito,
      // e un ciclo infinito dentro una rotta e' un server fermo.
      if (!presi.length) break;
      if (fuori.length >= (Number(d?.total_count) || 0)) break;
    }
    return fuori;
  }

  /** Un tragitto intero, coi suoi punti in `locations`. */
  async function puntiDelTragitto(uuidTragitto) {
    return chiedi(`/trip/${encodeURIComponent(uuidTragitto)}`);
  }

  return { tragittiDelPeriodo, puntiDelTragitto, veicolo, configurato };
}
