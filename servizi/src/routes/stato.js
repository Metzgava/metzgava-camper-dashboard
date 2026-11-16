// Quel che la pagina chiede: lo stato di adesso, i conti, la storia,
// l'impianto, i comandi.
//
// Una regola vale per tutte queste rotte: **quel che non si sa non si
// inventa.** Un apparecchio che non si legge ancora torna con `stato: "atteso"`
// e il motivo scritto in chiaro, non con dei valori a zero. Uno zero su una
// carica vuol dire «scarica», e sarebbe una bugia.
import { Router } from 'express';
import { q, segna } from '../lib/db.js';
import { statoBluetti, collegato, associa, comanda, COMANDI,
  indirizzoAutorizza, completaAutorizzazione } from '../lib/bluetti.js';
import { tuttiIConti, impianto } from '../lib/conti.js';
import { serveAccesso } from './auth.js';

export const router = Router();
router.use(serveAccesso);

const wrap = f => (req, res, next) => Promise.resolve(f(req, res, next)).catch(next);

// Gli apparecchi che esistono nel camper ma che ancora non parlano con noi.
// Elencarli non e' un difetto: e' la differenza fra «non c'e'» e «non lo so».
const ATTESI = [
  { id: 'ective', nome: 'Batterie Ective', icona: '\u{1F50B}',
    perche: 'Parlano solo via Bluetooth, dieci metri di raggio. Arrivano con la scatoletta in camper.',
    cosa: 'volt, ampere, carica, le quattro celle, temperatura, cicli' },
  { id: 'smartsolar', nome: 'SmartSolar MPPT', icona: '☀️',
    perche: 'Annunci Bluetooth cifrati: si leggono solo da vicino. Chiave gia’ in mano.',
    cosa: 'volt, ampere, watt dai pannelli, resa del giorno' },
  { id: 'orion', nome: 'Orion XS', icona: '\u{1F501}',
    perche: 'Come sopra. Decodificato e verificato il 16/11/2026.',
    cosa: 'volt e ampere dei due lati, stato della carica' },
  { id: 'allarme', nome: 'Centrale d’allarme', icona: '\u{1F6A8}',
    perche: 'Si legge in locale sulla rete del camper, protocollo 3.5. Arriva con la scatoletta.',
    cosa: 'inserito o no, se e’ scattato e da quale zona, batteria' },
  { id: 'starlink', nome: 'Starlink', icona: '\u{1F6F0}️',
    perche: 'Si legge solo dalla rete del piatto.',
    cosa: 'watt istantanei e un quarto d’ora di storia al secondo' },
];

router.get('/stato', wrap(async (req, res) => {
  const bluetti = await statoBluetti({ fresco: req.query.fresco === '1' });
  const conti = await tuttiIConti(bluetti);
  const collegamento = { collegato: await collegato(), indirizzo: indirizzoAutorizza(ritornoDi(req)) };
  const ultimi = (await q(`SELECT apparecchio, fonte, dati, quando FROM istantanee ORDER BY quando DESC`)).rows;
  res.json({
    letto_il: new Date().toISOString(),
    bluetti,
    conti,
    comandi: COMANDI,
    collegamento,
    attesi: ATTESI,
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
  if (!r.ok) return res.status(502).json({ error: r.messaggio || 'Il cloud ha rifiutato il comando' });
  res.json({ ok: true });
}));

// Il collegamento al cloud Bluetti si fa da qui: nessun gettone passa da una
// variabile, da una ripubblicazione o da una chat. Si apre la pagina di
// Bluetti, si dice «Agree», e il gettone torna e finisce in archivio.
const ritornoDi = req => `${req.protocol}://${req.get('host')}/api/bluetti/ritorno`;

router.get('/bluetti/collegamento', wrap(async (req, res) => {
  res.json({ collegato: await collegato(), indirizzo: indirizzoAutorizza(ritornoDi(req)) });
}));

router.get('/bluetti/ritorno', wrap(async (req, res) => {
  const codice = String(req.query.code || '');
  if (!codice) return res.redirect('/#/impianto?bluetti=annullato');
  const r = await completaAutorizzazione(codice, ritornoDi(req));
  if (!r.ok) {
    await segna('bluetti', `Collegamento fallito: ${r.errore}`, req.utente.email);
    return res.redirect('/#/impianto?bluetti=fallito');
  }
  // Appena collegati, gli apparecchi vanno associati: senza quel passaggio il
  // cloud risponde «spento, lista vuota» e sembra un guasto.
  const s = await statoBluetti({ fresco: true });
  const sns = (s.apparecchi || []).map(a => a.sn).filter(Boolean);
  if (sns.length) await associa(sns);
  res.redirect('/#/impianto?bluetti=fatto');
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
