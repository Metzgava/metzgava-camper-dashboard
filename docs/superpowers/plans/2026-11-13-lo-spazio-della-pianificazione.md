# Lo spazio della pianificazione — piano di lavoro

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dare alla pianificazione di un viaggio un posto suo — un tasto e una pagina — dove sta tutto quello che serve a decidere: i posti, quando, quanto costerà e cosa c'è da preparare.

**Architecture:** Una rotta nuova, `#/pianifica/<id>`, con la sua vista. La lavagna trasloca lì dalla pagina del viaggio. Due tabelle nuove (`budget`, `liste`), due colonne nuove su `trips` (`quando_circa`, `notti_previste`) e una su `legs`/`stops` (`da_confermare`). Niente di quello che c'è viene tolto: la pagina del viaggio resta quella di sempre, con un tasto che porta qui.

**Tech Stack:** Node 22 · Express 5 · PostgreSQL · frontend vanilla in `public/app.js` · `node --test` (dalla radice, senza argomenti) per la logica pura.

**Spec:** `docs/superpowers/specs/2026-11-13-pianificazione-viaggio-design.md`

## L'emendamento al disegno

Il documento approvato diceva **«nessuna modalità nuova»**: lavagna, giorni e budget dentro alla pagina del viaggio (strada A), perché la strada B — un ambiente separato — portava con sé due concetti per ogni cosa e un passaggio di consegne.

Costruita la lavagna, la pagina del viaggio si è affollata, e preparare un viaggio e guardarne uno fatto sono due mestieri diversi: nel primo si decide, nel secondo si ricorda. Perciò **lo spazio separato si fa**, ma senza il difetto della strada B: **non ha dati suoi**. Le proposte sono le stesse, le tappe sono le stesse, le soste sono le stesse. È una vista diversa sulle stesse cose, non un posto dove ricopiarle. Il passaggio di consegne, che era l'obiezione vera, non esiste lo stesso.

## Vincoli di tutto il lavoro

- Niente dipendenze nuove.
- Tabelle e colonne si creano da sole all'avvio in `src/lib/db.js`.
- Ogni cambio di `public/app.js` o `public/style.css` vuole il numero di versione alzato in tre punti (`VERSIONE`, `index.html`, `ospite.html`). La versione corrente è `v117`.
- Chi guarda da un collegamento di sola lettura non entra qui: la pagina è dietro a `requireAuth` come il resto, e `ripulisci` in `src/routes/share.js` resta una lista bianca.
- Un numero mostrato dice sempre **da dove viene**. Un totale senza i suoi pezzi è un budget che mente.

## Come si prova

Come nel piano precedente: `node --test` sulla logica pura (i conti del budget), `curl` sulle rotte, il browser su quello che si vede. Server locale da `.claude/launch.json` (porta 3999, database `camper_prova`).

## Dove guardare in revisione

1. **Un viaggio senza tappe e senza proposte** — appena creato — deve aprire lo spazio senza niente di rotto e con l'invito giusto.
2. **Il budget con zero dati**: nessun totale inventato, nessuna divisione per zero (consumo o prezzo gasolio mancanti).
3. **Una voce di lista spuntata e rispuntata**: chi l'ha spuntata e quando devono restare veri, e il doppio tocco non deve fare due righe.
4. **Il viaggio che parte** (`bozza → open`): lo spazio resta raggiungibile e non perde niente.
5. **Valute diverse**: un prezzo in corone dentro al budget non si somma agli euro come se fosse un euro.

---

### Task 1: I conti del budget

**Files:**
- Create: `src/lib/budget.js`
- Create: `test/budget.test.js`

**Interfaces:**
- Produces: `gasolioPrevisto({ km, kmPerLitro, prezzoLitro }) → { importo, conto } | null`; `campeggiPrevisti({ prezzi, notti }) → { importo, conto } | null`. `conto` è la riga che spiega il numero («1.240 km ÷ 10 km/l × 1,85 €»). `null` quando manca un dato: non si inventa.

- [ ] **Step 1: Le prove che falliscono**

```js
// test/budget.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { gasolioPrevisto, campeggiPrevisti } from '../src/lib/budget.js';

test('il gasolio si conta dai km, dal consumo e dal prezzo', () => {
  const r = gasolioPrevisto({ km: 1240, kmPerLitro: 10, prezzoLitro: 1.85 });
  assert.equal(r.importo, 229.4);
  assert.match(r.conto, /1\.?240/);
});

test('senza consumo o senza prezzo il gasolio non si inventa', () => {
  assert.equal(gasolioPrevisto({ km: 1240, kmPerLitro: 0, prezzoLitro: 1.85 }), null);
  assert.equal(gasolioPrevisto({ km: 1240, kmPerLitro: 10, prezzoLitro: null }), null);
  assert.equal(gasolioPrevisto({ km: 0, kmPerLitro: 10, prezzoLitro: 1.85 }), null);
});

test('i campeggi si contano sulla media dei posti scelti per le notti', () => {
  const r = campeggiPrevisti({ prezzi: [30, 20], notti: 10 });
  assert.equal(r.importo, 250);
  assert.match(r.conto, /25/);
});

test('senza posti scelti o senza notti non c’è niente da contare', () => {
  assert.equal(campeggiPrevisti({ prezzi: [], notti: 10 }), null);
  assert.equal(campeggiPrevisti({ prezzi: [30], notti: 0 }), null);
});
```

Run: `node --test` → FAIL, modulo mancante.

- [ ] **Step 2: Scrivere `src/lib/budget.js` e far passare le prove**

Arrotondamento a due decimali. `conto` in italiano, coi numeri come li scrive la casa (`num`/`eur` stanno nel frontend: qui basta `toFixed` e la virgola).

Run: `node --test` → tutte verdi.

- [ ] **Step 3: Commit**

```bash
git add src/lib/budget.js test/budget.test.js
git commit -m "I conti del budget, e quando non c'e' niente da contare"
```

---

### Task 2: Le tabelle e le rotte della pianificazione

**Files:**
- Modify: `src/lib/db.js`
- Create: `src/routes/pianifica.js`
- Modify: `src/server.js`

**Interfaces:**
- Produces:
  - `GET /api/trips/:id/pianifica` → `{ trip, quando_circa, notti_previste, budget: { voci, totale, speso }, liste, proposte, legs, soste, numeri }`
  - `PUT /api/trips/:id/pianifica` ← `{ quando_circa, notti_previste }`
  - `POST /api/trips/:id/budget` ← `{ categoria, importo, nota }` · `PUT /api/budget/:id` · `DELETE /api/budget/:id`
  - `POST /api/trips/:id/liste` ← `{ lista, testo }` · `PUT /api/liste/:id` ← `{ testo, fatta }` · `DELETE /api/liste/:id`
  - `PUT /api/legs/:id/conferma` e `PUT /api/soste/:id/conferma` ← `{ da_confermare }`

- [ ] **Step 1: Le tabelle**

```sql
ALTER TABLE trips ADD COLUMN IF NOT EXISTS quando_circa TEXT;
ALTER TABLE trips ADD COLUMN IF NOT EXISTS notti_previste INT;
ALTER TABLE legs  ADD COLUMN IF NOT EXISTS da_confermare BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE stops ADD COLUMN IF NOT EXISTS da_confermare BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS budget (
  id SERIAL PRIMARY KEY,
  trip_id INT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  categoria TEXT NOT NULL,
  importo NUMERIC(10,2),
  currency TEXT,
  nota TEXT,
  posizione INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS liste (
  id SERIAL PRIMARY KEY,
  trip_id INT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  lista TEXT NOT NULL DEFAULT 'fare',          -- fare | comprare | portare
  testo TEXT NOT NULL,
  fatta BOOLEAN NOT NULL DEFAULT false,
  user_id INT REFERENCES users(id) ON DELETE SET NULL,   -- chi l'ha scritta
  chi INT REFERENCES users(id) ON DELETE SET NULL,       -- chi l'ha spuntata
  quando TIMESTAMPTZ,
  posizione INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

- [ ] **Step 2: Le rotte**

`GET` mette insieme: il viaggio, le due colonne nuove, le liste (con i nomi di chi ha scritto e spuntato), le proposte (da `proposteDi`), le tappe e le soste, i **numeri del giro** (km del camper, ore di guida, notti previste, posti scelti) e il **budget**: le voci scritte a mano più le due calcolate — gasolio e campeggi — da `src/lib/budget.js`, e il totale. `speso` sono le spese vere già in archivio (`expenses`), per il confronto.

Spuntare una voce scrive `chi` e `quando`; togliendo la spunta tornano `null`.

- [ ] **Step 3: Montare e provare**

```bash
curl -s -b /tmp/c.txt 'http://localhost:3999/api/trips/2/pianifica' | python3 -m json.tool | head -40
```

Expected: `budget.voci` contiene almeno il gasolio se il viaggio ha tappe, `liste` è `[]`, `numeri` ha `km` e `notti`.

- [ ] **Step 4: Commit**

---

### Task 3: Il tasto e lo spazio

**Files:**
- Modify: `public/app.js` (rotta `#/pianifica/:id`, `viewPianifica`, il tasto, la lavagna che trasloca)
- Modify: `public/style.css`
- Modify: `public/index.html`, `public/ospite.html` (versione a `v118`)

- [ ] **Step 1: La rotta e il tasto**

In `render`, `#/pianifica/<id>` → `viewPianifica(id)`. Il tasto **«🧭 Pianifica il viaggio»** in cima alla pagina di un viaggio in costruzione, accanto a «Si parte», e nell'elenco dei viaggi sulla riga di quelli in costruzione.

- [ ] **Step 2: La pagina**

In cima: nome del viaggio, **quando (circa)** scrivibile in parole, e i **numeri del giro** — km, ore di guida, notti previste, posti scelti — che si aggiornano da sé. Poi, una sotto l'altra:

1. **🗒️ La lavagna**, tale e quale a com'è adesso (la stessa funzione, non una copia).
2. **🧭 Il giro** — le tappe in ordine, ognuna col suo **«da confermare»**; le soste con lo stesso bollino.
3. **💶 Il budget** — le voci calcolate con il loro conto in chiaro, quelle scritte a mano, il totale e, di fianco, quanto si è speso davvero.
4. **✅ Le liste** — da fare, da comprare, da portare: si aggiunge scrivendo e premendo invio, si spunta toccando, e si vede chi ha spuntato cosa.

Dalla pagina del viaggio la scheda della lavagna sparisce e resta il tasto: lì si ricorda, qui si decide.

- [ ] **Step 3: Provarlo nel browser, a 375×812**

- il tasto porta allo spazio, e lo spazio torna al viaggio;
- un viaggio appena creato lo apre senza errori, con gli inviti al posto dei numeri;
- scrivendo «fine giugno, 18-20 giorni» resta scritto;
- una voce di lista si aggiunge, si spunta (compare chi), si rispunta, si toglie;
- una voce di budget scritta a mano entra nel totale; il gasolio mostra il suo conto;
- niente sborda dai 375 px.

- [ ] **Step 4: Commit**

---

### Task 4: Il cruscotto della pianificazione, coi filtri

**Files:**
- Modify: `public/app.js` (`viewPianifica`)
- Modify: `public/style.css`
- Modify: `public/index.html`, `public/ospite.html` (versione a `v119`)

Un cruscotto esiste già per i viaggi fatti (`#/cruscotto`) e un altro per i periodi (`#/riepiloghi`): quelli contano quello che è successo. Qui si conta quello che **deve ancora** succedere, ed è un altro mestiere.

**Interfaces:**
- Consumes: la risposta di `GET /api/trips/:id/pianifica` (Task 2). I filtri lavorano **nella pagina**, sui dati già scaricati: sono pochi, e un giro al server a ogni tocco sarebbe un'attesa per niente.

- [ ] **Step 1: I riquadri**

In cima allo spazio, la stessa fila di riquadri che il resto dell'app usa (`.tile`):

| riquadro | cosa dice | sotto |
|---|---|---|
| Km del giro | i km delle tappe | le ore di guida |
| Notti | le notti previste | i giorni |
| Posti scelti | quanti ✅ | su quanti proposti |
| Budget | il totale ipotizzato | «di cui calcolato» |
| Già speso | le spese vere | quanto manca all'ipotesi |
| Da confermare | quante righe col bollino | tappe e soste |

Un riquadro senza il suo dato dice cosa manca («manca il consumo»), non zero.

- [ ] **Step 2: I filtri**

Una riga di filtri sotto ai riquadri, che agisce **su tutto lo spazio** — riquadri compresi:

- **Chi**: tutti · Metz · Cate — proposte e voci di lista di quella persona
- **Cosa**: tutto · 🛏️ dormire · ⏸️ sosta · 👀 da vedere
- **Come sta**: tutto · 💡 proposto · 👀 da guardare · ✅ scelto · 🚫 scartato
- **Voce**: tutto, più una voce per ogni categoria del budget

I filtri si sommano. Quando uno è acceso, i riquadri dicono i numeri **di quel taglio** e portano un segno che lo ricorda, perché un totale filtrato che sembra il totale vero è un numero che mente. Toccando «tutto» si torna indietro.

I filtri scelti restano mentre si lavora: dopo ogni azione la pagina si rifà, e ritrovarsi daccapo a ogni spunta è il difetto che la lavagna ha già.

- [ ] **Step 3: Provarlo nel browser a 375×812**

- con tutti i filtri spenti i riquadri dicono gli stessi numeri del server;
- filtrando per «scelto» il riquadro dei posti cambia e compare il segno del taglio;
- filtrando per persona le liste e le proposte si riducono insieme;
- il filtro resta dopo aver spuntato una voce;
- la fila dei filtri scorre in orizzontale sul telefono senza spingere fuori la pagina.

- [ ] **Step 4: Commit**
