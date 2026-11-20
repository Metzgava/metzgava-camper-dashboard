# La Bluetti via Bluetooth: il disegno

**19/11/2026, sera.** Progetto. Il lavoro di ricerca che lo precede sta in
[`docs/bluetti-via-bluetooth.md`](../../bluetti-via-bluetooth.md).

## Perché

Oggi il cloud di Bluetti è stato in avaria **due ore**. In quelle due ore il
quadrante ha mostrato una carica di novanta minuti prima, i comandi non sono
arrivati all'apparecchio, e per un difetto nostro — corretto — un loro timeout
ha portato giù l'intera pagina per sedici secondi.

Non è un caso raro da mettere in conto: è successo il primo giorno in cui la
scatoletta è stata in camper.

La Bluetti sta a tre metri dalla scatoletta. Leggerla da lì toglie di mezzo
tutto: nessun gettone da rinnovare, nessun gateway che va in timeout, nessun
codice 805. E funziona in montagna senza campo, che è quando il camper serve
di più.

## Quel che è già dimostrato

Sui suoi apparecchi, stasera:

- la cifratura V2 in **Python puro** funziona — nessuna chiave da estrarre,
  nessun file di chiavi, nessun binario, nessun contenitore;
- la stretta di mano si chiude su **Elite 300** e su **CHARGER**;
- i registri rispondono: il 110 dell'Elite 300 dà `EL300`, il suo modello.

La strada ufficiale di Bluetti è invece chiusa per noi: pubblicano la libreria
`aarch64` solo in versione musl, e Raspberry Pi OS è glibc. Verificato
chiedendolo al loro server.

## Goal

- Carica, watt in ingresso, watt in uscita e stato della Bluetti **letti via
  Bluetooth**, senza passare dal loro cloud.
- Le stesse grandezze che l'app mostra oggi, così la pagina non cambia.
- Il cloud resta come **ripiego**, non come fonte: se il Bluetooth non la
  sente — camper lontano, radio occupata — si usa l'ultima lettura del cloud,
  con la sua età, come si fa già adesso.

## Non-goal

- **I comandi.** Accendere e spegnere la 220 resta sul cloud, per ora.
  Leggere un apparecchio con un protocollo ricavato è un conto; scrivergli un
  interruttore che regge i 220 V del camper è un altro, e si decide a parte.
- Il CHARGER. Si leggerà, ma dopo: ha una mappa sua e la Bluetti viene prima.
- Sostituire il cloud del tutto. Finché non avremo misurato che il Bluetooth
  regge per settimane, il cloud resta.

## Anti-goal

**Che un registro venga battezzato per somiglianza.** Un numero che "sembra"
una percentuale non è la carica. L'unica prova accettabile è che il valore
letto via Bluetooth **coincida** con quello del cloud nello stesso istante, e
che **cambi insieme a lui** quando la situazione cambia. Un registro
identificato male produce un numero plausibile e sbagliato — il peggiore di
tutti, perché nessuno lo mette in dubbio.

**E che la radio della scatoletta diventi il collo di bottiglia.** Collegarsi
alla Bluetti costa tempo come per le Ective. Va nel giro lento, non in quello
svelto.

## Il metodo: due fotografie dello stesso istante

Per identificare i registri servono coppie.

1. **La fotografia Bluetooth.** Lo strumento si collega alla Bluetti, legge un
   intervallo largo di registri a blocchi, e scrive tutto con l'ora esatta.
2. **La fotografia del cloud.** Gli stessi cinque numeri letti dall'app nello
   stesso minuto: carica, entra, esce, 220 V, 12 V.
3. **Il confronto.** Un valore del cloud cercato fra i registri, nelle forme
   plausibili: numero intero, decimo, centesimo, con e senza segno.
4. **La conferma.** Si cambia qualcosa di noto — si accende la 220, si attacca
   un carico — e si rifà la coppia. Un registro che si muove insieme al valore
   del cloud è identificato; uno che per caso coincideva una volta no.

Tre o quattro coppie in condizioni diverse bastano per i valori principali.

## Quel che si fa senza il cloud

Se il loro cloud resta in avaria, si procede lo stesso ma più lentamente:
accendendo e spegnendo carichi noti e guardando **quali registri si muovono**.
Meno preciso per i valori assoluti, ma sufficiente per trovare dove stanno.

## Come entra nella scatoletta

Un lettore nuovo accanto a quelli che ci sono — Victron, Ective, termometri —
nel **giro lento**, perché richiede un collegamento.

Il pacchetto che manda al server è quello di sempre: `id`, `nome`, `tipo`,
`dati`, `misure`. Il server non deve accorgersi che la fonte è cambiata, e la
pagina nemmeno. E `tipo` va scritto **anche dentro `dati`**, come si è imparato
oggi.

Il cloud resta e continua a scrivere le sue istantanee. Quando entrambi
parlano, vince il Bluetooth: è più fresco e non dipende da nessuno.

## Prove

- un registro non si considera identificato finché due coppie in condizioni
  diverse non concordano;
- un valore fuori scala non si spedisce — regola 2, già in vigore;
- il lettore Bluetooth fallisce senza portarsi via il giro: come le Ective;
- se la Bluetti non si fa sentire, si usa il cloud e si dice l'età;
- il pacchetto porta `tipo` dentro `dati`, o la pagina non lo vede.

## Quel che resta al costruttore

L'intervallo di registri da leggere e la dimensione dei blocchi: si trovano
provando, e dipendono da quanto l'apparecchio accetta per volta.

---

## Aggiunta del 20/11/2026

Tre cose decise dai fatti, che non cambiano il disegno ma ne tolgono
un'incertezza e un non-goal.

**L'anti-goal ha fatto il suo mestiere.** `[102]` e' la carica, su quattro
coppie, l'ultima a 100 % letta dal **display** e non dall'app. `[104]`/`[105]`
sono l'autonomia in minuti, verificata sul rapporto. I watt in ingresso **non
sono ancora identificati**, e non lo saranno per somiglianza: mancava la
condizione, non il registro.

**Il CHARGER non e' piu' «dopo».** La stretta di mano si chiude anche su di
lui, con lo stesso strumento. I suoi blocchi 100-119 e 140-159 rispondono tutti
zero a riposo: e' li' che stanno le sue potenze. Resta un non-goal **mandarlo
alla pagina**, non leggerlo.

**Il metodo delle due fotografie si automatizza.** La parte che chiedeva una
persona — «gli stessi cinque numeri letti nello stesso minuto» — e' impossibile
proprio nella condizione che serve, cioe' mentre il camper carica in marcia.
`sonda/raccolta.sh` scatta ogni dieci minuti e tiene tutto; `sonda/confronta.py`
mostra solo i registri che si muovono. Si perde la coppia esatta col cloud e si
guadagna quel che il disegno chiedeva davvero: **vedere chi si muove insieme a
cosa**, che era gia' previsto in «Quel che si fa senza il cloud».

**Il sospetto sul Charger cade.** Si era temuto che tenesse occupato il posto
Bluetooth mentre carica, il che avrebbe imposto di leggere solo nelle pause. Il
silenzio della Bluetti aveva un'altra causa, nostra: un collegamento rimasto
appeso da una sonda morta male. Il disegno resta com'e'; la prova definitiva
arrivera' dalla raccolta al prossimo viaggio.
