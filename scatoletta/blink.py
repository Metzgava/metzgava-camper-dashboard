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
import logging
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
