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

E non la scrive nemmeno questo programma. La chiede con `getpass`, che non la
mostra a schermo, la passa a `blinkpy` e la dimentica. Quel che finisce su
disco e' soltanto il gettone.
"""
import asyncio
import getpass
import json
import os
import sys
from pathlib import Path

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
        print("Manca blinkpy. Installalo e torna qui:")
        print("    pip3 install blinkpy")
        return 1

    segreti = dove_i_segreti()
    print(f"Il gettone finira' in {segreti}")
    print("La password non viene salvata da nessuna parte, e non si vede mentre la digiti.\n")

    email = input("Email dell'account Blink: ").strip()
    if not email:
        print("Senza email non si va avanti.")
        return 1
    segreta = getpass.getpass("Password (non si vedra'): ")
    if not segreta:
        print("Senza password non si va avanti.")
        return 1

    blink = Blink(session=ClientSession())
    blink.auth = Auth({"username": email, "password": segreta}, no_prompt=True)
    # Da qui in poi la password non serve piu' a questo programma: ce l'ha
    # `blinkpy`, che la manda a Blink e non la conserva.
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

        segreti.parent.mkdir(parents=True, exist_ok=True)
        await blink.save(str(segreti))
        # Il gettone e' una chiave: la si tiene leggibile solo da chi l'ha
        # scritta. Se il file e' su una scheda di memoria che gira per casa,
        # questo non salva niente — ma non costa niente.
        try:
            os.chmod(segreti, 0o600)
        except OSError:
            pass

        print(f"\nFatto. {len(nomi)} telecamere: {', '.join(nomi)}")
        print(f"Gettone salvato in {segreti}")
        print("\nUltimo passo: in config.json metti  \"blink\": { \"attivo\": true }")
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
        sessione = getattr(blink.auth, "session", None)
        if sessione is not None:
            await sessione.close()


if __name__ == "__main__":
    try:
        sys.exit(asyncio.run(accedi()))
    except KeyboardInterrupt:
        print("\nLasciato a meta': non e' stato salvato niente.")
        sys.exit(1)
