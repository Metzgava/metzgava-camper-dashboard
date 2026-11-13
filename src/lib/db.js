import pg from 'pg';

const { Pool } = pg;
// Le colonne DATE restano stringhe 'YYYY-MM-DD' (niente slittamenti di fuso orario)
pg.types.setTypeParser(1082, v => v);
pg.types.setTypeParser(1700, v => (v === null ? null : parseFloat(v))); // NUMERIC -> number

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('DATABASE_URL mancante. Su Railway aggiungi un servizio PostgreSQL e collega la variabile.');
  process.exit(1);
}

export const pool = new Pool({
  connectionString,
  ssl: /railway|proxy\.rlwy\.net|render|neon|supabase/.test(connectionString) && !/localhost|127\.0\.0\.1/.test(connectionString)
    ? { rejectUnauthorized: false }
    : false,
});

export const q = (text, params) => pool.query(text, params);


// La durata delle tappe di CarLock veniva letta dal testo del file, dove i
// minuti sono scritti «m» e non «min»: «1h 29m» diventava un'ora tonda. Dove ci
// sono gli orari la durata si conta, e non si legge. In SQL questo controllo
// non regge: il pianificatore puo' valutare la sottrazione prima del filtro sul
// formato, e su un orario vuoto la conversione a numero fa cadere tutto.
export async function sistemaDurateCarlock() {
  // Solo le tappe fatte di un tragitto solo: li' fra la partenza e l'arrivo si
  // e' guidato e basta. In una tappa che unisce piu' tragitti, in mezzo ci sono
  // le soste, e il tempo trascorso non e' tempo di guida.
  const righe = (await q(`SELECT id, start_time, end_time, duration_min FROM legs
    WHERE source='carlock' AND start_time IS NOT NULL AND end_time IS NOT NULL
      AND coalesce(external_id,'') NOT LIKE '%+%'`)).rows;
  const minuti = t => { const m = String(t || '').match(/^(\d{1,2}):(\d{2})/); return m ? +m[1] * 60 + +m[2] : null; };
  let corrette = 0;
  for (const l of righe) {
    const a = minuti(l.start_time), b = minuti(l.end_time);
    if (a == null || b == null) continue;
    const giusta = b >= a ? b - a : b + 1440 - a;
    if (giusta === l.duration_min) continue;
    await q('UPDATE legs SET duration_min=$2 WHERE id=$1', [l.id, giusta]);
    corrette++;
  }
  if (corrette) console.log(`tappe CarLock: durata ricontata su ${corrette}`);
  return corrette;
}

// Una sosta che costa e' una spesa del viaggio. Le soste gia' in archivio col
// loro costo la ricevono qui. Gira a ogni avvio senza rifare niente: salta
// quelle che una spesa ce l'hanno e quelle a cui e' stata tolta a mano.
async function spesePerSosteGiaScritte() {
  // Le spese nate da una sosta prima che il luogo esistesse: il posto lo sanno,
  // e' la sosta stessa, e senza restavano nel mucchio del «senza luogo»
  const senza = await q(`UPDATE expenses e SET place = s.name FROM stops s
    WHERE e.stop_id = s.id AND e.place IS NULL`);
  if (senza.rowCount) console.log(`spese di sosta: luogo messo su ${senza.rowCount}`);

  const r = await q(`INSERT INTO expenses(trip_id, stop_id, date, category, description, place, amount, currency, rate, auto)
    SELECT s.trip_id, s.id, coalesce(s.from_date, current_date),
      CASE s.kind WHEN 'camping' THEN 'campeggio' WHEN 'appartamento' THEN 'altro' ELSE 'area_sosta' END,
      s.name || CASE WHEN s.from_date IS NOT NULL AND s.to_date IS NOT NULL AND s.to_date > s.from_date
        THEN ' (' || (s.to_date - s.from_date) || CASE WHEN s.to_date - s.from_date = 1 THEN ' notte)' ELSE ' notti)' END
        ELSE '' END,
      s.name, s.cost, s.currency, s.rate, true
    FROM stops s
    WHERE s.cost > 0 AND NOT s.senza_spesa
      AND NOT EXISTS (SELECT 1 FROM expenses e WHERE e.stop_id = s.id)`);
  if (r.rowCount) console.log(`soste: ${r.rowCount} cost${r.rowCount === 1 ? 'o entrato' : 'i entrati'} fra le spese del viaggio`);
  return r.rowCount;
}

// Le categorie di spesa stanno nelle impostazioni, e quelle di un archivio gia'
// avviato l'INSERT iniziale non le tocca. Le nuove si infilano qui, una volta
// sola, accanto a quella a cui somigliano: chi ha riordinato le sue se le ritrova
// come le aveva lasciate, con due voci in piu'.
async function categorieNuove(nuove, dopo) {
  const riga = (await q(`SELECT value FROM settings WHERE key='categories'`)).rows[0];
  const elenco = Array.isArray(riga?.value) ? [...riga.value] : null;
  if (!elenco) return;
  const mancanti = nuove.filter(c => !elenco.includes(c));
  if (!mancanti.length) return;
  const dove = elenco.indexOf(dopo);
  elenco.splice(dove < 0 ? elenco.length : dove + 1, 0, ...mancanti);
  await q(`UPDATE settings SET value=$1::jsonb WHERE key='categories'`, [JSON.stringify(elenco)]);
  console.log(`spese: categorie aggiunte (${mancanti.join(', ')})`);
}

export async function migrate() {
  await q(`
  CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'member',        -- admin | member
    approved BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE TABLE IF NOT EXISTS invites (
    id SERIAL PRIMARY KEY,
    code TEXT UNIQUE NOT NULL,
    created_by INT REFERENCES users(id) ON DELETE SET NULL,
    used_by INT REFERENCES users(id) ON DELETE SET NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  -- Dispositivi (iPhone) autorizzati: ognuno ha un token per inviare allenamenti/salute
  CREATE TABLE IF NOT EXISTS devices (
    id SERIAL PRIMARY KEY,
    user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    token_hash TEXT UNIQUE NOT NULL,
    token_hint TEXT NOT NULL,
    approved BOOLEAN NOT NULL DEFAULT false,
    last_seen_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value JSONB NOT NULL
  );

  CREATE TABLE IF NOT EXISTS trips (
    id SERIAL PRIMARY KEY,
    user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    start_date DATE,
    end_date DATE,
    status TEXT NOT NULL DEFAULT 'open',          -- bozza | open | closed
    fuel_price NUMERIC(6,3),                       -- €/litro predefinito per il viaggio
    km_per_liter NUMERIC(5,2) NOT NULL DEFAULT 10,
    notes TEXT,
    closed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  -- Tappe: ogni tappa è un tratto A->B con distanza calcolata via OSRM
  CREATE TABLE IF NOT EXISTS legs (
    id SERIAL PRIMARY KEY,
    trip_id INT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
    position INT NOT NULL DEFAULT 0,
    date DATE,
    from_name TEXT NOT NULL,
    from_lat DOUBLE PRECISION NOT NULL,
    from_lon DOUBLE PRECISION NOT NULL,
    to_name TEXT NOT NULL,
    to_lat DOUBLE PRECISION NOT NULL,
    to_lon DOUBLE PRECISION NOT NULL,
    distance_km NUMERIC(8,2) NOT NULL DEFAULT 0,
    duration_min INT NOT NULL DEFAULT 0,
    fuel_price NUMERIC(6,3),                       -- €/litro specifico per questa tappa (opzionale)
    geometry JSONB,                                -- polyline [[lat,lon],...]
    pois JSONB,                                    -- aree sosta trovate all'arrivo
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE TABLE IF NOT EXISTS expenses (
    id SERIAL PRIMARY KEY,
    trip_id INT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
    leg_id INT REFERENCES legs(id) ON DELETE SET NULL,
    date DATE NOT NULL DEFAULT CURRENT_DATE,
    category TEXT NOT NULL,                        -- gasolio | traghetto | area_sosta | vitto | pedaggi | altro ...
    description TEXT,
    amount NUMERIC(10,2) NOT NULL,
    auto BOOLEAN NOT NULL DEFAULT false,           -- generata automaticamente (gasolio)
    edited BOOLEAN NOT NULL DEFAULT false,         -- modificata a mano: non viene più ricalcolata
    meta JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE TABLE IF NOT EXISTS workouts (
    id SERIAL PRIMARY KEY,
    user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    trip_id INT REFERENCES trips(id) ON DELETE SET NULL,
    source TEXT NOT NULL,                          -- komoot | gpx | health
    external_id TEXT,
    sport TEXT,
    name TEXT,
    started_at TIMESTAMPTZ NOT NULL,
    duration_s INT,
    distance_m INT,
    elevation_up_m INT,
    calories INT,
    hr_avg INT,
    hr_max INT,
    speed_avg_kmh NUMERIC(6,2),
    track JSONB,                                   -- [[lat,lon,ele?],...] campionato
    meta JSONB,
    UNIQUE (user_id, source, external_id)
  );

  CREATE TABLE IF NOT EXISTS photos (
    id SERIAL PRIMARY KEY,
    user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    trip_id INT REFERENCES trips(id) ON DELETE CASCADE,
    leg_id INT REFERENCES legs(id) ON DELETE SET NULL,
    filename TEXT NOT NULL,
    caption TEXT,
    taken_at TIMESTAMPTZ,
    lat DOUBLE PRECISION,
    lon DOUBLE PRECISION,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  -- Collegamenti esterni (Komoot): il token è cifrato, mai la password
  CREATE TABLE IF NOT EXISTS integrations (
    id SERIAL PRIMARY KEY,
    user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider TEXT NOT NULL,
    external_user_id TEXT,
    secret_enc TEXT NOT NULL,
    last_sync_at TIMESTAMPTZ,
    UNIQUE (user_id, provider)
  );

  -- Dove ci fermiamo: soste e pernotti di un viaggio, con i giorni in cui si sta.
  -- Il posto puo' nascere da una ricerca lungo il percorso o scritto a mano; il
  -- collegamento a park4night e' un indirizzo, non un dato importato da loro.
  CREATE TABLE IF NOT EXISTS stops (
    id SERIAL PRIMARY KEY,
    trip_id INT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
    leg_id INT REFERENCES legs(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    lat DOUBLE PRECISION,
    lon DOUBLE PRECISION,
    kind TEXT NOT NULL DEFAULT 'pernotto',         -- sosta | pernotto
    from_date DATE,
    to_date DATE,
    notes TEXT,
    link TEXT,
    source TEXT NOT NULL DEFAULT 'manuale',        -- manuale | osm
    meta JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS idx_stops_trip ON stops(trip_id, from_date);
  -- Di una sosta conta anche a che ora si arriva e si riparte, quanto e'
  -- piaciuta, quanto e' costata e dove leggerne di piu'
  ALTER TABLE stops ADD COLUMN IF NOT EXISTS arrival_time TEXT;    -- hh:mm
  ALTER TABLE stops ADD COLUMN IF NOT EXISTS departure_time TEXT;  -- hh:mm
  ALTER TABLE stops ADD COLUMN IF NOT EXISTS stars SMALLINT;       -- 1..5, vuoto se non giudicata
  ALTER TABLE stops ADD COLUMN IF NOT EXISTS cost NUMERIC(10,2);

  -- Valuta e cambio viaggiano con l'importo. Il cambio si congela al momento
  -- della registrazione: una nota in corone di luglio deve restare quello che
  -- e' costata a luglio, anche se la corona poi si muove.
  ALTER TABLE stops ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'EUR';
  ALTER TABLE stops ADD COLUMN IF NOT EXISTS rate NUMERIC(12,6) NOT NULL DEFAULT 1;

  -- I tipi di sosta di chi gira in camper: sosta breve, infratto (il posto
  -- tranquillo trovato per strada), area attrezzata, camping, appartamento, e
  -- «altro» con il nome che si vuole. «Pernotto» era il vecchio tutto-insieme.
  ALTER TABLE stops ADD COLUMN IF NOT EXISTS kind_label TEXT;
  UPDATE stops SET kind='area_sosta' WHERE kind='pernotto';
  -- Le foto di una sosta stanno sotto la sosta. Se la sosta viene tolta, le sue
  -- foto restano al viaggio: sono del posto dove si e' stati, non della riga.
  ALTER TABLE photos ADD COLUMN IF NOT EXISTS stop_id INT REFERENCES stops(id) ON DELETE SET NULL;
  CREATE INDEX IF NOT EXISTS idx_photos_stop ON photos(stop_id);
  -- Il battito di un allenamento non e' solo la media e il massimo: e' una curva.
  -- [[secondi dall'inizio, bpm], ...], campionata come le tracce.
  ALTER TABLE workouts ADD COLUMN IF NOT EXISTS hr_track JSONB;
  ALTER TABLE expenses ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'EUR';
  ALTER TABLE expenses ADD COLUMN IF NOT EXISTS rate NUMERIC(12,6) NOT NULL DEFAULT 1;
  ALTER TABLE legs ADD COLUMN IF NOT EXISTS fuel_currency TEXT NOT NULL DEFAULT 'EUR';
  ALTER TABLE legs ADD COLUMN IF NOT EXISTS fuel_rate NUMERIC(12,6) NOT NULL DEFAULT 1;

  -- Allenamenti cancellati a mano: se ne tiene memoria perche' la prossima
  -- sincronizzazione non li riporti indietro. Si svuota ripristinandoli.
  CREATE TABLE IF NOT EXISTS deleted_workouts (
    id SERIAL PRIMARY KEY,
    user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    source TEXT NOT NULL,
    external_id TEXT NOT NULL,
    sport TEXT,
    name TEXT,
    started_at TIMESTAMPTZ,
    deleted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, source, external_id)
  );
  CREATE INDEX IF NOT EXISTS idx_deleted_workouts_ora ON deleted_workouts(user_id, started_at);

  -- Pesate: una riga al giorno per atleta. Arrivano dalle metriche di Salute
  -- (weight_body_mass) e servono ad affiancare al singolo allenamento il peso
  -- di quella giornata e a disegnare l'andamento nel tempo.
  CREATE TABLE IF NOT EXISTS weights (
    id SERIAL PRIMARY KEY,
    user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    day DATE NOT NULL,                             -- giorno della pesata, ora italiana
    kg NUMERIC(4,1) NOT NULL,
    measured_at TIMESTAMPTZ,                       -- momento esatto, se la sorgente lo dice
    source TEXT NOT NULL DEFAULT 'health',
    UNIQUE (user_id, day)
  );
  CREATE INDEX IF NOT EXISTS idx_weights_user_day ON weights(user_id, day);
  -- Un decimale, tagliato: il centesimo della bilancia non lo legge nessuno e
  -- arrotondarlo mostrerebbe un numero mai apparso sul display. Le pesate gia'
  -- in archivio si accorciano una volta sola, poi la riga non trova piu' niente.
  UPDATE weights SET kg = trunc(kg, 1) WHERE kg <> trunc(kg, 1);
  -- Accorciata la colonna, la regola non dipende piu' da chi scrive: due
  -- decimali non ci entrano. Si tocca solo se non e' gia' cosi'.
  DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_name='weights' AND column_name='kg' AND numeric_scale <> 1) THEN
      ALTER TABLE weights ALTER COLUMN kg TYPE NUMERIC(4,1);
    END IF;
  END $$;

  ALTER TABLE legs ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual';   -- manual | carlock
  ALTER TABLE legs ADD COLUMN IF NOT EXISTS external_id TEXT;
  -- La copertina del viaggio la sceglie chi l'ha fatto: senza scelta resta la
  -- prima foto, che e' un ripiego, non una decisione. Se quella foto viene
  -- cancellata, si torna al ripiego invece di restare senza.
  ALTER TABLE trips ADD COLUMN IF NOT EXISTS cover_photo_id INT REFERENCES photos(id) ON DELETE SET NULL;

  -- Dove e' stata fatta la spesa: il distributore, il supermercato, il ristorante.
  -- Solo il nome: una spesa si ricorda dal posto, non dalle coordinate.
  ALTER TABLE expenses ADD COLUMN IF NOT EXISTS place TEXT;

  -- Il costo di una sosta e' una spesa del viaggio: la spesa sa da quale sosta
  -- viene, e la sosta si ricorda se quella spesa e' stata tolta a mano.
  ALTER TABLE expenses ADD COLUMN IF NOT EXISTS stop_id INT REFERENCES stops(id) ON DELETE SET NULL;
  CREATE INDEX IF NOT EXISTS idx_expenses_stop ON expenses(stop_id);
  ALTER TABLE stops ADD COLUMN IF NOT EXISTS senza_spesa BOOLEAN NOT NULL DEFAULT false;
  -- Il numero con cui park4night conosce quel posto: da li' si costruisce il
  -- collegamento che apre la scheda, invece della ricerca intorno alle coordinate
  ALTER TABLE stops ADD COLUMN IF NOT EXISTS p4n_id TEXT;

  -- Perche' ci si e' fermati: il pranzo, la visita, il rifornimento, il
  -- riposo. Di una sosta in itinere e' la cosa che si dimentica per prima, e
  -- rivedendo il viaggio e' quella che spiega la deviazione.
  ALTER TABLE stops ADD COLUMN IF NOT EXISTS motivo TEXT;
  -- Cosa si e' fatto in quella sosta. E' della sosta e non della giornata: in
  -- un giorno ci si ferma due volte, e sono due cose diverse.
  ALTER TABLE stops ADD COLUMN IF NOT EXISTS fatto TEXT;
  -- Come inquadrare la foto quando fa da copertina: il punto da tenere al centro
  -- e quanto ingrandire. Non si tocca il file, che resta intero: il ritaglio e'
  -- un modo di guardarla, e si puo' sempre rifare.
  ALTER TABLE photos ADD COLUMN IF NOT EXISTS crop JSONB;
  -- Di un viaggio non restano solo scatti: un video di trenta secondi racconta
  -- la discesa o il mare che si muove meglio di dieci foto. Stanno insieme,
  -- nella stessa raccolta, e si distinguono da qui.
  ALTER TABLE photos ADD COLUMN IF NOT EXISTS mime TEXT;

  -- Il nome del posto dove e' stata scattata: ricavato dalle coordinate una
  -- volta sola, perche' rivedendo un viaggio «dove eravamo quel giorno?» e' la
  -- prima domanda, e un puntino sulla mappa non risponde
  ALTER TABLE photos ADD COLUMN IF NOT EXISTS luogo TEXT;

  -- Quello che serve per preparare un viaggio e che non sta da nessun'altra
  -- parte: un appunto, l'indirizzo di un sito, il pdf del traghetto, la pagina
  -- di una rivista fotografata. Non sono le foto del viaggio - quelle vengono
  -- dopo - e non sono spese: sono il materiale con cui lo si pensa.
  -- La lavagna di un viaggio che si sta preparando: i posti che qualcuno ha
  -- visto e vorrebbe, prima che diventino tappe. Una proposta non e' ancora
  -- niente - niente date, niente giro, niente spesa - ma ha un nome, un
  -- puntino, chi l'ha proposta e due righe di perche'. E' il posto dove
  -- finiscono le cose che prima si dicevano a voce e si perdevano.
  CREATE TABLE IF NOT EXISTS proposte (
    id SERIAL PRIMARY KEY,
    trip_id INT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
    user_id INT REFERENCES users(id) ON DELETE SET NULL,   -- chi l'ha proposta
    tipo TEXT NOT NULL DEFAULT 'pernotto',                 -- pernotto | sosta | visita
    nome TEXT NOT NULL,
    lat DOUBLE PRECISION,
    lon DOUBLE PRECISION,
    p4n_id TEXT,
    link TEXT,
    tipo_p4n TEXT,                                         -- com'e' classificato su park4night
    prezzo NUMERIC(8,2),                                   -- a notte
    currency TEXT,
    perche TEXT,                                           -- perche' la propongo
    stato TEXT NOT NULL DEFAULT 'proposto',                -- proposto | guardare | scelto | scartato
    perche_no TEXT,                                        -- perche' e' stata scartata
    stop_id INT REFERENCES stops(id) ON DELETE SET NULL,   -- la sosta che e' diventata
    posizione INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  -- Cosa ne penso e perche' stanno nella stessa riga, perche' sono la stessa
  -- cosa. Sono in due: una tabella di commenti a parte sarebbe una struttura
  -- per un problema che non hanno.
  CREATE TABLE IF NOT EXISTS proposte_voti (
    proposta_id INT NOT NULL REFERENCES proposte(id) ON DELETE CASCADE,
    user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    voto SMALLINT NOT NULL,                                -- 1 mi piace · -1 non mi convince
    commento TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (proposta_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS materiali (
    id SERIAL PRIMARY KEY,
    trip_id INT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
    user_id INT REFERENCES users(id) ON DELETE SET NULL,
    tipo TEXT NOT NULL,                            -- nota | link | file | immagine
    titolo TEXT,
    testo TEXT,                                    -- il corpo dell'appunto
    url TEXT,                                      -- l'indirizzo, per i link
    filename TEXT,                                 -- il file caricato, per file e immagini
    mime TEXT,
    dimensione INT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS idx_materiali_trip ON materiali(trip_id, created_at);
  -- Le spese nate dal vecchio pulsante «aggiungi alle spese» si riattaccano alla
  -- loro sosta. Quelle rimaste uguali al costo lo seguiranno da sole; quelle con
  -- un importo diverso restano come sono: li' qualcuno ha corretto a mano.
  UPDATE expenses e SET stop_id = s.id, auto = true, edited = (e.amount <> s.cost)
    FROM stops s WHERE (s.meta->>'spesa_id')::int = e.id AND e.stop_id IS NULL;

  -- Chi cancella la spesa del gasolio di una tappa non vuole rivedersela
  -- ricalcolata al primo ritocco: la tappa si ricorda di restarne senza.
  ALTER TABLE legs ADD COLUMN IF NOT EXISTS senza_gasolio BOOLEAN NOT NULL DEFAULT false;

  -- I chilometri di autostrada della tappa. Il pedaggio non si somma al gasolio:
  -- sono due costi di natura diversa - i litri si contano, l'autostrada si stima
  -- a tariffa chilometrica - e tenuti insieme non si capiva quale dei due pesa.
  -- Il costo della tappa resta la loro somma.
  -- Non tutte le tappe si fanno in camper. Il traghetto, l'aereo e il treno
  -- hanno una compagnia, un numero, un orario e un biglietto, non consumano
  -- gasolio e non pagano pedaggi, e i loro chilometri non sono chilometri di
  -- guida. Quello che si sa del biglietto sta accanto alla tappa, dove serve:
  -- al gabbiotto dell'imbarco, non in fondo a un quaderno.
  ALTER TABLE legs ADD COLUMN IF NOT EXISTS mezzo TEXT NOT NULL DEFAULT 'camper';
  ALTER TABLE legs ADD COLUMN IF NOT EXISTS compagnia TEXT;
  ALTER TABLE legs ADD COLUMN IF NOT EXISTS codice TEXT;
  ALTER TABLE legs ADD COLUMN IF NOT EXISTS tariffa NUMERIC(10,2);
  ALTER TABLE legs ADD COLUMN IF NOT EXISTS tariffa_currency TEXT NOT NULL DEFAULT 'EUR';
  ALTER TABLE legs ADD COLUMN IF NOT EXISTS condizioni TEXT;
  ALTER TABLE legs ADD COLUMN IF NOT EXISTS sconto TEXT;
  ALTER TABLE legs ADD COLUMN IF NOT EXISTS senza_tariffa BOOLEAN NOT NULL DEFAULT false;

  ALTER TABLE legs ADD COLUMN IF NOT EXISTS pedaggio_km NUMERIC(10,1);
  ALTER TABLE legs ADD COLUMN IF NOT EXISTS senza_pedaggio BOOLEAN NOT NULL DEFAULT false;
  ALTER TABLE legs ADD COLUMN IF NOT EXISTS start_time TEXT;
  ALTER TABLE legs ADD COLUMN IF NOT EXISTS end_time TEXT;
  CREATE UNIQUE INDEX IF NOT EXISTS idx_legs_external ON legs(trip_id, external_id) WHERE external_id IS NOT NULL;

  -- vero quando la disciplina e' stata scelta a mano: ne' il prossimo invio dal
  -- telefono ne' l'uniformazione dei nomi la riscrivono. Un'escursione che era
  -- in realta' il tapis roulant lo sa solo chi l'ha fatta.
  ALTER TABLE workouts ADD COLUMN IF NOT EXISTS sport_manual BOOLEAN NOT NULL DEFAULT false;
  -- Dove e' successo: un'escursione si chiama «Escursione» su tutti i telefoni,
  -- e fra dieci anni nessuno si ricordera' quale era quella della Sacra. Il nome
  -- del posto si legge dalle coordinate della traccia, una volta sola.
  ALTER TABLE workouts ADD COLUMN IF NOT EXISTS luogo TEXT;

  -- Le letture che l'orologio prende tutto il giorno per conto suo: battito e
  -- energia attiva. Non sono un allenamento, ma quando un giro e' stato
  -- registrato solo da komoot sono l'unico battito che esiste di quelle ore, e
  -- ritagliate sull'orario del giro raccontano comunque qualcosa. Si tengono
  -- poche settimane: servono ad aspettare l'allenamento, non a fare archivio.
  CREATE TABLE IF NOT EXISTS health_samples (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    at TIMESTAMPTZ NOT NULL,
    value DOUBLE PRECISION NOT NULL,
    PRIMARY KEY (user_id, kind, at)
  );

  -- vero quando il viaggio e' stato scelto a mano: l'aggancio automatico non lo tocca
  ALTER TABLE workouts ADD COLUMN IF NOT EXISTS trip_manual BOOLEAN NOT NULL DEFAULT false;

  -- I nomi delle attivita' li uniforma normalizzaNomiEsistenti() all'avvio del servizio

  -- Un viaggio si fa guardare anche da chi non ha un posto qui dentro: si
  -- genera un indirizzo lungo e si manda a chi deve vederlo. Non e' un
  -- account - non si registra, non scrive niente - e quello che vede lo
  -- decide chi lo manda: quali viaggi, se le foto, se i conti, gli
  -- allenamenti di chi. Si spegne con una data o a mano, e da quel momento
  -- l'indirizzo non apre piu' niente.
  CREATE TABLE IF NOT EXISTS shares (
    id SERIAL PRIMARY KEY,
    token TEXT UNIQUE NOT NULL,
    nome TEXT,
    created_by INT REFERENCES users(id) ON DELETE SET NULL,
    viaggi JSONB,                               -- null = tutti quelli in corso e conclusi
    tracciati BOOLEAN NOT NULL DEFAULT true,
    foto BOOLEAN NOT NULL DEFAULT true,
    spese BOOLEAN NOT NULL DEFAULT false,
    allenamenti JSONB NOT NULL DEFAULT '[]',    -- gli id di chi si puo' vedere
    expires_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    viste INT NOT NULL DEFAULT 0,
    ultima_vista TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  -- La rubrica: i numeri a cui si puo' mandare un link, e basta quelli. Un
  -- numero sbagliato di una cifra e' un viaggio di famiglia finito a uno
  -- sconosciuto, e un indirizzo mandato non si richiama indietro. Chi non e'
  -- qui dentro non si puo' invitare: prima lo si scrive, con un nome che dica
  -- a chi corrisponde, poi eventualmente gli si manda qualcosa.
  CREATE TABLE IF NOT EXISTS rubrica (
    id SERIAL PRIMARY KEY,
    nick TEXT NOT NULL,
    telefono TEXT NOT NULL UNIQUE,              -- in forma internazionale: +39...
    note TEXT,
    created_by INT REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  -- A chi e' stato mandato questo link: serve a sapere chi sta guardando cosa,
  -- e a spegnere il link di uno senza toccare quello degli altri
  ALTER TABLE shares ADD COLUMN IF NOT EXISTS contatto_id INT REFERENCES rubrica(id) ON DELETE SET NULL;
  ALTER TABLE shares ADD COLUMN IF NOT EXISTS inviato_at TIMESTAMPTZ;

  -- Il diario di bordo: una riga per giornata di viaggio, con quello che si e'
  -- fatto e quanto e' valsa. Non tutte le giornate ce l'hanno - si scrive
  -- quella che vale la pena - percio' sta per conto suo e non dentro le tappe.
  CREATE TABLE IF NOT EXISTS giornate (
    trip_id INT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
    data DATE NOT NULL,
    note TEXT,
    stelle SMALLINT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (trip_id, data)
  );

  -- Il tempo che faceva: una riga per posto e per giorno, presa una volta sola
  -- da Open-Meteo e poi tenuta qui. Rivedere dieci volte lo stesso viaggio non
  -- deve diventare diecimila richieste a un servizio che non ci chiede niente.
  CREATE TABLE IF NOT EXISTS meteo (
    lat NUMERIC(6,2) NOT NULL,
    lon NUMERIC(6,2) NOT NULL,
    giorno DATE NOT NULL,
    codice INT,
    tmin REAL,
    tmax REAL,
    preso_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (lat, lon, giorno)
  );

  CREATE INDEX IF NOT EXISTS idx_expenses_trip ON expenses(trip_id);
  -- Serve a dire in fretta di che viaggio e' un file, quando a chiederlo e' un ospite
  CREATE INDEX IF NOT EXISTS idx_photos_filename ON photos(filename);
  CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(date);
  CREATE INDEX IF NOT EXISTS idx_legs_trip ON legs(trip_id, position);
  CREATE INDEX IF NOT EXISTS idx_workouts_started ON workouts(started_at);
  `);

  await q(`INSERT INTO settings(key, value) VALUES
    ('vehicle', '{"length_m": 6, "km_per_liter": 10, "fuel_price": 1.75}'),
    ('categories', '["gasolio","traghetto","bus","treno","aereo","area_sosta","campeggio","pedaggi","vitto","spesa","visite","spettacoli","sport","manutenzione","altro"]')
    ON CONFLICT (key) DO NOTHING`);

  await categorieNuove(['bus', 'treno', 'aereo'], 'traghetto');
  await categorieNuove(['spettacoli', 'sport'], 'visite');
  await spesePerSosteGiaScritte();
}
