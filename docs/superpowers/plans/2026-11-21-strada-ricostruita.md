# La strada ricostruita — piano

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Una strada ricostruita non sembra più una traccia su nessun apparecchio, e il proprietario può dire per dove è passato.

**Architecture:** La regola del disegno sta nelle due mappe di `public/app.js`, che la pagina dell'ospite già riusa. I punti dichiarati sono una colonna nuova su `legs`, e il percorso che li attraversa si calcola con un aiuto nuovo in `geo.js` che applica al percorso passante la stessa regola dei chilometri che `percorsoVicinoAiKm` applica a quello diretto. Le tre rotte che ridisegnano una tappa passano da lì.

**Tech Stack:** Node 20, Express, PostgreSQL, Leaflet, JavaScript senza impacchettatori, `node:test`.

**Spec:** `docs/superpowers/specs/2026-11-21-strada-ricostruita-design.md` — da leggere, comprese le «Decisioni dopo la revisione», che contengono le otto scelte che il piano dà per fatte.

## Global Constraints

- **I chilometri e la durata di una tappa `source='carlock'` non si toccano mai.** Sono quel che il tracker misura; la strada no. Il pedaggio invece dipende dalla strada e la segue — CarLock non lo misura.
- **Un solo significato per tratto.** Sei tratti sono già presi: `TRATTI` ha `4 6`, `1 6`, `12 4 2 4`, `8 3` (le tracce degli atleti), il traghetto ha `10 8`, le strade alternative `8 7`. Il tratto nuovo è diverso da tutti e sei, e lo tiene una prova.
- **Il tratto a punti non si «promuove» a linea piena** quando il proprietario ha dichiarato i punti: resta una deduzione.
- **La frase non vive in un `title=`.** È la ragione del lavoro.
- La logica sta nei moduli di `src/lib/`, non in `public/app.js`: lì non girano prove.
- `npm test` nella radice deve restare verde a ogni commit.

## Review Focus

1. **Un nome di posto che il geocoder non trova.** Non deve spegnere il ridisegno degli altri punti né lasciare la tappa senza geometria: la riga di prima è meglio di nessuna riga. *(prova nel compito 4)*
2. **Due punti scritti nell'ordine sbagliato.** Il percorso torna indietro, e la lunghezza si allontana dai km veri. Non va raddrizzato di nascosto — chi guarda se ne accorge, il programma no — ma l'avviso dei chilometri deve scattare. *(prova nel compito 5)*
3. **Una tappa che non è in camper** (traghetto, aereo) con dei punti dichiarati addosso, per esempio perché il mezzo è cambiato dopo. Il percorso su strada non ha senso lì, e `tragittoTappa` già lo sa: i punti vanno ignorati, non applicati. *(prova nel compito 5)*
4. **Un punto dichiarato lontanissimo** — un nome ambiguo geocodificato nel paese sbagliato. Il percorso diventa enorme e i km veri lo smentiscono: l'avviso deve scattare, e la pagina non deve presentare quella riga come buona. *(prova nel compito 5)*
5. **La pagina dell'ospite.** Riceve la riga a punti dalla mappa condivisa, ma la sua riga di tappa non ha né bollino né frase: è l'unico che guarda senza sapere di un tracker. *(prova nel compito 3)*

---

## Struttura dei file

| file | responsabilità | compiti |
|---|---|---|
| `src/routes/trips.js` | le rotte che ridisegnano; i km immutabili | 1, 5 |
| `src/lib/geo.js` | il percorso **attraverso** i punti, scelto sui km | 4 |
| `src/lib/db.js` | la colonna dei punti dichiarati | 4 |
| `public/app.js` | il tratto, la frase, il campo, i segni sulla mappa | 2, 3, 6 |
| `public/ospite.js` | la frase e la legenda per chi guarda da fuori | 3 |

---

### Task 1: I chilometri veri di una tappa CarLock non si sovrascrivono

**Files:**
- Modify: `src/routes/trips.js` (`PUT /legs/:id`, il ramo `else if (scelto) geo = scelto`)
- Test: `test/carlock-km-veri.test.js` (nuovo)

**Interfaces:**
- Consumes: niente.
- Produces: niente che i compiti dopo usino. È il difetto che c'era già, e si chiude per primo perché è il solo che perde dati.

- [ ] **Step 1: Scrivi la prova che cade**

```js
test('scegliere una strada su una tappa CarLock non tocca i chilometri veri', async () => {
  // Oggi bastano due tocchi: «Modifica» mostra le strade possibili, se ne
  // tocchi una `sceltoDaFuori` porta i km della variante e il PUT li scrive
  // al posto di quelli del tracker. Da li' scendono il gasolio, i totali del
  // viaggio e il costo al km.
  const tappa = await tappaCarlock({ distance_km: 187.4, duration_min: 142 });
  await put(`/legs/${tappa.id}`, { percorso: variante({ distance_km: 203.1, duration_min: 118 }) });
  const dopo = await leggiTappa(tappa.id);
  assert.equal(+dopo.distance_km, 187.4);
  assert.equal(dopo.duration_min, 142);
  // E il disegno invece cambia: scegliere la strada giusta e' proprio quel
  // che serve.
  assert.notDeepEqual(dopo.geometry, tappa.geometry);
});

test('su una tappa scritta a mano la scelta della strada porta i suoi km, come prima', async () => {
  // Li' i chilometri **sono** quelli del navigatore: non c'e' nessuna misura
  // da proteggere, e cambiarli e' il comportamento giusto.
  const tappa = await tappaManuale({ distance_km: 100 });
  await put(`/legs/${tappa.id}`, { percorso: variante({ distance_km: 203.1, duration_min: 118 }) });
  assert.equal(+(await leggiTappa(tappa.id)).distance_km, 203.1);
});
```

Gli aiuti (`tappaCarlock`, `tappaManuale`, `variante`, `put`, `leggiTappa`) vanno presi dallo stampo delle prove esistenti della cartella `test/`: si guarda come provano le rotte di `trips.js` e non se ne inventa un secondo modo. Se non c'è un modo già fatto per chiamare una rotta, la via più corta è provare la funzione che decide (`sceltoDaFuori` e il ramo che la usa) estraendola, invece di montare un server.

- [ ] **Step 2: Fai girare le prove e guardale cadere**

Run: `npm test`
Atteso: FAIL, la prima dice `distance_km = 203.1`.

- [ ] **Step 3: Rendi immutabili i due numeri sulle tappe CarLock**

Nel ramo che applica la strada scelta, quando `cur.source === 'carlock'` si tiene `cur.distance_km` e `cur.duration_min` e si prende solo la geometria (e il pedaggio, che segue la strada). Il commento dice perché, con la data e il fatto: due tocchi cancellavano la misura del tracker.

- [ ] **Step 4: Prove verdi, e tutta la suite**

Run: `npm test`
Atteso: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/routes/trips.js test/carlock-km-veri.test.js
git commit -m "I chilometri veri di una tappa CarLock non si sovrascrivono scegliendo una strada"
```

---

### Task 2: La strada ricostruita si disegna a punti

**Files:**
- Modify: `public/app.js` (la costante nuova accanto ai colori della mappa; i due disegnatori di tappe, intorno a 1674 e 2932)
- Test: `test/mappa-tratti.test.js` (nuovo)

**Interfaces:**
- Consumes: niente.
- Produces: `TRATTO_RICOSTRUITO` in `public/app.js`, usata da tutte e due le mappe.

- [ ] **Step 1: Scrivi le prove che cadono**

Prove che leggono il sorgente, sullo stampo di `test/` per la pagina (la pagina non si esegue, si legge: è il modo che il progetto usa già per le regole che nessuna prova di logica vede).

```js
test('il tratto della strada ricostruita non e’ nessuno di quelli gia’ presi', () => {
  // Sei tratti occupati: i quattro di TRATTI (le tracce degli atleti), il
  // traghetto e le strade alternative. Un tratto che vuol dire due cose non
  // e' una spiegazione, e' un indovinello.
  const presi = [...app.matchAll(/dashArray: '([^']+)'/g)].map(m => m[1]);
  const tratti = [...app.matchAll(/\['([\d ]+)', '(?:dashed|dotted)'\]/g)].map(m => m[1]);
  const nostro = app.match(/const TRATTO_RICOSTRUITO = '([^']+)'/);
  assert.ok(nostro, 'manca TRATTO_RICOSTRUITO');
  for (const altro of [...presi, ...tratti].filter(t => t !== nostro[1])) {
    assert.notEqual(nostro[1], altro, `il tratto ${nostro[1]} e’ gia’ preso`);
  }
});

test('tutte e due le mappe usano lo stesso tratto per la stessa cosa', () => {
  // Un significato che cambia da una mappa all'altra e' peggio di nessun
  // significato.
  assert.ok((app.match(/TRATTO_RICOSTRUITO/g) || []).length >= 3,
    'la costante non e’ usata in tutte e due le mappe');
});

test('solo le tappe CarLock si disegnano a punti', () => {
  // Su una tappa a mano i chilometri **sono** quelli del navigatore: riga e
  // numero dicono la stessa cosa. Su una in preparazione la riga e' una
  // scelta, non una deduzione.
  for (const m of app.matchAll(/TRATTO_RICOSTRUITO/g)) {
    const intorno = app.slice(Math.max(0, m.index - 400), m.index + 100);
    assert.match(intorno, /carlock/,
      'il tratto a punti si applica senza guardare se la tappa e’ di CarLock');
  }
});
```

- [ ] **Step 2: Fai girare le prove e guardale cadere**

Run: `npm test`
Atteso: FAIL, `TRATTO_RICOSTRUITO` non esiste.

- [ ] **Step 3: Scrivi la costante e usala nelle due mappe**

`TRATTO_RICOSTRUITO` va accanto a `COLORE_CAMPER` e compagni, con il suo perché: a punti perché la strada è dedotta, nel colore del camper perché la tappa è su gomma, e diverso dai sei tratti già presi. Il valore `'2 7'` è quello che l'altra app di questo progetto usa già per il ramo dedotto della figura delle batterie — un vocabolario solo per due programmi vale più di due vocabolari coerenti ciascuno con sé.

Nei due disegnatori: una tappa in camper con `source === 'carlock'` prende il tratto; le altre restano come sono. Il popup della riga dice che la strada è ricostruita.

- [ ] **Step 4: Prove verdi, tutta la suite, e la mappa**

Run: `npm test`
Atteso: PASS. Poi la pagina vera con un viaggio importato: la riga a punti si deve leggere come una linea da lontano e distinguersi dal traghetto da vicino.

- [ ] **Step 5: Commit**

```bash
git add public/app.js test/mappa-tratti.test.js
git commit -m "La strada ricostruita si disegna a punti: non e' una traccia"
```

---

### Task 3: La frase esce dal suggerimento, e arriva anche all'ospite

**Files:**
- Modify: `public/app.js` (la riga della tappa, intorno a 3314)
- Modify: `public/ospite.js` (la riga della tappa, intorno a 101; la legenda)
- Test: `test/strada-ricostruita-detto.test.js` (nuovo)

**Interfaces:**
- Consumes: `TRATTO_RICOSTRUITO` dal compito 2 (per la legenda).
- Produces: niente.

- [ ] **Step 1: Scrivi le prove che cadono**

```js
test('la frase sulla strada ricostruita non vive solo in un title=', () => {
  // E' la ragione di tutto il lavoro: la frase c'era, e stava in un
  // suggerimento che su un iPad non esiste. Il proprietario ha letto una riga
  // su una mappa per quel che sembra -- una registrazione.
  const fuoriDaiTitle = app.replace(/title="[^"]*"/g, '');
  assert.match(fuoriDaiTitle, /ricostruita/,
    'la frase sta ancora soltanto nei suggerimenti');
});

test('anche l’ospite lo legge: e’ l’unico che guarda senza sapere del tracker', () => {
  const senzaTitle = ospite.replace(/title="[^"]*"/g, '');
  assert.match(senzaTitle, /ricostruit/i);
});

test('la legenda dell’ospite distingue la strada ricostruita', () => {
  assert.match(ospite + app, /TRATTO_RICOSTRUITO|ricostruit/i);
});
```

- [ ] **Step 2: Fai girare le prove e guardale cadere**

Run: `npm test`
Atteso: FAIL sulla seconda e sulla terza; la prima dirà se la frase della pagina principale è davvero solo in un `title=`.

- [ ] **Step 3: Scrivi la frase dove si legge**

Sotto la tappa, per scritto, corta — una riga — e con le due cose separate: i chilometri e gli orari sono veri, la strada è ricostruita. Nella pagina dell'ospite la stessa cosa, con le sue parole: lui non sa cosa sia CarLock e non gli serve saperlo, gli serve sapere che quella riga non è una traccia.

La voce di legenda della mappa distingue la strada ricostruita da quella scelta.

- [ ] **Step 4: Prove verdi, tutta la suite, e le due pagine**

Run: `npm test`
Atteso: PASS. Poi la pagina del viaggio e quella dell'ospite, su un viaggio importato.

- [ ] **Step 5: Commit**

```bash
git add public/app.js public/ospite.js test/strada-ricostruita-detto.test.js
git commit -m "La frase sulla strada ricostruita si legge anche senza mouse"
```

---

### Task 4: I punti dichiarati, e il percorso che li attraversa

**Files:**
- Modify: `src/lib/db.js` (la colonna nuova su `legs`)
- Modify: `src/lib/geo.js` (l'aiuto nuovo)
- Modify: `src/routes/trips.js` (la rotta che salva i punti)
- Test: `test/via-percorso.test.js` (nuovo)

**Interfaces:**
- Consumes: `percorsiConTappe(punti)` e `geocode`/`addressCandidates`, che esistono.
- Produces:
  ```js
  // Il percorso che passa dai punti dichiarati, scelto sui km veri come fa
  // percorsoVicinoAiKm su quello diretto.
  export async function percorsoPerIPunti(from, punti, to, kmVeri, minutiVeri)
  // → { geometry, distance_km, duration_min, pedaggio_km, nome, scarto_km, scelta_per_km }
  ```
  e su `legs` una colonna `via` (JSONB: `[{ nome, lat, lon }]`, nell'ordine scritto; `lat`/`lon` `null` quando il nome non si è trovato).

- [ ] **Step 1: Scrivi le prove che cadono**

```js
test('il percorso passa dal punto dichiarato, quello diretto no', () => {
  // E' la prova che il lavoro fa quel che dice. Novaledo -> Udine passa per
  // Bassano; dichiarando Vidor deve passare da Vidor.
  const diretto = await percorsoVicinoAiKm(NOVALEDO, UDINE, 187, 142);
  const perVidor = await percorsoPerIPunti(NOVALEDO, [VIDOR], UDINE, 187, 142);
  assert.ok(vicinoA(perVidor.geometry, VIDOR, 8), 'non passa da Vidor');
  assert.ok(!vicinoA(diretto.geometry, VIDOR, 8), 'il diretto passava gia’ da Vidor: scegli un altro punto per la prova');
});

test('due punti si attraversano nell’ordine scritto', () => {
  const r = await percorsoPerIPunti(NOVALEDO, [VIDOR, PIEVE], UDINE, 187, 142);
  const iVidor = primoIndiceVicino(r.geometry, VIDOR, 8);
  const iPieve = primoIndiceVicino(r.geometry, PIEVE, 8);
  assert.ok(iVidor >= 0 && iPieve >= 0);
  assert.ok(iVidor < iPieve, 'l’ordine scritto non e’ rispettato');
});

test('fra le strade passanti si prende quella che misura quanto i km veri', () => {
  // La stessa regola del percorso diretto: usarne una diversa a seconda che
  // il proprietario abbia parlato o no vorrebbe dire due regole per lo stesso
  // numero.
  // (si prova con un finto `percorsiConTappe` che torna due varianti note)
});

test('un nome che non si trova non spegne gli altri, e si dice', async () => {
  const r = await salvaPunti(tappa.id, ['Vidor', 'Posto Che Non Esiste 9x']);
  assert.equal(r.non_trovati.length, 1);
  assert.ok(vicinoA((await leggiTappa(tappa.id)).geometry, VIDOR, 8),
    'il punto buono doveva comunque essere usato');
  // E il nome sbagliato resta scritto: buttarlo in silenzio vorrebbe dire
  // fargli riscrivere una cosa che ha gia' scritto.
  assert.equal((await leggiTappa(tappa.id)).via.length, 2);
});

test('i chilometri veri non si muovono quando si salvano i punti', async () => {
  const prima = await leggiTappa(tappa.id);
  await salvaPunti(tappa.id, ['Vidor']);
  const dopo = await leggiTappa(tappa.id);
  assert.equal(+dopo.distance_km, +prima.distance_km);
  assert.equal(dopo.duration_min, prima.duration_min);
});
```

Le prove che toccherebbero la rete vanno fatte con un finto al posto di `fetchJson`/`percorsiConTappe`, come fanno già le prove esistenti di `geo.js` se ce ne sono; non si martellano i servizi gratuiti da una suite.

- [ ] **Step 2: Fai girare le prove e guardale cadere**

Run: `npm test`
Atteso: FAIL, `percorsoPerIPunti` non esiste.

- [ ] **Step 3: La colonna, l'aiuto, la rotta**

La colonna con `ALTER TABLE legs ADD COLUMN IF NOT EXISTS`, come le altre.

`percorsoPerIPunti` costruisce l'elenco `from → punti → to`, chiede `percorsiConTappe`, e fra le varianti prende quella il cui totale è più vicino ai km veri, col tetto sul tempo che `percorsoVicinoAiKm` usa già. La parte in comune fra i due — il confronto e il tetto — va **estratta**, non copiata.

La rotta che salva i punti li geocodifica con la macchina esistente (cache e pausa comprese), tiene i nomi non trovati, ridisegna, e **non tocca i chilometri né la durata**.

- [ ] **Step 4: Prove verdi, e tutta la suite**

Run: `npm test`
Atteso: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/db.js src/lib/geo.js src/routes/trips.js test/via-percorso.test.js
git commit -m "«Ci siamo passati per...»: i punti dichiarati e il percorso che li attraversa"
```

---

### Task 5: I punti vincolano ogni ridisegno

**Files:**
- Modify: `src/routes/trips.js` (`POST /legs/:id/ridisegna`, `PUT /legs/:id`, `POST /legs/:id/carlock`)
- Test: `test/via-vincola.test.js` (nuovo)

**Interfaces:**
- Consumes: `percorsoPerIPunti` dal compito 4.
- Produces: niente.

- [ ] **Step 1: Scrivi le prove che cadono**

```js
test('«Ridisegna» passa dai punti dichiarati invece di ignorarli', async () => {
  // Senza questo, il tasto che sembra il rimedio cancella in silenzio l'unica
  // informazione che viene da chi c'era.
  await salvaPunti(tappa.id, ['Vidor']);
  await post(`/legs/${tappa.id}/ridisegna`);
  assert.ok(vicinoA((await leggiTappa(tappa.id)).geometry, VIDOR, 8));
});

test('salvare la tappa non perde i punti', async () => {
  await salvaPunti(tappa.id, ['Vidor']);
  await put(`/legs/${tappa.id}`, { notes: 'due righe di appunti' });
  assert.ok(vicinoA((await leggiTappa(tappa.id)).geometry, VIDOR, 8));
});

test('un reimport non tocca le tappe CarLock che ci sono gia’, punti compresi', async () => {
  // Verificato leggendo: l'inserimento e' ON CONFLICT (trip_id, external_id)
  // DO NOTHING, e `sostituisci` cancella solo le tappe senza external_id. Qui
  // si pinna, perche' resti vero.
  await salvaPunti(tappa.id, ['Vidor']);
  await importaDiNuovo(viaggio.id, { sostituisci: true });
  assert.equal((await leggiTappa(tappa.id)).via.length, 1);
});

// Review Focus 3
test('su una tappa che non e’ in camper i punti si ignorano, non si applicano', async () => {
  // Un traghetto non segue le statali, e disegnare l'autostrada sotto un
  // aereo sarebbe un racconto falso: `tragittoTappa` lo sa gia'.
  await salvaPunti(tappa.id, ['Vidor']);
  await put(`/legs/${tappa.id}`, { mezzo: 'traghetto' });
  const dopo = await leggiTappa(tappa.id);
  assert.equal(dopo.geometry.length, 2, 'il traghetto deve restare una linea fra due punti');
});

// Review Focus 2 e 4
test('punti nell’ordine sbagliato, o lontanissimi: l’avviso dei chilometri scatta', async () => {
  // Non si raddrizza di nascosto: chi guarda la mappa se ne accorge, il
  // programma no. Ma la lunghezza si allontana dai km veri, e quello si dice.
  await salvaPunti(tappa.id, ['Palermo']);
  const dopo = await leggiTappa(tappa.id);
  assert.ok(Math.abs(lungaQuanto(dopo.geometry) - dopo.distance_km) > 15);
});
```

- [ ] **Step 2: Fai girare le prove e guardale cadere**

Run: `npm test`
Atteso: FAIL sulle prime due e sulla quarta; la terza e la quinta dicono se il comportamento era già giusto.

- [ ] **Step 3: Passa dai punti nelle tre rotte**

Dove oggi si chiama `percorsoVicinoAiKm` o `route` sui due soli estremi, se la tappa è in camper e ha punti dichiarati si chiama `percorsoPerIPunti`. Il mezzo comanda: per il traghetto e l'aereo i punti si ignorano, e il commento dice perché.

- [ ] **Step 4: Prove verdi, e tutta la suite**

Run: `npm test`
Atteso: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/routes/trips.js test/via-vincola.test.js
git commit -m "I punti dichiarati vincolano ogni ridisegno, non solo quello che li ha scritti"
```

---

### Task 6: Il campo, i segni sulla mappa, e quel che la pagina dice

**Files:**
- Modify: `public/app.js` (il riquadro di modifica della tappa intorno a 4086; la riga della tappa; la mappa)
- Test: `test/via-pagina.test.js` (nuovo)

**Interfaces:**
- Consumes: la colonna `via` dal compito 4.
- Produces: niente.

- [ ] **Step 1: Scrivi le prove che cadono**

```js
test('il campo dei punti e quello delle note dicono quale dei due disegna', () => {
  // Due campi vicini che chiedono «per dove sei passato» si confondono, e
  // scrivere nel posto sbagliato fa credere che la correzione non funzioni.
  const modifica = bloccoDi(app, 'function legForm');
  assert.match(modifica, /Soste lungo la strada e note/);
  assert.match(modifica, /passat/i, 'manca il campo dei punti');
  assert.match(modifica, /disegn/i, 'le etichette non dicono quale dei due disegna');
});

test('i punti dichiarati si segnano sulla mappa', () => {
  // Sono l'unica parte di quella riga che viene da chi c'era.
  assert.match(app, /\.via\b/);
});

test('la frase cambia quando i punti ci sono, e la riga resta a punti', () => {
  // La tentazione di promuoverla a linea piena quando il proprietario ha
  // parlato e' il modo di ricominciare a chiamare traccia una deduzione.
  const senzaTitle = app.replace(/title="[^"]*"/g, '');
  assert.match(senzaTitle, /passando per/i);
});

test('la pagina dice che un ridisegno rifa’ i chilometri di autostrada', () => {
  // Buco noto e dichiarato: non c'e' modo di sapere se quel numero l'ha
  // scritto il proprietario a mano, e il ridisegno lo sovrascrive gia' da
  // prima. Dirlo costa una riga; una colonna nuova costa un altro lavoro.
  assert.match(app, /autostrada/i);
});
```

- [ ] **Step 2: Fai girare le prove e guardale cadere**

Run: `npm test`
Atteso: FAIL.

- [ ] **Step 3: Scrivi il campo e i segni**

Il campo accanto a «Soste lungo la strada e note», con le due etichette che dicono la differenza: uno disegna, l'altro no. I punti dichiarati si segnano sulla mappa con un segno proprio, distinto dalle soste e dai capi della tappa. La frase sotto la tappa diventa «ricostruita passando per…» quando i punti ci sono, e il tratto resta a punti.

Accanto al campo del pedaggio, una riga che dice che un ridisegno lo rifà.

- [ ] **Step 4: Prove verdi, tutta la suite, e la pagina**

Run: `npm test`
Atteso: PASS. Poi la pagina vera: si scrive «Vidor, Pieve di Soligo» sulla tappa Novaledo-Udine, si salva, e la riga deve passare da lì con i chilometri invariati.

- [ ] **Step 5: Commit**

```bash
git add public/app.js test/via-pagina.test.js
git commit -m "Il campo dei punti, i segni sulla mappa, e la frase che cambia"
```
