// Quel che la pagina chiede: lo stato di adesso, i conti, la storia,
// l'impianto, i comandi.
//
// Una regola vale per tutte queste rotte: **quel che non si sa non si
// inventa.** Un apparecchio che non si legge ancora torna con `stato: "atteso"`
// e il motivo scritto in chiaro, non con dei valori a zero. Uno zero su una
// carica vuol dire «scarica», e sarebbe una bugia.
import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { q, segna } from '../lib/db.js';
import { passoMinuti, prossimoGiro } from '../lib/ritmo.js';
import { statoBluetti, collegato, associa, comanda, COMANDI,
  indirizzoAutorizza, completaAutorizzazione } from '../lib/bluetti.js';
import { tuttiIConti, impianto, etaEctiveMinuti } from '../lib/conti.js';
import { leggiTravaso } from '../lib/travaso.js';
import { ramiDellaCarica, ramiDellaBluetti } from '../lib/flusso.js';
import { etaDeiDati } from '../lib/eta-dati.js';
import { serieUscite, passoDelGrafico, FINE_MAX } from '../lib/storico.js';
import { segnaOcchiata, ritmoRichiesto, ultimaOcchiata } from '../lib/occhiata.js';
import { serveAccesso } from './auth.js';

// Le rotte normali stanno dietro al login. Una sola no, e sotto si dice perche'.
export const router = Router();
export const aperte = Router();
router.use(serveAccesso);

const wrap = f => (req, res, next) => Promise.resolve(f(req, res, next)).catch(next);

// Gli apparecchi che esistono nel camper ma che ancora non parlano con noi.
// Elencarli non e' un difetto: e' la differenza fra «non c'e'» e «non lo so».
const ATTESI = [
  { id: 'ective', nome: 'Batterie Ective', icona: '\u{1F50B}', spia: /^NWJ/i,
    perche: 'Parlano solo via Bluetooth, dieci metri di raggio. Arrivano con la scatoletta in camper.',
    cosa: 'volt, ampere, carica, le quattro celle, temperatura, cicli' },
  { id: 'smartsolar', nome: 'SmartSolar MPPT', icona: '☀️', spia: /smartsolar/i,
    perche: 'Annunci Bluetooth cifrati: si leggono solo da vicino. Chiave gia’ in mano.',
    cosa: 'volt, ampere, watt dai pannelli, resa del giorno' },
  { id: 'orion', nome: 'Orion XS', icona: '\u{1F501}', spia: /orion/i,
    perche: 'Come sopra. Decodificato e verificato il 16/11/2026.',
    cosa: 'volt e ampere dei due lati, stato della carica' },
  { id: 'allarme', nome: 'Centrale d’allarme', icona: '\u{1F6A8}', spia: /^allarme$/i,
    perche: 'Si legge in locale sulla rete del camper, protocollo 3.5. Arriva con la scatoletta.',
    cosa: 'inserito o no, se e’ scattato e da quale zona, batteria' },
  { id: 'starlink', nome: 'Starlink', icona: '\u{1F6F0}️',
    perche: 'Si legge solo dalla rete del piatto.',
    cosa: 'watt istantanei e un quarto d’ora di storia al secondo' },
];


// Il ritmo della carica: non basta sapere che e' al 62 %, serve sapere se sta
// salendo e quanto in fretta. Si guarda la fila delle letture nelle ultime ore
// e si misura la pendenza fra la piu' vecchia e l'ultima.
//
// Con meno di un quarto d'ora di storia **non si dichiara niente**: due
// letture vicine fanno pendenze assurde, e una previsione sbagliata e' peggio
// di nessuna previsione.
// Chi e' ancora atteso, cioe' chi non si e' ancora fatto sentire.
//
// L'elenco era fisso, e chi cominciava a parlare restava dentro. Il
// 19/11/2026, mezz'ora dopo aver messo le chiavi, SmartSolar e Orion XS
// mandavano volt e ampere e la pagina continuava a dire che sarebbero arrivati
// con la scatoletta: lo stesso apparecchio due volte, una come dato e una come
// promessa. Solo le Ective venivano nascoste, da un filtro scritto a mano
// nell'app -- perche' non si chiamano «ective», si chiamano NWJ2022...
//
// Un elenco di promesse che non si accorge di essere stato mantenuto invecchia
// male: ogni apparecchio nuovo chiederebbe di ricordarsi di togliere una riga,
// e nessuno si ricorda. Quindi ogni atteso porta la propria spia, e chi non ne
// ha resta atteso per sempre -- Starlink si legge solo dalla rete del piatto, e
// nessuna istantanea potra' mai somigliarle.
//
// La spia non viene spedita al browser: un'espressione regolare in JSON
// diventa `{}`, inutile da una parte e confondente dall'altra.
// Mezz'ora e' molti giri: col passo a due minuti sono quindici letture perse.
// Uno o due giri persi sono normali -- un collegamento Bluetooth non si aggancia
// sempre al primo colpo -- e non devono far comparire un allarme.
const SILENZIO_MINUTI = 30;

export function ancoraAttesi(attesi, istantanee, adesso = Date.now()) {
  const fuori = [];
  for (const { spia, ...resto } of (attesi || [])) {
    const suo = spia && (istantanee || []).find(r => spia.test(String(r.apparecchio || '')));
    if (!suo) {
      // Non ha parlato mai. Non «tace»: non ha ancora cominciato.
      fuori.push(resto);
      continue;
    }
    // Nel dubbio non si grida al silenzio: un'istantanea senza data si
    // considera fresca, perche' un falso allarme fa perdere fiducia a tutti
    // gli altri avvisi della pagina.
    if (suo.quando == null) continue;
    const minuti = (adesso - new Date(suo.quando).getTime()) / 60000;
    if (!Number.isFinite(minuti) || minuti < SILENZIO_MINUTI) continue;
    // Ha parlato e ora tace. Rientra nell'elenco -- non ci sono numeri suoi da
    // mostrare -- ma portandosi dietro da quanto, perche' la pagina lo scriva
    // con le parole giuste.
    fuori.push({ ...resto, tace_da_minuti: minuti });
  }
  return fuori;
}

async function tendenza(apparecchio) {
  const righe = (await q(`SELECT quando, valore FROM misure
    WHERE apparecchio=$1 AND grandezza='carica' AND quando > now() - interval '8 hours'
    ORDER BY quando`, [apparecchio])).rows;
  if (righe.length < 2) return { nota: 'non ho ancora abbastanza letture' };
  const primo = righe[0], ultimo = righe[righe.length - 1];
  const ore = (new Date(ultimo.quando) - new Date(primo.quando)) / 3.6e6;
  if (ore < 0.25) return { nota: 'non ho ancora abbastanza letture' };

  const ritmo = (ultimo.valore - primo.valore) / ore;        // punti all'ora
  const fermo = Math.abs(ritmo) < 0.5;
  const verso = fermo ? 'fermo' : ritmo > 0 ? 'sale' : 'scende';
  // Dove arriva, se continua cosi'. «Se continua cosi'» e' un'ipotesi, e la
  // pagina la scrive: una carica rallenta verso il pieno, e un consumo cambia
  // appena si accende qualcosa.
  const meta = fermo ? null : ritmo > 0 ? 100 : 0;
  const oreAllaMeta = fermo ? null : Math.abs((meta - ultimo.valore) / ritmo);
  return {
    ritmo, verso, finestra_ore: ore, letture: righe.length,
    da: primo.valore, a: ultimo.valore,
    meta, ore_alla_meta: oreAllaMeta,
  };
}

router.get('/stato', wrap(async (req, res) => {
  // Qualcuno sta guardando: da qui la scatoletta capisce che deve andare
  // svelta. Solo in memoria -- una scrittura ogni tre secondi su un dato che
  // fra un minuto non serve piu' sarebbe uno spreco.
  segnaOcchiata();
  const bluetti = await statoBluetti({ fresco: req.query.fresco === '1' });
  const conti = await tuttiIConti(bluetti);
  const collegamento = { collegato: await collegato(), indirizzo: await conLasciapassare(req) };
  // I dati fissi viaggiano con lo stato: cosi' il calcolatore della pagina
  // rifa' i conti a ogni cifra battuta, invece di interrogare il server a ogni
  // tasto. Sono pochi numeri, e stanno in un soffio di risposta.
  const { mappa } = await impianto();
  const fissi = Object.fromEntries(Object.entries(mappa).map(([k, v]) =>
    [k, { valore: v.valore == null ? null : Number(v.valore), unita: v.unita, misurato: v.misurato }]));
  const ultimi = (await q(`SELECT apparecchio, fonte, dati, quando FROM istantanee ORDER BY quando DESC`)).rows;
  // A ogni apparecchio con una carica si attacca il suo ritmo
  for (const a of (bluetti.apparecchi || [])) {
    if (a.carica != null) a.tendenza = await tendenza(a.sn);
    // Il travaso si legge dalle misure gia' in archivio: nessuna chiamata
    // in piu' al loro cloud. La regola sta in `lib/travaso.js`.
    a.travaso = await leggiTravaso(q, a.sn);
  }
  // Uno solo sale in cima, per la fascia della pagina: con un apparecchio e'
  // lo stesso, con due il primo che travasa e' quello di cui parlare.
  bluetti.travaso = (bluetti.apparecchi || []).map(a => a.travaso).find(Boolean) || null;
  // E lo stesso per quelli che manda la scatoletta: il manometro e' uno solo,
  // e vuole lo stesso corredo da chiunque arrivino i numeri.
  for (const r of ultimi) {
    if (r.dati?.carica != null) r.tendenza = await tendenza(r.apparecchio);
  }
  // Il ritmo del giro periodico: serve alla pagina per il conto alla
  // rovescia e per ricaricarsi da se'. Puo' essere nullo — letture spente,
  // oppure il contenitore e' appena ripartito e il primo giro non c'e'
  // ancora stato: la pagina in quel caso non mostra niente, invece di
  // mostrare un numero inventato.
  // **Due orari diversi, e tenerli distinti e' il punto.**
  //
  // `letto_il` e' quando il server ha composto questa risposta: serve alla
  // pagina per sapere se sta guardando roba sua di dieci minuti fa. Non dice
  // **niente** sull'eta' dei dati, e in testata diceva «letto alle HH:MM»,
  // che suonava esattamente come se lo dicesse.
  //
  // `dati_eta_minuti` e' la cosa che si vuole sapere davvero: da quanto non
  // parla il camper. Vedi lib/eta-dati.js.
  const eta = etaDeiDati(ultimi);
  res.json({
    letto_il: new Date().toISOString(),
    dati_il: eta.quando,
    dati_eta_minuti: eta.eta_minuti,
    passo_minuti: passoMinuti(),
    // Il passo che la scatoletta sta tenendo adesso: quando qualcuno guarda
    // va svelta, e la pagina deve aggiornarsi altrettanto spesso -- altrimenti
    // i dati arrivano freschi al server e invecchiano aspettando di essere
    // mostrati.
    vivo: ritmoRichiesto(ultimaOcchiata()).secondi,
    prossima_lettura: prossimoGiro()?.toISOString() || null,
    bluetti,
    conti,
    comandi: COMANDI,
    collegamento,
    impianto: fissi,
    attesi: ancoraAttesi(ATTESI, ultimi),
    // Lo schema di cosa carica le batterie, gia' masticato: la pagina lo
    // disegna e non fa conti. La logica sta in lib/flusso.js, con le prove.
    // `letture`: il totale da solo non distingue «non entra niente» da «non so
    // niente», perche' sommaPos torna null in entrambi i casi.
    flusso: ramiDellaCarica(conti.fonti_ective, {
      letture: ultimi.some(r => r.dati?.celle_mv),
      // Serve a dire **da dove viene** la 220 che carica le Ective: dalla
      // colonnina o dalla Bluetti. `vecchia` viaggia con lei, perche' su una
      // lettura vecchia non si attribuisce niente.
      bluetti: { ...((bluetti?.apparecchi || [])[0] || {}), vecchia: !!bluetti?.vecchia },
      // L'eta' delle letture delle Ective: oltre la mezz'ora la figura smette
      // di animarsi. Un disegno in movimento su dati vecchi mente meglio di un
      // numero fermo.
      minuti: etaEctiveMinuti(ultimi),
      // L'altro lato della figura: quanto esce dal pacco verso i consumi del
      // camper. Il numero e' gia' fatto -- `conti.js` lo calcola col netto
      // delle due batterie -- e qui si passa soltanto. `null` quando le Ective
      // non si leggono, che e' un'altra cosa da zero.
      consumo: conti.consumo_ective?.valore ?? null,
      // La carica del pacco, che serve a una cosa sola: poter dire «piene»
      // soltanto quando lo sono davvero. Il 21/11/2026 la figura lo diceva
      // con i quadranti al 95 % e 98 %, perche' questo numero non le
      // arrivava e non aveva modo di sapere che stava mentendo.
      carica: conti.consumo_ective?.carica_pacco ?? null,
    }),
    // La stessa figura per la Bluetti: due ingressi, due uscite. L'eta' della
    // lettura viaggia a parte, in `bluetti.vecchia`, e la pagina la scrive
    // accanto ai numeri -- il 19/11 una lettura ferma di sei minuti mostrava
    // una Bluetti al 100% mentre erogava quattrocento watt.
    flusso_bluetti: ramiDellaBluetti((bluetti?.apparecchi || [])[0]),
    istantanee: ultimi,
  });
}));

router.get('/storia', wrap(async (req, res) => {
  const giorni = Math.min(Math.max(Number(req.query.giorni) || 7, 1), 180);
  const grandezza = String(req.query.grandezza || 'carica');
  const righe = (await q(`SELECT quando, apparecchio, valore FROM misure
    WHERE grandezza=$1 AND quando > now() - ($2 || ' days')::interval
    ORDER BY quando`, [grandezza, String(giorni)])).rows;
  const grandezze = (await q('SELECT DISTINCT grandezza FROM misure ORDER BY grandezza')).rows.map(r => r.grandezza);
  res.json({ giorni, grandezza, grandezze, punti: righe });
}));

// Le due serie delle uscite, per i grafici della Storia.
//
// Il raggruppamento si fa **due volte**, e non e' uno spreco. In SQL per non
// portarsi dietro la fila intera: novanta giorni di letture sono qualche
// centinaio di migliaia di righe, e spedirle a Node per mediarle sarebbe
// pagare il trasporto di numeri che vengono buttati subito. In `storico.js`
// perche' li' c'e' la logica che conta -- i buchi, le somme fra apparecchi,
// il mezzo pacco -- ed e' provata.
//
// Le due griglie sono **la stessa griglia**: `da` si arrotonda allo stesso
// reticolo dell'SQL, altrimenti un intervallo potrebbe cadere a cavallo di
// due e il grafico scivolerebbe di un passo.
const USCITE = ['uscita_ac_w', 'uscita_dc_w', 'watt'];

router.get('/storia/uscite', wrap(async (req, res) => {
  const giorni = Math.min(Math.max(Number(req.query.giorni) || 7, 1), 180);
  const passo = passoDelGrafico(giorni);
  // L'SQL raggruppa sul righello **corto**, non su quello disegnato: il verso
  // della corrente va guardato prima di mediare, o la notte che scarica e il
  // giorno che carica si annullano a vicenda. Il perche' per esteso sta in
  // `storico.js`, accanto a FINE_MAX.
  const fine = Math.min(passo, FINE_MAX);
  const sec = fine * 60;

  // Chi e' una batteria lo dice la sua ultima lettura, non il nome: le celle
  // sono il segno che il progetto usa dappertutto. `watt` e' una grandezza di
  // tutti, e il solare dentro il pacco sarebbe un numero falso.
  const batterie = (await q(
    `SELECT apparecchio FROM istantanee WHERE dati->'celle_mv' IS NOT NULL`
  )).rows.map(r => r.apparecchio);

  const righe = (await q(
    `SELECT to_timestamp(floor(extract(epoch from quando) / $1) * $1) AS quando,
            apparecchio, grandezza, avg(valore) AS valore
       FROM misure
      WHERE grandezza = ANY($2)
        AND quando > now() - ($3 || ' days')::interval
      GROUP BY 1, 2, 3
      ORDER BY 1`,
    [sec, USCITE, String(giorni)])).rows;

  // La griglia e' quella del passo disegnato, cosi' i due righelli combaciano
  // e nessun intervallo corto cade a cavallo di due lunghi.
  const griglia = passo * 60000;
  const a = Math.ceil(Date.now() / griglia) * griglia;
  const da = a - giorni * 86400000;
  res.json(serieUscite(righe, { da: new Date(da), a: new Date(a), passo, fine, batterie }));
}));

router.get('/impianto', wrap(async (req, res) => {
  const { righe } = await impianto();
  res.json({ righe });
}));

router.put('/impianto/:chiave', wrap(async (req, res) => {
  const chiave = String(req.params.chiave);
  const esiste = (await q('SELECT 1 FROM impianto WHERE chiave=$1', [chiave])).rowCount;
  if (!esiste) return res.status(404).json({ error: 'Voce sconosciuta' });
  const grezzo = req.body?.valore;
  const valore = grezzo === '' || grezzo === null || grezzo === undefined ? null : Number(grezzo);
  if (valore != null && !Number.isFinite(valore)) return res.status(400).json({ error: 'Non e’ un numero' });
  // Chi scrive un valore a mano lo sta misurando o lo sa: si segna come
  // misurato, cosi' i conti smettono di chiamarsi stime.
  const misurato = req.body?.misurato === false ? false : valore != null;
  await q('UPDATE impianto SET valore=$2, misurato=$3, aggiornato=now() WHERE chiave=$1', [chiave, valore, misurato]);
  await segna('impianto', `${chiave} = ${valore ?? '(vuoto)'}`, req.utente.email);
  res.json({ ok: true });
}));

router.get('/eventi', wrap(async (req, res) => {
  const righe = (await q('SELECT quando, tipo, testo, chi FROM eventi ORDER BY quando DESC LIMIT 100')).rows;
  res.json({ eventi: righe });
}));

// ---- i comandi ----
//
// Si manda un comando solo con `conferma: true` nel corpo. Non e' burocrazia:
// un tocco per sbaglio sullo schermo del telefono, in tasca, spegnerebbe la
// 220 del camper mentre il frigo e' acceso.
// Perche' un comando e' stato rifiutato, detto al proprietario.
//
// `comanda()` mette la spiegazione in italiano nel campo `errore`; il cloud di
// Bluetti, quando parla lui, riempie `messaggio` -- il 17/11 in cinese. Qui si
// leggeva solo `messaggio`, quindi la frase scritta con cura veniva prodotta a
// ogni rifiuto e **buttata via**, e restava la generica «Il cloud ha rifiutato
// il comando»: vera, e inutile.
export const motivoRifiuto = r =>
  r?.errore || r?.messaggio || 'Il cloud ha rifiutato il comando';

router.post('/comandi/:quale', wrap(async (req, res) => {
  const quale = String(req.params.quale);
  const def = COMANDI[quale];
  if (!def) return res.status(404).json({ error: 'Comando sconosciuto' });
  if (req.body?.conferma !== true) {
    return res.status(428).json({ error: 'Serve la conferma', avviso: def.avviso, nome: def.nome });
  }
  const s = await statoBluetti({ fresco: true });
  const a = (s.apparecchi || [])[0];
  if (!a?.sn) return res.status(409).json({ error: 'Nessun apparecchio Bluetti da comandare' });
  const acceso = req.body?.acceso === true;
  const r = await comanda(a.sn, def.codice, acceso ? 1 : 0);
  await segna('comando', `${def.nome} → ${acceso ? 'acceso' : 'spento'} su ${a.nome}: ${r.ok ? 'riuscito' : 'FALLITO — ' + (r.messaggio || '')}`, req.utente.email);
  if (!r.ok) return res.status(502).json({ error: motivoRifiuto(r) });
  res.json({ ok: true });
}));

// Il collegamento al cloud Bluetti si fa da qui: nessun gettone passa da una
// variabile, da una ripubblicazione o da una chat. Si apre la pagina di
// Bluetti, si dice «Agree», e il gettone torna e finisce in archivio.
const ritornoDi = req => `${req.protocol}://${req.get('host')}/api/bluetti/ritorno`;

// Un lasciapassare nuovo a ogni volta che la pagina chiede l'indirizzo. Vale
// un quarto d'ora e una volta sola: e' quello che impedisce a un estraneo di
// far atterrare qui un'autorizzazione non tua.
async function conLasciapassare(req) {
  const passi = randomUUID();
  await q(`INSERT INTO gettoni_cloud (nome, valore, scade, aggiornato)
           VALUES ('bluetti_passi', $1, now() + interval '15 minutes', now())
           ON CONFLICT (nome) DO UPDATE SET valore=$1, scade=now() + interval '15 minutes', aggiornato=now()`,
    [passi]);
  return indirizzoAutorizza(ritornoDi(req), passi);
}

router.get('/bluetti/collegamento', wrap(async (req, res) => {
  res.json({ collegato: await collegato(), indirizzo: await conLasciapassare(req) });
}));

router.post('/bluetti/associa', wrap(async (req, res) => {
  if (!await collegato()) return res.status(400).json({ error: 'Il cloud Bluetti non e’ collegato' });
  const s = await statoBluetti({ fresco: true });
  const sns = (s.apparecchi || []).map(a => a.sn).filter(Boolean);
  if (!sns.length) return res.status(400).json({ error: 'Nessun apparecchio da associare' });
  const r = await associa(sns);
  const dopo = await statoBluetti({ fresco: true });
  // Il loro endpoint dice OK a qualunque seriale: la prova vera e' che dopo
  // arrivino i numeri.
  const numeri = (dopo.apparecchi || []).some(a => a.carica != null);
  await segna('bluetti', `Associazione di ${sns.join(', ')}: ${numeri ? 'arrivano i numeri' : 'ancora nessun numero'}`, req.utente.email);
  res.json({ ...r, sns, arrivano_i_numeri: numeri });
}));

aperte.get('/bluetti/ritorno', wrap(async (req, res) => {
  const codice = String(req.query.code || '');
  if (!codice) return res.redirect('/#/impianto?bluetti=annullato');
  // Il ritorno dall'autorizzazione **non puo' pretendere la sessione**: su
  // iPhone, premendo il tasto dentro l'app in schermata Home, iOS apre la
  // pagina di Bluetti in Safari, che e' un mondo a parte. Il ritorno atterra
  // li', e li' potresti non essere collegato: la porta si chiuderebbe in
  // faccia al gettone. Al suo posto si usa un lasciapassare usa-e-getta,
  // creato quando hai chiesto il collegamento e valido un quarto d'ora.
  const passi = String(req.query.state || '');
  const buono = (await q(`SELECT 1 FROM gettoni_cloud
      WHERE nome='bluetti_passi' AND valore=$1 AND scade > now()`, [passi])).rowCount;
  if (!passi || !buono) {
    await segna('bluetti', 'Ritorno senza lasciapassare valido: ignorato');
    return res.redirect('/#/impianto?bluetti=scaduto');
  }
  await q(`DELETE FROM gettoni_cloud WHERE nome='bluetti_passi'`);   // vale una volta
  const r = await completaAutorizzazione(codice, ritornoDi(req));
  if (!r.ok) {
    await segna('bluetti', `Collegamento fallito: ${r.errore}`);
    return res.redirect('/#/impianto?bluetti=fallito');
  }
  // Appena collegati, gli apparecchi vanno associati: senza quel passaggio il
  // cloud risponde «spento, lista vuota» e sembra un guasto.
  const s = await statoBluetti({ fresco: true });
  const sns = (s.apparecchi || []).map(a => a.sn).filter(Boolean);
  if (sns.length) await associa(sns);
  res.redirect('/#/impianto?bluetti=fatto');
}));
