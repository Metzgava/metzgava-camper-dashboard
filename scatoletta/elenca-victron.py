#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Elenca le Victron che si sentono adesso. Una riga per apparecchio:

    indirizzo<TAB>nome

Lo usa `aggiungi-victron.sh` per far scegliere col numero invece di far
copiare a mano diciassette caratteri di indirizzo.

Si riconosce una Victron dall'identificativo di costruttore 0x02E1 nei suoi
annunci -- lo stesso che guarda l'agente. Non ci si collega a niente: si sta
solo in ascolto, come chi passa per strada.

Perche' un file a parte e non una riga dentro lo script: qui serve `bleak`, che
sta nell'ambiente a parte creato da `installa.sh`, e serve il Bluetooth, che su
un Mac non e' quello della scatoletta. Separandolo, le prove dello script
girano sul Mac con un elenco finto.
"""
import asyncio
import sys

VICTRON_ID = 0x02E1
SECONDI = 12


async def main():
    from bleak import BleakScanner

    visti = {}

    def senti(dispositivo, dati):
        if (dati.manufacturer_data or {}).get(VICTRON_ID):
            # Il primo nome sentito, non l'ultimo: certi annunci arrivano senza
            # nome, e sovrascrivere quello buono con il vuoto renderebbe
            # l'elenco illeggibile a caso.
            if dispositivo.address not in visti or not visti[dispositivo.address]:
                visti[dispositivo.address] = dispositivo.name or ""

    scanner = BleakScanner(detection_callback=senti)
    await scanner.start()
    await asyncio.sleep(SECONDI)
    await scanner.stop()

    for indirizzo, nome in sorted(visti.items(), key=lambda v: v[1] or v[0]):
        print(f"{indirizzo}\t{nome}")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except Exception as e:                            # noqa: BLE001
        # Un errore qui non deve sembrare «nessuna Victron sentita»: quello
        # manderebbe ad avvicinare il camper per un guasto della radio.
        print(f"elenca-victron: {e}", file=sys.stderr)
        sys.exit(1)
