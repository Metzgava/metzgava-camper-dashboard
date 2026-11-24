# La sonda: strumenti per leggere la Bluetti via Bluetooth

Strumenti **di indagine**, non parte della scatoletta che gira in servizio.
Si lanciano a mano quando serve una misura. Tutti **leggono e basta**: nessuno
scrive un comando, un interruttore o un parametro a nessun apparecchio.

Si copiano sulla scatoletta in `~/sonda` e si lanciano con l'interprete
dell'ambiente dell'agente:

```
~/scatoletta/ambiente/bin/python <strumento>.py
```

## Cosa fa ciascuno

| strumento | cosa fa | si collega? |
|---|---|---|
| `ascolta.py` | elenca chi si sente in radio e quanto forte | no |
| `vigilia.py` | come sopra, ma ogni tre minuti per ore, su file | no |
| `che-dicono.py` | i valori di chi grida i suoi dati (Victron, termometri) | no |
| `fotografia-bluetti.py` | legge i registri dell'Elite 300 e li salva con l'ora | **si** |
| `cerca-ingresso.py` | bussa a blocchi piccoli dove la fotografia tace | **si** |

Chi non si collega non occupa un posto Bluetooth e non puo' disturbare
niente — vedi il conflitto sui posti in
[`docs/bluetti-via-bluetooth.md`](../../docs/bluetti-via-bluetooth.md).

## La dipendenza che non sta qui: `encryption.py`

I due strumenti che si collegano hanno bisogno di `encryption.py`, la
cifratura V2 di Bluetti in Python puro. **Non e' nostro codice e non e' in
questo repository**: viene da
[`sq7lrx/bluetti-elite200v2-mqtt`](https://github.com/sq7lrx/bluetti-elite200v2-mqtt),
un progetto della comunita'.

Va messo accanto agli strumenti, in `~/sonda/encryption.py`. Prima di
eseguirlo e' stato letto: non apre rete, non lancia processi, non scrive su
disco. Dipende da `cryptography` (gia' presente, la usiamo per le Victron) e
da `pyasn1`.

Non e' stato copiato qui perche' mettere il codice di altri dentro il proprio
repository e' una scelta di licenza e di provenienza da fare con gli occhi
aperti, non un comodo.

## Le coppie di misura si prendono dal display

Per capire quale registro contiene cosa serve confrontarlo con quel che
l'apparecchio dichiara **nello stesso istante**. La fonte giusta e' il
**display della Bluetti**, non la sua app: il display non costa un posto
Bluetooth, l'app si — e l'app collegata ha fermato la carica.

## Chi sta parlando, e se sta misurando davvero

Due attrezzi nati il 24/11/2026, da una domanda semplice — «quale termometro è
quale?» — che ha scoperto un numero inventato.

- **`che-temperatura.py [secondi]`** ascolta e stampa ogni termometro che
  sente: indirizzo, come lo chiamiamo, gradi, umidità, pila, **potenza del
  segnale** e quanti annunci ha mandato. Il segnale è la colonna che risponde
  alla domanda: i tuoi sono dentro il camper e si sentono forte, quello del
  vicino arriva attraverso due pareti.
- **`chi-sei.py INDIRIZZO [secondi]`** stampa i byte grezzi di un apparecchio
  solo — dati di servizio, dati del costruttore, UUID, potenza — e prova a
  leggerli con tutti i decodificatori che abbiamo.

Il secondo si usa **prima** di cercare dove sta una sonda, quando il numero
non torna. Un annuncio qualunque letto con la chiave sbagliata dà un numero
plausibile, ed è il tipo di errore peggiore, perché rassicura: un Hub Mini
SwitchBot — un telecomando a infrarossi — si leggeva come −6,1 gradi in un
camper che non ha congelatori.
