# Pedaggi dichiarati — piano di esecuzione

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** su una tappa importata da CarLock si dichiara se si e' fatta
l'autostrada (si' / no / non lo so), la dichiarazione **entra nella richiesta**
al servizio dei percorsi, e il disegno piu' i chilometri a pedaggio ne seguono
— senza toccare niente di quel che il tracker ha misurato.

**Architecture:** la dichiarazione vive sulla tappa (`legs.pedaggi_dichiarati`)
come i luoghi dichiarati (`legs.via`), e viene letta nell'**unico** punto dove
una tappa incontra il calcolo della strada (`stradaDellaTappa`), cosi' ogni
rotta che ridisegna la rispetta. Dentro `geo.js` scende come opzione fino alla
richiesta a OpenRouteService. Le regole che non hanno bisogno della rete —
quando una dichiarazione vale e quando quel che e' tornato la contraddice —
stanno in `tappe.js`, pure e provate da sole.

**Tech Stack:** Node 20 ESM, Express, PostgreSQL (`pg`), prove con
`node --test`, pagina in JavaScript senza impalcature.

**Spec:** `docs/superpowers/specs/2026-11-22-pedaggi-dichiarati-design.md`

## Global Constraints

- Le prove girano con `node --test "test/*.test.js"`; **non** esiste `npm test`.
- Tre stati, non due: `'si'`, `'no'`, e **vuoto = non lo so**. Vuoto deve
  restare distinguibile da `'no'`.
- Il ridisegno scrive **solo** `geometry` e `pedaggio_km`. Chilometri, durata,
  orari e `source` di CarLock non si toccano mai.
- `'si'` si racconta come «prendo la piu' rapida, che e' quella che usa
  l'autostrada» — mai come «ho chiesto l'autostrada»: nessun servizio ha un
  «preferisci i pedaggi».
- `senza_pedaggio` (la stima spenta a mano) e un importo di pedaggio scritto a
  mano non si riaccendono e non si cancellano per effetto di una dichiarazione.
- Niente chiamate ai servizi di percorsi o ai geocoder dalle prove: le
  dipendenze si iniettano.
- Lingua del programma e dei commenti: italiano, nella voce che c'e' già.

## Review Focus

1. **`pedaggio_km` sconosciuto** (`null`, come quando risponde OSRM e non ORS):
   dichiarato `'no'` o `'si'`, il controllo **non deve** parlare di
   contraddizione — `—` vuol dire «non so», non «zero». Prova nell'attivita' 1.
2. **Tappa non in camper** con una dichiarazione salvata: si ignora come i
   luoghi, e **resta salvata** per quando il mezzo torna quello di prima.
   Prova nell'attivita' 1.
3. **Valore sporco nel corpo della richiesta** (`'SI'`, `'forse'`, `1`, `''`):
   si normalizza a `'si'`/`'no'`/`null`, e una stringa che non si riconosce
   **non** diventa `'no'`. Prova nell'attivita' 1.
4. **ORS rifiuta la strada senza pedaggi** dopo un `'no'`: non si disegna la
   piu' rapida in silenzio. Prova nell'attivita' 2.
5. **Importo di pedaggio scritto a mano** su una tappa che poi dichiara
   `'no'`: l'importo resta. Prova nell'attivita' 3.

---

### Task 1: la dichiarazione e le sue regole

**Files:**
- Modify: `src/lib/db.js` (accanto a `ALTER TABLE legs ADD COLUMN IF NOT EXISTS via JSONB;`)
- Modify: `src/lib/tappe.js` (dopo `puntiDaUsare`)
- Test: `test/pedaggi-dichiarati.test.js` (nuovo)

**Interfaces:**
- Consumes: `puntiDaUsare(tappa)` da `src/lib/tappe.js`, come modello: stesso
  filtro sul mezzo, stesso trattamento del mezzo mancante.
- Produces:
  - `pedaggiDaUsare(tappa) -> 'si' | 'no' | null` — la dichiarazione da
    applicare: `null` se la tappa non e' in camper o non ha dichiarato niente.
  - `pedaggiDichiarati(valore) -> 'si' | 'no' | null` — normalizza quel che
    arriva dal corpo della richiesta.
  - `pedaggiNonTornano(dichiarato, pedaggioKm, { sannoEvitare }) -> null | 'non_chiedibile' | 'ne_fa_comunque' | 'non_ne_fa'`

- [ ] **Step 1: scrivi le prove che falliscono** in `test/pedaggi-dichiarati.test.js`

```js
test('una tappa in camper usa la dichiarazione che ha', () => {
  assert.equal(pedaggiDaUsare({ mezzo: 'camper', pedaggi_dichiarati: 'no' }), 'no');
  assert.equal(pedaggiDaUsare({ pedaggi_dichiarati: 'si' }), 'si');   // mezzo mancante = camper
  assert.equal(pedaggiDaUsare({ mezzo: 'camper' }), null);
  assert.equal(pedaggiDaUsare(null), null);
});

test('su una tappa che non e’ in camper la dichiarazione si IGNORA', () => {
  assert.equal(pedaggiDaUsare({ mezzo: 'traghetto', pedaggi_dichiarati: 'no' }), null);
});

test('quel che arriva dal corpo si normalizza, e cio’ che non si capisce resta vuoto', () => {
  assert.equal(pedaggiDichiarati('si'), 'si');
  assert.equal(pedaggiDichiarati('SI'), 'si');
  assert.equal(pedaggiDichiarati(' no '), 'no');
  assert.equal(pedaggiDichiarati('forse'), null);
  assert.equal(pedaggiDichiarati(1), null);
  assert.equal(pedaggiDichiarati(''), null);
  assert.equal(pedaggiDichiarati(undefined), null);
});

test('dichiarato «no» e la strada fa pedaggi: lo si dice', () => {
  assert.equal(pedaggiNonTornano('no', 12), 'ne_fa_comunque');
  assert.equal(pedaggiNonTornano('no', 0), null);
});

test('dichiarato «si» e la strada non ne fa nemmeno uno: lo si dice', () => {
  assert.equal(pedaggiNonTornano('si', 0), 'non_ne_fa');
  assert.equal(pedaggiNonTornano('si', 54), null);
});

test('pedaggi sconosciuti non contraddicono niente', () => {
  // `—` vuol dire «non so»; `0` vuol dire «uno zero che conosco». Una strada
  // che non dice niente sui pedaggi non sta dicendo che non ce ne sono.
  assert.equal(pedaggiNonTornano('no', null), null);
  assert.equal(pedaggiNonTornano('si', undefined), null);
});

test('senza la chiave del servizio un «no» non si puo’ nemmeno chiedere', () => {
  assert.equal(pedaggiNonTornano('no', 0, { sannoEvitare: false }), 'non_chiedibile');
  assert.equal(pedaggiNonTornano('si', 54, { sannoEvitare: false }), null);
});

test('senza dichiarazione non c’e’ niente da contraddire', () => {
  assert.equal(pedaggiNonTornano(null, 54), null);
});
```

- [ ] **Step 2: guardale fallire**

Run: `node --test test/pedaggi-dichiarati.test.js`
Expected: FAIL — `pedaggiDaUsare` non esiste in `src/lib/tappe.js`

- [ ] **Step 3: la colonna**

In `src/lib/db.js`, accanto a quella di `via`, aggiungi
`ALTER TABLE legs ADD COLUMN IF NOT EXISTS pedaggi_dichiarati TEXT;` con il
commento che dice i tre stati e perche' il nome e' lungo (accanto vivono
`pedaggio_km`, che e' una misura, e `senza_pedaggio`, che e' uno spegnimento
della stima). Nessun vincolo in banca dati: la normalizzazione sta nella rotta,
ed e' li' che gira la prova.

- [ ] **Step 4: le tre funzioni** in `src/lib/tappe.js`, dopo `puntiDaUsare`

Con i commenti che spiegano i tre stati e perche' «non so» non puo' collassare
su «no»: una tappa vecchia dichiarerebbe da sola una cosa che nessuno ha detto.

- [ ] **Step 5: guardale passare**

Run: `node --test test/pedaggi-dichiarati.test.js`
Expected: PASS

- [ ] **Step 6: tutta la suite**

Run: `node --test "test/*.test.js"`
Expected: 0 fail

- [ ] **Step 7: commit**

```bash
git add src/lib/db.js src/lib/tappe.js test/pedaggi-dichiarati.test.js \
        docs/superpowers/specs/2026-11-22-pedaggi-dichiarati-design.md \
        docs/superpowers/plans/2026-11-22-pedaggi-dichiarati.md
git commit -m "La tappa si ricorda se l'autostrada l'hai fatta, o se non lo sai"
```

---

### Task 2: la dichiarazione entra nella richiesta

**Files:**
- Modify: `src/lib/geo.js:152` (`variantiTratto`), `:215` (`percorsoPerIPunti`),
  `:233` (`percorsoVicinoAiKm`), `:239` (`percorsiConTappe`)
- Test: `test/pedaggi-percorso.test.js` (nuovo)

**Interfaces:**
- Consumes: niente dall'attivita' 1 (le funzioni pure stanno a valle, nella rotta).
- Produces:
  - `variantiTratto(from, to, { pedaggi, ors = percorsoOrs, veloce = route } = {})`
    — `pedaggi: 'no'` chiede **una sola** strada, con `['tollways']` da evitare;
    `'si'` chiede **una sola** strada, la piu' rapida; vuoto si comporta
    esattamente come oggi (due candidate quando differiscono).
  - `percorsiConTappe(punti, { pedaggi, varianti = variantiTratto } = {})`
  - `percorsoPerIPunti(from, punti, to, kmVeri, minutiVeri, { percorsi = percorsiConTappe, pedaggi } = {})`
  - `percorsoVicinoAiKm(from, to, kmVeri, minutiVeri, { pedaggi } = {})`

- [ ] **Step 1: scrivi le prove che falliscono** in `test/pedaggi-percorso.test.js`

```js
// I finti: `ors` segna cosa le e' stato chiesto di evitare.
const finti = () => {
  const chiesto = [];
  const ors = async (from, to, evitare = []) => {
    chiesto.push(evitare);
    return { distance_km: evitare.length ? 230 : 190, duration_min: evitare.length ? 200 : 120,
             pedaggio_km: evitare.length ? 0 : 54, geometry: [[46, 11], [46, 13]] };
  };
  const veloce = async () => { throw new Error('non si deve passare da OSRM'); };
  return { chiesto, ors, veloce };
};

test('dichiarato «no», si chiede la strada che evita i pedaggi — una sola volta', async () => {
  const { chiesto, ors, veloce } = finti();
  const v = await variantiTratto(NOVALEDO, UDINE, { pedaggi: 'no', ors, veloce });
  assert.deepEqual(chiesto, [['tollways']], 'ha chiesto anche la strada che non serviva');
  assert.equal(v.length, 1);
  assert.equal(v[0].evita_pedaggi, true);
});

test('dichiarato «si», si chiede la piu’ rapida e basta', async () => {
  const { chiesto, ors, veloce } = finti();
  const v = await variantiTratto(NOVALEDO, UDINE, { pedaggi: 'si', ors, veloce });
  assert.deepEqual(chiesto, [[]]);
  assert.equal(v.length, 1);
  assert.ok(!v[0].evita_pedaggi);
});

test('senza dichiarazione si comporta come prima: due candidate', async () => {
  const { chiesto, ors, veloce } = finti();
  const v = await variantiTratto(NOVALEDO, UDINE, { ors, veloce });
  assert.equal(chiesto.length, 2, 'non chiede piu’ le due strade da confrontare');
  assert.equal(v.length, 2);
});

test('se la strada senza pedaggi non si ottiene, non si disegna l’autostrada al suo posto', async () => {
  // Review Focus 4. Dopo un «no», tornare la piu' rapida in silenzio e' la
  // direzione rassicurante dell'errore: questo lavoro esiste per chiuderla.
  const ors = async (f, t, evitare = []) => {
    if (evitare.length) throw new Error('rifiutato');
    return { distance_km: 190, duration_min: 120, pedaggio_km: 54, geometry: [] };
  };
  await assert.rejects(
    () => variantiTratto(NOVALEDO, UDINE, { pedaggi: 'no', ors, veloce: async () => { throw new Error('nemmeno OSRM'); } }));
});

test('la dichiarazione arriva fino alle tratte di un percorso con punti', async () => {
  const visti = [];
  const varianti = async (from, to, opz = {}) => {
    visti.push(opz.pedaggi);
    return [{ chiave: 'senza_pedaggi', nome: 'Senza pedaggi', evita_pedaggi: true,
              distance_km: 100, duration_min: 90, pedaggio_km: 0, geometry: [[46, 11], [46, 12]] }];
  };
  const r = await percorsiConTappe([NOVALEDO, VIDOR, UDINE], { pedaggi: 'no', varianti });
  assert.deepEqual(visti, ['no', 'no'], 'un pezzo di strada e’ stato calcolato senza la dichiarazione');
  // La chiave con cui si rimettono insieme le tratte **non** e' piu' 'rapido':
  // con quella, `t.find(...) || t[0]` ripesca la strada giusta ma la chiama
  // «Il piu' rapido», cioe' disegna bene e racconta male.
  assert.equal(r.length, 1, 'dichiarato «no» resta una candidata sola');
  assert.equal(r[0].chiave, 'senza_pedaggi');
  assert.equal(r[0].evita_pedaggi, true);
  assert.equal(r[0].pedaggio_km, 0, 'uno zero che si conosce, non un campo vuoto');
});

test('percorsoPerIPunti passa la dichiarazione a chi calcola', async () => {
  let vista;
  const percorsi = async (punti, opz = {}) => { vista = opz.pedaggi; return [UNA_VARIANTE_CON_TRATTE]; };
  await percorsoPerIPunti(NOVALEDO, [VIDOR], UDINE, 187, 142, { percorsi, pedaggi: 'no' });
  assert.equal(vista, 'no');
});
```

- [ ] **Step 2: guardale fallire**

Run: `node --test test/pedaggi-percorso.test.js`
Expected: FAIL — `variantiTratto` ignora `pedaggi` e chiede sempre due strade

- [ ] **Step 3: fai scendere l'opzione** attraverso le quattro funzioni di `src/lib/geo.js`

Il commento sopra `variantiTratto` dice perche' la dichiarazione **entra nella
richiesta** invece di filtrare il risultato: la variante senza pedaggi compare
nell'elenco solo se differisce dalla piu' rapida, quindi «nessuna candidata
senza pedaggi» vorrebbe dire due cose opposte — *non esiste* oppure *e' la
stessa*. Con `pedaggi` dichiarato la candidata unica porta
`scelta_per_km: false`: non c'e' stato niente da confrontare.

- [ ] **Step 4: guardale passare**

Run: `node --test test/pedaggi-percorso.test.js`
Expected: PASS

- [ ] **Step 5: niente si e' rotto in fase di pianificazione**

Run: `node --test "test/*.test.js"`
Expected: 0 fail — in particolare `via-percorso.test.js` e `mappa-tratti.test.js`,
che usano `percorsiConTappe` e `percorsoPerIPunti` **senza** l'opzione nuova.

- [ ] **Step 6: commit**

```bash
git add src/lib/geo.js test/pedaggi-percorso.test.js
git commit -m "La strada senza pedaggi si chiede, invece di cercarla fra quelle calcolate"
```

---

### Task 3: la tappa la rispetta, e i costi seguono

**Files:**
- Modify: `src/routes/trips.js:853` (`stradaDellaTappa`), `:872` (`POST /legs/:id/via`)
- Test: `test/pedaggi-tappa.test.js` (nuovo)

**Interfaces:**
- Consumes: `pedaggiDaUsare`, `pedaggiDichiarati`, `pedaggiNonTornano` (attivita' 1);
  `{ pedaggi }` su `percorsoPerIPunti` / `percorsoVicinoAiKm` (attivita' 2);
  `sannoEvitareIPedaggi()`, già importata in `src/routes/trips.js:6`.
- Produces: `POST /legs/:id/via` accetta `pedaggi` nel corpo e risponde anche
  con `pedaggi` (quel che e' stato salvato) e `pedaggi_avviso`
  (`null | 'non_chiedibile' | 'ne_fa_comunque' | 'non_ne_fa'`) piu'
  `pedaggio_km` della strada disegnata.

- [ ] **Step 1: scrivi le prove che falliscono** in `test/pedaggi-tappa.test.js`

Prove sul **cablaggio**, lette dal sorgente come fanno già
`via-vincola.test.js` e `carlock-km-veri.test.js` — e' li' che stavano i
difetti delle volte precedenti:

```js
test('la strada di una tappa passa dalla dichiarazione, in un posto solo', () => {
  const f = fra(rotta, 'async function stradaDellaTappa', 600);
  assert.match(f, /pedaggiDaUsare\(l\)/, 'stradaDellaTappa non guarda la dichiarazione');
});

test('nessuna rotta calcola una strada scavalcando stradaDellaTappa', () => {
  // Il 21/11/2026 le rotte che ridisegnavano erano quattro, non tre, e quella
  // dimenticata era la piu' battuta. La dichiarazione vive in un posto solo
  // perche' quattro copie si dimenticano una alla volta.
  const quante = (rotta.match(/percorsoVicinoAiKm\(|percorsoPerIPunti\(/g) || []).length;
  assert.equal(quante, 2, 'qualcuno calcola la strada senza passare da stradaDellaTappa');
});

test('«Ridisegna» salva la dichiarazione, normalizzata', () => {
  const r = fra(rotta, "router.post('/legs/:id/via'", 2600);
  assert.match(r, /pedaggiDichiarati\(/, 'il valore del corpo si scrive senza normalizzarlo');
  assert.match(r, /pedaggi_dichiarati\s*=/, 'la dichiarazione non si salva sulla tappa');
});

test('il ridisegno scrive la geometria e i km di autostrada, nient’altro', () => {
  // L'anti obiettivo: km, durata e orari sono misure del tracker.
  const r = fra(rotta, "router.post('/legs/:id/via'", 2600);
  const update = r.match(/UPDATE legs SET geometry[^`']*/)[0];
  for (const colonna of ['distance_km', 'duration_min', 'start_time', 'end_time', 'source', 'senza_pedaggio'])
    assert.doesNotMatch(update, new RegExp(colonna), `il ridisegno riscrive ${colonna}`);
});

test('quel che esce si confronta con quel che e’ stato dichiarato', () => {
  const r = fra(rotta, "router.post('/legs/:id/via'", 2600);
  assert.match(r, /pedaggiNonTornano\(/);
  assert.match(r, /sannoEvitareIPedaggi\(\)/, 'senza la chiave un «no» verrebbe dato per onorato');
});

test('i costi si rifanno dopo il ridisegno, zero compreso', () => {
  // Review Focus 5: `syncTollExpense` cancella la stima quando i km sono zero
  // e **lascia stare** un importo scritto a mano (`edited`). Il totale del
  // viaggio somma le spese, quindi segue da se' -- e questa prova e' il
  // motivo per cui «segue da se'» resta vero.
  const r = fra(rotta, "router.post('/legs/:id/via'", 2600);
  assert.match(r, /costiTappa\(/, 'il pedaggio della tappa non si rifa’ dopo il ridisegno');
  const toll = fra(rotta, 'export async function syncTollExpense', 1200);
  assert.match(toll, /!\(km > 0\)/, 'zero km di autostrada non azzerano piu’ la stima');
  assert.match(toll, /ex && !ex\.edited/, 'un importo scritto a mano verrebbe cancellato');
});
```

- [ ] **Step 2: guardale fallire**

Run: `node --test test/pedaggi-tappa.test.js`
Expected: FAIL — `stradaDellaTappa` non nomina `pedaggiDaUsare`

- [ ] **Step 3: leggi la dichiarazione in `stradaDellaTappa`** e passala sia a
  `percorsoPerIPunti` sia a `percorsoVicinoAiKm`.

- [ ] **Step 4: in `POST /legs/:id/via`**, salva `pedaggi_dichiarati` accanto a
  `via` nello stesso `UPDATE`, calcola la strada con la tappa aggiornata,
  e rispondi con `pedaggi`, `pedaggio_km` e `pedaggi_avviso` da
  `pedaggiNonTornano(dichiarato, scelto.pedaggio_km, { sannoEvitare: sannoEvitareIPedaggi() })`.

  Il campo assente nel corpo (`undefined`) **non cambia** la dichiarazione che
  c'e': i luoghi si correggono anche senza ridire ogni volta l'autostrada.

- [ ] **Step 5: guardale passare, e tutta la suite**

Run: `node --test test/pedaggi-tappa.test.js && node --test "test/*.test.js"`
Expected: PASS, 0 fail

- [ ] **Step 6: commit**

```bash
git add src/routes/trips.js test/pedaggi-tappa.test.js
git commit -m "Ogni ridisegno rispetta l'autostrada che hai dichiarato"
```

---

### Task 4: le tre risposte nel riquadro, e la frase sulla riga

**Files:**
- Modify: `public/app.js:4350` (`ridisegnaTappa`), `:3414` (la frase sulla riga della tappa)
- Test: `test/pedaggi-pagina.test.js` (nuovo)

**Interfaces:**
- Consumes: `POST /legs/:id/via` con `pedaggi` nel corpo, e nella risposta
  `pedaggi`, `pedaggio_km`, `pedaggi_avviso` (attivita' 3).
- Produces: niente per altre attivita'.

- [ ] **Step 1: scrivi le prove che falliscono** in `test/pedaggi-pagina.test.js`

Lette dal sorgente di `public/app.js`, come `via-pagina.test.js`. **Ancore
precise**: nelle volte precedenti prove con ancore larghe sono passate senza
provare niente.

```js
test('il riquadro chiede dell’autostrada, con tre risposte', () => {
  const d = fra(app, 'Per dove siete passati davvero?', 2600);
  assert.match(d, /name="pedaggi"[^>]*value="si"/);
  assert.match(d, /name="pedaggi"[^>]*value="no"/);
  assert.match(d, /name="pedaggi"[^>]*value=""/, 'manca «non lo so», che non e’ «no»');
});

test('«si» non promette piu’ di quel che fa', () => {
  // Nessun servizio ha un «preferisci i pedaggi».
  const d = fra(app, 'Per dove siete passati davvero?', 2600);
  assert.match(d, /più rapida/, '«si» viene raccontato come se l’autostrada fosse stata chiesta');
});

test('la risposta di adesso e’ quella spuntata', () => {
  const d = fra(app, 'Per dove siete passati davvero?', 2600);
  assert.match(d, /pedaggi_dichiarati/, 'il riquadro si apre senza sapere cosa avevi dichiarato');
});

test('la dichiarazione si manda insieme ai posti', () => {
  const d = fra(app, "/via`, { method: 'POST'", 400);
  assert.match(d, /pedaggi/, 'si mandano i posti e non l’autostrada');
});

test('quando quel che esce non torna, lo si legge', () => {
  const d = fra(app, 'pedaggi_avviso', 900);
  assert.match(d, /ne_fa_comunque|non_chiedibile/, 'l’avviso arriva e nessuno lo mostra');
});

test('la riga della tappa dice l’autostrada dichiarata', () => {
  const riga = fra(app, 'come hai detto tu', 900);
  assert.match(riga, /senza autostrada/);
  assert.match(riga, /in autostrada/);
});
```

- [ ] **Step 2: guardale fallire**

Run: `node --test test/pedaggi-pagina.test.js`
Expected: FAIL — nel riquadro non c'e' nessun campo `pedaggi`

- [ ] **Step 3: le tre risposte** in `ridisegnaTappa`, sotto il campo dei
  luoghi, con le diciture del disegno:

```
( ) Non lo so — scelgo io la strada che misura piu' vicino ai 187 km veri
( ) Si' — prendo la piu' rapida, che e' quella che usa l'autostrada
( ) No — chiedo la strada che evita i pedaggi
```

Spuntata quella che la tappa ha già. L'invio manda `pedaggi` accanto a `nomi`.

- [ ] **Step 4: gli avvisi** dopo la risposta, nella voce del programma: con
  `'ne_fa_comunque'` si dice che una strada senza pedaggi fra quei posti non si
  e' trovata e quanti chilometri ne fa questa; con `'non_ne_fa'`, che
  l'autostrada su quella strada non c'e'; con `'non_chiedibile'`, che la strada
  senza pedaggi non si puo' chiedere al servizio.

- [ ] **Step 5: la frase sulla riga della tappa** (`:3414`) continua con
  «senza autostrada» o «in autostrada» dopo i luoghi dichiarati.

- [ ] **Step 6: guardale passare, e tutta la suite**

Run: `node --test test/pedaggi-pagina.test.js && node --test "test/*.test.js"`
Expected: PASS, 0 fail

- [ ] **Step 7: provalo davvero nel browser**

Riavvia il server locale (l'impronta dei file si calcola all'avvio: senza
riavvio la pagina servita e' quella di prima), apri il riquadro su una tappa
CarLock, controlla che le tre risposte si vedano e che quella salvata torni
spuntata riaprendo.

- [ ] **Step 8: commit**

```bash
git add public/app.js test/pedaggi-pagina.test.js
git commit -m "«Avete fatto l'autostrada?» — si', no, o non lo so"
```
