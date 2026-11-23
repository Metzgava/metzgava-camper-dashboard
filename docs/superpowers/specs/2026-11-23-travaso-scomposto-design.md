# Il travaso, scomposto in tre

**23/11/2026 — Camper Servizi**

## Perche'

Il proprietario, guardando l'animazione: «se escono 447 W dalla Bluetti ne
entrano solo il 45%, cioe' 199». La domanda e' giusta e la figura non la
risponde: mostra quanto esce e quanto entra, e lascia il buco in mezzo senza
dire di cosa e' fatto.

Non e' un buco solo: sono **due** cose diverse sommate.

- **Quel che si disperde**, e che nessuno riavra': il caricabatterie scalda.
- **Quel che si consuma**, e che sta facendo il suo lavoro: il frigo, lo
  Starlink, le luci.

Chiamarle insieme «perdite» le farebbe sembrare tutte uno spreco.

## L'aritmetica, e una correzione

`uscita_ac_w` sono i watt **alla presa**, cioe' gia' dopo l'inverter: lo dice
`travasoInCorso`, che per risalire a quel che da' la batteria interna **divide**
per il rendimento dell'inverter. Quindi sul ramo che va alle Ective si applica
**solo** il rendimento del caricatore:

    447 W alla presa                     misurato
    × 0,875 (caricatore)  ->  391 W      arrivano al 12 V
    − 199 W nelle Ective                 misurato (netto)
    = 192 W consumi e altro              per differenza

I tre numeri sommano **esattamente** i 447 misurati: chi guarda puo'
controllare il conto a occhio, ed e' il motivo per cui si sceglie questa forma
invece di mettere in mezzo anche l'inverter.

La perdita dell'inverter esiste (circa 50 W, la Bluetti ne da' ~497 per
metterne 447 sulla presa) ma sta **a monte della presa**: e' roba del ramo
della Bluetti, non di questo. `travasoInCorso` la conta gia' in `persi_wh`.

## Obiettivi

- Sotto il ramo **«Dalla 220»**, quando c'e' un travaso in corso, tre voci:
  **dispersi** (♨️), **consumi e altro** (🏠), **nelle Ective** (🔋).
- Ognuna col suo bollino: `misurato`, `stima`, `per differenza`.
- I manometri delle Ective si chiamano **Ective 310** e **Ective 323**, dalle
  ultime tre cifre del numero di serie, invece di 1 e 2.

## Non obiettivi

- **Mostrarlo quando non c'e' un travaso riconosciuto.** Fuori di li' non si sa
  cosa alimenta la 220, e la scomposizione racconterebbe una catena che
  potrebbe non esistere. Scelta del proprietario, 23/11/2026.
- **Misurare il rendimento vero.** I due numeri sono di targa. Misurarli e'
  un altro lavoro, e la pagina non deve far credere che sia gia' stato fatto.

## Anti obiettivi

- **Chiamare «consumi» quel che e' una differenza.** Dentro ci finiscono i
  consumi a 12 V, ma anche qualunque altra cosa attaccata alla 220 in quel
  momento e l'eventuale rendimento peggiore del dichiarato. Si chiama
  **«consumi e altro»**, e porta il bollino `per differenza`.
- **Mostrare un numero negativo.** Se il rendimento reale e' peggiore di
  quello di targa, la sottrazione va sotto zero. «Consumi: −20 W» e'
  un'assurdita' che farebbe dubitare di tutto il resto della pagina: in quel
  caso non si mostra la scomposizione e si dice che il rendimento dichiarato
  non torna. **E' un'informazione, non un errore da nascondere.**
- **Far sembrare spreco il consumo.** I watt che vanno al frigo stanno
  lavorando. Solo i dispersi sono persi, e solo quelli portano il ♨️.

## Come si fa

Una funzione pura in `travaso.js`:

    scomposizione(uscitaW, nelleEctiveW, { caricatore = RENDIMENTO_CARICATORE })
      -> { dispersi, consumi, nelle_ective, torna }

`torna: false` quando la differenza e' negativa, e allora `consumi` e'
`null` — non zero, che direbbe «non si consuma niente».

Si attacca al ramo `rete` dentro `ramiDellaCarica`, solo quando il travaso e'
in corso. Il disegno la mostra sotto il ramo; senza, la figura resta quella di
oggi.

## Cosa resta a chi costruisce

- I simboli esatti e dove stanno nel disegno.
- Se la scomposizione vada anche nella riga dei conti, oltre che nella figura.
