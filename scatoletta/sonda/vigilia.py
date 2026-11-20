# La vigilia: un ascolto ogni tre minuti, su file, per ore.
#
# Risponde a due domande in una sola scansione:
#
# 1. **La Bluetti si annuncia?** Se smette mentre il Charger la carica e
#    ricompare quando la carica si ferma, i posti Bluetooth sono il problema.
#    Si cerca per indirizzo, perche' il nome compare solo negli annunci.
# 2. **Cosa fa l'alternatore?** L'Orion XS grida il suo stato, quindi in marcia
#    il ramo dell'alternatore si registra da se', senza chiedere niente a
#    nessuno.
#
# **Solo ascolto.** Non si collega a niente: non occupa posti Bluetooth e non
# puo' interrompere una carica. E' il contrario della fotografia.
import asyncio
import json
import os
import sys
import time

AGENTE = os.path.expanduser("~/scatoletta")
sys.path.insert(0, AGENTE)
os.environ.setdefault("AGENTE_CONFIG", os.path.join(AGENTE, "config.json"))

import agente  # noqa: E402

BLUETTI = "90:70:69:35:76:F2"      # l'Elite 300, radio Bluetooth
PASSO = 180
ASCOLTO = 10
PER = 160                          # circa otto ore


def riga_orion(pacco):
    d = pacco.get("dati") or {}
    return (f"orion {d.get('stato', '?')} "
            f"in {d.get('ingresso_volt', '?')}V/{d.get('ingresso_ampere', '?')}A "
            f"out {d.get('uscita_volt', '?')}V/{d.get('uscita_ampere', '?')}A")


def riga_solare(pacco):
    d = pacco.get("dati") or {}
    return f"solare {d.get('pannelli_w', '?')}W {d.get('stato', '?')}"


async def main():
    conf = json.loads(agente.CONFIG.read_text())
    for _ in range(PER):
        quando = time.strftime("%H:%M:%S")
        try:
            trovati, potenze = await agente.ascolta_annunci(conf, secondi=ASCOLTO)
        except Exception as e:
            print(f"{quando}  radio non disponibile: {type(e).__name__}", flush=True)
            await asyncio.sleep(PASSO)
            continue

        forti = {k.upper(): v for k, v in (potenze or {}).items()}
        b = forti.get(BLUETTI.upper())
        segno = f"BLUETTI {b}" if b is not None else "bluetti ASSENTE"

        pezzi = [segno]
        for pacco in trovati.values():
            nome = str(pacco.get("nome", ""))
            if nome.startswith("Orion"):
                pezzi.append(riga_orion(pacco))
            elif nome.startswith("SmartSolar"):
                pezzi.append(riga_solare(pacco))
        print(f"{quando}  " + "   ".join(pezzi), flush=True)
        await asyncio.sleep(PASSO)


asyncio.run(main())
