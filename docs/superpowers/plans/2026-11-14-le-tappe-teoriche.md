# Le tappe teoriche

> Andrea, 14 novembre 2026: «dentro il viaggio da pianificare inserisci la
> possibilità di creare tappe che sommate daranno il totale del viaggio, la
> possibilità di aggiungerne anche di diverse e poi man mano si sceglieranno i
> percorsi definitivi. deve essere un tasto che dice inserisci percorso su mappa
> o togli da mappa. i giorni saranno teorici e confermati una volta decisi».
>
> Poi: «vai avanti da solo».

## L'intento

Un viaggio si prepara tenendo aperte più strade. Finché non si decide, le
alternative devono stare tutte in vista, ma **solo quelle messe in mappa fanno
il totale**: i chilometri, le ore, il gasolio. Il tasto è l'atto di decidere, e
si disfa.

I giorni, nel frattempo, sono numeri: «giorno 1», «giorno 2». Diventano date
una volta sola, quando si fissa la partenza.

## Quello che c'era già (e che non si rifà)

- `percorsi`: le strade possibili, con le varianti. **Ogni variante porta con sé
  le sue tratte già misurate** (`tratte`: da, a, km, minuti, la linea). Diventare
  tappe è una traduzione, non un calcolo nuovo.
- `legs`: le tappe. `date` può stare vuota. I totali (`numeri.km`, `minuti`) e il
  budget del gasolio **sommano già le tappe**: appena una strada diventa tappe,
  i numeri si muovono da soli.
- Lo spazio di pianificazione **non ha una mappa**. «Il giro» è un elenco, e dice
  ancora che le tappe si aggiungono dalla pagina del viaggio.

## Le scelte, che sono mie

Lui ha detto «vai avanti da solo», quindi queste le ho decise io e si possono
rovesciare:

1. **Una strada diventa tappe col tasto**, invece di avere due modi diversi di
   creare una tappa. Si incolla o si scrive una strada possibile, la si confronta
   coi suoi numeri, e quando convince si mette in mappa. Un secondo modo di fare
   la stessa cosa è un posto in cui le due strade divergono.
2. **La mappa sta dentro lo spazio**, non si va a cercarla nella pagina del
   viaggio: il tasto che dice «su mappa» ha bisogno di una mappa che si vede.
3. **Il giro in pieno, le alternative in chiaro e tratteggiate.** È il motivo per
   cui si tengono delle alternative: vederle vicine.
4. **Le tappe nate da una strada restano legate a quella strada**
   (`legs.percorso_id`). Senza quel filo, «togli da mappa» non saprebbe cosa
   togliere, e toccherebbe indovinare.
5. **Cambiare variante mentre si è in mappa ridisegna le tappe.** Scegliere
   «senza pedaggi» e vedere ancora l'autostrada sarebbe una bugia.

## I pezzi

### 1. Da strada a tappe
- `tappeDaPercorso(percorso)` — pura, provata: la variante scelta (o la prima)
  diventa una riga per tratta. Una tratta senza coordinate si salta: non si
  inventa.
- `legs.percorso_id` → sa da dove viene. `percorsiDi` dice `in_mappa`.
- `PUT /percorsi/:id/in-mappa` `{dentro}` — mette o toglie. Idempotente.
- `PUT /percorsi/:id` con una `scelta` nuova: se è in mappa, ridisegna.

### 2. Il tasto e la mappa
- Su ogni strada: **🗺️ inserisci percorso su mappa** / **togli da mappa**.
- Una mappa in cima allo spazio: le tappe in pieno (teal), le strade non in
  mappa tratteggiate e chiare, le soste coi loro spilli.
- Il cruscotto dice i km e le ore di quello che è in mappa, e quante strade
  restano fuori.

### 3. I giorni teorici
- `legs.giorno`, `stops.giorno` — numeri interi, senza data.
- In elenco: «giorno 3» dove prima c'era «senza data».
- `PUT /legs/:id/giorno`, `PUT /soste/:id/giorno`.
- `dataDelGiorno(partenza, giorno)` — pura, provata.
- **✅ Fissa la partenza**: una data, e tutti i numeri diventano date vere.
  Chiede conferma, perché riscrive le date di ogni tappa e di ogni sosta.

## Come si sa che funziona

- Test unitari sulle due funzioni pure (la traduzione e il calendario).
- In locale, dall'interfaccia: una strada messa in mappa muove i km del viaggio;
  toltala, tornano come prima; la strada resta in elenco.
- Giorni teorici su tappe e soste, poi la partenza fissata una volta: le date
  compaiono tutte, nell'ordine giusto.
