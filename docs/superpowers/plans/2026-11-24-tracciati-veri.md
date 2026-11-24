# Tracciati veri da CarLock — piano di esecuzione (primo pezzo: il file)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** dentro un viaggio, caricare il file dei tracciati di CarLock e
sostituire la strada **ricostruita** di ogni sua tappa con quella **percorsa
davvero** — guardando solo i giorni di quel viaggio.

**Architecture:** tutto quel che decide qualcosa sta in `src/lib/tracciati.js`,
funzioni pure provate sui loro casi: leggere il CSV, tenere i tragitti dentro
il periodo, dire di quale tappa e' un tragitto, cucire le tracce di una tappa
unita. La rotta legge il file, applica, e scrive **solo** la geometria e due
segni nuovi. La pagina smette di disegnare puntinato.

**Tech Stack:** Node 20 ESM, Express con `multer` (gia' in uso per gli altri
import CarLock), PostgreSQL, prove con `node --test`.

**Spec:** `docs/superpowers/specs/2026-11-24-tracciati-veri-design.md`

## Global Constraints

- Le prove girano con `node --test "test/*.test.js"`; **non** esiste `npm test`
  nella radice.
- **Non si toccano `distance_km`, `duration_min`, `start_time`, `end_time`,
  `source`.** Sono le misure del tracker e la base del gasolio e dei totali.
- **Non si spostano i capi** (`from_lat`, `from_lon`, `to_lat`, `to_lon`): non
  esiste un segno di «corretto a mano» sulle tappe, quindi non si distingue un
  capo del geocoder da uno sistemato di persona.
- **Si guardano solo i giorni del viaggio.** Fuori da quelli, si lascia
  perdere.
- **Un tragitto che cade in due tappe, o in nessuna, non si attacca.** Meglio
  una tappa senza traccia che una traccia sulla tappa sbagliata.
- Lingua del codice, dei commenti e della pagina: italiano, nella voce che
  c'e' gia'.

## Review Focus

1. **Tappa senza orari** (`start_time` o `end_time` nulli, tipico delle tappe
   scritte a mano): non si puo' costruire la finestra, quindi non si aggancia
   niente e non si sbaglia. Prova nell'attivita' 2.
2. **Tragitto che scavalca la mezzanotte** (`trip_end` prima di `trip_start`
   come ora del giorno): la finestra deve reggere, o una tappa notturna perde
   la sua traccia. Prova nell'attivita' 2.
3. **Stesso file caricato due volte**: stesso risultato, nessun doppione, e il
   resoconto lo dice. Prova nell'attivita' 3.
4. **Riga del CSV malformata** (coordinata vuota, testo al posto di un
   numero): si salta quel punto, non si butta l'intero tragitto. Prova
   nell'attivita' 1.
5. **Tappa non in camper** (traghetto, aereo) con date che si sovrappongono:
   non si aggancia. Una rotta e un volo non seguono le statali, ed e' la
   stessa regola dei luoghi dichiarati. Prova nell'attivita' 2.

---

### Task 1: leggere il file dei tracciati

**Files:**
- Create: `src/lib/tracciati.js`
- Test: `test/tracciati-lettura.test.js` (nuovo)

**Interfaces:**
- Consumes: niente.
- Produces: `leggiTracciati(testo) -> [{ id, da, a, punti: [{ t, lat, lon }] }]`
  — un elemento per tragitto, `da`/`a` sono `trip_start`/`trip_end` come
  millisecondi, `punti` in ordine di tempo.

- [ ] **Step 1: scrivi le prove che falliscono** in `test/tracciati-lettura.test.js`

Intestazione vera del file, da usare nelle prove:

    trip,trip_start,trip_end,time,latitude,longitude,speed_kmh,heading_deg,altitude_m

```js
test('un tragitto diventa un elemento coi suoi punti', () => {
  const t = leggiTracciati(CSV_DUE_PUNTI);
  assert.equal(t.length, 1);
  assert.equal(t[0].punti.length, 2);
  assert.ok(Math.abs(t[0].punti[0].lat - 45.850968) < 1e-6);
});

test('tragitti diversi non si mescolano', () => {
  const t = leggiTracciati(CSV_DUE_TRAGITTI);
  assert.deepEqual(t.map(x => x.punti.length), [2, 3]);
});

test('i punti restano in ordine di tempo anche se il file non lo e’', () => {
  // Una riga fuori ordine disegnerebbe un dente nella strada.
  assert.deepEqual(leggiTracciati(CSV_FUORI_ORDINE)[0].punti.map(p => p.t),
    [...leggiTracciati(CSV_FUORI_ORDINE)[0].punti.map(p => p.t)].sort((a, b) => a - b));
});

test('una riga malformata si salta, il tragitto resta', () => {
  // Review Focus 4: buttare 740 punti buoni per una riga storta sarebbe
  // perdere la strada per un refuso.
  const t = leggiTracciati(CSV_CON_RIGA_ROTTA);
  assert.equal(t.length, 1);
  assert.equal(t[0].punti.length, 2);
});

test('un file vuoto o senza intestazione non fa cadere niente', () => {
  assert.deepEqual(leggiTracciati(''), []);
  assert.deepEqual(leggiTracciati('ciao'), []);
});
```

- [ ] **Step 2: guardale fallire**

Run: `node --test test/tracciati-lettura.test.js`
Expected: FAIL — `src/lib/tracciati.js` non esiste

- [ ] **Step 3: scrivi `leggiTracciati(testo)`** in `src/lib/tracciati.js`

Le colonne si trovano per **nome** nell'intestazione, non per posizione: e' la
stessa scelta gia' presa in `carlock.js`, e regge se un giorno ne aggiungono
una.

- [ ] **Step 4: guardale passare**

Run: `node --test test/tracciati-lettura.test.js`
Expected: PASS

- [ ] **Step 5: commit**

```bash
git add src/lib/tracciati.js test/tracciati-lettura.test.js \
        docs/superpowers/specs/2026-11-24-tracciati-veri-design.md \
        docs/superpowers/plans/2026-11-24-tracciati-veri.md
git commit -m "Leggere il file dei tracciati di CarLock"
```

---

### Task 2: di quale tappa e' un tragitto, e come si cuce

**Files:**
- Modify: `src/lib/tracciati.js`
- Test: `test/tracciati-aggancio.test.js` (nuovo)

**Interfaces:**
- Consumes: `leggiTracciati` (attivita' 1).
- Produces:
  - `finestraDellaTappa(tappa) -> { da, a } | null` — `null` quando la tappa
    non ha date o orari, o non e' in camper.
  - `tragittiDellaTappa(tragitti, tappa) -> [tragitto]` — quelli che le
    appartengono, in ordine di tempo.
  - `assegna(tragitti, tappe) -> { perTappa: Map<idTappa, [tragitto]>, fuori: [tragitto] }`
    — un tragitto che cade in due tappe finisce in `fuori`, non in `perTappa`.
  - `cuci(tragitti, { massimo = 600 }) -> [[lat, lon], ...]`

- [ ] **Step 1: scrivi le prove che falliscono** in `test/tracciati-aggancio.test.js`

```js
test('un tragitto dentro la finestra della tappa le appartiene', () => {
  const tappa = { id: 1, date: '2026-11-21', start_time: '11:18', end_time: '14:02', mezzo: 'camper' };
  assert.equal(tragittiDellaTappa([TRAGITTO_1118], tappa).length, 1);
});

test('una tappa unita si prende tutti i suoi tragitti, in ordine', () => {
  // Importando, i tragitti separati da una sosta breve diventano una tappa
  // sola; nei tracciati restano separati.
  const tappa = { id: 1, date: '2026-11-21', start_time: '09:00', end_time: '14:00', mezzo: 'camper' };
  const dentro = tragittiDellaTappa([TRAGITTO_1300, TRAGITTO_0930], tappa);
  assert.deepEqual(dentro.map(t => t.id), [2, 1], 'non sono in ordine di tempo');
});

test('una tappa senza orari non aggancia niente', () => {
  // Review Focus 1: senza finestra non c'e' modo di sbagliare con prudenza.
  assert.equal(finestraDellaTappa({ id: 1, date: '2026-11-21', mezzo: 'camper' }), null);
  assert.equal(tragittiDellaTappa([TRAGITTO_1118], { id: 1, date: '2026-11-21', mezzo: 'camper' }).length, 0);
});

test('una tappa che non e’ in camper non aggancia niente', () => {
  // Review Focus 5: un traghetto non segue le statali.
  assert.equal(finestraDellaTappa({ id: 1, date: '2026-11-21', start_time: '11:18', end_time: '14:02', mezzo: 'traghetto' }), null);
});

test('un tragitto che scavalca la mezzanotte non si perde', () => {
  // Review Focus 2: 23:40 -> 00:20 e' una tappa sola, non due.
  const tappa = { id: 1, date: '2026-11-20', start_time: '23:40', end_time: '00:20', mezzo: 'camper' };
  const f = finestraDellaTappa(tappa);
  assert.ok(f.a > f.da, 'la finestra si chiude prima di aprirsi');
  assert.equal(tragittiDellaTappa([TRAGITTO_2345], tappa).length, 1);
});

test('un tragitto che cade in due tappe non si attacca a nessuna', () => {
  const a = { id: 1, date: '2026-11-21', start_time: '11:00', end_time: '15:00', mezzo: 'camper' };
  const b = { id: 2, date: '2026-11-21', start_time: '11:10', end_time: '12:00', mezzo: 'camper' };
  const r = assegna([TRAGITTO_1118], [a, b]);
  assert.equal(r.perTappa.size, 0, 'ha scelto una tappa a caso fra due');
  assert.equal(r.fuori.length, 1);
});

test('un tragitto che non cade in nessuna tappa finisce fuori', () => {
  const r = assegna([TRAGITTO_1118], [{ id: 1, date: '2026-08-03', start_time: '08:46', end_time: '10:43', mezzo: 'camper' }]);
  assert.equal(r.fuori.length, 1);
});

test('la cucitura mette i buchi delle soste, non una riga continua', () => {
  // Erano spostamenti separati: una riga dritta sopra la sosta direbbe che si
  // e' guidato mentre si era fermi.
  const riga = cuci([TRAGITTO_A, TRAGITTO_B]);
  assert.equal(riga.length, TRAGITTO_A.punti.length + TRAGITTO_B.punti.length);
  assert.deepEqual(riga[0], [TRAGITTO_A.punti[0].lat, TRAGITTO_A.punti[0].lon]);
});

test('i punti si campionano, ma i capi restano', () => {
  const tanti = { id: 1, punti: Array.from({ length: 2000 }, (_, i) => ({ t: i, lat: 45 + i / 1e5, lon: 12 })) };
  const riga = cuci([tanti], { massimo: 600 });
  assert.ok(riga.length <= 601, `ne ha tenuti ${riga.length}`);
  assert.deepEqual(riga[riga.length - 1], [45 + 1999 / 1e5, 12]);
});
```

- [ ] **Step 2: guardale fallire**

Run: `node --test test/tracciati-aggancio.test.js`
Expected: FAIL — `finestraDellaTappa` non esiste

- [ ] **Step 3: scrivi le quattro funzioni** in `src/lib/tracciati.js`

La finestra ha una **tolleranza di 3 minuti** per lato: i due orologi vengono
dalla stessa fonte e dovrebbero combaciare al minuto, ma gli orari del
riassunto sono troncati. Per la mezzanotte: se l'ora di fine e' prima di
quella di inizio, la fine sta nel giorno dopo.

Il campionamento riusa `samplePoints` da `src/lib/util.js`, che gia' tiene
l'ultimo punto.

- [ ] **Step 4: guardale passare, e tutta la suite**

Run: `node --test test/tracciati-aggancio.test.js && node --test "test/*.test.js"`
Expected: PASS, 0 fail

- [ ] **Step 5: commit**

```bash
git add src/lib/tracciati.js test/tracciati-aggancio.test.js
git commit -m "Di quale tappa e' un tragitto, e come si cuciono le tappe unite"
```

---

### Task 3: la rotta che applica, e quanto sbagliava la ricostruzione

**Files:**
- Modify: `src/lib/db.js` (accanto a `ALTER TABLE legs ADD COLUMN IF NOT EXISTS pedaggi_dichiarati TEXT;`)
- Modify: `src/lib/tracciati.js`
- Modify: `src/routes/trips.js` (accanto a `router.post('/trips/:id/import/carlock'`)
- Test: `test/tracciati-rotta.test.js` (nuovo)

**Interfaces:**
- Consumes: `leggiTracciati`, `assegna`, `cuci` (attivita' 1 e 2).
- Produces:
  - `quantoSbagliava(vecchia, vera) -> km | null` — quanto si allontanava la
    riga ricostruita da quella vera: per ogni punto della vecchia, la distanza
    dal punto piu' vicino della vera; si tiene **la maggiore**. `null` se una
    delle due manca.
  - `POST /trips/:id/tracciati` (file in `multipart`, campo `file`) ->
    `{ ok, attaccati, gia_veri, senza_traccia, fuori_periodo, non_agganciati,
       capi_lontani: [{ tappa, metri }] }` — `capi_lontani` elenca le tappe in
    cui la traccia comincia o finisce a piu' di **200 m** dal capo salvato: i
    capi non si spostano, ma la distanza si dice.
  - due colonne nuove su `legs`: `tracciato_vero BOOLEAN NOT NULL DEFAULT false`
    e `scarto_ricostruzione_km REAL`.

- [ ] **Step 1: scrivi le prove che falliscono** in `test/tracciati-rotta.test.js`

```js
test('la misura dello scarto trova il punto piu’ lontano', () => {
  // Il caso vero del 21/11: la ricostruzione passava per Bassano, a 15,6 km
  // dalla strada percorsa.
  const vera = [[46.0, 11.5], [45.9, 12.0], [45.9, 12.2]];
  const vecchia = [[46.0, 11.5], [45.767, 11.735], [45.9, 12.2]];
  const km = quantoSbagliava(vecchia, vera);
  assert.ok(km > 10 && km < 25, `scarto misurato: ${km}`);
});

test('due righe uguali non sbagliano di niente', () => {
  const r = [[46, 11], [46, 12]];
  assert.ok(quantoSbagliava(r, r) < 0.001);
});

test('senza una delle due righe non si misura niente', () => {
  assert.equal(quantoSbagliava(null, [[46, 11]]), null);
  assert.equal(quantoSbagliava([[46, 11]], []), null);
});
```

Prove sul **cablaggio**, lette dal sorgente come fanno gia' `via-vincola` e
`carlock-km-veri`: e' li' che sono stati i difetti delle volte precedenti.

```js
test('si guardano solo i giorni del viaggio', () => {
  const r = fra(rotta, "router.post('/trips/:id/tracciati'", 2600);
  assert.match(r, /start_date|date/,
    'la rotta non delimita il periodo: un tragitto di agosto puo’ finire su una tappa di novembre');
});

test('la rotta scrive la geometria e i due segni, nient’altro', () => {
  // L'anti obiettivo. Km, durata, orari e capi sono misure o decisioni sue.
  const r = fra(rotta, "router.post('/trips/:id/tracciati'", 2600);
  const update = r.match(/UPDATE legs SET[^`']*/)[0];
  for (const colonna of ['distance_km', 'duration_min', 'start_time', 'end_time',
                         'source', 'from_lat', 'from_lon', 'to_lat', 'to_lon'])
    assert.doesNotMatch(update, new RegExp(colonna), `la rotta riscrive ${colonna}`);
});

test('se la traccia comincia lontano dal capo salvato, lo si dice', () => {
  // Il disegno lo promette: i capi non si spostano -- non c'e' modo di sapere
  // quali hai sistemato tu -- ma se la traccia parte a quattrocento metri da
  // dove la tappa dice di partire, quello e' un fatto che meriti di sapere.
  const r = fra(rotta, "router.post('/trips/:id/tracciati'", 2600);
  assert.match(r, /capi_lontani|capo_lontano/,
    'la distanza fra la traccia e il capo salvato non si misura');
});

test('caricare due volte lo stesso file non fa doppioni', () => {
  // Review Focus 3. La geometria si riscrive uguale, e il resoconto lo dice.
  const r = fra(rotta, "router.post('/trips/:id/tracciati'", 2600);
  assert.match(r, /gia_veri/, 'la rotta non distingue una tappa gia’ vera');
});
```

- [ ] **Step 2: guardale fallire**

Run: `node --test test/tracciati-rotta.test.js`
Expected: FAIL — `quantoSbagliava` non esiste

- [ ] **Step 3: le due colonne** in `src/lib/db.js`

`tracciato_vero` dice che la riga **non e' piu' dedotta**: e' il segno che
spegne il puntinato. `scarto_ricostruzione_km` conserva quanto sbagliava
prima — si ottiene gratis mentre si sostituisce, e dopo un centinaio di tappe
dice quanto vale il ricostruttore.

- [ ] **Step 4: `quantoSbagliava(vecchia, vera)`** in `src/lib/tracciati.js`, con `haversineKm` da `src/lib/util.js`

- [ ] **Step 5: la rotta** `POST /trips/:id/tracciati` in `src/routes/trips.js`

Prende le tappe del viaggio, costruisce il periodo dalle date del viaggio (o
dal primo e ultimo giorno delle tappe se mancano), scarta i tragitti fuori,
chiama `assegna`, e per ogni tappa agganciata scrive geometria, segno e
scarto. Risponde col resoconto.

- [ ] **Step 6: guardale passare, e tutta la suite**

Run: `node --test test/tracciati-rotta.test.js && node --test "test/*.test.js"`
Expected: PASS, 0 fail

- [ ] **Step 7: commit**

```bash
git add src/lib/db.js src/lib/tracciati.js src/routes/trips.js test/tracciati-rotta.test.js
git commit -m "La rotta che attacca i tracciati veri alle tappe del viaggio"
```

---

### Task 4: il tasto, e la riga che smette di dire «ricostruita»

**Files:**
- Modify: `public/app.js` — la scheda «Tappe» (`:3527`), `stradaDedotta`
  (`:4764` circa), la frase della riga della tappa
- Test: `test/tracciati-pagina.test.js` (nuovo)

**Interfaces:**
- Consumes: `POST /trips/:id/tracciati` e il suo resoconto (attivita' 3), e il
  campo `tracciato_vero` sulle tappe.
- Produces: niente per altre attivita'.

- [ ] **Step 1: scrivi le prove che falliscono** in `test/tracciati-pagina.test.js`

```js
test('nella scheda Tappe c’e’ il tasto dei tracciati', () => {
  const t = fra(app, '<h2>Tappe</h2>', 1400);
  assert.match(t, /id="tracciati"/, 'non c’e’ modo di caricare i tracciati veri');
});

test('il riquadro dice che guarda solo i giorni del viaggio', () => {
  const d = fra(app, 'id="tracciati"', 3000);
  assert.match(d, /giorni di questo viaggio|periodo di questo viaggio/i,
    'non si capisce che il resto del file viene ignorato');
});

test('una tappa col tracciato vero non si disegna piu’ puntinata', () => {
  const i = app.indexOf('const stradaDedotta');
  assert.ok(i > 0, 'la regola del puntinato non si trova piu’');
  assert.match(app.slice(i, i + 300), /tracciato_vero/,
    'il puntinato resta su una strada che non e’ piu’ dedotta');
});

test('la riga della tappa dice che la strada e’ vera', () => {
  const i = app.indexOf('come hai detto tu`');
  const riga = app.slice(i - 1800, i + 400);
  assert.match(riga, /tracciato_vero/, 'la riga racconta ancora una ricostruzione');
  assert.match(riga, /strada ver[ao]|percorsa davvero/i);
});

test('il resoconto si legge, compreso quel che e’ rimasto fuori', () => {
  const d = fra(app, 'id="tracciati"', 3000);
  for (const campo of ['attaccati', 'senza_traccia'])
    assert.match(d, new RegExp(campo), `il resoconto non legge ${campo}`);
});
```

- [ ] **Step 2: guardale fallire**

Run: `node --test test/tracciati-pagina.test.js`
Expected: FAIL — nessun tasto `tracciati`

- [ ] **Step 3: il tasto e il riquadro** nella scheda «Tappe»

Il riquadro spiega in una riga da dove viene il file (email a CarLock) e che
si guardano **solo i giorni di questo viaggio**.

- [ ] **Step 4: `stradaDedotta` e la frase della riga**

Una tappa con `tracciato_vero` non e' piu' dedotta: riga piena, e la frase
diventa «Chilometri, orari e **strada** veri dal tracker». I luoghi dichiarati
restano scritti.

**E la frase dei luoghi fuori dalla riga cambia senso.** Oggi dice «il
ridisegno non e' riuscito, riprova da Modifica», che su una traccia vera e'
falso: non c'e' niente da ridisegnare. Su una tappa col tracciato vero diventa
«la strada percorsa non passa per X» -- cioe' la traccia smentisce quel che era
stato dichiarato, ed e' un fatto, non un guasto.

```js
test('su una traccia vera, un luogo non toccato non e’ un ridisegno fallito', () => {
  const i = app.indexOf('non passa ancora per');
  assert.ok(i > 0, 'la frase dei luoghi fuori dalla riga non si trova piu’');
  const intorno = app.slice(i - 400, i + 500);
  assert.match(intorno, /tracciato_vero/,
    'con la traccia vera si continua a dire che il ridisegno non e’ riuscito');
});
```

- [ ] **Step 5: guardale passare, e tutta la suite**

Run: `node --test test/tracciati-pagina.test.js && node --test "test/*.test.js"`
Expected: PASS, 0 fail

- [ ] **Step 6: provalo davvero nel browser**

Col database di prova: riavvia il server locale (l'impronta si calcola
all'avvio), carica il file vero dei tracciati su un viaggio, e guarda che la
riga della tappa diventi piena e il resoconto torni.

- [ ] **Step 7: commit**

```bash
git add public/app.js test/tracciati-pagina.test.js
git commit -m "Il tasto dei tracciati, e la strada che smette di essere dedotta"
```
