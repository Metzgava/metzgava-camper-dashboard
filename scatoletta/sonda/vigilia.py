# La vigilia: chi si fa sentire in radio, a intervalli regolari, per un po'.
#
# Serve a una domanda sola: la Bluetti smette di annunciarsi mentre il Charger
# la carica? Se ricompare quando il motore si spegne, l'ipotesi e' confermata.
#
# **Solo ascolto.** Non si collega a niente, quindi non occupa posti e non puo'
# interrompere la carica. E' il contrario della sonda.
import asyncio
import time
from bleak import BleakScanner

INTERESSANTI = ("EL300", "CHARGER", "ORION", "SMARTSOLAR", "NWJ")
PASSO = 180        # secondi fra un ascolto e il successivo
ASCOLTO = 8        # quanto dura ogni ascolto
PER = 150          # quanti giri in tutto (circa sette ore e mezza)


async def giro():
    trovati = await BleakScanner.discover(timeout=ASCOLTO, return_adv=True)
    visti = {}
    for d, adv in trovati.values():
        nome = (d.name or "").upper()
        if any(nome.startswith(p) for p in INTERESSANTI):
            visti[d.name] = adv.rssi
    return visti


async def main():
    for _ in range(PER):
        quando = time.strftime("%H:%M:%S")
        try:
            visti = await giro()
        except Exception as e:                      # la radio puo' essere occupata
            print(f"{quando}  radio non disponibile: {type(e).__name__}", flush=True)
            await asyncio.sleep(PASSO)
            continue
        bluetti = next((n for n in visti if n.upper().startswith("EL300")), None)
        segno = f"BLUETTI {visti[bluetti]}" if bluetti else "bluetti ASSENTE"
        altri = "  ".join(f"{n.split()[0]}={v}" for n, v in sorted(visti.items())
                          if n != bluetti)
        print(f"{quando}  {segno:>18}   {altri}", flush=True)
        await asyncio.sleep(PASSO)


asyncio.run(main())
