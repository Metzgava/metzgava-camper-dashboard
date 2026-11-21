# La potenza netta delle Ective: un numero con il segno, due versi

**Data:** 21/11/2026
**Stato:** da approvare

## Perché

Il 21/11/2026, camper fermo, il proprietario guarda la pagina e trova tre cose
che non tornano:

- i manometri delle Ective dicono **95 % e 98 %** — non sono piene;
- dal sole arrivano **8 W** — misurati, scritti accanto al sole;
- e il ramo verso le batterie **non è verde**, con sotto la frase
  «**sono già cariche**, e quella corrente sta andando ai consumi del camper».

La frase è falsa. Le batterie non sono cariche: si stanno **scaricando**, e gli
8 W del sole stanno coprendo una parte dei consumi invece di caricare. È un
errore nel verso ottimista — quello che questo progetto considera il pericoloso
— e il proprietario l'ha trovato guardando due numeri sulla stessa schermata.

La causa non è nella figura. È in `conti.js`:

```js
const sommaPos = (righe, f) => {
  const n = righe.map(f).filter(x => x != null && x > 0);
  return n.length ? n.reduce((s, x) => s + x, 0) : null;   // ← null
};
const entraEctive = sommaPos(batterie, r => pot(r.dati));

out.fonti_ective = entraEctive == null
  ? manca('W', ['letture delle Ective'],
      'Arriva con la scatoletta: oggi nessuno misura la loro corrente.')
```

`sommaPos` tiene **solo le potenze positive**. Quando il pacco si scarica tutte
le potenze sono negative, il filtro le scarta, la funzione torna `null`, e la
pagina dichiara che *nessuno misura la corrente delle Ective*. Ma la corrente la
misuriamo: è negativa. È uno **zero misurato travestito da «non so»**, cioè
esattamente la confusione che il resto del progetto tiene separata dappertutto.

### E c'è una seconda rottura, peggiore, che nessuno aveva ancora visto

`sommaPos` non sbaglia solo quando il pacco scarica. Sbaglia **ogni volta che
una batteria carica e l'altra scarica**.

Con una Ective a +11 A e l'altra a −4 A, a 13,1 V:

| | oggi | il vero |
|---|---|---|
| `fonti_ective` («in ingresso») | **144 W** | 92 W |
| `consumo_ective` («in uscita») | 0 W | 0 W |

I 52 W di differenza non entrano nel pacco da nessuna parte: si **spostano da
una batteria all'altra**. Il numero 144 è un numero che non esiste, e sta in
pagina come «misurato».

Questa non è una scoperta nuova. Sta scritta nel codice dal 20/11, nel commento
sopra `uscitaEctive`:

> *«Il netto, non la somma delle negative. Se una batteria prende +3 A dal sole
> e l'altra dà -25 A, dal pacco escono 22 A: quei 3 A si sono solo spostati fra
> le due, e contarli come consumo del camper sarebbe un numero che non
> esiste. […] Asimmetria dichiarata: `sommaPos` più sotto tiene solo le
> positive […]. Il modo pulito sarebbe un'unica potenza netta del pacco da cui
> ricavare entrambi i versi, e vale la pena farlo un giorno; non si tocca un
> disegno approvato per aggiungere un numero.»*

Il lato **uscita** è già stato fatto giusto in quel giro: `uscitaEctive` calcola
`netto = -Σ(volt × ampere)` e poi `watt = Math.max(0, netto)`. Il netto esiste
già, giusto, misurato. Viene **buttato quando è negativo** — cioè proprio quando
servirebbe al lato ingresso.

Quel giorno è oggi, e il proprietario ha chiesto di farlo adesso perché è fermo:
la figura si può guardare mentre cambia.

## Obiettivi

1. **Un solo numero con il segno** per il pacco Ective, da cui si ricavano i due
   versi. Sopra zero esce, sotto zero entra, zero è zero — e `null` resta
   riservato al non avere letture.
2. **Togliere la frase falsa.** Quando le fonti producono e nelle batterie non
   entra niente, la pagina deve distinguere i due casi opposti — piene davvero,
   oppure in scarica — e dirli con i numeri che ha già in mano.
3. **Togliere il numero che non esiste**: con una batteria che carica e l'altra
   che scarica, «in ingresso» deve essere il netto del pacco, non la somma dei
   due versi.

## Non obiettivi

- **Ridisegnare la figura.** Oggi, quando le fonti producono senza caricare, i
  loro rami restano grigi con il numero scritto e la spiegazione sta a parole
  sotto il disegno. Mostrare graficamente che quella corrente **va ai consumi**
  — i rami che si congiungono al ramo d'uscita invece di fermarsi davanti alla
  batteria — è un ridisegno vero, e merita il suo giro di prova sulla pagina.
  Resta fuori, e resta sul tavolo.
- **Toccare la Bluetti.** `flusso_bluetti`, il manometro e il cloud non
  c'entrano. (Il manometro dal Bluetooth invece che dal cloud è un altro
  disegno, anche quello sul tavolo.)
- **Toccare i grafici della Storia.** Prendono le grandezze dal database scritte
  dalla scatoletta, non da `conti.js`: non passano da qui.

## Anti obiettivi

Cose che renderebbero questo lavoro un danno anche se funzionasse:

- **Far sparire o cambiare `consumo_ective`.** È misurato e giusto da ieri, e
  sotto ci stanno il tempo residuo e la scheda dei consumi. Il suo valore non
  deve muoversi di un watt per effetto di questo lavoro.
- **Inventare il ramo «dalla 220» quando il pacco scarica.** Quel ramo si
  ottiene per differenza da quel che entra; se non entra niente, la differenza
  non esiste. Deve restare **`—` ignoto**, non zero: un caricatore da 50 W
  mentre i consumi ne prendono 100 non si vede, e dire «zero dalla 220»
  sarebbe affermare di averlo escluso.
- **Dire ai consumi del camper un numero esatto** che non possiamo misurare.
  Fonti invisibili (il relè separatore di fabbrica, la Bluetti sul 12 V)
  aggiungono corrente che non vediamo: dei consumi si può dire «almeno tanto»,
  non «tanto».

## Vincoli

- La grammatica della casa: ogni valore porta `base`
  (`misurato`/`stima`/`incompleto`), `perche`, `detto`, `mancano`. `—` è «non
  so», `0` è uno zero conosciuto.
- `fonti_ective.valore` è letto dalla figura come **totale del lato in entrata**
  e usato per la scala dello spessore dei rami: deve restare un numero in watt,
  positivo o zero.
- Le prove girano con `npm test` in `servizi/`. Nessuna prova esistente va
  cancellata per far passare il lavoro.
- La prova `test/uscita-ective-cablaggio.test.js`, caso «la figura della carica
  non è stata toccata», **cade di proposito**: è scritta per cadere il giorno in
  cui i due versi si unificano, e lo dice nel suo commento. Va riscritta, non
  rimossa, e il suo nome deve cambiare per dire la cosa nuova.

## Le strade considerate

**A. Toppa minima sul posto.** Quando `sommaPos` torna `null` ma le letture
esistono, emettere `conto(0, 'W', { base: 'misurato', … })` invece di `manca`.
Due righe. Ma lascia in piedi il numero che non esiste (+11/−4 → 144 W), perché
non tocca il filtro delle positive: cura il sintomo che si è visto e lascia
quello che non si è ancora visto.

**B. La potenza netta del pacco, un numero con il segno** — da cui `fonti_ective`
e `consumo_ective` si ricavano entrambi, e il filtro delle positive sparisce.
È quel che il commento del 20/11 indica. Cura tutti e due i difetti con la stessa
riga, perché sono lo stesso difetto. Costa: tocca la prova che pinna
l'asimmetria, e va guardata sulla pagina perché cambia un numero che si vede.

**C. Chiedere alle batterie il verso invece di dedurlo** dal segno di volt×ampere
— un campo `in_carica` dalle Ective. Scartata: non ce l'hanno, e il segno della
corrente **è** il verso, misurato. Aggiungerebbe una dipendenza per sapere quel
che già sappiamo.

**Scelta del proprietario: B** (le sue parole: «sono fermo quindi puoi fare 1 e
2?» — la 1 era la potenza netta, la 2 era togliere la bugia). Si fanno insieme
perché la 2 senza la 1 è la toppa A, e la 1 senza la 2 cambierebbe i numeri
lasciando in pagina la frase falsa.

## Come si fa

### 1. `uscitaEctive` restituisce il netto con il segno

Il calcolo c'è già. Cambia solo che il numero **non si butta più**:

- si aggiunge `netto` al valore di ritorno — positivo quando dal pacco esce
  corrente, negativo quando entra, con la stessa convenzione che il codice usa
  già internamente;
- `watt` resta `Math.max(0, netto)`, invariato;
- nel caso vuoto (nessuna lettura) `netto` è `null`, come gli altri campi: non
  sapere non è zero.

Il commento che dichiara l'asimmetria va riscritto: non descrive più il codice.

### 2. `fonti_ective` si ricava dallo stesso netto

Al posto di `sommaPos(batterie, r => pot(r.dati))`:

- **nessuna lettura** (`netto == null`) → `manca('W', ['letture delle Ective'], …)`
  con il testo di oggi, che lì è vero;
- **netto < 0** → `conto(-netto, …)`, `base: 'misurato'`, con la ripartizione di
  oggi nel `perche` (sole, alternatore, 220 per differenza);
- **netto >= 0** → `conto(0, …)`, `base: 'misurato'`, e un `perche` che dice il
  fatto invece di nasconderlo: dal pacco **esce** corrente, non entra, con
  quanti watt escono.

`sole_w` e `motore_w` restano quel che sono: misure proprie di SmartSolar e
Orion XS, vere anche mentre il pacco scarica, e vanno attaccate al risultato in
tutti e tre i casi.

`rete_w` — il ramo dedotto — va attaccato **solo nel secondo caso**. Negli altri
due resta `null`, e la figura lo disegna ignoto. (Vedi gli anti obiettivi: uno
zero lì sarebbe un'esclusione che non abbiamo fatto.)

Il `conto` del caso «netto >= 0» porta anche il dato che serve alla figura per
scegliere la frase: **quanto esce** e **la carica delle batterie**. Il secondo lo
sa già `uscitaEctive` per batteria (`per_batteria`) e per il residuo; va reso
leggibile anche come carica del pacco, perché la figura deve poter dire «piene»
soltanto quando lo sono davvero.

### 3. La figura sceglie fra tre frasi, non una

Oggi `ramiDellaCarica` calcola `altrove = totale <= 0 && rami.some(watt > 0)` e
la pagina scrive una frase sola. `altrove` diventa un **nome di stato**, con tre
valori possibili, deciso in `flusso.js` (dove stanno le prove) e non in
`app.js`:

- **`piene`** — dal pacco non esce niente e la carica è alta: la frase di oggi
  va bene, ed è vera.
- **`scarica`** — dal pacco esce corrente mentre le fonti producono: la frase
  deve dire che le batterie si stanno svuotando e che il sole copre una parte
  dei consumi, **non** che sono cariche.
- **`non_so`** — manca la carica, o manca quanto esce: si dice che le fonti
  producono e che nelle batterie non entra niente, senza attribuire una causa.

La soglia fra `piene` e il resto è una **scelta di disegno** come
`RIFERIMENTO_USCITA_W`: va scritta come costante esportata con il suo perché
accanto, non sparsa in un confronto. Il proprietario ha letto 95 % e 98 % e non
le ha chiamate piene; una batteria al litio in mantenimento sta sopra il 99 %.

**E servono due soglie, non una.** Trovato dalla revisione del disegno: `piene`
scatta quando dal pacco non esce niente, e un pacco davvero pieno **non legge
zero**. A riposo il proprietario stesso ha misurato −0,29 A, cioè circa 3,8 W
che escono. Con «non esce niente» inteso come zero esatto, lo stato `piene` non
scatterebbe mai, la soglia sulla carica non deciderebbe niente, e l'obiettivo 2
resterebbe fatto a metà.

Quindi `piene` chiede **carica alta** *e* **uscita sotto una soglia di pochi
watt**. Quella seconda soglia è una costante nuova, separata e con il suo nome.

Perché non si riusa `SOGLIA_W`: quella soglia esiste per decidere **se animare
un ramo**, e `flusso.js` dice espressamente che non vale per le Ective — lì la
corrente in ingresso è già il fatto che interessa. Questa invece serve a
**scegliere una frase**. Due scopi diversi vogliono due costanti diverse, e
quella nuova va commentata dicendo che non nasconde una misura: il numero dei
watt in uscita resta scritto tale e quale, è solo la parola «piene» che
tollera i quattro watt del riposo.

Nella frase di `scarica` i numeri si prendono da quel che è misurato — i watt
che escono e i watt delle fonti — e dei consumi del camper si dice **«almeno»**,
mai una cifra esatta (anti obiettivi).

Quando la figura è `ferma` (letture oltre la mezz'ora) la frase di `scarica` non
va detta al presente: la regola del fermo esiste già e vale anche qui.

### 4. Le prove

Vanno scritte prima, e devono cadere prima di passare. Il minimo che questo
lavoro deve dimostrare:

- **le due Ective in scarica** (per esempio −6 A e −4 A): `fonti_ective` è uno
  **zero misurato**, non un `manca`, e `mancano` è vuoto;
- **una carica e l'altra scarica** (+11 A e −4 A): `fonti_ective` è il **netto**
  del pacco, e non la somma delle positive — è la prova che riscrive quella di
  oggi, ed è il numero che non esisteva;
- **il pacco in carica** (per esempio +6 A e +4 A): `fonti_ective` resta quel
  che era, e `consumo_ective` resta zero: la riprova che il lavoro non ha
  spostato il lato che era già giusto;
- **nessuna lettura**: resta `manca`, con `mancano` che dice cosa manca;
- **`consumo_ective` non si muove** in tutti i casi di sopra — è l'anti
  obiettivo, e va pinnato da una prova, non promesso;
- **`rete_w` è `null`**, non zero, quando il pacco non sta caricando;
- **lo stato della figura**: `piene` con carica alta e niente in uscita;
  `scarica` con watt in uscita e fonti che producono; `non_so` senza la carica;
- **la frase** di `scarica` non contiene «già cariche» — la bugia di oggi, pinnata
  perché non torni.

## Cosa resta al costruttore

- I nomi esatti dei campi nuovi, nella lingua del progetto.
- Il valore della soglia «piena», e la parola con cui scriverla.
- Il testo esatto delle tre frasi — detto in italiano piano, come il resto della
  pagina, con il numero attaccato al suo ramo.
- Se `netto` vada esposto anche come grandezza propria in `conti` (per esempio
  `potenza_ective`) oppure resti interno ai due versi. Si decide guardando se
  serve a qualcuno in pagina: se non serve a nessuno, non si aggiunge.
