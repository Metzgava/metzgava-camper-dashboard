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
    status TEXT NOT NULL DEFAULT 'open',          -- open | closed
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
    pois JSONB,                                    -- aree sosta e borghi trovati
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

  ALTER TABLE legs ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual';   -- manual | carlock
  ALTER TABLE legs ADD COLUMN IF NOT EXISTS external_id TEXT;
  ALTER TABLE legs ADD COLUMN IF NOT EXISTS start_time TEXT;
  ALTER TABLE legs ADD COLUMN IF NOT EXISTS end_time TEXT;
  CREATE UNIQUE INDEX IF NOT EXISTS idx_legs_external ON legs(trip_id, external_id) WHERE external_id IS NOT NULL;

  -- vero quando il viaggio e' stato scelto a mano: l'aggancio automatico non lo tocca
  ALTER TABLE workouts ADD COLUMN IF NOT EXISTS trip_manual BOOLEAN NOT NULL DEFAULT false;

  -- Nomi piu' scorrevoli per le attivita' gia' in archivio: Health Auto Export
  -- traduce "Hiking" in "Escursionismo" e "Outdoor Walk" in "All'aperto Camminata"
  UPDATE workouts SET sport='Escursione', name=CASE WHEN name='Escursionismo' THEN 'Escursione' ELSE name END
    WHERE sport='Escursionismo';
  UPDATE workouts SET sport='Camminata', name=CASE WHEN name='All''aperto Camminata' THEN 'Camminata' ELSE name END
    WHERE sport='All''aperto Camminata';

  CREATE INDEX IF NOT EXISTS idx_expenses_trip ON expenses(trip_id);
  CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(date);
  CREATE INDEX IF NOT EXISTS idx_legs_trip ON legs(trip_id, position);
  CREATE INDEX IF NOT EXISTS idx_workouts_started ON workouts(started_at);
  `);

  await q(`INSERT INTO settings(key, value) VALUES
    ('vehicle', '{"length_m": 6, "km_per_liter": 10, "fuel_price": 1.75}'),
    ('categories', '["gasolio","traghetto","area_sosta","campeggio","pedaggi","vitto","spesa","visite","manutenzione","altro"]')
    ON CONFLICT (key) DO NOTHING`);
}
