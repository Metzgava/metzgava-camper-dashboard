# Storia: due grafici delle uscite — disegno breve

**21 novembre 2026.** Chiesto dal proprietario: *«modifica nella sezione storia
il grafico carico della bluetti con due grafici più chiari e significativi
delle uscite sia bluetti che ective»*.

## Intento

La sezione Storia oggi ha **un grafico solo**: la carica della Bluetti in
percentuale, sette giorni. Dice com'era piena, non cosa ha fatto. Al suo posto:
**quanto è uscito**, dalla Bluetti e dalle batterie di servizio, nello stesso
periodo e con lo stesso righello.

È la stessa domanda della figura «Dentro e fuori», portata indietro nel tempo:
lì si vede cosa esce *adesso*, qui cosa è uscito *in questi giorni*.

## Cosa c'è già, e cosa no

**La Bluetti: tutto pronto.** `uscita_ac_w` e `uscita_dc_w` finiscono nello
storico a ogni lettura, da sempre.

**Le Ective: il dato c'è, il conto no.** Lo storico ha i watt di **ciascuna**
batteria, col segno. Quanto esce dal pacco è la somma algebrica cambiata di
segno — lo stesso conto di `uscitaEctive`, ma su due serie nel tempo invece che
su due righe. Va fatto nel server, con le prove.

**Il problema vero: i due istanti non coincidono.** Le righe si scrivono una
per volta, quindi la batteria 1 e la batteria 2 non hanno mai lo stesso
`quando`. Sommare per istante esatto non dà niente. Si raggruppa per
**intervalli**, e la larghezza dell'intervallo cresce col periodo scelto.

## Obiettivi

1. **«Quanto è uscito dalla Bluetti»** — watt nel tempo, divisi fra 220 V e
   12 V, perché sono due cose diverse: la 220 è l'inverter, la 12 V no.
2. **«Quanto è uscito dalle batterie»** — i watt netti del pacco, con la stessa
   regola del vivo: solo quel che esce, zero quando entra.
3. **L'energia del periodo** sotto ciascuno, in kWh. I watt dicono *quanto
   forte*, i kWh dicono *quanto in tutto* — ed è il secondo che risponde a
   «quanto mi è costata quella notte».
4. Lo stesso scegli-periodo di adesso, uno per tutti e due.

## Non obiettivi

- **Non si dice da cosa è uscito.** Stessa regola della figura: si misura il
  pacco, non i circuiti.
- **Non si butta la carica.** Resta nello storico e torna disponibile dal
  menù delle grandezze, che il server già espone e la pagina non usava.

## Anti obiettivo

Una linea che attraversa un buco di letture come se fosse stata misurata. La
scatoletta salta dei giri, e una riga dritta sopra tre ore di silenzio è la
bugia più facile da disegnare e la più difficile da accorgersene.

## Approcci

1. **Raggruppare nel server per intervalli, e restituire serie pronte.**
   **Scelto.** Il conto sta dove ci sono le prove, com'è già per `flusso.js`.
   La pagina disegna e basta.
2. Mandare i punti grezzi e sommare nel browser. Scartato: è esattamente la
   logica che questo progetto tiene fuori da `public/`, e con novanta giorni
   di letture sarebbero decine di migliaia di punti su un telefono.
3. Una tabella riassuntiva invece dei grafici. Scartato: la domanda è «come è
   andata», e l'andamento è una forma, non un numero.

## Le decisioni che contano

- **L'intervallo cresce col periodo**: minuti per un giorno, un quarto d'ora
  per una settimana, ore per tre mesi. Un grafico con più punti che pixel non
  è più preciso, è solo più lento.
- **Dentro l'intervallo si fa la media, non il massimo.** La media per i watt
  è l'energia diviso il tempo, quindi è l'unica che rende coerenti il grafico
  e i kWh scritti sotto. Il picco si scrive a parte, come numero.
- **Un buco resta un buco.** Oltre un intervallo senza letture la linea si
  interrompe. Non si interpola, e nei kWh quel tempo non conta.
- **Due scale indipendenti**, una per grafico, per la ragione già scritta in
  `flusso.js`: la Bluetti fa centinaia di watt e le Ective decine, e una scala
  sola farebbe del secondo grafico una riga piatta sul fondo.
- **Zero non è «non so»**, anche qui: nessuna lettura è un buco, non uno zero.

## Cosa resta al costruttore

Una funzione pura che da righe `(quando, apparecchio, grandezza, valore)` tira
fuori le serie a intervalli, i kWh e il picco, provata da sola. Il resto è
cablaggio e disegno.

---

## Aggiunta a costruzione finita — 21 novembre 2026

**Un difetto del metodo, non del disegno, trovato guardando i numeri veri.**

Col disegno applicato alla lettera — raggruppa, media, poi taglia al verso
giusto — a novanta giorni l'uscita delle Ective valeva **0,35 kWh** contro i
**5,4** di trenta giorni. Un periodo più lungo che contiene meno energia è
impossibile, e infatti era falso.

La causa: con un intervallo da dodici ore, la media del **netto** del pacco
mette insieme la notte che scarica e il giorno che carica. I due si annullano,
e `max(0, -netto)` di quasi zero è quasi zero. Il consumo della notte spariva.

La correzione è nell'ordine delle operazioni: **il verso si guarda prima di
mediare, non dopo.** Si taglia su intervalli corti — un quarto d'ora, abbastanza
da tenere separati il giorno e la notte e la maggior parte dei cicli del frigo —
e poi si mediano i risultati. Il raggruppamento diventa a due livelli, in SQL
sul corto e in `storico.js` sul lungo.

Da qui anche una conseguenza che il disegno non aveva: **i kWh si contano sugli
intervalli corti**, che sono la verità più fine disponibile, mentre il picco
resta il massimo di un intervallo **disegnato**, perché è il numero scritto
sotto il grafico e deve corrispondere al punto più alto che si vede.

La Bluetti non aveva il problema — le sue uscite sono sempre positive, e niente
si annulla — ma passa dalla stessa macchina, e una prova lo tiene fermo.
