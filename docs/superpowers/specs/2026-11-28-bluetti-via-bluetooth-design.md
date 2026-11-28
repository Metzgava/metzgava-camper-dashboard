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

**Misure** (entrano nei conti e nello storico), perché verificati a zero e
sotto carico contro l'app:

| misura | registro |
|---|---|
| `carica` | `[102]`, percentuale |
| `entra_w` | `[146]` |
| `esce_w` | `[142]` |
| `stato` | `[161]`: 0 ferma, 1 eroga, 2 carica |

**Dati grezzi** (viaggiano, non entrano nei conti), perché probabili e non
verificati: `[104]` minuti rimasti, `[100]` tensione del pacco, `[101]` watt
dal lato batteria, `[148]`/`[149]` flusso con segno a 32 bit.

`[148]` serve come **contro-prova**: è lo stesso flusso con il segno, e deve
concordare con `entra_w`/`esce_w` entro il consumo dell'elettronica (circa
venti watt, misurati). Se non concorda, la lettura è sospetta e non si
pubblica: è lo stesso principio di `copreLaTappa` nei tracciati.

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
`istantanee` e ogni misura in `misure`. **Quindi lo storico è gratis**, e con
lui la media recente e la durata. Un tipo nuovo, distinto da quello del cloud,
perché i due non vanno confusi mai.

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
