# La strada ricostruita: dirlo, e lasciarla correggere

**Data:** 21/11/2026
**Stato:** da approvare

## Perché

Il proprietario, guardando un viaggio importato da CarLock: *«perché il
tracciato caricato da carlock da novaledo a udine passa per bassano invece non è
vero perche siamo passati per vidor e pieve di soligo?»*

Non era un errore di CarLock né una misura sbagliata. **I chilometri e gli orari
di quella tappa sono veri; la strada no.** L'esportazione di CarLock ha solo
queste colonne:

```
Data, Orario di inizio, Orario di fine,
Posizione di inizio, Posizione di fine, Distanza (km), Durata, ...
```

Due punti, nessuna traccia. Vidor e Pieve di Soligo non sono sulla mappa perché
CarLock non li ha mai mandati, e il programma lo sa: in `geo.js` c'è già
scritto *«CarLock registra quanto si è percorso, non per dove»*.

La riga sulla mappa la disegna `percorsoVicinoAiKm`, che fra le strade possibili
prende quella i cui chilometri sono più vicini ai km veri, scartando quelle che
nel tempo vero non ci stanno. È un accorgimento già pagato con un difetto — da
Piacenza a Treviso disegnava la statale a chi era corso in A4, perché la statale
misura meno — e funziona. Ma i candidati sono **due al massimo**: il più rapido,
e quello senza pedaggi quando c'è la chiave di OpenRouteService. Senza chiave,
**uno solo**.

Via Vidor non è né il più rapido né quello senza pedaggi: **non era sulla
scheda.** Nessun confronto sui chilometri poteva trovarla.

### Il difetto non è il percorso: è che la pagina non l'ha detto

La frase c'è, ed è giusta:

> «Chilometri e orari veri dal tracker. La strada sulla mappa è ricostruita:
> CarLock non registra il percorso.»

Ma sta in un `title=`, cioè in un suggerimento che compare passando il mouse.
**Sull'iPad il mouse non c'è: quella frase non esiste.** Il proprietario ha
visto una riga su una mappa e l'ha letta per quel che sembra — una
registrazione. È la stessa classe di difetto dello zero vecchio della Bluetti,
sistemato lo stesso giorno: il dato onesto c'era, la pagina lo diceva dove non
si legge, e la forma ha vinto sulla riga piccola.

Due cose che avrebbero dovuto accorgersene e non l'hanno fatto:

- **l'avviso «strada da ridisegnare»** scatta quando la riga disegnata
  differisce dai km veri di oltre il massimo fra 15 km e l'8 %. Su Novaledo-Udine
  sono circa 15 km, e via Bassano contro via Vidor differiscono di meno;
- **il tasto «Ridisegna»** rifà lo stesso conto con gli stessi candidati: qui
  ridarebbe Bassano.

## Obiettivi

1. **Una strada ricostruita non deve sembrare una traccia**, su qualunque
   apparecchio e senza passare il mouse.
2. **Il proprietario può dire per dove è passato**, e la riga si rifà passando
   da lì. È l'unica cosa che può produrre la strada vera: quell'informazione la
   ha solo lui.
3. Quando l'ha detto, la pagina lo scrive — la riga non diventa una traccia, ma
   diventa una ricostruzione **che passa dove lui dice**, e si vede la
   differenza fra le due cose.

## Non obiettivi

- **Non si chiedono più alternative al navigatore.** Era la terza strada
  considerata e il proprietario l'ha scartata con me: più candidati vuol dire
  più occasioni di scegliere male con l'aria di aver scelto bene, e la strada
  fatta può semplicemente non essere fra quelle che un router propone.
- **Non si tocca `percorsoVicinoAiKm`.** Il confronto sui chilometri col tetto
  sul tempo funziona e ha già pagato il suo difetto: resta quel che fa quando
  nessuno ha detto per dove.
- **Non si importa una traccia da CarLock.** Non ce l'ha.
- **Non si tocca la riga del traghetto e dell'aereo**, né quella delle strade
  alternative fuori mappa.

## Anti obiettivi

- **Sovrascrivere i chilometri veri.** Sono la cosa che CarLock misura davvero,
  e sono la base del gasolio e dei totali del viaggio. Il ridisegno cambia
  **solo la geometria**; `distance_km` e `duration_min` non si toccano mai, per
  nessuna ragione.
- **Un tratteggio che vuol dire due cose.** Sulla mappa il tratteggio è già
  preso due volte, e un terzo significato sullo stesso disegno non è una
  spiegazione, è un indovinello.
- **Far sparire la riga** quando è ricostruita. Dire «non so per dove» facendo
  scomparire il viaggio dalla mappa sarebbe peggio: i due estremi e i
  chilometri si sanno.

## Vincoli

- **Il tratteggio è già occupato.** Oggi sulla mappa: linea piena nel colore del
  camper = tappa su gomma; linee **lunghe** nel colore degli altri mezzi =
  traghetto e aereo, «quella non è una strada che si può percorrere»; linee
  **grigie medie** e sottili = strade alternative non in mappa.
- **Ma un linguaggio per «dedotto» il progetto lo ha già**, e viene dall'altra
  app: nella figura delle batterie *«il tratteggio del ramo dedotto è fatto di
  punti; quello degli altri di linee»*. I punti vogliono già dire «questo non
  l'ho misurato».
- La geometria sta in `legs.geometry` come `[[lat,lon],...]`; le tappe
  importate hanno `source='carlock'`.
- `percorsiConTappe(punti)` sa già calcolare un percorso **attraverso punti
  intermedi**: la macchina per l'obiettivo 2 esiste e non va riscritta.
- Il geocoding dei nomi scritti a mano esiste già (`geocode`,
  `addressCandidates`), con la sua cache e la sua pausa per non martellare i
  servizi gratuiti.
- La grammatica della casa vale anche qui: `—` è «non so», e un numero
  dedotto porta il suo bollino.

## Le strade considerate

Per il **come si vede** (obiettivo 1):

**A. Punti nel colore del camper.** **Scelta.** Resta una tappa su gomma — il
colore lo dice — e i punti dicono che la strada è dedotta. Non collide col
traghetto (linee lunghe, altro colore) né con le alternative (grigio, sottile),
e riusa un significato che il progetto ha già stabilito altrove.

**B. Colore più pallido, linea piena.** Scartata: il pallido si legge come
«meno importante», non come «non misurato», e su uno schermo al sole non si
distingue affatto.

**C. Lasciare la linea piena e scrivere solo la frase.** Scartata come unica
strada: la frase serve comunque, ma una riga piena su una mappa dice
«registrazione» più forte di quanto una frase sotto possa smentire. È
esattamente l'errore dello zero vecchio.

Per la **correzione** (obiettivo 2):

**D. Un campo «ci siamo passati per…» sulla tappa, con più nomi.** **Scelta.**
Il proprietario ne ha nominati **due** nella stessa frase — Vidor e Pieve di
Soligo — quindi un nome solo non basta. I nomi si geocodificano e il percorso si
rifà attraverso quei punti con la macchina che già esiste.

**E. Trascinare la riga sulla mappa col dito.** Scartata: su un iPad si fa più
danno che strada, e il risultato sarebbe una linea disegnata a mano che non è
né una traccia né una strada percorribile.

**F. Scegliere fra le alternative del navigatore in un elenco.** Scartata: è la
terza strada già scartata insieme, con un vestito nuovo. Se la strada fatta non
è fra le alternative, nessun elenco la contiene.

## Come si fa

### 1. La riga ricostruita si vede per quello che è

Su una tappa `source='carlock'` **senza** punti intermedi dichiarati, la riga si
disegna nel colore del camper e **a punti**. Il tratto dei punti va scelto
abbastanza fitto da leggersi come una linea continua da lontano e abbastanza
distinto da non confondersi col tratteggio del traghetto da vicino; va scritto
come costante con il suo perché, accanto agli altri colori della mappa.

Vale in **tutte e due** le mappe che disegnano le tappe (quella semplice del
riquadro e quella a strati del viaggio), perché un significato che cambia da una
mappa all'altra è peggio di nessun significato.

Il popup della riga, che già dice tappa, estremi, km e durata, dice anche che la
strada è ricostruita.

E **la frase esce dal suggerimento**: sotto la tappa, per scritto, dove si legge
anche senza mouse. Resta corta — una riga — e dice le due cose separate: i
chilometri e gli orari sono veri, la strada è ricostruita.

### 2. «Ci siamo passati per…»

Sulla tappa si può dichiarare uno o più punti intermedi, scritti come si
scrivono i nomi dei posti. Si geocodificano con la macchina che c'è già, e il
percorso si rifà **attraverso** di essi.

Cosa cambia e cosa no:

- **la geometria** si rifà passando da quei punti;
- **i chilometri e la durata non si toccano** — sono di CarLock, sono veri, ed è
  l'anti obiettivo scritto sopra;
- `pedaggio_km` si ricalcola, perché dipende dalla strada;
- un nome che non si trova **non si butta in silenzio**: si tiene scritto e si
  dice che non si è trovato, come fa già l'import col suo elenco di indirizzi
  non geocodificati.

Il **verso** conta: i punti dichiarati si attraversano nell'ordine in cui sono
scritti. Due nomi nell'ordine sbagliato darebbero una strada che torna
indietro, e la pagina deve poterlo far vedere invece di raddrizzarlo di
nascosto — chi guarda la mappa se ne accorge subito, il programma no.

### 3. Quando l'ha detto, la riga lo dice

Una tappa con punti dichiarati **resta una ricostruzione** — le strade fra Vidor
e Pieve di Soligo le sceglie ancora il navigatore — ma non è più la stessa cosa
di prima, e la differenza va vista:

- i punti dichiarati si **segnano sulla mappa**, perché sono l'unica parte di
  quella riga che viene da chi c'era;
- la frase sotto la tappa cambia: non più «ricostruita fra i due estremi» ma
  «ricostruita passando per Vidor e Pieve di Soligo, come hai detto tu»;
- il tratto resta **a punti**, perché resta dedotta. Questo è deliberato: la
  tentazione di «promuoverla» a linea piena quando il proprietario ha parlato è
  esattamente il modo di ricominciare a chiamare traccia una deduzione.

### 4. L'avviso dei chilometri resta, e adesso dice qualcosa

L'avviso «strada da ridisegnare» confronta la lunghezza della riga coi km veri.
Con i punti dichiarati quel confronto diventa più utile: se la strada per Vidor
misura molto diverso dai km di CarLock, o i punti sono sbagliati o si è passati
anche da altrove. La soglia non si cambia in questo lavoro — non sappiamo ancora
se è giusta — ma il testo dell'avviso deve tener conto dei punti dichiarati,
invece di proporre un «Ridisegna» che li ignorerebbe.

### 5. Le prove

Scritte prima, e devono cadere prima di passare:

- **i chilometri veri non si muovono** quando si rifà la strada: è l'anti
  obiettivo, e va pinnato da una prova e non promesso;
- un percorso **attraverso un punto dichiarato** passa vicino a quel punto, e
  quello senza no — la prova che il lavoro fa quel che dice;
- **due punti si attraversano nell'ordine scritto**;
- un nome **non trovato** non spegne il ridisegno degli altri e viene riferito;
- la riga di una tappa CarLock **senza** punti dichiarati si disegna a punti;
- la riga di una tappa CarLock **con** punti dichiarati si disegna **ancora** a
  punti (la promozione a linea piena è il difetto da non fare);
- il tratto a punti **non è** quello del traghetto né quello delle alternative:
  tre significati, tre tratti distinti, pinnati da una prova che li confronta;
- la frase sulla strada ricostruita **non vive solo in un `title=`**: è la
  ragione per cui si sta facendo questo lavoro, e una prova che legge il
  sorgente lo tiene fermo, come fa già quella delle tacche di sicurezza.

## Cosa resta al costruttore

- I nomi dei campi nuovi e la forma in archivio (una colonna JSONB con i punti,
  oppure nome e coordinate separati; i punti sono pochi e ordinati).
- Il disegno esatto del tratto a punti, dentro il vincolo dei tre significati
  distinti.
- Il testo delle frasi, in italiano piano come il resto della pagina.
- Come si scrivono i punti nel riquadro di modifica della tappa: un campo solo
  con i nomi separati, o un campo per punto che si aggiunge.
- Se il ridisegno parte da sé appena si salvano i punti, o con un tasto.

## Le decisioni dopo la revisione

Un revisore ha letto il disegno e il codice e ha trovato otto punti dove un
costruttore avrebbe dovuto indovinare. Nessuno di questi era una domanda per il
proprietario: sono scelte tecniche, e qui ci sono con il loro perché. Una però
ha fatto emergere **un difetto che esiste oggi**, e quella cambia il lavoro.

### Il difetto che c'era già: due tocchi cancellano i chilometri veri

Su una tappa CarLock, aprendo «Modifica» la pagina chiede da sé le strade
possibili e le mostra. Se si tocca una variante, `PUT /legs/:id` scrive
`distance_km` e `duration_min` **della variante** al posto di quelli di
CarLock — e da lì scendono il gasolio, i totali del viaggio e il costo al km.

```js
const sceltoDaFuori = p => (…) ? { distance_km: num(p.distance_km), … }
} else if (scelto) geo = scelto;
…  geo.distance_km, geo.duration_min,   // scritti nella tappa
```

Non è un difetto di questo lavoro: c'è da prima. Ma l'anti obiettivo scritto
sopra dice «per nessuna ragione», e una prova che lo dichiara accanto a un buco
aperto è peggio di nessuna prova.

**Cura:** su una tappa `source='carlock'` la scelta di una strada cambia **il
disegno e niente altro**. Il selettore resta — scegliere la strada giusta è
proprio quel che serve — ma i chilometri e la durata restano quelli del tracker.
Pinnato da una prova.

### Con i punti dichiarati si confrontano ancora le strade sui chilometri

`percorsiConTappe` torna **due varianti** (la più rapida e, con la chiave ORS
che è configurata, quella senza pedaggi), non una geometria. Quale si disegna?

**Quella che misura più vicino ai km veri**, come fa oggi `percorsoVicinoAiKm`
sul percorso diretto. Serve un aiuto nuovo in `geo.js` che applichi la stessa
regola al percorso passante.

Perché: i chilometri sono la cosa che CarLock misura davvero, e scegliere fra
due strade quella che li rispetta è la regola che il progetto ha già stabilito e
già pagato. Usarne una diversa a seconda che il proprietario abbia parlato o no
vorrebbe dire due regole per lo stesso numero.

E l'avviso del §4 **resta utile**, al contrario di quel che la revisione
temeva: il confronto sui km sceglie la più vicina **fra due**, e se tutte e due
sono lontane dai km veri l'avviso scatta comunque. È proprio il caso che
interessa — punti sbagliati, o si è passati anche da altrove.

### I punti vincolano ogni strada che ridisegna, non solo quella nuova

La geometria di una tappa si riscrive in quattro posti. Letto il codice:

- l'**import** crea tappe nuove, che punti non ne hanno ancora: non c'è niente
  da rispettare;
- un **reimport** non tocca le tappe CarLock già esistenti — l'inserimento è
  `ON CONFLICT (trip_id, external_id) DO NOTHING`, e `sostituisci` cancella solo
  le tappe previste, quelle senza `external_id`. **I punti sopravvivono da sé**,
  e questo va pinnato da una prova perché resti vero;
- **«Ridisegna»**, **`PUT /legs/:id`** e **«Porta nella tappa»** devono passare
  dai punti quando ci sono.

Il contrario — vincolare solo la rotta nuova — vuol dire che un «Ridisegna»
cancella in silenzio l'unica informazione che viene da chi c'era. È la classe di
difetto che questo lavoro chiude, ricreata dentro la cura.

### I punti si dichiarano solo sulle tappe CarLock

Il §2 era scritto in generale, e va stretto. La regola del tratto a punti è
«questa strada è la ricostruzione di un viaggio che è successo», e si applica
dove c'è una misura che la contraddice: una tappa CarLock ha i **chilometri
veri** accanto a una strada dedotta, e sono quei due numeri insieme a mentire.

Su una tappa scritta a mano i chilometri **sono** quelli del navigatore: riga e
numero dicono la stessa cosa, e non c'è nessuna misura da tradire. Resta piena.
Su una tappa in preparazione la riga è una **scelta**, non una deduzione.

Così il linguaggio della mappa resta senza ambiguità, che è il male che i «tre
tratti, tre significati» vogliono evitare. Un campo per le tappe a mano è un
altro lavoro, se un giorno servirà.

### I chilometri di autostrada seguono la strada, e l'anti obiettivo si stringe

L'anti obiettivo diceva «cambia solo la geometria». Non è esatto, e va corretto:
`pedaggio_km` **dipende dalla strada**, quindi cambia con lei.

La distinzione che conta è un'altra: **CarLock misura i chilometri e il tempo;
i chilometri di autostrada non li misura.** L'anti obiettivo protegge quel che è
misurato, non tutto quel che è scritto. Quindi il ridisegno rifà il pedaggio.

Resta un buco noto e dichiarato: oggi non c'è modo di sapere se il pedaggio
l'ha scritto il proprietario a mano, e `«Ridisegna»` lo sovrascrive già da
prima. Segnarlo richiederebbe una colonna nuova, e non è questo lavoro: va
**scritto nella pagina**, così chi ha messo un numero a mano sa che un ridisegno
lo rifà.

### La riga a punti arriva anche all'ospite, e la frase con lei

La mappa del viaggio è condivisa con la pagina dell'ospite, quindi il tratto a
punti ci arriva da sé — ma la riga di tappa dell'ospite non ha né il bollino né
la frase, e **l'ospite è l'unico che guarda quella mappa senza sapere niente di
un tracker.** L'obiettivo 1 dice «su qualunque apparecchio»: ci va anche lì,
nella riga e nella legenda.

### Il tratto a punti è il quarto significato, non il terzo

Il vincolo ne elencava tre. Il revisore ha trovato il quarto: l'elenco `TRATTI`
contiene già un `1 6` a punti, per la traccia del **secondo atleta** sulla
stessa mappa.

Quindi il passo dei punti del camper va scelto **diverso da tutti quelli di
`TRATTI`**, e la prova confronta contro l'elenco intero invece che contro i tre
nominati a mano. È la differenza fra una prova che passa e una regola che tiene:
così impedisce anche a un futuro quinto significato di riusare lo stesso tratto.

### Il campo nuovo sta accanto alle note, e le due etichette dicono la differenza

Nel riquadro di modifica c'è già «Soste lungo la strada e note», e i suoi esempi
sono proprio posti attraversati. I due campi stanno accanto e non si fondono:
nessuna migrazione, nessuna nota riscritta. Ma le etichette devono dire quale
dei due **disegna** e quale no, altrimenti si scrive nel posto sbagliato e non
succede niente — che è il modo di far credere che la correzione non funzioni.
