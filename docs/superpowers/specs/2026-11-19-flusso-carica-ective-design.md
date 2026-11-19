# Cosa carica le batterie: il disegno

**19/11/2026 — disegno corto, lavoro piccolo.**

## Intento

Il proprietario vuole vedere, aprendo l'app, **se l'Orion XS è acceso e sta
caricando le Ective, e se i pannelli stanno caricando e di quanto**, con
un'animazione che renda leggibile il funzionamento a colpo d'occhio.

Il perché, nelle sue parole: *«una animazione che agevoli la visione del
funzionamento»*. Non vuole un numero in più — i numeri ci sono già — vuole
**capire l'impianto guardandolo**.

## Quel che esiste già

Niente da calcolare. `src/lib/conti.js` produce a ogni apertura della pagina,
in `fonti_ective`:

| voce | com'è ottenuta |
|---|---|
| `sole_w` | potenza dello SmartSolar — **misurata** |
| `motore_w` | `uscita_volt × uscita_ampere` dell'Orion XS — **misurata** |
| `rete_w` | il totale meno gli altri due — **per differenza** |
| `valore` | la corrente che entra davvero nelle Ective — **misurata** |

`motore_w > 0` *è* la risposta a «l'Orion è acceso e carica», e `sole_w` *è*
«quanto danno i pannelli». La domanda è solo come disegnarli.

Oggi questi numeri compaiono come righe di testo nella sezione «Dalla Bluetti
alle Ective», che resta: contiene il discorso sul rendimento della catena, che
non c'entra con questa figura.

## Goal

- Si capisce **in un'occhiata** quali fonti stanno caricando e quanto pesa
  ciascuna.
- Si capisce **senza occhiata**, con la coda dell'occhio: il movimento dice
  «sta entrando corrente» anche a chi non legge i numeri.
- Un ramo fermo si vede fermo, non si confonde con uno lento.

## Non-goal

- Non è uno schema elettrico. Non ci sono fusibili, sezioni di cavo, né il
  verso vero dei collegamenti: è una figura di **flusso di energia**.
- Non mostra la Truma, il frigo, i consumi. Solo quel che **entra** nelle
  Ective.
- Non sostituisce i quadranti delle Ective né la sezione della Bluetti.

## Anti-goal

**Che la figura faccia sembrare misurato quel che è dedotto.** È il rischio
vero. Sole e alternatore si misurano; la parte dalla 220 si ottiene per
sottrazione, e il codice la marca «stima» spiegando che quei watt potrebbero
venire da una terza fonte che non vediamo. Un'animazione uniforme cancella
quella differenza: tre rami che scorrono uguali dicono «so tutto e tutto allo
stesso modo», e sarebbe falso.

Secondo anti-goal: **un'animazione che chieda attenzione.** L'app ha già la sua
misura — l'alone che respira a due secondi e mezzo, la lancetta che trema di
mezzo grado — e chi ha chiesto meno animazioni al sistema non le vede affatto.
Una figura che pulsa forte in una pagina così è fuori tono, e dopo due giorni
dà fastidio.

## Approcci considerati

1. **Uno schema dell'impianto** — una figura sola, tre fonti a sinistra, le
   Ective a destra, i rami che si animano quando portano corrente. *Scelto dal
   proprietario.* Le tre fonti alimentano le stesse batterie: la domanda vera è
   «cosa le sta caricando adesso», ed è una figura, non tre.
2. **Due spie, una per apparecchio** — un segno animato sul riquadro dello
   SmartSolar e su quello dell'Orion. Più piccolo da fare, più vicino a dove si
   guarda il singolo apparecchio, ma non fa vedere l'insieme né quanto pesa
   ciascuno sul totale. Scartato.
3. **Prima lo schema, poi le spie** — entrambe le viste, più lavoro. Scartato
   per ora; resta possibile dopo.

## Il disegno

**Dove.** Una sezione nuova, `Cosa carica le batterie`, subito **sotto** i due
quadranti delle Ective: si legge il livello, e appena sotto da dove arriva.

**La figura.** Un SVG nello stile dei quadranti esistenti: niente immagini,
niente librerie, colori dalle variabili del tema.

```
   ☀️  Sole        6 W  ──────────╮
                                   ├──▶  🔋 Ective      7 W
   🔁  Alternatore  0 W  ─ ─ ─ ─ ─╯
   🔌  Dalla 220    1 W  ·········╯   (stima)
```

- Tre nodi a sinistra, uno per fonte, ciascuno col suo nome e i suoi watt.
- Un nodo a destra: le Ective, col totale che entra.
- Un ramo per fonte, curvo, dal nodo al bus.

**Come si legge un ramo.**

| stato | come si vede |
|---|---|
| porta corrente | verde, **puntini che scorrono** verso le batterie; più spesso e più veloce quando i watt sono tanti |
| fermo (0 W) | sottile, colore del bordo, immobile |
| non si sa | sottile, tratteggiato, e al posto dei watt una lineetta |

Lo spessore va da 2 a 8 pixel e la velocità da 3 s a 0,8 s per giro, entrambi
in scala sui watt **rispetto al totale che entra**, non su una scala assoluta:
sei watt sotto la pioggia devono muoversi, se sono tutto quel che c'è.

**Il ramo dedotto.** Quello della 220 ha un tratteggio diverso dagli altri
anche quando è attivo — punti invece di linee — e porta accanto il bollino
«stima» che la pagina usa già altrove. Chi guarda vede subito che quei watt
sono di un'altra natura, senza dover leggere la nota.

**Quando non carica niente.** La figura non sparisce: resta grigia, immobile,
col totale a `0 W` e una riga che dice che nessuna fonte sta caricando. Sparire
direbbe «non lo so», che è un'altra cosa — la stessa regola della sezione
Temperature.

**Quando non si sa niente** (nessuna lettura delle Ective): la figura non si
disegna affatto e resta la spiegazione di cosa manca, come fa già `conti.js`
con i suoi `manca()`.

**Chi ha chiesto meno animazioni.** Sotto `prefers-reduced-motion: reduce` i
puntini non scorrono: il ramo attivo resta verde e pieno, con una freccia ferma
al centro. L'informazione non si perde, si perde solo il movimento — come già
fanno l'alone e la lancetta.

## Come si divide il lavoro

Il calcolo di «quali rami, quanto spessi, quanto veloci» **non sta nella
pagina**: sta in `src/lib/flusso.js`, è una funzione pura, e il server lo manda
già masticato dentro `/api/stato`. Due ragioni: in `public/app.js` non girano
prove, e questa è logica che va tenuta ferma — che un ramo a zero watt non si
animi, che il ramo dedotto resti marcato, che la scala non si rompa quando il
totale è zero.

La pagina riceve un elenco di rami e li disegna. Niente conti nel disegno.

## Prove

In `test/flusso.test.js`, sulla funzione pura:

- un ramo a zero watt non è attivo;
- un ramo attivo con pochi watt, se è l'unico, si muove comunque;
- il ramo dedotto resta marcato come tale anche quando porta più corrente di
  tutti;
- totale a zero: nessun ramo attivo e nessuna divisione per zero;
- un valore assente non diventa zero (prima regola del progetto);
- spessore e velocità restano dentro i limiti anche con numeri assurdi.

## Quel che resta al costruttore

La forma esatta delle curve, la spaziatura dei nodi, i numeri precisi del
tratteggio: dettagli di disegno, da scegliere guardando la pagina sul telefono.
