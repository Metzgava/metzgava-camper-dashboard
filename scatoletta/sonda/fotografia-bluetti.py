# Una fotografia dei registri della Bluetti, con l'ora esatta.
#
# Serve a identificare quale registro contiene cosa, confrontandola con i
# numeri che il cloud dichiara nello stesso istante. Solo lettura.
#
# Si lancia piu' volte, in condizioni diverse (220 accesa, 220 spenta, un
# carico attaccato): un registro che si muove insieme al valore del cloud e'
# identificato; uno che coincide una volta sola e' un caso.
import asyncio, json, os, struct, sys, time, logging
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
logging.basicConfig(level=logging.WARNING)

from encryption import EncryptedConnection  # noqa: E402

SCRITTURA = "0000ff02-0000-1000-8000-00805f9b34fb"
NOTIFICHE = "0000ff01-0000-1000-8000-00805f9b34fb"
NOME = "EL300"                 # il prefisso del nome Bluetooth dell'Elite 300
BLOCCO = 20                    # registri per richiesta
FINO_A = 220                   # fin dove leggere

# Si puo' puntare a un altro apparecchio dalla riga di comando:
#   fotografia-bluetti.py CHARGER        -> il caricatore
#   fotografia-bluetti.py CHARGER 400    -> e piu' lontano
if len(sys.argv) > 1:
    NOME = sys.argv[1].upper()
if len(sys.argv) > 2:
    FINO_A = int(sys.argv[2])


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
    """Dai byte della risposta MODBUS ai valori dei registri."""
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

    quando = time.strftime("%Y-%m-%d %H:%M:%S")
    print(f"=== fotografia delle {quando} — {trovato} ===")
    raccolto = {}

    async with BleakClient(trovato, timeout=25) as cliente:
        risposte = []
        async def arrivato(p): risposte.append(bytes(p))
        async def scrivi(d): await cliente.write_gatt_char(SCRITTURA, d, response=False)
        conn = EncryptedConnection(arrivato, scrivi)
        cliente_notifica = lambda _c, d: asyncio.create_task(conn.on_packet(bytearray(d)))
        await cliente.start_notify(NOTIFICHE, cliente_notifica)
        await asyncio.wait_for(conn.wait_until_ready(), timeout=25)
        print("stretta di mano riuscita\n")

        for inizio in range(0, FINO_A, BLOCCO):
            risposte.clear()
            await conn.write(leggi(inizio, BLOCCO))
            await asyncio.sleep(2.5)
            if not risposte:
                print(f"{inizio:>4}: nessuna risposta")
                continue
            valori = registri(risposte[-1])
            if valori is None:
                print(f"{inizio:>4}: risposta illeggibile {risposte[-1].hex()}")
                continue
            for k, v in enumerate(valori):
                raccolto[inizio + k] = v
            # Si stampano solo i registri non nulli: il resto e' rumore.
            vivi = [(inizio + k, v) for k, v in enumerate(valori) if v]
            if vivi:
                print(f"{inizio:>4}: " + "  ".join(f"[{r}]={v}" for r, v in vivi))

    # Accanto allo strumento, non in /tmp: un riavvio non deve portarsele via.
    cartella = os.path.join(os.path.dirname(os.path.abspath(__file__)), "foto")
    os.makedirs(cartella, exist_ok=True)
    nome_file = os.path.join(
        cartella, f"{NOME.lower()}-{time.strftime('%Y%m%d-%H%M%S')}.json")
    with open(nome_file, "w") as f:
        json.dump({"quando": quando, "apparecchio": NOME,
                   "indirizzo": trovato, "registri": raccolto}, f, indent=1)
    print(f"\nscritta in {nome_file}")
    print("Ora servono i numeri del cloud dello stesso minuto:")
    print("  carica %, entra W, esce W, 220 V W, 12 V W")

asyncio.run(main())
