# La Bluetti via Bluetooth: cosa c'è, e cosa costa

**Ricerca del 19/11/2026.** Non è un disegno: è quel che si sa prima di
decidere.

## Perché se n'è parlato

Oggi il cloud di Bluetti ha avuto una giornata storta: prima ha rifiutato i
comandi e le letture per ventotto minuti col codice 805, poi il suo gateway è
andato in timeout e — per un difetto nostro, ora corretto — si è portato giù
l'intera pagina per sedici secondi.

Una Bluetti letta via Bluetooth dalla scatoletta, a tre metri, non passa dal
loro cloud: niente gettoni da rinnovare, niente gateway che non risponde, e
funziona anche in montagna senza campo.

## La scoperta: esiste una strada ufficiale

[`bluetti-official/bluetti-home-assistant`](https://github.com/bluetti-official/bluetti-home-assistant)
è l'integrazione **pubblicata da Bluetti**. Nella sua tabella, l'**Elite 300
(EL300)** ha il segno di spunta su **BLE Control**.

Quindi non si tratta di ricavare un protocollo da zero, come temevo stamattina.
Il codice è Python, è pubblico, ed è dichiarato `iot_class: local_polling`.

Dettagli utili, letti nel codice:

- **Caratteristiche Bluetooth:** scrittura `0000ff02-…`, notifiche `0000ff01-…`.
- **Protocollo:** stile MODBUS; fra le dipendenze c'è `crcmod`, e il
  riconoscimento del modello si fa leggendo il registro 110.
- **Riconoscimento della cifratura:** si legge **dall'annuncio**. Serve
  cifratura quando il nome dell'apparecchio è il suo numero di serie **e** i
  dati di costruttore contengono `BLUETTF`.
- **La stretta di mano** è a sfida e risposta, in sei passaggi.

## Il prezzo, che è la cosa da decidere

La parte crittografica **non è nel sorgente**. Sta in una libreria compilata
(`.so`) che il caricatore **scarica a ogni bisogno** da `download.bluetti.app`.
Tre cose da sapere, lette in `bluetti_lib_loader.py`:

1. **È un binario chiuso.** Girerebbe sulla scatoletta, dentro il camper, con
   accesso alla radio Bluetooth. Non si può leggere cosa fa.
2. **Le architetture dichiarate sono tre:** `linux_aarch64_musl`,
   `linux_x86_64_gnu`, `linux_x86_64_musl`. Il Raspberry Pi Zero 2 W è
   `aarch64`, ma Raspberry Pi OS usa **glibc**, non musl. Se non esiste una
   build `aarch64_gnu`, la strada ufficiale sul nostro apparecchio **non parte
   affatto**.
3. **Il controllo di integrità è a metà.** C'è un `SHA256SUMS`, ma: se non si
   riesce a scaricarlo si prosegue senza verificare; una libreria **appena
   scaricata** non viene confrontata col checksum (si controlla solo che
   cominci coi byte magici di un ELF); e le dipendenze non si controllano
   affatto. Nessuna firma.

Il punto 3 non è un cavillo: vuol dire che la scatoletta eseguirebbe un binario
preso dalla rete fidandosi del fatto che l'indirizzo sia quello giusto.

## L'altra strada: la comunità

[`warhammerkid/bluetti_mqtt`](https://github.com/mariolukas/Bluetti_ESP32_Bridge)
e le sue biforcazioni parlano lo stesso protocollo MODBUS **senza cifratura**,
per gli apparecchi più vecchi. Per i modelli «V2» esistono biforcazioni che
implementano la cifratura in Python — per esempio
[`sq7lrx/bluetti-elite200v2-mqtt`](https://github.com/sq7lrx/bluetti-elite200v2-mqtt),
che dichiara di avere la cifratura dentro al codice e di non richiedere chiavi,
e [`Patrick762/bluetti-bt-lib`](https://github.com/sscarduzio/bluetti-bt-lib),
che elenca l'Elite 200 V2 in sola lettura.

Nessuna di queste fonti nomina l'Elite 300. Sono tutte non ufficiali: possono
smettere di funzionare al primo aggiornamento del firmware.

## Le due misure che decidono, prima di scrivere una riga

Costano cinque minuti e vanno fatte **dalla scatoletta**, non dai forum.

**1. L'Elite 300 chiede la cifratura?** Si ascolta il suo annuncio e si guarda
se i dati di costruttore contengono `BLUETTF`. Se **non** c'è, è un apparecchio
in chiaro: basta il lavoro della comunità, niente binari da scaricare, e la
strada diventa semplice.

**2. Che architettura ha la scatoletta?** `uname -m` e la libc. Se è
`aarch64` con glibc e Bluetti non pubblica quella build, la strada ufficiale è
chiusa comunque.

## Le tre uscite possibili

| se… | allora |
|---|---|
| niente `BLUETTF` | protocollo in chiaro: si fa, con poco, e senza binari |
| `BLUETTF` e build per la nostra architettura | si fa, ma eseguendo un binario chiuso scaricato dalla rete: è una scelta da fare con gli occhi aperti |
| `BLUETTF` e nessuna build buona | resta solo la cifratura in Python delle biforcazioni, scritta per un altro modello: ricerca di dimensione ignota |

## Una cosa che resta vera in tutti e tre i casi

I **comandi** sono un discorso separato dalle **letture**. Leggere un
apparecchio con un protocollo ricavato è un conto; scrivergli un interruttore
che regge i 220 V del camper è un altro. Si decide dopo, e separatamente.

---

# L'esito della sonda — 19/11/2026, dal camper

Le due misure e la sonda sono state fatte. **La strada è aperta.**

## Le misure

```
architettura:  aarch64          libc: GLIBC 2.41 (Debian)
EL3002605110301917     -43 dBm   costruttore: BLUETTF  → cifratura SÌ
CHARGER 22617110080795 -53 dBm   costruttore: BLUETTF  → cifratura SÌ
```

Quindi la strada **ufficiale è chiusa per noi**, e non per congettura: chiesto
al loro server, `aarch64` esiste solo in versione musl.

```
.../bluetti_ble_linux_aarch64_313_musl.so  → 200
.../bluetti_ble_linux_aarch64_313_gnu.so   → 404
.../bluetti_ble_linux_x86_64_313_gnu.so    → 200
```

Raspberry Pi OS è glibc. La loro integrazione è pensata per Home Assistant OS,
che gira su Alpine, e Alpine è musl.

## La sonda: la cifratura in Python funziona

Presa da `sq7lrx/bluetti-elite200v2-mqtt`, letta prima di eseguirla — nessuna
rete, nessun processo, nessuna scrittura su disco; dipende da `cryptography`
(già presente, la usiamo per le Victron) e da `pyasn1`.

Su **tutti e due** gli apparecchi:

```
cifratura dall'annuncio: True
*** STRETTA DI MANO RIUSCITA ***
```

Lo scambio ECDH si chiude e nasce la chiave di sessione. Nessuna chiave da
estrarre dal telefono, nessun file di chiavi, nessun binario da scaricare,
nessun contenitore: le costanti stanno nel sorgente e sono quelle del firmware.

E i registri si leggono davvero. L'Elite 300, registro 110:

```
01 03 0c 4c45 3033 0030 ...
```

Invertendo i byte di ogni registro, come vuole il MODBUS: **`EL300`**. È il
modello, nello stesso posto in cui lo cerca il codice ufficiale di Bluetti.

Il CHARGER risponde alla stessa stretta di mano ma ha il registro 110 a zero:
ha una mappa sua, da ricostruire a parte.

## Cosa resta da fare

Sapere **quale registro contiene cosa**. La stretta di mano e il trasporto sono
risolti; manca la mappa — carica, watt in ingresso e in uscita, stato. I
progetti della comunità ne hanno una per l'Elite 200 V2, che è della stessa
generazione: si parte da lì e si verifica valore per valore contro quel che
dice il cloud, finché il cloud funziona.

E resta la regola di sempre: **leggere e comandare sono due decisioni
separate**. Questa sonda legge e basta.

---

# La mappa dei registri — prime due coppie, 19/11/2026

Due fotografie dei registri dell'Elite 300 via Bluetooth, confrontate con i
numeri che l'app di Bluetti mostrava nello stesso minuto.

| | 220 chiusa (17:16) | 220 aperta (17:20) |
|---|---|---|
| **l'app dice** | carica 81%, tutto a 0 | carica 81%, **uscita 220 V = 433 W** |
| `[142]` | — | **433** |
| `[102]` | 81 | 81 |
| `[104]` `[105]` | 30520 | 518 |
| `[100]` | 996 | 988 |
| `[101]` | 3 | 293 |
| `[148]` | 65535 | 246 |
| `[167]` | 31850 | 31860 |
| `[103]` `[124]` `[161]` `[188]` | — | 2, 2, 1, 136 |

## Identificati

**`[142]` — watt in uscita sulla 220.** Valeva zero a inverter spento ed e'
comparso valendo **esattamente 433**, il numero dell'app. Nessuna ambiguita'.

**`[102]` — la carica, in percentuale.** Vale 81 in entrambe, come l'app. Due
misure concordi: battezzato.

## Quasi certi

**`[104]` e `[105]` — l'autonomia, in minuti.** Da 30520 (ventun giorni: a
riposo, cioe' «praticamente infinita») a **518**, otto ore e mezza — quanto
dura una Elite 300 erogando 433 W. Il salto ha senso solo per questo.

**`[100]` — la tensione della batteria, per dieci.** Da 99,6 a 98,8 V: scesa
di otto decimi **sotto carico**, come fa una batteria a cui si chiede mezzo
kilowatt. E novantanove volt dice che l'Elite 300 e' un sistema a 102,4 V.

**`[148]`** — da 65535 (cioe' −1, «non lo so») a 246 quando l'inverter si e'
acceso.

## Costanti riconoscibili

`[169]=230` la tensione di rete, `[170]=5000` la frequenza (50,00 Hz),
`[152]=[156]=225` probabilmente 22,5 °C, `[110..112]` = `EL300`, il modello.

## La mappa del territorio, avuta gratis

Le risposte `018302c0f1` non sono guasti: `0x83` e' l'errore MODBUS e `0x02`
significa **indirizzo inesistente**. Quindi i registri validi stanno in tre
zone: circa **0-19, 100-124, 140-188**. Il resto non esiste.

## Cosa manca

**Una terza coppia con un carico diverso.** Serve a confermare che `[142]`
segue il valore nuovo, e a separare `[100]`, `[101]` e `[148]`, che finora si
sono mossi tutti insieme una volta sola. Va bene qualunque carico che resti
acceso due minuti -- il bollitore no, va a termostato e stacca da solo.

E mancano ancora i **watt in ingresso**: in nessuna delle due fotografie
entrava corrente nella Bluetti. Serve una coppia con la colonnina attaccata o
il sole che carica.

---

# La terza coppia — 20/11/2026, mattina, motore spento

Fotografia alle 08:45:34, con Truma e frigo accesi (carichi sul 12 V delle
Ective, non sulla Bluetti). L'app, nello stesso minuto: **carica 77%, tutti e
quattro i watt a zero.**

```
   0: [1]=769  [6]=5  [16]=2017
 100: [100]=997  [101]=2  [102]=77  [104]=29088  [105]=29088  [107]=1
      [108]=1  [110]=19525  [111]=12339  [112]=48  [116]=38109
      [117]=36012  [118]=606
 120: [121]=1  [122]=1
 140: [148]=65535  [149]=65535  [150]=1  [152]=226  [154]=155  [156]=225
 160: [167]=31960  [169]=230  [170]=5000  [171]=32
```

## Identificati

**`[102]` — la carica.** Terza coppia concorde: 81, 81, 77. Chiuso.

**`[104]` e `[105]` — l'autonomia in minuti.** Da «quasi certo» a identificato,
e per una ragione forte: ieri a 81% valevano 30520, oggi a 77% valgono 29088.
Il rapporto fra i due e' 0,953; quello fra le cariche 0,951. **Scalano insieme
alla carica, a carico nullo** — che e' esattamente quel che fa una stima di
autonomia, e non quel che fa un numero qualunque.

**`[142]` — watt in uscita sulla 220.** Secondo riscontro, questa volta a zero
contro zero: l'inverter e' spento e il registro e' assente. Coerente con il 433
di ieri.

## L'eliminazione, che vale quanto un'identificazione

L'app dichiara **zero su tutti e quattro i watt**. Quindi nessuno dei registri
che in questa fotografia ha un valore puo' essere una potenza — ne' in
ingresso, ne' in uscita, ne' sulla 220, ne' sul 12 V.

I watt stanno fra i registri che adesso leggono zero. E' il contrario del modo
solito di cercare, ed e' piu' solido: un registro che tace quando la grandezza
e' nulla ha superato una prova; uno che parla, no.

## Registri nuovi, non battezzati

`[1]=769`, `[6]=5`, `[16]=2017`, `[107]=1`, `[108]=1`, `[116]=38109`,
`[117]=36012`, `[118]=606`, `[121]=1`, `[122]=1`, `[149]=65535`, `[150]=1`,
`[154]=155`, `[171]=32`. Ieri tacevano, oggi parlano. Da soli non dicono
niente: aspettano una coppia che li muova.

Per contro `[161]` e `[188]`, che ieri valevano 1 e 136, oggi tacciono.

## La differenza con ieri, in una riga

La carica e' scesa di quattro punti nella notte con tutte le uscite spente.
Non e' un guasto — e' il consumo a vuoto dell'apparecchio — ma va tenuto a
mente: la Bluetti si scarica anche ferma.

---

# Il conflitto sui posti Bluetooth — 20/11/2026

Il problema piu' grosso emerso oggi, e non e' risolto. Va scritto come sta,
perche' se e' vero mette in discussione tutta la strada.

## La sequenza, con le ore

| ora | fatto |
|---|---|
| 08:45 | motore spento. La Bluetti **si annuncia** (−43 dBm ieri, letta senza problemi). Fotografia riuscita. |
| ~08:50 | motore acceso. Il Charger dichiara **632 W**. |
| 08:51:48 | la sonda si collega e legge. **La carica continua.** |
| ~08:55 | il proprietario apre l'app Bluetti per leggere i cinque numeri. |
| ~08:58 | il Charger passa a **0 W**. La carica si e' fermata. |
| ~09:05 | app chiusa, sonda ferma. Il Charger torna a **630 W**. |
| ~09:10 | dal display: carica **80%**, in entrata **670 W**. |
| 09:30 → | la Bluetti **non si annuncia piu'**. Il Charger si sente a −51 dBm. |
| 09:43 | motore spento (Orion XS: «spento», ingresso 12,53 V). La Bluetti **ancora assente**. |

## L'ipotesi, e perche' non regge del tutto

L'ipotesi era: **il Charger occupa il posto Bluetooth della Bluetti** mentre
carica, e il telefono che si aggiunge e' il terzo di troppo. Spiegherebbe lo
stop a 0 W e la ripartenza a app chiusa.

Ma a motore spento il Charger non carica, e la Bluetti **resta assente**.
Quindi l'ipotesi, da sola, non basta.

L'altra spiegazione, piu' banale: **il telefono resta collegato anche con
l'app chiusa.** I telefoni tengono vive le connessioni Bluetooth in sottofondo,
e un apparecchio Bluetti con un cliente attaccato smette di annunciarsi.

## Come si decide, e cosa serve

La vigilia — `scatoletta/sonda/vigilia.py`, solo ascolto — registra ogni tre
minuti chi si sente. Basta guardare **quando la Bluetti ricompare**:

- se ricompare dopo che il telefono si allontana o si spegne il Bluetooth del
  telefono → era il telefono, e la strada e' libera: la regola diventa «l'app
  resta chiusa mentre la scatoletta legge»;
- se ricompare solo quando il Charger smette, e spegnendo il Bluetooth del
  telefono non cambia niente → era il Charger, e **la lettura via Bluetooth
  non e' disponibile proprio quando il camper carica**.

Il secondo caso non chiude la strada, ma la cambia: si leggerebbe la Bluetti
nelle pause, dichiarando l'eta' del dato, e durante la carica si userebbe il
cloud. Meno bello, e va saputo prima di scrivere il lettore.

## La regola che vale comunque, e che e' un guadagno

**Il display della Bluetti non costa un posto Bluetooth. L'app si.**

Quindi per tutte le coppie di misura la fonte giusta e' **il display**, non
l'app: si leggono i cinque numeri dal pannello dell'apparecchio mentre la
scatoletta legge i registri, e i due non si disturbano. Era il modo di prendere
le coppie che cercavamo da ieri, e l'ha trovato il proprietario.

## Un punto fermo sul metodo

Nessuna delle fotografie di oggi ha mostrato un registro che valesse 632 o 670.
Il registro dei watt in ingresso **non e' ancora trovato**, e non va indovinato:
un numero plausibile e sbagliato e' il risultato peggiore possibile.

## Una strada che sembra una scorciatoia e non lo e'

«Se non si annuncia, collegati per indirizzo»: su Linux **non funziona**.
`BleakClient(indirizzo)` su BlueZ fa comunque una scansione per trovare
l'apparecchio, e risponde `BleakDeviceNotFoundError`. Quindi non si puo'
distinguere «non si annuncia ma accetterebbe un cliente» da «non c'e'»: la
prova ricade nella domanda di partenza.

## E una terza spiegazione, la piu' semplice

La Bluetti potrebbe essersi **spenta da se'**. Un apparecchio spento non si
annuncia, e non serve nessuna teoria sui posti occupati. Da remoto non si
distingue: lo dice la vigilia, se la Bluetti ricompare, o uno sguardo al suo
pannello.

## La strada della rete locale: chiusa, verificato

L'Elite 300 **sta anche sul Wi-Fi del camper**, e lo si e' scoperto per caso:
nella tabella degli indirizzi comparve `192.168.1.100` con l'impronta
`90:70:69:35:76:f0`, a due numeri dal suo indirizzo Bluetooth
`90:70:69:35:76:F2`. Due radio dello stesso apparecchio.

Sembrava una strada migliore del Bluetooth — nessun posto da occupare, nessun
rischio di fermare la carica. **Non lo e':** bussato a tutte le porte da 1 a
1024 e alle candidate alte (1883, 8883, 5683, 6668, 502, 8080, 8443…),
**nessuna risposta**. La sua radio Wi-Fi e' solo un cliente che parla col
cloud di Bluetti; non offre niente in casa.

Resta pero' un guadagno grosso: **quell'impronta nella tabella degli indirizzi
dice se l'apparecchio e' accesso**, senza toccare il Bluetooth. Il 20/11 ha
escluso in un colpo l'ipotesi «si e' spenta da se'»: rispondeva sulla rete
mentre taceva in radio.
