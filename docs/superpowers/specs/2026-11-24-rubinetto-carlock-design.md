# Il rubinetto di CarLock: i tragitti senza passare da un file

Disegno, 24/11/2026. Secondo pezzo del lavoro cominciato con
`2026-11-24-tracciati-veri-design.md`, che va letto prima: lì ci sono le
regole su come una traccia si aggancia a una tappa, e quelle non cambiano.

## Che problema risolve

Oggi i dati di CarLock entrano in Camper Viaggi **solo attraverso un file**, e
sono due file diversi:

- l'export normale di `my.carlock.co`, che scarica lui, e dal quale il tasto
  📡 CarLock crea le tappe;
- il file delle posizioni, che si **chiede per email** a `info@carlock.co` e
  arriva quando arriva, dal quale il tasto 📍 Tracciati attacca la strada
  vera.

Il risultato è che i dati ci sono ma non si vedono, perché per vederli devi
ricordarti di andare a prenderli. La frase da cui nasce questo lavoro:

> «quindi ora in futuro se apro date in un viaggio tu in automatico metti le
> tappe che rilevi da carlock senza che io faccia nulla»

## Cosa sappiamo dell'interfaccia, e come lo sappiamo

**Non è documentata né supportata**: CarLock l'ha scritta per il proprio
programma della pagina. Quel che segue è stato misurato il 24/11/2026 con una
sonda, leggendo il loro programma (pubblico, `my-carlock-*.js`) e provando
l'accesso. **Queste righe sono la nostra unica documentazione**: se un giorno
qualcosa smette di funzionare, si riparte da qui.

    POST /v2/user/login
      corpo: {email, password_hash}   password_hash = SHA-256 in esadecimale
      → 201 {token, account_uuid, is_account_owner, vehicles: [uuid]}

    GET  /v2/user/vehicles
      → {vehicles: [{uuid, name, time_zone_id, subscription_tier, …}]}

    GET  /v2/vehicle/<uuid>/trips?ascending=true&date_from=<ms>&date_to=<ms>
             &page=<n>&page_size=<n>&tag=<PERSONAL|BUSINESS>
      → {total_count, trips: [{uuid, start_time, end_time, start_location,
                               end_location, distance, score, tag,
                               locations: [], notifications, beacon}]}

    GET  /v2/trip/<uuid>
      → lo stesso oggetto, ma con `locations` pieno

Intestazioni su tutto: `Accept: application/json`, `X-Client-Type`,
`X-Client-Version`, `X-Client-Locale`; sulle chiamate autenticate `X-Token`
col gettone.

**Le forme esatte delle risposte stanno in `test/fixtures/carlock-api-forme.json`**,
con coordinate e indirizzi **inventati**: i nomi dei campi, i tipi e le unità
di misura sono veri, le posizioni del proprietario non entrano nel
versionamento. Quel file è la specifica da cui si scrivono le prove senza
rete: se le prove finte parlassero una forma indovinata, passerebbero tutte e
la chiamata vera tornerebbe `undefined` su ogni coordinata.

Sette fatti misurati che decidono la forma del lavoro:

1. **L'elenco non porta i punti.** `locations` torna vuoto nell'elenco. Sette
   tragitti di tre giorni sono **5 kB in 0,3 secondi**; i 603 punti di un
   tragitto arrivano solo chiedendo `/trip/<uuid>`.
2. **Tutti gli orari sono millisecondi dal 1970**, in UTC: `start_time`,
   `end_time`, `date_from`, `date_to` e il `timestamp` di ogni punto, tutti
   sulla stessa scala. Il fuso del veicolo è un campo a parte
   (`time_zone_id`, nel nostro caso `Europe/Rome`) e serve a interpretarli.
3. **`distance` è in metri**, non in chilometri. `124929` sono 124,9 km.
4. **I due capi hanno già le coordinate e l'indirizzo.**
   `start_location`/`end_location` portano `latitude`, `longitude` e un
   `address` come **stringa**. I punti della scia invece hanno le coordinate
   ma `address` **nullo**: l'indirizzo ce l'hanno i capi, non la scia.
5. **Lo storico dipende dal piano**, e il nostro è `STANDARD_PLUS`: **12
   mesi**, non 3. Il campo è `subscription_tier` su `/user/vehicles`. (La
   prima versione di questo disegno diceva 3 mesi: era sbagliato, e l'avrebbe
   fatto tacere il cartello su viaggi che si possono ancora chiedere.)
6. **Le pagine si contano da zero**, e senza `page_size` ne tornano **20**.
   `total_count` dice quanti sono in tutto: su un periodo di tre settimane
   fermarsi alla prima pagina perderebbe la coda **in silenzio**, cioè tappe
   che non vengono proposte e nessuno sa perché.
7. **Sul conto c'è un veicolo solo.** Quindi «si prende il primo» funziona --
   ma se un giorno ce ne fosse un secondo (un'auto) porterebbe dentro i
   tragitti sbagliati senza che niente possa accorgersene. Si prende il primo
   e si **scrive quale**, con una variabile d'ambiente che permette di
   sceglierlo.

## L'orologio, che è la trappola di tutto questo lavoro

Trovato dal controllo del costruttore, 24/11/2026. È il difetto che avrebbe
fatto fallire tutto **in silenzio, e solo in produzione**.

Oggi il programma lavora con **orari senza fuso**. `leggiTracciati` legge
`"2026-07-31 17:20:26"` e lo interpreta nel fuso del server;
`finestraDellaTappa` costruisce la mezzanotte con `new Date("2026-07-31T00:00:00")`,
nel fuso del server. Sono tutti e due storti dello stesso tanto, quindi quando
si confrontano **l'errore si annulla** e l'aggancio funziona. Il Mac è a Roma,
Railway è a UTC, e col file va bene in tutti e due i posti.

L'interfaccia invece dà **istanti assoluti**. Confrontarli con una finestra
costruita nel fuso del server significa che su Railway (UTC) la finestra di
una tappa è spostata di un'ora, e la tolleranza è di **tre minuti**: nessuna
traccia si aggancia a nessuna tappa, **mai**, e non c'è nessun errore. In
locale funziona.

**Decisione: il traduttore produce quel che produce il file**, cioè orari da
orologio da parete nel fuso del **veicolo** (`time_zone_id`). I millisecondi
diventano `"2026-11-21 11:18:29"` e `"11:18"` prima di entrare nel programma,
e da lì in poi non cambia niente: `mergeTrips`, `finestraDellaTappa`,
`assegna` vedono la stessa forma che vedevano col file, e la proprietà di
annullamento resta in piedi.

Due conseguenze da rispettare nel piano:

- **la conversione sta in un posto solo**, dentro il traduttore, e si prova
  con una prova che **fallisce** se il fuso del processo è sbagliato
  (`TZ=UTC` e `TZ=Europe/Rome` devono dare lo stesso risultato);
- **non si tocca `TZ` su Railway.** Sarebbe l'altra via -- imporre
  `TZ=Europe/Rome` -- ma sposterebbe in silenzio ogni altra data dell'app per
  risolvere un problema che sta in una funzione sola.

## Obiettivi

- **Aprire un viaggio con delle date e trovare, con un tocco, i tragitti di
  quei giorni già pronti da accettare.** Senza file, senza email, senza
  ricordarsi niente.
- **Durante il viaggio, non dopo.** Le date di un viaggio si fissano **prima**
  di partire -- è il caso normale, non l'eccezione -- e allora il cartello non
  è una cosa che capita una volta a cose fatte: ricompare **ogni volta che un
  giorno del viaggio è passato** e ha dei tragitti da guardare. Il 5 luglio
  offre quelli del 4, il 6 quelli del 5. Richiesta sua, 24/11/2026.
- **Lo stesso rubinetto porta anche i punti**, così la strada vera si attacca
  senza il file che oggi si chiede per email.
- **Il file resta in piedi**, identico, e funziona anche se l'interfaccia
  cambia o viene chiusa.

## Non obiettivi

- **Creare tappe da sé, senza che lui le veda.** Scelta sua, 24/11/2026: vedi
  «Le due strade» qui sotto.
- **Chiedere a orologio.** Nessun lavoro in sottofondo, nessun rinfresco
  periodico. La richiesta parte da un tocco.
- **Toccare chilometri, durata, orari o capi delle tappe esistenti.** Vale la
  stessa regola dell'altro disegno.
- **Rifare i pedaggi e i costi** quando si attacca una traccia.
- **Portare dentro `score`, `tag`, `notifications`, `beacon`.** Ci sono, non
  ci servono adesso, e un campo portato dentro «perché c'era» è un campo da
  mantenere per sempre.

## Anti obiettivi

Cose che renderebbero questo lavoro un danno anche se funzionasse:

- **Che le credenziali di CarLock finiscano in git, in un registro, in un
  messaggio d'errore mostrato in pagina o in una conversazione.**
- **Che il gettone finisca su disco.** Vive in memoria del server: un
  riavvio costa un accesso, non un rischio.
- **Che un giro al supermercato diventi una tappa del viaggio**, e con lei
  una stima di gasolio nei totali.
- **Che una tappa accettata due volte diventi due tappe.**
- **Che un guasto di CarLock diventi un guasto dell'app.** Se l'interfaccia
  non risponde, la pagina lo dice e indica il file. Un tragitto che non
  arriva non deve diventare una tappa senza riga, e nemmeno una pagina rotta.

## Vincoli

- Node 20 ESM, Express, PostgreSQL, prove con `node --test "test/*.test.js"`.
  Non esiste `npm test` nella radice.
- **Le chiamate le fa il server, mai la pagina.** Le credenziali non devono
  avere modo di arrivare al browser, nemmeno per sbaglio.
- Credenziali in `.env` (fuori da git) e nelle variabili di Railway. Precedente
  che funziona da settimane: la Bluetti in Camper Servizi.
- Lingua del codice, dei commenti e della pagina: italiano, nella voce che
  c'è già.

## Le tre strade considerate

**1. Il rubinetto sostituisce il file.** L'interfaccia diventa l'unica via, e i
due tasti del file si tolgono. Meno codice da mantenere, una strada sola da
capire.

*Scartata*: l'interfaccia non è né documentata né supportata. Il giorno che la
chiudono — o che cambiano `password_hash` in qualcos'altro — resteremmo senza
nessun modo di portare dentro i dati, compresi quelli che oggi funzionano.
Il file è la strada **supportata**: si tiene.

**2. Il rubinetto riempie le stesse forme del file.** L'interfaccia non porta
una strada nuova dentro il programma: porta gli stessi dati nella stessa
forma, e da lì in poi passano per il codice che c'è già — `mergeTrips`,
`min_km`, `external_id`, `assegna`, `cuci`. I due tasti del file restano dove
sono.

*Scelta.* È anche la più piccola: quasi tutto quel che serve esiste già, e
quel che manca è un traduttore e un cartello.

**3. Il rubinetto a orologio.** Il server chiede a CarLock ogni notte e si
tiene i tragitti pronti, così la pagina non aspetta mai.

*Scartata*: contro il paletto che ci siamo dati nell'altro disegno — chiedere
solo a comando — e contro il modo in cui questa cosa va trattata. Stiamo
usando un'interfaccia che non ci è stata promessa: chiedere quattro mesi ogni
notte è il modo di farsi chiudere l'accesso.

## Le due strade, e quale ha scelto

Con il rubinetto in piedi, la proposta delle tappe poteva essere di due tipi.

| | Cosa fa | Cosa costa |
|---|---|---|
| **Le mette e basta** | apri le date, trovi le tappe | un giro al supermercato diventa una tappa, e i totali la contano. E un tragitto assegnato male non si nota: il risultato resta plausibile |
| **Aspetta un tocco** | un cartello, e col tocco l'elenco da accettare | un tocco in più |

**Scelta sua, 24/11/2026: aspetta un tocco.**

E questa scelta ha una conseguenza che va detta, perché è l'unico punto in cui
il risultato è diverso da come l'aveva chiesto: **il cartello non può dire
quanti tragitti ci sono prima di aver chiesto.** Saperlo vorrebbe dire
chiamare CarLock a ogni apertura di un viaggio, cioè la strada che ha
scartato. Quindi il cartello dice che *può* guardare, non cosa ha trovato:

    ┌───────────────────────────────────────────────────────────┐
    │ 📡 CarLock ha registrato i vostri spostamenti in questi   │
    │    giorni. Guardo cosa c'è?                 [ Guarda ]    │
    └───────────────────────────────────────────────────────────┘

e dopo il tocco diventa l'elenco che esiste già:

    ┌───────────────────────────────────────────────────────────┐
    │ 7 tragitti fra il 20 e il 22 novembre, 3 sopra i 3 km     │
    │                                                           │
    │ ☑ 21/11  11:18–14:02   184,0 km   Novaledo → Udine        │
    │ ☑ 22/11  09:31–10:48    85,6 km   Udine → Susegana        │
    │ ☐ 20/11  13:32–13:38     1,0 km   (sotto i 3 km)          │
    │                                                           │
    │ Due di questi 3 sono già tappe di questo viaggio.         │
    │                                   [ Crea le tappe ]       │
    └───────────────────────────────────────────────────────────┘

**Quando compare il cartello.** Si decide **senza chiamare nessuno**, coi dati
che la pagina ha già.

La prima versione di questo disegno diceva «quando il viaggio ha almeno una
tappa che non viene dal tracker», e sbagliava, perché le date di un viaggio si
fissano **prima** di partire: un viaggio futuro non ha nessuna tappa, e uno in
corso ne acquista un giorno per volta. Serve una regola che funzioni mentre il
viaggio accade.

Il viaggio porta un segno: **fin dove si è già guardato**
(`carlock_chiesto_fino_a`, un istante). La finestra da chiedere è

    da  = il segno, oppure l'inizio del viaggio se non c'è
    a   = il più piccolo fra la fine del viaggio e ADESSO

e il cartello compare quando quella finestra **non è vuota** e sta dentro lo
storico del piano. Dopo una richiesta il segno avanza fino ad `a`.

Cosa fa cadere al posto giusto:

| Situazione | Cosa succede |
|---|---|
| Viaggio tutto nel futuro | finestra vuota: **nessun cartello**, e nessuna chiamata a vuoto per giorni che non esistono ancora |
| Terzo giorno di un viaggio di dieci | il cartello offre quel che è passato dal segno a ora, **e ritorna domani** |
| Viaggio finito e tutto importato | il segno è alla fine: niente cartello |
| Giorno di sosta, senza tragitti | si guarda, non si trova niente, **il segno avanza comunque**: così un giorno fermo non ripropone lo stesso cartello per sempre |
| Viaggio vecchio, oltre lo storico | niente da chiedere: il cartello **lo dice** invece di non comparire, perché «non c'è più» è un'informazione |

**Non si chiede mai per giorni futuri.** Non ci sono dati e sarebbe traffico
per niente, verso un servizio che ci sta già facendo un favore.

## Com'è fatto dentro

**`src/lib/carlock-api.js`** — l'unico posto che parla con loro. Niente
database, niente Express: una funzione per chiamata, provabili con risposte
finte.

- l'accesso e il gettone, con il rinnovo;
- `tragittiDelPeriodo(uuid, da, a)` → l'elenco;
- `puntiDelTragitto(uuid)` → i punti di uno;
- **la traduzione**: dai loro campi alle forme che il programma già usa —
  quella di `readCarlockFile` per l'elenco (così `mergeTrips` e `min_km`
  funzionano come col file) e quella di `leggiTracciati` per i punti (così
  `assegna` e `cuci` funzionano come col file). È qui che `distance` diventa
  chilometri e i millisecondi diventano orari da parete nel fuso del veicolo
  (vedi «L'orologio»);
- **le pagine**: si cicla da `page=0` fino a coprire `total_count`, con un
  `page_size` dichiarato invece del 20 di default. Una coda persa qui è
  indistinguibile da «CarLock non ha niente per quei giorni».

**Le coordinate si usano, non si ributtano.** La forma di `readCarlockFile`
porta i capi come **nomi** (`from`, `to`), e la rotta dell'import li passa al
geocodificatore — che è il punto debole noto: il 422 «Indirizzo non
riconosciuto», il riquadro «indirizzi non trovati», i tentativi con 250 ms di
pausa l'uno, e tutti gli accorgimenti per i nomi stranieri. L'interfaccia dà
già `latitude`/`longitude` per entrambi i capi. Quindi: **si aggiungono due
campi facoltativi** a quella forma, e la geocodifica si salta quando ci sono.
Il file continua a passare per la strada di prima, che non si tocca: senza
coordinate, si geocodifica come sempre. È il guadagno più grande del
rubinetto dopo il non dover chiedere il file, e buttarlo via per non aggiungere
due campi sarebbe un affare cattivo.

**Quale veicolo.** Il primo di `vehicles`, con `CARLOCK_VEHICLE_UUID` in
`.env` che permette di sceglierne un altro. Oggi sul conto ce n'è uno solo:
domani, con un secondo tracker, «il primo» porterebbe dentro i tragitti
dell'auto senza che niente possa accorgersene.

**Il gettone.** Vive in memoria. Nessuna scadenza dichiarata nella risposta,
quindi non si indovina: si usa, e **al primo 401 si rifà l'accesso una volta
sola**. Se anche quello fallisce, si smette e lo si dice. Mai due accessi di
fila per la stessa richiesta: è il modo di farsi bloccare l'account, e lo
abbiamo già visto fare danni col gettone della Bluetti.

**Due rotte**, dentro un viaggio come i tasti del file:

    GET  /api/trips/:id/carlock/tragitti   l'elenco del periodo, senza salvare,
                                           piu' quali previste sostituirebbe
    POST /api/trips/:id/carlock/tappe      crea le tappe scelte, con le strade
                                           vere, e toglie le previste spuntate

Due, non tre: le strade arrivano col tocco che crea le tappe, quindi non
serve una rotta a parte. La prima rifà quel che fa già `?preview=1`
dell'import, con l'elenco che arriva dall'interfaccia invece che da un file;
la seconda unisce la creazione delle tappe e l'aggancio delle tracce, cioè
quel che oggi sono due bottoni e due file.

Il tasto 📍 Tracciati col file **resta dov'è**: serve ancora per i viaggi
vecchi, quelli importati prima che esistesse il rubinetto.

**Il riuso è il punto.** Quel che non si riscrive: `mergeTrips`, `min_km` (3),
`merge_gap_min` (30), il vincolo unico su `(trip_id, external_id)` che impedisce
i doppioni, la geocodifica con cache, `assegna`, `cuci`, `finestraDellaTappa`,
`periodoDelViaggio`, `resoconto`. Se questo disegno fa riscrivere una di queste
cose, è il disegno a essere sbagliato.

**Gli identificativi.** Col file l'`external_id` è
`carlock:<data>:<inizio>:<fine>`, costruito dagli orari come stanno scritti nel
CSV (e le tappe unite prendono i pezzi uniti da `+`). L'interfaccia dà un
`uuid` vero, che sarebbe più solido — ma usarlo farebbe nascere **due tappe
per lo stesso tragitto** se uno arriva dal file e l'altro dal rubinetto, e il
vincolo unico su `(trip_id, external_id)` non se ne accorgerebbe.

**Decisione: il rubinetto costruisce lo stesso `external_id` del file.** Può
farlo, perché il traduttore produce già gli stessi orari da parete: la data e
i due orari ci sono. L'`uuid` dell'interfaccia si tiene da parte per chiedere
i punti, e non diventa un identificativo di tappa. Costo: se un giorno
cambiassero il formato degli orari nell'export, i due smetterebbero di
coincidere — ed è un caso che si nota subito, perché compare un doppione, non
perché sparisce qualcosa.

**I numeri non li manda il browser.** `POST /carlock/tappe` riceve **soltanto
gli uuid scelti**, e i chilometri e gli orari se li va a riprendere dal
rubinetto. Quei numeri diventano gasolio, pedaggi e totali del viaggio: una
pagina che li rimanda indietro è una pagina che li può cambiare. Costa una
chiamata in più per accettazione, ed è il prezzo giusto.

## Un tocco solo

Scelta sua, 24/11/2026, sulla proposta qui sotto.

**Il tocco porta tappe e strade insieme.** Accettare un tragitto chiede anche
i suoi punti e disegna subito la strada percorsa. Due conseguenze, e sono
entrambe guadagni:

- **la strada ricostruita non si calcola nemmeno.** Oggi l'import chiama i
  percorsi per scegliere la strada che misura quanto il contachilometri;
  sarebbe lavoro buttato, sostituito due secondi dopo dalla traccia vera. Si
  salta;
- **`scarto_ricostruzione_km` resta `null`**, e stavolta è la verità piena:
  non c'è stata nessuna ricostruzione da confrontare. Il numero serve a dire
  quanto sbagliava il ricostruttore, e qui non ha ricostruito niente.

**Se i punti non arrivano** per un tragitto -- l'interfaccia che inciampa su
uno solo -- quella tappa nasce comunque, con la strada **ricostruita** come
col file e senza il bollino della traccia vera. Il resoconto lo dice. Meglio
una tappa con una strada dedotta, dichiarata tale, che nessuna tappa.

**E sostituisce le tappe previste, facendole vedere prima.** Le pianificate
che il tragitto rimpiazzerebbe compaiono nel riquadro **con la spunta già
messa**: così il tocco è uno e i chilometri non si contano due volte, ma
niente sparisce senza che lui l'abbia visto. Togliendo la spunta, la tappa
prevista resta -- e allora è una sua scelta, non una distrazione del
programma.

    ┌───────────────────────────────────────────────────────────┐
    │ 7 tragitti fra il 20 e il 22 novembre, 3 sopra i 3 km     │
    │                                                           │
    │ ☑ 21/11  11:18–14:02   184,0 km   Novaledo → Udine        │
    │ ☑ 22/11  09:31–10:48    85,6 km   Udine → Susegana        │
    │ ☐ 20/11  13:32–13:38     1,0 km   (sotto i 3 km)          │
    │                                                           │
    │ Al loro posto togliresti 2 tappe previste:                │
    │   ☑ Novaledo → Udine   190 km previsti                    │
    │   ☑ Udine → Susegana    88 km previsti                    │
    │                                                           │
    │              [ Crea le tappe e prendi le strade ]         │
    └───────────────────────────────────────────────────────────┘

Con il gasolio stimato delle previste, che se ne va con loro: è la regola che
il «Sostituisci con CarLock» del file applica già.

## Cosa resta a chi costruisce

- Le parole esatte dei messaggi d'errore, nella voce dell'app. Il contenuto no:
  un guasto dell'interfaccia dice *cos'è andato storto* e *che il file
  funziona ancora*.
- Dove sta il cartello nella scheda del viaggio, e il suo aspetto.
- La forma interna di `carlock-api.js`, purché le chiamate siano isolate e
  provabili senza rete.
- Se la scelta dei tragitti nel riquadro riusa il modulo che c'è già per
  l'import da file o ne vuole uno suo.

## Come si capisce se funziona

Non «le prove passano», ma:

- aprendo il viaggio del 20–22 novembre compare il cartello, e col tocco
  arrivano i 7 tragitti in meno di un secondo;
- accettando Novaledo → Udine nasce **una** tappa da 184,0 km, con gli orari
  11:18–14:02 e il percorso vero che **non** passa per Bassano — e nasce
  **già** con la strada vera, senza un secondo comando;
- la tappa prevista che sostituisce era spuntata nel riquadro, se ne va con la
  sua stima di gasolio, e i chilometri del viaggio non la contano due volte;
- togliendo quella spunta, la prevista resta e il programma non si lamenta;
- rifacendo la stessa cosa non nasce una seconda tappa, e il resoconto lo dice;
- su un viaggio con le date nel futuro il cartello **non compare**, e non
  parte nessuna chiamata;
- su un viaggio in corso il cartello **ritorna** il giorno dopo, e offre solo
  i giorni nuovi;
- su un giorno di sosta si guarda, non si trova niente, e il cartello **non
  ricompare** per quel giorno;
- con `TZ=UTC` — cioè come gira su Railway — le tracce si agganciano alle
  tappe esattamente come con `TZ=Europe/Rome`;
- staccando la rete, il cartello dice che CarLock non risponde e che il file
  funziona ancora — e il resto della pagina non si accorge di niente;
- in `.env` e nei registri non c'è traccia della password, e il gettone non
  esiste su disco.
