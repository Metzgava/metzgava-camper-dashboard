# Cosa stanno dicendo gli apparecchi che gridano, adesso.
#
# Riusa `ascolta_annunci` dell'agente: solo ascolto, nessun collegamento,
# nessun posto Bluetooth occupato. Serve a vedere il ramo dell'alternatore
# mentre il camper cammina.
import asyncio
import json
import os
import sys

QUI = os.path.expanduser("~/scatoletta")
sys.path.insert(0, QUI)
os.environ.setdefault("AGENTE_CONFIG", os.path.join(QUI, "config.json"))

import agente  # noqa: E402


async def main():
    conf = json.loads(agente.CONFIG.read_text())
    trovati, potenze = await agente.ascolta_annunci(conf, secondi=12)
    for chiave, pacco in sorted(trovati.items(), key=lambda x: str(x[0])):
        print(json.dumps(pacco, ensure_ascii=False, sort_keys=True))
    print(f"\nforza del segnale: {json.dumps(potenze, ensure_ascii=False)}")


asyncio.run(main())
