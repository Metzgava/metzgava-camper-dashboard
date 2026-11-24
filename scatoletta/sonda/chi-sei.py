# I byte grezzi di un apparecchio, cosi' come arrivano.
#
# Serve quando un numero decodificato non torna: prima di cercare dove sta la
# sonda, si guarda se quella sonda e' una sonda. Un annuncio di un apparecchio
# qualunque, letto con la chiave sbagliata, da' un numero plausibile — ed e'
# il tipo di errore peggiore, perche' rassicura.
import asyncio, sys, os
sys.path.insert(0, os.path.expanduser("~/scatoletta"))
from agente import BTHOME, ATC, bthome_leggi, atc_leggi

CERCATO = (sys.argv[1] if len(sys.argv) > 1 else "").upper()
SECONDI = int(sys.argv[2]) if len(sys.argv) > 2 else 30
visti = []

def senti(d, dati):
    if CERCATO and d.address.upper() != CERCATO:
        return
    visti.append({
        "nome": d.name, "forza": getattr(dati, "rssi", None),
        "servizi": {k: bytes(v).hex() for k, v in (dati.service_data or {}).items()},
        "costruttori": {k: bytes(v).hex() for k, v in (dati.manufacturer_data or {}).items()},
        "uuid_annunciati": list(dati.service_uuids or []),
        "potenza_dichiarata": getattr(dati, "tx_power", None),
    })

async def main():
    from bleak import BleakScanner
    s = BleakScanner(detection_callback=senti)
    await s.start(); await asyncio.sleep(SECONDI); await s.stop()
    print(f"{len(visti)} annunci in {SECONDI}s da {CERCATO or 'chiunque'}\n")
    if not visti:
        return
    print("nome:", repr(visti[0]["nome"]))
    print("uuid annunciati:", visti[0]["uuid_annunciati"])
    print("tx power dichiarata:", visti[0]["potenza_dichiarata"])
    print("\n--- i primi sei annunci, byte per byte ---")
    for v in visti[:6]:
        print(f"forza {v['forza']} dBm")
        for k, h in v["servizi"].items():
            quale = "BTHOME" if k == BTHOME else ("ATC" if k == ATC else k)
            print(f"  servizio {quale}: {h}  ({len(h)//2} byte)")
            g = bytes.fromhex(h)
            print(f"     letto come bthome: {bthome_leggi(g)}")
            print(f"     letto come atc   : {atc_leggi(g)}")
        for k, h in v["costruttori"].items():
            print(f"  costruttore {k} (0x{k:04x}): {h}")
    print("\n--- quante temperature diverse, e quali ---")
    from collections import Counter
    c = Counter()
    for v in visti:
        for k, h in v["servizi"].items():
            g = bytes.fromhex(h)
            l = (bthome_leggi(g) if k == BTHOME else atc_leggi(g) if k == ATC else None) or {}
            if "temperatura" in l:
                c[(l["temperatura"], l.get("umidita"))] += 1
    for (t, u), n in c.most_common(12):
        print(f"  {t}°  umido {u}  x{n}")

asyncio.run(main())
