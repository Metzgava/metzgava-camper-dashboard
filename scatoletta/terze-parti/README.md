# Codice di terzi

Quello che sta qui **non è nostro**. Non si modifica: se serve una modifica,
si avvolge da fuori, così l'aggiornamento resta una sostituzione e non una
riconciliazione.

## `encryption.py` — la cifratura V2 di Bluetti

| | |
|---|---|
| **da** | [`sq7lrx/bluetti-elite200v2-mqtt`](https://github.com/sq7lrx/bluetti-elite200v2-mqtt) |
| **percorso a monte** | `bluetti_mqtt/bluetooth/encryption.py` |
| **licenza** | MIT — testo in `LICENZA-bluetti-elite200v2-mqtt` |
| **preso il** | 28/11/2026, dal ramo `main` |
| **dimensione** | 16875 byte |
| **sha256** | `72509c96c3dfdd5cc6f63fbb9c4b28d0c2e1a867d0e3d795df7fac1802468f6c` |

Serve a parlare con la Bluetti Elite 300: la sua interfaccia Bluetooth è
cifrata, e questa è l'unica attuazione pubblica del saluto iniziale.

### Perché è qui, dopo essere stata fuori per scelta

Fino al 28/11/2026 questo file **non** stava nel repository, e la ragione
scritta nel README delle sonde era buona: «mettere il codice di altri dentro il
proprio repository è una scelta di licenza e di provenienza da fare con gli
occhi aperti, non un comodo». Si metteva a mano in `~/sonda/encryption.py`.

Quella scelta però riguardava una **sonda lanciata a mano**. Dal disegno del
28/11 (`docs/superpowers/specs/2026-11-28-bluetti-via-bluetooth-design.md`) lo
stesso file serve al **servizio che gira tutto il giorno**, e la posizione
cambia: un servizio che dipende da un file esistente solo a mano su una
macchina sola perde la sua funzione **in silenzio** su una scatoletta nuova, e
git non racconta che serviva.

Deciso dal proprietario il 28/11/2026, con questi fatti davanti: licenza MIT
(copiare è permesso tenendo la nota di licenza), progetto di una persona sola,
zero stelle, ultimo aggiornamento a monte settembre 2026.

### Cos'è stato guardato prima di metterla dentro

Riletto il 28/11/2026, riga per riga sulla superficie che conta:

- **non apre rete**: nessun `socket`, `urllib`, `requests`, `http`;
- **non lancia processi**: nessun `subprocess`, `os.system`, `popen`;
- **non scrive su disco** e non legge file: nessun `open`, nessun `pickle`;
- **non valuta codice**: nessun `eval`, `exec`, `compile`, `__import__`;
- **non legge l'ambiente**: nessun `getenv`, nessun `environ`.

Di `os` usa **una riga sola** — `os.urandom(4)` alla riga 131, per il vettore
di inizializzazione — che è esattamente il suo mestiere.

Dipende da `cryptography` (già nostra, la usiamo per le Victron) e da
`pyasn1`.

### Come si aggiorna

Si riscarica il file a monte, si rifà il confronto della superficie qui sopra,
si aggiornano dimensione e sha256 in questa tabella, e si riprova con una
fotografia vera. **Non si applica una modifica nostra**: non c'è nessuna
modifica nostra da conservare.

    curl -sS -o encryption.py \
      https://raw.githubusercontent.com/sq7lrx/bluetti-elite200v2-mqtt/main/bluetti_mqtt/bluetooth/encryption.py
    shasum -a 256 encryption.py
