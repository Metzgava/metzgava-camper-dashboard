# La Bluetti letta via Bluetooth, e la durata col riscaldamento acceso — disegno

**28 novembre 2026.** Approcci scelti dal proprietario: **A2 + B1**.
Prerequisito già fatto: `e6dd33a`, il collegamento appeso che si cura da sé.

## Intento, e perché adesso

Camper Servizi legge la Bluetti **dal cloud**. È l'unico apparecchio che non
passa dalla scatoletta, e questo ha due conseguenze che si sono viste entrambe
dal vivo:

- **il cloud può tacere** — il 19/11 il gateway è andato in timeout e la pagina
  è sparita per sedici secondi, Ective e termometri compresi (riparato);
- **il cloud può mentire senza accorgersene**: il quadrante fermo al 100% e
  «esce 0 W» mentre la Bluetti erogava oltre 400 W. Nessun numero era
  sbagliato: erano tutti di diciassette secondi prima. È la direzione
  rassicurante, quella che questo progetto considera la più pericolosa.

E in sosta libera, senza internet, il cloud non c'è affatto — che è
precisamente la condizione in cui sapere quanta corrente resta conta davvero.

**Adesso si può fare, e prima no.** Il 28/11, dopo aver tolto un collegamento
Bluetooth che la nostra stessa sonda le teneva aperto dal 21/11, sono stati
appaiati i registri confrontandoli con l'app e col display nello stesso
minuto:

| registro | cos'è | come è stato verificato |
|---|---|---|
| `[102]` | carica % | 89, 90, 92, 93, 95 — sempre il numero dell'app |
| `[146]` | watt in ingresso | **0 in tutte le fotografie a riposo**, 647 mentre l'app diceva 647 |
| `[142]` | watt in uscita | 0 → 885 → 1733, contro app 0 → 889 → 1,8 kW |
| `[161]` | stato | 0 ferma, 1 eroga, 2 carica |

Il salto decisivo è `[146]` e `[142]` a **zero** quando non passa niente: un
registro che vale zero a riposo e il numero giusto sotto carico è identificato,
uno che coincide una volta sola è un caso.

Da questi quattro numeri esce la cosa che il proprietario ha chiesto: **quanto
dura la carica col riscaldamento acceso.** La Truma in elettrico non si misura
dalla colonnina — nessun sensore a bordo guarda la 220 — ma **si misura
benissimo quando è la Bluetti ad alimentare il 220 del camper**, perché allora
passa dentro un registro che lei già conta. Misurato il 28/11: EL1 = 889 W,
EL2 = 1,8 kW, solo boiler = 884 W.

## Obiettivi

1. La scatoletta legge dalla Bluetti via Bluetooth **carica, watt in ingresso,
   watt in uscita e stato**, e li manda come un apparecchio del pacco, per la
   porta che già esiste.
2. La pagina continua a mostrare il cloud. Quando il cloud è vecchio o tace,
   mostra il Bluetooth — **e dice quale dei due sta mostrando.**
3. Da quelle letture esce la **durata**, con la macchina che la pagina ha già
   per le Ective: media recente, non istante.

## Non obiettivi

- **Comandare** la Bluetti via Bluetooth. Solo lettura. I comandi restano al
  cloud, dove sono adesso.
- Sostituire il cloud. Il cloud sa cose che il Bluetooth non sa (i rami della
  220 e del 12 V, i comandi, la modalità) e resta la fonte principale.
- Misurare la Truma quando il 220 viene dalla colonnina. **È impossibile**, e
  la pagina deve dirlo invece di tacere.
- Identificare altri registri. Quelli probabili restano probabili.

## Anti obiettivi

Cose che renderebbero questo lavoro un fallimento **anche funzionando**:

- **Due numeri della stessa grandezza, da due fonti, affiancati senza dire
  quale è quale.** È già accaduto il 21/11 ed è il guasto peggiore di tutta la
  pagina: un conto fatto fra due istanti diversi produce una frase che non può
  essere vera.
- Una durata calcolata **sull'istante**. Aperta la pagina mentre parte il
  compressore, l'autonomia crolla a poche ore; un minuto dopo dice quaranta.
  Nessuno dei due è sbagliato come misura e tutti e due sono inutili come
  durata.
- Un registro **probabile** mostrato come misurato. `[104]` sembra i minuti
  rimasti e `[100]` sembra la tensione del pacco: sembrano, e il bollino deve
  dirlo.
- **Rubare radio alle Ective.** La radio è una sola: mentre parla con la
  Bluetti non legge le batterie, che sono il cuore della pagina.
- **Lasciare un collegamento appeso.** Riparato in `e6dd33a`, ma una lettura
  ogni due minuti moltiplica per quindici le occasioni di sbagliare rispetto a
  una fotografia ogni mezz'ora.

## Vincoli

- **La radio è una e il giro lento è ogni due minuti.** Le Ective hanno la
  precedenza: oggi costano circa tre secondi ciascuna.
- **`encryption.py` è codice di terzi** — la cifratura V2 di Bluetti, da
  [`sq7lrx/bluetti-elite200v2-mqtt`](https://github.com/sq7lrx/bluetti-elite200v2-mqtt),
  **licenza MIT**, progetto di una persona sola, ultimo aggiornamento
  settembre 2026. **Deciso dal proprietario il 28/11/2026: entra nel
  repository**, in `scatoletta/terze-parti/`, con licenza, provenienza e hash
  accanto (`scatoletta/terze-parti/README.md`). Riletto prima di metterlo
  dentro: non apre rete, non lancia processi, non scrive su disco, non valuta
  codice; di `os` usa solo `os.urandom(4)` per il vettore di
  inizializzazione.
- **L'app del telefono in modalità Bluetooth ruba il posto.** Un apparecchio
  BLE con un cliente attaccato smette di annunciarsi: se il telefono si
  collega, la scatoletta non la sente più. In modalità cloud convivono.
- **Solo i registri verificati diventano misure.** Gli altri viaggiano come
  dati grezzi, senza entrare nei conti.
- Le chiavi stanno in `config.json`, che è fuori dal versionamento. Nessun
  segreto nei registri letti.

## Approcci considerati

### Quanto spendere di radio

- **A1 — a ogni giro lento, lettura intera.** Quaranta secondi ogni centoventi
  sulla Bluetti. Dati ricchissimi; le Ective pagherebbero il conto. Scartato.
- **A2 — solo quando c'è qualcosa da misurare** ← **scelto.** Si leggono
  **tre blocchi invece di undici** (un decina di secondi, non quaranta), e si
  rallenta quando la Bluetti è ferma: a riposo i registri delle potenze sono
  zeri, e uno zero non vale la radio.
- **A3 — sessione dichiarata**, un tasto «registra la notte» come la serata di
  taratura. Più preciso, ma va chiesto ogni volta: non risponde alla domanda
  «quanto mi dura stanotte» se nessuno ha premuto il tasto.

### Chi comanda sulla pagina

- **B1 — cloud primario, Bluetooth come riserva e controllo** ← **scelto.**
  Oggi non cambia niente; il Bluetooth entra quando il cloud tace o serve
  vecchio, e la scheda dichiara la fonte. Copre esattamente il guasto del
  21/11.
- **B2 — Bluetooth primario.** Fresco per costruzione, ma esiste solo quando
  la radio ha avuto il suo turno e la scatoletta è in camper: più buchi, e la
  pagina perderebbe i rami della 220 e del 12 V che solo il cloud dà.
- **B3 — entrambi mostrati sempre.** Il più onesto e il più affollato: due
  righe per ogni numero su una pagina che si guarda da un telefono.

## Il come, nelle parti già decise

### Quali registri diventano misure, e quali no

**Misure** (entrano nei conti e nello storico), perché verificate a zero e
sotto carico contro l'app:

| misura | registro |
|---|---|
| `bt_carica` | `[102]`, percentuale |
| `bt_entra_w` | `[146]` |
| `bt_esce_w` | `[142]` |

I nomi sono **distinti** da quelli del cloud, e non per gusto: `/storia`
disegna una linea per apparecchio, e due serie della stessa grandezza per la
stessa batteria fisica rifarebbero nel grafico l'anti obiettivo numero uno —
due numeri della stessa cosa senza dire quale è quale. Vanno aggiunte a
`AMMESSE` in `ingresso.js`, che altrimenti le rifiuta e scrive una riga di
evento a ogni giro.

**Dati grezzi** (viaggiano in `dati`, non entrano nei conti né nello storico):
`[161]` stato, `[104]` minuti rimasti, `[100]` tensione del pacco, `[101]`
watt dal lato batteria, `[148]`/`[149]` flusso con segno a 32 bit.

`[161]` sta **qui e non fra le misure**, al contrario di quanto diceva la
prima stesura: è un codice 0/1/2, non una quantità. Una misura ha una scala e
una media; «eroga» non si fa la media.

### La contro-prova di `[148]` non è un cancello

`[148]` è lo stesso flusso con il segno e **dovrebbe** concordare con
`bt_entra_w`/`bt_esce_w` entro il consumo dell'elettronica (circa venti watt,
misurati). La prima stesura ne faceva la **condizione per pubblicare**, e
sarebbe stato un errore: di quel registro non conosciamo con certezza né
l'ordine delle due parole, né la convenzione del segno, né se la tolleranza
sia assoluta anche a 1733 W. Sbagliare uno di quei tre avrebbe prodotto un
«nessun dato» **silenzioso e permanente** — e un silenzio che si spiega con
una nostra ipotesi sbagliata è peggio di un numero con un'avvertenza.

Quindi: **si pubblica comunque, e il disaccordo si scrive.** Nel diario e
accanto al dato. Se dopo qualche settimana concorda sempre, allora diventa un
cancello, con i dati in mano.

E i tre blocchi sono **tre domande separate**: `[142]`, `[146]` e `[148]`
stanno nello stesso blocco (140) e sono quindi dello stesso istante; `[161]`
sta nel 160 e non lo è. Il confronto si fa **solo dentro il blocco 140**.

### La lettura sulla scatoletta

- **Tre blocchi**: 100, 140, 160. Coprono tutte e quattro le misure.
- **Nessuna scansione in più**: la Bluetti si trova nella scansione che
  `giro_bluetooth` fa già per le Ective, per prefisso di nome (`EL300`).
- **Cadenza**: a ogni giro lento quando `[161]` non è 0; **un giro ogni dieci
  minuti quando è 0**, perché a riposo non c'è niente da sapere. Il passo a
  riposo è un campo di `config.json`, non un numero nel codice.
- **Le Ective prima.** La Bluetti si legge dopo di loro, e se il giro è già
  lungo si salta: una lettura in meno della Bluetti è un buco, una lettura in
  meno delle Ective è la pagina che si svuota.
- **Dopo ogni lettura, il controllo dei collegamenti** di `collegamenti.py`.
  Gli stessi tre strati della sonda, qui dentro un servizio che non si ferma.
- Se `encryption.py` non c'è, la Bluetti si salta **e lo si dice una volta
  sola** nel diario, come si fa per gli apparecchi SwitchBot che non misurano.

### Sul server

Il pacco arriva per `/api/ingresso`, che già mette ogni apparecchio in
`istantanee` e ogni misura in `misure`. **Quindi lo storico è gratis.** Un
tipo nuovo, distinto da quello del cloud, perché i due non vanno confusi mai.

**Ma la Bluetti non entra nel pacco delle Ective**, e qui la prima stesura
sbagliava: avevo scritto «diventa un apparecchio del pacco come le Ective».
`consumoRecente` → `usciteDelPacco` calcola il netto come **meno la somma**
delle medie per apparecchio sulla grandezza `watt`, su un elenco di chiavi di
batteria. Infilarci la Bluetti con un `watt` firmato le farebbe sommare i suoi
watt a quelli del pacco servizi: due impianti diversi in un unico bilancio, e
un numero sbagliato che nessuno sospetterebbe perché ha la faccia giusta.

La durata della Bluetti si calcola quindi con la **stessa forma** — media
recente sui soli intervalli di scarica, finestra dichiarata accanto, ripiego
sull'istante **detto** — su `bt_esce_w` di quel solo apparecchio.

**La cadenza regge la soglia, ma solo quando serve.** La macchina chiede
almeno dieci campioni e il 50% di copertura su una finestra di due ore: a
passo di dieci minuti non si arriverebbe mai, e la durata cadrebbe per sempre
sull'istante. Ma il passo lento da dieci minuti vale **solo quando `[161]` è
0**, cioè quando non entra e non esce niente — e allora non c'è nessuna durata
da calcolare. Quando la Bluetti lavora si legge a ogni giro lento: a due
minuti sono sessanta campioni in due ore, e la soglia passa larga.

### In pagina

- Il cloud resta primario. Il Bluetooth si usa quando la lettura del cloud è
  `vecchia`, o quando i suoi zeri sono stati soppressi perché vecchi
  (`ZERI_VECCHI_DOPO_MINUTI`).
- **La scheda dichiara la fonte**, sempre, anche quando è il cloud: un numero
  senza provenienza su una pagina che ne ha due è il guasto del 21/11 che
  torna.
- **La durata passa dalla macchina che esiste**: media recente sui soli
  intervalli di scarica, con la finestra scritta accanto, e il ripiego
  sull'istante **dichiarato** quando la media non c'è.
- **Un avviso quando il 220 viene dalla colonnina**: in quella condizione i
  consumi a 220 non passano dalla Bluetti e non si vedono. Senza questa riga,
  una durata lunga sembrerebbe una buona notizia invece di una misura cieca.

## I buchi trovati dal controllo del costruttore, e come si chiudono

Un lettore fresco ha provato a progettare su questo documento il 28/11 e ha
trovato undici posti dove avrebbe dovuto indovinare. Tre erano errori veri —
corretti sopra: `[161]` fra le misure, `[148]` come cancello, la Bluetti nel
pacco delle Ective. Gli altri sono scelte, prese qui.

### Quali numeri del cloud il Bluetooth può sostituire, e quali devono tacere

**Il ripiego è per campo, non per scheda**, e ogni risultato dichiara la sua
fonte. Il Bluetooth dà **totali**, il cloud dà **rami**, e dove serve un ramo
un totale non è una sostituzione: è un numero diverso con lo stesso nome.

- Si possono alimentare dal Bluetooth: `carica_residua`, `manca_alla_piena`,
  `saldo_adesso`, `tempo_residuo_bluetti`.
- **Devono tacere e dire perché**: `catena` (vuole la sola uscita in
  alternata), `ingresso` (vuole la divisione fra rete e continua),
  `alla_piena` (vuole la stima della Bluetti), `flusso_bluetti` (è una figura
  a due ingressi e due uscite).

In particolare **`bt_esce_w` non si usa mai dove è attesa `uscita_ac_w`**:
gonfierebbe `catena` di tutto il ramo 12 V, con un bollino `stima` che
nasconde l'errore invece di mostrarlo.

### Quanto può essere vecchia una lettura Bluetooth

Il passo a riposo è dieci minuti e la soppressione degli zeri vecchi del cloud
scatta a cinque: **una lettura Bluetooth può quindi essere più vecchia di
quella che sostituisce.** Quindi:

- il Bluetooth ha **la sua età massima**, e oltre quella non sostituisce
  niente;
- **la regola degli zeri vecchi vale anche per lui**, identica: uno zero di
  nove minuti è la stessa affermazione vecchia che la regola del cloud
  condanna;
- **quando sono vecchi entrambi si mostra il più fresco**, con la sua età
  scritta. Mai il ripiego solo perché è ripiego.

### La raccolta a mano si ritira, e chi resta prende il posto a turno

`raccolta.sh` è un ciclo avviato a mano che fotografa ogni mezz'ora e **non sa
niente** del `RADIO` dell'agente. Due processi sul solo posto Bluetooth della
Bluetti sono la classe di guasto del 21/11 che torna — e peggio: il
«controllo dei collegamenti dopo ogni lettura» farebbe staccare dall'agente
una fotografia in corso.

**Il suo lavoro è finito**: serviva a prendere uno scatto mentre caricava, per
identificare i registri, e il 28/11 li ha identificati. Si ritira (il suo
servizio sta nei drop-in sulla scatoletta, fuori da git: va spento lì).

Per le fotografie a mano, che restano utili: **un file di blocco**. Chi prende
la radio per la Bluetti lo crea, e l'agente salta la lettura finché c'è.
E l'agente **non chiama mai `libera('EL300')` alla cieca**: solo dopo che una
sua propria lettura non ha sentito niente, e solo se il blocco non c'è.

### Cosa fa uscire la Bluetti dal passo lento

Il passo da dieci minuti guarda il `[161]` **precedente**, quindi accendere la
Truma — l'istante esatto in cui la domanda nasce — si saprebbe fino a dieci
minuti dopo. Rimedio: **la risposta a `/api/ingresso` può chiederlo**, come
già fa per la sessione di taratura. Il server sa che la pagina è aperta e sa
cosa dice il cloud: se uno dei due dice che sta lavorando, chiede la lettura
subito.

E al contrario: **durante la taratura la Bluetti si salta**, perché la
taratura porta il giro lento a cinque-sessanta secondi e quel giro tiene
`RADIO`, fermando anche il giro svelto. Lo stesso nel giro svelto.

Il budget della regola «se il giro è già lungo si salta» non è lasciato al
costruttore: **la Bluetti non parte se il giro lento ha già speso più della
metà del suo passo.**

### L'avviso sulla 220 ha tre stati, non due

`origineDella220` deduce l'origine dai rami del cloud e torna `null` su una
lettura vecchia; via Bluetooth la divisione fra rete e fotovoltaico non c'è
affatto. Quindi gli stati sono tre: **la fa la Bluetti / la fa la colonnina /
non si sa**. L'avviso si mostra **sia quando la fa la colonnina sia quando non
si sa**, con parole diverse. C'è anche un buco nella deduzione di oggi: una
Bluetti piena attaccata alla colonnina legge `rete_w = 0`, quindi oggi non
dice niente proprio nel caso in cui la misura della Truma è cieca.

### `bt_esce_w == 0` vale come «non esce niente, 12 V compreso»

**Sì.** `consumoARiposo` scarta gli intervalli notturni usando `uscita_dc_w`,
che il cloud **non archivia nei ripieghi**: senza internet quelle righe non
esistono, il riposo è `null` per ogni notte in sosta libera, e
`giorni_fermo_bluetti` ricade sul numero di tabella. Un `bt_esce_w` a zero
dice «niente in uscita», e dentro quel niente c'è anche il 12 V: è sano, ed è
l'unica cosa che salva il riposo quando si è fuori. Un `bt_esce_w > 0` rende
la notte inutilizzabile per il riposo, come fa oggi `uscita_dc_w > 0`.

### Dove sta `encryption.py` per il servizio

Deciso sopra: in `scatoletta/terze-parti/`, dentro il repository. Il servizio
gira con `WorkingDirectory=~/scatoletta`, quindi la cartella gli è **sorella
di nessuno: figlia**, e `installa.sh` la porta su insieme al resto.
**L'agente non attraversa in `~/sonda/`**: accoppiare il servizio sempre
acceso a una cartella mantenuta a mano è esattamente il difetto che si sta
togliendo. Se il file manca, la Bluetti si salta e lo si dice una volta sola.

## Lasciato al costruttore

Nomi interni, come spezzare i file, la forma esatta della riga che dichiara la
fonte in pagina, e i messaggi del diario.

## La domanda che era aperta, e com'è stata chiusa

**`encryption.py` entra nel repository o resta fuori?** Era fuori per una
ragione scritta e buona: «mettere il codice di altri dentro il proprio
repository è una scelta di licenza e di provenienza da fare con gli occhi
aperti, non un comodo». Ma quella scelta valeva per una **sonda lanciata a
mano**; qui serve al **servizio che gira tutto il giorno**.

**Deciso il 28/11/2026 dal proprietario: dentro.** Sta in
`scatoletta/terze-parti/`, con il testo della licenza MIT, la provenienza, la
data in cui è stato preso e il suo sha256. Non si modifica: se servisse una
modifica si avvolge da fuori, così aggiornarlo resta una sostituzione.

**Il degrado da sé si costruisce comunque**: se il file manca — una scatoletta
non aggiornata, un'installazione a metà — la Bluetti si salta e lo si dice una
volta sola nel diario, invece di far morire il giro.
