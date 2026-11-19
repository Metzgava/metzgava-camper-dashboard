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
