# Bussa ai blocchi che nella fotografia tacciono: 20..99, a pezzetti piccoli
# e con piu' pazienza. «Nessuna risposta» non e' «indirizzo inesistente»:
# potrebbe essere solo lentezza. Solo lettura.
import asyncio, os, struct, sys, time, logging
QUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, QUI)
logging.basicConfig(level=logging.WARNING)
from encryption import EncryptedConnection  # noqa: E402

SCRITTURA = "0000ff02-0000-1000-8000-00805f9b34fb"
NOTIFICHE = "0000ff01-0000-1000-8000-00805f9b34fb"
NOME = "EL300"
ATTESA = 4.0


def crc16(dati):
    crc = 0xFFFF
    for b in dati:
        crc ^= b
        for _ in range(8):
            crc = (crc >> 1) ^ 0xA001 if crc & 1 else crc >> 1
    return crc


def leggi(inizio, quanti, unita=1):
    corpo = bytes([unita, 3]) + struct.pack(">HH", inizio, quanti)
    c = crc16(corpo)
    return corpo + bytes([c & 0xFF, (c >> 8) & 0xFF])


def registri(risposta):
    if len(risposta) < 5 or risposta[1] != 3:
        return None
    n = risposta[2]
    corpo = risposta[3:3 + n]
    return [int.from_bytes(corpo[i:i + 2], "big") for i in range(0, len(corpo) - 1, 2)]


async def main():
    from bleak import BleakScanner, BleakClient
    trovato = None

    def senti(d, a):
        nonlocal trovato
        if (d.name or "").upper().startswith(NOME):
            trovato = d.address

    s = BleakScanner(detection_callback=senti)
    await s.start(); await asyncio.sleep(12); await s.stop()
    if not trovato:
        print("la Bluetti non si sente"); return

    print(f"=== bussata delle {time.strftime('%H:%M:%S')} — {trovato} ===")
    async with BleakClient(trovato, timeout=25) as cliente:
        risposte = []

        async def arrivato(p): risposte.append(bytes(p))
        async def scrivi(d): await cliente.write_gatt_char(SCRITTURA, d, response=False)
        conn = EncryptedConnection(arrivato, scrivi)
        await cliente.start_notify(
            NOTIFICHE, lambda _c, d: asyncio.create_task(conn.on_packet(bytearray(d))))
        await asyncio.wait_for(conn.wait_until_ready(), timeout=25)
        print("stretta di mano riuscita\n")

        for inizio in range(20, 100, 5):
            risposte.clear()
            await conn.write(leggi(inizio, 5))
            await asyncio.sleep(ATTESA)
            if not risposte:
                print(f"{inizio:>4}-{inizio+4}: muto")
                continue
            valori = registri(risposte[-1])
            if valori is None:
                print(f"{inizio:>4}-{inizio+4}: inesistente ({risposte[-1].hex()})")
                continue
            print(f"{inizio:>4}-{inizio+4}: " + "  ".join(
                f"[{inizio+k}]={v}" for k, v in enumerate(valori)))

asyncio.run(main())
