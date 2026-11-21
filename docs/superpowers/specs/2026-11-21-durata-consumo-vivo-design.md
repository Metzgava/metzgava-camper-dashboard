# La durata si calcola sul consumo misurato, e il consumo si misura da sé

**Data:** 21/11/2026
**Stato:** da approvare

## Perché

Richiesta del proprietario, camper fermo: *«controlla sempre e aggiorna la
durata con il consumo che deve essere sempre aggiornato in automatico»*.

Oggi le durate in pagina si appoggiano a due cose diverse, e **una delle due è
un numero battuto a mano**.

| durata in pagina | consumo che usa | da dove viene quel consumo |
|---|---|---|
| `tempo_residuo_ective` — quanto durano le Ective | i watt del pacco **in questo istante** | misurato, fresco |
| `tempo_residuo_bluetti` — quanto dura la Bluetti | la sua uscita **in questo istante** | misurato, fresco |
| `giorni_fermo_bluetti` — quanto dura il camper fermo | `consumo_fermo_w` = **11 W** | **scritto nella tabella Impianto il 16/11/2026** |

Quell'11 W porta il bollino **«misurato»**, e lo era: *«batterie −0,29 A più
pannelli +0,5 A»*, misurato una sera di cinque giorni fa. Ma da allora in camper
è cambiato tutto: c'è la scatoletta accesa, c'è Starlink, e c'è un frigo che
d'inverno lavora diversamente. Un numero misurato una volta e poi mai più è una
**stima che si spaccia per misura**, e invecchia senza dirlo.

E c'è un secondo difetto, che riguarda le altre due durate — quelle che il
consumo lo misurano davvero.

**Un istante non è un consumo.** `tempo_residuo_ective` divide i Wh residui per
i watt letti in quel momento. Se la pagina si apre mentre parte il compressore
del frigo, l'autonomia crolla a poche ore; un minuto dopo, a frigo spento, dice
quaranta ore. Nessuno dei due numeri è sbagliato come misura, e **tutti e due
sono inutili come durata**: la domanda «quanto duro» non si risponde con la
potenza di un secondo.

Il verso dell'errore conta. Un'autonomia gonfiata da una lettura presa in un
momento di quiete è **una partenza rimandata** — l'anti obiettivo che questo
progetto ha già scritto per i tempi di ricarica.

## Obiettivi

1. **`consumo_fermo_w` si misura da sé**, dalle letture già in archivio, e non
   si batte più a mano. Con scritto su quante letture e su quale periodo, e con
   il bollino giusto.
2. **Le durate si calcolano su un consumo medio recente**, non sull'istante, e
   la pagina dice su che periodo è fatta la media.
3. **Il consumo «adesso» resta**, perché serve a un'altra domanda — *cosa sta
   succedendo in questo momento* — e perché è l'unico dato misurato al secondo.
   Due numeri, due domande, ciascuno col suo nome.

## Non obiettivi

- **Non si tocca `consumo_ective`.** È il consumo istantaneo, misurato, giusto
  dal 20/11, e sotto ci sta la figura «Dentro e fuori dalle batterie». La media
  è un **numero nuovo accanto**, non un rimpiazzo.
- **Non si misurano i singoli circuiti.** Frigo, Truma, pompa, Starlink restano
  un ramo solo fino alla serata di taratura. Qui si misura il pacco.
- **Non si tocca `bluetti_carica_ac_w` né `charger_w`**: sono quel che un
  apparecchio sa prendere, non un consumo che varia. (Il limite della colonnina
  è un altro disegno, già scritto.)

## Anti obiettivi

- **Una durata più lunga del vero.** Vale per tutte e tre. Fra due modi di
  calcolare, si sceglie quello che non promette ore che non ci sono.
- **Un bollino «misurato» su un numero vecchio.** È il difetto che si sta
  togliendo: ricrearlo altrove sarebbe peggio che lasciarlo dov'era.
- **Un consumo a riposo dedotto da un periodo in cui il camper non era a
  riposo.** Se nella finestra non ci sono state ore di quiete, il numero non si
  dà: si dice che non si sa e perché.

## Vincoli

- Le letture ci sono già: la scatoletta scrive in `misure` la potenza di ogni
  batteria, con il segno, e `storico.js` la sa già leggere e raggruppare —
  `serieUscite` fa esattamente questo lavoro per i grafici della Storia.
- La grammatica della casa: `base`, `perche`, `detto`, `mancano`. `—` è «non
  so», `0` è uno zero conosciuto.
- La tabella `IMPIANTO` ha una colonna che dice se un valore è misurato o di
  catalogo. Un valore che adesso si calcola non deve restare in quella tabella
  come se qualcuno dovesse compilarlo.
- Questo lavoro **viene dopo** `2026-11-21-potenza-netta-ective-design.md`: la
  media si fa sulla potenza netta del pacco, e quel disegno è quello che la
  rende un numero solo con il segno.

## Le strade considerate

**A. Media semplice sull'ultima ora.** Si prende la media delle uscite misurate
nell'ultima ora e si divide. Semplice, e già meglio dell'istante. Ma a camper
fermo da tre giorni l'ultima ora è un campione di quiete, e a camper vissuto è
un campione di vita: lo stesso conto risponde a due domande diverse senza dirlo.

**B. Due consumi con due nomi, su due finestre.** **Scelta.**
- il **consumo adesso**, istantaneo, che c'è già e non si tocca;
- il **consumo recente**, media sulle ultime ore, che è quello su cui si
  calcolano le durate;
- il **consumo a riposo**, ricavato dalle **ore di notte senza sole**, che
  sostituisce l'11 W battuto a mano.

Tre numeri, tre domande, ciascuno con la sua finestra scritta accanto. Costa più
codice, ma è l'unico modo in cui una durata può dire *su cosa* è calcolata.

**C. Tenere `consumo_fermo_w` a mano e ricordarsi di aggiornarlo.** Scartata: è
quel che c'è oggi, e il motivo per cui si sta facendo questo lavoro.

## Come si fa

### 1. Il consumo recente

Una funzione che, dalle misure in archivio, torna la **media della potenza netta
del pacco** su una finestra recente — tenendo solo la parte che **esce**, e
tenendola **prima** di fare la media.

Il perché del «prima» non è un dettaglio: è la lezione del 21/11 di stamattina.
Sui grafici della Storia, mediare il netto con il segno su una finestra lunga
fa **annullare** la scarica della notte con la carica del giorno, e trenta giorni
davano 5,44 kWh mentre novanta ne davano 0,35. Lo stesso errore qui darebbe
un'autonomia infinita a un camper che si sta svuotando. `storico.js` ha già il
raggruppamento a due livelli che serve, e va riusato, non riscritto.

La finestra è una **scelta di disegno**, come `RIFERIMENTO_USCITA_W`: va scritta
come costante con il suo perché accanto. Deve essere abbastanza lunga da
contenere qualche ciclo del frigo e abbastanza corta da raccontare adesso.

Il risultato porta con sé **quante letture** l'hanno formato. Poche letture non
sono una media: sotto un minimo, il numero non si dà.

### 2. Le durate si calcolano su quello

`tempo_residuo_ective` e `tempo_residuo_bluetti` dividono i Wh residui per il
consumo **recente** invece che per l'istantaneo. Nel `perche` va scritta la
finestra, con le parole che la pagina usa già per i tempi (`dilloInOre`), così si
legge *«40 Wh residui, a 23 W di consumo medio delle ultime due ore»*.

Quando la media non c'è — archivio corto, scatoletta appena accesa — si **ricade
sull'istantaneo** e lo si dice nel `perche`. Una durata su un istante dichiarato
è onesta; su un istante taciuto, no.

### 3. Il consumo a riposo si misura da sé

«A riposo» vuol dire due cose insieme, e vanno imposte entrambe:

- **di notte**, cioè nelle ore in cui i pannelli non danno niente. Altrimenti si
  misura il consumo *al netto del sole*, che è più basso del vero — l'errore nel
  verso ottimista. È la stessa attenzione che il proprietario ha avuto il
  16/11, quando ha sommato i +0,5 A dei pannelli ai −0,29 A delle batterie;
- **in quiete**, cioè nei periodi bassi: il consumo a riposo è il **pavimento**
  del consumo, non la sua media. Una media notturna che include un'ora di Truma
  non è un consumo a riposo.

Quindi: dalle misure notturne di qualche giorno, si prende il **livello basso
stabile** della potenza che esce dal pacco. Il modo esatto di prendere quel
livello — un percentile basso, la mediana dei periodi più bassi — lo decide il
costruttore, con una condizione: deve essere robusto a una sola notte strana, e
il suo `perche` deve dire su quante notti e quante letture è fatto.

Se nella finestra non ci sono ore notturne buone, il numero **non si dà**:
`manca`, con scritto che servono notti in archivio. Non si ricade sull'11 W: un
numero di cinque giorni fa presentato come attuale è il difetto che si sta
togliendo.

### 4. Cosa succede a `consumo_fermo_w` nella tabella

Il valore calcolato **vince** su quello scritto. Quello scritto resta come
ripiego dichiarato — con il bollino `stima` e la sua data nel `perche` — perché
serve finché l'archivio è corto, ma non deve più essere l'unica fonte né
presentarsi come misura fresca.

La riga nella tabella Impianto va aggiornata nella descrizione: chi la legge
deve capire che quel numero adesso si misura da sé, e che quello scritto è il
ripiego.

### 5. Le prove

Scritte prima, e devono cadere prima di passare:

- **la media tiene solo quel che esce, e lo tiene prima di mediare**: una
  finestra con mezz'ora di carica e mezz'ora di scarica non deve dare zero. È la
  prova che riproduce il difetto dei grafici di stamattina;
- **poche letture non fanno una media**: sotto il minimo, la durata ricade
  sull'istantaneo e lo **dice** nel `perche`;
- **la durata usa la media e non l'istante**: con un istante anomalo in una
  finestra tranquilla, la durata non deve saltare;
- **il consumo a riposo esclude le ore con sole**: una finestra con letture
  diurne a basso consumo non deve abbassare il numero;
- **il consumo a riposo è il pavimento, non la media**: una notte con un'ora di
  Truma non deve alzarlo;
- **senza notti in archivio** il consumo a riposo è un `manca` con scritto cosa
  manca, e `giorni_fermo_bluetti` lo riporta;
- **il bollino**: il consumo a riposo calcolato è `misurato`; il ripiego dalla
  tabella è `stima` e porta la sua data;
- **`consumo_ective` non si muove**: è il non obiettivo, e va pinnato.

## Le decisioni prese dopo la revisione

Un revisore ha letto questo disegno e il codice attorno, e ha trovato sei punti
dove un costruttore avrebbe dovuto indovinare. Qui ci sono le risposte, perché
indovinare in tre di questi punti sbaglia **nel verso ottimista**.

### La media è solo per le Ective. La Bluetti tiene l'istante

La durata della Bluetti non divide per la sua uscita: divide per il suo **saldo**
`dentro − fuori`, e ha già due rami propri («non sta erogando», «si sta
caricando»). Mediare un saldo con il segno su una finestra lunga ricade esatto
nell'annullamento che questo disegno vuole togliere.

E c'è una ragione pratica che decide da sola: le letture della Bluetti arrivano
**dal cloud ogni quindici minuti**, e quelle di ripiego non si archiviano. Su
due ore sono otto campioni nel caso buono e **zero quando il cloud rifiuta** —
cioè lo stato in cui la Bluetti si trova proprio oggi. Una media su otto
campioni che a metà giornata non esiste è peggio dell'istante, non meglio.

Quindi: la media vale per il **pacco Ective**, che la scatoletta legge ogni due
minuti. `tempo_residuo_bluetti` resta come è. Quando le letture della Bluetti
saranno frequenti — col manometro dal Bluetooth invece che dal cloud, che è un
altro disegno sul tavolo — si riapre la questione.

### La media si divide su tutta la finestra, e si dice quanto se n'è stata in carica

Era un **fattore due** non deciso: mezz'ora di carica e mezz'ora di scarica a
30 W danno 15 W dividendo per la finestra intera, 30 W dividendo per i soli
intervalli in scarica. La prova che avevo chiesto passava in entrambi i casi.

Si divide per la **finestra intera**, perché è la risposta vera alla domanda che
si sta facendo. «Quanto duro» vuol dire *a che velocità ho perso carica
ultimamente*: se nelle ultime due ore il pacco ha perso 30 Wh, la velocità è
15 W, e le ore che restano si contano su quella. Dividere solo per gli
intervalli in scarica risponde a un'altra domanda — *quanto vado giù mentre vado
giù* — e non è la velocità con cui ti si è svuotata la batteria.

Ma il revisore ha ragione su quando questo inganna: **a mezzogiorno col sole**,
la finestra intera dà una media quasi nulla e un'autonomia di settimane, che
alle sei di sera non c'è più. La cura non è cambiare il conto: è **dirlo**. La
frase porta la finestra *e* quanta parte di quella finestra era in carica —
«a 15 W di media nelle ultime due ore, di cui una in carica». Un numero con
scritto accanto da dove viene non inganna; lo stesso numero da solo sì.

Una prova in più: la media di una finestra mezza in carica e mezza in scarica a
30 W è 15, **non** 30 e **non** 0, e la frase dice che un'ora era in carica.

### La durata si dà anche mentre il pacco carica, e «adesso non esce niente» resta

Oggi con `watt === 0` la durata non si dà, e dice «dalle batterie non esce
niente». Con la media, un pacco in carica adesso ma con 20 W di media recente
**ha** una durata — ed è proprio la domanda che si fa uno che sta al sole e
pensa alla notte.

Le due frasi non si contraddicono se si tengono distinte: *«adesso non esce
niente»* parla dell'istante, *«sulla media delle ultime due ore, 18 ore»* parla
della durata. Sono due domande, e la pagina le tiene separate come tiene
separati i due consumi.

Questo fa cadere di proposito la prova `batterie in carica: niente esce` di
`test/uscita-ective-cablaggio.test.js` nella parte sulla durata: `consumo_ective`
resta zero come oggi (è il non obiettivo), ma `tempo_residuo_ective` smette di
essere vuoto. Va riscritta, non rimossa, e dire la cosa nuova.

### Le notti si scartano anche per le fonti invisibili, non solo per il sole

Il sole non è l'unica cosa che abbassa il pavimento: sul 12 V delle Ective
entrano anche **l'uscita DC della Bluetti** e il relè separatore di fabbrica —
le «fonti invisibili» che l'altro disegno nomina fra i suoi anti obiettivi. Una
notte con la Bluetti che alimenta il 12 V dà un consumo a riposo più basso del
vero: lo stesso errore del sole, con un altro nome.

Quindi si scartano anche gli intervalli notturni in cui l'uscita DC della
Bluetti era sopra zero. Il dato c'è in archivio.

E si accetta la conseguenza: con la Bluetti accesa spesso, il consumo a riposo
può diventare **`manca` per lunghi periodi**. È il comportamento giusto. Un
`manca` con scritto cosa manca è onesto; un pavimento misurato mentre qualcuno
pagava il conto al posto delle batterie, no.

### «Notte» vuol dire pannelli misurati a zero. L'assenza di letture non è notte

Lo SmartSolar si fa sentire per radio, e una lettura **assente** non è una
lettura a zero: il Bluetooth perde annunci anche in pieno giorno. Interpretare
l'assenza come notte farebbe entrare nel campione ore diurne, e il pavimento
scenderebbe — di nuovo il verso ottimista.

Quindi serve un `pannelli_w` **presente e a zero** (o a pochi watt). Se le
letture notturne non ci sono, il numero non si dà.

Questo evita anche di dover sapere che ora è dove sei: il server gira su Railway
in UTC e il camper si sposta, e un orologio sbagliato di due ore metterebbe il
tramonto nel campione.

### «Quanto dura fermo» conta tutto quello che hai — deciso dal proprietario

La riga «Il camper sulla Bluetti» divide i Wh della Bluetti per il consumo del
camper **senza contare la perdita di conversione**, e quel consumo si misura sul
12 V delle Ective. Finché il consumo era 11 W l'incoerenza non si vedeva; con un
consumo misurato oggi il numero cala e la domanda viene a galla.

Scelta del proprietario, fra quattro: **tutto quello che hai.**

- i **Wh residui delle Ective**, che adesso si misurano (`uscitaEctive` li
  calcola già coi volt letti, non coi nominali);
- più i **Wh della Bluetti scontati del rendimento della catena**
  (`rendimento_bluetti_ective`, 0,80): per arrivare al 12 V quella corrente
  passa da inverter e caricatore, e per strada se ne perde un quinto;
- il tutto diviso il consumo a riposo.

Due conseguenze da portare fino in pagina:

1. **Il bollino della riga diventa `stima`**, non `misurato`: lo 0,80 è una
   stima dichiarata tale nella tabella Impianto. Il `perche` deve dire che il
   rendimento è stimato, altrimenti si ripete esattamente il difetto che questo
   disegno sta togliendo — un bollino «misurato» su un conto che contiene un
   numero di catalogo.
2. **Il nome della riga cambia.** «Il camper sulla Bluetti» non descrive più il
   conto: adesso conta anche le Ective. Il nuovo nome lo scrive il costruttore,
   e deve dire che è tutta l'energia di bordo.

Se i Wh di una delle due parti non si sanno, si usa quel che si sa e **si dice
quale manca** — non si tace e non si fa finta che l'altra parte sia tutto.

## Cosa resta al costruttore

- I nomi dei campi nuovi, nella lingua del progetto.
- La lunghezza delle due finestre (recente, e notti per il riposo) e il minimo
  di letture sotto il quale non si dà un numero.
- Il modo di prendere il «livello basso stabile», con il vincolo di robustezza
  di sopra.
- Come si riconosce la notte: dalle ore, o dal fatto che i pannelli misurano
  zero. La seconda è più vera e non ha bisogno di sapere dove sei.
- Il testo esatto dei `perche`, in italiano piano.
