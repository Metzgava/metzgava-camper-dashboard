# Chi si sente in radio, e quanto forte. Solo ascolto: non si collega a niente.
import asyncio
from bleak import BleakScanner


async def main():
    trovati = await BleakScanner.discover(timeout=14, return_adv=True)
    righe = []
    for d, adv in trovati.values():
        righe.append((adv.rssi if adv.rssi is not None else -200,
                      d.name or "(senza nome)"))
    for forza, nome in sorted(righe, reverse=True):
        print(f"{forza:>5} dBm  {nome}")


asyncio.run(main())
