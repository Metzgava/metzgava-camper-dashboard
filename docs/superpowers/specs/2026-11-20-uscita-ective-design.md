# Quanto esce dalle Ective — disegno breve

**20 novembre 2026.** Modifica piccola, approvata dal proprietario a voce:
«tieni il quanto durano è importante e vai».

## Intento

Le due Ective si leggono da quando la scatoletta è a bordo, e nella pagina c'è
già scritto, dentro ogni quadrante e in corpo 10, `12,xx V · −x,xx A`. Il
proprietario vuole **vedere quanto esce**: un numero solo, in watt, e quanto
durano le batterie a quel consumo.

Oggi non c'è, e il motivo è preciso: `conti.js` somma solo le correnti
**positive** (`sommaPos`), perché quel conto è nato per la figura «Cosa carica
le batterie». Tutto ciò che va nel verso opposto — cioè il consumo del camper —
non arriva mai in pagina come numero. E `tempo_residuo_ective` è rimasto la
frase «arriva quando la scatoletta sarà a bordo»: la stessa bugia involontaria
che il 19/11 è stata tolta dalla riga degli apparecchi attesi, sopravvissuta
qui.

## Obiettivi

1. **I watt in uscita dal pacco**, uno solo, con sotto la ripartizione fra le
   due batterie e i volt.
2. **Quanto durano** a quel consumo, nel riquadro «Col consumo di adesso» che
   nella scheda c'è già e oggi resta vuoto.

## Non obiettivi

- **Non si dice da cosa escono.** Si misura il pacco, non i carichi: frigo,
  pompa, luci e ventola non si distinguono. Nessuna figura a rami come quella
  della carica, che qui sarebbe inventata.
- **Non si cambia `fonti_ective`.** La figura della carica è un disegno
  approvato il 19/11 e resta com'è.

## Anti obiettivo

Un consumo che sembra misurato e non lo è. Su un'autonomia, un numero
ottimista è peggio di una casella vuota: fa restare fermi una notte in più
contando su ore che non ci sono.

## Approcci

1. **Il netto del pacco** — somma algebrica delle potenze, cambiata di segno.
   **Scelto.**
2. **La somma delle sole correnti negative.** Scartato: se una batteria prende
   +3 A dal sole e l'altra dà −25 A, dal pacco escono 22 A. Contare 25
   conterebbe anche l'energia che si è solo spostata fra le due batterie, e
   gonfierebbe il consumo — nella direzione sbagliata, quella che fa sembrare
   l'autonomia più corta... e il consumo più grande di quello vero. In entrambi
   i casi è un numero che non esiste.
3. **Unificare: un'unica potenza netta del pacco da cui derivare sia «entra»
   che «esce».** È il disegno più pulito e va tenuto da parte, ma cambierebbe
   `fonti_ective` e con essa la figura della carica. Non si tocca un disegno
   approvato per aggiungere un numero. L'asimmetria con `sommaPos` resta
   dichiarata in un commento.

## Le decisioni che contano

- **Watt, non ampere.** È l'unità con cui parla tutto il resto della pagina: la
  Bluetti, la catena, i rami. Gli ampere restano accanto, perché è come le
  batterie si leggono sul campo.
- **Zero non è «non so».** Batterie in carica, o niente che consuma: si scrive
  **«niente esce»**, non «—». `null` è riservato al non sapere, cioè a nessuna
  lettura.
- **Nessuna soglia di rumore sul totale.** Un pacco a riposo non consuma zero:
  la scatoletta stessa pesa, e quel peso è un dato che il progetto già calcola
  (`costo_scatoletta`). Mascherarlo sotto una soglia nasconderebbe una misura
  vera.
- **Se una delle due non si è fatta leggere nel giro,** il conto si fa con
  quella che c'è e la pagina lo dichiara. Un consumo di metà pacco spacciato
  per il pacco intero è ottimista, e qui l'ottimismo è il guasto.
- **Oltre la mezz'ora** il numero resta scritto con la sua età in ambra, come
  per la Bluetti: `FERMA_DOPO_MINUTI`, la regola già in casa. L'età va detta,
  non il valore nascosto.
- **Autonomia fino a zero**, come `carica_residua` fa per la Bluetti. Nessuna
  riserva inventata: le LiFePO4 non si vuotano, ma la riserva giusta è una
  scelta del proprietario, non un numero che mi invento io.

## Cosa resta al costruttore

Una funzione pura in `conti.js`, provata da sola: dalle righe delle batterie ai
watt netti, agli ampere, ai Wh residui e alle ore. Il resto è cablaggio.
`etaDelleEctive`, oggi nascosta in `routes/stato.js`, si sposta lì accanto ed è
una sola.

---

## Aggiunta a costruzione finita — 20 novembre 2026

Due cose che il disegno non aveva previsto, trovate costruendo.

**L'avviso «mezzo pacco» era puntato sul caso sbagliato.** Il disegno diceva:
«se una delle due non si è fatta leggere nel giro, il conto si fa con quella
che c'è e la pagina lo dichiara». La prima prova lo modellava come una riga
senza volt né ampere — e non scattava mai. `istantanee` tiene l'**ultima**
lettura di ciascun apparecchio: una batteria che smette di rispondere non
sparisce e non resta senza numeri, resta lì coi suoi di prima e **invecchia da
sola** mentre l'altra è fresca.

Il guasto vero è quindi un altro: la somma di due istanti diversi. È lo stesso
errore che il 19/11 ha prodotto «esce 0 W, arriva 201 W» fra Bluetti ed Ective,
qui dentro lo stesso pacco — e sbaglia nella direzione ottimista, perché la
batteria ferma porta il consumo di quando andava tutto bene. Oltre dieci minuti
di scarto (cinque giri persi) l'avviso compare. Due minuti è il passo normale
della scatoletta, e un avviso che compare sempre è un avviso che nessuno legge.

**La ripartizione fra le due batterie non va in pagina.** Il disegno la
chiedeva «sotto il numero», e costruita era giusto: tre righe di numeri di
serie su un telefono per ridire quel che i due quadranti scrivono due
centimetri sopra, `13,08 V · −8,40 A` sotto ciascuno. Resta nel `perche` del
conto, che è il verbale e va dove vanno i dati. In pagina va solo quel che non
c'è altrove: il totale in ampere, e l'avviso.

**Un difetto preso di straforo.** `etaDelleEctive`, spostata da
`routes/stato.js`, scartava le date assenti con `Number.isFinite` dopo
`new Date(null)` — che non è una data non valida, è il 1970. Una riga senza
`quando` dava cinquant'anni di età invece di «non so», e avrebbe tenuto ferma
la figura della carica per sempre. Era lì da quando esiste la figura.
