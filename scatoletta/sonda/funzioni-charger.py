# Quali domande sa rispondere il Charger 2 — tutte e quattro, non una sola.
#
# `fotografia-bluetti.py` chiede sempre e solo la **funzione 3**, i registri di
# mantenimento. E' quella giusta per le misure, e infatti ha identificato i
# registri della Bluetti. Ma un interruttore, in MODBUS, di solito non e' un
# registro: e' una **bobina**, che si legge con la funzione 1 e si scrive con
# la 5. Sono due spazi di indirizzi diversi: l'indirizzo 7 delle bobine non ha
# niente a che vedere con l'indirizzo 7 dei registri.
#
# Il 21/11/2026 il proprietario ha spento e riacceso il Charger mentre la
# scatoletta fotografava: centoventi registri, zero mossi. Prima di concludere
# che l'interruttore non si vede, va chiesto nelle altre tre lingue.
#
# Tutte e quattro le funzioni qui dentro sono **letture**. Non si scrive
# niente: scrivere a tentoni su un apparecchio da 700 W attaccato
# all'alternatore e' il posto dove uno sbaglio costa davvero qualcosa.
#
#   funzioni-charger.py            il Charger
#   funzioni-charger.py EL300      la Bluetti, per confronto
import asyncio, os, struct, sys, time, logging
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
logging.basicConfig(level=logging.WARNING)

from encryption import EncryptedConnection  # noqa: E402

SCRITTURA = "0000ff02-0000-1000-8000-00805f9b34fb"
NOTIFICHE = "0000ff01-0000-1000-8000-00805f9b34fb"
NOME = sys.argv[1].upper() if len(sys.argv) > 1 else "CHARGER"

# Le quattro domande che MODBUS sa fare, col nome di quel che tornano.
#   1  bobine            interruttori, leggibili e scrivibili
#   2  ingressi discreti interruttori di sola lettura
#   3  registri          i numeri che gia' leggiamo
#   4  registri in lettura   altri numeri, spazio separato
FUNZIONI = [
    (1, "bobine", 64, 160),
    (2, "ingressi discreti", 64, 160),
    (3, "registri", 20, 200),
    (4, "registri in lettura", 20, 200),
]

# Il codice di errore MODBUS, col suo significato. Finora lo strumento
# chiamava queste risposte «illeggibili»: non lo sono: sono l'apparecchio che
# risponde in modo regolare, e dice che quell'indirizzo non ce l'ha.
SCUSE = {1: "funzione non prevista", 2: "indirizzo inesistente",
         3: "valore non ammesso", 4: "guasto interno"}


def crc16(dati):
    crc = 0xFFFF
    for b in dati:
        crc ^= b
        for _ in range(8):
            crc = (crc >> 1) ^ 0xA001 if crc & 1 else crc >> 1
    return crc


def chiedi(funzione, inizio, quanti, unita=1):
    corpo = bytes([unita, funzione]) + struct.pack(">HH", inizio, quanti)
    c = crc16(corpo)
    return corpo + bytes([c & 0xFF, (c >> 8) & 0xFF])


def leggi_risposta(funzione, risposta):
    """(esito, valori). `esito` e' None quando la risposta e' buona."""
    if len(risposta) < 3:
        return "risposta troppo corta", None
    if risposta[1] == funzione | 0x80:
        return SCUSE.get(risposta[2], f"errore {risposta[2]}"), None
    if risposta[1] != funzione:
        return f"risponde alla funzione {risposta[1]}", None
    n = risposta[2]
    corpo = risposta[3:3 + n]
    if funzione in (1, 2):
        bit = []
        for byte in corpo:
            for k in range(8):
                bit.append((byte >> k) & 1)
        return None, bit
    return None, [int.from_bytes(corpo[i:i + 2], "big")
                  for i in range(0, len(corpo) - 1, 2)]


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
        print(f"{NOME} non si sente. Se hai l'app aperta, chiudila: "
              "al Bluetooth parla un cliente alla volta.")
        return

    print(f"=== {NOME} alle {time.strftime('%H:%M:%S')} — {trovato} ===\n")
    async with BleakClient(trovato, timeout=25) as cliente:
        risposte = []

        async def arrivato(p):
            risposte.append(bytes(p))

        async def scrivi(d):
            await cliente.write_gatt_char(SCRITTURA, d, response=False)

        conn = EncryptedConnection(arrivato, scrivi)
        await cliente.start_notify(
            NOTIFICHE, lambda _c, d: asyncio.create_task(conn.on_packet(bytearray(d))))
        await asyncio.wait_for(conn.wait_until_ready(), timeout=25)
        print("stretta di mano riuscita\n")

        for funzione, nome, blocco, fino in FUNZIONI:
            print(f"--- funzione {funzione}: {nome} ---")
            trovati = 0
            for inizio in range(0, fino, blocco):
                risposte.clear()
                await conn.write(chiedi(funzione, inizio, blocco))
                await asyncio.sleep(2.2)
                if not risposte:
                    print(f"{inizio:>4}: nessuna risposta")
                    continue
                scusa, valori = leggi_risposta(funzione, risposte[-1])
                if scusa:
                    print(f"{inizio:>4}: {scusa}")
                    continue
                trovati += len(valori)
                vivi = [(inizio + k, v) for k, v in enumerate(valori) if v]
                print(f"{inizio:>4}: {len(valori)} letti" +
                      ("  " + "  ".join(f"[{r}]={v}" for r, v in vivi) if vivi
                       else "  (tutti a zero)"))
            print(f"    {trovati} in tutto\n")

asyncio.run(main())
