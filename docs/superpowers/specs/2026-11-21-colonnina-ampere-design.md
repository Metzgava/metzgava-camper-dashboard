# Gli ampere della colonnina — disegno breve

**21 novembre 2026.** Chiesto dal proprietario, in viaggio: *«cambia gli ampere
da colonnina da 1 a 16 o oltre… era per il calcolo dei tempi di ricarica
stimati sia di bluetti che di ective da colonnina, ora non si riesce a mettere
2 o 4 o 6»*.

## Perché non si riesce

Non è un campo che rifiuta: **è un campo che non c'è.** L'unico dato della 220
nell'Impianto è `bluetti_carica_ac_w`, in **watt**, a 1800. Scriverci 4 vuol
dire quattro watt.

E 1800 W è quel che la Bluetti sa prendere, non quel che la colonnina sa dare.
In campeggio il limite è quasi sempre la **colonnina**: 4 A sono 920 W, 6 A
sono 1380. Il conto dei tempi oggi usa sempre 1800, quindi su una presa da 4 A
promette una ricarica **doppia** di quella vera — e sbaglia nella direzione
ottimista, la sola che fa restare fermi contando su ore che non ci sono.

## Obiettivi

1. **`colonnina_a`**, gli ampere della presa: quel che la piazzola dà, o quel
   che hai impostato sulla Bluetti. Valori veri: 2, 4, 6, 10, 16.
2. Il tempo di ricarica della Bluetti usa **il più piccolo fra i due**: quel
   che l'apparecchio prende e quel che la presa dà.
3. **Il tempo di ricarica delle Ective dalla colonnina**, che oggi non c'è
   affatto, con lo stesso limite.
4. **Dire quando è la presa a frenare**, e non l'apparecchio. Un numero senza
   quella frase fa cambiare apparecchio a chi doveva cambiare piazzola.

## Non obiettivi

- **Non si comanda la corrente d'ingresso della Bluetti.** Il loro cloud manda
  tredici grandezze e fra i comandi che accetta non c'è: resta una regolazione
  della loro app. Qui si dichiara quel che hai impostato, non lo si impone.
- Non si indovina quanto dà la piazzola. È un dato del mondo, lo scrive lui.

## Anti obiettivo

Un tempo di ricarica più corto del vero. È lo stesso anti obiettivo
dell'autonomia: in sosta, un'ora promessa e non mantenuta è una partenza
rimandata.

## Approcci

1. **Un valore solo, gli ampere, e i watt ricavati.** **Scelto.** È il numero
   che si legge sulla colonnina e che si imposta sulla Bluetti, quindi è
   l'unico che il proprietario conosce davvero.
2. Tre valori in watt, uno per apparecchio. Scartato: lo obbligherebbe a fare
   a mente la moltiplicazione che sa fare il programma, e per di più con una
   tensione che non misura.
3. Un elenco a scelta fissa (2, 4, 6, 10, 16). Scartato come **unica** strada —
   le piazzole hanno anche 3 e 8 — ma i valori tipici vanno suggeriti nella
   nota, perché sono quelli che si incontrano.

## Le decisioni che contano

- **230 V è una costante del codice, non un dato da compilare.** È la tensione
  di rete europea; chiederla sarebbe una domanda in più per un numero che non
  cambia mai. Scritta con un commento, così chi legge sa da dove esce.
- **Il più piccolo fra i due limiti, sempre**, e si dichiara **quale** dei due
  ha vinto: «la presa da 4 A è il freno, non la Bluetti».
- **Senza `colonnina_a` non si cambia niente.** Il conto resta quello di oggi,
  col suo bollino, e la pagina dice che manca. Un valore assente non deve
  peggiorare quel che già funziona.
- **`ective_carica_a` è ancora vuoto** («DA COMPILARE» dal primo giorno), e
  senza quello il tempo delle Ective non si può dare. Si scrive cosa manca,
  non si inventa un caricabatterie.
- **Se sono attaccati tutti e due, la presa si divide.** Caricare Bluetti ed
  Ective insieme su 4 A non raddoppia niente: è lo stesso budget spartito. Va
  detto, perché è esattamente l'errore che uno fa in piazzola.
- **La Truma elettrica mangia dallo stesso piatto.** 900 o 1800 W di resistenza
  su una presa da 6 A non lasciano niente per caricare. Una riga, non un conto.

## Aggiunta del 21/11/2026, a camper fermo

Il proprietario, rileggendo: *«ricordati di sistemare gli ampere da colonnina.
devono essere selezionabili da 1 a 16 almeno»*.

**«Selezionabili» cambia due decisioni**, e la seconda è più importante della
prima.

### Si scelgono, non si battono

L'approccio 3 di sopra scartava l'elenco a scelta fissa perché cinque valori non
coprono il mondo. Ma la critica valeva per **cinque** valori, non per l'idea di
scegliere. Le prese di corrente esistono in taglie, non in numeri qualunque:

- **da 1 a 16 A interi** — tutto quel che si incontra in piazzola, e il 16 è
  anche la presa di casa;
- più le taglie grosse standard, **20, 25, 32 A**, per i posti serviti bene e
  per il «o oltre» della prima richiesta.

Niente campo libero: un ampere e mezzo non esiste, e su un iPad un campo
numerico si sbaglia più facilmente di quanto si scelga da un elenco. È anche la
ragione vera per cui *«non si riesce a mettere 2 o 4 o 6»* dava fastidio: non
solo il campo non c'era, ma anche quando ci sarà, battere a mano un numero che
ha cinque valori probabili è lavoro inutile.

Il salvataggio della pagina Impianto raccoglie già **tutti** i campi con
`data-chiave` e ne legge `.value`: un elenco a scelta funziona lì dentro senza
toccare quel giro.

### E non va fra «i dati fissi»

Guardando la tabella `IMPIANTO` per quel che è: capacità delle batterie, watt
del Charger, resistenza della Truma, rendimento dell'inverter. **Cambiano quando
cambi un pezzo di camper.** La pagina lo dice con le sue parole: *«Questi sono i
dati fissi del tuo camper: non stanno nel codice perché cambiano quando cambi un
pezzo»*.

Gli ampere della colonnina **cambiano a ogni piazzola.** Sarebbero l'unica riga
di quella tabella che si tocca durante un viaggio, e metterla fra i dati fissi
vuol dire farsi tre schermate per cambiare un numero che si legge sul palo
mentre si attacca il cavo.

Quindi: **il selettore sta accanto al tempo di ricarica**, dentro «Quanto ci
vuole a caricarla» — dove il numero si usa e dove si guarda il risultato. Si
arriva, si attacca, si mette 6, e il tempo si aggiorna lì sotto.

In **archivio** il valore resta in `IMPIANTO`, perché deve essere lo stesso
sull'iPad e sul telefono: non in `localStorage`, che è di un apparecchio solo.
La riga nella tabella non si mostra più fra i dati fissi, e la sua nota dice
dove si cambia.

### Cosa questo aggiunge alle prove

- la potenza della presa esce dal valore scelto **e dalla tensione costante**,
  e non si batte a mano;
- il tempo si rifà **appena si cambia la scelta**, senza salvare a parte;
- un valore mai scelto lascia i conti come sono oggi (era già un vincolo, ora
  va provato anche dal nuovo posto in pagina);
- `colonnina_a` **non compare** nell'elenco dei dati fissi.

## Cosa resta al costruttore

Una funzione pura: dai limiti (apparecchio, presa) alla potenza vera e a chi
l'ha imposta, provata da sola. Il resto è cablaggio e due righe in pagina.

L'elenco esatto delle taglie e la parola del selettore; e se la scelta si salvi
appena cambiata oppure col tasto Salva già presente.
