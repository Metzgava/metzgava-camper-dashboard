# La lavagna dei posti — piano di lavoro

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dare a un viaggio «in costruzione» una lavagna dove Metz e Caterina mettono in fila i posti dove sostare e pernottare, dicono la loro, e trasformano quelli scelti in soste vere del viaggio.

**Architecture:** Tutto dentro al viaggio esistente: due tabelle nuove (`proposte`, `proposte_voti`), un file di rotte nuovo (`src/routes/proposte.js`), un lettore di park4night (`src/lib/park4night.js`), e una scheda nuova nella pagina del viaggio quando `trips.status = 'bozza'`. Niente modalità separata, niente passaggio di consegne: la proposta scelta diventa una sosta del viaggio.

**Tech Stack:** Node 22 · Express 5 · PostgreSQL (`pg`) · frontend vanilla in `public/app.js` · Leaflet · `node:test` per le prove (già dentro a Node, nessuna dipendenza nuova).

**Spec:** `docs/superpowers/specs/2026-11-13-pianificazione-viaggio-design.md`

## Vincoli di tutto il lavoro

- Niente dipendenze nuove. `node:test` e `node:assert` sono già in Node 22.
- Le tabelle si creano da sole all'avvio, in `src/lib/db.js`, con `CREATE TABLE IF NOT EXISTS` / `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`. Niente migrazioni a mano.
- Ogni cambio di `public/app.js` o `public/style.css` vuole il numero di versione alzato in **tre** punti: `const VERSIONE` in `app.js`, `?v=N` in `public/index.html`, `?v=N` in `public/ospite.html`. La versione corrente è `v114`.
- Commenti e testi in italiano, nella voce del progetto: si spiega **perché**, non cosa.
- Chi guarda da un collegamento di sola lettura non scrive niente: le rotte delle proposte passano da `requireAuth`, e `ripulisci` in `src/routes/share.js` è una lista bianca — le proposte non ci entrano e quindi non escono.
- Il collegamento a park4night si costruisce **solo** con `linkPark4nightPosto(id)` (`https://park4night.com/it/place/<id>`): è quello che apre l'app sull'iPhone.
- Il prezzo di una proposta **non** finisce mai in `stops.cost`.

## Come si prova

Il progetto non ha prove automatiche. Non se ne inventa un impianto: si mettono dove pagano davvero.

- **Quello che è logica pura** — leggere la pagina di park4night, tradurre i tipi, riconoscere un doppione — si prova con `node --test`, che non vuole niente di installato. Si aggiunge `"test": "node --test test/"` agli script di `package.json` (Task 1).
- **Le rotte** si provano col server locale e `curl`, con il comando e la risposta attesa scritti nel passo.
- **Quello che si vede** si prova nel browser, con le misure prese dalla pagina.

Server locale: `.claude/launch.json` (porta 3999, database `camper_prova`).

## Dove guardare in revisione

Cinque cose che il documento dà per scontate e che nessuna prova di un singolo compito tocca per intero:

1. **Codice park4night che non esiste, o pagina illeggibile** (404, 403, tempo scaduto, HTML cambiato) → una sola strada: «non sono riuscito a leggerla, mettilo tu sulla mappa». Mai un errore che ferma il modulo. *(prova nel Task 1 e nel Task 2)*
2. **Proposta senza coordinate** — il nome si può scrivere a mano — non deve comparire sulla mappa, non deve rompere la conversione in sosta, e i tasti «portami lì» devono sparire. *(prova nel Task 5 e nel Task 7)*
3. **Due persone sulla stessa proposta:** il secondo voto della stessa persona aggiorna il primo, non ne aggiunge uno. *(prova nel Task 4)*
4. **Conversione due volte, e sosta cancellata dopo:** la seconda volta non crea una seconda sosta; cancellata la sosta, la proposta resta scelta senza sosta. *(prova nel Task 5)*
5. **Viaggio che non è in costruzione:** la lavagna non si disegna, ma quello che c'è dentro resta leggibile. *(prova nel Task 6)*

---

### Task 1: Leggere park4night dal codice

**Files:**
- Create: `src/lib/park4night.js`
- Create: `test/park4night.test.js`
- Create: `test/fixtures/p4n-277443.html`
- Modify: `package.json` (script `test`)

**Interfaces:**
- Produces: `estraiDaPagina(html) → { nome, lat, lon, tipo } | null` (pura); `leggiPosto(codice) → { p4n_id, nome, lat, lon, tipo } | null` (`null` = non trovato o non leggibile, **non lancia mai**).

- [ ] **Step 1: Salvare la pagina di prova**

```bash
mkdir -p test/fixtures && curl -s --max-time 25 \
  'https://park4night.com/it/place/277443' -o test/fixtures/p4n-277443.html
```

Verifica che contenga `destination=45.095570,7.347378` e `<title>park4night - (10057) Avigliana`.

- [ ] **Step 2: Scrivere le prove che falliscono**

```js
// test/park4night.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { estraiDaPagina } from '../src/lib/park4night.js';

const pagina = fs.readFileSync('test/fixtures/p4n-277443.html', 'utf8');

test('prende le coordinate dal collegamento di Google Maps', () => {
  const r = estraiDaPagina(pagina);
  assert.equal(r.lat, 45.09557);
  assert.equal(r.lon, 7.347378);
});

test('prende il nome senza il codice di avviamento postale', () => {
  assert.equal(estraiDaPagina(pagina).nome, 'Avigliana - 1 Strada Provinciale 188');
});

test('da una pagina senza coordinate non inventa niente', () => {
  assert.equal(estraiDaPagina('<html><title>park4night - 404</title></html>'), null);
});

test('da una pagina vuota o spezzata non lancia', () => {
  for (const x of ['', null, undefined, '<<<']) assert.equal(estraiDaPagina(x), null);
});
```

- [ ] **Step 3: Aggiungere lo script e far fallire le prove**

In `package.json`, fra gli script: `"test": "node --test test/"`.
Run: `npm test`
Expected: FAIL, `Cannot find module '../src/lib/park4night.js'`.

- [ ] **Step 4: Scrivere `src/lib/park4night.js`**

`estraiDaPagina(html)`: le coordinate dal primo `destination=<lat>,<lon>` (è il collegamento «portami lì» che park4night mette nella pagina); il nome dal `<title>`, togliendo `park4night - ` davanti e il `(CAP) ` che segue; il tipo dal primo fra `Campeggio`, `Area di servizio`, `Area picnic`, `Parcheggio`, `Agriturismo` che compare nella pagina, o `null`. Tutto dentro a un `try`: qualunque cosa vada storta torna `null`.

Il prezzo **non si legge**: nella pagina i numeri con l'euro stanno anche dentro alle recensioni, e prenderne uno a caso vuol dire scrivere una cifra sbagliata con l'aria di essere giusta.

`leggiPosto(codice)`: normalizza con `numeroPark4night` (da `src/lib/geo.js`, prende sia `277443` sia l'indirizzo intero incollato), scarica `linkPark4nightPosto(id)` con `fetchJson`-style ma leggendo testo — 10 secondi di pazienza — e passa il corpo a `estraiDaPagina`. Qualunque risposta che non sia 200, qualunque errore di rete, qualunque pagina illeggibile: `null`.

- [ ] **Step 5: Le prove passano**

Run: `npm test`
Expected: 4 prove passate.

- [ ] **Step 6: Commit**

```bash
git add package.json src/lib/park4night.js test/
git commit -m "Dal codice di park4night, il posto sulla mappa"
```

---

### Task 2: La rotta che legge il codice

**Files:**
- Create: `src/routes/proposte.js`
- Modify: `src/server.js` (import e `app.use('/api', proposte)`)

**Interfaces:**
- Consumes: `leggiPosto(codice)` dal Task 1.
- Produces: `GET /api/park4night/:codice` → `200 { p4n_id, nome, lat, lon, tipo, link }` oppure `404 { error }`.

- [ ] **Step 1: Scrivere la rotta**

Nuovo file con l'intestazione dei fratelli (`Router`, `q`, `wrap`, `requireAuth`) e, per ora, solo questa rotta. `link` è `linkPark4nightPosto(p4n_id)`. Quando `leggiPosto` torna `null`: `404 { error: 'Questo codice non l\'ho trovato: mettilo tu sulla mappa' }` — lo stesso messaggio per il codice inesistente e per la pagina illeggibile, perché per chi guarda è la stessa cosa.

- [ ] **Step 2: Montarla**

In `src/server.js`, accanto agli altri: `import { router as proposte } from './routes/proposte.js';` e `app.use('/api', proposte);` dopo `materiali`.

- [ ] **Step 3: Provarla sul server locale**

Avviare il server locale, poi:

```bash
curl -s -b /tmp/c.txt 'http://localhost:3999/api/park4night/277443'
```

Expected: `{"p4n_id":"277443","nome":"Avigliana - 1 Strada Provinciale 188","lat":45.09557,"lon":7.347378,...}`

```bash
curl -s -o /dev/null -w '%{http_code}\n' -b /tmp/c.txt 'http://localhost:3999/api/park4night/100000'
```

Expected: `404`

- [ ] **Step 4: Commit**

```bash
git add src/routes/proposte.js src/server.js
git commit -m "La rotta che legge un posto di park4night"
```

---

### Task 3: Le due tabelle, e le proposte che arrivano col viaggio

**Files:**
- Modify: `src/lib/db.js` (dopo le altre `CREATE TABLE`)
- Modify: `src/routes/trips.js` (`datiViaggio`, dove si leggono `soste` e `giornate`)

**Interfaces:**
- Produces: `GET /api/trips/:id` torna anche `proposte: [{ ...riga, voti: [{ user_id, nome, voto, commento }] }]`, in ordine di `posizione, id`.

- [ ] **Step 1: Le tabelle**

In `src/lib/db.js`, le due tabelle esattamente come nel documento (sezione «I dati»), con `tipo_p4n TEXT` fra `link` e `prezzo`. Sopra, due righe di commento sul perché il voto e il commento stanno nella stessa riga.

- [ ] **Step 2: Verificare che nascano**

Riavviare il server locale, poi:

```bash
psql -U postgres -d camper_prova -tAc "select count(*) from proposte; select count(*) from proposte_voti"
```

Expected: `0` e `0`, nessun errore.

- [ ] **Step 3: Le proposte dentro al viaggio**

In `datiViaggio` (`src/routes/trips.js`), accanto a `soste`: una `SELECT` che prende le proposte del viaggio e, per ciascuna, i voti con il nome di chi ha votato (`JOIN users`), aggregati in JSON. Aggiungere `proposte` all'oggetto che la funzione torna.

- [ ] **Step 4: Verificarlo**

```bash
psql -U postgres -d camper_prova -q -c "insert into proposte (trip_id, user_id, nome, lat, lon, perche) values (2, 1, 'Prova', 68.1, 13.6, 'si vede il mare')"
curl -s -b /tmp/c.txt 'http://localhost:3999/api/trips/2' | python3 -c "import json,sys; print(json.load(sys.stdin)['proposte'])"
```

Expected: una proposta, con `voti: []`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/db.js src/routes/trips.js
git commit -m "Le proposte di un viaggio, e dove stanno"
```

---

### Task 4: Mettere, cambiare, togliere, dire la propria

**Files:**
- Modify: `src/routes/proposte.js`

**Interfaces:**
- Produces:
  - `POST /api/trips/:id/proposte` ← `{ nome, tipo, lat, lon, p4n_id, prezzo, currency, perche }` → la riga nuova
  - `PUT /api/proposte/:id` ← gli stessi campi più `stato`, `perche_no` → la riga aggiornata
  - `DELETE /api/proposte/:id` → `{ ok: true }`
  - `POST /api/proposte/:id/voto` ← `{ voto: 1 | -1 | 0, commento }` → i voti della proposta

- [ ] **Step 1: Le quattro rotte**

`user_id` di chi propone è `req.user.id`. `tipo` fra `pernotto | sosta | visita` (altrimenti `pernotto`), `stato` fra `proposto | guardare | scelto | scartato` (altrimenti `proposto`); `p4n_id` passa da `numeroPark4night`, `link` da `linkPark4nightPosto`. `voto: 0` toglie la riga del voto; `1` e `-1` la scrivono o la aggiornano (`ON CONFLICT (proposta_id, user_id) DO UPDATE`).

Lo stato si rifiuta di tornare indietro quando la proposta ha già una sosta: se `stop_id` non è nullo e il nuovo stato non è `scelto`, `409 { error: 'Prima togli la sosta' }`.

- [ ] **Step 2: Provarle**

```bash
curl -s -b /tmp/c.txt -H 'Content-Type: application/json' \
  -d '{"nome":"Area sosta Kabelvag","tipo":"pernotto","lat":68.21,"lon":14.48,"perche":"sul porto"}' \
  'http://localhost:3999/api/trips/2/proposte'
```

Expected: la riga, con `stato: "proposto"` e `user_id` di chi è entrato.

Poi, sulla proposta appena creata (id `N`):

```bash
curl -s -b /tmp/c.txt -H 'Content-Type: application/json' -d '{"voto":1,"commento":"a me piace"}' "http://localhost:3999/api/proposte/N/voto"
curl -s -b /tmp/c.txt -H 'Content-Type: application/json' -d '{"voto":-1,"commento":"ci ho ripensato"}' "http://localhost:3999/api/proposte/N/voto"
```

Expected: la seconda chiamata torna **un solo voto**, con `-1` e il commento nuovo.

- [ ] **Step 3: Commit**

```bash
git add src/routes/proposte.js
git commit -m "Le proposte si mettono, si cambiano e si votano"
```

---

### Task 5: Da proposta a sosta

**Files:**
- Modify: `src/routes/proposte.js`
- Create: `test/proposte.test.js`
- Modify: `src/lib/park4night.js` (ci sta la traduzione dei tipi, che è roba di park4night)

**Interfaces:**
- Consumes: le rotte del Task 4.
- Produces: `tipoSostaDa(tipo, tipoP4n) → 'camping' | 'area_sosta' | 'sosta'` (pura, esportata da `src/lib/park4night.js`); `POST /api/proposte/:id/sosta` → `{ proposta, sosta }`.

- [ ] **Step 1: Le prove della traduzione**

```js
// test/proposte.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { tipoSostaDa } from '../src/lib/park4night.js';

test('dormire in un campeggio e un campeggio', () => {
  assert.equal(tipoSostaDa('pernotto', 'Campeggio'), 'camping');
});
test('dormire altrove e un area di sosta', () => {
  assert.equal(tipoSostaDa('pernotto', 'Area di servizio'), 'area_sosta');
  assert.equal(tipoSostaDa('pernotto', null), 'area_sosta');
});
test('la sosta breve e una sosta, e anche la visita', () => {
  assert.equal(tipoSostaDa('sosta', null), 'sosta');
  assert.equal(tipoSostaDa('visita', 'Campeggio'), 'sosta');
});
```

Run: `npm test` → FAIL.

- [ ] **Step 2: Scrivere `tipoSostaDa`, e le prove passano**

Run: `npm test` → tutte passate.

- [ ] **Step 3: La rotta che fa la sosta**

`POST /api/proposte/:id/sosta`:

1. Se la proposta ha già `stop_id` e quella sosta esiste ancora: torna quella, senza crearne un'altra.
2. Se la proposta ha un `p4n_id` che è già di una sosta di quel viaggio: si collega a quella e torna `{ ..., gia_cera: true }` — niente doppione.
3. Altrimenti crea la sosta con `name`, `lat`, `lon`, `kind` da `tipoSostaDa`, `p4n_id`, `link`, e `motivo` = il `perche` della proposta. **Senza date e senza `cost`** — nessuna spesa deve nascere.
4. Mette `stato='scelto'` e `stop_id` sulla proposta.

- [ ] **Step 4: Provarla, due volte di fila**

```bash
curl -s -b /tmp/c.txt -X POST "http://localhost:3999/api/proposte/N/sosta" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['sosta']['id'], d['sosta']['kind'], d['sosta']['cost'], d['sosta']['motivo'])"
```

Expected: un id, `area_sosta`, `None`, `sul porto`.
Rilanciando lo stesso comando: **lo stesso id di sosta**.

```bash
psql -U postgres -d camper_prova -tAc "select count(*) from expenses where trip_id=2"
```

Expected: `0` — nessuna spesa è nata.

Una proposta **senza coordinate** diventa comunque una sosta, senza puntino:

```bash
psql -U postgres -d camper_prova -q -c "insert into proposte (trip_id, user_id, nome, perche) values (2, 1, 'Quel posto di cui parlava Anna', 'me lo devo far dire')"
curl -s -b /tmp/c.txt -X POST "http://localhost:3999/api/proposte/M/sosta" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['sosta']['lat'], d['sosta']['lon'], d['sosta']['name'])"
```

Expected: `None None Quel posto di cui parlava Anna` — nessun errore.

Poi, cancellata la sosta:

```bash
curl -s -b /tmp/c.txt -X DELETE "http://localhost:3999/api/soste/ID"
psql -U postgres -d camper_prova -tAc "select stato, stop_id from proposte where id=N"
```

Expected: `scelto|` — la proposta resta scelta, senza sosta.

- [ ] **Step 5: Commit**

```bash
git add src/lib/park4night.js src/routes/proposte.js test/proposte.test.js
git commit -m "La proposta scelta diventa una sosta, e il prezzo resta fuori"
```

---

### Task 6: La lavagna nella pagina del viaggio

**Files:**
- Modify: `public/app.js` (in `viewTrip`, dove si disegnano le schede; e i ganci in fondo)
- Modify: `public/style.css`
- Modify: `public/index.html`, `public/ospite.html` (numero di versione)

**Interfaces:**
- Consumes: `d.proposte` dal Task 3, le rotte dei Task 2, 4 e 5.

- [ ] **Step 1: La scheda**

Si disegna **solo** se `trip.status === 'bozza'`, sopra la mappa. Dentro: i filtri per stato con i conti (`tutti`, `proposto`, `guardare`, `scelto`, `scartato`), le schede delle proposte, e il tasto «+ Aggiungi un posto». Le scelte in cima, le scartate in fondo e spente.

Ogni scheda, come nel disegno del documento: icona del tipo e nome, chi l'ha proposta, il collegamento park4night col codice, il perché, il prezzo a notte, i voti con i commenti, i tasti di stato, e — se ha `stop_id` — la riga «è la sosta …» che apre la sosta.

Dove la proposta ha una sosta, nome e posto si leggono **dalla sosta**, non dalla proposta.

- [ ] **Step 2: Il modulo per aggiungere**

Un `modal` con: la ricerca del luogo (`geoInput`, che dà nome e coordinate), il tipo (tre scelte), il codice park4night, il prezzo a notte, e il perché. Incollando il codice e uscendo dal campo, si chiama `GET /api/park4night/:codice` e si riempiono nome e coordinate; se torna 404, un `toast` col messaggio della rotta e il modulo resta aperto, da riempire a mano.

Accanto al campo del codice, una riga piccola: col codice, il collegamento apre l'app di park4night sull'iPhone; senza, apre il sito.

- [ ] **Step 3: I ganci**

Voti, cambi di stato, «fanne una sosta», cancellazione (con conferma). Dopo ogni chiamata, `restaQui()`.

- [ ] **Step 4: Quando il viaggio parte, la lavagna resta leggibile**

Su un viaggio che non e' piu' in costruzione la scheda non si disegna,
ma nel riepilogo compare un tasto **«🗒️ La lavagna»** che la apre in
sola lettura: senza tasti di stato, senza voti da dare, con le scartate
e il loro perche'. E' li' che si va a vedere perche' avevate scartato
quel campeggio.

- [ ] **Step 5: Alzare la versione**

`VERSIONE` a `v115` in `app.js`, `?v=115` in `index.html` e in `ospite.html`.

- [ ] **Step 6: Provarla nel browser**

Sul server locale, sul viaggio 2 (Lofoten 2027, in costruzione), a 375×812:

- la scheda c'è, e sul viaggio 1 (in corso) **non** c'è;
- aggiungendo un posto col codice `277443`, nome e coordinate si riempiono da soli;
- il voto si cambia e resta;
- «fanne una sosta» fa comparire la riga «è la sosta …»;
- la riga dei tasti e le schede stanno dentro ai 375 px, senza scorrimento orizzontale;
- sul viaggio 1 il tasto «La lavagna» apre l'elenco in sola lettura.

- [ ] **Step 7: Commit**

```bash
git add public/
git commit -m "La lavagna dei posti, nella pagina del viaggio in costruzione"
```

---

### Task 7: Sulla mappa, e «portami lì»

**Files:**
- Modify: `public/app.js` (`mappaDelViaggio`, la legenda, il modulo dei posti vicini)
- Modify: `public/style.css`
- Modify: `public/index.html`, `public/ospite.html` (versione)

**Interfaces:**
- Consumes: `d.proposte`; `mapsIndicazioni` che c'è già.
- Produces: `linkMappeApple(lat, lon, nome) → 'https://maps.apple.com/?...'`

- [ ] **Step 1: Le proposte sulla mappa**

In `mappaDelViaggio`, uno strato nuovo con un puntino per ogni proposta **che ha le coordinate**: verde di casa se scelta, giallo se proposta o da guardare, grigio spento se scartata. Voce nella legenda come gli altri strati. Toccando il puntino, il nome e un tasto che porta alla sua scheda.

- [ ] **Step 2: I due tasti «portami lì»**

`linkMappeApple(lat, lon, nome)` accanto a `mapsIndicazioni`. La riga dei due tasti — 🗺️ Google Maps e 🧭 Mappe — su: le schede della lavagna, le soste, i posti trovati lungo la tappa. Dove non ci sono coordinate, i tasti non si disegnano.

- [ ] **Step 3: Le coordinate di una sosta che ha solo il codice**

Su una sosta che ha `p4n_id` ma non ha `lat`/`lon`, nella sua riga un
tasto **«📍 prendi le coordinate»** che chiama la rotta del Task 2 e le
scrive sulla sosta. Una sosta alla volta, quando lo si tocca: niente
recuperi in blocco, che sarebbero una raffica di richieste al sito di
qualcun altro.

- [ ] **Step 4: «+ in lavagna» sui posti trovati lungo la tappa**

Nel modulo dei posti vicini, accanto al tasto che fa la sosta, uno che fa la proposta: nome, coordinate e codice sono già lì.

- [ ] **Step 5: Alzare la versione a `v116`**

- [ ] **Step 6: Provarlo nel browser**

- i puntini compaiono e si spengono dalla legenda;
- una proposta senza coordinate **non** fa puntini e **non** mostra i tasti;
- il tasto 🧭 porta a un indirizzo `maps.apple.com` con le coordinate giuste;
- «+ in lavagna» fa comparire la proposta nella scheda;
- su una sosta col codice e senza coordinate, «prendi le coordinate» la mette sulla mappa.

- [ ] **Step 7: Commit e pubblicazione**

```bash
git add public/
git commit -m "Le proposte sulla mappa, e i tasti per farsi portare li"
~/.railway/bin/railway up --service app --ci
```

Poi verificare sul sito pubblicato che `app.js?v=116` sia servito e che `GET /api/park4night/277443` risponda **da Railway** — è l'unica prova che l'indirizzo del centro dati non venga rifiutato. Se risponde 403, il messaggio «mettilo tu sulla mappa» è già al suo posto e non si rompe niente: si scrive qui com'è andata.
