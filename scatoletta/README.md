# La scatoletta

Il pezzo che sta in camper. Legge gli apparecchi che parlano solo da vicino —
Bluetooth, e l'allarme sulla rete locale — e manda le misure a Camper Servizi,
che le mostra da qualunque parte del mondo.

È un Raspberry Pi Zero 2 W attaccato a una presa da 12 V. Non ha schermo, non
ha tastiera, non ha bottoni: si accende e lavora.

## Le tre regole

Sono le stesse della pagina, e valgono più di qualsiasi funzione:

1. **Un valore che non si sa non si inventa.** Un apparecchio che non risponde
   viene saltato. Non manda zeri: uno zero sembra una misura.
2. **Una lettura fuori scala non si spedisce.** Quasi sempre vuol dire che un
   decodificatore ha perso un byte. Il server la rifiuterebbe comunque, e lo
   scrive nel diario invece di ingoiarla.
3. **Quel che non si riesce a spedire si tiene in tasca.** Il 4G del camper
   cade. Le letture restano in `coda.jsonl` e partono appena la rete torna.

## Cosa legge

| Apparecchio | Come | Serve altro? |
|---|---|---|
| Orion XS (carica dal motore) | annunci Bluetooth cifrati | la chiave da VictronConnect, una volta |
| Pannelli solari Victron | annunci Bluetooth cifrati | idem |
| Ective 1 e 2 (le batterie) | connessione Bluetooth, testo su FFE4 | no |
| Termometri SwitchBot (i tre di bordo) | annunci Bluetooth in chiaro | no |
| Termometri BTHome / ATC | annunci Bluetooth in chiaro | i termometri, se se ne aggiungono |
| Allarme Tuya | rete locale, protocollo 3.5 | la sua chiave locale |
| Bluetti Elite 300 V2 | **non passa da qui**: la legge il server dal cloud | no |
| Truma Combi | **non ancora**: vedi sotto | una basetta in più |
| Frigo | **non si collega**: vedi sotto | un termometro dentro |

## Metterla in piedi

### 1. Il sistema, con Raspberry Pi Imager

Scheda da 16 o 32 GB. In Imager:

- sistema: **Raspberry Pi OS Lite (64 bit)** — senza interfaccia grafica, il
  Pi Zero non ne ha bisogno e consuma meno;
- l'**ingranaggio** delle impostazioni: nome `bergava-scatoletta`, utente e
  password tuoi, **SSH acceso**, e una rete WiFi con la sua password.

Quell'ingranaggio fa metà del lavoro. Senza, il Raspberry parte muto e non lo
raggiungi.

**Quale rete mettere: quella dove sarai alla prima accensione.** Sembra ovvio
e non lo è, perché la risposta istintiva è «quella del camper» e quasi sempre
è sbagliata: il Raspberry si accende per la prima volta sul tavolo di casa.
Se in Imager c'è `bergamobile` e tu sei in cucina, il Raspberry parte, non
trova niente, e resta irraggiungibile — senza schermo e senza tastiera non
c'è modo di dirglielo, e si ricomincia dalla scheda.

Quindi: **in Imager va la rete della prima accensione.** L'altra si aggiunge
dopo, da ferma, con `./aggiungi-rete.sh` (vedi «Una seconda rete WiFi» più
sotto), e da quel momento aggancia da sé quella che trova. È esattamente il
problema per cui quello script esiste.

**E deve essere una rete a 2,4 GHz.** Il Pi Zero 2 W ha un'antenna che
funziona solo su quella banda: una rete a 5 GHz per lui non esiste, non la
vede nemmeno nell'elenco. Il 18/11 è costata mezz'ora — la scatoletta si è
accesa, ha espanso la partizione, è arrivata in fondo all'avvio, e non è mai
comparsa in rete. Il sintomo è identico a quello della rete sbagliata, e
nessuno dei due dà un errore da nessuna parte: il LED lampeggia, il sistema
funziona, e non c'è niente da leggere.

Molti router pubblicano due nomi — `casa` e `casa-5G`, oppure due reti con
nomi diversi — e **non è detto che quello senza suffisso sia il 2,4**. Qui
era il contrario: `bergava` era il 5 GHz e il 2,4 si chiamava `BERGAVA iot`.
Il controllo è sul telefono, prima di scrivere la scheda.

**Il nome va copiato carattere per carattere.** `bergava iot` e `BERGAVA iot`
sono due reti diverse per un Raspberry. Si guarda l'elenco WiFi del telefono
e si copia quel che c'è scritto, maiuscole e spazi compresi — non quel che si
ricorda.

**Se la rete a 2,4 GHz è una rete separata** — quelle che si chiamano `iot` o
`ospiti` quasi sempre lo sono — la scatoletta prende un indirizzo su un'altra
sottorete, e allora `bergava-scatoletta.local` **non risponde più dal Mac**:
il meccanismo dei nomi `.local` non attraversa il confine fra due reti. Non è
un guasto e non impedisce niente: si entra con l'indirizzo numerico
(`ssh metz@10.10.3.x`), che si trova passando in rassegna quella sottorete.
Il primo controllo da fare è se il Mac ci arriva affatto: si prende
l'indirizzo del telefono collegato a quella rete e si prova a chiamarlo.

In camper la complicazione sparisce, perché lì tutto sta sulla stessa rete.

### 2. Il config

```bash
cp config.json.esempio config.json
```

Poi riempilo. Le voci che contano:

| Voce | Cos'è |
|---|---|
| `server` | `https://bergava-bait-servizi.up.railway.app` |
| `chiave` | la chiave della porta d'ingresso (la stessa che sta su Railway come `INGEST_TOKEN`) |
| `minuti` | ogni quanto fa un giro. 5 è un buon compromesso fra freschezza e corrente |
| `victron` | per ogni apparecchio: indirizzo MAC → chiave di cifratura |
| `termometri` | per ogni termometro: indirizzo MAC → come lo vuoi chiamare |
| `allarme` | id e chiave locale della centrale. Lasciali vuoti e l'allarme si salta |

`config.json` **non va in git**: contiene chiavi. Le chiavi vere stanno in
`segreti/` sul Mac.

### 3. La scheda

Con la scheda infilata nel Mac:

```bash
bash prepara-scheda.sh
```

Copia `agente.py`, `installa.sh` e il tuo `config.json` sulla partizione di
avvio, e ti stampa l'ultima riga da incollare. Lo script controlla di stare
scrivendo davvero su una scheda del Raspberry (cerca `config.txt`) e si rifiuta
di partire se la chiave è ancora da riempire.

### 4. L'accensione

Infila la scheda, dai corrente, aspetta due minuti. Poi, dal Mac sulla stessa
rete, **una riga una volta sola**:

```bash
ssh TUOUTENTE@bergava-scatoletta.local 'cp -r /boot/firmware/scatoletta ~/ && bash ~/scatoletta/installa.sh'
```

La riga esatta, col tuo nome utente già dentro, la stampa `prepara-scheda.sh`
e resta scritta sulla scheda in `scatoletta/COME-SI-FINISCE.txt`.

Da quel momento parte da sola a ogni accensione, si rialza se cade, e non
chiede più niente.

**Perché una riga e non zero.** Mi piacerebbe dire «dai corrente e basta». Non
è onesto: la partizione grande del Raspberry è `ext4` e un Mac non la sa
scrivere, e l'unico gancio che resta sulla partizione di avvio
(`systemd.run=` in `cmdline.txt`) è esattamente quello che usa Imager per
configurare rete e utente. Rubarglielo vorrebbe dire una scheda che parte
senza wifi — cioè un Raspberry irraggiungibile, che è il guasto peggiore di
tutti. Meglio una riga.

### Come sta

```bash
ssh TUOUTENTE@bergava-scatoletta.local 'systemctl status scatoletta'
```

```bash
ssh TUOUTENTE@bergava-scatoletta.local 'journalctl -u scatoletta -f'
```

Il diario di sistema sta in memoria e non sulla scheda: le schede di memoria
si consumano a forza di scritture, ed è il guasto più comune di un Raspberry
montato su un veicolo.

### 5. Le webcam Blink, se le vuoi in pagina

Serve una volta sola, e poi mai più: dopo questo, l'app mostra sempre lo stato
delle batterie delle telecamere, aggiornato **una volta la settimana**.

Perché settimanale e non più spesso: le telecamere sono a batteria, e ogni
interrogazione costa carica. Una volta la settimana basta per accorgersi che
una batteria sta finendo, prima che finisca.

Perché si fa qui e non dal server: Blink ha chiuso l'accesso con utente e
password, e quel che resta lo sa fare `blinkpy`, che è Python e quindi gira
qui. La conseguenza buona è che **la tua password non arriva mai al server**.
Su Railway non va messo niente.

`installa.sh` lo installa già da sé, quindi se hai preparato la scatoletta
dopo il 17 novembre 2026 questo passo è fatto. Altrimenti:

```bash
ambiente/bin/pip install blinkpy
```

Il comando usa **`ambiente/bin/pip` e non `pip3`**: la scatoletta tiene le sue
librerie in un ambiente a parte, ed è quello che il servizio usa. Su Raspberry
Pi OS il `pip3` di sistema rifiuta comunque di installare.

```bash
ambiente/bin/python blink-accedi.py
```

Chiede l'email e la password — che **non si vede mentre la digiti e non viene
scritta in nessun file**. Sul disco finisce solo il gettone, e puoi
controllarlo: apri `segreti/blink.json` e la password non c'è. Poi Blink ti manda un codice usa-e-getta per email
o per SMS: scrivilo lì. Se è andata, elenca le telecamere che ha trovato e
salva un gettone in `segreti/blink.json`.

Controlla che l'elenco sia quello giusto: se mancasse una telecamera, è il
momento di accorgersene.

Ultimo passo, in `config.json`:

```json
"blink": { "attivo": true, "giorni": 7 }
```

Al primo giro dopo questo, le telecamere compaiono nella pagina. Se vuoi
smettere, basta rimettere `"attivo": false`: il gettone resta dov'è.

Una cosa che viene gratis, e che vale la pena sapere: la tensione di ogni
batteria finisce anche nello storico, come le altre misure. Quindi fra un mese
non vedrai solo **com'è**, ma **come sta scendendo** — che è il dato che dice
quando conviene ricaricarle.

## Una seconda rete WiFi

Il camper oggi ha il TP-Link `bergamobile`. Domani il portante potrebbe
cambiare — Starlink, una SIM, il WiFi di casa d'inverno. La scatoletta puo'
tenerne in memoria **piu' di una** e agganciare quella che trova, da se'.

Sulla scatoletta, una volta per rete:

    ./aggiungi-rete.sh

Chiede nome e password, scrive il profilo di NetworkManager e finisce. Chiede
anche **quale preferire** quando ci sono entrambe.

**Non c'e' un tasto nell'app per cambiare rete, ed e' una scelta.** Un comando
del genere viaggerebbe sulla rete che sta per spegnere: se la nuova non c'e',
la scatoletta resta in un posto dove non la raggiungi piu', e il canale per
dirle «torna indietro» e' esattamente quello che le hai appena tolto. Due reti
in memoria risolvono lo stesso problema senza quel rischio, e funzionano anche
quando nessuno guarda — che e' il requisito vero.

Tre dettagli del come, che sembrano pignoleria e non lo sono:

- **la password non passa dalla riga di comando.** `nmcli device wifi connect
  ... password X` la metterebbe negli argomenti del processo, dove `ps` la
  mostra a chiunque sia connesso in quel momento;
- **non si attiva niente.** Un `connect` cambierebbe rete subito, buttando giu'
  la sessione SSH da cui stai lanciando lo script;
- **funziona anche se la rete nuova non e' a portata.** Un `connect` la vuole
  in aria adesso; un profilo su disco aspetta il suo turno, quindi Starlink lo
  puoi preparare da casa.

Il file nasce leggibile solo da root, e la password non si vede mentre la
batti. Provato in `prove/test_reti.py`, che controlla anche che non finisca
negli argomenti di `nmcli`.

## Due cose che non ci sono ancora

### La Truma

Si può leggere, e anche comandare. Il pannello CP plus parla su un bus LIN, e
sul camper la **predisposizione per la iNet Box c'è**: cioè il connettore
libero esiste già. Chi si attacca a quel bus fingendosi una iNet Box legge
temperatura ambiente, temperatura dell'acqua, le due temperature impostate e
il modo di funzionamento.

Ma non lo può fare questo Raspberry, e il motivo è hardware: sul Pi Zero 2 W
la seriale buona (PL011) è occupata dal Bluetooth, che a noi serve per
Victron, Ective e termometri. Resta la mini-seriale, la cui velocità dipende
dal clock della CPU — e un apparecchio che su un bus LIN deve rispondere entro
pochi millesimi di secondo non si regge su una velocità che balla. A peggiorare
le cose, questo agente passa venti secondi per giro in ascolto Bluetooth: in
quei venti secondi perderebbe ogni richiesta del bus.

Quindi la Truma vuole una basetta sua — un ESP32 con un ricetrasmettitore
LIN — che sta sul bus a tempo pieno e non fa altro. Costa poco e non si tocca
niente dell'impianto: si infila nel connettore predisposto. Dettagli e
collegamenti in [`../docs/telemetria-camper.md`](../docs/telemetria-camper.md).

### Il frigo

Il frigo non si collega: i frigo da incasso Dometic non hanno radio, né
Bluetooth né altro. Non c'è niente da decodificare, non c'è una porta chiusa:
non c'è la porta.

Due cose si ottengono comunque, e insieme bastano:

- **la temperatura dentro**, con un termometro Bluetooth da pochi euro appoggiato
  in un cestello. Questo agente li legge già (SwitchBot, BTHome o ATC, in
  chiaro, senza accoppiamento);
- **il consumo**, che si vede di riflesso sulla corrente delle Ective: il
  compressore parte e si ferma, e quei gradini nella corrente sono il frigo.
  Non è una misura diretta, e la pagina lo dirà: una stima è una stima.
