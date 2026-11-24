# Chi sta mandando temperature, adesso, e quanto forte si sente.
#
# Serve a una domanda sola: quale termometro e' quale. Il nome non lo dice
# (sono tutti «ATC_xxxx»), e la temperatura da sola nemmeno — ma temperatura
# **piu' potenza del segnale** lo dice: i suoi sono dentro il camper e si
# sentono forte, quello del vicino arriva attraverso due pareti.
import asyncio, json, os, sys
sys.path.insert(0, os.path.expanduser("~/scatoletta"))
from agente import (BTHOME, ATC, SWITCHBOT_ID, SWITCHBOT_ID_VECCHIO,
                    SWITCHBOT_SRV, bthome_leggi, atc_leggi, switchbot_leggi)

SECONDI = int(sys.argv[1]) if len(sys.argv) > 1 else 30

with open(os.path.expanduser("~/scatoletta/config.json")) as f:
    noti = {k.lower(): v for k, v in (json.load(f).get("termometri") or {}).items()}

sentiti = {}

def senti(dispositivo, dati):
    servizi = dati.service_data or {}
    costruttori = dati.manufacturer_data or {}
    letto = None
    if BTHOME in servizi:
        letto = bthome_leggi(servizi[BTHOME])
    elif ATC in servizi:
        letto = atc_leggi(servizi[ATC])
    else:
        sb = costruttori.get(SWITCHBOT_ID) or costruttori.get(SWITCHBOT_ID_VECCHIO)
        if sb:
            letto = switchbot_leggi(sb, servizi.get(SWITCHBOT_SRV))
    if letto and "temperatura" in letto:
        vecchio = sentiti.get(dispositivo.address, {}).get("visto", 0)
        sentiti[dispositivo.address] = {
            "nome": dispositivo.name or "",
            "letto": letto,
            "forza": getattr(dati, "rssi", None),
            "visto": vecchio + 1,
        }

async def main():
    from bleak import BleakScanner
    scanner = BleakScanner(detection_callback=senti)
    await scanner.start()
    await asyncio.sleep(SECONDI)
    await scanner.stop()

    print(f"\n{SECONDI} secondi di ascolto, {len(sentiti)} termometri sentiti\n")
    righe = sorted(sentiti.items(), key=lambda kv: -(kv[1]["forza"] or -200))
    print(f"{'indirizzo':<20} {'come lo chiami':<16} {'gradi':>7} {'umido':>7} {'pila':>5} {'segnale':>8} {'annunci':>8}")
    for mac, v in righe:
        etichetta = noti.get(mac.lower(), "— NON IN ELENCO")
        l = v["letto"]
        u = l.get("umidita")
        p = l.get("pila")
        f = v["forza"]
        umido = f"{u:.0f}%" if u is not None else "—"
        pila = f"{p}%" if p is not None else "—"
        segnale = f"{f} dBm" if f is not None else "—"
        print(f"{mac:<20} {etichetta:<16} {l['temperatura']:>6.1f}° "
              f"{umido:>7} {pila:>5} {segnale:>8} {v['visto']:>8}")

asyncio.run(main())
