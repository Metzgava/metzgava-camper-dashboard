# Le ipotesi di viaggio

> Andrea, 14 novembre 2026: «fai in modo che si possa ipotizzare una
> destinazione e poi si possa suddividere in vari giorni con tratta e luoghi,
> poi aggiungere altri percorsi anche in direzioni diverse e ancora suddividerli
> in giorni con percorsi diversi. come sempre con calcoli di spese per gasolio,
> pedaggi ecc».
>
> Alla domanda se un giorno ha sempre una guida: «vai avanti e scegli tu».

## L'intento

Tenere aperte più direzioni per intero — le Lofoten o la Spagna — ognuna col suo
programma giorno per giorno e col suo conto, e sceglierne una guardando i numeri.
Finché non si scegle, nessuna fa il totale del viaggio.

## Non-obiettivi

- Non è un calendario: i giorni sono numeri, non date. Le date arrivano con
  «fissa la partenza», che c'era già.
- Non è un ottimizzatore: l'app conta, non propone l'itinerario.

## Quello che c'era già

- `percorsi`: una strada fra due o più punti, con le varianti (rapido / senza
  pedaggi), km, minuti, km di pedaggio e il gasolio. **Ogni variante porta le
  tratte già misurate.**
- `legs.giorno`: il giorno teorico di una tappa, e «fissa la partenza» che li
  trasforma in date.
- Il budget contava **gasolio e campeggi**, e niente pedaggi.

## Le scelte, che sono mie

1. **Il giorno è un contenitore**, non una tratta: dentro ci stanno una tratta,
   due o nessuna. Un giro di venti giorni senza un giorno fermo non esiste.
2. **Le strade possibili diventano le tratte dei giorni** (`percorsi.giorno_id`).
   Niente secondo modo di disegnare una strada: km, ore, gasolio e pedaggi sono
   già contati, e un secondo modo divergerebbe alla prima correzione.
3. **Una strada senza giorno resta libera** e si può dare a qualunque giorno di
   qualunque ipotesi: una strada vale anche per un'altra direzione.
4. **In mappa ce ne sta una per volta.** Due direzioni insieme davano «799 km»,
   cioè Lofoten più Spagna: un totale che non serve a niente. Mettendone una, le
   altre escono — e lo dice.
5. **I pedaggi entrano nel budget.** Il calcolatore dava i chilometri di
   autostrada di ogni tappa e nessuno li contava: era un buco, non una aggiunta.
   Il costo è una stima a tariffa fissa (`toll_per_km`), e si dice che lo è.
6. **Le notti sono i giorni che hanno un posto dove dormire**; se nessuno lo
   dice, si stima coi giorni meno uno. I prezzi noti fanno la media per quelli
   ignoti — la stessa regola dei campeggi del budget.
7. **Zero e null non sono la stessa cosa.** Una strada che evita i pedaggi costa
   zero di pedaggi; una strada che non sa i suoi pedaggi non costa zero, non si
   sa. Il totale somma quello che si sa e scrive cosa manca.

## I pezzi

- `src/lib/ipotesi.js` — `contoIpotesi`, pura e provata: km, ore, giorni, notti,
  gasolio, pedaggi, campeggi, totale, e l'elenco di quello che manca.
- `src/lib/budget.js` — `pedaggiPrevisti`, pura e provata.
- Tabelle `ipotesi` e `giorni`; `percorsi.giorno_id`.
- Rotte: CRUD ipotesi e giorni, `percorsi/:id/in-giorno`, `ipotesi/:id/in-mappa`,
  e la voce pedaggi in `budgetDi`.
- Interfaccia: una scheda per ipotesi, con la striscia dei soldi, i giorni
  dentro, e il tasto che la mette in mappa.

## Le soste dentro ai giorni (14 novembre, lo stesso giorno)

> «ovviamente lungo le tappe si devono poter inserire le soste dove pernottare,
> visitare e quant'altro. per le soste deve potersi inserire in numero
> identificativo di park4night come al solito che da solo identifica e colloca
> sulla mappa il luogo e il link per aprire sull'app di park4night».

Era il buco che avevo lasciato io: «dove si dorme» era testo libero. Chiuso
così, e la scelta è la stessa delle strade — **non un oggetto nuovo**:

8. **Le soste di un giorno sono i posti della lavagna** (`proposte.giorno_id`).
   La lavagna già fa tutto quello che chiede: codice park4night che da solo
   trova nome, coordinate e tipo, il collegamento che apre l'app, il tipo
   (dormire / sosta breve / da vedere) e il prezzo a notte. Un quarto oggetto
   «fermata» avrebbe duplicato tutto questo, e sarebbe divergente entro un mese.
9. **Un posto senza giorno resta libero in lavagna**, buono per qualunque giorno
   di qualunque ipotesi — come una strada.
10. **In mappa, i posti dei giorni diventano soste vere del viaggio**, col numero
    del loro giorno, riusando la conversione che c'era già (che non duplica un
    posto arrivato per due strade, e non copia mai il prezzo). Un posto senza
    coordinate si salta, e si dice quanti: una sosta che non si sa dove sia non
    si disegna in mezzo al mare.
11. **Il prezzo della notte**: quello scritto sul giorno vince, perché è
    l'ultima parola di chi pianifica; se no quello dei posti dove si dorme di
    quel giorno. Due posti per la stessa notte vogliono dire che non si è ancora
    scelto: si fa la media, invece di dare per buono il primo.

## Quello che resta al prossimo giro

- Riordinare i giorni (oggi si aggiungono in coda; togliendone uno gli altri
  scalano).
