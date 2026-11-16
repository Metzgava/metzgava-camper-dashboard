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
