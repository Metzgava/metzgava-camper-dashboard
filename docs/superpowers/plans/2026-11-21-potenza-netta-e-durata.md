# La potenza netta delle Ective e la durata col consumo vivo — piano

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Il pacco Ective ha una sola potenza con il segno, da cui si ricavano i due versi; e le durate in pagina si calcolano su un consumo misurato che si aggiorna da sé invece che su un istante o su un numero battuto a mano cinque giorni fa.

**Architecture:** `uscitaEctive` in `conti.js` già calcola `netto = -Σ(volt × ampere)` e lo butta quando è negativo: lo espone, e `fonti_ective` si ricava da lì invece che da `sommaPos`, che sparisce. Le medie storiche vanno in un file nuovo, `src/lib/consumo.js`, perché interrogano `misure` (lo storico) e non `istantanee` (l'adesso) e sono una responsabilità diversa da quella di `conti.js`. La figura prende tre stati al posto del booleano `altrove`, e `app.js` sceglie una frase fra tre invece di dirne sempre una.

**Tech Stack:** Node 20, Express, PostgreSQL, `node:test`, JavaScript senza impacchettatori. Nessuna dipendenza nuova.

**Spec:**
- `docs/superpowers/specs/2026-11-21-potenza-netta-ective-design.md` (compiti 1-4)
- `docs/superpowers/specs/2026-11-21-durata-consumo-vivo-design.md` (compiti 5-8)

Il secondo disegno dipende dal primo: la media si fa sulla potenza netta.

## Global Constraints

- **La grammatica della casa.** Ogni valore calcolato porta `base` (`misurato` | `stima` | `incompleto`), `perche`, `detto`, `mancano`. In pagina `—` vuol dire «non so», `0` vuol dire «uno zero che conosco». Si usano gli aiuti che ci sono già: `conto(valore, unita, {...})` e `manca(unita, mancano, perche)` in `conti.js:28-31`.
- **Mai una durata più lunga del vero.** È l'anti obiettivo di tutti e due i disegni: fra due conti plausibili si prende quello che non promette ore che non ci sono.
- **Mai un bollino `misurato` su un conto che contiene un numero di catalogo o di stima.**
- **I numeri si scrivono all'italiana**, con la virgola, usando `virgola(v, d)` in `conti.js:88` e non `toFixed` né `toLocaleString`. Pinnato da una prova già esistente in `test/uscita-ective-cablaggio.test.js`.
- **La logica sta nei moduli di `src/lib/`, non in `public/app.js`:** su `app.js` non girano prove. `app.js` scrive, non decide.
- **Nessuna prova esistente si cancella.** Due vanno riscritte, e il piano dice quali e perché.
- **`npm test` in `servizi/` deve restare verde a ogni commit.**

## Review Focus

Cinque cose che i disegni implicano, che nessuna prova dei compiti sotto eserciterebbe da sé, e che a chi usa la pagina farebbero male. Ciascuna ha la sua prova, aggiunta al compito che possiede quel codice.

1. **Una sola Ective risponde e l'altra tace.** `istantanee` tiene l'ultima lettura di ciascuna, quindi la muta non sparisce: resta coi suoi numeri di prima e invecchia. Il netto sommato così mescola due istanti — lo stesso errore del 19/11, dentro lo stesso pacco. `uscitaEctive` calcola già `scarto_minuti` e `conti.js` ne fa un `avviso`, ma **solo su `consumo_ective`**: `fonti_ective`, che adesso nasce dallo stesso netto, deve portarlo anche lei. *(prova nel compito 2)*
2. **Un valore assurdo in archivio avvelena la media.** `src/routes/ingresso.js:38` mette un intervallo lecito per `pannelli_w` ma la media legge `misure` direttamente: una riga a −5000 W, passata da una versione vecchia della scatoletta o da un giro andato male, sposta la media e con lei l'autonomia. La media deve scartare i valori fuori da un intervallo fisico. *(prova nel compito 5)*
3. **L'archivio ha un buco dentro la finestra.** Scatoletta spenta per un'ora e mezza su due: i campioni ci sono, sono pochi e stanno tutti in fondo. Un conteggio di campioni sopra il minimo non dice che la finestra è **coperta**, e una media di dieci minuti spacciata per due ore è una durata inventata. *(prova nel compito 5)*
4. **Lo SmartSolar tace per giorni.** Senza `pannelli_w` in archivio non esistono notti riconoscibili e il consumo a riposo diventa `manca` — giusto, ma deve dirlo con la ragione vera («non so quando era notte»), non con «servono notti in archivio», che farebbe cercare il difetto dove non è. *(prova nel compito 7)*
5. **`rendimento_bluetti_ective` vuoto nella tabella Impianto.** Entra nel conto di «quanto dura fermo» come moltiplicatore: se è `null`, il conto non deve diventare `NaN` né sparire, deve dire cosa manca. *(prova nel compito 8)*

---

## Struttura dei file

| file | responsabilità | compiti |
|---|---|---|
| `src/lib/conti.js` | i conti sull'**adesso**, da `istantanee`. Il netto del pacco, i due versi, le durate | 1, 2, 6, 8 |
| `src/lib/consumo.js` **(nuovo)** | i consumi ricavati dallo **storico**, da `misure`: media recente e consumo a riposo | 5, 7 |
| `src/lib/flusso.js` | come si vede la figura: stati dei rami, stato della spiegazione | 3 |
| `src/public/app.js` | le frasi | 4, 6, 8 |
| `src/lib/db.js` | la nota di `consumo_fermo_w` e la migrazione che la aggiorna | 8 |

`consumo.js` è un file nuovo e non una sezione in più di `conti.js` perché interroga una tabella diversa (`misure`, lo storico) con una domanda diversa (su una finestra, non su un istante), e perché `conti.js` è già il file più lungo della cartella.

---

### Task 1: Il netto esce da `uscitaEctive`

**Files:**
- Modify: `servizi/src/lib/conti.js:95-155` (`uscitaEctive`, e il commento dell'asimmetria a `conti.js:66-78`)
- Test: `servizi/test/uscita-ective.test.js`

**Interfaces:**
- Consumes: niente.
- Produces: `uscitaEctive(righe)` torna, in aggiunta ai campi di oggi, `netto: number | null` (positivo = dal pacco **esce**, negativo = nel pacco **entra**, `null` = nessuna lettura) e `carica_pacco: number | null` (la carica del pacco in percento, media delle batterie che la dichiarano; `null` se nessuna la dichiara).

- [ ] **Step 1: Scrivi le prove che cadono**

```js
test('il netto esce con il segno: negativo quando nel pacco entra corrente', () => {
  const u = uscitaEctive(istantanee(6, 4));      // +6 A e +4 A: carica
  assert.ok(u.netto < 0, `netto = ${u.netto}`);
  assert.ok(Math.abs(u.netto + 13.1 * 10) < 0.5);
  assert.equal(u.watt, 0);                        // «esce» resta zero: invariato
});

test('il netto e’ positivo quando dal pacco esce corrente', () => {
  const u = uscitaEctive(istantanee(-6, -4));
  assert.ok(Math.abs(u.netto - 13.1 * 10) < 0.5);
  assert.ok(Math.abs(u.watt - 13.1 * 10) < 0.5);  // esce = netto, quando e’ positivo
});

test('senza letture il netto e’ null, non zero', () => {
  assert.equal(uscitaEctive([]).netto, null);
  assert.equal(uscitaEctive([]).carica_pacco, null);
});

test('la carica del pacco e’ la media di quelle dichiarate', () => {
  // istantanee() mette la stessa carica su tutte: serve un caso a due valori
  const u = uscitaEctive(conCarica([{ ampere: -6, carica: 95 }, { ampere: -4, carica: 98 }]));
  assert.ok(Math.abs(u.carica_pacco - 96.5) < 0.1);
});
```

L'aiuto `conCarica(elenco)` va scritto accanto a `istantanee()` già presente nel file, sullo stesso stampo: serve perché `istantanee()` non sa dare cariche diverse alle due batterie, ed è il caso 95/98 che il proprietario ha letto.

- [ ] **Step 2: Fai girare le prove e guardale cadere**

Run: `npm test -- test/uscita-ective.test.js`
Atteso: FAIL, `netto` e `carica_pacco` sono `undefined`.

- [ ] **Step 3: Esponi `netto` e `carica_pacco` in `uscitaEctive`**

`netto` è la variabile che esiste già a `conti.js:111`: va messa nel valore di ritorno e in `vuoto` come `null`. `carica_pacco` si calcola dalle batterie che dichiarano `carica` (il campo è già letto a `conti.js:99`).

- [ ] **Step 4: Riscrivi il commento dell'asimmetria**

Il blocco a `conti.js:66-78` dice *«Asimmetria dichiarata: `sommaPos` più sotto tiene solo le positive […] vale la pena farlo un giorno»*. Dopo il compito 2 quel commento descrive codice che non c'è più. Va sostituito con il perché del netto unico, e con la data e il fatto che l'hanno fatto venire a galla: 21/11/2026, Ective a 95 % e 98 % con la pagina che diceva «sono già cariche».

- [ ] **Step 5: Prove verdi, e tutta la suite**

Run: `npm test`
Atteso: PASS su tutto. Qui nessuna prova esistente deve cadere: `watt` non è cambiato.

- [ ] **Step 6: Commit**

```bash
git add servizi/src/lib/conti.js servizi/test/uscita-ective.test.js
git commit -F - <<'EOF'
Il netto del pacco Ective non si butta piu' quando e' negativo

Esisteva gia' dentro uscitaEctive e veniva scartato con un max(0):
era il numero che serviva all'altro verso.
EOF
```

---

### Task 2: `fonti_ective` si ricava dal netto, e `sommaPos` sparisce

**Files:**
- Modify: `servizi/src/lib/conti.js:333-355` (`sommaPos`, `entraEctive`, `dalla220`, `out.fonti_ective`)
- Test: `servizi/test/uscita-ective-cablaggio.test.js` (una prova da riscrivere), prove nuove nello stesso file

**Interfaces:**
- Consumes: `uscitaEctive(righe).netto` dal compito 1.
- Produces: `conti.fonti_ective` con `valore` in watt (≥ 0, mai `null` se ci sono letture), più i campi attaccati `sole_w`, `motore_w`, `rete_w` (`number | null`) e `avviso` (`string | null`).

- [ ] **Step 1: Scrivi le prove che cadono**

```js
test('pacco in scarica: in ingresso e’ uno ZERO MISURATO, non un «non so»', async () => {
  const c = await conti(istantanee(-6, -4));
  assert.equal(c.fonti_ective.valore, 0);
  assert.equal(c.fonti_ective.base, 'misurato');
  assert.deepEqual(c.fonti_ective.mancano, []);
  // il 21/11/2026 qui si leggeva «oggi nessuno misura la loro corrente»
  assert.doesNotMatch(c.fonti_ective.perche, /nessuno misura/);
});

test('una carica e l’altra scarica: in ingresso e’ il NETTO, non la somma delle positive', async () => {
  // Prima di oggi: 13,1 x 11 = 144 W «in ingresso», mentre nel pacco ne
  // entrano 92. I 52 W di differenza si spostano fra le due batterie.
  const c = await conti(istantanee(11, -4));
  assert.ok(Math.abs(c.fonti_ective.valore - 13.1 * 7) < 0.5,
    `fonti_ective = ${c.fonti_ective.valore}`);
  assert.equal(c.consumo_ective.valore, 0);        // il verso in uscita non si muove
});

test('il ramo dedotto della 220 e’ IGNOTO quando il pacco non carica, non zero', async () => {
  const c = await conti(istantanee(-6, -4));
  assert.equal(c.fonti_ective.rete_w, null);
});

test('sole e alternatore restano misurati anche mentre il pacco scarica', async () => {
  const c = await conti([...istantanee(-6, -4), smartSolar(8)]);
  assert.ok(Math.abs(c.fonti_ective.sole_w - 8) < 1);
});

test('senza letture resta un «manca», con scritto cosa manca', async () => {
  const c = await conti([]);
  assert.equal(c.fonti_ective.valore, null);
  assert.equal(c.fonti_ective.base, 'incompleto');
  assert.deepEqual(c.fonti_ective.mancano, ['letture delle Ective']);
});

// Review Focus 1
test('due letture lontane: in ingresso porta l’avviso, come fa l’uscita', async () => {
  const venti = new Date(Date.now() - 20 * 60000).toISOString();
  const c = await conti(istantanee(-6, -4, venti, 'solo la prima'));
  assert.match(c.fonti_ective.avviso, /non sono state lette insieme/);
});
```

L'aiuto `smartSolar(watt)` va scritto accanto a `istantanee()`: una riga `istantanee` con `dati.pannelli_w`, senza `celle_mv` (così non è una batteria). La forma della riga si legge da `conti.js:339`.

`istantanee(ampere1, ampere2, quando)` (`test/uscita-ective-cablaggio.test.js:19`) data **tutte e due** le batterie allo stesso istante. Per l'ultima prova serve datarne **una sola**: va aggiunto un quarto parametro facoltativo all'aiuto esistente, non scritto un secondo aiuto accanto.

- [ ] **Step 2: Fai girare le prove e guardale cadere**

Run: `npm test -- test/uscita-ective-cablaggio.test.js`
Atteso: FAIL. In particolare la prima dice `valore = null, base = incompleto`, e la seconda dice `fonti_ective = 144`.

- [ ] **Step 3: Riscrivi la prova che pinnava l'asimmetria**

La prova `la figura della carica non e’ stata toccata` (`test/uscita-ective-cablaggio.test.js:99-109`) asserisce `fonti_ective = 13.1 * 11` e dice nel suo commento *«Se un giorno si unificano i due versi, questa prova cade per prima e dice che quel disegno sta cambiando»*. **Questo è quel giorno.** Va sostituita dalla seconda prova dello Step 1, con un nome che dica la cosa nuova e un commento che dica cosa pinnava prima e perché quel numero era sbagliato.

- [ ] **Step 4: Togli `sommaPos` e ricava `fonti_ective` dal netto**

`sommaPos` (`conti.js:333-336`) sparisce; `dalSole` e `dalMotore` passano a una somma delle positive **sui loro apparecchi**, che è lecita lì — sono misure indipendenti, non due facce dello stesso pacco. Tre rami, come li fissa il disegno al §2:

| netto | `fonti_ective` |
|---|---|
| `null` | `manca('W', ['letture delle Ective'], …)` — il testo di oggi, che lì è vero |
| `< 0` | `conto(-netto, 'W', { base: 'misurato', … })`, con la ripartizione di oggi nel `perche` |
| `>= 0` | `conto(0, 'W', { base: 'misurato', … })`, e il `perche` dice che dal pacco **esce** corrente, con quanti watt |

`rete_w` si attacca **solo** nel ramo di mezzo. `sole_w` e `motore_w` in tutti e tre. `avviso` in tutti e tre, dalla stessa variabile che lo passa già a `consumo_ective` (`conti.js:487`): va spostata sopra, perché oggi nasce più in basso di `fonti_ective`.

- [ ] **Step 5: Prove verdi, e tutta la suite**

Run: `npm test`
Atteso: PASS. Se cade qualcosa in `test/flusso*.test.js`, **fermati**: quello è il compito 3, e il piano lo vuole in un commit suo.

- [ ] **Step 6: Commit**

```bash
git add servizi/src/lib/conti.js servizi/test/uscita-ective-cablaggio.test.js
git commit -F - <<'EOF'
Quel che entra nelle Ective e' il netto, non la somma delle positive

Due difetti con una causa: a pacco in scarica la pagina diceva «nessuno
misura la loro corrente» (la misuriamo, col segno meno), e con una
batteria in carica e l'altra in scarica dava 144 W «misurati» dove ne
entravano 92 -- i 52 di differenza si spostano fra le due.
EOF
```

---

### Task 3: La figura ha tre stati, non un booleano

**Files:**
- Modify: `servizi/src/lib/flusso.js` (`ramiDellaCarica`, il calcolo di `altrove`; due costanti nuove)
- Test: `servizi/test/flusso.test.js` (una prova da riscrivere), prove nuove nello stesso file

**Interfaces:**
- Consumes: `conti.fonti_ective` (compito 2), `conti.consumo_ective`, e dalla rotta `uscitaEctive(...).carica_pacco` (compito 1).
- Produces: `ramiDellaCarica(fonti, opzioni)` torna `spiegazione: 'piene' | 'scarica' | 'non_so' | null` al posto di `altrove: true | undefined`. `null` quando nelle batterie entra corrente, cioè quando non c'è niente da spiegare. Esporta `CARICA_PIENA_PCT` e `USCITA_FERMA_W`.
- Nuove opzioni accettate: `carica` (percentuale del pacco, `number | null`).

- [ ] **Step 1: Scrivi le prove che cadono**

```js
test('fonti che producono, pacco pieno e fermo: lo stato e’ «piene»', () => {
  const f = ramiDellaCarica(fonti(8, 0, 0), { letture: true, consumo: 2, carica: 100 });
  assert.equal(f.spiegazione, 'piene');
});

test('fonti che producono mentre il pacco si scarica: lo stato e’ «scarica»', () => {
  // Il caso vero del 21/11/2026: 8 W dal sole, Ective a 95 e 98, in scarica.
  const f = ramiDellaCarica(fonti(8, 0, 0), { letture: true, consumo: 37, carica: 96.5 });
  assert.equal(f.spiegazione, 'scarica');
});

test('senza la carica non si attribuisce una causa', () => {
  const f = ramiDellaCarica(fonti(8, 0, 0), { letture: true, consumo: 37, carica: null });
  assert.equal(f.spiegazione, 'non_so');
});

test('quando entra corrente non c’e’ niente da spiegare', () => {
  assert.equal(ramiDellaCarica(fonti(6, 0, 1)).spiegazione, null);
});

// La ragione delle DUE soglie: un pacco davvero pieno non legge zero.
test('i quattro watt del riposo non fanno «scarica»', () => {
  // Il 16/11/2026 il proprietario ha misurato -0,29 A a riposo: ~3,8 W che
  // escono da un pacco pieno. Con lo zero esatto, «piene» non scattava mai.
  const f = ramiDellaCarica(fonti(8, 0, 0), { letture: true, consumo: 3.8, carica: 100 });
  assert.equal(f.spiegazione, 'piene');
});

test('carica alta ma non piena, con consumo vero: «scarica»', () => {
  const f = ramiDellaCarica(fonti(8, 0, 0), { letture: true, consumo: 30, carica: 96 });
  assert.equal(f.spiegazione, 'scarica');
});
```

- [ ] **Step 2: Fai girare le prove e guardale cadere**

Run: `npm test -- test/flusso.test.js`
Atteso: FAIL, `spiegazione` è `undefined`.

- [ ] **Step 3: Riscrivi la prova che pinnava `altrove`**

`test/flusso.test.js:145` asserisce `fuori.altrove === true` e la riga 149 `notEqual(..., true)`. Vanno riscritte sui tre stati nuovi, tenendo il loro intento: la pagina deve poter dire dove va quella corrente.

- [ ] **Step 4: Sostituisci `altrove` con `spiegazione`, e scrivi le due costanti**

`CARICA_PIENA_PCT` e `USCITA_FERMA_W` si esportano con il loro perché accanto, sullo stampo di `RIFERIMENTO_USCITA_W` (`flusso.js:50-62`): una scelta di disegno, non una misura. Il commento di `USCITA_FERMA_W` deve dire due cose: che **non** è `SOGLIA_W` (quella decide se animare un ramo e `flusso.js:41-45` dice espressamente che non vale per le Ective, mentre questa scegle una frase), e che **non nasconde niente** — i watt in uscita restano scritti tali e quali, è solo la parola «piene» che tollera i quattro watt del riposo.

`spiegazione` vale `null` quando nel pacco entra corrente; altrimenti è `piene` se la carica è sopra `CARICA_PIENA_PCT` **e** l'uscita sotto `USCITA_FERMA_W`, `non_so` se manca la carica o manca il consumo, `scarica` nel resto.

- [ ] **Step 5: Prove verdi, e tutta la suite**

Run: `npm test`
Atteso: PASS. `test/pagina.test.js` può cadere qui se controlla la frase: in quel caso è il compito 4, e va fatto nello stesso commit solo se è `app.js` a non girare. Se cade, **leggi cosa afferma prima di cambiarla.**

- [ ] **Step 6: Commit**

```bash
git add servizi/src/lib/flusso.js servizi/test/flusso.test.js
git commit -m "Tre stati per la figura: piene, scarica, non so"
```

---

### Task 4: Le tre frasi in pagina

**Files:**
- Modify: `servizi/public/app.js:756-759` (il blocco `qualcosaCarica ? '' : (f.altrove ? … : …)` in `vistaFlusso`)
- Modify: `servizi/src/routes/stato.js` (passare `carica` a `ramiDellaCarica`)
- Test: `servizi/test/pagina.test.js`

**Interfaces:**
- Consumes: `flusso.spiegazione` dal compito 3.
- Produces: niente che i compiti dopo usino.

- [ ] **Step 1: Scrivi la prova che cade**

Nello stile di `test/pagina.test.js` (che legge il sorgente di `app.js`, non lo esegue): che le tre parole di stato compaiano nel file, e che la bugia non ci sia più.

```js
test('la frase «sono gia’ cariche» non si dice piu’ incondizionatamente', () => {
  // Il 21/11/2026 la pagina diceva «sono gia’ cariche» a batterie al 95 e 98 %.
  // La frase resta, ma solo dentro il ramo «piene».
  const src = leggiApp();
  for (const stato of ['piene', 'scarica', 'non_so']) {
    assert.match(src, new RegExp(`'${stato}'`), `manca il ramo ${stato}`);
  }
});
```

- [ ] **Step 2: Fai girare la prova e guardala cadere**

Run: `npm test -- test/pagina.test.js`
Atteso: FAIL, i tre stati non compaiono.

- [ ] **Step 3: Scrivi le tre frasi**

Una per stato, in italiano piano, nello stile delle frasi che ci sono. Quel che ciascuna deve dire:

- **`piene`** — la frase di oggi, che in quel ramo è vera.
- **`scarica`** — le batterie si stanno svuotando; le fonti coprono una parte dei consumi e non bastano. I numeri sono quelli misurati: i watt che escono e i watt delle fonti. Dei consumi del camper si dice **«almeno»** tanto, mai una cifra esatta: una fonte invisibile sul 12 V — il relè separatore di fabbrica, la Bluetti sul 12 V — aggiunge corrente che non vediamo, e il totale vero è più alto.
- **`non_so`** — le fonti producono e nelle batterie non entra niente, senza attribuire una causa.

Quando `f.ferma` è vero la frase di `scarica` **non va al presente**: la regola del fermo esiste già a `flusso.js:FERMA_DOPO_MINUTI` e la fascia è già in pagina.

- [ ] **Step 4: Passa `carica` dalla rotta**

In `src/routes/stato.js`, dove si chiama `ramiDellaCarica` con `{ letture, bluetti, minuti, consumo }`, va aggiunto `carica` da `uscitaEctive(...).carica_pacco`. `consumo` e `minuti` sono già passati lì.

- [ ] **Step 5: Prove verdi, e guarda la pagina**

Run: `npm test`
Atteso: PASS.

Poi la pagina vera, perché le frasi si giudicano guardandole: `preview_start`, e **`preview_stop` prima** di ogni nuova occhiata — l'impronta dei file si calcola all'avvio del server e senza il riavvio il browser riceve il file vecchio (`docs/` e la memoria del progetto lo dicono). Si controlla il caso del 21/11: Ective sotto il 99 % con consumo vero, e la frase che dice «si stanno scaricando» e non «sono già cariche».

- [ ] **Step 6: Commit**

```bash
git add servizi/public/app.js servizi/src/routes/stato.js servizi/test/pagina.test.js
git commit -F - <<'EOF'
La figura non dice piu' «sono gia' cariche» quando non lo sono

Il 21/11/2026, Ective al 95 e 98 % in scarica, con 8 W dal sole: la
pagina dava la spiegazione rassicurante. Era un errore nel verso
ottimista, trovato dal proprietario guardando due numeri sulla stessa
schermata.
EOF
```

---

### Task 5: Il consumo recente, mediato sulla finestra

**Files:**
- Create: `servizi/src/lib/consumo.js`
- Test: `servizi/test/consumo-recente.test.js`

**Interfaces:**
- Consumes: la tabella `misure` (`quando`, `apparecchio`, `grandezza`, `valore`), dove ogni Ective scrive `watt` a ogni giro — positivo quando la batteria **carica** (`scatoletta/agente.py:531`), con la stessa convenzione di segno di `uscitaEctive`. L'elenco delle batterie si riconosce come fa `src/routes/stato.js` per il grafico: `dati->'celle_mv' IS NOT NULL` in `istantanee`.
- Produces:
  ```js
  // Pura: riceve le righe, non interroga il database.
  export function consumoRecente(righe, { da, a, batterie, fine = FINE_MINUTI })
  // → { watt: number|null, campioni: number, copertura: number,
  //     in_carica_minuti: number, finestra_minuti: number }
  export const FINESTRA_MINUTI, FINE_MINUTI, CAMPIONI_MINIMI, COPERTURA_MINIMA, WATT_LECITI
  ```
  `watt` è `null` quando i campioni o la copertura non bastano. `copertura` è la frazione di finestra con almeno un campione, fra 0 e 1.

- [ ] **Step 1: Scrivi le prove**

```js
test('la media tiene solo quel che esce, e lo tiene PRIMA di mediare', () => {
  // Mezz'ora in carica a 30 W e mezz'ora in scarica a 30 W.
  // Mediare il netto col segno darebbe ZERO, cioe' autonomia infinita su un
  // pacco che si sta svuotando: e' il difetto trovato il 21/11 sui grafici
  // della Storia, dove 90 giorni davano 0,35 kWh e 30 giorni 5,44.
  const r = consumoRecente(mezzaEMezza(30), ...);
  assert.ok(Math.abs(r.watt - 15) < 0.5, `watt = ${r.watt}`);
  assert.ok(Math.abs(r.in_carica_minuti - 30) < 2);
});

test('si divide per la finestra intera, non per i soli intervalli in scarica', () => {
  // 15 e non 30: e' un fattore due, nel verso ottimista se si sbaglia.
  const r = consumoRecente(mezzaEMezza(30), ...);
  assert.ok(r.watt < 20);
});

test('pochi campioni non fanno una media', () => {
  const r = consumoRecente(pochiCampioni(3), ...);
  assert.equal(r.watt, null);
  assert.equal(r.campioni, 3);
});

// Review Focus 3
test('un buco nella finestra non fa una media: la copertura conta', () => {
  // Campioni fitti in dieci minuti su due ore: tanti campioni, finestra scoperta.
  const r = consumoRecente(soloInFondo(), ...);
  assert.equal(r.watt, null);
  assert.ok(r.copertura < COPERTURA_MINIMA);
});

// Review Focus 2
test('un valore assurdo in archivio non avvelena la media', () => {
  const r = consumoRecente([...normali(30), riga(-5000)], ...);
  assert.ok(Math.abs(r.watt - 30) < 1, `watt = ${r.watt}`);
});

test('senza righe la media e’ null, non zero', () => {
  assert.equal(consumoRecente([], ...).watt, null);
});

test('la somma si fa fra batterie, la media fra istanti', () => {
  // Due batterie a -3 A ciascuna nello stesso istante sono un pacco a -6 A,
  // non due pacchi. Un istante in cui una sola ha parlato non e' una
  // fotografia del pacco.
  // (asserzioni sullo stesso stampo di test/storico-uscite.test.js)
});
```

- [ ] **Step 2: Fai girare le prove e guardale cadere**

Run: `npm test -- test/consumo-recente.test.js`
Atteso: FAIL, `servizi/src/lib/consumo.js` non esiste.

- [ ] **Step 3: Scrivi `consumoRecente`**

Il raggruppamento a due livelli è quello che `src/lib/storico.js` fa già in `serieUscite`: intervalli **fini** su cui si somma fra batterie e si taglia il verso (`Math.max(0, -somma)`), e sopra quelli la media. **Riusalo**, non riscriverlo: se serve, esporta da `storico.js` la parte comune invece di copiarla. Il taglio prima della media è il punto, e il commento deve dire perché, con la data.

Un intervallo fine è una fotografia del pacco **solo se tutte le batterie hanno parlato**: è la regola che `serieUscite` applica già, e vale qui per la stessa ragione.

Le costanti si esportano con il loro perché: `FINESTRA_MINUTI` abbastanza lunga da contenere qualche ciclo del frigo e abbastanza corta da raccontare adesso; `WATT_LECITI` sullo stampo degli intervalli di `src/routes/ingresso.js:30-45`.

- [ ] **Step 4: Prove verdi, e tutta la suite**

Run: `npm test`
Atteso: PASS.

- [ ] **Step 5: Commit**

```bash
git add servizi/src/lib/consumo.js servizi/test/consumo-recente.test.js
git commit -F - <<'EOF'
Il consumo recente: una media che taglia il verso prima di mediare

Un istante non e' un consumo: aprire la pagina mentre parte il frigo
dava tre ore di autonomia, un minuto dopo quaranta. E mediare il netto
col segno annullerebbe la notte col giorno -- lo stesso difetto che
stamattina dava 0,35 kWh su 90 giorni e 5,44 su 30.
EOF
```

---

### Task 6: Le durate si calcolano sulla media

**Files:**
- Modify: `servizi/src/lib/conti.js:491-512` (`out.tempo_residuo_ective`), e la lettura di `misure` dentro `tuttiIConti`
- Modify: `servizi/public/app.js` (il `perche` che si legge in pagina viene da `conti.js`, quindi qui cambia solo se la scheda nasconde il campo)
- Test: `servizi/test/uscita-ective-cablaggio.test.js`

**Interfaces:**
- Consumes: `consumoRecente(...)` dal compito 5.
- Produces: `conti.tempo_residuo_ective` con, in più, `finestra_minuti` e `in_carica_minuti`.

- [ ] **Step 1: Scrivi le prove**

```js
test('la durata usa la media, non l’istante', async () => {
  // Istante anomalo (il frigo che parte) in una finestra tranquilla:
  // l'autonomia non deve crollare.
  const c = await conti(istantanee(-30, -30), { storico: tranquillo(20) });
  assert.ok(c.tempo_residuo_ective.valore > 1,
    `ore = ${c.tempo_residuo_ective.valore}`);
  assert.match(c.tempo_residuo_ective.perche, /media/);
});

test('la frase dice la finestra E quanto se n’e’ stata in carica', async () => {
  const c = await conti(istantanee(-6, -4), { storico: mezzaEMezza(30) });
  assert.match(c.tempo_residuo_ective.perche, /in carica/);
});

test('senza media si ricade sull’istante, e lo si DICE', async () => {
  const c = await conti(istantanee(-6, -4), { storico: [] });
  assert.ok(c.tempo_residuo_ective.valore > 0);
  assert.match(c.tempo_residuo_ective.perche, /in questo momento|adesso/);
});

test('la durata si da’ anche mentre il pacco carica', async () => {
  // Riscrive la prova «batterie in carica: niente esce» per la parte durata.
  // Due domande distinte: «adesso non esce niente» parla dell'istante,
  // «18 ore sulla media» parla della durata.
  const c = await conti(istantanee(6, 4), { storico: tranquillo(20) });
  assert.equal(c.consumo_ective.valore, 0);          // il non obiettivo
  assert.equal(c.consumo_ective.detto, 'niente esce');
  assert.ok(c.tempo_residuo_ective.valore > 0);      // la cosa nuova
});
```

Il modo di iniettare lo storico c'è già e non va inventato: `test/aiuto/archivio-finto.js` chiave sui frammenti di SQL, e l'aiuto `conti()` del file (`test/uscita-ective-cablaggio.test.js:31-37`) lo usa così:

```js
archivio([
  ['FROM impianto', impianto],
  ['FROM istantanee', righe],
]);
```

Le righe di `misure` si aggiungono allo stesso elenco con `['FROM misure', storico]`, nella forma della tabella (`quando`, `apparecchio`, `grandezza`, `valore`). L'aiuto `conti(righe)` va esteso una volta a `conti(righe, { storico = [], impianto: imp = impianto } = {})` — serve così anche al compito 8, che inietta un rendimento vuoto — e non duplicato.

- [ ] **Step 2: Fai girare le prove e guardale cadere**

Run: `npm test -- test/uscita-ective-cablaggio.test.js`
Atteso: FAIL. L'ultima cade sulla prova di ieri, che asserisce `tempo_residuo_ective.valore === null`.

- [ ] **Step 3: Riscrivi la prova `batterie in carica: niente esce`**

`test/uscita-ective-cablaggio.test.js:67-76` asserisce che a pacco in carica la durata non si dà. Con la media si dà. La parte su `consumo_ective` resta **identica** — è il non obiettivo del disegno — e cambia solo la parte sulla durata, con il commento che dice perché le due frasi non si contraddicono.

- [ ] **Step 4: Collega la media alla durata**

`tempo_residuo_ective` divide `residuo_wh` per il consumo **recente**; quando la media non c'è, ricade sull'istantaneo e il `perche` lo dice. Il `perche` porta sempre la finestra e la parte in carica, nelle parole che la pagina usa già (`dilloInOre`, `conti.js:33`).

`tempo_residuo_bluetti` **non si tocca**: il disegno lo lascia fuori, e la ragione sta scritta lì (letture ogni quindici minuti, di ripiego non archiviate, zero campioni quando il cloud rifiuta).

- [ ] **Step 5: Prove verdi, e guarda la pagina**

Run: `npm test`
Atteso: PASS. Poi la pagina, col riavvio del server, per leggere la frase per quel che è.

- [ ] **Step 6: Commit**

```bash
git add servizi/src/lib/conti.js servizi/test/uscita-ective-cablaggio.test.js
git commit -m "L'autonomia si calcola sulla media recente, con la finestra scritta accanto"
```

---

### Task 7: Il consumo a riposo si misura dalle notti

**Files:**
- Modify: `servizi/src/lib/consumo.js`
- Test: `servizi/test/consumo-riposo.test.js`

**Interfaces:**
- Consumes: `misure` — `watt` delle batterie, `pannelli_w` dello SmartSolar (`agente.py:455`, sempre scritto e **zero di notte** perché `agente.py:89` lo calcola sempre), `uscita_dc_w` della Bluetti (`src/lib/bluetti.js:672`).
- Produces:
  ```js
  export function consumoARiposo(righe, { a, batterie, notti = NOTTI })
  // → { watt: number|null, notti: number, campioni: number, perche_manca: string|null }
  export const NOTTI, SOLE_SPENTO_W, NOTTE_MINIMA_MINUTI
  ```

- [ ] **Step 1: Scrivi le prove**

```js
test('il riposo esclude le ore col sole', () => {
  // Di giorno si misurerebbe il consumo AL NETTO del sole, piu' basso del
  // vero. E' la stessa attenzione che il proprietario ha avuto il 16/11/2026
  // sommando i +0,5 A dei pannelli ai -0,29 A delle batterie.
  const r = consumoARiposo([...notte(12), giorno(2)], ...);
  assert.ok(Math.abs(r.watt - 12) < 1, `watt = ${r.watt}`);
});

test('il riposo esclude le notti in cui la Bluetti alimentava il 12 V', () => {
  // Un'altra fonte invisibile: con la Bluetti sul 12 V il pavimento scende
  // sotto il vero, lo stesso errore del sole con un altro nome.
  const r = consumoARiposo([...notte(12), notteConBluettiDc(2)], ...);
  assert.ok(Math.abs(r.watt - 12) < 1);
});

test('il riposo e’ il PAVIMENTO, non la media: un’ora di Truma non lo alza', () => {
  const r = consumoARiposo(notteConTruma(12, 900), ...);
  assert.ok(r.watt < 30, `watt = ${r.watt}`);
});

test('una notte sola e strana non decide', () => {
  const r = consumoARiposo([...notti(3, 12), unaNotteStrana(60)], ...);
  assert.ok(Math.abs(r.watt - 12) < 3);
});

test('senza notti buone il numero NON si da’, e non si ricade sull’11 W', () => {
  const r = consumoARiposo(soloGiorno(), ...);
  assert.equal(r.watt, null);
  assert.ok(r.perche_manca);
});

// Review Focus 4
test('se lo SmartSolar tace, la ragione e’ «non so quando era notte»', () => {
  // L'assenza di pannelli_w NON e’ notte: il Bluetooth perde annunci anche
  // in pieno giorno, e leggerla come notte farebbe entrare ore diurne --
  // ancora il verso ottimista.
  const r = consumoARiposo(senzaPannelli(), ...);
  assert.equal(r.watt, null);
  assert.match(r.perche_manca, /quando era notte/);
});
```

- [ ] **Step 2: Fai girare le prove e guardale cadere**

Run: `npm test -- test/consumo-riposo.test.js`
Atteso: FAIL, `consumoARiposo` non esiste.

- [ ] **Step 3: Scrivi `consumoARiposo`**

Una notte è un tratto in cui `pannelli_w` è **presente** e sotto `SOLE_SPENTO_W`, lungo almeno `NOTTE_MINIMA_MINUTI`, e in cui l'uscita 12 V della Bluetti non era sopra zero. Il valore è il **livello basso stabile** della potenza che esce dal pacco su quei tratti: il modo di prenderlo è del costruttore, con il vincolo che una notte sola e strana non lo muova, e che il `perche` dica su quante notti e quanti campioni è fatto.

- [ ] **Step 4: Prove verdi, e tutta la suite**

Run: `npm test`
Atteso: PASS.

- [ ] **Step 5: Commit**

```bash
git add servizi/src/lib/consumo.js servizi/test/consumo-riposo.test.js
git commit -m "Il consumo a riposo si misura dalle notti senza sole, invece di stare in tabella"
```

---

### Task 8: `consumo_fermo_w` misurato, e «quanto dura fermo» conta tutto

**Files:**
- Modify: `servizi/src/lib/conti.js:515-521` (`out.giorni_fermo_bluetti`), e `conti.js:185` (`fermoW`)
- Modify: `servizi/src/lib/db.js:45` (la nota di `consumo_fermo_w`) e la migrazione
- Modify: `servizi/public/app.js:1028` (il nome della riga)
- Test: `servizi/test/uscita-ective-cablaggio.test.js` o un file nuovo `test/durata-fermo.test.js`

**Interfaces:**
- Consumes: `consumoARiposo(...)` dal compito 7; `uscitaEctive(...).residuo_wh` dal compito 1; `conti.carica_residua` (Wh della Bluetti, già c'è).
- Produces: niente che altri compiti usino.

- [ ] **Step 1: Scrivi le prove**

```js
test('il consumo a riposo misurato VINCE su quello in tabella', async () => {
  const c = await conti(istantanee(-6, -4), { storico: notti(4, 25) });
  assert.match(c.giorni_fermo_bluetti.perche, /25/);
  assert.doesNotMatch(c.giorni_fermo_bluetti.perche, /\b11 W\b/);
});

test('senza notti si ricade sulla tabella, come STIMA e con la sua data', async () => {
  const c = await conti(istantanee(-6, -4), { storico: [] });
  assert.equal(c.giorni_fermo_bluetti.base, 'stima');
  assert.match(c.giorni_fermo_bluetti.perche, /16\/11/);
});

test('«quanto dura fermo» conta Ective PIU’ Bluetti scontata del rendimento', async () => {
  // Scelta del proprietario, 21/11/2026. Per arrivare al 12 V la corrente
  // della Bluetti passa da inverter e caricatore: se ne perde un quinto.
  const c = await conti(istantanee(-6, -4), { storico: notti(4, 25) });
  // attesa: (residuo_wh Ective + Wh Bluetti * 0,80) / 25 / 24
  assert.ok(c.giorni_fermo_bluetti.valore > giorniSoloBluetti);
});

test('il bollino e’ STIMA, perche’ dentro c’e’ il rendimento stimato', async () => {
  const c = await conti(istantanee(-6, -4), { storico: notti(4, 25) });
  assert.equal(c.giorni_fermo_bluetti.base, 'stima');
  assert.match(c.giorni_fermo_bluetti.perche, /rendimento/);
});

// Review Focus 5
test('rendimento vuoto in tabella: non NaN, si dice cosa manca', async () => {
  // Il rendimento si inietta dalla tabella finta: l'elenco `impianto` del
  // file (test/uscita-ective-cablaggio.test.js:27) non lo contiene, quindi
  // `val(m, …)` lo trova null. Qui va aggiunto con valore null, esplicito.
  const c = await conti(istantanee(-6, -4), { storico: notti(4, 25),
    impianto: [...impianto, { chiave: 'rendimento_bluetti_ective', valore: null,
                              unita: '', nota: '', misurato: false }] });
  assert.equal(Number.isNaN(c.giorni_fermo_bluetti.valore), false);
  assert.ok(c.giorni_fermo_bluetti.mancano.includes('rendimento_bluetti_ective'));
});

test('senza i Wh della Bluetti si usano quelli delle Ective, e si dice quale manca', async () => {
  // `tuttiIConti(bluetti)` prende la Bluetti come argomento: null e' il caso
  // «cloud non collegato», che e' esattamente dove siamo stati oggi.
  const c = await conti(istantanee(-6, -4), { storico: notti(4, 25) });   // bluetti = null
  assert.ok(c.giorni_fermo_bluetti.valore != null);
  assert.ok(c.giorni_fermo_bluetti.mancano.length > 0);
});
```

- [ ] **Step 2: Fai girare le prove e guardale cadere**

Run: `npm test -- test/durata-fermo.test.js`
Atteso: FAIL.

- [ ] **Step 3: Collega il consumo misurato e somma i due pacchi**

Il valore di `consumoARiposo` vince su `val(m, 'consumo_fermo_w')`; quello in tabella resta come ripiego **dichiarato**, con bollino `stima` e la sua data nel `perche`.

Il conto diventa `(residuo_wh delle Ective + Wh della Bluetti × rendimento) / consumo / 24`. Il bollino è `stima` sempre, perché il rendimento è una stima dichiarata tale in tabella, e il `perche` lo dice: un bollino `misurato` su un conto che contiene un numero di catalogo è il difetto che questo piano sta togliendo.

- [ ] **Step 4: Aggiorna la tabella Impianto e il nome della riga**

La nota di `consumo_fermo_w` (`db.js:45`) deve dire che quel numero adesso **si misura da sé** e che quello scritto è il ripiego. Il seed è `ON CONFLICT DO NOTHING` (`db.js:143`), quindi la riga già in produzione **non cambia da sé**: serve una `UPDATE` nella migrazione, sulla nota e sul flag di misurato.

Il nome della riga in `app.js:1028` è `'Il camper sulla Bluetti'` e non descrive più il conto: adesso conta anche le Ective. Il nuovo nome dice che è tutta l'energia di bordo.

- [ ] **Step 5: Prove verdi, tutta la suite, e la pagina**

Run: `npm test`
Atteso: PASS. Poi la pagina col riavvio: la scheda «Quanto dura fermo» col nome nuovo, il bollino `stima`, e il `perche` che nomina il rendimento e la finestra delle notti.

- [ ] **Step 6: Commit**

```bash
git add servizi/src/lib/conti.js servizi/src/lib/db.js servizi/public/app.js servizi/test/durata-fermo.test.js
git commit -F - <<'EOF'
Quanto dura fermo: consumo misurato dalle notti, e tutta l'energia di bordo

L'11 W della tabella era misurato il 16/11/2026, prima che in camper ci
fossero la scatoletta e Starlink, e portava il bollino «misurato»: una
stima travestita. E il conto divideva i Wh della sola Bluetti senza
contare il quinto che si perde fra inverter e caricatore.
EOF
```

---

## Dopo questo piano

Due disegni approvati restano, e ciascuno avrà il suo piano, scritto **dopo** che questo è in porto: toccano `conti.js` e `app.js` negli stessi punti che i compiti qui sopra riscrivono, e pianificarli adesso vorrebbe dire citare righe che non esisteranno più.

- `docs/superpowers/specs/2026-11-21-colonnina-ampere-design.md` — gli ampere della presa, selezionabili accanto al tempo di ricarica
- `docs/superpowers/specs/2026-11-21-zero-vecchio-design.md` — uno zero vecchio diventa `—`
