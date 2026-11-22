# Dichiarare l'autostrada, non indovinarla

**22/11/2026 — Camper Viaggi**

## Perche'

CarLock misura **quanto** si e' percorso, non **per dove**. La riga sulla
mappa e' sempre una ricostruzione, e fra le strade possibili il programma
prende quella che misura piu' vicino ai chilometri veri. E' un indizio, non
un'informazione: il 21/11/2026 Novaledo -> Udine e' stata disegnata per
Bassano mentre si era passati per Vidor e Pieve di Soligo.

I luoghi si possono gia' dichiarare: «🧭 Ridisegna» chiede per dove si e'
passati e la strada si ricuce da quei punti. Dell'autostrada no. Eppure e'
l'altra meta' della stessa informazione, e cambia **due** cose: il disegno, e
i chilometri a pedaggio -- da cui esce la spesa stimata del pedaggio sulla
tappa e, con lei, il totale del viaggio.

Chi c'era sa se ha pagato un casello. Il programma no, e non lo puo' dedurre.

## Obiettivi

- Nel riquadro «Ridisegna», accanto ai luoghi, si dichiara l'autostrada:
  **si'**, **no**, **non lo so**.
- La dichiarazione **entra nel calcolo della strada**, non filtra un
  risultato: se si dice «niente autostrada», la strada senza pedaggi si
  **chiede** al servizio dei percorsi.
- I chilometri a pedaggio della tappa, la spesa del pedaggio e il totale del
  viaggio si aggiornano di conseguenza. Con «no» e una strada davvero senza
  pedaggi diventano **uno zero che so**, non una stima che sparisce senza
  spiegazione.
- La dichiarazione resta sulla tappa, come i luoghi: ogni rotta che ridisegna
  la rispetta, non solo quella che l'ha scritta.
- Quel che esce si **controlla** contro quel che e' stato dichiarato, e se non
  torna lo si dice.

## Non obiettivi

- **Far scegliere fra le strade guardandole.** Scelta del proprietario:
  «dichiara e rifa'». Appena si dice si' o no sull'autostrada il candidato
  resta uno, quindi un elenco da cui scegliere sarebbe una scelta finta.
- **Dichiarare l'autostrada a pezzi** («autostrada fino a Vidor, poi
  statale»). Una dichiarazione per tappa. Chi vuole precisione in piu' la
  ottiene aggiungendo un luogo dichiarato.
- **Il prezzo vero del pedaggio.** Nessun servizio gratuito lo pubblica:
  resta una stima a tariffa chilometrica, come adesso.
- **Toccare la scelta del percorso in fase di pianificazione** (il selettore
  fra «il piu' rapido» e «senza pedaggi» quando un viaggio si prepara). Li' la
  scelta e' giusta com'e'.

## Anti obiettivi

Cose che renderebbero questo lavoro peggio di niente.

- **Che una dichiarazione cambi i chilometri, la durata o gli orari che
  arrivano da CarLock.** Sono misure, sono la base del gasolio e dei totali, e
  la riga continuerebbe a dire «chilometri e orari veri dal tracker» sopra un
  numero inventato. Il ridisegno scrive **la geometria e i chilometri a
  pedaggio**, nient'altro.
- **Che una tappa che non ha dichiarato niente si comporti come se avesse
  dichiarato.** «Non lo so» e «no» devono restare due cose diverse: altrimenti
  ogni tappa vecchia direbbe da sola una cosa che nessuno ha detto.
- **Disegnare un'autostrada dopo un «niente autostrada» senza dirlo.** E' la
  direzione rassicurante dell'errore, quella che questo lavoro chiude.
- **Portarsi via un importo di pedaggio scritto a mano.** Quello e' un dato
  vero, battuto da chi e' passato al casello.

## Vincoli

- La strada che evita i pedaggi la sa dare solo OpenRouteService, che vuole
  una chiave (`ORS_API_KEY`, attiva in produzione). **Senza chiave un «no» non
  si puo' onorare**: lo si dice, non si disegna la piu' rapida in silenzio.
- Fino a **otto luoghi dichiarati**, quindi fino a nove pezzi di strada, e
  ogni pezzo e' una richiesta per dichiarazione.
- La dichiarazione sta **sulla tappa**, e la strada si calcola in **un posto
  solo** (`stradaDellaTappa`): e' cosi' che ogni rotta che ridisegna la
  rispetta senza doverselo ricordare.

## Le due strade che si potevano prendere

**Filtrare dopo.** Calcolare le due varianti come adesso e tenere quella che
corrisponde alla dichiarazione. Non tocca il motore, ma ha un buco: la
variante senza pedaggi compare nell'elenco **solo se e' diversa** dalla piu'
rapida, quindi «nessun candidato senza pedaggi» vorrebbe dire due cose
opposte -- *non esiste una strada senza pedaggi*, oppure *la piu' rapida gia'
non ne fa*. E paga un calcolo per buttarlo via.

**Chiedere la strada giusta** — scelta. La dichiarazione entra nella richiesta
al servizio: con «no» si chiede direttamente la strada che evita i pedaggi.
Una domanda per pezzo invece di due (con otto luoghi e' la meta' dell'attesa),
e la risposta non e' ambigua. Costa passare un parametro attraverso quattro
funzioni.

## Come si fa

### La dichiarazione

Una colonna nuova sulla tappa, `pedaggi_dichiarati`, con tre stati: `'si'`,
`'no'`, e **vuoto = non lo so**. Il nome e' lungo di proposito: accanto
vivono gia' `pedaggio_km` (una misura) e `senza_pedaggio` (uno spegnimento
della stima), e tre nomi simili sono il modo di confonderli.

`senza_pedaggio` resta quel che e': se la stima del pedaggio e' stata spenta a
mano, dichiarare «si'» non la riaccende. Spegnere una stima e' una decisione
su cosa si vuole vedere; dichiarare l'autostrada e' un fatto sulla strada.

### Il calcolo

La dichiarazione scende dentro il motore dei percorsi come parametro, fino
alla richiesta:

- **`'no'`** -> si chiede la strada che evita i pedaggi. E' l'unica candidata:
  non c'e' niente da scegliere sui chilometri.
- **`'si'`** -> si chiede la piu' rapida, e **si scrive con queste parole**.
  Nessun servizio ha un «preferisci i pedaggi»: la piu' rapida e' quel che in
  pratica usa l'autostrada, e raccontarla come «ho chiesto l'autostrada»
  sarebbe una promessa piu' grande del dato.
- **vuoto** -> come adesso: si calcolano le strade possibili e si prende
  quella che misura piu' vicino ai chilometri veri.

Il punto dove la tappa incontra il calcolo e' `stradaDellaTappa`, che legge
gia' i luoghi dichiarati dalla tappa: legge anche questa. Cosi' «Ridisegna»,
il salvataggio della tappa e «Porta nella tappa» la rispettano tutte e tre.

### Il controllo di quel che esce

Dopo il calcolo si guarda la strada che e' tornata e si confronta con la
dichiarazione:

- dichiarato **«no»** e la strada fa comunque chilometri a pedaggio -> la riga
  si disegna (i luoghi dichiarati valgono comunque) **e lo si dice**: «fra
  questi posti non ho trovato una strada senza pedaggi: questa ne fa 12 km».
- dichiarato **«si'»** e la strada non ne fa nemmeno uno -> si dice anche
  questo.
- manca la chiave del servizio e si dichiara **«no»** -> si dice che la strada
  senza pedaggi non si puo' chiedere.

Nessuno di questi casi e' un errore da nascondere: sono informazioni su una
strada, e chi le riceve sa cosa farne.

### I costi

I chilometri a pedaggio della tappa diventano quelli della strada scelta --
compreso lo zero. Da li' in poi gira la macchina che c'e' gia':
`syncTollExpense` cancella la stima quando i chilometri sono zero, **lascia in
pace un importo scritto a mano**, e il totale del viaggio somma le spese.
Niente di nuovo da costruire: una prova pianta il comportamento, perche'
«segue da se'» e' il tipo di frase che un giorno non e' piu' vera.

### Cosa si vede

Nel riquadro **🧭 Ridisegna**, sotto il campo dei luoghi, tre risposte:

```
Per dove siete passati davvero?
[ Vidor, Pieve di Soligo                        ]
I posti attraversati, nell'ordine, separati da virgola. Fino a otto.

Avete fatto l'autostrada?
( ) Non lo so — scelgo io la strada che misura piu' vicino ai 187 km veri
( ) Si' — prendo la piu' rapida, che e' quella che usa l'autostrada
(•) No — chiedo la strada che evita i pedaggi
```

Sulla riga della tappa, la frase che dice gia' «passando per Vidor, Pieve di
Soligo, come hai detto tu» continua con **«senza autostrada»** o **«in
autostrada»**, e quando il controllo non torna lo dice li' e in un avviso.

## Cosa resta a chi costruisce

- I nomi esatti dei parametri e dove passarli, purche' la dichiarazione entri
  **nella richiesta** e non filtri un elenco.
- Le parole precise degli avvisi, nella voce del programma.
- Se la colonna porti un vincolo in banca dati o solo una validazione nella
  rotta.
