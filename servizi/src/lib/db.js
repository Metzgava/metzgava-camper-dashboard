// L'archivio di Camper Servizi.
//
// Sta a parte da quello dei viaggi: qui dentro non c'e' niente di un viaggio, e
// un guasto di qua non puo' toccare di la'.
import pg from 'pg';

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL mancante. Su Railway collega la variabile al servizio PostgreSQL.');
  process.exit(1);
}

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: /railway|render|amazonaws|supabase/.test(process.env.DATABASE_URL) ? { rejectUnauthorized: false } : false,
  max: 5,
});

export const q = (testo, parametri) => pool.query(testo, parametri);

// I dati fissi del camper. Stanno in archivio e non nel codice per una ragione
// precisa: sono suoi, cambiano quando cambia un pezzo, e una proiezione fatta
// su un numero sbagliato e' peggio di nessuna proiezione.
//
// «misurato = false» vuol dire che il valore viene da un catalogo. Ogni conto
// che lo usa lo dichiara, e quando una ricarica vera permette di misurarlo, il
// valore viene sostituito e la bandierina diventa vera.
// Riferito il 16/11/2026: il Charger 2 non supera i 700 W sulla Elite 300.
// E' un'osservazione sull'impianto vero, quindi vale piu' di un dato di
// catalogo — ma vale al regime a cui e' stata fatta: al minimo l'alternatore
// puo' darne meno, e allora i tempi veri si allungano.
// I consumi della Truma, misurati il 28/11/2026 invece che letti dal manuale.
//
// Si sono potuti misurare perche' quel giorno il 220 del camper era
// alimentato **dalla Bluetti**, e allora la Truma passa dentro un registro
// che lei conta: `[142]`, i watt in uscita, appaiato con la sua app nello
// stesso minuto (0 a vuoto, 889 in EL1, 1,8 kW in EL2). Dalla colonnina non
// si vede niente: a bordo nessun sensore guarda la 220.
//
// Prima qui c'erano 900 e 1800 «dal manuale Truma» **con la bandierina del
// misurato alzata** -- cioe' esattamente quel che la regola venti righe sopra
// vieta. E non era cosmetico: `ore_truma_el1` e `ore_truma_el2` scelgono il
// bollino guardando quel campo.
const NOTA_TRUMA_EL1 = 'Resistenza elettrica della Combi, livello 1 (EL 1 e MIX 1). '
  + 'Misurata il 28/11/2026 sui watt in uscita della Bluetti: 889 W, '
  + 'contro i 900 dichiarati da Truma.';
// **Un campione solo**, e la nota lo dice: il proprietario ha scelto di
// scriverlo senza altre misure dopo che gliel'ho detto. Senza questa riga,
// fra sei mesi 1733 sembrerebbe una misura ripetuta. Il registro segnava
// 1733 e l'app arrotondava a 1,8 kW.
const NOTA_TRUMA_EL2 = 'Resistenza elettrica della Combi, livello 2 (EL 2 e MIX 2). '
  + 'Misurata il 28/11/2026 sui watt in uscita della Bluetti: 1733 W '
  + '(l\u2019app arrotondava a 1,8 kW), contro i 1800 dichiarati da Truma. '
  + 'Da una sola lettura, a 231 V.';
// La scoperta pratica del 28/11: con l'abitacolo gia' a temperatura, EL2
// **non** consuma il doppio. La resistenza dell'aria non ha lavoro e resta
// solo l'acqua, 885 W in qualunque modalita'. E' la condizione piu' comune di
// una notte in sosta, e senza questa riga il conto delle ore in quello stato
// sbaglia di un fattore due.
//
// I conti tornano fra loro, che e' la conferma migliore: 1733 - 884 = 849 W
// per la resistenza dell'aria, contro gli 885 W di quella dell'acqua da sola.
// Due resistenze quasi gemelle, come devono essere su una Combi -- e nessuno
// dei due numeri e' stato scelto: escono dalla sottrazione.
const NOTA_TRUMA_BOILER = 'Combi che scalda solo l\u2019acqua, con l\u2019aria gia\u2019 a '
  + 'temperatura: la seconda resistenza non lavora e EL 2 consuma come EL 1. '
  + 'Misurato il 28/11/2026 sui watt in uscita della Bluetti.';
// Misurato ai due capi il 28/11, confrontando i watt in uscita `[142]` con
// quelli dal lato batteria `[101]`: 885 -> 973 fa 0,91; 1733 -> 1986 fa 0,87.
//
// **Dipende dal carico, e qui si prende il peggiore.** Non la media e non il
// migliore: questo numero divide un'autonomia, e un rendimento generoso
// promette ore che non ci sono. E il carico alto e' proprio quello che
// interessa, perche' e' la Truma in EL2.
const NOTA_RENDIMENTO_INVERTER = 'Rendimento dell\u2019inverter della Bluetti verso la '
  + '230 V. Misurato il 28/11/2026 a due carichi: 0,91 a 885 W e 0,87 a 1733 W. '
  + 'Si tiene il peggiore, perche\u2019 divide un\u2019autonomia.';

const NOTA_CHARGER = 'Riferito il 16/11/2026: il Charger 2 non supera i 700 W sulla Elite 300. '
  + 'Al minimo l’alternatore potrebbe darne meno, quindi i tempi veri possono allungarsi.';

// Questo numero **non e' piu' quello da cui si parte**, ed e' per questo che
// il suo bollino dice «stima» anche se una misura l'ha prodotto.
//
// Dal 21/11/2026 il consumo a riposo si ricava dalle notti in archivio -- buio
// sui pannelli, nessuna erogazione dalla Bluetti sul 12 V -- e quel conto e'
// sempre fresco. Questo serve soltanto finche' quelle notti non ci sono.
//
// E' lo stesso difetto che il 20/11 avevamo trovato nella riga degli
// apparecchi attesi: un numero misurato una volta e poi mai piu' e' una stima
// travestita da misura, e invecchia senza dirlo. Gli 11 W erano veri prima che
// in camper arrivassero la scatoletta e Starlink.
const NOTA_FERMO = 'Ripiego: dal 21/11/2026 il consumo a riposo si misura da se’, '
  + 'dalle notti senza sole in archivio. Questo numero vale solo finche’ quelle notti '
  + 'non ci sono. Misurato il 16/11/2026: batterie −0,29 A piu’ pannelli +0,5 A.';

const IMPIANTO = [
  ['bluetti_wh', 2764, 'Wh', 'Capacita’ dell’Elite 300. Da catalogo: da correggere se il tuo modello differisce.', false],
  ['bluetti_carica_ac_w', 1800, 'W', 'Potenza di carica da presa 220 V: quel che la Bluetti sa prendere, non quel che la presa sa dare.', false],
  // Gli ampere della presa a cui sei attaccato.
  //
  // **Sta in questa tabella ma non si mostra fra i dati fissi**, e il perche'
  // conta: ogni altra riga qui dentro cambia quando cambi un pezzo di camper
  // -- capacita', Charger, Truma, rendimento dell'inverter. Questa cambia a
  // **ogni piazzola**. Sarebbe l'unica riga da toccare in viaggio, e metterla
  // fra i dati fissi vuol dire farsi tre schermate per cambiare un numero che
  // si legge sul palo mentre si attacca il cavo.
  //
  // Quindi si scegle accanto al tempo di ricarica, dove si usa. In archivio
  // sta qui perche' deve essere la stessa sull'iPad e sul telefono: in
  // `localStorage` sarebbe di un apparecchio solo.
  ['colonnina_a', null, 'A', 'Ampere della presa a cui sei attaccato. Si sceglie in «Quanto ci vuole a caricarla», non qui: cambia a ogni piazzola.', false],
  ['charger_w', 700, 'W', NOTA_CHARGER, true],
  ['ective_ah', 190, 'Ah', 'Capacita’ totale delle due Ective (95 + 95). Letta dalle batterie stesse.', true],
  ['ective_v', 12.8, 'V', 'Tensione nominale del pacco LiFePO4, per passare da Ah a Wh.', true],
  ['ective_carica_a', null, 'A', 'Ampere del caricabatterie che alimenta le Ective dalla 220. DA COMPILARE.', false],
  ['rendimento_bluetti_ective', 0.80, '', 'Rendimento della catena Bluetti → inverter → caricabatterie → Ective. Stima prudente: si misura guardando salire una carica e scendere l’altra.', false],
  ['truma_el1_w', 889, 'W', NOTA_TRUMA_EL1, true],
  ['truma_el2_w', 1733, 'W', NOTA_TRUMA_EL2, true],
  ['truma_boiler_w', 885, 'W', NOTA_TRUMA_BOILER, true],
  ['rendimento_inverter_bluetti', 0.87, '', NOTA_RENDIMENTO_INVERTER, true],
  ['consumo_fermo_w', 11, 'W', NOTA_FERMO, false],
  ['starlink_w', 18.1, 'W', 'Consumo medio di Starlink. Misurato il 16/11/2026 su 900 campioni al secondo.', true],
  ['scatoletta_w', 1.5, 'W', 'Consumo del Raspberry in camper. Da misurare quando sara’ in funzione.', false],
];

export async function migrate() {
  await q(`
  -- Chi puo' entrare. Elenco suo: l'app dei viaggi ha il proprio.
  CREATE TABLE IF NOT EXISTS utenti (
    id SERIAL PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    nome TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    ruolo TEXT NOT NULL DEFAULT 'admin',
    creato TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  -- Lo stato di adesso, un record per apparecchio, riscritto a ogni lettura.
  -- Serve a disegnare la pagina senza ricalcolare niente.
  CREATE TABLE IF NOT EXISTS istantanee (
    apparecchio TEXT PRIMARY KEY,
    fonte TEXT NOT NULL,
    dati JSONB NOT NULL,
    quando TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  -- La fila delle misure, in formato lungo: una riga per grandezza. Aggiungere
  -- un apparecchio non vuol dire cambiare la tabella, e un grafico e' una
  -- query sola.
  CREATE TABLE IF NOT EXISTS misure (
    id BIGSERIAL PRIMARY KEY,
    quando TIMESTAMPTZ NOT NULL DEFAULT now(),
    apparecchio TEXT NOT NULL,
    grandezza TEXT NOT NULL,
    valore DOUBLE PRECISION,
    testo TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_misure ON misure(apparecchio, grandezza, quando DESC);
  CREATE INDEX IF NOT EXISTS idx_misure_quando ON misure(quando DESC);

  -- I dati fissi dell'impianto, correggibili dalla pagina.
  CREATE TABLE IF NOT EXISTS impianto (
    chiave TEXT PRIMARY KEY,
    valore DOUBLE PRECISION,
    unita TEXT,
    nota TEXT,
    misurato BOOLEAN NOT NULL DEFAULT false,
    aggiornato TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  -- I gettoni dei servizi esterni. Non possono stare in una variabile
  -- d'ambiente: un gettone rinnovato dal programma non sa tornarci dentro.
  -- La variabile ne semina il primo, poi la verita' sta qui.
  CREATE TABLE IF NOT EXISTS gettoni_cloud (
    nome TEXT PRIMARY KEY,
    valore TEXT NOT NULL,
    scade TIMESTAMPTZ,
    aggiornato TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  -- Quel che e' successo: un comando mandato, un allarme scattato, un gettone
  -- rinnovato. Serve a rispondere a «perche' ieri sera era spento?».
  -- La taratura: la serata in cui si accende un carico per volta e si guarda
  -- lo scalino nella corrente. Serve per avere i consumi di QUESTO camper
  -- invece di numeri da catalogo.
  --
  -- La sessione ha una scadenza e non un interruttore: mentre e' aperta la
  -- scatoletta legge ogni dieci secondi invece di ogni cinque minuti, e una
  -- modalita' veloce dimenticata accesa consuma corrente e logora la scheda.
  -- Con la scadenza, il caso peggiore e' mezz'ora.
  CREATE TABLE IF NOT EXISTS taratura_sessione (
    id SERIAL PRIMARY KEY,
    aperta TIMESTAMPTZ NOT NULL DEFAULT now(),
    scade TIMESTAMPTZ NOT NULL,
    chiusa TIMESTAMPTZ
  );

  -- Un segno per ogni carico acceso: il nome e l'istante. Lo scalino **non**
  -- si scrive qui: si ricalcola dalle misure quando serve. Cosi' se domani il
  -- modo di calcolarlo migliora, i segni di ieri valgono ancora; un numero
  -- congelato invece resterebbe sbagliato per sempre.
  CREATE TABLE IF NOT EXISTS taratura_segni (
    id SERIAL PRIMARY KEY,
    sessione INT REFERENCES taratura_sessione(id) ON DELETE CASCADE,
    nome TEXT NOT NULL,
    quando TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE TABLE IF NOT EXISTS eventi (
    id BIGSERIAL PRIMARY KEY,
    quando TIMESTAMPTZ NOT NULL DEFAULT now(),
    tipo TEXT NOT NULL,
    testo TEXT NOT NULL,
    chi TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_eventi ON eventi(quando DESC);
  `);

  for (const [chiave, valore, unita, nota, misurato] of IMPIANTO) {
    await q(`INSERT INTO impianto (chiave, valore, unita, nota, misurato)
             VALUES ($1,$2,$3,$4,$5) ON CONFLICT (chiave) DO NOTHING`,
      [chiave, valore, unita, nota, misurato]);
  }

  // Il Charger 2 era nato vuoto: se e' ancora cosi', ci si mette il valore
  // riferito. **Solo se e' vuoto**: un numero scritto a mano dall'utente vale
  // piu' di uno scritto dal codice, e non si sovrascrive mai dall'alto.
  await q(`UPDATE impianto SET valore=$1, misurato=true, nota=$2, aggiornato=now()
           WHERE chiave='charger_w' AND valore IS NULL`, [700, NOTA_CHARGER]);

  // La riga di `consumo_fermo_w` esiste in produzione dal 16/11, e il seme
  // qui sopra e' `ON CONFLICT DO NOTHING`: la nota nuova non arriverebbe mai
  // da sola. Si aggiornano **la nota e il bollino**, non il valore -- quello
  // serve ancora da ripiego, e un numero scritto a mano non si sovrascrive
  // mai dall'alto.
  await q(`UPDATE impianto SET nota=$1, misurato=false, aggiornato=now()
           WHERE chiave='consumo_fermo_w' AND nota <> $1`, [NOTA_FERMO]);

  // I valori della Truma e il rendimento dell'inverter, misurati il
  // 28/11/2026. Le righe esistono in produzione dal 16/11 e il seme e' `ON
  // CONFLICT DO NOTHING`: senza questi aggiornamenti la misura non
  // arriverebbe mai dove serve.
  //
  // **Condizionati al valore di catalogo che stanno sostituendo.** E' la
  // regola di questo archivio, la stessa del Charger: un numero scritto a
  // mano dall'utente vale piu' di uno scritto dal codice, e non si
  // sovrascrive mai dall'alto. Se lui ha messo 1500 perche' ha misurato a
  // modo suo, resta 1500 -- e la nota nuova non gliela si attacca sopra un
  // valore che non le corrisponde.
  for (const [chiave, catalogo, misura, nota] of [
    ['truma_el1_w', 900, 889, NOTA_TRUMA_EL1],
    ['truma_el2_w', 1800, 1733, NOTA_TRUMA_EL2],
    ['rendimento_inverter_bluetti', 0.90, 0.87, NOTA_RENDIMENTO_INVERTER],
  ]) {
    await q(`UPDATE impianto SET valore=$1, nota=$2, misurato=true, aggiornato=now()
             WHERE chiave=$3 AND valore=$4`, [misura, nota, chiave, catalogo]);
  }
}

export async function segna(tipo, testo, chi = null) {
  await q('INSERT INTO eventi (tipo, testo, chi) VALUES ($1,$2,$3)', [tipo, testo, chi]);
}
