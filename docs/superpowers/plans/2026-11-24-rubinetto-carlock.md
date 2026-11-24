# Il rubinetto di CarLock — piano di esecuzione

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** dentro un viaggio, un tocco porta le tappe davvero percorse **con la
strada vera**, chiedendole all'interfaccia di CarLock invece che a un file —
e il cartello che lo propone ritorna ogni volta che un giorno del viaggio è
passato.

**Architecture:** `src/lib/carlock-api.js` è l'unico posto che parla con loro:
l'accesso, il gettone, le chiamate, e **la traduzione** verso le due forme che
il programma già usa (quella di `readCarlockFile` per l'elenco, quella di
`leggiTracciati` per i punti). Da lì in poi non cambia niente: `mergeTrips`,
`assegna`, `cuci`, il vincolo sui doppioni. Due rotte dentro un viaggio, e un
cartello in pagina.

**Tech Stack:** Node 20 ESM, Express, PostgreSQL, prove con `node --test`.
Nessuna libreria nuova: `fetch` è nativo e i fusi si fanno con
`Intl.DateTimeFormat`.

**Spec:** `docs/superpowers/specs/2026-11-24-rubinetto-carlock-design.md`
(che rimanda a `2026-11-24-tracciati-veri-design.md`, da leggere prima)

## Global Constraints

- Le prove girano con `node --test "test/*.test.js"`; **non** esiste `npm test`
  nella radice.
- **Le forme delle risposte sono in `test/fixtures/carlock-api-forme.json`.**
  Le prove si scrivono da lì, senza rete. Coordinate e indirizzi lì dentro sono
  inventati; nomi dei campi, tipi e unità di misura sono veri.
- **Le chiamate le fa il server, mai la pagina.** Le credenziali non devono
  avere modo di arrivare al browser.
- **Le credenziali non si scrivono mai nei registri**, nemmeno troncate, e il
  **gettone non va su disco**: vive in memoria del processo.
- **La richiesta parte solo a comando.** Nessun lavoro a orologio, nessun
  rinfresco periodico.
- **Non si chiede mai per giorni futuri.**
- **Mai due accessi di fila per la stessa richiesta.** Al primo 401 si rifà
  l'accesso **una volta sola**; se fallisce, si smette e lo si dice.
- **Non si toccano `distance_km`, `duration_min`, `start_time`, `end_time`,
  `source` delle tappe esistenti**, e non si spostano i capi. Vale la regola
  dell'altro disegno.
- **Non si tocca `TZ` su Railway.** La conversione dei fusi sta nel traduttore.
- Unità: `distance` in **metri**, tutti gli orari in **millisecondi UTC**,
  `page` si conta da **zero**, senza `page_size` ne tornano **20**.
- Lingua del codice, dei commenti e della pagina: italiano, nella voce che
  c'è già.

## Review Focus

1. **Il gettone scade a metà lavoro** (401 sulla terza di dieci richieste di
   punti): si rifà l'accesso una volta e si **continua**, non si ricomincia e
   non si fallisce tutto. Prova nell'attività 1.
2. **Un giorno con l'ora legale** (26 o 28 ottobre): la conversione in orari
   da parete deve restare giusta su un giorno di 23 o 25 ore, o gli orari
   della tappa sono sbagliati di un'ora e la traccia non si aggancia. Prova
   nell'attività 2.
3. **Un tragitto che scavalca la mezzanotte** (23:50 → 00:20): data, orari e
   `external_id` devono essere coerenti, e `duration_min` positivo. Prova
   nell'attività 2.
4. **Un tragitto già presente come tappa**: non nasce un doppione e il
   resoconto dice «c'era già», non «creata». Prova nell'attività 4.
5. **I punti di un tragitto non arrivano** mentre gli altri sì: quella tappa
   nasce con la strada ricostruita e **senza** il bollino della traccia vera,
   e il resoconto lo dice. Prova nell'attività 4.

---

### Task 1: parlare con loro, e il gettone che si rinnova

**Files:**
- Create: `src/lib/carlock-api.js`
- Test: `test/carlock-api.test.js` (nuovo)

**Interfaces:**
- Consumes: niente.
- Produces:
  - `export function creaRubinetto({ email, password, uuid = null, fetch: f = fetch })`
    → `{ tragittiDelPeriodo(uuid, da, a), puntiDelTragitto(uuidTragitto), veicolo() }`,
    dove `da`/`a` sono millisecondi. Tiene il gettone in una **variabile sua**,
    mai su disco. `uuid` passato qui comanda su quello del conto: viene da
    `CARLOCK_VEHICLE_UUID`, e senza si prende il primo di `vehicles`.
  - `veicolo()` → `{ uuid, name, time_zone_id, subscription_tier }`, letto una
    volta e tenuto in memoria: serve il fuso al traduttore e il piano alla
    finestra.
  - `export function hashPassword(password)` → SHA-256 esadecimale.
  - `export const CLIENT = { type: 'WEB', version: '3.50.0' }`

- [ ] **Step 1: scrivi le prove che falliscono** in `test/carlock-api.test.js`

Il `fetch` si passa da fuori: niente rete nelle prove. Le risposte vengono dal
file delle forme.

```js
test('la password va in SHA-256 esadecimale, quello che vuole la loro interfaccia', () => {
  // Valore noto, cosi' la prova fallisce se qualcuno cambia algoritmo.
  assert.equal(hashPassword('prova'),
    '2fdf958b1ba6f6feba2ea7e66b4b8e0a4c4e8b3d9e5b0c5f0e6f5c3c0a1b2c3d'.length === 64
      ? require('node:crypto').createHash('sha256').update('prova').digest('hex') : null);
  assert.match(hashPassword('prova'), /^[0-9a-f]{64}$/);
  assert.notEqual(hashPassword('prova'), hashPassword('provA'));
});

test('il gettone non finisce su disco', () => {
  // Anti obiettivo del disegno: un riavvio costa un accesso, non un rischio.
  const sorgente = readFileSync(new URL('../src/lib/carlock-api.js', import.meta.url), 'utf8');
  assert.doesNotMatch(sorgente, /writeFile|appendFile|createWriteStream/,
    'il gettone o le credenziali possono finire in un file');
});

test('il veicolo si puo’ scegliere, invece di prendere sempre il primo', async () => {
  // Oggi sul conto ce n'e' uno solo. Domani, con un secondo tracker, «il
  // primo» porterebbe dentro i tragitti dell'auto senza che niente lo dica.
  const vie = [];
  const finto = async (url) => { vie.push(String(url)); return risposta(
    String(url).includes('/user/login') ? FORME.login : FORME.trips_elenco,
    String(url).includes('/user/login') ? 201 : 200); };
  const r = creaRubinetto({ email: 'a@b.c', password: 'x', uuid: 'SCELTO-A-MANO', fetch: finto });
  await r.tragittiDelPeriodo(null, 1, 2);
  assert.ok(vie.some(v => v.includes('SCELTO-A-MANO')),
    'l’uuid passato da fuori viene ignorato');
});

test('l’accesso manda email e password_hash, e le intestazioni del programma', async () => {
  // Si guarda cos’e’ stato spedito, non cosa torna: e’ l’unico modo di provare
  // che la password non parte in chiaro.
  const viste = [];
  const finto = async (url, opz) => { viste.push({ url, opz }); return risposta(FORME.login, 201); };
  const r = creaRubinetto({ email: 'a@b.c', password: 'segreta', fetch: finto });
  await r.veicolo();
  const corpo = JSON.parse(viste[0].opz.body);
  assert.equal(corpo.email, 'a@b.c');
  assert.equal(corpo.password_hash, hashPassword('segreta'));
  assert.ok(!JSON.stringify(viste).includes('segreta'), 'la password e’ partita in chiaro');
  assert.equal(viste[0].opz.headers['X-Client-Type'], 'WEB');
});

test('il gettone si usa senza rifare l’accesso a ogni chiamata', async () => {
  // Due richieste di fila: un accesso solo.
  const vie = [];
  const finto = async via => { vie.push(String(via)); return risposta(
    String(via).includes('/user/login') ? FORME.login
      : String(via).includes('/trip/') ? FORME.trip_singolo : FORME.trips_elenco,
    String(via).includes('/user/login') ? 201 : 200); };
  const r = creaRubinetto({ email: 'a@b.c', password: 'x', fetch: finto });
  await r.tragittiDelPeriodo('U', 1, 2);
  await r.tragittiDelPeriodo('U', 3, 4);
  assert.equal(vie.filter(v => v.includes('/user/login')).length, 1);
});

test('il gettone che scade a meta’ lavoro si rinnova una volta e si continua', async () => {
  // Review Focus 1. Un 401 sulla seconda chiamata: si rifa’ l’accesso e la
  // chiamata riparte, invece di buttare via tutto il lavoro fatto.
  let accessi = 0, chiamate = 0;
  const finto = async via => {
    if (String(via).includes('/user/login')) { accessi++; return risposta(FORME.login, 201); }
    chiamate++;
    if (chiamate === 2) return risposta({ http_status: 401 }, 401);
    return risposta(FORME.trips_elenco, 200);
  };
  const r = creaRubinetto({ email: 'a@b.c', password: 'x', fetch: finto });
  await r.tragittiDelPeriodo('U', 1, 2);
  const d = await r.tragittiDelPeriodo('U', 3, 4);
  assert.equal(accessi, 2, 'non si e’ rinnovato il gettone');
  assert.equal(d.length, 2, 'la chiamata non e’ ripartita dopo il rinnovo');
});

test('se anche il gettone nuovo viene rifiutato, si smette e lo si dice', async () => {
  const finto = async via => risposta(
    String(via).includes('/user/login') ? FORME.login : { http_status: 401 },
    String(via).includes('/user/login') ? 201 : 401);
  const r = creaRubinetto({ email: 'a@b.c', password: 'x', fetch: finto });
  await assert.rejects(() => r.tragittiDelPeriodo('U', 1, 2), /CarLock/);
});

test('le pagine si girano tutte: fermarsi alla prima perde la coda in silenzio', async () => {
  // `total_count` dice quanti sono; senza `page_size` ne tornano 20.
  const pagine = [];
  const finto = async via => {
    if (String(via).includes('/user/login')) return risposta(FORME.login, 201);
    pagine.push(new URL(via).searchParams.get('page'));
    return risposta({ total_count: 3, trips: [FORME.trips_elenco.trips[0]] }, 200);
  };
  const r = creaRubinetto({ email: 'a@b.c', password: 'x', fetch: finto });
  const d = await r.tragittiDelPeriodo('U', 1, 2);
  assert.equal(d.length, 3, `ne ha presi ${d.length} su 3`);
  assert.deepEqual(pagine, ['0', '1', '2'], 'le pagine si contano da zero');
});

test('un guasto di CarLock si riconosce dal messaggio, e non porta dentro la password', async () => {
  const finto = async () => risposta({ http_status: 500, description: 'Sorry' }, 500);
  const r = creaRubinetto({ email: 'a@b.c', password: 'segreta', fetch: finto });
  await assert.rejects(() => r.veicolo(), e =>
    /CarLock/.test(e.message) && !/segreta/.test(e.message));
});
```

- [ ] **Step 2: fai girare le prove e guardale fallire**

Run: `node --test test/carlock-api.test.js`
Expected: FAIL, «does not provide an export named 'creaRubinetto'»

- [ ] **Step 3: scrivi `src/lib/carlock-api.js`**

Le costanti misurate: `https://api.carlock.co/v2`, `X-Token` per il gettone,
`X-Client-Type: WEB`, `X-Client-Version: 3.50.0`, `X-Client-Locale: it`.
L'indirizzo si può scavalcare con `CARLOCK_API_URL`, come fa `src/lib/geo.js`
per i suoi servizi.

`tragittiDelPeriodo` chiede `?ascending=true&date_from=<da>&date_to=<a>&page=<n>&page_size=200`
e cicla da `page=0` finché ha raccolto `total_count` tragitti o una pagina
torna vuota — quella seconda condizione è la cintura: senza, un `total_count`
sbagliato da parte loro diventa un ciclo infinito.

Il rinnovo del gettone sta in **un posto solo**, la funzione interna che fa le
chiamate: al 401 rifà l'accesso e **riprova quella chiamata una volta**. Un
contatore per richiesta, non globale.

Nessun `console.log` con le credenziali o il gettone. I messaggi d'errore
dicono la rotta e lo stato, niente altro.

- [ ] **Step 4: fai girare le prove**

Run: `node --test test/carlock-api.test.js`
Expected: PASS

- [ ] **Step 5: tutta la suite, poi commit**

Run: `node --test "test/*.test.js"`
Expected: PASS, nessun fallimento

```bash
git add src/lib/carlock-api.js test/carlock-api.test.js
git commit -m "Il rubinetto si apre: l'accesso a CarLock e il gettone che si rinnova una volta"
```

---

### Task 2: il traduttore, e l'orologio che è la trappola

**Files:**
- Modify: `src/lib/carlock-api.js`
- Test: `test/carlock-traduzione.test.js` (nuovo)

**Interfaces:**
- Consumes: le forme del file `test/fixtures/carlock-api-forme.json`.
- Produces:
  - `export function comeIlFile(tragitti, fuso)` → la forma di
    `readCarlockFile`: `[{ date, start, end, from, to, km, duration_min, type,
    external_id, da_lat, da_lon, a_lat, a_lon }]`
  - `export function comePunti(tragitto, fuso)` → la forma di
    `leggiTracciati`: `{ id, da, a, punti: [{ t, lat, lon }] }`
  - `export function oraDaParete(ms, fuso)` → `{ giorno: 'YYYY-MM-DD', ora: 'HH:MM' }`

- [ ] **Step 1: scrivi le prove che falliscono** in `test/carlock-traduzione.test.js`

```js
test('i metri diventano chilometri, con un decimale come nel file', () => {
  const [a] = comeIlFile([FORME.trips_elenco.trips[1]], 'Europe/Rome');
  assert.equal(a.km, 184.0);  // 183979 metri
});

test('l’identificativo e’ identico a quello che costruisce il file', () => {
  // `carlock:<data>:<inizio>:<fine>` con gli orari a minuti, come nel CSV.
  // Se i due non coincidono, lo stesso tragitto preso dal file e dal
  // rubinetto diventa DUE tappe, e il vincolo unico non se ne accorge.
  const [a] = comeIlFile([tragitto('2026-11-21T11:18:29+01:00', '2026-11-21T14:02:04+01:00')], 'Europe/Rome');
  assert.equal(a.external_id, 'carlock:2026-11-21:11:18:14:02');
});

test('i capi portano le coordinate, cosi’ non si geocodifica un indirizzo che c’e’ gia’', () => {
  const [a] = comeIlFile([FORME.trips_elenco.trips[1]], 'Europe/Rome');
  assert.equal(typeof a.da_lat, 'number');
  assert.equal(typeof a.a_lon, 'number');
  assert.ok(a.from.length > 0, 'il nome serve ancora: e’ quello che si legge');
});

test('i punti escono nella forma dei tracciati, in ordine di tempo', () => {
  const p = comePunti(FORME.trip_singolo, 'Europe/Rome');
  assert.equal(p.punti.length, FORME.trip_singolo.locations.length);
  assert.equal(typeof p.punti[0].t, 'number');
  assert.ok(p.punti[0].t <= p.punti[p.punti.length - 1].t);
  assert.equal(typeof p.punti[0].lat, 'number');
});

// -- l'orologio ------------------------------------------------------------
// Il difetto che avrebbe fatto fallire tutto in silenzio e solo su Railway.
test('la conversione non dipende dal fuso del processo', () => {
  // Review Focus: su Railway il processo gira a UTC, sul Mac a Roma. Col file
  // i due lati del confronto erano storti uguale e l'errore si annullava;
  // con gli istanti assoluti no. Questa prova gira con TZ addosso.
  const prima = process.env.TZ;
  const risultati = [];
  for (const tz of ['UTC', 'Europe/Rome', 'America/New_York']) {
    process.env.TZ = tz;
    risultati.push(JSON.stringify(oraDaParete(Date.parse('2026-11-21T10:18:29Z'), 'Europe/Rome')));
  }
  process.env.TZ = prima;
  assert.equal(new Set(risultati).size, 1, `tre fusi, tre risultati: ${risultati.join(' | ')}`);
  assert.equal(JSON.parse(risultati[0]).ora, '11:18', 'le 10:18 UTC a Roma sono le 11:18');
});

test('l’ora legale non sposta gli orari di un’ora', () => {
  // Review Focus 2. Il 25/10/2026 l'Italia torna all'ora solare: quel giorno
  // ha 25 ore. Prima del cambio +02:00, dopo +01:00.
  assert.equal(oraDaParete(Date.parse('2026-10-25T00:30:00Z'), 'Europe/Rome').ora, '02:30');
  assert.equal(oraDaParete(Date.parse('2026-10-25T02:30:00Z'), 'Europe/Rome').ora, '03:30');
});

test('un tragitto che scavalca la mezzanotte resta leggibile', () => {
  // Review Focus 3. 23:50 -> 00:20: la data e’ quella della PARTENZA (come
  // nel file, dove la riga ha una data sola) e la durata e’ positiva.
  const [a] = comeIlFile([tragitto('2026-11-21T23:50:00+01:00', '2026-11-22T00:20:00+01:00')], 'Europe/Rome');
  assert.equal(a.date, '2026-11-21');
  assert.equal(a.start, '23:50');
  assert.equal(a.end, '00:20');
  assert.equal(a.duration_min, 30, 'la durata e’ venuta negativa o enorme');
});
```

- [ ] **Step 2: fai girare le prove e guardale fallire**

Run: `node --test test/carlock-traduzione.test.js`
Expected: FAIL, «does not provide an export named 'comeIlFile'»

- [ ] **Step 3: scrivi le tre funzioni in `src/lib/carlock-api.js`**

`oraDaParete` usa `Intl.DateTimeFormat` con `timeZone` e `hourCycle: 'h23'`:
è l'unico modo di non dipendere dal fuso del processo. Niente aritmetica a
mano sugli offset — l'ora legale la sbaglia.

`comeIlFile`: `km` = `distance / 1000` arrotondato a un decimale;
`duration_min` dalla differenza dei due istanti in millisecondi (**non** dagli
orari da parete: a cavallo della mezzanotte darebbe un numero negativo, e a
cavallo dell'ora legale uno sbagliato di sessanta minuti); `from`/`to` dagli
`address` dei due capi; `type` da `tag`.

`comePunti`: `t` è il `timestamp` così com'è — millisecondi, la stessa scala
che `leggiTracciati` produce leggendo le sue date. `id` è l'`uuid` del
tragitto, `da`/`a` sono `start_time`/`end_time`.

- [ ] **Step 4: fai girare le prove**

Run: `node --test test/carlock-traduzione.test.js`
Expected: PASS

- [ ] **Step 5: e con il fuso addosso, come gira in produzione**

Run: `TZ=UTC node --test "test/*.test.js"`
Expected: PASS — le stesse prove che passano a Roma

- [ ] **Step 6: commit**

```bash
git add src/lib/carlock-api.js test/carlock-traduzione.test.js
git commit -m "Il traduttore: i loro campi nelle forme che il programma ha gia', e l'orologio del veicolo"
```

---

### Task 3: la finestra da chiedere, e il segno di fin dove si e' guardato

**Files:**
- Create: `src/lib/carlock-finestra.js`
- Modify: `src/lib/db.js` (una colonna su `trips`)
- Test: `test/carlock-finestra.test.js` (nuovo)

**Interfaces:**
- Consumes: niente.
- Produces:
  - `export function mesiDiStorico(tier)` → `12` per `'STANDARD_PLUS'`, `3` altrimenti
  - `export function finestraDaChiedere(trip, tappe, { adesso, mesiStorico = 3 })`
    → `{ da, a }` in millisecondi, oppure `null`
  - `export function oltreLoStorico(trip, tappe, { adesso, mesiStorico })` → booleano

La colonna: `ALTER TABLE trips ADD COLUMN IF NOT EXISTS carlock_chiesto_fino_a TIMESTAMPTZ;`
**Attenzione**: nei commenti SQL di `db.js` non vanno apici inversi — sono
dentro un letterale di modello, e il 21/11/2026 hanno impedito al server di
partire.

- [ ] **Step 1: scrivi le prove che falliscono** in `test/carlock-finestra.test.js`

```js
const viaggio = (da, a, segno = null) => ({ start_date: da, end_date: a, carlock_chiesto_fino_a: segno });
const ora = s => Date.parse(s);

test('un viaggio tutto nel futuro non si chiede: non ci sono dati, e non si fa traffico', () => {
  assert.equal(finestraDaChiedere(viaggio('2027-07-04', '2027-07-15'), [],
    { adesso: ora('2026-11-24T12:00:00+01:00'), mesiStorico: 12 }), null);
});

test('al terzo giorno di dieci si chiede fino a ADESSO, non fino alla fine del viaggio', () => {
  const f = finestraDaChiedere(viaggio('2026-11-22', '2026-12-01'), [],
    { adesso: ora('2026-11-24T12:00:00+01:00'), mesiStorico: 12 });
  assert.equal(f.da, ora('2026-11-22T00:00:00+01:00'));
  assert.equal(f.a, ora('2026-11-24T12:00:00+01:00'));
});

test('col segno si riparte da dove si era arrivati, non da capo', () => {
  const f = finestraDaChiedere(viaggio('2026-11-22', '2026-12-01', '2026-11-23T18:00:00+01:00'),
    [], { adesso: ora('2026-11-24T12:00:00+01:00'), mesiStorico: 12 });
  assert.equal(f.da, ora('2026-11-23T18:00:00+01:00'));
});

test('quando il segno e’ arrivato alla fine, non c’e’ piu’ niente da chiedere', () => {
  assert.equal(finestraDaChiedere(viaggio('2026-11-01', '2026-11-05', '2026-11-06T00:00:00+01:00'),
    [], { adesso: ora('2026-11-24T12:00:00+01:00'), mesiStorico: 12 }), null);
});

test('senza le date del viaggio valgono il primo e l’ultimo giorno delle tappe', () => {
  const f = finestraDaChiedere(viaggio(null, null), [{ date: '2026-11-02' }, { date: '2026-11-01' }],
    { adesso: ora('2026-11-24T12:00:00+01:00'), mesiStorico: 12 });
  assert.equal(f.da, ora('2026-11-01T00:00:00+01:00'));
});

test('senza date e senza tappe datate non si chiede niente', () => {
  assert.equal(finestraDaChiedere(viaggio(null, null), [],
    { adesso: ora('2026-11-24T12:00:00+01:00'), mesiStorico: 12 }), null);
});

test('un viaggio oltre lo storico non si chiede, e si sa dirlo', () => {
  const v = viaggio('2024-06-01', '2024-06-10'), q = { adesso: ora('2026-11-24T12:00:00+01:00'), mesiStorico: 12 };
  assert.equal(finestraDaChiedere(v, [], q), null);
  assert.equal(oltreLoStorico(v, [], q), true,
    'non comparire e’ diverso da dire «non c’e’ piu’»');
});

test('un viaggio a cavallo del limite si chiede per la parte che c’e’ ancora', () => {
  const f = finestraDaChiedere(viaggio('2025-10-01', '2026-01-15'), [],
    { adesso: ora('2026-11-24T12:00:00+01:00'), mesiStorico: 12 });
  assert.equal(f.da, ora('2025-11-24T12:00:00+01:00'), 'il limite dello storico comanda sull’inizio');
});

test('il piano dice quanto storico c’e’', () => {
  assert.equal(mesiDiStorico('STANDARD_PLUS'), 12);
  assert.equal(mesiDiStorico('STANDARD'), 3);
  assert.equal(mesiDiStorico(null), 3, 'nel dubbio il meno: si chiede meno, non si inventa');
});
```

- [ ] **Step 2: fai girare le prove e guardale fallire**

Run: `node --test test/carlock-finestra.test.js`
Expected: FAIL, «does not provide an export named 'finestraDaChiedere'»

- [ ] **Step 3: scrivi `src/lib/carlock-finestra.js` e aggiungi la colonna**

`finestraDaChiedere` torna `null` quando la finestra è vuota o rovesciata. Le
mezzanotti sono quelle locali, come `periodoDelViaggio` in `tracciati.js`:
si riusa quella funzione per i capi del viaggio invece di riscriverla.

- [ ] **Step 4: fai girare le prove, e controlla che il server parta**

Run: `node --test test/carlock-finestra.test.js && node --check src/lib/db.js`
Expected: PASS, e nessun errore di sintassi

- [ ] **Step 5: tutta la suite, poi commit**

Run: `node --test "test/*.test.js"`
Expected: PASS

```bash
git add src/lib/carlock-finestra.js src/lib/db.js test/carlock-finestra.test.js
git commit -m "Fin dove si e' guardato: la finestra da chiedere, che non arriva mai a domani"
```

---

### Task 4: le due rotte — l'elenco, e il tocco che porta tappe e strade

**Files:**
- Modify: `src/routes/trips.js` (le due rotte nuove, accanto a `/trips/:id/tracciati`)
- Modify: `src/lib/carlock.js` (la geocodifica si salta quando le coordinate ci sono)
- Test: `test/carlock-rotte.test.js` (nuovo)

**Interfaces:**
- Consumes: `creaRubinetto`, `comeIlFile`, `comePunti` (att. 1 e 2);
  `finestraDaChiedere`, `mesiDiStorico`, `oltreLoStorico` (att. 3);
  `mergeTrips` da `src/lib/carlock.js`; `assegna`, `cuci` da `src/lib/tracciati.js`.
- Produces:
  - `GET  /api/trips/:id/carlock/tragitti` →
    `{ ok, tragitti: [...], totale, corti, doppioni, previste: [{id, nome, km}], oltre_lo_storico }`
  - `POST /api/trips/:id/carlock/tappe` con corpo `{ uuid: [], togli: [idTappa] }` →
    `{ ok, create, gia_presenti, senza_traccia, togliute, capi_lontani }`
  - **`carlock_mesi_storico`** dentro la risposta del viaggio
    (`GET /api/trips/:id`): è `mesiDiStorico(veicolo().subscription_tier)`, e
    serve al cartello per decidere **senza chiamare nessuno**. Senza rubinetto
    configurato, o se il veicolo non si è potuto leggere, vale `3`: nel dubbio
    si chiede meno, non si inventa.

- [ ] **Step 1: scrivi le prove che falliscono** in `test/carlock-rotte.test.js`

Le rotte si provano sul testo, come le altre di questo progetto — ma **le
regole che possono essere sbagliate al contrario stanno nelle funzioni pure
delle attività 1–3**, dove si provano sui valori. Qui si pretende che le rotte
le **chiamino**, e si guardano i vincoli che vivono solo qui.

```js
test('i numeri non li manda il browser: dal corpo si prendono solo gli uuid', () => {
  // Chilometri e orari diventano gasolio, pedaggi e totali del viaggio: una
  // pagina che li rimanda indietro e’ una pagina che li puo’ cambiare.
  const r = rotta('/trips/:id/carlock/tappe');
  assert.match(r, /req\.body\??\.?\.?uuid|body\.uuid/, 'non si leggono gli uuid scelti');
  for (const campo of ['body.km', 'body.distance', 'body.start', 'body.tragitti'])
    assert.doesNotMatch(r, new RegExp(campo.replace('.', '\\.')),
      `i ${campo} arrivano dal browser: li puo’ cambiare chi vuole`);
});

test('la rotta non tocca niente di quel che il tracker ha misurato sulle tappe vecchie', () => {
  const r = rotta('/trips/:id/carlock/tappe');
  for (const s of [...r.matchAll(/UPDATE legs SET[\s\S]*?WHERE/g)].map(m => m[0]))
    for (const colonna of ['distance_km', 'duration_min', 'start_time', 'end_time', 'from_lat', 'to_lat'])
      assert.doesNotMatch(s, new RegExp(colonna), `la rotta riscrive ${colonna}`);
});

test('la strada ricostruita non si calcola quando sta arrivando quella vera', () => {
  // Un tocco porta tappe e strade: calcolare la ricostruzione sarebbe lavoro
  // buttato, sostituito due secondi dopo. E `scarto_ricostruzione_km` resta
  // null, che e’ la verita’ piena: non c’e’ stata nessuna ricostruzione.
  const r = rotta('/trips/:id/carlock/tappe');
  const i = r.indexOf('percorsoVicinoAiKm');
  assert.ok(i < 0 || /senza_punti|niente_punti|!punti/.test(r.slice(Math.max(0, i - 300), i)),
    'si ricostruisce la strada anche quando i punti ci sono');
});

test('un tragitto senza punti diventa comunque una tappa, dichiarata ricostruita', () => {
  // Review Focus 5. Meglio una tappa con una strada dedotta, detta tale, che
  // nessuna tappa.
  const r = rotta('/trips/:id/carlock/tappe');
  assert.match(r, /senza_traccia/, 'il resoconto non dice quali tappe non hanno la traccia');
  assert.match(r, /catch/, 'un tragitto che inciampa porta giu’ tutto il tocco');
});

test('i doppioni li impedisce il database, e il resoconto li distingue dalle nuove', () => {
  // Review Focus 4.
  const r = rotta('/trips/:id/carlock/tappe');
  assert.match(r, /ON CONFLICT/, 'niente rete di sicurezza sul doppione');
  assert.match(r, /gia_presenti/, '«c’era gia’» e «creata» finiscono nello stesso conto');
});

test('l’elenco dice anche quali tappe previste sarebbero sostituite', () => {
  assert.match(rotta('/trips/:id/carlock/tragitti'), /previste/,
    'il riquadro non puo’ far vedere cosa toglierebbe');
});

test('le due rotte chiedono il periodo alla funzione che lo sa, e non a mano', () => {
  for (const via of ['/trips/:id/carlock/tragitti', '/trips/:id/carlock/tappe'])
    assert.match(rotta(via), /finestraDaChiedere\(/, `${via} si calcola il periodo da se’`);
});

test('le credenziali non finiscono nei registri', () => {
  const r = rotta('/trips/:id/carlock/tragitti') + rotta('/trips/:id/carlock/tappe');
  for (const m of r.matchAll(/console\.(log|warn|error)\(([^)]*)\)/g))
    assert.doesNotMatch(m[2], /CARLOCK_PASSWORD|password|gettone|token/i,
      `questo registro puo’ stampare un segreto: ${m[0].slice(0, 80)}`);
});

test('la geocodifica si salta quando le coordinate ci sono gia’', () => {
  // Il punto debole noto del file: il 422 «Indirizzo non riconosciuto», i
  // tentativi con 250 ms di pausa, gli accorgimenti per i nomi stranieri.
  // L'interfaccia da' le coordinate dei due capi: buttarle via per non
  // aggiungere due campi sarebbe un affare cattivo.
  const g = leggi('src/routes/trips.js');
  const i = g.indexOf('async function geo(');
  assert.ok(i > 0, 'la geocodifica non si trova piu’');
  assert.match(g.slice(i, i + 420), /lat/,
    'si geocodifica un indirizzo di cui si hanno gia’ le coordinate');
});
```

- [ ] **Step 2: fai girare le prove e guardale fallire**

Run: `node --test test/carlock-rotte.test.js`
Expected: FAIL, le rotte non esistono

- [ ] **Step 3: scrivi le due rotte in `src/routes/trips.js`**

Stanno accanto a `/trips/:id/tracciati`, dentro `router.use(requireAuth)` come
tutto il resto. Il rubinetto si crea una volta per modulo, da
`process.env.CARLOCK_EMAIL` / `CARLOCK_PASSWORD`, e se mancano le due rotte
rispondono **501** con «il rubinetto non è configurato»: un servizio non
acceso non è un guasto.

`GET /carlock/tragitti`: finestra dall'attività 3; se `null` e
`oltreLoStorico`, risponde `{ ok: true, oltre_lo_storico: true, tragitti: [] }`.
Altrimenti chiede, traduce con `comeIlFile`, passa per `mergeTrips(…, 30)`,
scarta i sotto i 3 km contandoli, marca i doppioni confrontando `external_id`
con quelli già sulle tappe del viaggio. `previste` sono le tappe senza
`external_id` del viaggio, col nome e i chilometri previsti.

`POST /carlock/tappe`: rilegge i tragitti del periodo e tiene **solo** gli
`uuid` chiesti. Per ciascuno: `puntiDelTragitto`, e se arrivano si usa `cuci`
per la geometria, con `tracciato_vero = true` e `scarto_ricostruzione_km = null`;
se non arrivano si ricostruisce come fa l'import da file e si conta in
`senza_traccia`. I capi vengono da `da_lat`/`da_lon`/`a_lat`/`a_lon` del
tragitto tradotto, col nome da `from`/`to` passati per `nomeTappa`. Le previste in
`togli` si cancellano come fa già il ramo `sostituisci` dell'import —
**prima** il gasolio stimato, poi le tappe, o la spesa resta orfana.

In `src/lib/carlock.js` / nella rotta: `geo()` torna subito
`{ name: nomeTappa(addr), lat, lon }` quando le coordinate sono già nel
tragitto, senza chiamare i geocodificatori.

- [ ] **Step 4: fai girare le prove**

Run: `node --test test/carlock-rotte.test.js`
Expected: PASS

- [ ] **Step 5: tutta la suite, poi commit**

Run: `node --test "test/*.test.js" && node --check src/routes/trips.js`
Expected: PASS

```bash
git add src/routes/trips.js src/lib/carlock.js test/carlock-rotte.test.js
git commit -m "Le due rotte del rubinetto: l'elenco, e il tocco che porta tappe e strade insieme"
```

---

### Task 5: il cartello che ritorna, e il riquadro che fa vedere cosa toglie

**Files:**
- Modify: `public/app.js` (la scheda Tappe, riga ~3572, e un riquadro nuovo)
- Test: `test/carlock-cartello.test.js` (nuovo)

**Interfaces:**
- Consumes: le due rotte dell'attività 4 e i loro campi.
- Produces: niente per altre attività.

- [ ] **Step 1: scrivi le prove che falliscono** in `test/carlock-cartello.test.js`

Le guardie si **estraggono dal sorgente e si eseguono** coi valori, come in
`test/tracciato-vero-si-ritira.test.js`: cercare una parola in una finestra di
caratteri passa anche su una condizione rovesciata, e qui ci siamo già
cascati.

```js
test('il cartello non compare su un viaggio tutto nel futuro', () => {
  const vale = guardia('cartelloCarlock');
  assert.equal(!!vale({ start_date: '2027-07-04', end_date: '2027-07-15' }, [], ora('2026-11-24'), 12), false);
});

test('il cartello compare su un viaggio in corso, e ritorna il giorno dopo', () => {
  const vale = guardia('cartelloCarlock');
  const v = { start_date: '2026-11-22', end_date: '2026-12-01' };
  assert.equal(!!vale(v, [], ora('2026-11-24'), 12), true);
  assert.equal(!!vale({ ...v, carlock_chiesto_fino_a: '2026-11-24T12:00:00+01:00' }, [], ora('2026-11-24T13:00:00+01:00'), 12),
    false, 'si e’ appena guardato: non si ripropone subito');
  assert.equal(!!vale({ ...v, carlock_chiesto_fino_a: '2026-11-24T12:00:00+01:00' }, [], ora('2026-11-25T09:00:00+01:00'), 12),
    true, 'il giorno dopo c’e’ roba nuova e il cartello deve tornare');
});

test('su un viaggio oltre lo storico il cartello non si limita a sparire', () => {
  // «Non c'e' piu'» e' un'informazione: non comparire la nasconde.
  const vale = guardia('cartelloCarlock');
  assert.equal(!!vale({ start_date: '2024-06-01', end_date: '2024-06-10' }, [], ora('2026-11-24'), 12), false);
  assert.match(fra('cartelloCarlock', 2200), /storico|troppo vecchi|non c\u2019\u00e8 pi\u00f9/i,
    'un viaggio vecchio sparisce in silenzio invece di dire perche\u2019');
});

test('il cartello non promette un numero che non conosce', () => {
  // Saperlo prima vorrebbe dire chiamare CarLock a ogni apertura di un
  // viaggio, cioe’ la strada che il proprietario ha scartato. Il cartello
  // dice che PUO’ guardare, non cosa ha trovato.
  const c = fra('cartelloCarlock', 1800);
  assert.doesNotMatch(c, /\$\{[^}]*tragitti[^}]*\.length/,
    'il cartello conta tragitti che non ha ancora chiesto');
});

test('il riquadro fa vedere quali previste toglierebbe, con la spunta messa', () => {
  const r = fra("$('#carlock-rubinetto')", 3000);
  assert.match(r, /previste/, 'non si vede cosa sparirebbe');
  assert.match(r, /checked/, 'la spunta non e’ messa: il tocco non sarebbe uno');
});

test('al server vanno solo gli uuid e le previste da togliere', () => {
  const r = fra("$('#carlock-rubinetto')", 3000);
  assert.match(r, /uuid/);
  assert.match(r, /togli/);
  assert.doesNotMatch(r, /km:/, 'la pagina rimanda indietro dei chilometri');
});

test('il resoconto arriva intero, ogni conto col suo perche’', () => {
  const r = fra("$('#carlock-rubinetto')", 3000);
  for (const campo of ['create', 'gia_presenti', 'senza_traccia', 'togliute'])
    assert.match(r, new RegExp(campo), `il resoconto non legge ${campo}`);
});

test('se CarLock non risponde si dice, e si indica il file', () => {
  const r = fra("$('#carlock-rubinetto')", 3000);
  assert.match(r, /file/i, 'un guasto di CarLock non indica la strada che funziona ancora');
});
```

- [ ] **Step 2: fai girare le prove e guardale fallire**

Run: `node --test test/carlock-cartello.test.js`
Expected: FAIL, la guardia non si trova

- [ ] **Step 3: scrivi la guardia, il cartello e il riquadro in `public/app.js`**

`cartelloCarlock(trip, legs, adesso, mesiStorico)` è la stessa regola dell'attività 3,
in pagina: dal segno (o dall'inizio) a `adesso`, mai oltre la fine del
viaggio, e dentro lo storico. `mesiStorico` è il `carlock_mesi_storico` che
arriva col viaggio (attività 4). La pagina ha già le date, il segno e quel
numero, quindi **non chiama nessuno** per decidere se comparire.

Il cartello va in cima alla scheda Tappe, sopra l'elenco, con il testo del
disegno: «📡 CarLock ha registrato i vostri spostamenti in questi giorni.
Guardo cosa c'è?» e un tasto `id="carlock-rubinetto"`.

Il riquadro dopo il tocco: l'elenco dei tragitti con le spunte (i sotto i 3 km
e i doppioni spenti e detti), poi «Al loro posto togliresti N tappe previste»
con le sue spunte già messe, e un tasto solo. Il tasto 📍 Tracciati e
📡 Importa CarLock del file **restano dove sono**.

- [ ] **Step 4: fai girare le prove**

Run: `node --test test/carlock-cartello.test.js`
Expected: PASS

- [ ] **Step 5: tutta la suite, in due fusi**

Run: `node --test "test/*.test.js" && TZ=UTC node --test "test/*.test.js"`
Expected: PASS tutte e due le volte

- [ ] **Step 6: provalo sulla pagina vera**

Avvia `camper-local` (porta 3999, vedi `.claude/launch.json`), entra col conto
di prova, apri un viaggio con le date nel periodo giusto e **guarda la
pagina**: il cartello c'è, il tocco porta l'elenco, accettando un tragitto
nasce una tappa con la riga **piena** (non puntinata) e senza «Ridisegna».

Il 24/11/2026 la prova dal vivo ha trovato due difetti che tutte le prove
scritte non vedevano. Non è un passaggio da saltare.

- [ ] **Step 7: commit**

```bash
git add public/app.js test/carlock-cartello.test.js
git commit -m "Il cartello che ritorna mentre il viaggio accade, e il tocco che fa vedere cosa toglie"
```
