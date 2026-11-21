# Uno zero vecchio non è uno zero — disegno breve

**21 novembre 2026.** Il proprietario, camper fermo: *«in questo momento è
aperto il 220 da bluetti e app non lo rileva e i flussi delle animazioni
pure… sistema»*.

## Cos'era

Il cloud di Bluetti rifiutava da 25 minuti (msgCode 805, e anche il permesso
nato dal rinnovo veniva respinto). Il server faceva la cosa giusta: mostrava
l'ultima lettura buona con la sua età, in ambra. Alle 15:18 il collegamento è
tornato e alle 15:22 il servizio ha scritto *«travaso in corso, 436 W da
2 min»*. I 436 W c'erano, e la pagina li ha visti appena ha potuto.

Ma per quei 25 minuti la pagina ha mostrato l'uscita 220 a **zero** mentre dalla
Bluetti uscivano quattrocento watt. E non è la prima volta: il 19/11/2026,
identico, con 400 W. Due volte in tre giorni la pagina ha fatto dubitare di
quello che si vedeva con gli occhi.

## Perché la fascia dell'età non è bastata

La fascia c'era, e lo diceva. Ha perso comunque, e la ragione è nella grammatica
di questo progetto, non nel disegno della fascia.

Qui dentro **`—` vuol dire «non so» e `0` vuol dire «uno zero che conosco»**.
È la regola che tiene insieme tutta la pagina.

Uno zero vecchio **non è un valore vecchio**: è un'**affermazione** vecchia, e
l'affermazione è «non sta succedendo niente». Un 436 W di cinque minuti fa si
legge subito come una cosa che *era* — un numero grosso con un'età accanto si
capisce. Uno zero no: lo zero non sembra un numero, sembra lo stato del mondo.
Letto accanto a un ramo grigio e immobile, dice «niente» con più forza di quanta
ne abbia la riga piccola che lo smentisce.

Quindi non è la fascia da rifare. È lo **zero** che non va mostrato.

## Obiettivo

Oltre una certa età, un valore **pari a zero** diventa `—`, con scritto che non
si legge da quanto. I valori **diversi da zero** restano, con la loro età come
oggi: quelli si leggono già per quel che sono.

## Non obiettivi

- **Non si nasconde un valore conosciuto.** Solo gli zeri, solo oltre l'età.
- **Non si tocca `FERMA_DOPO_MINUTI`** (mezz'ora), che ferma le *animazioni*.
  Quella soglia riguarda il movimento; questa riguarda il numero, ed è molto
  più corta — la Bluetti si legge una volta al minuto (`RESPIRO`), quindi uno
  zero di dieci minuti ha già saltato dieci letture.
- **Non si tocca il cloud né il rinnovo.** Funzionano: hanno insistito, hanno
  rinnovato, e sono tornati da soli. Il difetto è come si mostra l'attesa.
- **Non si tocca la scatoletta.** Le Ective arrivano ogni due minuti e questo
  problema non l'hanno.

## Anti obiettivo

Una pagina che dice `—` dove ha un dato buono. Sarebbe il difetto opposto, e
questo progetto ha già pagato per quello: far sparire un riquadro invece di
dire cosa manca insegna a non guardarlo.

## Approcci

1. **Oltre l'età, lo zero diventa `—`.** **Scelto.** Una regola sola, in un
   posto solo, nella lingua che la pagina già parla. Non aggiunge concetti: usa
   la distinzione fra `—` e `0` che c'è da sempre.
2. Nascondere l'intera figura quando la lettura è vecchia. Scartato: è
   l'anti obiettivo. Una scheda che sparisce non dice niente.
3. Lasciare tutto e rendere la fascia più grossa. Scartato: è già stata
   spostata una volta, il 19/11, dalla riga sotto il quadrante a fianco del
   numero. Ha perso di nuovo. Il problema non è la sua dimensione.

## Le decisioni che contano

- **La regola sta dove sta il dato**, cioè nel modulo che prepara i numeri della
  Bluetti, e non in `app.js`: lì non girano prove, e questa è esattamente la
  logica che va tenuta ferma. Vale per tutti e quattro i numeri —
  fotovoltaico, rete, uscita 220, uscita 12 V — e per quel che ne deriva.
- **Il ramo segue il numero.** La figura disegna già tre stati: attivo
  (colorato, animato), spento (pieno, attenuato), **ignoto** (punteggiato, più
  trasparente, senza numero). Un ramo il cui valore è diventato `—` prende lo
  stato **ignoto**, che c'è già. Nessun disegno nuovo: quello esistente dice
  già la cosa giusta, semplicemente non veniva usato in questo caso.
- **L'età è una scelta di disegno**, scritta come costante con il suo perché, e
  legata al ritmo di lettura e non a un numero tondo: una lettura al minuto,
  quindi lo zero si tace dopo una manciata di letture perse — abbastanza da
  non lampeggiare per un giro saltato, abbastanza poco da non raccontare per
  venti minuti che il 220 è chiuso mentre è aperto.
- **Si dice perché.** Accanto al `—`, non «non so» ma il fatto: non si legge da
  N minuti. È la stessa onestà di `bluettiNonConfrontabile`, che già oggi
  tace i conti che mescolerebbero la Bluetti vecchia con le Ective fresche.
  Qui la stessa regola scende dal confronto al singolo numero.

## Le prove

- uno zero fresco resta **zero**, e il ramo resta spento (non ignoto);
- uno zero oltre l'età diventa **`—`**, e il ramo diventa **ignoto**;
- un valore diverso da zero oltre l'età **resta**, col suo numero e la sua età:
  è il non obiettivo, e va pinnato perché non si perda strada facendo;
- il caso vero del 21/11: uscita 220 a zero da venticinque minuti → `—`, e la
  figura non afferma che non esce niente;
- quando la lettura torna fresca, i numeri tornano **nello stesso giro**.

## Cosa resta al costruttore

Il valore dell'età e la parola del messaggio. E se la regola valga anche per la
percentuale di carica: uno zero di carica non è un caso reale sulla Bluetti, e
una regola applicata dove non serve è solo un posto in più dove sbagliare.
