# Pianificazione di un viaggio: la lavagna, i giorni, il budget

Progetto · 13 novembre 2026

## Perché

Metz e Caterina preparano i viaggi **a voce**. Qualcuno dice «c'è
quell'area sosta vicino a Bodø», l'altro annuisce, e due settimane dopo
nessuno dei due si ricorda il nome. Le proposte non si perdono perché
sono brutte: si perdono perché non hanno un posto dove stare.

Quello che manca non è un'app di viaggi. È **un posto dove mettere in
fila le proposte, e poi scegliere**: cosa, dove, come e quando. Il
viaggio su cui serve adesso è il Lofoten 2027, che in archivio esiste già
e sta fra quelli «in costruzione».

## Obiettivi

1. Ogni proposta — un posto dove dormire, un'area sosta, una cosa da
   vedere — ha un posto dove stare, con chi l'ha proposta e perché.
2. Si decide insieme: tutti e due possono dire la loro su ogni proposta,
   e si vede chi ha detto cosa.
3. Quello che si sceglie **diventa** il viaggio, senza ricopiare niente.
4. Si pianifica senza sapere le date, e si confermano in un colpo solo.
5. Si sa quanto costerà, con un margine di errore onesto, prima di
   partire.

## Non obiettivi

- **Non** si copia park4night. Dal codice si prendono **nome, coordinate
  e tipo del posto** (vedi «Dal codice al puntino»), non le foto né le
  recensioni: quelle restano là, e il collegamento ce le porta.
- **Non** si fa lavoro simultaneo in tempo reale. Sono in due, spesso
  nella stessa stanza; la pagina si ricarica e si vede quello che ha
  scritto l'altro. Niente cursori che si muovono.
- **Non** si tocca il viaggio in corso né quello concluso. La
  pianificazione vive solo nei viaggi «in costruzione».
- **Non** si fanno prenotazioni dall'app. Si segna che sono state fatte,
  da chi, e quando scade l'opzione.

## Anti obiettivi

Cose che, se succedessero, vorrebbero dire che abbiamo sbagliato anche
se tutto funziona:

- **Dover ricopiare.** Se alla partenza bisogna trasformare a mano il
  piano in viaggio, il piano non lo userà nessuno.
- **Un modulo da riempire.** Se aggiungere una proposta costa più di
  venti secondi, le proposte torneranno a voce.
- **Un budget che mente.** Un numero tondo senza dire da dove viene è
  peggio di nessun numero.
- **Due posti dove sta la stessa cosa.** Se un campeggio esiste come
  proposta *e* come sosta, prima o poi divergono.

## Vincoli

- Node 22 · Express 5 · PostgreSQL · frontend vanilla (niente build
  step) · Leaflet. Si costruisce con quello che c'è.
- Le tabelle si creano da sole all'avvio (`ALTER TABLE ... IF NOT
  EXISTS` in `src/lib/db.js`): niente migrazioni a mano.
- Ogni cambio di `public/app.js` o `public/style.css` vuole il numero di
  versione alzato in tre punti (`VERSIONE`, `index.html`,
  `ospite.html`).
- Mobile prima di tutto: si pianifica dal divano, col telefono in mano.
- I viaggi sono già comuni a tutti gli utenti approvati: Caterina può
  già modificare tutto. Non serve nessun sistema di permessi nuovo.
- Chi guarda da un collegamento di sola lettura (`ospite.html`) non
  scrive niente, qui come altrove.

## Le strade considerate

**A — Dentro al viaggio «in costruzione».** Nessuna modalità nuova:
quando `trips.status = 'bozza'`, la pagina del viaggio cambia faccia e
mostra lavagna, giorni e budget. Riusa tappe, soste, spese e mappa.

**B — Un ambiente «Pianificazione» separato**, con i suoi dati, che alla
fine *genera* il viaggio. Mano libera nel disegno, ma due concetti per
ogni cosa (il posto proposto e la sosta) e un passaggio di consegne dove
si perde roba.

**C — Solo la lavagna** attaccata al viaggio: niente giorni, niente
budget. Piccola, risolve subito il problema vero, ma non dà né le date
né i conti.

**Scelta: A**, in tre tempi — prima la lavagna, poi i giorni che si
confermano, poi il budget. La B è stata scartata perché il suo passaggio
di consegne è esattamente l'anti obiettivo numero uno. La C è il primo
tempo della A, non un'alternativa.

Questo documento descrive per intero **il primo tempo**; il secondo e il
terzo sono disegnati quanto basta a non costruire qualcosa che poi li
impedisca.

---

# Primo tempo: la lavagna dei posti

## Cos'è

Una **proposta** è un posto che qualcuno ha visto e vorrebbe. Non è
ancora niente: non ha una data, non sta in nessun giro, non costa
niente. Ha un nome, un puntino, chi l'ha proposta e due righe di perché.

Vive uno stato alla volta:

```
💡 proposto  →  👀 da guardare  →  ✅ scelto
                                ↘  🚫 scartato (col perché)
```

**Scelto** è l'unico stato che fa succedere qualcosa: da lì, con un
tocco, la proposta **diventa una sosta vera** del viaggio. La proposta
resta, e si ricorda quale sosta è diventata.

## Cosa si vede

Nella pagina del viaggio, quando è in costruzione, una scheda nuova in
cima — sopra la mappa, che è la prima cosa che si guarda quando si
pianifica.

```
┌─ 🗒️ Lavagna ────────────────────── + Aggiungi un posto ─┐
│  [ tutti ]  [ 💡 3 ]  [ 👀 2 ]  [ ✅ 4 ]  [ 🚫 1 ]       │
│                                                          │
│  ┌────────────────────────────────────────────────────┐  │
│  │ 🛏️  Area sosta Kabelvåg              💡 proposto   │  │
│  │ Metz · park4night 277443 ↗                         │  │
│  │ «sul porto, dicono si senta il mare dalla finestra»│  │
│  │ ~25 €/notte                                        │  │
│  │ ──────────────────────────────────────────────────  │  │
│  │ Metz 👍   Cate 🤔 «lontano dal giro del secondo    │  │
│  │                    giorno»                          │  │
│  │ [👍] [🤔]            [👀 da guardare] [✅ scegli]  │  │
│  └────────────────────────────────────────────────────┘  │
│                                                          │
│  ┌────────────────────────────────────────────────────┐  │
│  │ 🏕️  Camping Lofoten                   ✅ scelto    │  │
│  │ Cate · 32 €/notte · ⛺ è la sosta «Giorno 6»       │  │
│  └────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
```

Sul telefono le schede stanno una sotto l'altra, a tutta larghezza; i
filtri in cima scorrono in orizzontale.

**Sulla mappa** del viaggio le proposte compaiono come puntini, con il
colore dello stato: scelto nel verde di casa, proposto e da guardare in
giallo, scartato grigio e spento. Si accendono e si spengono dalla
legenda, come gli altri strati.

## Aggiungere un posto in venti secondi

Un modulo corto, con dentro solo quello che serve:

- **Dove** — la ricerca del luogo che c'è già (`geoInput`), che dà nome e
  coordinate. Oppure il codice park4night qui sotto, che la riempie da
  solo.
- **Cos'è** — 🛏️ dormire · ⏸️ sosta breve · 👀 da vedere.
- **Codice park4night** *(facoltativo)* — il numero della scheda, o
  l'indirizzo intero incollato. Da lì arrivano **nome e coordinate da
  soli**: non serve altro. Vedi «Dal codice al puntino».
- **Quanto costa** *(facoltativo)* — a notte.
- **Perché** — due righe. È il campo che conta: fra tre mesi è l'unica
  cosa che spiega la proposta.

Tutto il resto si aggiunge dopo, toccando la scheda.

**Scorciatoia:** l'app già cerca da sola i posti intorno a ogni arrivo
(OpenStreetMap, `cercaSosteArrivo`) e li mostra sotto la tappa. Accanto
a ciascuno va un tasto **«+ in lavagna»**: un tocco e diventa una
proposta, con nome, coordinate e collegamento park4night già dentro.
È la via più veloce per riempire la lavagna, e non costa quasi niente
perché quei dati ci sono già.

## Dal codice al puntino

La scheda di un posto su park4night porta dentro, nella pagina, il
collegamento per farsi portare lì da Google Maps — e quel collegamento
ha le coordinate. Provato il 13 novembre 2026 su tre codici veri:

| codice | risposta | coordinate | nome |
|---|---|---|---|
| 277443 | 200 | 45.095570, 7.347378 | (10057) Avigliana · SP 188 |
| 25870 | 200 | 45.501699, 6.922854 | (73320) Camping Onlycamp · Tignes |
| 341330 | 200 | 44.939110, 6.683162 | (05100) Camping Huttopia La Clarée |

Un codice che non esiste risponde 404 pulito, e si dice «questo codice
non lo trovo».

Nella pagina c'è anche il **tipo** del posto (campeggio, area di
servizio, area picnic…), e si prende. Il **prezzo** no: nella pagina i
numeri col simbolo dell'euro stanno anche dentro alle recensioni, e
prendere il primo che capita vuol dire scrivere una cifra sbagliata con
l'aria di essere giusta. Il prezzo lo si mette a mano.

**Come si fa, e cosa si promette.** Si legge la pagina **una volta
sola**, quando si incolla il codice — mai a ripetizione. Quello che
torna si salva e da lì in poi è roba nostra. È la pagina pubblica, non
un servizio ufficiale: se park4night la cambia, l'importazione smette di
funzionare e **nient'altro si rompe** — compare «non sono riuscito a
leggerla, metti tu il posto sulla mappa», e si va avanti come prima. La
stessa cosa serve alle soste che hanno già il codice ma non le
coordinate: un tasto per andarsele a prendere.

## Il collegamento apre l'app di park4night

park4night dichiara i **collegamenti diretti all'app** per gli indirizzi
`*/place/*` e `*/lieu/*` (verificato il 13 novembre 2026 sul suo
`apple-app-site-association`). Quindi l'indirizzo che l'app già
costruisce dal codice — `park4night.com/it/place/277443`, cioè
`linkPark4nightPosto` — su un iPhone che ha park4night installato
**apre l'app sulla scheda del posto**, con le foto e le recensioni; su
tutto il resto apre il sito. Non c'è niente da costruire: va solo usato
quel formato.

Dove il codice non c'è, il collegamento resta quello della ricerca per
coordinate (`/it/search?lat=…`), che **non** è fra quelli dichiarati e
quindi apre il browser. È una ragione in più perché il codice valga la
pena di metterlo, e va detto in chiaro accanto al campo.

## Portami lì

Con le coordinate in mano, ogni proposta ha due tasti:

- **🗺️ Google Maps** — le indicazioni, come già fa l'app per le soste.
- **🧭 Mappe** — `maps.apple.com`, che su iPhone apre direttamente
  l'app Mappe invece del browser. Oggi non c'è da nessuna parte e sul
  telefono è quello che si usa.

Vanno anche sulle soste vere e sui posti trovati lungo la tappa: è la
stessa riga di tasti, scritta una volta.

## Dire la propria

Ogni persona ha **un voto** per proposta — 👍 mi piace, 🤔 non mi
convince — e **una riga di commento** accanto. Si cambiano quando si
vuole. Non è una votazione che decide: è il modo di non doverne
riparlare a voce ogni volta.

Sono in due: basta così. Niente discussioni a thread, niente risposte
alle risposte.

## Quando una proposta diventa una sosta

Il tasto **«✅ scegli»** la porta nello stato scelto. Da lì, **«⛺ fanne
una sosta»** crea una sosta vera del viaggio con dentro quello che la
proposta sa già: nome, coordinate, tipo, codice park4night,
collegamento, e il **perché** (che diventa il «perché ci si è fermati»
della sosta). La sosta nasce **senza date** — le date arrivano col
secondo tempo.

**Il prezzo non passa.** Una sosta con un costo diventa da sola una
spesa vera del viaggio, datata oggi e cambiata al cambio di oggi: un
campeggio scelto a novembre finirebbe nei conti di un viaggio di giugno.
Niente è ancora stato speso. Il prezzo resta sulla proposta, a notte, ed
è il terzo tempo a farne un'ipotesi.

Da quel momento **la sosta è la verità**: la scheda della proposta
mostra nome e posto della sosta, non più la sua copia, e si modifica
sulla sosta. «Fanne una sosta» su una proposta che ce l'ha già apre
quella, non ne fa una seconda. Riportarla indietro (👀 o 🚫) si rifiuta
finché la sosta c'è: *«prima togli la sosta»*.

Se la sosta viene cancellata, la proposta torna semplicemente a essere
una proposta scelta senza sosta. Nessun orfano.

**Come si traduce il tipo** nei tipi di sosta che già esistono:

| sulla lavagna | diventa | perché |
|---|---|---|
| 🛏️ dormire | `camping` se park4night dice campeggio, se no `area_sosta` | `pernotto` nelle soste non esiste più |
| ⏸️ sosta breve | `sosta` | è già quello |
| 👀 da vedere | `sosta` | anche una visita è una fermata: così entra nel viaggio e nel filmato |

**Contro i doppioni:** se il codice park4night di una proposta è già di
una sosta di quel viaggio, non se ne fa una seconda — si dice *«questo
posto c'è già come sosta»* e si collega quella.

## I dati

```sql
CREATE TABLE IF NOT EXISTS proposte (
  id SERIAL PRIMARY KEY,
  trip_id INT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  user_id INT REFERENCES users(id) ON DELETE SET NULL,  -- chi l'ha proposta
  tipo TEXT NOT NULL DEFAULT 'pernotto',   -- pernotto | sosta | visita
  nome TEXT NOT NULL,
  lat DOUBLE PRECISION,
  lon DOUBLE PRECISION,
  p4n_id TEXT,
  link TEXT,
  tipo_p4n TEXT,                           -- com'è classificato su park4night
  prezzo NUMERIC(8,2),                     -- a notte
  currency TEXT,
  perche TEXT,                             -- perché la propongo
  stato TEXT NOT NULL DEFAULT 'proposto',  -- proposto | guardare | scelto | scartato
  perche_no TEXT,                          -- perché è stata scartata
  stop_id INT REFERENCES stops(id) ON DELETE SET NULL,
  posizione INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS proposte_voti (
  proposta_id INT NOT NULL REFERENCES proposte(id) ON DELETE CASCADE,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  voto SMALLINT NOT NULL,                  -- 1 mi piace · -1 non mi convince
  commento TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (proposta_id, user_id)
);
```

Il voto e il commento stanno nella stessa riga perché sono la stessa
cosa: cosa ne penso e perché. Sono in due; una tabella di commenti
separata sarebbe una struttura per un problema che non hanno.

## Le chiamate

```
GET    /api/trips/:id/proposte        elenco, coi voti dentro
POST   /api/trips/:id/proposte        nuova
PUT    /api/proposte/:id              cambia (stato compreso)
DELETE /api/proposte/:id
POST   /api/proposte/:id/voto         { voto, commento }
POST   /api/proposte/:id/sosta        ne fa una sosta, torna la sosta
```

Le proposte arrivano già dentro a `GET /api/trips/:id` insieme a tutto
il resto, così la pagina si disegna in una volta sola — come fanno già
soste, spese e materiali.

## Quando si parte

Un viaggio che parte (`bozza → open`) **tiene la sua lavagna**, ma la
scheda sparisce dalla pagina: in viaggio non si guarda più. Resta
raggiungibile da un tasto nel riepilogo del viaggio, per rileggersi cosa
si era scartato e perché.

---

# Secondo tempo: i giorni che si confermano

Disegnato qui solo quanto basta a non costruire niente che lo impedisca.

Finché il viaggio è in costruzione non si scrivono date: si scrivono
**giorni**. Il viaggio ha una **finestra provvisoria** in parole
(«fine giugno, 18-20 giorni») e ogni tappa e ogni sosta hanno un
**numero di giorno** invece di una data.

Quando si decide, si fissa **la data di partenza**: tutti i numeri
diventano date vere in un colpo solo. Spostando la partenza, si rifà
tutto da sé.

Ogni riga può portare il bollino **da confermare** (il traghetto è
prenotato? il campeggio ha risposto?), con chi se ne occupa e quando
scade l'opzione.

Cosa vuol dire per il primo tempo: le soste nate dalla lavagna nascono
**senza date**, e nessuno deve inventarne.

# Terzo tempo: il budget

Una **ipotesi di spesa** per categoria, accanto a quelle vere, nelle
stesse categorie delle spese che già esistono.

Il gasolio si calcola dai chilometri del giro e dal consumo del camper
(il calcolatore delle varianti di percorso c'è già). I campeggi si
sommano dalle proposte **scelte**, col loro prezzo a notte per le notti
che ci si sta. Vitto ed extra si mettono a tanto al giorno.

Quando si parte, l'ipotesi resta accanto al vero: a fine viaggio si vede
di quanto si era sbagliato. È il numero che serve per il viaggio dopo.

Cosa vuol dire per il primo tempo: la proposta porta già **prezzo e
valuta**, così il budget non dovrà rincorrerli.

---

## Le decisioni prese leggendo il codice

Un costruttore esterno ha letto questo documento e il codice, e ha
chiesto sei cose. Cinque le ho decise qui; nessuna cambiava cosa si
vuole, solo come si fa.

1. **Il prezzo non diventa una spesa** (sopra). Era il rischio peggiore:
   le spese si scrivono da sole quando una sosta ha un costo.
2. **Dopo la conversione comanda la sosta** (sopra): niente due verità
   per lo stesso posto.
3. **Il tipo si traduce** come nella tabella sopra, e il *perché*
   diventa il *motivo* della sosta — che è esattamente la stessa
   domanda.
4. **Niente «tocca la mappa» nel primo tempo.** Oggi nell'app non esiste
   da nessuna parte e sarebbe un modo di lavorare tutto nuovo. La
   ricerca del luogo, il codice park4night e il tasto «+ in lavagna» sui
   posti trovati lungo la tappa coprono i casi veri, e tengono in piedi
   la regola dei venti secondi. Se dopo la prova sul Lofoten servirà, si
   aggiunge.
5. **Il primo tempo non toglie niente.** «＋ Sosta» e «🔎 Alle
   destinazioni» restano dove sono. Togliere una strada che funziona il
   giorno in cui se ne apre un'altra è il modo migliore per far odiare
   quella nuova; contro i doppioni basta l'avviso sul codice.
6. **La lettura di park4night** l'ho riprovata come la farebbe il
   server, non col browser: con l'identificativo che l'app usa già e
   anche senza nessuno — risponde 200 tutte e due le volte. Resta da
   vedere se risponde uguale da Railway, che esce da un indirizzo di
   centro dati: perciò **403, 429 e tempo scaduto si trattano come il
   404 pulito** — «non sono riuscito a leggerla, mettilo tu sulla
   mappa». Il tasto per recuperare le coordinate delle soste che hanno
   già il codice lavora **una sosta alla volta**, quando lo si tocca:
   niente recuperi in blocco.

## Quello che resta a chi costruisce

- Come disegnare le schede della lavagna nel dettaglio, purché a telefono
  stiano una sotto l'altra e il perché si legga senza aprire niente.
- Dove mettere esattamente il tasto «+ in lavagna» fra i posti trovati
  lungo la tappa.
- Se le proposte scelte vadano in cima all'elenco o restino in ordine di
  arrivo (si suggerisce: scelte in cima, scartate in fondo e spente).
- I colori dei puntini sulla mappa, dentro la tavolozza di casa.
- Come si cancella una proposta per sbaglio e si recupera (va bene anche
  solo una conferma prima di cancellare).

## Come si capisce che funziona

Dopo il primo tempo, Metz e Caterina riempiono la lavagna del Lofoten
2027 con i posti che oggi si dicono a voce. Se dopo una settimana la
lavagna è piena e la discussione è lì invece che in cucina, il primo
tempo ha fatto il suo lavoro. Se è vuota, il modulo è troppo lungo o la
scheda è nel posto sbagliato, e si sistema prima di fare il secondo
tempo.
