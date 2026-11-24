# I tracciati veri da CarLock

**24/11/2026 — Camper Viaggi**

## Perche'

La riga sulla mappa di una tappa CarLock e' sempre stata una **ricostruzione**:
il tracker manda partenza e arrivo, e il programma sceglie fra due strade
quella che misura piu' vicino ai chilometri veri. E' un indizio, non
un'informazione.

Quanto sbagli, adesso si sa con un numero. Su Novaledo -> Udine del 21/11 la
ricostruzione passava per **Bassano**: la traccia vera passa a **15,6 km** da
li'. I cinque posti dichiarati a memoria -- Vidor, Pieve di Soligo,
Conegliano, Cimpello, Codroipo -- stanno tutti sulla traccia vera, il piu'
lontano a 2,9 km.

Il 24/11/2026 CarLock ha mandato, su richiesta, i tracciati veri:

    trip,trip_start,trip_end,time,latitude,longitude,speed_kmh,heading_deg,altitude_m

**32.069 punti, 143 viaggi, dal 31 luglio al 22 novembre**, uno ogni quindici
secondi. Ogni punto porta anche velocita', direzione e quota.

## Due rubinetti sullo stesso lavandino

I dati sono gli stessi; cambia da dove arrivano.

**Il file.** E' la strada **supportata**. Si chiede per email, due o tre volte
l'anno, e arriva un CSV. Funziona oggi, e resta in piedi qualunque cosa
succeda all'altra.

**L'interfaccia del loro programma.** `api.carlock.co/v2/trip/<id>` risponde
coi punti, ma **non e' documentata ne' supportata** -- l'hanno scritto loro.
Vuole un gettone di accesso: col solo biscotto della sessione risponde 401.

Si costruisce **prima il file**: e' la strada supportata, i dati ce li
abbiamo gia', ed e' lei che prova la parte difficile -- agganciare ogni
traccia alla tappa giusta, cucire le tappe unite, campionare i punti.
L'interfaccia poi porta gli stessi dati nella stessa forma.

## Il periodo, e perche' decide la forma

**Si carica il periodo di un viaggio. Le altre date si lasciano perdere.**
Scelta del proprietario, 24/11/2026.

Quindi il tasto sta **dentro un viaggio**, non nell'elenco: prende le date del
viaggio (`start_date`..`end_date`, o il primo e l'ultimo giorno delle sue
tappe se mancano) e guarda solo i tragitti che ci cadono dentro.

Due ragioni perche' e' la forma giusta, e non solo una preferenza:

- **col file**, ignorare tutto quel che sta fuori evita che un tragitto di
  agosto finisca per sbaglio su una tappa di novembre;
- **con l'interfaccia**, chiedere solo i giorni che servono e' educazione
  verso un servizio che ci sta gia' facendo un favore. Chiedere quattro mesi
  ogni volta e' il modo di farsi chiudere l'accesso.

## Obiettivi

- Dentro un viaggio, un tasto che prende i tracciati **dei suoi giorni**: da
  un file caricato, o da CarLock direttamente.
- Ogni traccia si attacca alla **sua** tappa, e la riga disegnata diventa
  quella vera: niente piu' puntinato, e la riga della tappa lo dice.
- **Ricevere lo stesso tragitto due volte non fa danni**: si riconosce, e si
  riscrive lo stesso disegno.
- Alla fine un resoconto: quante tracce attaccate, quante no.

## Non obiettivi

- **Creare tappe o viaggi dai tragitti che non trovano casa.** «Solo un
  arricchimento di quel che c'e' gia'». Il file contiene anche la spesa e il
  meccanico, e quelli restano fuori.
- **Toccare chilometri, durata, orari.** Sono le misure del tracker, e sono la
  base del gasolio e dei totali.
- **Spostare i capi delle tappe.** Vedi sotto.
- **Chiedere a CarLock da solo, a orologio.** Solo quando si preme il tasto.

## Anti obiettivi

- **Che una traccia si attacchi alla tappa sbagliata.** Una riga che mostra
  una strada che non c'entra, con sopra il bollino «vero», e' peggio di una
  ricostruzione dichiarata tale: la ricostruzione la si mette in dubbio, il
  tracciato vero no.
- **Che un secondo caricamento duplichi qualcosa.**
- **Che una traccia cancelli in silenzio un lavoro fatto a mano** -- i luoghi
  dichiarati, una strada scelta nel riquadro.
- **Che le credenziali di CarLock finiscano in git, in un registro o in una
  conversazione.**

## Le credenziali

Il proprietario ha scelto la via automatica: il programma entra per conto suo
e si rinnova il gettone. Le credenziali stanno in `.env`, **fuori da git**,
come gia' quelle della Bluetti in Camper Servizi -- precedente che funziona da
settimane.

Tre paletti:

- **non si scrivono mai nei registri**, nemmeno troncate;
- **la richiesta parte solo a comando**, mai a orologio;
- **se l'accesso smette di funzionare lo si dice**, e si resta sul file. Un
  tracciato che non arriva non deve diventare una tappa senza riga.

## La questione dei capi, e perche' si lascia stare

La traccia sa dove sei partito **al metro**; i capi di oggi nascono dal
geocoder che cerca «Via Cavour 9, Susegana» e puo' sbagliare di cento metri o
piu'. Verrebbe voglia di correggerli.

Non si fa: **sulle tappe non esiste nessun segno di «corretto a mano»** --
quel segno c'e' sulle spese (`edited`), non sulle tappe. Quindi non si puo'
distinguere un capo messo dal geocoder da uno sistemato di persona, e
correggerli tutti vorrebbe dire cancellare quel lavoro senza chiedere.

Quel che si fa: **se la traccia comincia lontano dal capo salvato, lo si
dice** -- «la traccia parte a 400 m dalla partenza della tappa» -- e la
decisione resta sua.

## Come si aggancia

**Per data e finestra di orari.** Una tappa copre da `date + start_time` a
`date + end_time`; un tragitto le appartiene se il suo `trip_start` cade
dentro quella finestra.

E' la regola giusta perche' regge il caso delle **tappe unite**: quando si
importa, i tragitti separati da una sosta breve diventano una tappa sola, e
nei tracciati restano separati. Con la finestra si ritrovano tutti.

La geometria di una tappa unita si **cuce** dalle tracce dei suoi tragitti,
coi buchi delle soste visibili: erano spostamenti separati, e una riga
continua direbbe il falso.

**Un tragitto che cade in due tappe, o in nessuna, non si attacca**: finisce
nel conteggio di quelli lasciati fuori. Meglio una tappa senza traccia che una
traccia sulla tappa sbagliata.

## Quanti punti tenere

Fino a 1.184 per tragitto. La geometria viaggia a ogni apertura del viaggio, e
il programma gia' campiona le strade calcolate a 600 punti. Si campiona con lo
stesso metro, conservando i punti che cambiano direzione -- sono quelli che
fanno la forma.

## Cosa si vede

Sulla riga della tappa, al posto di «strada **ricostruita**»:

    • • • Chilometri, orari e strada veri dal tracker.

e la riga sulla mappa smette di essere puntinata: il tratteggio voleva dire
«questa strada e' dedotta», e non lo e' piu'.

I luoghi dichiarati restano scritti: non servono piu' a disegnare, ma
raccontano come ci si era arrivati. **E se la traccia li smentisce** -- un
posto dichiarato che la traccia non tocca -- lo si dice, invece di cancellare
in silenzio quel che il proprietario aveva scritto.

## Cosa resta a chi costruisce

- La tolleranza della finestra degli orari, e il tragitto che scavalca la
  mezzanotte.
- Il metodo di campionamento.
- Se tenere da parte, come numero, **quanto sbagliava la ricostruzione**: si
  ottiene gratis mentre si sostituisce, ed e' la misura di quanto vale tutto
  quel meccanismo.
