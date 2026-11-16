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

**Serve la `C`, e almeno `C 3.00.00`**: è il requisito che Truma mette per la
iNet Box nella tabella delle combinazioni di collegamento.

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
