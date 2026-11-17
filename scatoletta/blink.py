"""Le webcam Blink, lette dalla scatoletta.

Blink e' solo cloud: non c'e' niente da interrogare sulla rete del camper. Si
potrebbe quindi leggerlo dal server, e all'inizio era quel che il disegno
diceva — ma Blink ha **ritirato** l'accesso con utente e password (sondato il
17/11/2026: `grant_type=password` risponde `unsupported_grant_type`), e quel
che resta e' un flusso OAuth che per entrare scarica la pagina HTML di accesso
e ne estrae un token CSRF. Si rompe il giorno che Blink la ridisegna, e
l'hanno appena cambiata.

Quindi si passa da `blinkpy`, che e' mantenuto, e gira qui sulla scatoletta
perche' qui c'e' Python. Due conseguenze buone: quando Blink cambia qualcosa
basta un `pip install -U blinkpy`, e la password del proprietario non arriva
mai al server.

**`blinkpy` non si importa in cima a questo file.** Si importa dentro la
funzione che lo usa, per due motivi: queste prove girano sul Mac mentre la
scatoletta e' ancora in viaggio, e il modulo deve caricarsi anche su una
scheda appena preparata dove `pip install` non e' ancora passato.
"""
from __future__ import annotations

import datetime
import json
import logging
import os
from pathlib import Path

log = logging.getLogger("blink")

# Sette giorni. Non e' un numero scelto per comodita': le telecamere sono a
# batteria, e ogni interrogazione costa carica. Una volta la settimana e' il
# ritmo che serve per accorgersi che una batteria sta finendo, prima che
# finisca.
GIORNI = 7


def serve_lettura(ultima: datetime.datetime | None,
                  ora: datetime.datetime,
                  giorni: int = GIORNI) -> bool:
    """Se e' ora di chiedere a Blink.

    Mai letto vuol dire adesso: la prima volta si legge subito, cosi' il
    proprietario vede qualcosa senza aspettare una settimana.
    """
    if ultima is None:
        return True
    return (ora - ultima) >= datetime.timedelta(days=giorni)


def _numero(v):
    """Un numero, o None. Un campo assente non diventa zero.

    Vale per le telecamere alimentate a filo, che non hanno batteria: mostrare
    0,00 V farebbe credere a una batteria morta invece di nessuna batteria.
    """
    if v is None:
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def pulisci_telecamera(c: dict) -> dict:
    """Dagli attributi di una telecamera `blinkpy` ai nostri nomi e unita'.

    Due conversioni che `blinkpy` lascia nelle unita' di Blink:
    `battery_voltage` e' in **centesimi di volt** (165 = 1,65 V), e
    `temperature` e' in **Fahrenheit**.
    """
    volt = _numero(c.get("battery_voltage"))
    gradi = _numero(c.get("temperature"))
    return {
        "id": c.get("camera_id"),
        "nome": c.get("name"),
        "batteria": c.get("battery"),
        "volt": None if volt is None else round(volt / 100, 2),
        "segnale": c.get("wifi_strength"),
        "temperatura_c": None if gradi is None else round((gradi - 32) / 9.0 * 5.0, 1),
    }


def in_forma_ingresso(telecamere: list[dict]) -> list[dict]:
    """La lista `apparecchi` per `POST /api/ingresso`.

    Due scelte che contano.

    La potenza del segnale va in `dati["segnale"]` e **non** in
    `dati["rssi"]`: la pagina ha una scheda del segnale che pesca ogni
    istantanea con `dati.rssi`, ed e' per gli apparecchi del camper. Ci
    finirebbero dentro anche le telecamere, mescolate a cose di natura
    diversa. Nelle `misure` invece `rssi` va benissimo, perche' quelle sono
    storia e non pagina.

    E in `misure` entra **solo** quel che c'e'. Il server scarta le misure
    fuori scala, ma uno zero inventato e' dentro scala: finirebbe in archivio
    e sporcherebbe la storia per sempre.
    """
    fuori = []
    for t in telecamere:
        misure = {}
        if t["volt"] is not None:
            misure["volt"] = t["volt"]
        if t["segnale"] is not None:
            misure["rssi"] = t["segnale"]
        if t["temperatura_c"] is not None:
            misure["temperatura"] = t["temperatura_c"]
        fuori.append({
            "id": f"blink-{t['id']}",
            "nome": t["nome"],
            "tipo": "telecamera",
            "dati": {
                "tipo": "telecamera",
                "batteria": t["batteria"],
                "volt": t["volt"],
                "segnale": t["segnale"],
                "temperatura": t["temperatura_c"],
            },
            "misure": misure,
        })
    return fuori


# ---------------------------------------------------------------------------
# Il ritmo, in un file
# ---------------------------------------------------------------------------
#
# La data dell'ultima lettura sta su disco e non in memoria, per una ragione
# pratica: la scatoletta si riavvia — manca la corrente, si riaggiorna, si
# riparte dopo una modifica — e un ritmo tenuto in memoria ricominciherebbe
# da capo ogni volta, interrogando le telecamere a ogni riavvio. Che e'
# esattamente quel che si sta cercando di evitare.

QUI = Path(__file__).resolve().parent


def _percorso(dato, predefinito: str) -> Path:
    p = Path(dato or predefinito)
    return p if p.is_absolute() else QUI / p


def quando_ultima(percorso) -> datetime.datetime | None:
    """La data dell'ultima lettura, o None se non c'e' o non si capisce.

    Un file illeggibile vale come «mai letto»: si rilegge una volta di troppo,
    che costa un po' di batteria, invece di non rileggere mai piu'.
    """
    try:
        testo = Path(percorso).read_text().strip()
    except (OSError, ValueError):
        # ValueError prende anche UnicodeDecodeError: un file rovinato con
        # byte binari non e' un errore di sistema, e sfuggiva al primo except.
        return None
    try:
        d = datetime.datetime.fromisoformat(testo.replace("Z", "+00:00"))
    except ValueError:
        log.warning("la data in %s non si capisce: faccio come se non avessi mai letto", percorso)
        return None
    return d if d.tzinfo else d.replace(tzinfo=datetime.timezone.utc)


def segna_lettura(percorso, ora: datetime.datetime) -> None:
    p = Path(percorso)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(ora.isoformat())


# Le chiavi che NON vanno su disco.
#
# `Auth.login_attributes` di blinkpy restituisce `self.data` **in persona** —
# lo stesso dizionario che gli si passa, con dentro utente e password, piu' i
# campi del gettone. Non una copia filtrata. E `blink.save()` lo serializza
# tutto, con `indent=4`, senza guardarci dentro.
#
# Quindi `blink.save()` non si chiama: il file lo si scrive qui, togliendo
# queste chiavi e mettendo i permessi dal primo byte invece che dopo.
#
# La conseguenza e' una scelta, non un incidente: senza la password nel file,
# il giorno che il gettone muore si rilancia `blink-accedi.py`. Era esattamente
# quel che il disegno voleva — «quel che resta e' il gettone».
FUORI_DAL_FILE = ("username", "password", "email")


def salva_gettone(percorso, attributi: dict) -> None:
    """Scrive il gettone su disco senza le credenziali, leggibile solo da chi lo scrive."""
    dati = {k: v for k, v in attributi.items() if k not in FUORI_DAL_FILE}
    p = Path(percorso)
    p.parent.mkdir(parents=True, exist_ok=True)
    # os.open con 0o600: il file nasce gia' riservato. Un chmod dopo la
    # scrittura lascia una finestra in cui sta li' coi permessi della umask.
    with os.fdopen(os.open(p, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), "w") as f:
        json.dump(dati, f, indent=2)


async def _blink_vero(b: dict, sessione):
    """Il `blinkpy` vero, costruito dal gettone salvato alla preparazione.

    Questo e' il solo punto che importa `blinkpy`, e il solo che non ha prove:
    si verifica al primo giro sulla scatoletta. Il modello d'uso e' quello
    della documentazione di blinkpy (sezione «Loading credentials»).
    """
    from blinkpy.auth import Auth
    from blinkpy.blinkpy import Blink
    from blinkpy.helpers.util import json_load

    segreti = _percorso(b.get("segreti"), "segreti/blink.json")
    # La STESSA sessione a tutti e due. `Blink(session=...)` se ne costruisce
    # un `Auth` suo con dentro quella sessione; la riga dopo lo sostituisce, e
    # se il nuovo `Auth` non la riceve se ne fa una propria. Risultato: due
    # sessioni, una delle quali nessuno chiude mai — un socket perso ogni
    # settimana, piu' «Unclosed client session» nel diario.
    blink = Blink(session=sessione)
    blink.auth = Auth(await json_load(str(segreti)), no_prompt=True, session=sessione)
    # `start()` NON solleva quando l'accesso fallisce: intercetta i suoi errori,
    # scrive «Cannot setup Blink platform.» e restituisce False. Ignorare quel
    # valore vuol dire proseguire con un oggetto senza telecamere, e sembrare
    # una lettura riuscita di zero telecamere.
    if not await blink.start():
        raise RuntimeError(
            "Blink non ha completato l'accesso: gettone scaduto, oppure "
            "il file dei segreti manca o non si legge. Rilancia blink-accedi.py.")
    return blink


async def leggi_blink(conf: dict, fabbrica=None, ora=None) -> list[dict]:
    """Gli `apparecchi` da mandare al server, o [] se non e' ora.

    Chi chiama non deve sapere niente del ritmo: chiama a ogni giro, e il piu'
    delle volte si sente rispondere una lista vuota.

    Un guasto **risale** a chi chiama, e la data non viene segnata: altrimenti
    un'intermittenza di dieci secondi costerebbe una settimana di silenzio.
    """
    b = (conf or {}).get("blink") or {}
    if not b.get("attivo"):
        return []

    ora = ora or datetime.datetime.now(datetime.timezone.utc)
    f_ultima = _percorso(b.get("ultima"), "segreti/blink-ultima.txt")
    # max(1, ...): con `giorni: 0` si interrogherebbero le telecamere a ogni
    # giro, cioe' ogni cinque minuti — il consumo che tutto questo esiste per
    # evitare. E `or GIORNI` perche' un `null` nella configurazione farebbe
    # cadere int() a ogni giro.
    giorni = max(1, int(b.get("giorni") or GIORNI))
    if not serve_lettura(quando_ultima(f_ultima), ora, giorni):
        return []

    # La sessione HTTP la apre e la chiude **chi chiama**: costruirla dentro
    # `_blink_vero` significava perderla se la costruzione stessa inciampava.
    sessione = None
    try:
        if fabbrica:
            oggetto = fabbrica()
            if hasattr(oggetto, "__await__"):
                oggetto = await oggetto
        else:
            from aiohttp import ClientSession
            sessione = ClientSession()
            oggetto = await _blink_vero(b, sessione)
        # Una chiamata di `refresh` per tutte le telecamere, dalla nostra
        # parte. Dalla loro non e' una sola richiesta: `SyncModule.refresh()`
        # interroga i sensori **telecamera per telecamera**, e per quelle a
        # batteria passa da `.../camera/<id>/signals`. Lo scriviamo perche' il
        # disegno affermava il contrario, e una volta la settimana il costo e'
        # accettabile — ma non e' vero che sia una richiesta sola.
        await oggetto.refresh(force=True)
        telecamere = [pulisci_telecamera(c.attributes) for c in oggetto.cameras.values()]
    finally:
        if sessione is not None:
            await sessione.close()

    # Zero telecamere **non** e' una lettura riuscita.
    #
    # E' il modo in cui blinkpy racconta un accesso fallito: `start()` torna
    # False, `cameras` resta vuoto, `refresh()` non solleva. Timbrare la data
    # qui vorrebbe dire spegnere le letture per sette giorni, e ritimbrare ogni
    # settimana senza guarire mai — proprio il guasto che questa funzione
    # dichiarava di evitare.
    if not telecamere:
        log.warning("Blink: nessuna telecamera nella risposta. Non segno la data: "
                    "riprovo al prossimo giro invece di aspettare una settimana.")
        return []

    apparecchi = in_forma_ingresso(telecamere)
    segna_lettura(f_ultima, ora)
    log.info("Blink: lette %d telecamere (%s)", len(apparecchi),
             ", ".join(a["nome"] or "senza nome" for a in apparecchi) or "nessuna")
    return apparecchi
