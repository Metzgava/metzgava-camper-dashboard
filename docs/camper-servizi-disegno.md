# Camper Servizi — disegno

Scritto il 16 novembre 2026, dopo una giornata passata a misurare invece di
supporre. Quel che si legge e come sta in `docs/telemetria-camper.md`.

## Perché esiste

L'app dei viaggi racconta dove si è stati. Questa risponde a domande di un
altro tipo, e sono domande che si fanno **prima** di partire o **mentre** si è
lontani dal camper:

- quanta corrente c'è, adesso, e quanto durerà;
- quante ore di motore servono per ricaricare la Bluetti;
- se conviene fermarsi a una colonnina, e per quanto;
- quanta Bluetti serve per rimettere in forza le batterie di servizio;
- e se l'allarme è inserito, perché senza SIM nella centrale la notifica è
  l'unico avviso che esiste.

Sono conti, non ricordi. Per questo sta a parte.

## Obiettivi

1. **Consultabile da ovunque**, dal telefono, senza essere nel camper.
2. **Numeri veri o niente.** Un valore che non arriva si scrive «—». Uno zero
   su una carica significa *scarica*, e non si scrive per riempire un buco.
3. **Ogni proiezione dichiara su cosa si basa**: «stima da catalogo» oppure
   «misurato il 20/11 su 40 minuti». Un conto che sembra misurato e non lo è
   fa prendere decisioni sbagliate con sicurezza.
4. **Storia, non solo istantanee.** Un numero dice com'è adesso; solo una fila
   di numeri dice se sta scendendo e quanto in fretta.

## Non obiettivi

- **Non comanda niente**, nella prima versione. Legge. L'allarme si inserisce
  dall'app Tuya, la Bluetti dall'app Bluetti. Il comando si aggiunge dopo, se
  serve, e con un passo in più di conferma.
- Non sostituisce le app dei costruttori: non rifà quello che fanno bene.
- Non tocca l'app dei viaggi.

## Anti obiettivi — cosa la farebbe fallire anche se funzionasse

- Mostrare un numero di cui non si sa la provenienza.
- Una proiezione che si spaccia per misura.
- Una notifica che arriva alle tre di notte per due punti percentuali: si
  disattiva in una settimana, e con lei si perde anche quella che serviva.

## Vincoli, misurati oggi

| apparecchio | come parla | da remoto |
|---|---|---|
| Bluetti Elite 300 | cloud Bluetti, OAuth2 + REST | **sì** |
| Centrale d'allarme | cloud Tuya (firma delle richieste) | **sì** |
| Ective ×2 | **solo Bluetooth** | serve la scatoletta |
| SmartSolar, Orion XS | **solo Bluetooth** (annunci cifrati) | serve la scatoletta |
| Starlink | solo dalla rete del piatto | serve la scatoletta |
| Bluetti Charger 2 | non è nel cloud; da verificare se ha wi-fi | — |
| CarLock | esportazione a mano | sì, come oggi |
| Truma Combi (CP plus) | bus LIN, connettore iNet Box **predisposto e libero** | serve una basetta sua |
| Frigo Dometic da incasso | **non ha radio**: niente da leggere | mai direttamente |
| Temperature in cellula | termometri Bluetooth BTHome/ATC, in chiaro | serve la scatoletta |

Sette apparecchi su otto parlano solo a chi è dentro il camper. **Questo non è
un dettaglio tecnico: è la ragione per cui esiste la scatoletta.**

## Le strade considerate, e quella scelta

**Per leggere da remoto Ective e Victron.** Una scatoletta in camper era
l'unica via; la scelta era quale.

- *Raspberry Pi Zero 2 W* — **scelto.** ~30 €, ~1,5 W. Ospita i
  decodificatori già scritti e provati oggi, senza riscriverli.
- *ESP32* — 10 €, 0,4 W, ma tutto da riscrivere in C++, protocollo dell'allarme
  compreso. Più lavoro, meno margine per cambiare idea.
- *Victron Cerbo GX* — 300 €, soluzione ufficiale, ma **non legge le Ective**
  né la Bluetti. Dieci volte il costo per metà del risultato.

**Per la separazione dall'app dei viaggi.**

- *Servizio a parte su Railway, stesso PostgreSQL, stesse credenziali* —
  **scelto.** Pubblicazioni e codice separati, così una modifica ai servizi non
  può fermare i viaggi; un solo archivio da pagare e da salvare; un solo
  elenco di utenti.
- *Del tutto indipendente* — separazione totale, ma un secondo database e un
  secondo account.
- *Stesso servizio, due indirizzi* — il più economico e il più fragile: un
  errore nei servizi fermerebbe anche i viaggi.

**Un avvertimento su «stesse credenziali».** Lo stesso elenco utenti dà la
stessa email e la stessa password, ma **una sessione sola** vuole un dominio
comune (per esempio `viaggi.…` e `servizi.…` sotto lo stesso dominio): due
indirizzi `*.up.railway.app` non possono scambiarsi un cookie. Senza dominio
proprio si entra due volte, con le stesse credenziali. Da decidere, non da
subire.

## Come è fatta

**Tre pezzi.**

1. **La scatoletta** (Pi in camper). Legge e manda fuori. Non mostra niente e
   non decide niente: se cade, si perde la storia di quelle ore, non il
   servizio.
   - Victron: **annunci passivi**, senza collegarsi. È la via robusta: niente
     connessioni da tenere, niente apparecchio occupato.
   - Ective: collegamento e notifiche su `FFE4`.
   - Allarme: connessione locale tenuta aperta in ascolto, per sentire lo scatto
     nell'istante in cui avviene.
   - **Tiene in tasca quel che non riesce a spedire.** Il 4G del camper cade:
     una lettura in coda è una lettura salvata.
   - Si autentica con un segreto suo: la scatoletta può scrivere letture, e
     nient'altro.

2. **Il servizio** (Railway). Riceve dalla scatoletta, interroga i cloud
   (Bluetti ogni pochi minuti, Tuya per l'allarme), tiene la storia, fa i conti.

3. **La pagina.** Una schermata sola, che si legge dal telefono in piedi: lo
   stato adesso in cima, i conti sotto, la storia in fondo.

**L'archivio.**

- `misure` — la fila delle letture: quando, apparecchio, grandezza, valore.
  Formato lungo invece che largo, così aggiungere un apparecchio non vuol dire
  cambiare la tabella.
- `gettoni_cloud` — i gettoni che si rinnovano da soli. Non possono stare in
  una variabile d'ambiente: un gettone rinnovato dal programma non sa
  tornarci dentro. La variabile ne semina il primo, poi la verità sta qui.
- `impianto` — i dati fissi del camper: capacità, potenze, rendimenti. **Non
  nel codice**: sono tuoi, cambiano quando cambi un pezzo, e si modificano
  dalla pagina.
- `rendimenti` — quel che si è *misurato*: ogni ricarica osservata lascia il
  suo ritmo reale, e le proiezioni smettono di fidarsi del catalogo.

## Un vincolo che vale quanto gli altri: non si mette mano all'impianto

Tutto quel che il progetto legge lo legge **ascoltando**: radio Bluetooth e
pacchetti sulla rete. Niente in serie, niente in parallelo, nessun morsetto.
Gli annunci Victron si leggono perfino senza collegarsi.

L'unica cosa fisica è dare corrente alla scatoletta, e si fa **da una presa a
12 V già esistente** nella cellula — un alimentatore da auto con uscita USB e un
cavetto, come caricare un telefono. Spegnere è staccare la spina.

Il collegamento diretto alle batterie, con fusibile, è **escluso dal progetto**:
è lavoro sull'impianto, e non lo fa chi non vede i cavi dal vivo.

Lo stesso vale per il relè trovato il 16 novembre: è una **segnalazione**
ricavata da tre letture radio, non una prescrizione. La verifica si fa
dall'app VictronConnect — un interruttore nel software — e qualunque decisione
successiva è di chi ha progettato l'impianto.

## I conti, e come si fanno onestamente

Ogni conto ha due versioni: **stima** (dai dati di targa) e **misura** (dal tuo
impianto). Si parte dalla prima e si passa alla seconda appena c'è una ricarica
vera da osservare. La pagina dice sempre quale delle due sta mostrando.

| conto | come |
|---|---|
| Carica residua Bluetti | percentuale × capacità |
| Consumo adesso | uscite AC + DC |
| Autonomia | la dichiara lei; si confronta col consumo misurato |
| **Ore di motore col Charger** | energia che manca ÷ watt di carica |
| **Tempo da colonnina** | energia che manca ÷ watt in alternata |
| **Quanta Bluetti per le Ective** | energia che manca alle Ective ÷ rendimento della catena |

Il rendimento della catena (Bluetti → inverter → caricabatterie → Ective) è
proprio il numero che nessun catalogo sa: si misura guardando salire la carica
delle Ective mentre scende quella della Bluetti.

**Perché insisto.** Oggi l'Orion XS dichiarava di erogare 6 A mentre le
batterie ne ricevevano 26. La causa era un relè che nessun depliant conosce. Un
conto fatto sui dati di targa avrebbe sbagliato di quattro volte.

## Cosa manca per cominciare

Tre dati che non posso indovinare e che non invento:

1. **Charger 2**: modello e watt di carica.
2. **Cosa carica le Ective dalla 220**, e di quanti ampere.
3. **Da colonnina**: l'Elite 300 attaccata diretta, o passa da qualcosa?

E una verifica da fare nell'app: **il Charger compare collegato al wi-fi, o solo
in Bluetooth?** Sulla rete del camper restano due apparecchi senza nome: se uno
è lui, gli manca solo la registrazione sul conto Bluetti.

## Lasciato a chi costruisce

- Il nome esatto delle grandezze in `misure` e i loro fattori di scala.
- Il passo di lettura per apparecchio: l'allarme in fretta, le batterie piano.
- Quanto tenere la storia prima di assottigliarla.
- La forma della pagina, finché rispetta la regola del «—» e quella della
  provenienza di ogni numero.

## Due cose possibili che restano fuori dalla v1

Accertate il 16 novembre 2026, scritte qui perché non si riscopra la ruota.

**La Truma si legge.** La iNet Box non c'è, ma la predisposizione sì: il
connettore del bus LIN è libero e il pannello è un CP plus *inet ready*. Chi si
attacca fingendosi una iNet Box legge temperatura ambiente e dell'acqua, le
temperature impostate e il modo. Non entra nella v1 per una ragione hardware,
non di voglia: sul Pi Zero 2 W la seriale buona è occupata dal Bluetooth, e un
bus LIN non convive con venti secondi di ascolto radio per giro. Vuole una
basetta sua (ESP32 + ricetrasmettitore LIN), che costa poco e si infila nel
connettore senza toccare l'impianto. Collegamenti e trappole —  fra cui il
«PR SET» da scegliere sul pannello — in `telemetria-camper.md`.

**Comandare la Truma si potrebbe, e per ora no.** Accendere una stufa a gas in
un veicolo da remoto è un comando di natura diversa da «accendi l'uscita in
alternata». Resta documentato e non implementato: è una decisione da prendere
apposta, non un effetto collaterale di una funzione.

**Il frigo no, e non è un limite da superare.** I Dometic da incasso non hanno
radio: non c'è un protocollo da aprire, non c'è nulla che parli. Quel che si
ottiene — e basta — è la temperatura dentro con un termometro Bluetooth da
pochi euro, e il consumo di riflesso dai gradini di corrente delle Ective
quando il compressore parte e si ferma. Il secondo è una stima, e in pagina
porterà il bollino della stima.
