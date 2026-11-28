# I collegamenti Bluetooth che restano appesi, e come riconoscerli.
#
# Prove: prove/test_collegamenti.py, che raccontano l'incidente per intero.
#
# In breve: `async with BleakClient(...)` chiude il collegamento quando il
# blocco finisce **e anche se dentro scoppia un errore**, ma non puo' fare
# niente contro un segnale che uccide il processo. I servizi della raccolta
# hanno `KillMode=control-group` e `KillSignal=15`, quindi un riavvio manda
# SIGTERM anche al python che sta fotografando, e quello muore senza chiudere.
#
# Il collegamento resta aperto dentro bluetoothd, **e niente lo pulisce mai
# piu'**: non c'e' nessuno a cui scada, nessun processo che lo possieda.
# L'apparecchio dall'altra parte, con un cliente attaccato, smette di
# annunciarsi a chiunque altro. Dal 21/11/2026 alle 11:01 al 28/11 mattina la
# Bluetti e' sembrata spenta per questo.
#
# **Quindi la cura non sta nel momento del collegamento, sta dopo.** Chi cerca
# un apparecchio e non lo sente deve chiedersi se e' lui a tenerlo occupato,
# prima di concludere che non c'e'.
#
# Si parla con bluetoothd attraverso i suoi comandi invece che via D-Bus:
# `hcitool con` e `bluetoothctl` sono due righe, non chiedono permessi
# speciali, e sono gli stessi comandi che si battono a mano per capire cosa
# sta succedendo. Le funzioni che **decidono** stanno separate da quelle che
# **eseguono**, cosi' si possono provare senza radio.

import re
import subprocess

# `hcitool con` stampa una riga per collegamento, cosi':
#
#     Connections:
#     	< LE 90:70:69:35:76:F2 handle 65 state 1 lm CENTRAL
#
# Si pretende un indirizzo intero di sei coppie: una riga storta o un «comando
# non trovato» non devono produrre un indirizzo da staccare. Staccare
# l'apparecchio sbagliato vorrebbe dire fare a un altro il danno che stiamo
# riparando.
_INDIRIZZO = re.compile(r"\b((?:[0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2})\b")

# `bluetoothctl info` stampa `Name:` e, subito sotto, `Alias:`. Serve il
# **nome**: l'alias lo puo' cambiare chiunque, mentre il prefisso che
# cerchiamo (`EL300`) sta nel nome che l'apparecchio dichiara. Ancorato a
# inizio riga per non pescare la riga sbagliata.
_NOME = re.compile(r"^\s*Name:\s*(.+?)\s*$", re.MULTILINE)


def indirizzi_collegati(testo):
    """Gli indirizzi che bluetoothd dice collegati, dall'uscita di `hcitool con`.

    Lista vuota quando non ce n'e' -- che e' il caso normale, ed e' il piu'
    importante: non deve inventarsi niente da staccare.
    """
    fuori = []
    for riga in str(testo or "").splitlines():
        trovato = _INDIRIZZO.search(riga)
        if trovato and trovato.group(1) not in fuori:
            fuori.append(trovato.group(1))
    return fuori


def nome_collegato(testo):
    """Il nome dichiarato, dall'uscita di `bluetoothctl info <indirizzo>`.

    `None` quando non c'e': un apparecchio senza nome esiste, e un `None` si
    distingue da una stringa vuota.

    **bluetoothd il nome lo sa anche mentre l'apparecchio non si annuncia**, ed
    e' questo che permette di riconoscere chi ci tiene occupati senza avere il
    suo indirizzo scritto da nessuna parte.
    """
    trovato = _NOME.search(str(testo or ""))
    return trovato.group(1) if trovato else None


def chi_tiene_occupato(prefisso, collegati, nome_di):
    """L'indirizzo, fra quelli collegati, dell'apparecchio che stiamo cercando.

    `nome_di` e' una funzione indirizzo -> nome (o `None`): si passa da fuori
    perche' chiedere il nome e' un comando, e qui si decide soltanto.

    `None` quando nessuno dei collegamenti e' suo -- e allora l'apparecchio
    tace per davvero, che e' la risposta onesta.

    **Un collegamento di cui non si sa il nome non si stacca per sospetto.**
    Potrebbe essere qualunque cosa, anche di un vicino.
    """
    cercato = str(prefisso or "").upper()
    if not cercato:
        return None
    for indirizzo in collegati or []:
        nome = nome_di(indirizzo)
        if nome and nome.upper().startswith(cercato):
            return indirizzo
    return None


# ----------------------------------------------------------------------------
# Le parti che eseguono
# ----------------------------------------------------------------------------
#
# `esegui` si passa da fuori nelle prove che ne hanno bisogno. Qui non si
# alza nessuna eccezione: se bluetoothd non risponde, la risposta e' «non lo
# so», e chi chiama si comporta come prima invece di fermarsi.

def _comando(argomenti, esegui=None):
    corri = esegui or (lambda a: subprocess.run(
        a, capture_output=True, text=True, timeout=15).stdout)
    try:
        return corri(argomenti)
    except Exception:                                 # noqa: BLE001
        return ""


def collegati_adesso(esegui=None):
    """Gli indirizzi collegati in questo momento, chiedendolo a bluetoothd."""
    return indirizzi_collegati(_comando(["hcitool", "con"], esegui))


def nome_di(indirizzo, esegui=None):
    """Il nome che bluetoothd conosce per quell'indirizzo, o `None`."""
    return nome_collegato(_comando(["bluetoothctl", "info", indirizzo], esegui))


def stacca(indirizzo, esegui=None):
    """Chiude il collegamento a quell'indirizzo. Torna se e' andata.

    Non serve `sudo`: e' lo stesso comando che si batte a mano.
    """
    uscita = _comando(["bluetoothctl", "disconnect", indirizzo], esegui)
    return "successful" in uscita.lower()


def libera(prefisso, esegui=None):
    """Se un apparecchio col nome che comincia per `prefisso` e' tenuto
    occupato da noi, lo libera. Torna l'indirizzo liberato, o `None`.

    E' la mossa da fare **dopo** che una ricerca non ha sentito niente, non
    prima: finche' l'apparecchio si annuncia non c'e' nulla da riparare.
    """
    quale = chi_tiene_occupato(prefisso, collegati_adesso(esegui),
                               lambda i: nome_di(i, esegui))
    if quale and stacca(quale, esegui):
        return quale
    return None
