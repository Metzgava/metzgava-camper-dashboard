# La cassetta, le strade possibili, la roba utile — piano di lavoro

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rendere lo spazio della pianificazione un posto dove le cose ci finiscono davvero: un tasto solo che accetta qualunque cosa si incolli, le strade possibili da confrontare coi loro numeri, e la roba utile — link, documenti e quello che c'è da sapere di quel paese — con le sue etichette. E dare ai viaggi in preparazione una stanza loro.

**Architecture:** Una voce nuova nella barra (`#/pianificati`) con l'elenco dei viaggi in preparazione. Nello spazio: una cassetta che riconosce da sé cosa le è stato dato, una tabella `percorsi` per le strade a confronto, e due colonne nuove su `materiali` (`etichetta`, `dove`) che coprono sia la roba utile sia il «da sapere» di un paese — una tabella sola, non due per la stessa cosa.

**Tech Stack:** Node 22 · Express 5 · PostgreSQL · vanilla JS · `node --test` (dalla radice, senza argomenti).

**Spec:** `docs/superpowers/specs/2026-11-13-pianificazione-viaggio-design.md`

## Vincoli di tutto il lavoro

- Niente dipendenze nuove; tabelle e colonne si creano da sole in `src/lib/db.js`.
- Versione alzata in tre punti a ogni cambio di `app.js`/`style.css`. Corrente: `v118`.
- La cassetta **non indovina in silenzio**: dice sempre cosa ha capito, e quello che ha fatto si corregge con un tocco.
- Leggere una pagina altrui è una volta sola, quando si incolla. Un rifiuto o un tempo scaduto diventano «non ci sono riuscito, mettilo tu»: mai un errore che ferma la mano.
- Le etichette sono poche e fisse: un elenco che cresce da sé diventa un mucchio come quello di prima.

## Dove guardare in revisione

1. **Testo che somiglia a un link ma non lo è** (`park4night`, `www.`, uno spazio dentro) → appunto, non una richiesta di rete.
2. **Link di Google Maps accorciato** (`goo.gl`, `maps.app.goo.gl`): va seguito prima di leggerlo, e se non si lascia seguire diventa un link come gli altri.
3. **Percorso con un punto solo**, o con punti senza coordinate: non deve creare una strada che il calcolatore non sa calcolare.
4. **Un viaggio senza niente** aperto da `#/pianificati`: elenco vuoto con l'invito, non una pagina rotta.
5. **Etichetta o paese mai visti** (scritti a mano, o arrivati da un viaggio vecchio): si mostrano come sono, non spariscono dai filtri.

---

### Task 1: Capire cosa è stato incollato

**Files:**
- Create: `src/lib/cassetta.js`
- Create: `test/cassetta.test.js`

**Interfaces:**
- Produces: `capisciIncollato(testo) → { tipo, ...dati }` con `tipo` fra `park4night | maps-punto | maps-percorso | link | nota`. Pura e sincrona: non chiama nessuno. Chi la usa decide se andare a leggere la pagina.

- [ ] **Step 1: Le prove che falliscono**

```js
import { capisciIncludato } from '../src/lib/cassetta.js';   // nome esatto: capisciIncollato
test('un indirizzo di park4night è un posto', () => {
  const r = capisciIncollato('https://park4night.com/it/place/277443');
  assert.equal(r.tipo, 'park4night');
  assert.equal(r.p4n_id, '277443');
});
test('il solo numero è un posto di park4night', () => {
  assert.equal(capisciIncollato('277443').tipo, 'park4night');
});
test('un link di Google Maps con un punto è un posto', () => {
  const r = capisciIncollato('https://www.google.com/maps/dir/?api=1&destination=45.0956,7.3474');
  assert.equal(r.tipo, 'maps-punto');
});
test('un link di Google Maps con partenza e arrivo è un percorso', () => {
  const r = capisciIncollato('https://www.google.com/maps/dir/?api=1&origin=45.0,7.0&destination=46.0,8.0');
  assert.equal(r.tipo, 'maps-percorso');
  assert.equal(r.punti.length, 2);
});
test('un altro indirizzo è un link', () => {
  assert.equal(capisciIncollato('https://www.visitnorway.com/lofoten').tipo, 'link');
});
test('del testo è un appunto, anche se contiene la parola park4night', () => {
  assert.equal(capisciIncollato('chiedere a Paolo di park4night').tipo, 'nota');
  assert.equal(capisciIncollato('').tipo, 'nota');
});
test('un link accorciato di Maps si riconosce come da seguire', () => {
  assert.equal(capisciIncollato('https://maps.app.goo.gl/abc123').tipo, 'maps-corto');
});
```

- [ ] **Step 2: Scrivere `src/lib/cassetta.js`, prove verdi**
- [ ] **Step 3: Commit**

---

### Task 2: La cassetta

**Files:**
- Modify: `src/routes/pianifica.js`
- Modify: `src/lib/db.js` (colonne `etichetta` e `dove` su `materiali`)

**Interfaces:**
- Produces: `POST /api/trips/:id/cassetta` ← `{ testo }` → `{ cosa, riga, detto }`, dove `detto` è la frase da mostrare («Messo in lavagna: Camping Huttopia»).

- [ ] **Step 1: Le colonne**

```sql
ALTER TABLE materiali ADD COLUMN IF NOT EXISTS etichetta TEXT;   -- luogo | esperienza | documento | leggere | sapere
ALTER TABLE materiali ADD COLUMN IF NOT EXISTS dove TEXT;        -- il paese o la regione a cui si riferisce
```

- [ ] **Step 2: La rotta**

Secondo quello che torna `capisciIncollato`:
- `park4night` → `leggiPosto`, poi una proposta; se la pagina non si lascia leggere, una proposta col solo codice e il nome da scrivere.
- `maps-corto` → `seguiLinkBreve`, poi si ricomincia; se non si lascia seguire, è un `link`.
- `maps-punto` → una proposta con le coordinate.
- `maps-percorso` → una riga in `percorsi` (Task 3).
- `link` → un materiale `tipo='link'` col titolo della pagina, letto una volta sola; se non si legge, resta l'indirizzo.
- `nota` → un materiale `tipo='nota'`.

- [ ] **Step 3: Provarla con `curl`** su tutti e sei i casi, più un indirizzo che non risponde.
- [ ] **Step 4: Commit**

---

### Task 3: Le strade possibili

**Files:**
- Modify: `src/lib/db.js`
- Modify: `src/routes/pianifica.js`

```sql
CREATE TABLE IF NOT EXISTS percorsi (
  id SERIAL PRIMARY KEY,
  trip_id INT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  nome TEXT,
  punti JSONB NOT NULL,                      -- [{name, lat, lon}, ...]
  varianti JSONB,                            -- quello che ha risposto il calcolatore
  scelta TEXT,                               -- la chiave della variante scelta
  perche TEXT,
  da_confermare BOOLEAN NOT NULL DEFAULT false,
  user_id INT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

**Interfaces:**
- `POST /api/trips/:id/percorsi` ← `{ nome, punti }` → calcola le varianti con `percorsiConTappe` e salva
- `PUT /api/percorsi/:id` ← `{ nome, perche, scelta, da_confermare }`
- `POST /api/percorsi/:id/ricalcola` · `DELETE /api/percorsi/:id`
- I percorsi escono in `GET /trips/:id/pianifica`.

Con meno di due punti con coordinate: `400`, e la riga non nasce.

- [ ] **Step 1: La tabella e le rotte** · **Step 2: `curl`** · **Step 3: Commit**

---

### Task 4: La stanza dei viaggi in preparazione

**Files:**
- Modify: `src/routes/pianifica.js` (`GET /api/pianificati`)
- Modify: `public/app.js` (voce nella barra, rotta `#/pianificati`, `viewPianificati`, e il gruppo «in costruzione» che se ne va da «Viaggi»)
- Modify: `public/style.css`, `public/index.html`, `public/ospite.html` (versione `v119`)

`GET /api/pianificati` torna, per ogni viaggio in `bozza`: titolo, `quando_circa`, notti, quanti posti scelti su quanti, ipotesi di spesa, quante righe da confermare.

- [ ] **Step 1: La rotta** · **Step 2: La vista e la voce nella barra** · **Step 3: Nel browser a 375×812** · **Step 4: Commit**

---

### Task 5: Nello spazio: la cassetta, le strade, la roba utile, il da sapere

**Files:**
- Modify: `public/app.js`, `public/style.css`, le due pagine (versione `v120`)

- [ ] **Step 1: La cassetta in cima**

Un campo largo e un **＋**. Dopo ogni cosa incollata, una riga che dice **cosa ha capito** e un tocco per correggerla («non era un posto → fanne un appunto»).

- [ ] **Step 2: Le strade possibili**

Una scheda con le strade a confronto: per ognuna il nome, i punti, e le varianti coi loro **km, ore e gasolio** una sotto l'altra; si sceglie quella buona, si scrive perché, e si segna **da confermare**.

- [ ] **Step 3: Roba utile e Da sapere**

I materiali con le loro etichette — 🏞️ luogo · 🎟️ esperienza · 📄 documento · 💡 da leggere — e, a parte, **📍 Da sapere**: le cose di un paese o di una regione (vignette, bombole, ZTL, numeri utili), raggruppate per **dove**.

- [ ] **Step 4: Nel browser a 375×812** · **Step 5: Commit**
