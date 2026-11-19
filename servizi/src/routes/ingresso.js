// La porta da cui entrano le misure prese in camper.
//
// Ci bussa la scatoletta — il Raspberry quando sara' a bordo, il Mac nel
// frattempo. Non e' dietro al login delle persone: un programma non ha una
// sessione. Ha una chiave sua, che vale **solo** per scrivere misure e per
// nient'altro: non legge l'impianto, non manda comandi, non vede gli utenti.
//
// Se quella chiave finisse in mani sbagliate il danno sarebbe scrivere letture
// false. Spiacevole, non grave, e si cambia in un minuto.
import { Router } from 'express';
import { q, segna } from '../lib/db.js';
import { sessioneAttiva } from './taratura.js';

export const router = Router();
const wrap = f => (req, res, next) => Promise.resolve(f(req, res, next)).catch(next);

// Le grandezze che accettiamo, con il loro intervallo credibile. Una lettura
// fuori scala non si scrive: quasi sempre vuol dire che il decodificatore ha
// sbagliato un byte, e un numero assurdo in archivio sporca i grafici per
// sempre. Meglio perderla e accorgersene.
export const AMMESSE = {
  carica: [0, 100],
  volt: [0, 80],
  ampere: [-400, 400],
  watt: [-6000, 6000],
  temperatura: [-40, 90],
  // Mancavano, e la mancanza non si vedeva: i termometri mandano l'umidita'
  // da sempre, e il server la scartava a ogni giro con una riga negli eventi.
  // Nessun errore, nessun grafico, e nessuno se ne era accorto.
  umidita: [0, 100],
  // La carica della pila di un termometro. Non e' un dato che serve a leggere
  // la temperatura: serve a sapere quando cambiarla prima che smetta.
  pila: [0, 100],
  celle_scarto_mv: [0, 2000],
  cicli: [0, 20000],
  capacita_ah: [0, 2000],
  pannelli_w: [0, 4000],
  resa_oggi_kwh: [0, 60],
  // Quanto forte si sente un apparecchio. Negativo sempre: 0 sarebbe
  // un trasmettitore attaccato all'antenna.
  rssi: [-120, 0],
};

// L'istantanea passata al setaccio. Torna la lettura senza i valori
// impossibili, e l'elenco di quel che ha tolto per la riga negli eventi.
//
// Perche' serve, se `AMMESSE` c'e' gia'. Perche' quel controllo protegge solo
// lo **storico**: l'istantanea si scriveva due righe prima, intera e senza
// guardarla, ed e' quella che l'app mostra nel riquadro «adesso». Un numero
// assurdo veniva rifiutato dai grafici e mostrato in pagina -- il posto dove
// lo si guarda per decidere se accendere il 220 o rientrare.
//
// Qui si butta il singolo valore, non tutta la lettura, al contrario della
// scatoletta. Lei sa che un byte perso sposta i byte dopo **nello stesso
// pacchetto** e butta il pacchetto; il server riceve campi gia' decodificati
// da apparecchi diversi e non puo' fare quella deduzione. Tolto l'assurdo, il
// resto resta buono -- e un valore assente e' onesto, «non si sa», mentre un
// valore sbagliato no.
export function setaccia(dati) {
  const puliti = {}, fuori = [];
  for (const [grandezza, valore] of Object.entries(dati || {})) {
    const limiti = AMMESSE[grandezza];
    // Niente scala: non e' una misura (lo stato del caricabatterie, le
    // tensioni di cella, un nome). Passa com'e'.
    // Niente valore: `agente.py` mette null dove l'apparecchio non ha
    // risposto, ed e' la prima regola del progetto. `Number(null)` fa 0, che
    // sta dentro quasi tutte le scale: senza questo controllo un «non lo so»
    // passerebbe per uno zero credibile.
    if (!limiti || valore === null || valore === undefined) {
      puliti[grandezza] = valore;
      continue;
    }
    const v = Number(valore);
    if (!Number.isFinite(v) || v < limiti[0] || v > limiti[1]) {
      fuori.push(`${grandezza}=${valore}`);
      continue;
    }
    puliti[grandezza] = valore;
  }
  return { puliti, fuori };
}

export const chiave = () => process.env.INGEST_TOKEN || null;

// Questo controllo vale per le rotte di QUESTO router, e il router si monta
// sul proprio indirizzo. Montato su /api si metteva davanti a tutto, accesso
// compreso: l'app rispondeva «porta non configurata» a chiunque. Una riga, e
// il servizio era morto per tutti.
router.use((req, res, next) => {
  const atteso = chiave();
  if (!atteso) return res.status(503).json({ error: 'La porta della scatoletta non e’ configurata' });
  const dato = (req.get('authorization') || '').replace(/^Bearer\s+/i, '');
  // Confronto a lunghezza costante: su una chiave corta non cambia il mondo,
  // ma non costa niente e toglie un pensiero.
  if (dato.length !== atteso.length) return res.status(401).json({ error: 'Chiave errata' });
  let diverso = 0;
  for (let i = 0; i < atteso.length; i++) diverso |= dato.charCodeAt(i) ^ atteso.charCodeAt(i);
  if (diverso) return res.status(401).json({ error: 'Chiave errata' });
  next();
});

// Il corpo: { fonte, apparecchi: [ { id, nome, tipo, dati: {...}, misure: {grandezza: valore} } ] }
router.post('/', wrap(async (req, res) => {
  const apparecchi = Array.isArray(req.body?.apparecchi) ? req.body.apparecchi : [];
  if (!apparecchi.length) return res.status(400).json({ error: 'Nessun apparecchio' });

  let scritte = 0, scartate = [];
  for (const a of apparecchi) {
    const id = String(a.id || '').slice(0, 80);
    if (!id) continue;
    const { puliti, fuori } = setaccia(a.dati);
    for (const guasto of fuori) scartate.push(`${id}/${guasto}: fuori scala, non mostrato`);
    await q(`INSERT INTO istantanee (apparecchio, fonte, dati, quando) VALUES ($1,$2,$3,now())
             ON CONFLICT (apparecchio) DO UPDATE SET dati=$3, quando=now(), fonte=$2`,
      [id, String(req.body.fonte || 'scatoletta').slice(0, 40), puliti]);
    for (const [grandezza, valore] of Object.entries(a.misure || {})) {
      const limiti = AMMESSE[grandezza];
      if (!limiti) { scartate.push(`${id}/${grandezza}: grandezza sconosciuta`); continue; }
      const v = Number(valore);
      if (!Number.isFinite(v)) { scartate.push(`${id}/${grandezza}: non e’ un numero`); continue; }
      if (v < limiti[0] || v > limiti[1]) { scartate.push(`${id}/${grandezza}=${v}: fuori scala`); continue; }
      await q('INSERT INTO misure (apparecchio, grandezza, valore) VALUES ($1,$2,$3)', [id, grandezza, v]);
      scritte++;
    }
  }
  // Le letture scartate si dicono, non si ingoiano: sono il primo segnale che
  // un decodificatore ha perso un byte.
  if (scartate.length) await segna('ingresso', `Scartate ${scartate.length}: ${scartate.slice(0, 5).join('; ')}`, 'scatoletta');
  // La risposta e' anche il canale per dire qualcosa alla scatoletta: lei
  // bussa, noi rispondiamo. Nessuna porta da aprire verso il camper, nessuna
  // interrogazione periodica a vuoto — e durante la taratura, siccome il giro
  // e' da dieci secondi, un cambio arriva in dieci secondi.
  res.json({ ok: true, scritte, scartate: scartate.length, taratura: await sessioneAttiva() });
}));

// La scatoletta chiede «ci sei?» prima di mettersi a leggere, cosi' non
// raccoglie dati per mezz'ora e poi scopre che non puo' spedirli.
router.get('/prova', (req, res) => res.json({ ok: true }));
