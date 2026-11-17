#!/usr/bin/env python3
"""L'accesso a Blink, una volta sola, da lanciare a mano sulla scatoletta.

    python3 blink-accedi.py

Serve una volta e poi mai piu': quel che resta e' un gettone in
`segreti/blink.json`, e da li' in avanti il giro della scatoletta legge le
telecamere da se', una volta la settimana.

Perche' si fa qui e non dal server. Blink ha ritirato l'accesso con utente e
password (sondato il 17/11/2026), e quel che resta e' un flusso che per
entrare scarica la pagina HTML di accesso e ne estrae un token: lo fa
`blinkpy`, che e' mantenuto, e che gira qui perche' qui c'e' Python. La
conseguenza buona e' che **la password non arriva mai al server**: resta fra
le tue dita e Blink.

E su disco non ci finisce. La chiede con `getpass`, che non la mostra a
schermo, e quel che si scrive nel file e' soltanto il gettone.
 
Questo pero' va detto con precisione, perche' la prima stesura di questo
programma affermava il falso. `blink.save()` di blinkpy **salverebbe anche la
password**: la funzione che sembra dare «solo i dati del gettone»
(`Auth.login_attributes`) restituisce in realta' lo stesso dizionario che le
si e' passato, password compresa, e `save()` lo scrive tutto. Per questo qui
`save()` non si chiama: il file lo scrive `salva_gettone`, che filtra utente e
password e nasce con i permessi giusti.
 
Resta vero che per la durata di questo processo la password vive dentro
l'oggetto di blinkpy, in memoria. Finisce quando il programma esce — che e'
fra pochi secondi — e non viene scritta da nessuna parte.
"""
import asyncio
import getpass
import json
import os
import sys
from pathlib import Path

from blink import salva_gettone

QUI = Path(__file__).resolve().parent
CONFIG = Path(os.environ.get("AGENTE_CONFIG", QUI / "config.json"))


def dove_i_segreti() -> Path:
    """Dove va il gettone, secondo config.json; `segreti/blink.json` se muto."""
    dato = None
    if CONFIG.exists():
        try:
            dato = (json.loads(CONFIG.read_text()).get("blink") or {}).get("segreti")
        except (ValueError, OSError):
            dato = None
    p = Path(dato or "segreti/blink.json")
    return p if p.is_absolute() else QUI / p


async def accedi() -> int:
    try:
        from aiohttp import ClientSession
        from blinkpy.auth import Auth
        from blinkpy.blinkpy import Blink
    except ImportError:
        print("Manca blinkpy nell'ambiente della scatoletta. Installalo e torna qui:")
        print("    ambiente/bin/pip install blinkpy")
        print()
        print("Poi rilancia questo programma con lo stesso Python:")
        print("    ambiente/bin/python blink-accedi.py")
        return 1

    segreti = dove_i_segreti()
    print(f"Il gettone finira' in {segreti}")
    print("La password non viene scritta in nessun file, e non si vede mentre la digiti.\n")

    email = input("Email dell'account Blink: ").strip()
    if not email:
        print("Senza email non si va avanti.")
        return 1
    segreta = getpass.getpass("Password (non si vedra'): ")
    if not segreta:
        print("Senza password non si va avanti.")
        return 1

    sessione = ClientSession()
    blink = Blink(session=sessione)
    # La stessa sessione a tutti e due: `Blink(session=...)` se ne fa un `Auth`
    # suo, e se quello che lo sostituisce non la riceve se ne costruisce una
    # propria che nessuno chiude.
    blink.auth = Auth({"username": email, "password": segreta},
                      no_prompt=True, session=sessione)
    # Il nome locale si cancella, ma senza illusioni: la password resta dentro
    # `blink.auth.data` per tutta la vita di questo oggetto. E' il motivo per
    # cui il file lo scrive `salva_gettone` filtrandola, invece di `save()`.
    del segreta

    try:
        await blink.start()
        if getattr(blink.auth, "check_key_required", lambda: False)():
            print("\nBlink ha mandato un codice per email o per SMS.")
            codice = input("Scrivilo qui: ").strip()
            await blink.auth.send_auth_key(blink, codice)
            await blink.setup_post_verify()

        await blink.refresh(force=True)
        nomi = sorted(blink.cameras.keys())
        if not nomi:
            print("\nEntrato, ma su questo account non c'e' nessuna telecamera.")
            print("Controlla di aver usato l'account giusto.")
            return 1

        # NON `blink.save()`: vedi la spiegazione in cima. `salva_gettone`
        # filtra utente e password e crea il file gia' riservato.
        salva_gettone(segreti, blink.auth.login_attributes)

        print(f"\nFatto. {len(nomi)} telecamere: {', '.join(nomi)}")
        print(f"Gettone salvato in {segreti}")
        print("\nControlla pure il file: dentro c'e' il gettone, non la tua password.")
        print("Ultimo passo: in config.json metti  \"blink\": { \"attivo\": true }")
        print("Al primo giro dopo quello, le telecamere compaiono nella pagina.")
        return 0

    except Exception as e:                            # noqa: BLE001
        # Si dice che cosa non e' andato, senza ripetere niente di segreto:
        # il messaggio di blinkpy non contiene la password.
        print(f"\nNon sono riuscito a entrare: {e}")
        print("Se e' una questione di credenziali, riprova. Se insiste, controlla")
        print("che l'app di Blink sul telefono entri con le stesse.")
        return 1
    finally:
        await sessione.close()


if __name__ == "__main__":
    try:
        sys.exit(asyncio.run(accedi()))
    except KeyboardInterrupt:
        print("\nLasciato a meta': non e' stato salvato niente.")
        sys.exit(1)
