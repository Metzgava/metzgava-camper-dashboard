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

## La regola automatica sulla stufa: da quale corrente viene il caldo

Chiesto dal proprietario il 16 novembre 2026: «imposto MIX e se le batterie
scendono sotto una certa percentuale passo a gasolio». Si può fare, ma la regola
così com'è detta è giusta in un caso e rovesciata nell'altro, perché **MIX non
prende corrente dalle batterie**.

### Chi consuma cosa

| modo | 230 V | 12 V dalle batterie |
|---|---|---|
| Gasolio | niente | ventola aria calda **+ ventola di combustione + pompa gasolio + candeletta** |
| MIX | 900 o 1800 W | come il gasolio (il bruciatore lavora comunque) |
| EL | 900 o 1800 W | solo la ventola aria calda |

Quindi, a 12 V, **il gasolio costa più dell'elettrico**, non meno: accende una
pompa e una seconda ventola. Se il problema sono le Ective, passare a gasolio le
scarica di più.

### Dove la regola del proprietario è giusta

Dipende da **chi fa i 230 V**:

- **colonnina o rete di casa** — l'elettrico non tocca le batterie. Se la rete
  cade, MIX ripiega da sé sul gasolio (vedi `telemetria-camper.md`): non serve
  nessuna automazione, il pannello lo fa già.
- **l'inverter della Bluetti** — allora la regola è esattamente giusta, e pesa:
  1800 W su una Elite 300 sono poco più di un'ora e mezza di autonomia. Qui
  togliere il carico elettrico e passare al gasolio è la cosa che salva la
  serata.

**L'app sa distinguere i due casi senza chiederlo**: se la Bluetti sta *ricevendo*
in alternata c'è rete esterna; se sta *erogando* in alternata mentre la stufa
scalda, il caldo lo sta pagando lei.

### La regola, come va scritta

1. Rete esterna presente → resta in MIX, non fare niente.
2. 230 V dalla Bluetti e carica sotto soglia → passa a **Gasolio**: toglie
   900 o 1800 W dall'inverter.
3. Ective sotto una soglia bassa → **non** passare a gasolio: avvisa, e proponi
   di spegnere. In gasolio il consumo a 12 V sale, e sotto una certa carica
   accendere è peggio che stare al freddo.

Il manuale della stufa ha già il suo pavimento: errore `#170`, sottotensione
sotto 11,5 V. Le nostre soglie stanno molto più in alto, perché 11,5 V su
LiFePO4 e' una batteria già maltrattata.

### Quattro condizioni, perché un'automazione non è un bottone

Un bottone lo premi e guardi. Una regola agisce mentre dormi.

1. **La regola vive sulla scatoletta, non sul server.** Se cade il 4G la regola
   deve funzionare comunque: è proprio quando nessuno guarda che serve. Il
   server tiene la soglia, il Raspberry la applica.
2. **Isteresi e tempo minimo.** Si scende a gasolio al 25 % e si torna a MIX al
   40 %, con un minimo di permanenza. Senza margine la stufa sfarfalla fra i due
   modi intorno alla soglia.
3. **Due letture d'accordo prima di agire.** Una lettura singola può essere
   sbagliata, e un cambio di modo deciso da un byte perso è un guasto nostro.
4. **Ogni azione automatica si scrive e si vede in pagina**: «alle 03:12 passata
   a gasolio, la Bluetti era al 24 %». Un'automazione che non racconta cosa ha
   fatto è indistinguibile da un guasto.

### Cosa manca per decidere

Una sola cosa, e va chiesta al proprietario: **i 230 V del camper, quando non
c'è colonnina, li fa la Bluetti?** Se sì, la regola 2 è la più utile di tutta
l'app. Se no, la stufa elettrica funziona solo attaccati alla rete e la regola
non ha occasione di scattare.

## Dove va montato l'ESP32, e una correzione al disegno

Chiesto il 16 novembre 2026: «l'ESP lo devo collegare al pannello o vicino alla
Truma?». Elettricamente è indifferente — il TIN è un **bus**, i tre apparecchi
stanno sugli stessi due fili e chi si attacca lo sente da qualunque punto. La
scelta è quindi tutta pratica, e cambia il disegno.

### USB o wifi: chiusa, si va in USB

**Deciso il 16 novembre 2026.** Il proprietario ha verificato il punto che
decideva: **vicino al CP plus non c'è nessuna presa a 12 V**. Quindi il cavo va
tirato in ogni caso, e fra i due conviene tirare quello che porta anche i dati —
l'RJ12 — invece di una linea a 12 V che poi lascia il collegamento in mano al
wifi.

Il seguito di questa sezione resta come documentazione del confronto: serve
perché la stessa domanda tornerà quando si monterà qualcos'altro sul camper, e
la risposta non è «USB è meglio», è «guarda prima dove sono le prese».

### Il confronto, come era

**Riaperta il 16 novembre 2026**, e per un buon motivo: scoperto che il modulo
LIN **vuole 12 V** (su un bus LIN il riposo è la tensione di batteria, e il
ricetrasmettitore misura le soglie rispetto alla propria alimentazione), il
mio argomento principale per la USB — «un'alimentazione sola» — è caduto.
Dove va l'ESP32 ci devono essere i 12 V comunque, e dove ci sono i 12 V si
alimenta anche l'ESP32 con sei euro di adattatore.

Cosa resta davvero in favore della **USB**:

- **il collegamento non può cadere.** Per la sola lettura è un vantaggio tenue;
  per **mandare un comando a una stufa a gas** è l'argomento serio. Via wifi,
  un comando può non arrivare e l'app non lo sa; via USB non esiste il caso.
- la coda offline del Raspberry copre anche le letture della Truma, gratis;
- nessuna password del wifi dentro l'ESP32, da rifare se la rete cambia;
- un apparecchio solo da diagnosticare invece di due;
- si riflasha dal Raspberry senza smontare niente.

Cosa resta in favore del **wifi**:

- **i due ottimi non coincidono.** Il Raspberry vuole stare dove sente meglio il
  Bluetooth; l'ESP32 vorrebbe stare dove c'è il bus. Senza fili ognuno sta dove
  gli conviene.
- **niente cavo da far passare.** Tirare cinque metri di RJ12 dentro i mobili di
  un camper è la parte piu' faticosa di tutto il lavoro, e il wifi la cancella.
- ESPHome fa wifi e aggiornamenti via rete molto bene: non è una strada
  sperimentale, è quella per cui quel componente è nato.

### Quel che decide non è USB contro wifi

È **dove c'è una presa a 12 V già esistente**, perché all'impianto non si mette
mano:

- se quel punto è **vicino al pannello** → cavo RJ12 corto, i due apparecchi
  stanno insieme, e la USB è semplicemente più semplice;
- se quel punto è **lontano dal pannello** → o si tira il cavo lungo (USB), o
  l'ESP32 va vicino al pannello e il wifi diventa la strada naturale, a patto di
  risolvere i suoi 12 V lì.

Quindi: **si decide dopo le foto**, e la cosa buona è che **non cambia l'ordine**.
L'ESP32 fa wifi di suo, l'adattatore OTG costa un euro, e l'unica voce che
cambia è la lunghezza del cavo RJ12.

Regola di decisione, scritta ora per non riaprirla a caso: **se i comandi alla
stufa entrano in Camper Servizi, si va in USB**; se resta solo lettura, va bene
la via che costa meno fatica di montaggio.

### Come era scritto prima (e perché si era arrivati alla USB)

Prima qui c'era scritto che l'ESP32 «espone i suoi valori sulla rete del camper
e la scatoletta li raccoglie». Funziona, ma è la variante peggiore. Meglio:
**l'ESP32 infilato nella USB del Raspberry**, con un cavo RJ12 che corre fino al
bus della Truma.

Cosa si guadagna:

- **un'alimentazione sola.** L'ESP32 la prende dal Raspberry, che è già
  alimentato. Via un alimentatore, via un punto 12 V da trovare.
- **niente wifi per l'ESP32.** Niente secondo cliente sulla rete, niente
  indirizzo da ritrovare, niente da riconfigurare se la rete cambia. La radio
  del camper e' una cosa che cade: togliere una dipendenza è guadagno netto.
- **la coda offline gratis.** Le letture della Truma entrano nello stesso pacco
  delle altre e seguono la stessa strada: se la rete non c'è finiscono in
  `coda.jsonl` e partono dopo. Con il wifi avrei dovuto rifare quel pezzo
  sull'ESP32.
- **la chiave resta in un posto solo.** L'ESP32 non sa niente del server.
- **si aggiorna senza smontare niente**: si riflasha dal Raspberry o dal Mac.

Cosa si perde: il cavo RJ12 deve arrivare dal Raspberry al bus. A 9600 baud su un
bus nato per i veicoli, qualche metro non è niente — un RJ12 6P6C da 2 o 5 m
costa dieci euro. Serve in più un adattatore **micro-USB OTG** per il Pi Zero
(~5 €), e vale ricordare che l'ESP32 chiede un centinaio di milliampere al
Raspberry.

Resta in piedi la ragione per cui l'ESP32 esiste: lo schiavo LIN deve rispondere
entro millesimi e non può vivere nello stesso processo che passa venti secondi
per giro in ascolto Bluetooth. Quella separazione non cambia; cambia solo come i
due si parlano.

### L'ordine dei posti, dal migliore al peggiore

1. **Dove sta la predisposizione**, se la si trova. Knaus ha già risolto tutto:
   posto, accesso, corrente, e lontano dal caldo. Era pensato per una scatoletta
   come questa.
2. **Accanto al Raspberry**, col cavo RJ12 che va al bus. Un posto solo da
   raggiungere quando qualcosa non va.
3. **Dietro al pannello.** Elettricamente il più comodo, ma è un vano stretto e
   la corrente va trovata lì — e non si prende dal cavo del pannello.
4. **Vicino alla Truma: ultima scelta.** Attorno a una stufa accesa fa caldo, ed
   è il posto peggiore per dell'elettronica e per un alimentatore. Più il fatto
   che è il punto più scomodo da raggiungere di tutto il camper.

### Cosa serve sapere per decidere

La distanza fra il pannello e il posto dove vivrà il Raspberry: decide se il cavo
RJ12 è da 2 o da 5 metri. Si misura quando si fanno le foto.

## Cosa si apre dopo, e dove sta il muro

Chiesto il 16 novembre 2026: «tutto ciò mi permetterebbe di collegare altri
accessori da comandare da remoto?». La risposta utile separa due cose.

### Il Raspberry è l'investimento; il modulo LIN no

Il modulo LIN parla LIN e nient'altro: è un pezzo dedicato alla Truma. Con una
eccezione che val la pena sapere: **sullo stesso bus TIN viaggia anche un
condizionatore Truma** (Aventa, Saphir), perché lo comanda lo stesso CP plus. Se
un giorno ne monta uno, si legge e si comanda **senza comprare niente**.

Il Raspberry invece è una piattaforma, e quello che apre è molto piu' largo:

| via | cosa ci si attacca |
|---|---|
| **Bluetooth** | qualunque cosa trasmetta in chiaro: Victron, Ective, termometri BTHome/ATC, sensori di pressione gomme, bilance per bombole |
| **wifi** | tutto quel che sta sulla rete del camper: la centrale Tuya (già), Starlink, prese comandate |
| **USB** | adattatori seriali: VE.Direct a filo, RS485, CAN, ricevitori GPS, chiavette OBD |
| **GPIO** | 40 piedini: sensori 1-Wire, contatori a impulsi (contalitri dell'acqua), contatti di livello |

E soprattutto: **la strada per i dati esiste già.** Porta d'ingresso, coda
offline, archivio storico, pagina. Un apparecchio nuovo costa il suo prezzo piu'
un pezzo di codice, non un'infrastruttura.

Il secondo ESP32 non è quindi solo un ricambio: è il cervello del prossimo
apparecchio. Non va caricato di altri compiti **quello** della Truma, perché uno
schiavo LIN non convive con altro — ma un secondo ESP32 fa quel che serve.

### Si legge quasi tutto. Comandare è un'altra faccenda

Il muro non è tecnico, è il vincolo che ci siamo dati: **all'impianto a 12 V non
si mette mano.**

- **Leggere**: aperto quasi senza limiti. Chi trasmette si ascolta, chi ha un
  connettore si infila. Nessun intervento.
- **Comandare un carico a 12 V** (luci, ventole, pompa, una resistenza): serve un
  relè *dentro* il circuito. Quello è mettere mano all'impianto, ed è una
  decisione separata da prendere apposta, non un effetto collaterale.
- **Comandare senza toccare niente**: la Bluetti (già, dal cloud), la centrale
  Tuya (il campo `master_mode` è scrivibile, già individuato), la Truma col bus,
  un eventuale condizionatore Truma sullo stesso bus, e le prese comandate sulla
  230 V — che però sulla 230 V del camper vivono solo quando l'inverter della
  Bluetti è accesso.

### Candidati da verificare, non promesse

Scritti qui per non riscoprirli: **sensori di pressione gomme Bluetooth** (molti
trasmettono in chiaro e i formati di diversi modelli sono noti), **Truma
LevelControl** per il livello della bombola (è un sensore Bluetooth del sistema
iNet: da verificare se si legge passivamente), **VE.Direct a filo** con un cavo
USB da una trentina di euro, che darebbe più dati dei Victron rispetto agli
annunci radio e permetterebbe di scriverne le impostazioni.
