# Lo stato delle batterie delle webcam Blink dentro Camper Servizi

Disegno breve, concordato il 17 novembre 2026. Modifica piccola.

## A che serve, e perche' adesso

Il proprietario vuole **sapere come stanno le batterie delle telecamere Blink
senza aprire l'app di Blink**. Nient'altro: non la videosorveglianza, non il
registro dei movimenti, non l'armare e disarmare.

La richiesta era «con periodicita' settimanale». Il disegno la gira, e il
proprietario ha accettato: **settimanale e' la domanda a Blink, non il
messaggio.** Perche' se l'app dicesse lo stato solo una volta la settimana,
l'informazione sarebbe vecchia fino a sei giorni nel momento in cui la guardi.
Quindi: si chiede a Blink una volta la settimana — che e' il ritmo giusto per
non consumare le batterie, che e' il vero limite — e **la pagina mostra sempre
l'ultima risposta con la sua data**.

## Quel che si fa

1. **Una riga per telecamera** nella pagina: nome, stato della batteria,
   tensione, potenza del segnale wi-fi, temperatura, e «letto lunedi' 17».
2. **Un evento nel registro** quando una batteria passa a scarsa. Il registro
   esiste gia' (`eventi`, tabella e pagina) e la pagina lo mostra: non si
   costruisce niente di nuovo.
3. **Il giro settimanale** dentro il giro periodico che c'e' gia'
   (`server.js`, `setInterval` ogni `LETTURE_MINUTI`), con la data dell'ultima
   lettura **in archivio** — cosi' un riavvio non fa ripartire il conto e non
   si interrogano le telecamere a ogni ripubblicazione.

La temperatura si prende perche' le telecamere la misurano e arriva con la
stessa richiesta: non costa una domanda in piu'. Va accanto alle batterie,
senza inventarle un ruolo.

## Quel che non si fa

- **Niente immagini, niente diretta, niente clip.** Per quello resta l'app di
  Blink. Qui si tratta di stato.
- **Niente armare e disarmare.** Il permesso lo consentirebbe; e' un comando
  sull'impianto di sorveglianza di casa d'altri e non e' stato chiesto.
- **Niente registro dei movimenti.** Chiesto esplicitamente di no, per ora.
- **Niente giri frequenti.** Le telecamere sono a batteria. Vanno anche
  **escluse dalla modalita' taratura**, che interroga tutto ogni dieci secondi.

## I vincoli

- **Blink e' solo cloud.** Non c'e' niente da interrogare sulla rete del
  camper. Quindi **non serve la scatoletta**: si puo' fare subito, dal server.
- **Una richiesta per volta per tutte le telecamere.** L'elenco completo con
  batteria, temperatura e segnale sta in **`homescreen`**, una sola chiamata.
  Esiste anche `.../camera/<id>/signals` per telecamera: **non si usa**, perche'
  sarebbe una richiesta per ciascuna e il punto e' risparmiare batteria.
- **La password del proprietario non passa da nessuna pagina scritta qui.**
  Vedi sotto.
- **Non si fida della memoria sulle chiamate di Blink.** Sono state lette dal
  codice di `blinkpy` (ramo `dev`, 17/11/2026), non ricordate: e il controllo e'
  servito, perche' Blink **ha cambiato** modo di far entrare. Non c'e' piu'
  l'accesso `v5/account/login` che si trova scritto in giro.

## Le chiamate, come stanno oggi

Lette da `blinkpy/api.py`, `blinkpy/auth.py`, `blinkpy/helpers/constants.py`:

1. **Entrare** — `POST https://api.oauth.blink.com/oauth/token`,
   corpo `application/x-www-form-urlencoded` con
   `username`, `password`, `client_id=android`, `scope=client`,
   `grant_type=password`; intestazioni `User-Agent: 27.0ANDROID_28373244`,
   `hardware_id` (un identificativo nostro, stabile, generato una volta), e
   `2fa-code` (vuoto la prima volta).
2. **Il codice usa-e-getta** — la stessa chiamata, con `2fa-code` valorizzato.
3. **La regione** — `GET https://rest-prod.immedia-semi.com/api/v1/users/tier_info`
   con `Authorization: Bearer <gettone>`. Da li' l'indirizzo vero diventa
   `https://rest-<regione>.immedia-semi.com`.
4. **Lo stato** — `GET <indirizzo>/api/v3/accounts/<conto>/homescreen`.
   I campi che servono: `battery_state` (testo), `battery_voltage`
   (centesimi di volt: 165 = 1,65 V), `temperature` (Fahrenheit, da
   convertire), `wifi_strength`, `name`.
5. **Rinnovare** — la stessa chiamata del punto 1 con
   `grant_type=refresh_token` e il gettone di rinnovo.

Quali di quei campi arrivino davvero da `homescreen` e quali solo da `signals`
va **verificato leggendo `update_from_homescreen` in `camera.py`** prima di
scrivere la pagina: se qualcuno manca, manca, e la riga lo dira'.

## Le due lezioni della Bluetti, applicate qui dal primo giorno

Costate due giorni di guasti il 16 e 17 novembre, e valgono per qualunque
cloud:

- **non si sostituisce mai un gettone che funziona con uno che nessuno ha visto
  funzionare.** Il gettone nato dal rinnovo si prova su una richiesta vera e si
  salva solo se quella risponde;
- **un freno sul rinnovo**, e prima del rinnovo **si riprova la stessa
  richiesta**: e' il solo rimedio che non puo' far danno.

I gettoni Blink stanno in `gettoni_cloud` come quelli Bluetti, con nomi
`blink_*`.

## Come entra la password — scelta del proprietario

Scelta la **(b)** fra tre:

- **(a)** un campo nella pagina Impianto. Scartata: la password passerebbe per
  una pagina scritta qui e per il server.
- **(b) scelta** — il proprietario mette `BLINK_EMAIL` e `BLINK_PASSWORD` fra
  le variabili del servizio su Railway, **da se'**; l'app le usa una volta per
  ottenere il gettone; poi **le cancella**. La password non attraversa nessuna
  pagina scritta qui, e non finisce nell'archivio.
- **(c)** aspettare la scatoletta e farlo in camper. Scartata: Blink e' cloud,
  quindi la scatoletta non aggiungerebbe niente di tecnico.

Il **codice usa-e-getta** invece si digita in un campo della pagina Impianto:
e' a uso singolo e scade in pochi minuti, e non c'e' altro modo di darglielo.

Ordine dei passi, perche' la password resti su Railway due minuti e non un
giorno: **prima il codice, poi le variabili.**

1. il codice e' pronto e pubblicato;
2. il proprietario mette le due variabili (il servizio si riavvia da se');
3. Impianto → **Collega Blink**;
4. Blink manda il codice, lui lo digita;
5. l'app salva **il gettone**, non la password;
6. lui **cancella le due variabili**.

L'app non deve mai scrivere la password in archivio, nei log, o in una
risposta. Nei log va la **forma** del gettone (lunghezza e prime lettere), come
per la Bluetti, e nient'altro.

## Quel che resta a chi scrive il codice

- Dove mettere la riga nella pagina: accanto alle batterie, ma il posto esatto
  e' una scelta di chi la vede.
- Che cosa dire quando non si e' mai letto niente, o quando l'ultima lettura e'
  piu' vecchia di due settimane (una telecamera spenta, o il gettone morto).
- Il nome del campo in archivio per la data dell'ultima lettura.
- Se `battery_state` arrivi come `ok` / `low` o con altre parole: si mostra
  quel che manda, tradotto, senza inventare soglie nostre sulla tensione.

---

## Correzione del 17/11/2026, ore 09:50: la premessa era falsa

Questo disegno diceva: «Blink e' solo cloud, quindi **non serve la
scatoletta**». **Misurato, e non e' vero** — o meglio, e' vero ma irrilevante.

Sonda con credenziali inventate su un indirizzo `@example.invalid`, nessun
account toccato:

```
POST https://api.oauth.blink.com/oauth/token   grant_type=password
-> 401 {"error":"unsupported_grant_type","error_description":"invalid grant type"}
```

Blink ha **ritirato** l'accesso con utente e password. Quel che resta e' il
flusso OAuth con PKCE che `blinkpy` usa oggi, e per entrare richiede: chiedere
l'autorizzazione, **scaricare la pagina HTML di accesso**, estrarre un token
CSRF da dentro un tag `<script>`, mandare le credenziali, verificare il codice,
catturare il codice da un reindirizzamento a uno schema per app mobili, e
scambiarlo per i gettoni.

Si puo' reimplementare. Ma si rompe il giorno che Blink ridisegna quella
pagina — e l'hanno appena cambiata, quindi ci stanno lavorando. Contro un
bersaglio che si muove, una libreria mantenuta vale piu' di una nostra
reimplementazione.

### Quel che cambia

**Blink si legge dalla scatoletta, con `blinkpy`.** Il proprietario ha scelto
questa via il 17/11/2026, sapendo che si aspetta la scatoletta.

- il Raspberry fa girare Python e gia' fa girare `agente.py`;
- lo stato delle telecamere entra per il canale che la scatoletta **ha gia'**:
  `POST /api/ingresso` con la sua chiave;
- quando Blink cambia qualcosa, `pip install -U blinkpy` risolve;
- **il server su Railway non vede mai la password Blink.** Cade tutta la
  faccenda delle variabili `BLINK_EMAIL` / `BLINK_PASSWORD`: non vanno messe.

Scelta sulla password: non piu' la **(b)** ma la **(c)** — in camper, sulla
scatoletta. Era quella che questo disegno chiamava «la piu' pulita, la piu'
lenta», e lo e' ancora: ma adesso e' anche la piu' robusta, che e' il motivo
per cui vince.

### E una cosa che viene gratis

`POST /api/ingresso` accetta misure solo dall'elenco delle grandezze ammesse,
e **`volt`, `rssi` e `temperatura` ci sono gia'**. Quindi la storia della
tensione di ogni batteria si archivia da se', senza toccare il server: fra un
mese si potra' vedere **come scende**, non solo com'e' adesso. Non era chiesto
e non si costruisce niente per averlo; viene dal canale che esiste.

Una cautela: la potenza del segnale va in `dati.segnale`, **non** in
`dati.rssi`. La pagina ha una scheda del segnale che pesca ogni istantanea con
`dati.rssi`, ed e' per gli apparecchi del camper: ci finirebbero dentro anche
le telecamere, mescolate a cose di natura diversa. Nelle `misure` invece
`rssi` va benissimo, perche' quelle sono storia, non pagina.

### Quel che non cambia

Tutto il resto: settimanale e' la domanda, la pagina mostra sempre l'ultima
risposta con la sua data; niente immagini ne' diretta ne' clip; niente armare
e disarmare; niente registro dei movimenti; la temperatura si prende perche'
arriva con la stessa richiesta; le Blink fuori dalla taratura.
