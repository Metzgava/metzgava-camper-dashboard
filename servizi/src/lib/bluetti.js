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
      console.warn('Bluetti: il gettone nato dal rinnovo e\u2019 rifiutato dal gateway. NON lo salvo: in archivio resta quello di prima.');
      return { esito: 'rifiutato', perche: 'il gettone rinnovato e\u2019 rifiutato dal gateway' };
    }
    console.log('Bluetti: il gettone rinnovato ha avuto bisogno di sei secondi, poi e\u2019 stato accettato');
  }
  await salva(n.accesso, n.nuovoRinnovo, n.scade);
  await segna('gettone', 'Gettone Bluetti rinnovato, provato e salvato');
  console.log('Bluetti: gettone rinnovato, provato e salvato');
  return { esito: 'ok', accesso: n.accesso, risposta: prova };
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

function traduci(a) {
  const v = {};
  for (const s of (a.stateList || [])) v[s.fnCode] = s.fnValue;
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

export async function statoBluetti(opzioni = {}) {
  // Chi arriva mentre un'altra lettura e' in corso aspetta quella, invece di
  // partirne una seconda che si pestera' i piedi con la prima sul rinnovo.
  if (inCorso) return inCorso;
  inCorso = leggiDavvero(opzioni).finally(() => { inCorso = null; });
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
  const DISTANZA = 10 * 60 * 1000;
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

  console.log(`Bluetti: uso un gettone di ${String(accesso).length} caratteri (inizia per ${String(accesso).slice(0, 10)}), scadenza ${scade || 'ignota'}`);
  let r = await chiedi('/api/bluiotdata/ha/v1/devices', accesso);

  // Primo rimedio: **riprovare lo stesso gettone.** Un rifiuto passeggero non
  // e' un gettone morto, e questo e' l'unico rimedio che non puo' far danno.
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
    if (Date.now() - ultimoRinnovo < DISTANZA) {
      console.warn(`Bluetti: rifiutato, ma ho rinnovato meno di ${Math.round(DISTANZA / 60000)} minuti fa. Non insisto: riprovo al prossimo giro.`);
      cache = { quando: 0, dato: null };
      return { collegato: true, errore: 'il cloud Bluetti rifiuta il permesso in questo momento: riprovo al prossimo giro' };
    }
    ultimoRinnovo = Date.now();
    const n = await rinnovaEVerifica(rinnovo);
    if (n.esito === 'ok') {
      accesso = n.accesso;
      r = n.risposta;
    } else if (n.esito === 'irraggiungibile') {
      // Non si sa se il permesso sia ancora buono, e nel dubbio **si tiene**.
      return { collegato: true, errore: `non sono riuscito a rinnovare il permesso (${n.perche}): riprovo al prossimo giro` };
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
    cache = { quando: 0, dato: null };
    return { collegato: true, errore: 'il cloud Bluetti rifiuta il permesso in questo momento: riprovo al prossimo giro' };
  }
  if (!r.dato || r.dato.msgCode !== 0) {
    return { collegato: true, errore: `il cloud ha risposto ${r.dato?.msgCode ?? r.http}: ${r.dato?.message || r.testo.slice(0, 120)}` };
  }

  const elenco = r.dato.data || [];
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
export async function comanda(sn, codice, valore) {
  const { accesso } = await gettoni();
  if (!accesso) return { ok: false, errore: 'nessun gettone' };
  const r = await chiedi('/api/bluiotdata/ha/v1/fulfillment', accesso, {
    metodo: 'POST',
    corpo: { sn, fnCode: codice, fnValue: String(valore) },
  });
  cache = { quando: 0, dato: null };        // lo stato in cache non vale piu'
  return { ok: r.dato?.msgCode === 0, messaggio: r.dato?.message || r.testo.slice(0, 160) };
}

// Mette in archivio quel che si e' letto: l'istantanea per la pagina, e le
// misure per i grafici. Una grandezza assente non diventa uno zero: si salta.
export async function registra() {
  const s = await statoBluetti({ fresco: true });
  if (!s.collegato || s.errore) return { quante: 0, errore: s.errore };
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
  }
  return { quante };
}
