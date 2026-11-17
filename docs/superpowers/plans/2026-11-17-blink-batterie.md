# Batterie delle webcam Blink — piano di attuazione

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Camper Servizi mostra sempre lo stato delle batterie delle telecamere Blink, interrogando Blink una volta la settimana.

**Architecture:** Un modulo **puro** (`blink-protocollo.js`) che costruisce le richieste e interpreta le risposte, senza toccare rete né archivio; e un modulo **di contorno** (`blink.js`) che fa le chiamate, tiene i gettoni e scrive in archivio. La separazione non e' eleganza: `db.js` chiama `process.exit(1)` all'importazione se manca `DATABASE_URL`, quindi la logica che vogliamo provare deve stare dove non lo importa.

**Tech Stack:** Node 20+ (ESM), Express 5, Postgres (`pg`), prove con `node:test` — che e' dentro Node e non aggiunge dipendenze.

**Spec:** `docs/superpowers/specs/2026-11-17-blink-batterie-design.md`

## Global Constraints

- **La password non si scrive mai** in archivio, nei log, o in una risposta HTTP. Si legge da `process.env.BLINK_EMAIL` / `process.env.BLINK_PASSWORD`, si usa, e si scorda.
- Dei gettoni nei log va solo la **forma**: lunghezza e prime dieci lettere.
- **Una sola chiamata** per tutte le telecamere: `GET <indirizzo>/api/v3/accounts/<conto>/homescreen`. Mai `.../camera/<id>/signals`, che sarebbe una richiesta per telecamera.
- Intestazioni dell'accesso, valori esatti: `User-Agent: 27.0ANDROID_28373244`, `hardware_id: <nostro, stabile>`, `2fa-code: <codice o stringa vuota>`.
- Corpo dell'accesso, `application/x-www-form-urlencoded`: `username`, `password`, `client_id=android`, `scope=client`, `grant_type=password`.
- Indirizzi: accesso `https://api.oauth.blink.com/oauth/token`; regione `https://rest-prod.immedia-semi.com/api/v1/users/tier_info`; poi `https://rest-<regione>.immedia-semi.com`.
- `battery_voltage` e' in **centesimi di volt** (165 = 1,65 V). `temperature` e' in **Fahrenheit**.
- Ritmo: **sette giorni**. Niente giri piu' frequenti, e le telecamere Blink **non entrano** nella modalita' taratura.
- Le due lezioni della Bluetti: non si sostituisce un gettone di accesso con uno mai provato; il gettone di rinnovo nuovo si salva sempre, perche' il vecchio si consuma usandolo.

## Review Focus

Cose che il disegno implica, che nessuna attivita' proverebbe da se', e che darebbero fastidio a chi usa l'app. Ognuna ha la sua prova, aggiunta all'attivita' che possiede quel codice.

1. **Le variabili `BLINK_*` cancellate** (il disegno dice di cancellarle) e il gettone morto: la pagina deve dire *«rimetti le due variabili e ricollega»*, non «nessuna telecamera». → Attivita' 3.
2. **Una telecamera senza batteria** (Mini, alimentata a filo): `battery_voltage` e `battery_state` assenti. Non si mostra 0,00 V ne' «scarica». → Attivita' 1.
3. **Il ritmo settimanale dopo un riavvio**: la data dell'ultima lettura sta in archivio, non in memoria. Un riavvio non deve far interrogare le telecamere. → Attivita' 2.
4. **Codice usa-e-getta sbagliato o scaduto**: messaggio chiaro, e si puo' riprovare senza rimettere le variabili. → Attivita' 3.
5. **Lettura vecchia di piu' di due settimane** (telecamera spenta, o gettone morto da un po'): la riga dice che e' vecchia, invece di far credere che sia di adesso. → Attivita' 5.

---

## Struttura dei file

| File | Di che risponde |
|---|---|
| `servizi/src/lib/blink-protocollo.js` (nuovo) | costruisce le richieste, interpreta le risposte. Nessuna rete, nessun archivio, nessun `import` di `db.js`. |
| `servizi/src/lib/blink.js` (nuovo) | fa le chiamate, tiene i gettoni in `gettoni_cloud`, scrive le telecamere in `blink_telecamere`, decide se e' ora. |
| `servizi/src/lib/db.js` (modifica) | la tabella `blink_telecamere` nella migrazione. |
| `servizi/src/routes/blink.js` (nuovo) | `POST /blink/entra`, `POST /blink/codice`, `POST /blink/leggi`. |
| `servizi/src/routes/stato.js` (modifica) | `blink` dentro la risposta di `/stato`. |
| `servizi/src/server.js` (modifica) | monta le vie, e aggancia il giro settimanale a quello periodico. |
| `servizi/public/app.js` (modifica) | le righe delle telecamere, e il blocco «Collega Blink» nell'Impianto. |
| `servizi/test/` (nuovo) | le prove, con `node --test`. |

---

### Attivita' 1: il protocollo Blink, puro

**Files:**
- Create: `servizi/src/lib/blink-protocollo.js`
- Create: `servizi/test/blink-protocollo.test.js`
- Modify: `servizi/package.json` (aggiungere `"test": "node --test test/"`)

**Interfaces:**
- Consumes: niente.
- Produces:
  - `formaAccesso({ email, password, codice = '', hardwareId }) -> { url, intestazioni, corpo }` — `corpo` e' una stringa `x-www-form-urlencoded`
  - `formaRinnovo({ rinnovo, hardwareId }) -> { url, intestazioni, corpo }`
  - `leggiGettoni({ http, dato }) -> { esito, accesso, rinnovo, scade, conto, perche }` con `esito` fra `'ok' | 'serve_codice' | 'rifiutato' | 'irraggiungibile'`
  - `indirizzoRegione(tierInfo) -> string` (es. `'https://rest-e003.immedia-semi.com'`)
  - `leggiTelecamere(homescreen) -> Array<{ id, nome, rete_id, batteria, volt, segnale, temperatura_c }>`
  - `serveLettura({ ultima, ora, giorni = 7 }) -> boolean`
  - `diventateScarse(prima, dopo) -> Array<string>`

- [ ] **Step 1: scrivere le prove che falliscono**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formaAccesso, leggiGettoni, leggiTelecamere, serveLettura, diventateScarse,
         indirizzoRegione } from '../src/lib/blink-protocollo.js';

test('la richiesta di accesso ha le intestazioni e il corpo che Blink vuole', () => {
  const f = formaAccesso({ email: 'a@b.c', password: 'zzz', hardwareId: 'abc123' });
  assert.equal(f.url, 'https://api.oauth.blink.com/oauth/token');
  assert.equal(f.intestazioni['User-Agent'], '27.0ANDROID_28373244');
  assert.equal(f.intestazioni['hardware_id'], 'abc123');
  assert.equal(f.intestazioni['2fa-code'], '');
  assert.equal(f.intestazioni['Content-Type'], 'application/x-www-form-urlencoded');
  const p = new URLSearchParams(f.corpo);
  assert.equal(p.get('username'), 'a@b.c');
  assert.equal(p.get('password'), 'zzz');
  assert.equal(p.get('client_id'), 'android');
  assert.equal(p.get('scope'), 'client');
  assert.equal(p.get('grant_type'), 'password');
});

test('il codice usa-e-getta va nell’intestazione, non nel corpo', () => {
  const f = formaAccesso({ email: 'a@b.c', password: 'zzz', codice: '123456', hardwareId: 'x' });
  assert.equal(f.intestazioni['2fa-code'], '123456');
  assert.equal(new URLSearchParams(f.corpo).get('2fa_code'), null);
});

test('quando Blink chiede il codice, l’esito lo dice', () => {
  // La forma esatta della risposta va confermata contro blinkpy: vedi Step 2.
  const e = leggiGettoni({ http: 401, dato: { error: 'mfa_required' } });
  assert.equal(e.esito, 'serve_codice');
});

test('i gettoni letti bene', () => {
  const e = leggiGettoni({ http: 200, dato: {
    access_token: 'AAA', refresh_token: 'RRR', expires_in: 3600, account_id: 42 } });
  assert.equal(e.esito, 'ok');
  assert.equal(e.accesso, 'AAA');
  assert.equal(e.rinnovo, 'RRR');
  assert.equal(e.conto, 42);
  assert.ok(e.scade instanceof Date);
});

test('una password sbagliata e’ un rifiuto, un 503 e’ un inciampo loro', () => {
  assert.equal(leggiGettoni({ http: 400, dato: { error: 'invalid_grant' } }).esito, 'rifiutato');
  assert.equal(leggiGettoni({ http: 503, dato: null }).esito, 'irraggiungibile');
});

test('la regione diventa l’indirizzo', () => {
  assert.equal(indirizzoRegione({ tier: 'e003' }), 'https://rest-e003.immedia-semi.com');
});

test('le telecamere: volt in centesimi, gradi da Fahrenheit', () => {
  const t = leggiTelecamere({ cameras: [{
    id: 7, name: 'Ingresso', network_id: 3,
    battery: 'ok', battery_voltage: 165, temperature: 68, wifi_strength: -52 }] });
  assert.equal(t.length, 1);
  assert.deepEqual(t[0], { id: 7, nome: 'Ingresso', rete_id: 3,
    batteria: 'ok', volt: 1.65, segnale: -52, temperatura_c: 20 });
});

// Review Focus 2: una Mini a filo non ha batteria.
test('una telecamera senza batteria non diventa 0,00 V ne’ scarica', () => {
  const t = leggiTelecamere({ cameras: [{ id: 8, name: 'Mini', network_id: 3, temperature: 68 }] });
  assert.equal(t[0].volt, null);
  assert.equal(t[0].batteria, null);
  assert.equal(t[0].temperatura_c, 20);
});

test('niente telecamere non e’ un guasto: e’ una lista vuota', () => {
  assert.deepEqual(leggiTelecamere({}), []);
  assert.deepEqual(leggiTelecamere({ cameras: [] }), []);
});

test('si legge una volta la settimana, e mai letto vuol dire adesso', () => {
  const ora = new Date('2026-11-17T09:00:00Z');
  assert.equal(serveLettura({ ultima: null, ora }), true);
  assert.equal(serveLettura({ ultima: new Date('2026-11-16T09:00:00Z'), ora }), false);
  assert.equal(serveLettura({ ultima: new Date('2026-11-10T08:59:00Z'), ora }), true);
});

test('si segnala solo chi passa a scarsa, non chi era gia’ scarsa', () => {
  const prima = [{ id: 1, nome: 'A', batteria: 'ok' }, { id: 2, nome: 'B', batteria: 'low' }];
  const dopo  = [{ id: 1, nome: 'A', batteria: 'low' }, { id: 2, nome: 'B', batteria: 'low' }];
  const d = diventateScarse(prima, dopo);
  assert.equal(d.length, 1);
  assert.match(d[0], /A/);
});
```

- [ ] **Step 2: confermare contro `blinkpy` le due forme che la prova indovina**

Le prove sopra fissano due cose che vanno **lette, non supposte**: come Blink dice «serve il codice», e in quale campo di `homescreen` stanno batteria, temperatura e segnale.

Leggere, nel ramo `dev` di `fronzbot/blinkpy`:
- `blinkpy/auth.py` — la parte che riconosce la richiesta del codice;
- `blinkpy/camera.py`, funzione `update_from_homescreen` — i nomi dei campi.

Se differiscono da quel che c'e' scritto nelle prove, **si cambiano le prove** e si annota qui sotto cosa si e' trovato. Non si cambia il codice per far passare una prova che indovinava.

- [ ] **Step 3: far girare le prove e vederle fallire**

Run: `cd servizi && npm test`
Expected: FAIL — `Cannot find module '../src/lib/blink-protocollo.js'`

- [ ] **Step 4: scrivere `servizi/src/lib/blink-protocollo.js`**

Le sette funzioni dell'Interfaces, nessun `import` oltre a quelli di Node. `temperatura_c` arrotondata a un decimale. `volt` = `battery_voltage / 100`, e `null` se il campo manca. `serveLettura` confronta in millisecondi, `giorni * 24 * 3600 * 1000`.

- [ ] **Step 5: far girare le prove e vederle passare**

Run: `cd servizi && npm test`
Expected: PASS, tutte.

- [ ] **Step 6: commit**

```bash
git add servizi/src/lib/blink-protocollo.js servizi/test/blink-protocollo.test.js servizi/package.json
git commit -m "Il protocollo Blink, separato da rete e archivio perche' sia provabile"
```

---

### Attivita' 2: il contorno — chiamate, gettoni, archivio

**Files:**
- Create: `servizi/src/lib/blink.js`
- Create: `servizi/test/blink.test.js`
- Create: `servizi/test/aiuto/finto-archivio.js`
- Modify: `servizi/src/lib/db.js` (la migrazione, accanto alle altre `CREATE TABLE`)

**Interfaces:**
- Consumes: tutto `blink-protocollo.js`; `q` e `segna` da `db.js`.
- Produces:
  - `collegatoBlink() -> Promise<boolean>`
  - `iniziaAccesso() -> Promise<{ esito, perche? }>` — `esito` fra `'serve_codice' | 'ok' | 'rifiutato' | 'irraggiungibile' | 'manca_password'`
  - `completaAccesso(codice) -> Promise<{ esito, perche? }>`
  - `leggiBlink({ forza = false } = {}) -> Promise<{ letto: boolean, telecamere: Array, perche?: string }>`
  - `statoBlink() -> Promise<{ collegato, quando, telecamere, errore? }>`

La tabella:

```sql
CREATE TABLE IF NOT EXISTS blink_telecamere (
  id      TEXT PRIMARY KEY,
  nome    TEXT,
  dati    JSONB NOT NULL,
  quando  TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

`leggiTelecamere` restituisce `id` come **numero** (e' quel che manda Blink) e la colonna e' `TEXT`: si scrive `String(t.id)`. Un identificativo non e' una quantita', e tenerlo testo evita che un numero grande cambi forma passando per JSON.

I gettoni stanno in `gettoni_cloud` coi nomi `blink_accesso`, `blink_rinnovo`, `blink_conto`, `blink_regione`, `blink_hardware`. `blink_hardware` si genera una volta con `crypto.randomUUID()` e **non cambia piu'**: Blink lo usa per riconoscere l'apparecchio, e cambiarlo rifarebbe scattare il codice usa-e-getta.

- [ ] **Step 1: l'aiuto per le prove**

`servizi/test/aiuto/finto-archivio.js`: mette `process.env.DATABASE_URL` a un valore finto **prima** di importare `db.js` (altrimenti `db.js` fa `process.exit(1)`), poi sostituisce `pool.query` con una funzione in memoria che capisce le interrogazioni di `blink.js`. Esporta `seme(nome, valore)`, `valore(nome)`, `telecamereDentro()`, e `ripulisci()`.

`pg.Pool` non si collega alla costruzione, quindi un `DATABASE_URL` finto basta.

- [ ] **Step 2: scrivere le prove che falliscono**

```js
test('il primo accesso senza variabili dice che mancano', ...);
  // esito 'manca_password', e il messaggio nomina BLINK_EMAIL e BLINK_PASSWORD

test('il primo accesso con le variabili chiede il codice', ...);
  // fetch finto risponde mfa_required -> esito 'serve_codice', e in archivio
  // NON c'e' nessun gettone di accesso

test('il codice giusto salva gettoni, conto e regione', ...);
  // e la password non compare in nessuna riga salvata

// Review Focus 3
test('il ritmo settimanale sopravvive al riavvio', ...);
  // con una lettura di ieri in blink_telecamere, leggiBlink() non chiama
  // nessun fetch e torna { letto: false }

test('leggiBlink({ forza: true }) legge anche se non e’ ora', ...);

test('una lettura riuscita scrive una riga per telecamera', ...);

test('chi passa a scarsa finisce nel registro eventi', ...);
  // segna() chiamata una volta sola, e il testo nomina la telecamera

test('il gettone rinnovato si prova prima di salvarlo', ...);
  // homescreen rifiuta col gettone nuovo -> in archivio resta quello di prima,
  // ma il gettone di RINNOVO nuovo c’e’

test('un rifiuto del cloud non cancella niente', ...);
  // i gettoni restano, e statoBlink() mostra le telecamere dell’ultima volta
```

- [ ] **Step 3: far girare le prove e vederle fallire**

Run: `cd servizi && npm test`
Expected: FAIL — `Cannot find module '../src/lib/blink.js'`

- [ ] **Step 4: scrivere la tabella in `db.js` e `servizi/src/lib/blink.js`**

Il percorso di lettura ricalca `bluetti.js` nei punti che sono costati due giorni: si riprova la stessa richiesta prima di rinnovare; il gettone di accesso si salva solo se provato; il gettone di rinnovo si salva sempre.

- [ ] **Step 5: far girare le prove e vederle passare**

Run: `cd servizi && npm test`
Expected: PASS, tutte.

- [ ] **Step 6: commit**

```bash
git add servizi/src/lib/blink.js servizi/src/lib/db.js servizi/test/
git commit -m "Blink: gettoni, lettura settimanale e archivio"
```

---

### Attivita' 3: le vie HTTP

**Files:**
- Create: `servizi/src/routes/blink.js`
- Modify: `servizi/src/routes/stato.js` (aggiungere `blink` alla risposta di `/stato`)
- Modify: `servizi/src/server.js` (montare la via)
- Create: `servizi/test/blink-vie.test.js`

**Interfaces:**
- Consumes: `iniziaAccesso`, `completaAccesso`, `leggiBlink`, `statoBlink` dall'Attivita' 2.
- Produces: `POST /blink/entra`, `POST /blink/codice` (corpo `{ codice }`), `POST /blink/leggi`; e il campo `blink` in `GET /stato`.

Tutte dietro `serveAccesso`, come `taratura.js`.

- [ ] **Step 1: scrivere le prove che falliscono**

```js
test('POST /blink/entra senza variabili spiega cosa fare', ...);
  // Review Focus 1: il messaggio dice di rimettere BLINK_EMAIL e BLINK_PASSWORD
  // e ricollegare — non «nessuna telecamera»

test('POST /blink/codice con un codice scaduto lo dice, e si puo’ riprovare', ...);
  // Review Focus 4: 400 con un messaggio che nomina il codice, non la password

test('le vie Blink sono dietro l’accesso', ...);
  // senza sessione: 401 su tutte e tre

test('GET /stato porta blink anche quando non e’ collegato', ...);
  // { collegato: false, telecamere: [] }, non un campo mancante

test('nessuna risposta contiene la password ne’ un gettone intero', ...);
```

- [ ] **Step 2: far girare le prove e vederle fallire**

Run: `cd servizi && npm test`
Expected: FAIL

- [ ] **Step 3: scrivere `servizi/src/routes/blink.js`, montarla in `server.js`, aggiungere `blink: await statoBlink()` in `/stato`**

- [ ] **Step 4: far girare le prove e vederle passare**

Run: `cd servizi && npm test`
Expected: PASS

- [ ] **Step 5: commit**

```bash
git add servizi/src/routes/blink.js servizi/src/routes/stato.js servizi/src/server.js servizi/test/blink-vie.test.js
git commit -m "Le vie per collegare Blink e leggere le telecamere"
```

---

### Attivita' 4: il giro settimanale

**Files:**
- Modify: `servizi/src/server.js:92-104` (dentro `leggi`, accanto alla lettura Bluetti)

**Interfaces:**
- Consumes: `collegatoBlink`, `leggiBlink` dall'Attivita' 2.
- Produces: niente di nuovo.

- [ ] **Step 1: aggiungere la chiamata al giro**

Dentro `leggi()`, **dopo** la parte Bluetti e in un `try` suo, perche' un guasto Blink non deve far perdere la lettura Bluetti: se `collegatoBlink()`, chiamare `leggiBlink()` — che decide da se' se e' ora e il piu' delle volte non fa niente. Scrivere nel log solo quando ha letto davvero o quando c'e' un `perche`.

**Le Blink fuori dalla taratura.** Il disegno lo chiede, e si ottiene **non facendo niente**: la taratura (`routes/taratura.js`, `SECONDI_GIRO = 10`) interroga quel che manda la scatoletta, e non chiama mai `leggiBlink`. Da non collegare: una telecamera a batteria interrogata ogni dieci secondi si scarica. E anche se qualcuno lo collegasse, il freno settimanale di `leggiBlink` lo fermerebbe — ma il freno e' una rete di sicurezza, non il motivo.

- [ ] **Step 2: provare che il giro non interroga Blink quando non e' ora**

Run: `cd servizi && npm test`
Expected: PASS — la prova dell'Attivita' 2 sul ritmo copre la decisione; qui basta che il giro non si rompa.

- [ ] **Step 3: commit**

```bash
git add servizi/src/server.js
git commit -m "Il giro settimanale delle Blink, agganciato a quello periodico"
```

---

### Attivita' 5: la pagina

**Files:**
- Modify: `servizi/public/app.js` — una funzione `vistaBlink()` accanto a `vistaSegnale()` (riga ~388), e il blocco «Collega Blink» in `vistaImpianto()` (riga ~630)
- Modify: `servizi/public/stile.css` solo se serve

- [ ] **Step 1: le righe delle telecamere**

Una riga per telecamera: nome, batteria (tradotta: `ok` → «buona», `low` → «scarsa»), volt con due decimali, segnale con l'antenna che c'e' gia' (`antenna(rssi)`, riga ~380), temperatura. Un campo assente si mostra come «—», mai come zero.

In testa alla scheda: **«letto lunedi' 17»**. Se la lettura ha piu' di quattordici giorni, la data va col bollo `incompleto` e la nota dice che e' vecchia — Review Focus 5.

- [ ] **Step 2: il blocco nell'Impianto**

Come quello Bluetti: un tasto «Collega Blink», e quando la risposta e' `serve_codice` compare **un campo per il codice** con un tasto «Conferma». Il testo sopra dice, in ordine: metti le due variabili su Railway, collega, digita il codice che ti arriva, **cancella le variabili**.

- [ ] **Step 3: guardare la pagina**

Avviare l'anteprima e controllare: la scheda compare quando non c'e' nessuna telecamera (e dice perche'), i campi assenti sono «—», la colonna non va a capo sul telefono.

- [ ] **Step 4: commit**

```bash
git add servizi/public/app.js servizi/public/stile.css
git commit -m "Le batterie delle webcam in pagina, con la data della lettura"
```

---

## Dopo l'ultima attivita'

Il codice e' pubblicato, e **solo adesso** il proprietario mette `BLINK_EMAIL` e `BLINK_PASSWORD` su Railway, collega, digita il codice, e **cancella le due variabili**. Questo e' l'ordine deciso nel disegno, e serve a tenere la password su Railway due minuti invece di un giorno.
