# I consumi dei singoli accessori — disegno

**20 novembre 2026.** Chiesto dal proprietario: *«sei in grado di dirmi quanto
consumano i singoli accessori del camper tipo frigo, truma, pompa acqua, luci,
starlink ecc, se si prepara una pagina separata su app»*. **Non ancora
approvato.**

## La risposta onesta, prima del disegno

**Misurare ogni accessorio per conto suo: no.** Servirebbe uno shunt per
circuito, dentro il 12 V del camper. È esattamente il posto dove il proprietario
ha chiesto di non mettere le mani — *«meglio presa con presa»*, 17 novembre — e
aveva ragione: è l'unico punto dove uno sbaglio costa qualcosa.

**Misurarli uno per volta, dallo scalino: sì.** Si spegne tutto, si accende una
cosa sola, e si guarda di quanto sale la corrente delle batterie. Ne esce una
tabella **di questo camper**, non da catalogo. È il metodo promesso il 16
novembre e già costruito: `servizi/src/routes/taratura.js`, con la sessione a
scadenza, le finestre prima/dopo, e la mediana invece della media perché dentro
due minuti il frigo può partire e trascinare il conto.

**Due accessori sfuggono alla regola, in meglio.** Starlink dichiara i watt da
sé, al secondo, sulla rete del piatto — ma la scatoletta su quella rete oggi non
c'è. E la Truma ha la predisposizione iNet, progetto fermo per scelta.

## Il pezzo che manca, e che credevo ci fosse

La taratura misura uno scalino nella **corrente delle Ective**. Le Ective si
leggono solo collegandosi, venti secondi per batteria, e quel collegamento sta
nel **giro lento**: una lettura ogni due minuti.

Il giro svelto — quello che si accende quando qualcuno guarda la pagina, dieci
secondi — legge **solo gli annunci**: Victron e termometri. Le Ective non ci
sono, e il commento in `giro_svelto` dice perché, con ragione: un giro da dieci
secondi con dentro un minuto di collegamenti vuol dire giri accavallati e radio
sempre accesa.

Quindi oggi la taratura non ha niente da misurare. Con campioni ogni due minuti
ne prende uno o due prima del segno e uno o due dopo, e `CAMPIONI_MINIMI = 3`
fallisce. **Il bottone c'è, la tabella no.**

### Come si chiude, e perché è più facile di quanto sembri

Le Ective **non si interrogano: mandano da sole**, pezzetti di testo sulla
caratteristica FFE4, in continuazione. Il costo dei venti secondi non è la
lettura, è il *collegamento*.

Quindi per una sessione di taratura non serve un giro più fitto: serve **tenere
aperti i due collegamenti** per la durata della sessione e spedire ogni record
appena arriva. Nessuna scansione ripetuta, nessun accavallamento, e campioni
ogni pochi secondi invece che ogni due minuti. La modalità esiste già come idea
— la sessione a scadenza — e questa è la sua attuazione mancante.

Costo: la radio resta impegnata per mezz'ora, e in quella mezz'ora il giro lento
non legge Victron e termometri. Accettabile per una sessione dichiarata, con una
scadenza che la chiude da sé.

## Cosa si costruisce, in due tempi

**Primo: la serata di taratura funziona.**
Connessioni persistenti durante la sessione, e la tabella si riempie. Questo
tempo si chiude con una cosa che il codice non può fare: **mezz'ora in camper
con il proprietario che accende una cosa per volta.** Frigo, Truma livello 1 e
livello 2, pompa (tenendo un rubinetto aperto, perché a impulsi dura secondi),
ogni gruppo di luci, Starlink. Nessuna pagina sostituisce quella mezz'ora.

**Secondo: la pagina.**
Due cose, nell'ordine in cui servono:

1. **La tabella dei carichi**: ogni accessorio col suo consumo misurato, la data
   della misura, e quante volte è stato misurato. Numeri di questo camper, col
   bollino `misurato`.
2. **Chi sta mangiando la corrente adesso**: dei watt che escono dal pacco,
   quanti se ne spiegano con i carichi noti e **quanti restano non attribuiti**.

Il punto 2 porta il bollino `stima` e non `misurato`, sempre: i watt sono
misurati, l'**attribuzione** è una deduzione. È la stessa distinzione di
`catena`, dove la quota «dalla 220» si ottiene per differenza. E il resto non
attribuito si scrive, non si nasconde: è la parte più onesta della pagina, e
l'unica che dice quando la tabella è incompleta.

## Anti obiettivo

Una pagina che indovina chi consuma e lo dice con la faccia di chi l'ha
misurato. Un frigo attribuito male fa cambiare abitudini per niente, e la
prossima volta che il numero è giusto non gli si crede più.

## Limiti da scrivere in pagina

- Lo scalino misura quel carico **in quel momento**: a quella tensione, a quella
  temperatura. Il frigo d'estate lavora il doppio.
- Un carico che si accende da solo durante la misura la sporca. La mediana
  attenua, non cancella.
- Quel che si accende a impulsi — la pompa — va tenuto acceso per misurarlo.

## Cosa resta al proprietario da decidere

La sequenza della serata, e quanto a fondo andare: cinque voci grosse in dieci
minuti, o venti voci in mezz'ora.
