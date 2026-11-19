# Dal vivo mentre guardi: il disegno

**19/11/2026.** Progetto, non modifica: tocca la scatoletta, il server e la
pagina.

## Intento

Il proprietario: *«dati reali in real time e rappresentati con indicatori e
animazioni comprensibili facili e belle»*.

Tradotto in quel che si può promettere: **apri l'app e i numeri si muovono
sotto i tuoi occhi.** Non fermi a due minuti fa, non da ricaricare a mano. E
quando chiudi, tutto torna lento — perché il camper sta fermo e al buio il
novantanove per cento del tempo, e far lavorare la radio in quelle ore è
corrente buttata via dalla batteria servizi.

## Il fatto che decide la forma: non tutti possono essere vivi

Questa è la scoperta che cambia il disegno, ed è fisica, non software.

| apparecchio | come parla | quanto può essere vivo |
|---|---|---|
| SmartSolar, Orion XS | **gridano** i loro dati a chiunque ascolti | qualche secondo |
| i tre termometri | come sopra | qualche secondo |
| le due Ective | bisogna **collegarsi** a ciascuna | ~un minuto, limite loro |
| la Bluetti | oggi dal cloud, con un minuto di cache | fuori da questo lavoro |

Un giro completo oggi dura più di un minuto, e quasi tutto quel tempo se ne va
nei due collegamenti alle Ective. Quindi **un giro da dieci secondi che legge
tutto non esiste**: è aritmeticamente impossibile.

La conseguenza non è una rinuncia, è una struttura: **due ritmi invece di uno.**

- **Il giro svelto**, mentre qualcuno guarda: ascolta solo chi trasmette da
  sé — Victron e termometri — e spedisce. Pochi secondi, nessun collegamento,
  consumo basso.
- **Il giro lento**, sempre: quello di adesso, con le Ective e tutto il resto.

I due convivono. Nessuno dei due aspetta l'altro.

## Goal

- Con la pagina aperta, Victron e termometri si muovono a **meno di dieci
  secondi** dalla realtà.
- Con la pagina chiusa, il consumo **non cresce**: deve restare quello di oggi.
- Il movimento si capisce con la coda dell'occhio: lancette che scorrono, cifre
  che si interpolano, flussi che cambiano velocità.
- Quel che **non** è vivo continua a dire la propria età, come fa da oggi.

## Non-goal

- La Bluetti via Bluetooth. Porta aperta oggi, ma la mappa dei registri è un
  progetto suo.
- Le Ective più veloci di un minuto. Non si può, e fingere sarebbe la bugia
  peggiore di tutte.
- Rifare l'aspetto della pagina: cosa sta in alto, che forma hanno le cose.
  Qui si fa muovere bene quel che c'è.

## Anti-goal

**Che il camper si scarichi perché qualcuno ha lasciato una pagina aperta.**
È il rischio vero: un telefono dimenticato in tasca con l'app aperta non deve
tenere la radio al lavoro per ore. La pagina smette di chiedere quando non è
in primo piano, e la scatoletta torna lenta da sé appena smette di sentire che
qualcuno guarda.

**E che un numero sembri vivo quando non lo è.** Un quadrante che si muove
dolcemente è convincente: se si muove su un dato di due minuti fa, mente meglio
di un numero fermo. Il movimento va **solo** su quel che il giro svelto ha
davvero rinfrescato.

## Come la scatoletta sa che la stai guardando

Lei sta dietro il router del camper: nessuno può bussarle da fuori. Deve
chiedere lei.

1. **Il server ricorda l'ultima occhiata.** Ogni volta che la pagina chiede lo
   stato, il server segna l'istante. «Qualcuno guarda» vuol dire: quell'istante
   è più recente di **novanta secondi**.
2. **La scatoletta chiede spesso, con domande minuscole.** Ogni quindici
   secondi una richiesta da niente — una riga di risposta, `{"secondi": 10}` o
   `{"secondi": 120}`. Il Wi-Fi è già acceso: una richiesta HTTP è una frazione
   di quel che costa una scansione Bluetooth.
3. **E se il server non risponde, rallenta.** Mai il contrario. Un guasto di
   rete non deve lasciare la radio al massimo: si sbaglia **verso il lento**.

Perché non una connessione sempre aperta, che sarebbe istantanea: sul 4G del
camper cade di continuo e va ristabilita, e aggiunge un pezzo che può rompersi
in silenzio proprio quando sei lontano. Quindici secondi di ritardo per
svegliarla non si notano aprendo una pagina; un meccanismo permanente che si
inceppa a mille chilometri sì.

## Come la pagina si muove

- **Mentre è in primo piano**, chiede i dati ogni **tre secondi**. Quando passa
  in secondo piano — cambi app, blocchi il telefono — **smette**. Il sistema
  operativo lo dice, non serve indovinarlo.
- **Le cifre si interpolano** fra il valore vecchio e il nuovo, in mezzo
  secondo. Un salto si legge come un errore; uno scorrimento si legge come una
  misura che cambia.
- **Le lancette scorrono** invece di saltare: la stessa transizione.
- **I flussi cambiano velocità** con i watt, come già fanno — ma adesso lo
  fanno di continuo invece che a scatti ogni due minuti.
- **Chi ha chiesto meno animazioni al sistema** non vede niente di tutto
  questo: i numeri cambiano e basta. Come già l'alone e la lancetta.

## Quel che si vede quando il vivo non c'è

Un apparecchio che il giro svelto non legge — le Ective, la Bluetti — resta com'è
oggi, con la sua età scritta accanto. Non si interpola, non scorre, non finge.

E se la pagina è aperta ma la scatoletta non sta rispondendo, la pagina lo dice
invece di mostrare numeri immobili che sembrano vivi.

## Come si divide il lavoro

**Sul server.** Un posto dove segnare l'ultima occhiata, e una rotta minuscola
che risponde il passo. Nessuna scrittura su database per ogni occhiata: sarebbe
una scrittura ogni tre secondi per niente.

**Sulla scatoletta.** Il giro svelto, separato da quello lento, e la domandina
ogni quindici secondi. Il pacchetto che manda è lo stesso di oggi, con dentro
meno apparecchi: il server non deve accorgersi della differenza.

**Nella pagina.** Il ritmo legato alla visibilità, e le transizioni.

## Prove

- il passo chiesto è svelto solo se l'ultima occhiata è recente;
- **novanta secondi dopo l'ultima occhiata si torna lenti**, anche se nessuno
  ha chiuso niente;
- il server irraggiungibile porta al lento, mai allo svelto;
- il giro svelto manda solo chi trasmette da sé, e non tenta collegamenti;
- il giro svelto e quello lento non si aspettano a vicenda;
- un valore che il giro svelto non ha toccato non viene segnato come fresco.

## Quel che resta al costruttore

I numeri esatti — tre secondi, quindici, novanta — sono scelte ragionevoli da
verificare col consumo alla mano, non verità. E la durata delle transizioni si
sceglie guardando la pagina sul telefono, non a tavolino.
