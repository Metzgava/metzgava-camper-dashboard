# Cosa si legge del camper, e come

Rilevato il 16 novembre 2026, col camper in sosta e il Mac a bordo.
Le chiavi non stanno qui: sono in `segreti/` (ignorata da git).

## Il quadro in una riga

Sette apparecchi su otto parlano **solo a chi è dentro il camper**: Bluetooth a
dieci metri, o la rete locale. Da lontano resta l'allarme, che passa dal cloud
di Tuya. Questo non è un limite del programma: è il motivo per cui in camper
serve qualcosa di acceso che faccia da tramite.

| apparecchio | come si legge | da lontano |
|---|---|---|
| Ective ×2 (LiFePO4) | Bluetooth, servizio `FFE0`, notifiche su `FFE4` | no |
| SmartSolar MPPT | annunci Bluetooth cifrati (Victron Instant Readout) | no |
| Orion XS | idem, record `0x0f` | no |
| Starlink | gRPC-web su `192.168.100.1:9201`, dalla sua rete | no |
| Centrale d'allarme Tuya | protocollo locale 3.5 sulla porta `6668` | **sì, via cloud** |
| Bluetti Elite 300 | **cloud Bluetti**, OAuth2 + REST | **sì** |
| Bluetti Charger | niente | no |
| CarLock | esportazione CSV/XLS a mano da `my.carlock.co` | sì |
| Truma Combi (CP plus) | bus LIN, fingendosi una iNet Box | sì, col tramite |
| Frigo Dometic da incasso | **niente**: non ha radio | no |

## Ective: il formato, ricostruito

Le batterie **non** parlano il protocollo binario JBD: mandano da sole, senza
che si chieda niente, dei pezzetti di **testo** sulla caratteristica `FFE4`.
Ogni pezzetto contiene cifre esadecimali scritte come lettere ASCII. Rimessi in
fila, i pezzetti formano un record che comincia col carattere `^`.

Dopo il `^`, contando in caratteri:

| posizione | campo | come si legge |
|---|---|---|
| 0–3 | tensione | intero a 16 bit, byte invertiti, in mV |
| 4–7 | (zeri) | |
| 8–15 | corrente | intero a 32 bit con segno, byte invertiti, in mA |
| 16–23 | capacità | intero a 32 bit, in mAh |
| 24–27 | cicli *(ipotesi)* | 102 e 124 sulle due batterie |
| 28–31 | carica | percentuale |
| 32–35 | temperatura *(ipotesi)* | decimi di kelvin: `/10 − 273,15` |
| 36–43 | (zeri) | |
| 44–59 | quattro celle | quattro interi a 16 bit, in mV |

Le ipotesi sono segnate come tali: si confermano guardandole cambiare — i cicli
non devono muoversi, la temperatura deve scendere di notte.

**Trappola:** il nome Bluetooth delle Ective contiene un byte invisibile
(`0x11`) dopo le cifre. Un'espressione regolare che pretende uno spazio dopo il
nome non trova niente.

## Victron: gli annunci cifrati

Manufacturer data `0x02E1`, AES-128-CTR. Struttura dell'annuncio:

| byte | contenuto |
|---|---|
| 0–1 | `e1 02` |
| 2 | `0x10` = lettore istantaneo |
| 4–5 | modello |
| 6 | tipo di record (`0x01` regolatore solare, `0x0f` Orion XS) |
| 7–8 | contatore, che è anche il vettore di inizializzazione |
| 9 | byte di controllo: **deve essere uguale al primo byte della chiave** |
| 10+ | il cifrato |

Quel byte 9 è la salvaguardia: se non corrisponde, la chiave non è di quell'ap-
parecchio e **non si stampa niente**. Un valore sbagliato è peggio di un valore
assente.

## Bluetti: perché non si legge

- **Modbus TCP:** la porta 502 è *rifiutata* (non muta: l'apparecchio risponde
  «qui non c'è niente»). Il server web interno è spento, come dice il documento
  ufficiale di Bluetti, e va attivato a mano. Non trovato dove.
- **Bluetooth:** si collega e manda pacchetti che cominciano con `2a2a`. Nella
  libreria `bluetti-bt-lib` quello è `KEX_MAGIC = b"**"`: è l'inizio di uno
  **scambio di chiavi** (ECDH su P-256, firma verificata con una chiave pubblica
  Bluetti incorporata, poi AES). Non rispondendo, l'apparecchio stacca dopo sei
  secondi. L'Elite 300 non è nell'elenco dei modelli supportati.
- **Il loro cloud funziona**, ed è la via buona. Dettagli sotto.

## Bluetti via cloud: la catena completa

| | |
|---|---|
| Accesso | `https://sso.bluettipower.com/oauth2/grant` e `/oauth2/token` |
| Cliente | `HomeAssistant` / `SG9tZUFzc2lzdGFudA==` (pubblici) |
| Ritorno | qualunque: accetta anche `localhost` |
| Dati | `https://gw.bluettipower.com` |
| Autenticazione | intestazione `Authorization: <gettone>` — **senza** `Bearer` |
| Gettone | dura **31 giorni**, con gettone di rinnovo |

Le chiamate, nell'ordine che conta:

1. `GET /api/bluiotdata/ha/v2/devices` — l'elenco. Attenzione: i `fnValue` qui
   sono **sempre zero**, è solo l'elenco delle capacità.
2. `POST /api/bluiotdata/ha/v1/bindDevices` con `{"bindSnList":["<sn>"]}` —
   **il passaggio senza cui tutto resta a zero.** Finché non si fa,
   `deviceStates` risponde `online: "0"`, `isBindByCurUser: "0"` e lista vuota,
   e il canale WebSocket non spinge niente. Fatto questo, i valori arrivano.
3. `GET /api/bluiotdata/ha/v1/deviceStates?sns=<sn>` — **i valori veri.**
4. `POST /api/bluiotdata/ha/v1/fulfillment` — i comandi. Non usato.

**Non serve il WebSocket per leggere.** Esiste, è STOMP su
`wss://gw.bluettipower.com/api/edgeiotgw/ws-coordination/websocket`, vuole nella
cornice `CONNECT` le intestazioni `x-os:open`, `x-app-key` e `x-app-ver` (senza
quelle risponde «aggiorna»), e poi un'iscrizione a
`/ws-subscribe/user/{user-name}/notify`, col nome utente che arriva nella
cornice `CONNECTED`. Per un cruscotto che interroga ogni tanto, l'interrogazione
REST basta e sta in piedi con molto meno.

**Un falso indizio da non ripetere:** il campo `msgId` è identico in tutte le
risposte riuscite. Sembra una risposta in cache, e non lo è — è un
identificativo di sessione. Le risposte in errore ne hanno uno diverso perché
le genera un altro servizio (`appId: "blu-iot-data"`).

## Allarme: la centrale si descrive da sé

Il campo `local_strategy` dell'apparecchio dice, per ogni numero che manda in
locale, come si chiama e che valori ammette. Si usa quello invece di indovinare.

I due campi che contano:

- **`master_mode`** (dp 1): `arm | home | sos | disarmed`. **Scrivibile.**
- **`master_state`** (dp 32): `normal | alarm`. È lo scatto.

In locale manda sempre gli stessi 21 campi. **Il messaggio con la zona
(`alarm_msg`, dp 26) non c'è in locale**: la centrale lo *spinge* quando succede
qualcosa, e via cloud si legge l'ultimo. Quindi: in camper una connessione
aperta in ascolto, non un'interrogazione periodica; il cloud come riserva.

Senza SIM inserita, chiamata e SMS sono inerti: **la notifica all'app è l'unico
canale d'allerta**. Da qui l'importanza delle notifiche push nel cruscotto.

## Una lezione di metodo

La prima scansione delle porte diede «65535 porte mute» su una ESP32. Era falso:
quaranta connessioni insieme esauriscono i socket di quel chip, che smette di
rispondere a tutto. Rifatta a una porta alla volta, la stessa macchina
**rifiutava** regolarmente. *Muta* e *rifiutata* sono due risposte diverse, e
confonderle fa concludere il contrario del vero.

## Truma: il connettore c'è già

Verificato il 16 novembre 2026, a parole dal proprietario: **la iNet Box non è
installata, ma il camper è predisposto**. È la notizia buona, perché
«predisposto per iNet Box» vuol dire due cose insieme:

1. il pannello è un **CP plus** *inet ready* — la iNet Box non si attacca a un
   CP classic, quindi la predisposizione lo esclude;
2. **il connettore RJ12 del bus LIN esiste ed è libero.** Non c'è da tagliare,
   spellare o derivare niente: ci si infila dentro, ed è esattamente il tipo di
   intervento che il vincolo «non si mette mano all'impianto» permette.

Chi si attacca a quel bus **finge di essere la iNet Box** e il CP plus comincia
a raccontargli tutto. Due realizzazioni libere fanno questo da anni:
[`esphome-truma_inetbox`](https://github.com/Fabian-Schmidt/esphome-truma_inetbox)
per ESP32 e [`inetbox.py`](https://github.com/juvander/inetbox.py) per Raspberry.

Si leggono: **temperatura ambiente**, **temperatura dell'acqua**, le due
**temperature impostate**, il **modo di riscaldamento** e, sui Combi E, la
mescola gas/elettrico e il livello di potenza elettrica. C'è anche un
*CP plus alive*, che dice se il pannello sta rispondendo — e un apparecchio che
dichiara di essere morto è meglio di uno che tace.

### Si può anche comandare

Accertato il 16 novembre 2026: il proprietario vuole i comandi, quindi entrano
nei piani. Quel che si scrive sul bus:

| campo | valori |
|---|---|
| temperatura ambiente | `0` (spento) oppure `5–30` |
| acqua calda | `0` · `40` · `60` · `200` |
| modo | `off` · `eco` · `high` |
| tipo di alimentazione | `gasolio` · `mix` · `elettrico` |
| livello elettrico | `900` · `1800` W |

**Ambiente e modo vanno impostati insieme**, altrimenti non scalda: è l'errore
classico di chi manda un comando solo.

### La stufa è una Combi diesel con resistenze elettriche

Riferito dal proprietario. Quindi una **Combi D ... E**, e il menù del tipo di
alimentazione esiste (dal manuale: compare solo sulle stufe con resistenze
elettriche). Le cinque voci del pannello, e come si ottengono coi due campi:

| pannello | brucia | dalla 230 V | sul bus |
|---|---|---|---|
| Gasolio | solo gasolio | — | `gasolio` |
| MIX 1 | gasolio + elettrico | 900 W | `mix` + `900` |
| MIX 2 | gasolio + elettrico | 1800 W | `mix` + `1800` |
| EL 1 | solo elettrico | 900 W | `elettrico` + `900` |
| EL 2 | solo elettrico | 1800 W | `elettrico` + `1800` |

Preimpostazione di fabbrica: gasolio.

### MIX e EL si comportano in modo opposto se la 230 V salta

Dal manuale, ed è il dato che decide come si usa da remoto:

- in **MIX**, se la 230 V si interrompe la stufa **passa automaticamente al
  gasolio** e continua a scaldare;
- in **EL**, se la 230 V si interrompe (con i 12 V attivi) la stufa **si ferma e
  mostra un codice di errore**. Non ripiega sul gasolio.

Quindi per un'accensione da remoto il modo giusto è **MIX**: costa un po' di
gasolio e non dipende dall'umore della colonnina. EL va bene a bordo, dove
l'errore lo si vede.

### I paletti per i comandi, quando si faranno

Nessuno di questi lo chiede un manuale: sono scelte di progetto, da tenere.

1. **Conferma** prima di ogni comando, come già per la Bluetti.
2. **Blocco sulla carica**: la ventola della Combi mangia 12 V per ore. Sotto
   soglia il comando non parte. È il guasto più probabile — camper caldo,
   batterie a terra — e questa app è l'unica cosa che sa quanta carica c'è.
3. **Spegnimento automatico** dopo una durata massima: se la rete cade, la stufa
   non resta accesa perché non si riesce più a spegnerla.
4. **Controllo sugli ampere della colonnina**: 1800 W sono quasi 8 A. Il valore
   dichiarato nel calcolo c'è già in `conti.js`; se non ci sta, il comando si
   rifiuta e lo dice.
5. **Riscontro**: dopo il comando si rilegge dal bus cosa è successo —
   temperatura che sale, o codice di errore. Un comando che non si verifica è un
   comando che non si sa se è arrivato.

Restano fuori dalla portata di qualunque programma, e vanno dette in pagina: il
livello del gasolio e che camino e presa d'aria siano liberi.

### Il pannello, accertato

Confermato il 16 novembre 2026 dal proprietario: la rotella **si gira e si preme
per selezionare**. È un menù, quindi c'è un display, quindi è un CP plus — il CP
classic ha manopole fisse e niente da selezionare.

### Dove si leggono le versioni

Dal manuale italiano del CP plus, **menu di servizio, voce 8 «Indicazione del
numero di versione»**. Mostra lettera + numero, es. `H 1.20.01`. La lettera dice
l'apparecchio:

| lettera | apparecchio |
|---|---|
| `C` | unità di comando CP plus |
| `F` | CP plus CI-BUS |
| `A` | sistema di condizionamento |
| `H` | stufa |
| `T` | Truma iNet Box |

**Serve la `C`**, e il numero decide fra **tre** esiti, non due:

| la `C` | cosa si può fare |
|---|---|
| `C 2.xx` | niente: sotto il requisito di Truma stessa per la iNet Box |
| `C 3.xx` | **si legge, non si comanda**: protocollo diverso |
| `C 4.xx` | si legge e si comanda |

`C 3.00.00` è la soglia che Truma mette per la iNet Box; il salto a `C 4` per
poter *scrivere* viene dal README di `inetbox2mqtt`. Da notare: il progetto
ESPHome non dichiara nessun limite di versione, quindi su una `C 3` la scrittura
va provata prima di darla per persa.

Se risultasse `C 3`, nell'ordine: provare comunque per la via ESPHome; chiedere a
Truma o a un centro assistenza (testimonianze contrastanti: alcuni apparecchi si
aggiornano, altri no); sostituire il pannello (~329 €, non vale per il solo
comando da remoto). La lettura funziona in ogni caso.

### Il pannello è un CP plus, non un iNet X — ed è dirimente

`inetbox2mqtt` **non supporta** il Truma iNet X Panel. Su un camper del 2023 era
un rischio reale, perché l'iNet X sostituisce il CP plus riusando lo stesso cavo
TIN. È escluso dalla descrizione del proprietario: l'iNet X è un **touchscreen da
4,3"**, mentre lui ha una **manopola che si gira e si preme**. Nessuna manopola
sull'iNet X.

Non supportato nemmeno un CP plus a cui sia già collegata una iNet Box: se ce ne
fosse stata una prima, va fatto un INIT senza di essa. Qui non c'è mai stata.

### Previsione sulla versione, e su cosa si basa

Camper del **2023**, stufa **Combi 6D + E**. Un thread tedesco riporta che le
Combi dal 2018 richiedono un CP plus con software `04.0x`. Quattro anni dopo
quella soglia, l'attesa è **`C 4.0x` o successiva**.

Resta una previsione da forum, non un dato di Truma: la conferma o la smentisce
il pannello in due minuti. Vale come stima del rischio d'acquisto, non come
fatto.

### I due passaggi che si dimenticano

**«PR SET»** sta nel **menu di servizio, voce 9 «Preimpostazione (RESET)»**: si
seleziona RESET, appare `PR SET`, si conferma, e il display mostra `INIT ..`
mentre rifà la ricerca degli apparecchi. Senza quello il bus resta zitto e si
passa un pomeriggio a controllare fili giusti.

**Quel reset cancella tutte le impostazioni** — orologio, temporizzatore,
taratura del sensore di temperatura. Reversibile, ma da rimettere a mano.

### La pressione lunga: tre tempi, non due

**Corretto il 16 novembre 2026.** Prima qui c'era scritto che con una iNet Box
nota al pannello «si perde l'interruttore generale sulla pressione lunga». È
falso, e il manuale lo dice con i secondi in mano:

| gesto | cosa fa |
|---|---|
| pressione **breve** | esce dalla modalità APP e ridà il comando al pannello |
| tenuta **~2 s** | entra in **modalità APP** (solo se il pannello conosce una iNet Box) |
| tenuta **oltre 4 s** | **OFF**, l'interruttore generale |

Testuale: «Tenere premuta la manopola per più di 4 secondi. Dopo 2 secondi sul
display appare APP. Dopo altri 2 secondi appare OFF.»

Quindi **non si perde niente**: la modalità APP è una fermata in mezzo alla
stessa pressione, e continuando ad arrivare si spegne come prima. Senza iNet Box
nota, quella fermata non c'è e a oltre 4 secondi si spegne direttamente.

La modalità APP mette pannello e apparecchi in stand-by in attesa dei comandi
dall'app, e si chiude da sé anche quando l'app manda valori nuovi.

**Il costo vero della basetta è quindi più basso di quanto scritto prima**: una
fermata in più su un gesto che resta disponibile. Non una funzione perduta.

### Collegamenti

Serve un **ricetrasmettitore LIN→UART** (MCP2003 o TJA1021 su basetta), che si
alimenta a 12 V dalla stessa linea del Combi:

| del ricetrasmettitore | va a |
|---|---|
| `LIN` | piedino **3** dell'RJ12 (6P6C) |
| `GND` | piedino **5** dell'RJ12, e la massa della basetta |
| `TX` / `RX` | seriale del microcontrollore (9600 baud, **2 bit di stop**) |
| `INH`, `SLP` | non si usano |

L'RJ12 va sulla porta libera del Combi, oppure su uno sdoppiatore inserito nel
cavo che già collega Combi e pannello.

### Perché non sul Raspberry

Sembrerebbe naturale: il Raspberry c'è già e `inetbox.py` è scritto per lui.
Non va, per tre ragioni che si sommano.

- Sul **Pi Zero 2 W** la seriale buona (PL011) **è occupata dal Bluetooth**, che
  è esattamente ciò per cui la scatoletta esiste. Spostare il Bluetooth sulla
  mini-seriale (`dtoverlay=miniuart-bt`) si può, ma peggiora proprio la radio da
  cui dipendono Victron, Ective e termometri.
- La **mini-seriale** ha una velocità che dipende dal clock della CPU. Un
  apparecchio che su un bus LIN deve rispondere entro pochi millesimi non si
  regge su una velocità che balla col carico.
- L'agente passa **venti secondi per giro in ascolto Bluetooth**. Uno schiavo
  LIN in quei venti secondi perde ogni richiesta del master.

Quindi: **una basetta dedicata** (ESP32 + ricetrasmettitore LIN) che sta sul bus
a tempo pieno e non fa altro. Espone i suoi valori sulla rete del camper; la
scatoletta li raccoglie nel giro e li spedisce con gli altri, così la chiave
della porta resta in un posto solo. `inetbox.py` sul Raspberry vorrebbe anche un
broker MQTT a bordo: una cosa in più da tenere viva, per niente.

## Frigo: non c'è la porta

Il frigo è un **Dometic da incasso** (tipico su Knaus BoxLife 540). Non si
collega, e la ragione non è una porta chiusa: **non c'è la porta.** I frigo da
incasso Dometic — a compressore o ad assorbimento — non hanno radio. Niente
Bluetooth, niente wifi, niente bus. Non c'è un formato da ricostruire: non c'è
nulla che parli. Il modello esatto si legge sulla targhetta dati dentro il vano,
e serve solo a confermarlo.

Due cose si ottengono comunque, e insieme bastano:

- **la temperatura dentro**, con un termometro Bluetooth da pochi euro appoggiato
  in un cestello. L'agente li legge già: BTHome v2 (servizio `0xFCD2`) e ATC
  (`0x181A`) trasmettono **in chiaro e senza accoppiamento**, basta ascoltare;
- **il consumo**, di riflesso: il compressore parte e si ferma, e quei gradini
  nella corrente delle Ective sono il frigo. Non è una misura diretta, e la
  pagina lo dirà col suo bollino: una stima resta una stima.

Lo stesso vale per la temperatura in cellula, in gavone e in frigo: tre
termometri da dieci euro, zero fili, zero interventi.

## Blink: si collega, ed è più utile di quanto sembri

Accertato il 16 novembre 2026. Blink non ha niente in locale — né ONVIF né
RTSP: è un prodotto tutto cloud. Ma la sua API cloud è quella che usa
`blinkpy`, la libreria su cui si appoggia l'integrazione di Home Assistant, ed
è viva e mantenuta (Python 3.10+).

Cosa se ne ricava, dalla documentazione della libreria:

| cosa | nota |
|---|---|
| armato / disarmato | **e si può scrivere**: `async_arm(True/False)`, per sistema o per singola telecamera |
| batteria | uno stato a parole, piu' `battery_voltage` col valore grezzo |
| segnale wifi | dall'endpoint `/signals` |
| **temperatura** | le Blink hanno un sensore: sono termometri che lui ha già |
| ultimo movimento | ora, piu' i riferimenti a immagine e video |
| notifiche non lette | un contatore |

### Il vincolo che resta, e come si rispetta

Blink non ha un consenso tipo quello di Bluetti: `blinkpy` fa il login diretto
con email e password, piu' un PIN che arriva per email. **La password non passa
da me.** Il modo giusto: il login lo fa il proprietario **una volta**, con un
comando sul Raspberry — digita lui la password e il codice — e resta a bordo un
file col gettone. L'agente legge il gettone, non la password.

### Due avvertenze da rispettare nel codice

- **Sono telecamere a batteria.** L'integrazione di Home Assistant avverte di
  non interrogarle troppo spesso: si scarica la batteria e si martella il loro
  server. Il giro da cinque minuti va bene; la **modalità taratura non deve
  toccarle** — va esclusa esplicitamente, altrimenti un giro da dieci secondi
  per mezz'ora le massacra.
- **Il video resta nell'app Blink.** Ritrasmetterlo dal loro cloud attraverso il
  nostro server sarebbe lavoro grosso per fare peggio della loro app. La pagina
  mostra stato, batteria, temperatura ed eventi, e rimanda là per il filmato.

### Da chiedere prima di scrivere il codice

Quali modelli, e se il Sync Module è a bordo sulla rete del camper.

## Garmin dashcam: no, e il motivo è strutturale

Cercato il 16 novembre 2026, e questa è la prima cosa del progetto da
dichiarare **chiusa**.

- **Nessuna interfaccia locale documentata.** L'app Garmin Drive parla col
  Bluetooth e con la rete wifi che la telecamera crea da sé, con un protocollo
  suo. L'unica traccia trovata e' una libreria per le Garmin **Virb** (action
  cam) il cui autore scrive che «dovrebbe funzionare anche con alcuni modelli
  di dashcam»: non verificato, e resta il punto seguente.
- **Il blocco vero: la telecamera fa rete propria.** Per parlarle il Raspberry
  dovrebbe lasciare la rete del camper, cioè smettere di fare il suo mestiere.
  Ha una radio sola. Non è una questione di protocollo da aprire: è che i due
  compiti si escludono.
- Il cloud Garmin (Vault) è dentro la loro app e vuole un abbonamento. Non c'è
  una porta come quella di Bluetti.

**Quel che forse si può, e costa zero**: sapere **se è accesa**, nel caso
annunci in Bluetooth. La scatoletta ascolta già: si verifica quando è a bordo,
guardando se compare un annuncio col suo nome. Presenza, non filmati — ma «la
dashcam è accesa» su un camper in sosta non è niente.

## Il collegamento Bluetti, passo per passo (e la trappola)

Ricostruito il 16 novembre 2026 aprendo le loro pagine e leggendole, dopo due
diagnosi sbagliate di fila.

L'ordine vero è questo, e **non** è quello che sembra:

1. `GET /oauth2/grant?response_type=code&client_id=HomeAssistant&redirect_uri=…&state=…`
   mostra **«Connect with BLUETTI · Agree · Reject»**. La pagina compare
   **identica a chi non ha fatto l'accesso**: nessun campo, nessun avviso.
2. **Agree** è un collegamento a
   `/oauth2/login?response_type=code&client_id=…&redirect_uri=…&state=…`:
   e' li' che chiede l'accesso, **dopo** il consenso e non prima.
3. Fatto l'accesso, si torna al `redirect_uri` col codice.

### La trappola, in cui sono caduto io

`https://sso.bluettipower.com/login` **nudo**, senza i parametri, risponde in
rosso: **«身份认证的应用key不能为空»** — *la chiave applicativa per
l'autenticazione non può essere vuota*. Quella pagina esiste ma non sa per
quale applicazione stai entrando, e rifiuta.

Avevo messo quel link in pagina come «primo passo», convinto che l'accesso
andasse fatto prima. Era sbagliato due volte: il passo non serve, e
l'indirizzo era quello che non funziona.

### Perché «prima funzionava»

Il primo collegamento, la mattina del 16, è passato da un ascoltatore locale su
`127.0.0.1:8765`: il proprietario ha premuto Agree **in un browser del Mac dove
era già entrato in Bluetti**, quindi il passo 2 non si e' visto. Dal telefono,
in Safari, quella sessione non c'e': stesso bottone, stessa pagina, ma l'accesso
viene chiesto — e chi non se l'aspetta pensa che sia rotto.

### Cosa deve dire la pagina

Un tasto solo, e la frase giusta: «si preme Agree, **e poi** chiede l'accesso».
Mettere l'accesso per primo manda nel posto sbagliato.

## Quanto dura il permesso Bluetti, misurato

Dalla strumentazione, 16 novembre 2026 alle 22:24:

```
Bluetti collegato: expires_in=2678400s, scade 2026-12-17T22:24:39Z, rinnovo presente
```

**2 678 400 secondi = 31 giorni esatti**, col gettone di rinnovo. Non e' un
permesso corto: dura un mese.

### Un'ipotesi smontata, scritta perche' non torni

Avevo sospettato che il permesso durasse pochissimo e che il **rinnovo
preventivo** — allora con margine fisso a tre giorni — scattasse a ogni lettura
bruciando la sessione. Con trentun giorni di vita quel margine non si avvicina
nemmeno: **l'ipotesi e' falsa**.

Le due guardie messe quella sera restano, perche' sono giuste a prescindere: il
margine ora e' **relativo** (l'ultimo quinto della vita, mai meno di dieci
minuti) e non si fanno **due rinnovi a meno di dieci minuti**. Ma non erano la
cura di quel guasto.

### Il sospetto che resta

Il permesso creato alle 22:10 fu rifiutato alle 22:16. In quei minuti erano in
corso **tre pubblicazioni di fila**, e per qualche secondo giravano **due
contenitori insieme**: due processi che leggono lo stesso permesso e possono
pestarsi i piedi sul rinnovo. Se e' cosi', la causa era il deploy durante il
collegamento, non il loro cloud.

**Regola che ne segue:** non si pubblica mentre il proprietario sta
collegando. Il collegamento dura due minuti; il deploy puo' aspettarli.

### Com'e' andata a finire

Collegato alle 22:24 senza deploy in corso: manometro e comandi tornati,
nessun errore nei log. Il permesso scade il **17 dicembre 2026** e da li' in
poi si rinnova da solo.

## Il guasto vero: una contesa sul gettone di rinnovo

Chiuso nella notte fra il 16 e il 17 novembre 2026, dopo **cinque** diagnosi
sbagliate. Vale la pena scrivere sia il meccanismo sia come si e' trovato.

### Cosa succedeva

1. una lettura trova il gettone rifiutato (805) e lancia il rinnovo;
2. **nello stesso momento** ne parte un'altra — il giro periodico ogni quindici
   minuti e una pagina che si apre — che trova lo stesso gettone rifiutato e
   lancia un **secondo** rinnovo;
3. ma il gettone di rinnovo **si consuma**: il primo lo usa e ne riceve uno
   nuovo, il secondo si sente rispondere `invalid_grant`;
4. il codice scambiava quell'`invalid_grant` per «permesso morto» e **buttava
   via i gettoni buoni** che il primo aveva appena salvato.

Bastava quindi una lettura rifiutata **piu'** due richieste contemporanee, e il
collegamento spariva. Tre volte in una sera.

### Come si e' trovato

Non ragionando: provando. Il codice vero di `bluetti.js` fatto girare con un
**database finto in memoria** (solo la riga di import cambiata) e un gettone
verificato funzionante due minuti prima. La catena si e' rotta sotto gli occhi,
e il `rinnovo RIFIUTATO (400): invalid_grant` ha detto il resto — quel gettone
di rinnovo l'aveva gia' consumato la prova precedente.

### Le due correzioni

- **una lettura per volta**: chi arriva mentre un'altra e' in corso aspetta
  quella, invece di partirne una seconda che si pestera' i piedi sul rinnovo;
- **si rilegge prima di buttare**: se in archivio c'e' un gettone **diverso** da
  quello provato, vuol dire che qualcun altro ha gia' rimediato, e si riprova
  con quello invece di dichiarare morto tutto.

Provato: tre letture lanciate insieme fanno partire **una** catena invece di
tre, buttano i gettoni **una volta sola** invece di tre, e restituiscono lo
stesso oggetto.

### Quel che si era creduto, e non era

Scritto perche' non torni, e perche' quattro di queste sembravano ragionevoli:

| ipotesi | com'e' caduta |
|---|---|
| il permesso dura poco | misurato: **31 giorni** |
| il rinnovo preventivo lo brucia | col margine vero non scattava mai |
| un nuovo accesso spegne i precedenti | il gettone del mattino funzionava ancora a notte fonda |
| il gateway o l'intestazione sbagliati | provati dal Mac: `msgCode 0`, tutto a posto |
| il gettone troncato in archivio | la colonna e' `TEXT`, 1835 caratteri ci stanno |

Tutte e cinque cadute **guardando**, non ragionando. E ogni volta che ho
corretto prima di guardare, ho corretto il ramo sbagliato.

### Seguito del 17 novembre: la contesa era vera, ma non era tutto

La correzione della notte ha funzionato per quel che prometteva — i log del
mattino non mostrano **nessuna** seconda catena di rinnovo partita in
parallelo, e la riga «in archivio c'e' un gettone piu' nuovo» non compare mai,
perche' non serve piu'. Ma il collegamento e' caduto comunque, alle 07:41, e i
log dicono che il guasto restante e' un altro e piu' semplice:

```
06:58:34  nuovo accesso dall'Agree, gettone di 1835 caratteri
06:58:39  lettura RIFIUTATA (805)       <- cinque secondi dopo
06:58:39  rinnovo riuscito, gettone nuovo
06:58:39  lettura ANCORA rifiutata      <- anche col gettone appena nato
06:58:39  permesso SCARTATO
06:59:29  un terzo accesso: lettura riuscita
07:11 / 07:13 / 07:26  lo stesso gettone legge bene
07:41  lo stesso gettone rifiutato, e scartato
```

**805 non vuol dire «permesso scaduto».** Un gettone di cinque secondi non e'
scaduto; nemmeno quello nato dal rinnovo; e lo stesso gettone rifiutato alle
06:58 leggeva bene alle 07:11. Il loro cloud rifiuta **a tratti**, per meno di
un minuto, qualunque gettone gli si porti — e il nostro codice leggeva quel
rifiuto come una sentenza e buttava tutto.

Due correzioni:

- **una pausa di sei secondi e un secondo tentativo**, che e' la durata della
  finestra nera piu' corta vista nei log;
- **non si butta piu' niente da soli.** Il costo di tenere un gettone morto e'
  un messaggio di errore; il costo di buttarne uno vivo sono le mani del
  proprietario sull'Agree. I due costi non si somigliano.

Le tre ragioni scritte a giustificazione del cestino sono cadute tutte: il
permesso era vivo, quindi buttarlo faceva dire al programma una bugia al
contrario; la porta non era chiusa; e il tasto nella pagina Impianto **c'e'
sempre**, e dice «Ricollega» quando il collegamento c'e'.

Lezione che si somma a quella di stanotte: **una diagnosi confermata da una
prova non e' una diagnosi completa.** La contesa c'era davvero e la prova la
riproduceva; semplicemente non era l'unico modo di perdere il collegamento. Il
modo di accorgersene non e' stato ragionare, e' stato tornare a leggere i log
il mattino dopo.

### Il guasto vero, terza e ultima lettura: lo facevamo noi

I log delle 08:11-08:14 del 17 novembre mettono in fila due fatti che insieme
chiudono il caso:

- alle **08:11:49** il gettone nato dal tuo Agree leggeva bene;
- dalle **08:12:59** in poi, **ogni gettone nato da un rinnovo e' stato
  rifiutato**: undici su undici, nessuna eccezione, mentre i gettoni nati da un
  accesso vero funzionavano quattro volte su sei.

E `rinnova()` **salvava il gettone nuovo prima che qualcuno l'avesse visto
funzionare.** Quindi:

1. un rifiuto passeggero fa scattare il rinnovo;
2. il gettone nuovo viene salvato **sopra** quello buono, senza prova;
3. il gateway non lo accetta;
4. da li' ogni lettura fallisce, e ogni fallimento rinnova di nuovo,
   sovrascrivendo con un altro gettone che non vale niente;
5. si risale solo col tuo Agree.

Il gettone buono lo cancellavamo noi, al primo inciampo del loro cloud.

Tre correzioni, in ordine di quanto possono far danno (dalla meno alla piu'):

- **prima si riprova lo stesso gettone.** Sei secondi di pausa. E' il solo
  rimedio che non puo' rompere niente, ed e' quello che mancava.
- **non si sostituisce mai un gettone che funziona con uno che nessuno ha visto
  funzionare.** Il gettone nato dal rinnovo si prova sulla richiesta che ci
  serviva comunque, e si salva solo se quella risponde. Altrimenti in archivio
  resta quello di prima.
- **un freno sul rinnovo**: non piu' di uno ogni dieci minuti. Senza freno ogni
  lettura rifiutata ne faceva uno, e con la pagina aperta sono tre al minuto.

Resta aperta una domanda, e vale la pena scriverla: **perche' il gateway non
accetta i gettoni nati dal rinnovo?** Undici su undici non e' sfortuna. Puo'
essere un parametro che manca nella richiesta di rinnovo (`scope`, o altro).
Finche' non si sa, il rinnovo e' inutile e il permesso va rifatto a mano una
volta al mese — un tocco su «Ricollega», con la scadenza di 31 giorni che
abbiamo misurato. Il log adesso distingue i due casi, quindi la prossima volta
la risposta sara' nei log invece che nelle ipotesi.

Lezione, la terza in due giorni: **il rimedio che non puo' far danno va provato
per primo.** Riprovare la stessa richiesta non rompe niente; rinnovare
sovrascrive. Avevamo messo il secondo prima del primo.

#### Correzione, venti minuti dopo: la causa era al rovescio

Scritto qui sopra: «ogni gettone nato da un rinnovo e' stato rifiutato, undici
su undici». Il fatto e' vero, la conclusione no.

Alle **08:19:41**, sei minuti dopo l'ultimo rinnovo e col contenitore appena
ripartito, **quello stesso gettone delle 08:13:52 — uno di quegli undici — ha
letto benissimo.**

Quindi il gateway non rifiuta i gettoni nati dal rinnovo. Li rifiutava perche'
li usavamo **dentro la grandinata**: con la pagina aperta ogni lettura
rifiutata faceva un rinnovo, tre al minuto, e il loro cloud ci sbatteva la
porta. I gettoni nati dall'Agree funzionavano piu' spesso per un motivo che non
ha niente a che vedere col gettone: un Agree succede quando intervieni tu, cioe'
**dopo** che la grandinata e' finita.

La correlazione era forte e la lettura era rovesciata. Vale la pena notare
**come** si e' smontata: non con un ragionamento migliore, ma perche' il
contenitore e' ripartito e ha fatto per caso l'unico esperimento che mancava —
usare un gettone «inutile» in un momento di calma. Il controesempio e' arrivato
da solo, venti minuti dopo che avevo scritto «chiuso il caso» per la terza
volta.

Delle tre correzioni, quella che conta e' **il freno**. Le altre due restano
buone per conto loro: riprovare lo stesso gettone non puo' far danno, e non
sovrascrivere un gettone che funziona con uno mai provato e' igiene a
prescindere da quale sia la causa.

E il rinnovo automatico **non e' inutile**, come avevo scritto due paragrafi
sopra: funziona, purche' non lo si chieda tre volte al minuto.
