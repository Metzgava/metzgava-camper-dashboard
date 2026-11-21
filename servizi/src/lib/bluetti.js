// L'Elite 300, letta dal cloud di Bluetti.
//
// E' l'unico apparecchio del camper che si legge da lontano senza niente a
// bordo: in camper non apre nessuna porta (il Modbus esiste ma il suo server
// web e' spento di fabbrica) e il Bluetooth vuole uno scambio di chiavi
// cifrato. Il protocollo e' documentato in docs/telemetria-camper.md.
//
// Tre cose controintuitive, scoperte a mani nude il 16/11/2026:
//
//  1. l'elenco degli apparecchi restituisce i valori SEMPRE a zero: e' il
//     catalogo di cosa l'apparecchio sa dire, non i suoi numeri.
//  2. i numeri arrivano da deviceStates, ma SOLO dopo bindDevices. Senza
//     quello risponde «spento, lista vuota» e il canale non spinge niente.
//  3. il loro bindDevices risponde «OK» anche a un seriale inventato. La prova
//     che e' andata e' che dopo arrivino i numeri, non la risposta.
import { q, segna } from './db.js';
import { leggiTravaso } from './travaso.js';

const SSO = 'https://sso.bluettipower.com';
const GATEWAY = 'https://gw.bluettipower.com';
// Credenziali pubbliche dell'integrazione comunitaria: stanno in chiaro nel
// suo codice, non sono un segreto e non meritano una variabile.
const CLIENTE = 'HomeAssistant';
const SEGRETO = 'SG9tZUFzc2lzdGFudA==';

// Lo stesso stato non si chiede due volte in un minuto: dieci aperture di
// pagina non devono diventare dieci richieste ai loro server.
const RESPIRO = 60_000;
let cache = { quando: 0, dato: null };
// Quando si e' rinnovato l'ultima volta, per non farlo due volte di fila.
let ultimoRinnovo = 0;
// Quanti rifiuti di fila senza che una lettura sia andata a buon fine.
let rifiutiDiFila = 0;

// Il freno sui rinnovi, e la valvola che lo apre.
//
// Il freno esiste per una ragione buona: senza, ogni lettura rifiutata faceva
// un rinnovo, e con la pagina aperta sono tre al minuto -- una grandinata sul
// loro cloud che non ha mai aiutato nessuno.
//
// Il 19/11/2026 quel freno e' diventato il guasto. Il cloud ha cominciato a
// rifiutare alle 13:59:30; alle 14:17:52 il server ha rinnovato e **il gettone
// nuovo e' stato rifiutato lo stesso**; da li' in poi «ho rinnovato meno di
// dieci minuti fa, non insisto», per ventotto minuti. Se ne e' usciti solo
// perche' una pubblicazione ha riavviato il processo per caso, azzerando il
// freno: il rinnovo successivo e' passato al primo colpo.
//
// Senza quel riavvio il proprietario sarebbe rimasto fermo altri dieci minuti
// almeno, guardando una Bluetti al 100% che stava erogando quattrocento watt.
//
// Quindi la prudenza resta, ma non diventa immobilita': se i rifiuti si
// accumulano si riprova anche dentro i dieci minuti. Un rinnovo in piu' ogni
// tanto costa al loro cloud molto meno di mezz'ora di dati fermi a noi.
export const DISTANZA = 10 * 60 * 1000;
export const RIFIUTI_PER_INSISTERE = 5;

export function sipuoRinnovare({ adesso, ultimoRinnovo: quando, rifiutiDiFila: quanti,
                                 distanza = DISTANZA, soglia = RIFIUTI_PER_INSISTERE }) {
  if (adesso - quando >= distanza) return true;
  return quanti >= soglia;
}

// Lo stato dopo un rifiuto: quanti ne contiamo, se si rinnova, e da quando.
//
// **Qui sta il tetto all'insistenza**, e la prima stesura non ce l'aveva.
// Superata la soglia la condizione restava vera per sempre, e si rinnovava a
// ogni singola lettura: alle 15:11 del 19/11/2026 il registro del server
// diceva «27 rifiuti di fila. Rinnovo lo stesso». Ventisette. Cioe' la
// grandinata che il freno doveva evitare, reintrodotta dalla valvola che
// doveva evitare la paralisi -- una paralisi scambiata con un martellamento.
//
// Il rimedio: dopo aver insistito il conto **riparte**, quindi per insistere
// di nuovo servono altri cinque rifiuti. Trenta rifiuti di fila diventano sei
// rinnovi invece di ventisei.
//
// Sta in una funzione sua perche' il difetto non era nella decisione singola
// -- quella era giusta -- ma nella sequenza, ed e' la sequenza che va provata.
export function dopoUnRifiuto(stato, adesso) {
  const quanti = (stato?.rifiutiDiFila || 0) + 1;
  const quando = stato?.ultimoRinnovo || 0;
  if (!sipuoRinnovare({ adesso, ultimoRinnovo: quando, rifiutiDiFila: quanti })) {
    return { ultimoRinnovo: quando, rifiutiDiFila: quanti, rinnova: false };
  }
  return { ultimoRinnovo: adesso, rifiutiDiFila: 0, rinnova: true };
}
// Una lettura per volta, e le altre aspettano quella in corso.
//
// Senza questo, due richieste contemporanee — il giro periodico e una pagina
// che si apre — trovano lo stesso gettone rifiutato e **rinnovano tutte e
// due**. Il gettone di rinnovo pero' si consuma: il primo lo usa, il secondo
// si sente rispondere `invalid_grant`, lo scambia per «permesso morto» e
// butta via i gettoni buoni che il primo aveva appena salvato.
//
// E' il guasto che ha fatto perdere il collegamento tutta la sera del
// 16/11/2026, tre volte di fila.
let inCorso = null;
// Per la misura: quale gettone si sta contando, e quante letture ha servito.
let gettoneContato = null;
let letturePerGettone = 0;

// Il collegamento si fa dall'app, non da una variabile d'ambiente: si apre la
// pagina di Bluetti, si dice «Agree», e il gettone torna qui e finisce in
// archivio. Cosi' nessun segreto passa da una configurazione, da una
// ripubblicazione o da una conversazione — e il giorno che scade si rinnova
// con un tasto invece che con un deploy.
export async function collegato() {
  if (process.env.BLUETTI_ACCESS_TOKEN) return true;
  return (await q(`SELECT 1 FROM gettoni_cloud WHERE nome='bluetti_accesso' LIMIT 1`)).rowCount > 0;
}

export function indirizzoAutorizza(ritorno, passi = 'camper') {
  return `${SSO}/oauth2/grant?response_type=code&client_id=${CLIENTE}`
    + `&redirect_uri=${encodeURIComponent(ritorno)}&state=${encodeURIComponent(passi)}`;
}

// La pagina di Bluetti dice «HomeAssistant» e nomina il controllo a voce:
// e' la porta pubblica che Bluetti tiene aperta per quell'integrazione, ed e'
// l'unica che esiste. Il permesso comprende anche il comando, non solo la
// lettura: la pagina lo dice prima di mandarti li'.
export async function completaAutorizzazione(codice, ritorno) {
  const corpo = new URLSearchParams({
    grant_type: 'authorization_code', code: codice,
    redirect_uri: ritorno, client_id: CLIENTE, client_secret: SEGRETO,
  });
  const r = await fetch(`${SSO}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: corpo,
    signal: AbortSignal.timeout(25_000),
  });
  const g = await r.json().catch(() => null);
  if (!g?.access_token) return { ok: false, errore: g?.error_description || g?.error || `il server ha risposto ${r.status}` };
  const scadenza = g.expires_in ? new Date(Date.now() + g.expires_in * 1000) : null;
  await salva(g.access_token, g.refresh_token || null, scadenza);
  cache = { quando: 0, dato: null };
  // Quanto dura davvero questo permesso e' il dato che manca per capire
  // perche' muore cosi' in fretta. Nei log, non in chat: non e' un segreto,
  // ma non e' roba da far leggere a nessuno.
  // La forma del gettone, non il gettone: lunghezza e intestazione JWE, che e'
  // identica per tutti e non e' un segreto. Serve a confrontarlo con uno che
  // so funzionare: se le lunghezze differiscono, il guasto e' nel salvataggio.
  console.log(`Bluetti gettone ricevuto: ${String(g.access_token).length} caratteri, inizia per ${String(g.access_token).slice(0, 10)}, rinnovo ${String(g.refresh_token || '').length} caratteri`);
  console.log(`Bluetti collegato: expires_in=${g.expires_in ?? 'assente'}s, scade ${scadenza ? scadenza.toISOString() : 'mai dichiarato'}, rinnovo ${g.refresh_token ? 'presente' : 'ASSENTE'}`);
  await segna('bluetti', `Collegato al cloud Bluetti (dura ${g.expires_in ? Math.round(g.expires_in / 3600) + ' ore' : 'non dichiarato'})`);
  return { ok: true, scade_fra_giorni: g.expires_in ? Math.round(g.expires_in / 86400) : null };
}

// ---------- i gettoni ----------

async function gettoni() {
  const righe = (await q(`SELECT nome, valore, scade, aggiornato FROM gettoni_cloud WHERE nome LIKE 'bluetti_%'`)).rows;
  const dentro = Object.fromEntries(righe.map(r => [r.nome, r.valore]));
  const scade = righe.find(r => r.nome === 'bluetti_accesso')?.scade || null;
  if (!dentro.bluetti_accesso && process.env.BLUETTI_ACCESS_TOKEN) {
    await salva(process.env.BLUETTI_ACCESS_TOKEN, process.env.BLUETTI_REFRESH_TOKEN || null, null);
    return { accesso: process.env.BLUETTI_ACCESS_TOKEN, rinnovo: process.env.BLUETTI_REFRESH_TOKEN || null };
  }
  const aggiornato = righe.find(r => r.nome === 'bluetti_accesso')?.aggiornato || null;
  return { accesso: dentro.bluetti_accesso, rinnovo: dentro.bluetti_rinnovo, scade, aggiornato };
}

async function salva(accesso, rinnovo, scade) {
  for (const [nome, valore] of [['bluetti_accesso', accesso], ['bluetti_rinnovo', rinnovo]]) {
    if (!valore) continue;
    await q(`INSERT INTO gettoni_cloud (nome, valore, scade, aggiornato) VALUES ($1,$2,$3,now())
             ON CONFLICT (nome) DO UPDATE SET valore=$2, scade=$3, aggiornato=now()`, [nome, valore, scade]);
  }
}

// Qui c'era una funzione che **buttava** i gettoni quando il cloud rifiutava
// due volte di fila, e si fondava su una premessa che i log hanno smentito la
// mattina del 17/11/2026:
//
//   06:58:34  nuovo accesso dal tuo Agree, gettone di 1835 caratteri
//   06:58:39  lettura RIFIUTATA (805)       <- cinque secondi dopo
//   06:58:39  rinnovo riuscito, gettone nuovo
//   06:58:39  lettura ANCORA rifiutata      <- anche col gettone appena nato
//   06:58:39  permesso SCARTATO
//
// Un gettone di cinque secondi non e' scaduto, e nemmeno quello nato dal
// rinnovo. Trenta secondi dopo un terzo accesso andava liscio, e lo stesso
// gettone ha poi letto bene alle 07:11, alle 07:13 e alle 07:26. Quindi
// **805 non vuol dire che il permesso e' morto**: il loro cloud rifiuta a
// tratti, per meno di un minuto, qualunque gettone gli si porti.
//
// Le tre ragioni per buttare sono cadute tutte:
//
// - «cosi' `collegato()` dice la verita'»: la verita' e' che il permesso e'
//   vivo, e buttarlo faceva dire una bugia al contrario;
// - «il giro smette di bussare a una porta chiusa»: la porta non e' chiusa,
//   e bussare ogni quarto d'ora costa una richiesta;
// - «in pagina compare il tasto»: il tasto nella pagina Impianto **c'e'
//   sempre**, e dice «Ricollega» quando sei collegato.
//
// Adesso non si butta piu' niente da soli. Il costo di tenere un gettone
// morto e' un messaggio di errore; il costo di buttarne uno vivo sono le tue
// mani sull'Agree. I due costi non si somigliano, e la scelta e' per il
// secondo.

// Tre esiti, non due, e la differenza vale il collegamento.
//
// «rifiutato» vuol dire che il loro server ha detto di no: quel permesso e'
// morto e va buttato. «irraggiungibile» vuol dire che non siamo riusciti a
// chiederglielo — un timeout, la rete che balla, un loro guasto. In quel caso
// il gettone **non c'entra niente**, e buttarlo vorrebbe dire far rifare
// l'Agree a mano per un'intermittenza di dieci secondi.
//
// Era questo il modo rimasto di perdere il collegamento per niente.
async function rinnova(rinnovo) {
  if (!rinnovo) return { esito: 'rifiutato', perche: 'non c’e’ nessun gettone di rinnovo' };
  let r;
  try {
    r = await fetch(`${SSO}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token', refresh_token: rinnovo,
        client_id: CLIENTE, client_secret: SEGRETO,
      }),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (e) {
    return { esito: 'irraggiungibile', perche: String(e?.message || e).slice(0, 80) };
  }
  const g = await r.json().catch(() => null);
  if (r.ok && g?.access_token) {
    console.log(`Bluetti rinnovato: expires_in=${g.expires_in ?? 'assente'}s, rinnovo ${g.refresh_token ? 'nuovo' : 'invariato'}`);
    // Non si salva qui. Chi chiama lo prova prima: vedi rinnovaEVerifica().
    return {
      esito: 'ok',
      accesso: g.access_token,
      nuovoRinnovo: g.refresh_token || rinnovo,
      scade: g.expires_in ? new Date(Date.now() + g.expires_in * 1000) : null,
    };
  }
  // Un 4xx con una risposta leggibile e' un no detto da loro. Tutto il resto
  // — 500, 502, risposte non JSON — e' un loro inciampo, non un nostro
  // permesso scaduto.
  if (r.status >= 400 && r.status < 500) {
    const perche = g?.error_description || g?.error || `HTTP ${r.status}`;
    console.warn(`Bluetti: rinnovo RIFIUTATO (${r.status}): ${perche}`);
    return { esito: 'rifiutato', perche };
  }
  // Un 200 **senza** gettone non e' «non ci siamo arrivati»: ci siamo
  // arrivati e loro hanno risposto qualcos'altro. Il 17/11 alle 09:13 e'
  // successo, e il log diceva solo «irraggiungibile (HTTP 200)»: inutile.
  //
  // Si scrivono le chiavi della risposta e i campi che spiegano — mai i
  // valori, che potrebbero essere gettoni.
  if (r.ok) {
    const chiavi = g && typeof g === 'object' ? Object.keys(g).join(', ') : typeof g;
    const detto = [g?.error, g?.error_description, g?.msgCode, g?.message]
      .filter(Boolean).join(' / ') || 'niente che spieghi';
    console.warn(`Bluetti: il rinnovo ha risposto 200 ma senza gettone. Campi: [${chiavi}]. Dice: ${detto}`);
    return { esito: 'rifiutato', perche: `hanno risposto 200 senza gettone (${detto})` };
  }
  return { esito: 'irraggiungibile', perche: `HTTP ${r.status}` };
}

// Non si sostituisce mai un gettone che funziona con uno che nessuno ha
// ancora visto funzionare.
//
// Era questo il guasto vero, e lo dicono i log del 17/11/2026: alle 08:11:49
// il gettone nato dal tuo Agree leggeva bene; alle 08:12:59 un rifiuto
// passeggero ha fatto scattare il rinnovo; il gettone nuovo e' stato salvato
// **sopra** quello buono senza essere provato; e il gateway non ne ha
// accettato nemmeno uno. Undici rinnovi di fila, undici rifiuti, e il gettone
// buono cancellato al primo. Da li' non si risaliva piu' se non col tuo Agree.
//
// Adesso il gettone nuovo si prova sulla stessa richiesta che ci serviva
// comunque — l'elenco degli apparecchi — e si salva **solo** se quella
// risponde. Se il gateway lo rifiuta, in archivio resta quello di prima, che
// e' l'unico che si sa funzionare.
async function rinnovaEVerifica(rinnovo) {
  const n = await rinnova(rinnovo);
  if (n.esito !== 'ok') return n;

  let prova = await chiedi('/api/bluiotdata/ha/v1/devices', n.accesso);
  if (Number(prova.dato?.msgCode) === 805 || prova.http === 401) {
    // Un gettone appena nato potrebbe aver bisogno di un istante per essere
    // riconosciuto dal gateway. Una pausa e un secondo tentativo lo dicono,
    // e il log distinguera' le due cose la prossima volta.
    await new Promise(v => setTimeout(v, 6000));
    prova = await chiedi('/api/bluiotdata/ha/v1/devices', n.accesso);
    if (Number(prova.dato?.msgCode) === 805 || prova.http === 401) {
      // Il gettone di **accesso** non si salva: resta quello di prima, che e'
      // l'unico che si sa funzionare.
      //
      // Ma il gettone di **rinnovo** si salva comunque, e la differenza e'
      // sostanziale: un gettone di rinnovo **si consuma quando lo si usa**.
      // Quello vecchio in archivio e' ormai bruciato, quindi tenerlo vorrebbe
      // dire conservare una chiave che non apre piu' niente, e trovarsela
      // morta al primo rinnovo legittimo fra un mese. Il nuovo invece non e'
      // ancora stato usato: e' l'unico dei due che possa ancora servire.
      await salva(null, n.nuovoRinnovo, null);
      console.warn('Bluetti: il gettone nato dal rinnovo e\u2019 rifiutato dal gateway. Non salvo quello di accesso — resta il precedente — ma salvo il nuovo gettone di rinnovo, perche\u2019 il vecchio si e\u2019 consumato usandolo.');
      return { esito: 'rifiutato', perche: 'il gettone rinnovato e\u2019 rifiutato dal gateway' };
    }
    console.log('Bluetti: il gettone rinnovato ha avuto bisogno di sei secondi, poi e\u2019 stato accettato');
  }
  await salva(n.accesso, n.nuovoRinnovo, n.scade);
  await segna('gettone', 'Gettone Bluetti rinnovato, provato e salvato');
  console.log('Bluetti: gettone rinnovato, provato e salvato');
  return { esito: 'ok', accesso: n.accesso, risposta: prova };
}

// Il ripiego, che e' la cosa che il proprietario voleva davvero.
//
// A lui non interessa il gettone: gli interessa vedere la Bluetti. E l'ultima
// lettura buona **e' gia' in archivio** — `registra()` la scrive in
// `istantanee` a ogni giro riuscito. Quindi quando il loro cloud rifiuta non
// si svuota la pagina: si mostra quella, con la sua eta' dichiarata.
//
// Cosi' un'intermittenza del cloud Bluetti diventa cosmetica — «letto 14
// minuti fa» invece di una scheda vuota — e resta vera, perche' l'eta' c'e'
// scritta. E' la differenza fra non saperlo e mentire.
//
// `avviso` e non `errore`: la pagina su `errore` sostituisce il manometro con
// un rettangolo rosso, ed e' esattamente quel che non si vuole.
// Oltre questa eta' uno zero non si mostra piu' come zero.
//
// Disegno: docs/superpowers/specs/2026-11-21-zero-vecchio-design.md
//
// Il ritmo di lettura e' un giro al minuto (`RESPIRO` qui sopra), quindi
// cinque minuti sono cinque letture perse: abbastanza da non far lampeggiare
// la pagina per un giro saltato, abbastanza poco da non raccontare per venti
// minuti che il 220 e' chiuso mentre e' aperto.
//
// **Non e' `FERMA_DOPO_MINUTI`**, che e' mezz'ora: quella ferma le
// *animazioni*, e riguarda il movimento. Questa riguarda il **numero**, ed e'
// per forza molto piu' corta.
export const ZERI_VECCHI_DOPO_MINUTI = 5;

// Le quattro potenze, e **non la carica**: uno zero di carica non e' un caso
// reale sulla Bluetti, e una regola applicata dove non serve e' soltanto un
// posto in piu' dove sbagliare.
const POTENZE = ['fotovoltaico_w', 'rete_w', 'uscita_ac_w', 'uscita_dc_w'];

// Uno zero vecchio **non e' un valore vecchio: e' un'affermazione vecchia**, e
// l'affermazione e' «non sta succedendo niente».
//
// Un 436 W di cinque minuti fa si legge subito per quel che e' -- un numero
// grosso con un'eta' accanto si capisce. Uno zero no: lo zero non sembra un
// numero, sembra lo stato del mondo, e letto accanto a un ramo grigio e
// immobile dice «niente» con piu' forza di quanta ne abbia la riga piccola che
// lo smentisce. Il 19 e il 21/11/2026 ha vinto due volte su quella riga, con
// la Bluetti che erogava quattrocento watt.
//
// Qui dentro `—` vuol dire «non so» e `0` vuol dire «uno zero che conosco».
// Uno zero che ha saltato cinque letture non lo conosciamo piu'.
//
// I valori **diversi da zero** restano, con la loro eta' come prima: quelli si
// leggono gia' per quel che sono.
function senzaZeriVecchi(dati, minuti) {
  if (!dati || minuti < ZERI_VECCHI_DOPO_MINUTI) return dati;
  const fuori = { ...dati };
  for (const k of POTENZE) {
    if (fuori[k] != null && Number(fuori[k]) === 0) fuori[k] = null;
  }
  return fuori;
}

async function ultimaBuona(avviso) {
  const r = await q(`SELECT apparecchio, dati, quando FROM istantanee
                     WHERE fonte='bluetti' ORDER BY quando DESC`);
  if (!r.rows.length) return { collegato: true, errore: avviso };
  const quando = r.rows[0].quando;
  // `quando` lo scrive Postgres, la differenza la fa Node: due orologi. Uno
  // scarto fra i due darebbe un numero negativo, e «meno di un minuto fa» di
  // una lettura vecchia e' precisamente la bugia che si sta evitando.
  const minuti = Math.max(0, Math.round((Date.now() - new Date(quando).getTime()) / 60000));
  console.log(`Bluetti: mostro l\u2019ultima lettura buona, di ${minuti} minuti fa`);
  const dato = {
    collegato: true,
    quando: new Date(quando).toISOString(),
    vecchia: true,
    minuti,
    avviso,
    apparecchi: r.rows.map(x => x.dati).filter(Boolean)
      .map(d => senzaZeriVecchi(d, minuti)),
  };
  // In cache come una lettura buona: le aperture di pagina del minuto
  // successivo non toccano nemmeno la rete. Senza questo, ogni cambio di
  // sezione rifaceva la catena da capo.
  cache = { quando: Date.now(), dato };
  return dato;
}

// ---------- le chiamate ----------

// Il loro cloud risponde HTTP 200 anche quando rifiuta: il motivo sta in
// msgCode. 805 e' gettone scaduto.
async function chiedi(percorso, gettone, { metodo = 'GET', corpo = null } = {}) {
  const r = await fetch(GATEWAY + percorso, {
    method: metodo,
    headers: { Authorization: gettone, ...(corpo ? { 'Content-Type': 'application/json' } : {}) },
    body: corpo ? JSON.stringify(corpo) : undefined,
    signal: AbortSignal.timeout(25_000),
  });
  const testo = await r.text();
  let dato = null;
  try { dato = JSON.parse(testo); } catch { /* non JSON: guasto */ }
  return { http: r.status, dato, testo };
}

const NUM = v => (v === undefined || v === null || v === '' ? null : Number(v));
const SW = v => (v === undefined || v === null || v === '' ? null : String(v) === '1');

export const MODALITA = {
  workmode_0: 'priorita’ al fotovoltaico',
  workmode_1: 'continuita’ standard',
  workmode_2: 'a fasce orarie',
  workmode_3: 'personalizzata',
};

// Gli interruttori che il cloud accetta. Nome in italiano, codice loro, e che
// cosa comporta premerlo: la pagina lo dice prima, non dopo.
export const COMANDI = {
  ac: { codice: 'SetCtrlAc', nome: 'Uscita 220 V', avviso: 'Accende o spegne la presa a 220 V della Bluetti. Quello che e’ attaccato si spegne di colpo.' },
  dc: { codice: 'SetCtrlDc', nome: 'Uscita 12 V', avviso: 'Accende o spegne le uscite a 12 V.' },
  ac_eco: { codice: 'SetACECO', nome: 'Risparmio sulla 220', avviso: 'Spegne da se’ la 220 quando nessuno assorbe. Comodo, ma un apparecchio a basso consumo puo’ restare al buio.' },
  dc_eco: { codice: 'SetDCECO', nome: 'Risparmio sulla 12 V', avviso: 'Come sopra, sulle uscite a 12 V.' },
  sonno: { codice: 'SetSleepMode', nome: 'Modalita’ sonno', avviso: 'Mette la Bluetti a dormire: consuma meno e risponde meno.' },
};

// Quali grandezze manda davvero il loro cloud. Ne usiamo quindici e buttiamo
// via tutto il resto senza mai averlo guardato: la potenza dell'alternatore,
// gli ingressi DC separati, gli interruttori che non conosciamo stanno li'
// dentro, se ci sono.
//
// Si scrive **solo quando l'elenco cambia**, non a ogni lettura: a un minuto
// di ritmo sarebbero 1.440 righe identiche al giorno. Cosi' ne basta una.
let codiciVisti = '';

function traduci(a) {
  const v = {};
  for (const s of (a.stateList || [])) v[s.fnCode] = s.fnValue;
  const codici = Object.keys(v).sort().join(',');
  if (codici && codici !== codiciVisti) {
    codiciVisti = codici;
    console.log(`Bluetti: grandezze offerte da ${a.sn || 'apparecchio ignoto'} (${Object.keys(v).length}): ${Object.entries(v).map(([k, x]) => `${k}=${x}`).join(' ')}`);
  }
  const autonomia = NUM(v.DsgFullTime);
  return {
    nome: a.name || a.sn,
    sn: a.sn,
    in_linea: SW(a.online),
    carica: NUM(v.SOC),
    autonomia_minuti: autonomia || null,
    alla_carica_minuti: NUM(v.ChgFullTime) || null,
    fotovoltaico_w: NUM(v.PVAllTotalPower),
    rete_w: NUM(v.GridAllTotalPower),
    uscita_ac_w: NUM(v.ACLoadAllTotalPower),
    uscita_dc_w: NUM(v.DCLoadAllTotalPower),
    ac: SW(v.SetCtrlAc),
    dc: SW(v.SetCtrlDc),
    ac_eco: SW(v.SetACECO),
    dc_eco: SW(v.SetDCECO),
    sonno: SW(v.SetSleepMode),
    modalita_codice: v.SetCtrlWorkMode || null,
    modalita: MODALITA[v.SetCtrlWorkMode] || v.SetCtrlWorkMode || null,
  };
}

// ---------- quel che serve a chi chiama ----------

// `leggi` si puo' scavalcare per le prove: serve a far esplodere la lettura
// senza avere un cloud che esplode.
export async function statoBluetti(opzioni = {}, leggi = leggiDavvero) {
  // Chi arriva mentre un'altra lettura e' in corso aspetta quella, invece di
  // partirne una seconda che si pestera' i piedi con la prima sul rinnovo.
  if (inCorso) return inCorso;
  // **Questa funzione non rifiuta mai.** Il 19/11/2026 il gateway di Bluetti
  // e' andato in timeout e il lancio e' risalito fino alla rotta: `/api/stato`
  // ha risposto 500 per sedici secondi, e con lui sono spariti dalla pagina le
  // Ective, i termometri, le Victron e la scatoletta -- tutto quel che con
  // Bluetti non c'entra niente.
  //
  // Il ripiego esisteva gia' e funzionava bene per i **rifiuti**: si mostra
  // l'ultima lettura buona con la sua eta'. Ma un rifiuto torna una risposta,
  // mentre un timeout lancia. La differenza e' tutta tecnica e non interessa a
  // nessuno: per chi guarda la pagina sono la stessa cosa -- la Bluetti non si
  // legge -- e vanno trattati allo stesso modo.
  inCorso = Promise.resolve()
    .then(() => leggi(opzioni))
    .catch(e => ultimaBuona(
      `non sono riuscito a parlare col cloud Bluetti (${e?.message || e}): riprovo al prossimo giro`)
      // Se nemmeno l'archivio risponde non resta niente da dire, ma si dice
      // **qualcosa**: un oggetto che la pagina sa disegnare, non un'eccezione.
      .catch(() => ({ collegato: true, errore: 'il cloud Bluetti non risponde e non ho letture in archivio' })))
    .finally(() => { inCorso = null; });
  return inCorso;
}

async function leggiDavvero({ fresco = false } = {}) {
  if (!fresco && cache.dato && Date.now() - cache.quando < RESPIRO) return cache.dato;

  let { accesso, rinnovo, scade, aggiornato } = await gettoni();
  if (!accesso) return { collegato: false };

  // Rinnovare **prima** che scada, invece di aspettare il rifiuto, serve a non
  // perdere letture nel cambio e a tenere vivo il gettone di rinnovo.
  //
  // Ma il margine era **fisso a tre giorni**, e quello e' un errore se il loro
  // permesso dura poco: con un permesso da due ore, «mancano meno di tre
  // giorni» e' vero dal primo istante, e si rinnoverebbe a ogni singola
  // lettura. Un margine **relativo** — l'ultimo quinto della vita del
  // permesso, mai meno di dieci minuti — si comporta bene con durate di
  // qualunque ordine.
  const vita = scade && aggiornato ? new Date(scade).getTime() - new Date(aggiornato).getTime() : null;
  const MARGINE = vita && vita > 0 ? Math.max(10 * 60 * 1000, vita * 0.2) : 3 * 24 * 3600 * 1000;
  // E non due rinnovi di fila: due richieste contemporanee che usano lo stesso
  // gettone di rinnovo sono il modo classico di far invalidare la sessione.
  if (scade && new Date(scade).getTime() - Date.now() < MARGINE && rinnovo
      && Date.now() - ultimoRinnovo > DISTANZA) {
    const n = await rinnovaEVerifica(rinnovo);
    ultimoRinnovo = Date.now();
    console.log(`Bluetti: rinnovo preventivo (margine ${Math.round(MARGINE / 60000)} min, vita dichiarata ${vita ? Math.round(vita / 60000) + ' min' : 'ignota'})`);
    if (n.esito === 'ok') accesso = n.accesso;
    else console.warn(`rinnovo preventivo Bluetti non riuscito (${n.esito}): ${n.perche}`);
  }

  // Due trappole che i log hanno scoperto, e che la prima correzione aveva
  // mancato entrambe.
  //
  // La prima: `msgCode === 805` e' un confronto con un **numero**, e il loro
  // cloud puo' mandarlo come stringa. In quel caso il ramo del rinnovo non
  // veniva nemmeno sfiorato, e per sei ore il programma ha detto «il cloud ha
  // risposto 805» senza mai provare a rimediare. `Number()` chiude la
  // questione, e non costa niente nel caso sia gia' un numero.
  //
  // La seconda: il rinnovo puo' **riuscire** e il gettone nuovo valere lo
  // stesso niente, perche' il loro SSO ha spento tutta la sessione. Allora non
  // basta guardare se il rinnovo e' partito: va guardato com'e' andata la
  // richiesta **dopo**. Un permesso rifiutato anche col gettone fresco e'
  // morto, e va buttato in entrambi i casi.
  const rifiutato = x => Number(x.dato?.msgCode) === 805 || x.http === 401;

  // Cinque collegamenti del 17/11 hanno tenuto 7, 2, 42, 7 e 14 minuti. Non e'
  // una scadenza e non e' il numero di letture: non lo so. Quindi invece di
  // farne un'altra ipotesi, si misura — eta' del gettone e letture servite,
  // a ogni lettura. Fra qualche ciclo i numeri diranno da che cosa dipende.
  //
  // Il contatore vive in memoria, quindi una ripubblicazione lo azzera: e'
  // dichiarato nel log perche' chi legge non si sbagli.
  const eta = aggiornato ? Math.round((Date.now() - new Date(aggiornato).getTime()) / 60000) : null;
  if (accesso !== gettoneContato) { gettoneContato = accesso; letturePerGettone = 0; }
  letturePerGettone++;
  console.log(`Bluetti: uso un gettone di ${String(accesso).length} caratteri (inizia per ${String(accesso).slice(0, 10)}), scadenza ${scade || 'ignota'}`);
  console.log(`Bluetti: eta\u2019 del gettone ${eta == null ? 'ignota' : eta + ' min'}, lettura n. ${letturePerGettone} da quando gira questo contenitore`);
  let r = await chiedi('/api/bluiotdata/ha/v1/devices', accesso);

  // Primo rimedio: **riprovare lo stesso gettone.** Un rifiuto passeggero non
  // e' un gettone morto, e questo e' l'unico rimedio che non puo' far danno.
  // Chi ha aperto una pagina non paga i rimedi.
  //
  // `disegna()` rilegge /stato a ogni cambio di sezione, e la pausa piu' il
  // rinnovo stanno **dentro** quella richiesta: passare da «Adesso» a
  // «Comandi» aspettava tutta la catena. Il proprietario l'ha visto subito.
  //
  // Quindi i rimedi li fa solo chi ha chiesto una lettura fresca — il giro
  // periodico ogni quindici minuti, o il tasto di aggiornamento. Una pagina
  // prova una volta e ripiega sull'ultima lettura buona: svelta, e onesta,
  // perche' l'eta' c'e' scritta. Il recupero non si perde, arriva al giro dopo.
  if (rifiutato(r) && !fresco) {
    console.log('Bluetti: rifiutata, ma e\u2019 una pagina: ripiego subito invece di far aspettare.');
    return ultimaBuona('il cloud Bluetti rifiuta il permesso in questo momento: riprovo al prossimo giro');
  }
  if (rifiutato(r)) {
    console.warn(`Bluetti: lettura rifiutata (msgCode=${r.dato?.msgCode ?? '-'}, http=${r.http}). Aspetto sei secondi e riprovo con lo stesso gettone.`);
    await new Promise(v => setTimeout(v, 6000));
    r = await chiedi('/api/bluiotdata/ha/v1/devices', accesso);
    if (!rifiutato(r)) console.log('Bluetti: al secondo tentativo lo stesso gettone va bene — era un rifiuto passeggero');
  }

  // Secondo rimedio, e solo adesso: il rinnovo. Con un freno, perche' senza
  // freno ogni lettura rifiutata ne faceva uno, e quando la pagina e' aperta
  // sono tre al minuto: una grandinata che non ha mai aiutato nessuno.
  if (rifiutato(r)) {
    const presto = Date.now() - ultimoRinnovo < DISTANZA;
    const dopo = dopoUnRifiuto({ ultimoRinnovo, rifiutiDiFila }, Date.now());
    rifiutiDiFila = dopo.rifiutiDiFila;
    if (!dopo.rinnova) {
      console.warn(`Bluetti: rifiutato (${rifiutiDiFila} di fila), ma ho rinnovato meno di ${Math.round(DISTANZA / 60000)} minuti fa. Aspetto ancora: insisto al ${RIFIUTI_PER_INSISTERE}\u00b0.`);
      return ultimaBuona('il cloud Bluetti rifiuta il permesso in questo momento: riprovo al prossimo giro');
    }
    if (presto) {
      console.warn('Bluetti: abbastanza rifiuti di fila. Rinnovo lo stesso, anche se e\u2019 presto: il freno non deve diventare immobilita\u2019.');
    }
    ultimoRinnovo = dopo.ultimoRinnovo;
    const n = await rinnovaEVerifica(rinnovo);
    if (n.esito === 'ok') {
      accesso = n.accesso;
      r = n.risposta;
    } else if (n.esito === 'irraggiungibile') {
      // Non si sa se il permesso sia ancora buono, e nel dubbio **si tiene**.
      return ultimaBuona(`non sono riuscito a rinnovare il permesso (${n.perche}): riprovo al prossimo giro`);
    }
  }
  if (rifiutato(r)) {
    // Ultima verifica prima di buttare: qualcun altro potrebbe avere rinnovato
    // mentre eravamo qui. Se in archivio c'e' un gettone **diverso** da quello
    // che ho provato, il mio era solo vecchio di qualche secondo: si riprova
    // col nuovo invece di dichiarare morto tutto.
    const ora = await gettoni();
    if (ora.accesso && ora.accesso !== accesso) {
      console.log('Bluetti: in archivio c\u2019e\u2019 un gettone piu\u2019 nuovo, riprovo con quello');
      r = await chiedi('/api/bluiotdata/ha/v1/devices', ora.accesso);
      accesso = ora.accesso;
    }
  }
  if (rifiutato(r)) {
    // E qui si **tiene** tutto. Vedi il commento lungo sopra: 805 non e' una
    // prova che il permesso sia morto, e l'unico modo di rifarlo sono le mani
    // del proprietario.
    console.warn('Bluetti: il cloud rifiuta il permesso (805) anche dopo rinnovo e secondo tentativo. Tengo i gettoni e riprovo al prossimo giro.');
    return ultimaBuona('il cloud Bluetti rifiuta il permesso in questo momento: riprovo al prossimo giro');
  }
  if (!r.dato || r.dato.msgCode !== 0) {
    return { collegato: true, errore: `il cloud ha risposto ${r.dato?.msgCode ?? r.http}: ${r.dato?.message || r.testo.slice(0, 120)}` };
  }

  const elenco = r.dato.data || [];
  // Una lettura buona azzera il conto: il freno torna a valere pieno, e la
  // valvola si riapre solo se ricominciano i rifiuti.
  rifiutiDiFila = 0;
  console.log(`Bluetti: lettura riuscita, ${elenco.length} apparecchi nell\u2019elenco`);
  if (!elenco.length) return { collegato: true, quando: new Date().toISOString(), apparecchi: [] };

  const sns = elenco.map(x => x.sn).filter(Boolean).join(',');
  const s = await chiedi(`/api/bluiotdata/ha/v1/deviceStates?sns=${encodeURIComponent(sns)}`, accesso);
  const stati = new Map((s.dato?.data || []).map(x => [x.sn, x]));

  const apparecchi = elenco.map(a => {
    const vivo = stati.get(a.sn);
    const t = traduci(vivo?.stateList?.length ? { ...a, ...vivo } : a);
    if (!vivo?.stateList?.length) {
      t.errore = 'nessun valore dal cloud: l’apparecchio non e’ associato, oppure non sta riferendo';
      for (const k of ['carica', 'autonomia_minuti', 'alla_carica_minuti', 'fotovoltaico_w', 'rete_w', 'uscita_ac_w', 'uscita_dc_w']) t[k] = null;
    }
    return t;
  });

  const dato = { collegato: true, quando: new Date().toISOString(), apparecchi };
  cache = { quando: Date.now(), dato };
  return dato;
}

export async function associa(sns) {
  const { accesso } = await gettoni();
  if (!accesso) return { ok: false, errore: 'nessun gettone' };
  const r = await chiedi('/api/bluiotdata/ha/v1/bindDevices', accesso,
    { metodo: 'POST', corpo: { bindSnList: sns } });
  return { ok: r.dato?.msgCode === 0, messaggio: r.dato?.message || r.testo.slice(0, 120) };
}

// Un comando all'apparecchio. Non si chiama da sola: la rotta lo fa solo
// quando qualcuno ha confermato, e scrive negli eventi chi e cosa.
// Cosa si legge quando il loro cloud rifiuta un comando.
//
// Diceva «il permesso Bluetti e' scaduto: ricollega dall'Impianto e riprova»,
// e mandava a rifare un collegamento che quasi sempre non serve. Il percorso
// delle letture lo aveva gia' scoperto, e ha un commento lungo che lo dice:
// **805 non vuol dire che il permesso e' morto**. E' un rifiuto momentaneo del
// loro cloud, e trenta secondi dopo passa.
//
// Due parti dello stesso programma credevano cose diverse sullo stesso codice
// d'errore, e quella che sbagliava era proprio quella che parla col
// proprietario. Il 19/11/2026 gli e' costato un quarto d'ora di comandi
// premuti a vuoto.
export const RIFIUTO_805 = 'il cloud Bluetti sta rifiutando in questo momento: '
  + 'aspetta un minuto e riprova. Se insiste, ricollega dall\u2019Impianto.';

export async function comanda(sn, codice, valore) {
  const { accesso } = await gettoni();
  if (!accesso) return { ok: false, errore: 'nessun gettone' };
  const r = await chiedi('/api/bluiotdata/ha/v1/fulfillment', accesso, {
    metodo: 'POST',
    corpo: { sn, fnCode: codice, fnValue: String(valore) },
  });
  cache = { quando: 0, dato: null };        // lo stato in cache non vale piu'

  // Un permesso rifiutato va detto in italiano. Il 17/11 il proprietario ha
  // premuto «uscita 220» e si e' visto rispondere
  // «登录已过期，请重新登录！» — la frase del loro cloud, passata di peso dalla
  // risposta alla pagina. Vera, e inutile.
  //
  // E qui, a differenza della lettura, non c'e' ripiego possibile: un numero
  // si puo' pescare dall'archivio, un interruttore deve arrivare davvero
  // all'apparecchio.
  if (Number(r.dato?.msgCode) === 805 || r.http === 401) {
    return { ok: false, errore: RIFIUTO_805 };
  }
  // `Number()` e non `===`: il loro cloud manda msgCode anche come stringa, ed
  // e' l'inciampo che il 16/11 aveva tenuto nascosto il guasto per sei ore.
  return { ok: Number(r.dato?.msgCode) === 0, messaggio: r.dato?.message || r.testo.slice(0, 160) };
}

// Mette in archivio quel che si e' letto: l'istantanea per la pagina, e le
// misure per i grafici. Una grandezza assente non diventa uno zero: si salta.
export async function registra() {
  const s = await statoBluetti({ fresco: true });
  if (!s.collegato || s.errore) return { quante: 0, errore: s.errore };
  // Una lettura di ripiego non si riscrive. Senza questo paletto il giro
  // periodico riscriverebbe ogni quarto d'ora la stessa lettura vecchia con
  // `quando = adesso`: dopo un'ora la pagina direbbe «letto un minuto fa» di
  // un dato di ieri, e il grafico diventerebbe una riga piatta inventata.
  if (s.vecchia) return { quante: 0, errore: s.avviso };
  let quante = 0;
  for (const a of (s.apparecchi || [])) {
    await q(`INSERT INTO istantanee (apparecchio, fonte, dati, quando) VALUES ($1,'bluetti',$2,now())
             ON CONFLICT (apparecchio) DO UPDATE SET dati=$2, quando=now(), fonte='bluetti'`,
      [a.sn, a]);
    const da_salvare = {
      carica: a.carica, fotovoltaico_w: a.fotovoltaico_w, rete_w: a.rete_w,
      uscita_ac_w: a.uscita_ac_w, uscita_dc_w: a.uscita_dc_w,
      autonomia_minuti: a.autonomia_minuti,
    };
    for (const [grandezza, valore] of Object.entries(da_salvare)) {
      if (valore == null) continue;
      await q('INSERT INTO misure (apparecchio, grandezza, valore) VALUES ($1,$2,$3)', [a.sn, grandezza, valore]);
      quante++;
    }
    await segnaTravaso(a.sn);
  }
  return { quante };
}

// Un travaso in corso finisce anche negli eventi, non solo nella pagina.
// Serve a rispondere a «perche' ieri sera la Bluetti era vuota?» quando
// nessuno stava guardando: la fascia la vede solo chi apre l'app.
//
// Una volta ogni due ore, non una ogni quarto d'ora: un travaso al litio dura
// ore, e dodici righe identiche non dicono niente di piu' della prima.
const RICORDO_ORE = 2;

async function segnaTravaso(sn) {
  const t = await leggiTravaso(q, sn);
  if (!t) return;
  const gia = await q(
    `SELECT 1 FROM eventi WHERE tipo='travaso' AND quando > now() - interval '${RICORDO_ORE} hours' LIMIT 1`);
  if (gia.rows.length) return;
  const persi = Math.round(t.persi_wh);
  await segna('travaso',
    `Travaso in corso: ${Math.round(t.watt)} W dall’uscita 220 da ${t.minuti} minuti, senza rete. `
    + `${Math.round(t.wh_dalla_batteria)} Wh usciti dalla Bluetti, ~${persi} Wh persi in calore.`);
  console.log(`Bluetti: travaso in corso, ${Math.round(t.watt)} W da ${t.minuti} min. Segnato negli eventi.`);
}
