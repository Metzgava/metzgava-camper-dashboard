# 🚐 Camper · Viaggi

Dashboard personale per i viaggi in camper: percorsi con distanze calcolate, gasolio automatico, spese, allenamenti dai due iPhone, foto, aree sosta e borghi lungo la strada, riepiloghi per periodo.

- **Percorsi**: cerchi partenza e arrivo, la distanza stradale e il tempo vengono calcolati (OSRM/OpenStreetMap). Consumo 10 km/l (modificabile), prezzo gasolio impostabile per viaggio o per singola tappa.
- **Spese**: gasolio generato automaticamente per ogni tappa (modificabile a mano, ripristinabile), più traghetti, aree sosta, campeggi, pedaggi, vitto, spesa, visite, manutenzione, altro.
- **Lungo la tappa**: aree sosta camper, campeggi, camper service e borghi/paesi attraversati (da OpenStreetMap), con link per navigare.
- **Allenamenti**: sincronizzazione Komoot (tour registrati con traccia GPS), caricamento GPX, e invio di battito/calorie dagli iPhone tramite token dispositivo. Gli allenamenti nelle date del viaggio vengono associati automaticamente.
- **CarLock**: importi il CSV/XLS esportato da my.carlock.co (Trips → CSV) e ogni tragitto diventa una tappa con i **km reali** del camper; tratte brevi ignorate e soste brevi accorpate (soglie regolabili), nessun duplicato se reimporti lo stesso periodo.
- **Foto**: caricamento da telefono; se contengono il GPS compaiono sulla mappa.
- **Riepiloghi**: per giorno, settimana, mese, anno o periodo libero — spese per categoria, km, allenamenti, calorie.
- **Utenti**: il primo account è l'amministratore; gli altri entrano con codice invito e vanno approvati; ogni dispositivo ha un token revocabile.
- Mobile-first, tema chiaro/scuro automatico, installabile sulla home dell'iPhone (Condividi → Aggiungi alla schermata Home).

## Stack

Node.js 20+ · Express 5 · PostgreSQL · frontend vanilla JS + Leaflet (nessun build step).

## Deploy su Railway

1. Crea il repo su GitHub (`metzgava/camper-dashboard`) e carica questi file.
2. Su Railway: **New Project → Deploy from GitHub repo** → scegli il repo.
3. Aggiungi un servizio **PostgreSQL** (`+ New → Database → PostgreSQL`).
4. Nel servizio dell'app, **Variables**:
   - `DATABASE_URL` → `${{Postgres.DATABASE_URL}}` (reference al DB)
   - `SESSION_SECRET` → una stringa lunga casuale (es. `openssl rand -base64 48`)
   - `NODE_ENV` → `production`
   - `UPLOAD_DIR` → `/data/uploads`
5. **Volume**: nel servizio app, `+ New → Volume`, mount path `/data` (così le foto sopravvivono ai redeploy).
6. **Settings → Networking → Generate Domain**. Apri l'URL: il primo account creato diventa amministratore.

Le tabelle vengono create automaticamente al primo avvio.

## Sviluppo locale

```bash
cp .env.example .env   # e sistema DATABASE_URL
npm install
export $(cat .env | xargs) && npm run dev
```

## iPhone: allenamenti, battito e calorie

Una web app non può leggere Apple Salute direttamente; ogni iPhone invia i dati con un **token dispositivo** (Impostazioni → iPhone e Apple Watch → Aggiungi dispositivo). I dati restano sul tuo server.

Endpoint: `POST https://<tuo-dominio>/api/ingest/health` con header `Authorization: Bearer <token>`.

**Opzione A – Health Auto Export** (app App Store): Automations → REST API → URL sopra, header Authorization, dati "Workouts", formato JSON, frequenza a piacere. Il formato `{"data":{"workouts":[...]}}` è riconosciuto direttamente (inclusa la "Route" se attivata).

**Opzione B – Comandi Rapidi** (gratis): automazione "Fine allenamento" → "Trova allenamenti" → "Ottieni contenuti di URL" (POST, JSON):

```json
{ "start": "2026-09-11T08:30:00+02:00", "type": "Hiking", "duration_min": 95, "distance_km": 7.4, "calories": 610, "hr_avg": 128, "hr_max": 161 }
```

Un allenamento senza GPS che inizia entro 15 minuti da un tour Komoot/GPX viene **unito** a quel tour: la traccia Komoot acquista battito e calorie.

## Komoot

Komoot non offre un'API pubblica: la dashboard usa lo stesso accesso del sito web (client non ufficiale). Inserisci email e password una sola volta: si salva solo il token, cifrato con `SESSION_SECRET`; la password non viene memorizzata. La sincronizzazione avviene ogni 6 ore (`KOMOOT_SYNC_HOURS`) e a richiesta. Se Komoot cambia le sue API, resta il caricamento GPX manuale (esporta il tour da Komoot → GPX).

## Variabili d'ambiente

| Variabile | Descrizione |
|---|---|
| `DATABASE_URL` | connessione PostgreSQL (obbligatoria) |
| `SESSION_SECRET` | segreto per cookie di sessione e cifratura token (obbligatoria in produzione) |
| `UPLOAD_DIR` | cartella foto (default `uploads/`) |
| `KOMOOT_SYNC_HOURS` | intervallo sync Komoot, `0` per disattivare (default 6) |
| `OSRM_URL`, `OVERPASS_URL`, `PHOTON_URL` | server alternativi per routing, POI e geocoding (opzionali) |

## API principali

`/api/auth/*` utenti, inviti, dispositivi · `/api/trips`, `/api/legs`, `/api/expenses` · `/api/summary?from&to&group=day|week|month|year` · `/api/workouts`, `/api/komoot/*` · `/api/ingest/health` (token dispositivo) · `/api/trips/:id/photos`.

Dati mappa © OpenStreetMap contributors. Routing: OSRM demo server (uso ragionevole). POI: Overpass API.
