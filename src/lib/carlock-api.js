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

// ---------------------------------------------------------------------------
// L'orologio
// ---------------------------------------------------------------------------
//
// **E' la trappola di tutto questo lavoro**, trovata dal controllo del
// costruttore prima di scrivere una riga.
//
// Oggi il programma lavora con orari **senza fuso**: `leggiTracciati` legge
// «2026-07-31 17:20:26» nel fuso del processo e `finestraDellaTappa`
// costruisce la mezzanotte nello stesso fuso. Sono storti dello stesso tanto,
// quindi quando si confrontano l'errore **si annulla**, e col file va bene sia
// sul Mac (Roma) sia su Railway (UTC).
//
// L'interfaccia invece da' **istanti assoluti**. Confrontarli con una finestra
// costruita nel fuso del server significa che su Railway la finestra di una
// tappa e' spostata di un'ora, e la tolleranza e' di **tre minuti**: nessuna
// traccia si aggancia a nessuna tappa, mai, e non c'e' nessun errore. In
// locale funziona.
//
// Quindi il traduttore produce **quel che produce il file**: orari da orologio
// da parete nel fuso del veicolo. Da li' in poi non cambia niente.
//
// `Intl.DateTimeFormat` e' l'unico modo di non dipendere dal fuso del
// processo. Niente aritmetica a mano sugli offset: l'ora legale la sbaglia, e
// la sbaglia in un giorno all'anno -- cioe' quando nessuno la sta guardando.
const formattatori = new Map();
const formattatore = fuso => {
  if (!formattatori.has(fuso)) {
    formattatori.set(fuso, new Intl.DateTimeFormat('en-CA', {
      timeZone: fuso, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit',
    }));
  }
  return formattatori.get(fuso);
};

/**
 * Un istante in millisecondi diventa `{ giorno: 'YYYY-MM-DD', ora: 'HH:MM' }`
 * nel fuso dato -- che e' quello del **veicolo**, non del server.
 *
 * `hourCycle: 'h23'` e non `h24`: con quello di suo mezzanotte diventa
 * «24:00», e l'identificativo del tragitto non combacerebbe piu' con quello
 * costruito dal file.
 */
export function oraDaParete(ms, fuso = 'Europe/Rome') {
  const pezzi = {};
  for (const p of formattatore(fuso || 'Europe/Rome').formatToParts(new Date(ms)))
    pezzi[p.type] = p.value;
  return { giorno: `${pezzi.year}-${pezzi.month}-${pezzi.day}`, ora: `${pezzi.hour}:${pezzi.minute}` };
}

// `Number(null)` e `Number('')` fanno **zero**, che e' un numero finito. Una
// coordinata mancante sarebbe diventata 0,0 -- al largo dell'Africa -- invece
// di essere scartata. E uno zero chiesto a un dato che non c'e' e' la bugia
// piu' comoda che questo progetto conosca.
// Quanto e' avanti un fuso su UTC, a un dato istante. Si ottiene formattando
// l'istante nel fuso e rileggendo quei numeri come se fossero UTC: la
// differenza e' l'offset, cambio d'ora compreso.
const offsetDi = (ms, fuso) => {
  const p = {};
  for (const x of formattatore(fuso).formatToParts(new Date(ms))) p[x.type] = x.value;
  return Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:00Z`)
    - Math.floor(ms / 60000) * 60000;
};

/**
 * La mezzanotte di un giorno **nel fuso dato**, in millisecondi.
 *
 * Serve perche' i capi della finestra vanno a CarLock come istanti assoluti.
 * Costruirli sulla mezzanotte del **server** li sposta di un'ora su Railway
 * (UTC), e un tragitto partito alle 00:30 del primo giorno del viaggio
 * resterebbe fuori -- senza che niente lo dica.
 *
 * Due passaggi: si stima l'offset all'istante di partenza e si corregge, poi
 * si ricontrolla l'offset all'istante trovato. I due differiscono nelle notti
 * del cambio d'ora, ed e' l'unico modo di non sbagliarle.
 */
export function mezzanotteNelFuso(giorno, fuso = 'Europe/Rome') {
  const base = Date.parse(`${String(giorno).slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(base)) return null;
  const primo = base - offsetDi(base, fuso);
  const secondo = base - offsetDi(primo, fuso);
  return secondo;
}

// **Il paese in coda si toglie.**
//
// L'interfaccia scrive l'indirizzo in tre pezzi col paese per ultimo -- «via,
// CAP citta provincia, Italy» -- mentre il file lo scrive in due e senza
// paese. `nomeTappa` prende l'ultimo pezzo per il nome del posto, e con il
// paese in coda la tappa si chiamava «Italy -> Italy»: visto sulla pagina
// vera il 24/11/2026.
//
// Si toglie l'ultimo pezzo quando non contiene cifre e non e' l'unico: il
// pezzo col posto porta sempre il codice postale, il paese mai. Un indirizzo
// di un pezzo solo resta com'e': non si butta l'unica cosa che c'e'.
const senzaPaese = indirizzo => {
  const pezzi = String(indirizzo ?? '').split(',').map(x => x.trim()).filter(Boolean);
  if (pezzi.length >= 2 && !/\d/.test(pezzi[pezzi.length - 1])) pezzi.pop();
  return pezzi.join(', ');
};

const numero = v => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * I tragitti dell'interfaccia nella forma di `readCarlockFile`, piu' le
 * coordinate dei due capi.
 *
 * **L'identificativo e' identico a quello del file** -- `carlock:<data>:<inizio>:<fine>`
 * con gli orari a minuti -- perche' se i due non coincidono lo stesso tragitto
 * preso dal file e dal rubinetto diventa **due tappe**, e il vincolo unico su
 * `(trip_id, external_id)` non se ne accorge. L'`uuid` vero resta a parte, in
 * `uuid`: serve a chiedere i punti, non a identificare una tappa.
 *
 * `da_lat`/`da_lon`/`a_lat`/`a_lon` sono **in piu'** rispetto alla forma del
 * file: dove ci sono, la geocodifica si salta. Col file restano `undefined` e
 * tutto va come prima.
 */
export function comeIlFile(tragitti, fuso = 'Europe/Rome') {
  return (tragitti || []).flatMap(t => {
    // **Un tragitto con l'orologio illeggibile si salta, e gli altri si
    // salvano.** `oraDaParete(undefined)` lancia: prima, UN tragitto
    // malformato faceva perdere gli altri sei e la rotta rispondeva 502
    // «Invalid time value». Quest'interfaccia non e' documentata, quindi
    // della sua forma non ci si fida -- e' lo stesso argomento con cui il
    // disegno giustifica di non costruirci sopra senza rete.
    // Con `numero()`, non con `Number.isFinite(Number(...))`: `Number(null)`
    // fa **zero**, che e' finito, e un tragitto senza orologio diventava il
    // primo gennaio 1970. E' la terza volta oggi che questo zero prova a
    // passare per un dato.
    if (numero(t?.start_time) == null || numero(t?.end_time) == null) return [];
    const p = oraDaParete(t.start_time, fuso), a = oraDaParete(t.end_time, fuso);
    return [{
      date: p.giorno,
      start: p.ora,
      end: a.ora,
      from: senzaPaese(t.start_location?.address),
      to: senzaPaese(t.end_location?.address),
      // **`null` e non zero quando la misura non c'e'.** `?? 0` era lo stesso
      // difetto togliato dalle coordinate il 24/11 -- `Number(null)` e' zero,
      // che e' un numero finito -- rimesso sulla misura che diventa gasolio e
      // totali del viaggio. E un tragitto «da zero chilometri» finiva fra
      // quelli sotto i 3 km, che e' la ragione sbagliata per «non lo so».
      km: numero(t.distance) == null ? null : +(numero(t.distance) / 1000).toFixed(1),
      // **Dagli istanti, non dagli orari scritti.** A cavallo della mezzanotte
      // la differenza fra gli orari da parete e' negativa; a cavallo dell'ora
      // legale e' sbagliata di sessanta minuti.
      duration_min: Math.round((t.end_time - t.start_time) / 60000),
      type: String(t.tag ?? ''),
      external_id: `carlock:${p.giorno}:${p.ora}:${a.ora}`,
      uuid: t.uuid,
      da_lat: numero(t.start_location?.latitude),
      da_lon: numero(t.start_location?.longitude),
      a_lat: numero(t.end_location?.latitude),
      a_lon: numero(t.end_location?.longitude),
    }];
  });
}

/**
 * Un tragitto coi suoi punti nella forma di `leggiTracciati`:
 * `{ id, da, a, punti: [{ t, lat, lon }] }`.
 *
 * `t` sono i millisecondi cosi' come arrivano: la stessa scala che
 * `leggiTracciati` produce leggendo le sue date, quindi `assegna` e `cuci`
 * lavorano come col file.
 *
 * Un punto senza coordinate si salta e il tragitto resta: la stessa regola del
 * file, dove buttare settecento punti buoni per un refuso vorrebbe dire
 * perdere la strada per niente.
 */
export function comePunti(tragitto, fuso = 'Europe/Rome') {
  const punti = (tragitto?.locations || [])
    .map(p => ({ t: numero(p?.timestamp), lat: numero(p?.latitude), lon: numero(p?.longitude) }))
    .filter(p => p.t != null && p.lat != null && p.lon != null
      && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180)
    .sort((x, y) => x.t - y.t);
  return { id: tragitto?.uuid ?? null, da: numero(tragitto?.start_time),
           a: numero(tragitto?.end_time), punti, fuso };
}

// Quante pagine si chiedono al massimo, qualunque cosa dica `total_count`.
// Con 200 tragitti per pagina sono quarantamila tragitti: molto piu' di quel
// che lo storico puo' contenere. E' una cintura contro un ciclo infinito, non
// un limite di funzionamento.
const PAGINE_MASSIME = 200;
const PER_PAGINA = 200;

// Quanto si aspetta una risposta, al massimo.
//
// `fetch` non ha un tempo massimo di suo: senza questo, un servizio appeso --
// e questo non ci ha promesso niente -- tiene appesa la richiesta che lo
// aspetta. Trovato il 24/11/2026, quando la pagina di un viaggio ha
// cominciato ad aspettare un accesso a CarLock per sapere se mostrare un
// cartello.
const ATTESA_MS = Number(process.env.CARLOCK_TIMEOUT_MS) || 12000;

/**
 * Apre il rubinetto.
 *
 * `uuid` comanda su quello del conto (viene da `CARLOCK_VEHICLE_UUID`): sul
 * conto oggi c'e' un veicolo solo, ma domani, con un secondo tracker, «il
 * primo» porterebbe dentro i tragitti dell'auto senza che niente lo dica.
 */
export function creaRubinetto({ email: email0, password: password0, uuid = null, fetch: f = fetch } = {}) {
  // **Si ripuliscono i bordi.** Incollando un valore nelle variabili di
  // Railway ci finisce facilmente dentro uno spazio o un ritorno a capo, e
  // sulla password cambia **la cifratura**: l'accesso viene rifiutato con un
  // 401 che non spiega niente, e nessuno pensa a un carattere invisibile. Una
  // variabile d'ambiente non e' un campo di testo: gli spazi ai bordi non ne
  // fanno parte.
  const email = String(email0 ?? '').trim();
  const password = String(password0 ?? '').trim();
  let gettone = null;
  let suo = null;        // il veicolo, letto una volta
  const configurato = !!(email && password);

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
      signal: AbortSignal.timeout(ATTESA_MS),
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
    const r = await f(`${BASE}${via}`, { method: 'GET', headers: intestazioni(true),
      signal: AbortSignal.timeout(ATTESA_MS) });
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

  /**
   * Il veicolo **se lo sappiamo gia'**, senza toccare la rete.
   *
   * Serve a chi non puo' permettersi di aspettare: la pagina di un viaggio
   * vuole sapere quanti mesi di storico c'e' per decidere se mostrare un
   * cartello, e quel numero non vale un'attesa su un servizio non
   * documentato. `null` vuol dire «non lo so ancora», e chi chiede decide
   * cosa farne.
   */
  const veicoloNoto = () => suo;

  return { tragittiDelPeriodo, puntiDelTragitto, veicolo, veicoloNoto, configurato };
}
