# Dentro e fuori dalle batterie — disegno breve

**20 novembre 2026.** Chiesto dal proprietario: *«nella app non vedo cosa esce
ora da ective, mi serve una cosa tipo cosa entra e cosa e quanto esce»*.

Verificato prima di cominciare: la riga «Esce adesso» **c'è e funziona** — sul
suo telefono segna 33 W. Non è un guasto. È che il numero sta in una riga di
testo dentro un'altra scheda, mentre quel che entra è una **figura** con i rami
che scorrono. Due cose della stessa importanza, una disegnata e una scritta in
fondo: per questo non l'ha trovata.

## Intento

Una figura sola che dice, nello stesso istante e con lo stesso linguaggio, **da
dove arriva** corrente alle batterie di servizio e **quanta ne esce**.

## Obiettivi

1. I tre ingressi (sole, alternatore, 220) e l'uscita verso i consumi del
   camper nella stessa figura, ai due lati del pacco.
2. Il totale in uscita in watt, col bollino `misurato`, e l'autonomia che già
   si calcola.
3. Nessun numero nuovo: tutto quello che serve lo producono già
   `fonti_ective` e `consumo_ective`.

## Non obiettivi

- **Non si dice da cosa esce.** Un ramo solo, senza nome: si misura il pacco,
  non i circuiti. I nomi — frigo, Truma, pompa, luci, Starlink — compaiono
  qui dentro **dopo la serata di taratura**, ed è lì che le due richieste del
  proprietario si chiudono nello stesso posto.
- **Non si toccano i conti del lato carica.** `fonti_ective`, il ramo dedotto
  della 220, il travaso e la nota della colonnina restano come sono: disegno
  approvato il 19/11.

## Anti obiettivo

Due figure per lo stesso pacco, una per verso. Sarebbe lo stesso errore dei tre
numeri di serie togliti stamattina: ripetere a destra quel che si legge a
sinistra, e far cercare al proprietario in quale delle due guardare.

## Approcci

1. **Una figura a due lati, al posto di quella attuale.** **Scelto.** È il
   precedente già in casa: «Dentro e fuori dalla Bluetti» è esattamente questo,
   e `lato()` e `aspetto()` in `flusso.js` sono già scritti e provati per quel
   mestiere. Il titolo diventa «Dentro e fuori dalle batterie», per simmetria
   con quella.
2. **Lasciare la figura com'è e aggiungerne una seconda, in uscita.** Scartato:
   è l'anti obiettivo. E separate non si confrontano, che è tutto il punto
   della domanda.
3. **Un quadrante solo, tipo lancetta, col netto del pacco.** Scartato: dice il
   verso e perde le fonti. Sapere che entrano 60 W **dal sole** mentre ne
   escono 33 è un'informazione che un netto di +27 butta via.

## Le decisioni che contano

- **Le due scale sono indipendenti**, una per lato. Il motivo è già scritto in
  `flusso.js` per la Bluetti: trecento watt da un lato e dieci dall'altro, con
  una scala sola, farebbero del lato piccolo un filo invisibile — mentre quei
  dieci watt sono *tutto* quel che entra.
- **I due lati possono muoversi insieme, e non è un errore.** Se una batteria
  prende e l'altra dà, entra ed esce corrente nello stesso momento: è il
  travaso fra le due, e la figura lo mostra invece di nasconderlo.
- **Niente soglia di rumore sul ramo in uscita.** A camper fermo il consumo non
  è zero: la scatoletta stessa pesa, e il progetto quel peso lo calcola già
  (`costo_scatoletta`). Nasconderlo sotto una soglia nasconderebbe una misura
  vera. È la stessa scelta già motivata per `SOGLIA_W`, che vale per la Bluetti
  e non per le Ective.
- **Zero non è «non so».** Niente in uscita si scrive **«niente esce»**; `—` è
  riservato al non avere letture. Regola della casa, già applicata al numero.
- **La regola del fermo vale per tutti e due i lati.** Oltre
  `FERMA_DOPO_MINUTI` i rami si fermano e i numeri restano scritti con la loro
  età: un disegno che scorre su dati vecchi mente meglio di un numero fermo, e
  questo vale in uscita come in entrata.
- **L'avviso dello scarto fra le due letture sta sotto la figura**, dove sta
  già oggi: se la somma è fatta di due istanti diversi, la figura non è una
  fotografia sola e lo deve dire.
- **La riga «Esce adesso» resta dov'è.** Nella scheda delle batterie, accanto
  all'autonomia, perché lì è il verbale. La figura è il colpo d'occhio: due
  mestieri diversi, e la riga non costa niente.

## Cosa resta al costruttore

Il lato in uscita in `flusso.js`, con le prove: una funzione che dai conti
tira fuori il ramo e il suo aspetto, riusando `lato()` e `aspetto()`. La
geometria della figura — dove cade il nodo centrale, quanto larga la colonna
dei nomi — è sua: il vincolo è che si legga su un telefono, verificato a
larghezza `mobile` prima di dire che è fatta.
