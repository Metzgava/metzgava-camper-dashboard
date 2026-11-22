# Staccarsi quando il record c'e', non dopo venti secondi

**22/11/2026 — la scatoletta**

## Perche'

Il proprietario, guardando caricare le batterie: «si vede con ritardo rispetto
all'app Ective». Misurato da lui: **oltre quaranta secondi**.

La causa non e' la pagina — col «dal vivo» acceso si rifa' ogni due secondi e
mezzo — e non e' il passo svelto, che e' gia' a dieci secondi quando qualcuno
guarda. E' il giro lento, l'unico che legge le Ective: il giro svelto ascolta
solo chi **grida** (Victron, termometri), mentre le Ective vanno interrogate
una per una, con un collegamento Bluetooth.

E il collegamento faceva questo:

    await cliente.start_notify(FFE4, pezzo)
    await asyncio.sleep(conf.get("secondi_ective", 20))
    await cliente.stop_notify(FFE4)

**Venti secondi a prescindere.** Non finche' i dati arrivano: proprio venti
secondi. Per due batterie sono quaranta, piu' otto di ricerca -- quasi tutto il
giro.

La batteria pero' manda il suo record **in continuazione**, non una volta sola.
Oltre il primo record intero non c'e' niente da aspettare.

## Obiettivi

- Staccarsi dalla batteria **appena il record e' intero**.
- Tenere i venti secondi come **tetto**: una batteria muta ferma il giro li',
  come prima.
- Scrivere nel registro **quanto ci e' voluto davvero**, per ogni batteria.

## Non obiettivi

- **Cambiare il passo del giro lento.** Non serve: il giro si accorcia da se'.
- **Mettere le Ective nel giro svelto.** Resta da valutare dopo, coi numeri
  veri in mano -- un collegamento dentro un passo da dieci secondi e' quel che
  il disegno del «dal vivo» ha escluso apposta.
- **Pareggiare l'app Ective.** Quella parla alle batterie direttamente dal
  telefono; la nostra passa da una scatoletta che legge, impacchetta e manda a
  un server. Qualche secondo di scarto e' strutturale.

## Anti obiettivi

- **Restare attaccati piu' a lungo di quanto promesso.** La radio accesa costa
  corrente alla batteria servizi, e nessuno se ne accorgerebbe finche' il
  camper non resta al buio. Si sbaglia **verso il corto**.
- **Dare per record un flusso spezzato.** Mezzo record non e' un record: la
  prova che lo verifica (`ective_leggi`) e' la stessa di prima, chiamata piu'
  spesso.

## Quel che non si sa, e si va a misurare

Non si sa se il primo record che arriva sia **fresco** o uno tenuto in pancia
dalla batteria. Se fosse vecchio, staccarsi subito darebbe un numero piu'
rapido ma piu' stantio -- il peggio dei due mondi, perche' sembrerebbe
tempestivo.

Per questo la correzione **scrive nel registro quanto ci ha messo ogni
batteria**. Alla prima occasione si guardano quei numeri: se le letture
tornano in due o tre secondi e i valori seguono la carica, la cosa funziona.
Finora si ragionava su venti secondi scelti a naso quando il programma e' nato.

## Come si fa

`ascolta_ective(flusso, tetto_s)` assaggia il flusso ogni quarto di secondo,
chiede a `ective_leggi` se c'e' un record intero, e torna `(record, secondi)`
appena c'e' -- o `(None, tetto)` se non arriva. L'ultima attesa si accorcia per
non sforare il tetto.

Orologio e pausa si possono sostituire: una prova che dimostra «dura venti
secondi» non deve durare venti secondi.

## Cosa resta a chi costruisce

- Il valore della fetta (un quarto di secondo e' una scelta, non una misura).
- Se un giorno convenga portare le Ective nel giro svelto: dipende dai numeri
  che questa correzione comincia a raccogliere.
