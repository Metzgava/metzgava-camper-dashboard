"""Le prove del lettore Blink.

Girano senza avere `blinkpy` installato: il modulo lo importa dentro la
funzione che ne ha bisogno, non in cima al file. Serve perche' queste prove
devono poter girare sul Mac mentre la scatoletta e' ancora in viaggio.
"""
import datetime
import re
import sys
import unittest
from pathlib import Path

QUI = Path(__file__).resolve().parent
sys.path.insert(0, str(QUI.parent))

from blink import serve_lettura, pulisci_telecamera, in_forma_ingresso  # noqa: E402

UNA = {"camera_id": 7, "name": "Ingresso", "battery": "ok",
       "battery_voltage": 165, "temperature": 68, "wifi_strength": -52}
ORA = datetime.datetime(2026, 11, 17, 9, 0, tzinfo=datetime.timezone.utc)


class ProveRitmo(unittest.TestCase):
    def test_mai_letto_vuol_dire_adesso(self):
        self.assertTrue(serve_lettura(None, ORA))

    def test_ieri_non_si_rilegge(self):
        self.assertFalse(serve_lettura(ORA - datetime.timedelta(days=1), ORA))

    def test_otto_giorni_si_rilegge(self):
        self.assertTrue(serve_lettura(ORA - datetime.timedelta(days=8), ORA))


class ProvePulizia(unittest.TestCase):
    def test_volt_in_centesimi_e_gradi_da_fahrenheit(self):
        self.assertEqual(pulisci_telecamera(UNA),
                         {"id": 7, "nome": "Ingresso", "batteria": "ok",
                          "volt": 1.65, "segnale": -52, "temperatura_c": 20.0})

    # Review Focus 2: una Mini alimentata a filo non ha batteria.
    def test_senza_batteria_non_diventa_zero(self):
        t = pulisci_telecamera({"camera_id": 8, "name": "Mini", "temperature": 68})
        self.assertIsNone(t["volt"])
        self.assertIsNone(t["batteria"])
        self.assertEqual(t["temperatura_c"], 20.0)


class ProveForma(unittest.TestCase):
    def test_il_pacco_ha_la_forma_che_ingresso_vuole(self):
        a = in_forma_ingresso([pulisci_telecamera(UNA)])
        self.assertEqual(len(a), 1)
        self.assertEqual(a[0]["id"], "blink-7")
        self.assertEqual(a[0]["nome"], "Ingresso")
        self.assertEqual(a[0]["dati"]["tipo"], "telecamera")
        self.assertEqual(a[0]["dati"]["segnale"], -52)
        # La scheda del segnale della pagina pesca ogni istantanea con
        # dati.rssi, ed e' per gli apparecchi del camper: le telecamere non ci
        # devono finire mescolate.
        self.assertNotIn("rssi", a[0]["dati"])
        self.assertEqual(a[0]["misure"], {"volt": 1.65, "rssi": -52, "temperatura": 20.0})

    def test_una_telecamera_senza_misure_non_manda_misure_finte(self):
        a = in_forma_ingresso([pulisci_telecamera({"camera_id": 8, "name": "Mini"})])
        self.assertEqual(a[0]["misure"], {})

    def test_nessuna_telecamera_nessun_apparecchio(self):
        self.assertEqual(in_forma_ingresso([]), [])



# ---------------------------------------------------------------------------
# La lettura vera, col ritmo che sopravvive al riavvio
# ---------------------------------------------------------------------------
import asyncio      # noqa: E402
import tempfile     # noqa: E402

from blink import quando_ultima, segna_lettura, leggi_blink  # noqa: E402

DUE = [dict(UNA), {"camera_id": 9, "name": "Garage", "battery": "low",
                   "battery_voltage": 140, "temperature": 50, "wifi_strength": -71}]


class FintaBlink:
    """Quel poco di `blinkpy` che il nostro codice usa: `.cameras` e `refresh()`."""

    def __init__(self, telecamere, spacca=False):
        self.cameras = {t["name"]: type("T", (), {"attributes": t})() for t in telecamere}
        self.spacca = spacca
        self.refresh_fatti = 0

    async def refresh(self, **_):
        self.refresh_fatti += 1
        if self.spacca:
            raise RuntimeError("Blink non risponde")


class ProveLettura(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.ultima = Path(self.tmp.name) / "blink-ultima.txt"

    def tearDown(self):
        self.tmp.cleanup()

    def conf(self, attivo=True):
        return {"blink": {"attivo": attivo, "giorni": 7,
                          "ultima": str(self.ultima),
                          "segreti": str(Path(self.tmp.name) / "blink.json")}}

    # Review Focus 3: la data sta in un file, non in memoria.
    def test_il_ritmo_sopravvive_al_riavvio(self):
        segna_lettura(self.ultima, ORA - datetime.timedelta(days=1))
        chiamate = []

        def fabbrica():
            chiamate.append(1)
            return FintaBlink(DUE)

        got = asyncio.run(leggi_blink(self.conf(), fabbrica=fabbrica, ora=ORA))
        self.assertEqual(got, [])
        self.assertEqual(chiamate, [], "non deve nemmeno costruire blinkpy")

    def test_quando_e_ora_legge_e_segna_la_data(self):
        self.assertIsNone(quando_ultima(self.ultima))
        finta = FintaBlink(DUE)
        got = asyncio.run(leggi_blink(self.conf(), fabbrica=lambda: finta, ora=ORA))
        self.assertEqual(len(got), 2)
        self.assertEqual({a["id"] for a in got}, {"blink-7", "blink-9"})
        self.assertEqual(finta.refresh_fatti, 1, "una sola interrogazione per tutte")
        self.assertEqual(quando_ultima(self.ultima), ORA)

    def test_una_data_illeggibile_vale_come_mai_letto(self):
        self.ultima.write_text("pasticcio")
        self.assertIsNone(quando_ultima(self.ultima))
        finta = FintaBlink(DUE)
        got = asyncio.run(leggi_blink(self.conf(), fabbrica=lambda: finta, ora=ORA))
        self.assertEqual(len(got), 2)

    def test_un_guasto_non_segna_la_data(self):
        # Se un guasto segnasse la data, salterebbe una settimana di letture:
        # il modo peggiore di gestire un errore passeggero.
        finta = FintaBlink(DUE, spacca=True)
        with self.assertRaises(RuntimeError):
            asyncio.run(leggi_blink(self.conf(), fabbrica=lambda: finta, ora=ORA))
        self.assertIsNone(quando_ultima(self.ultima))

    def test_spento_nella_configurazione_non_legge(self):
        chiamate = []
        got = asyncio.run(leggi_blink(self.conf(attivo=False),
                                      fabbrica=lambda: chiamate.append(1), ora=ORA))
        self.assertEqual(got, [])
        self.assertEqual(chiamate, [])

    def test_niente_blink_nella_configurazione_non_e_un_guasto(self):
        self.assertEqual(asyncio.run(leggi_blink({}, fabbrica=None, ora=ORA)), [])


# ---------------------------------------------------------------------------
# L'accesso una volta sola: la password non si scrive da nessuna parte
# ---------------------------------------------------------------------------
class ProvePassword(unittest.TestCase):
    """Review Focus 4.

    Una prova sul sorgente e' debole, e si sa: non dimostra la correttezza,
    impedisce la ricaduta. Quel che la dimostra e' leggere lo script, che
    resta corto per questo.

    Controlla la **variabile** che tiene la password, non la parola: la prima
    stesura cercava "password" e inciampava nella frase che dice all'utente
    che la password non viene salvata. Una prova che si fa ingannare da un
    commento non prova niente.
    """

    SEGRETO = "segreta"          # il nome della variabile in blink-accedi.py

    def setUp(self):
        self.righe = (QUI.parent / "blink-accedi.py").read_text().splitlines()

    def _righe_con(self, modello):
        rx = re.compile(modello)
        return [f"{n}: {r.strip()}" for n, r in enumerate(self.righe, 1) if rx.search(r)]

    def test_la_password_si_chiede_con_getpass(self):
        self.assertTrue(self._righe_con(r"getpass\.getpass\("),
                        "la password va chiesta con getpass, non con input()")
        self.assertEqual(self._righe_con(r"input\([^)]*[Pp]assword"), [],
                         "input() mostrerebbe la password a schermo")

    def test_la_variabile_della_password_non_si_stampa_ne_si_registra(self):
        colpevoli = self._righe_con(r"(print|log\.\w+)\([^)]*\b" + self.SEGRETO + r"\b")
        self.assertEqual(colpevoli, [], "la password finisce a schermo o nel log")

    def test_la_variabile_della_password_non_si_scrive_su_disco(self):
        colpevoli = self._righe_con(
            r"(write_text|write|json\.dump\w*|open\()[^\n]*\b" + self.SEGRETO + r"\b")
        self.assertEqual(colpevoli, [], "la password finisce su un file")

    def test_la_password_si_dimentica_appena_consegnata(self):
        self.assertTrue(self._righe_con(r"del " + self.SEGRETO + r"\b"),
                        "dopo averla data a blinkpy, la variabile va cancellata")

    def test_il_gettone_non_si_stampa(self):
        colpevoli = self._righe_con(r"print\([^)]*\bauth\.token\b|print\([^)]*\.token\b")
        self.assertEqual(colpevoli, [], "il gettone non va mostrato")


# ---------------------------------------------------------------------------
# Il giro dell'agente: Blink e' la terza sorgente, e non deve portarsi via le altre
# ---------------------------------------------------------------------------
class ProveGiro(unittest.IsolatedAsyncioTestCase):
    """Review Focus 1.

    Il Bluetooth e' la ragione per cui la scatoletta esiste: le batterie
    Ective, il solare, l'allarme. Blink e' un extra settimanale. Se un guasto
    di Blink facesse saltare il giro, un extra avrebbe portato via l'essenziale
    — e lo farebbe per una settimana intera senza che nessuno se ne accorga,
    perche' un giro che non manda niente non si vede.
    """

    async def test_un_guasto_blink_non_fa_perdere_le_letture_bluetooth(self):
        import agente

        spediti = []
        async def finto_bluetooth(conf):
            return [{"id": "NWJ-1", "nome": "Ective 1", "dati": {"carica": 61}, "misure": {"carica": 61}}]
        async def blink_che_spacca(conf, **k):
            raise RuntimeError("Blink non risponde")

        agente.giro_bluetooth = finto_bluetooth
        agente.giro_allarme = lambda conf: []
        agente.leggi_blink = blink_che_spacca
        agente.spedisci = lambda conf, pacco: (spediti.append(pacco), {"ok": True})[1]

        with self.assertLogs("scatoletta", level="ERROR") as registrato:
            await agente.un_giro({"nome": "prova"})

        self.assertEqual(len(spediti), 1, "il pacco deve partire comunque")
        nomi = [a["nome"] for a in spediti[0]["apparecchi"]]
        self.assertIn("Ective 1", nomi)
        self.assertTrue(any("Blink" in r for r in registrato.output),
                        f"l'errore Blink va scritto: {registrato.output}")

    async def test_le_telecamere_entrano_nel_pacco_insieme_alle_altre(self):
        import agente

        spediti = []
        async def finto_bluetooth(conf):
            return [{"id": "NWJ-1", "nome": "Ective 1", "dati": {}, "misure": {}}]
        async def blink_con_due(conf, **k):
            return in_forma_ingresso([pulisci_telecamera(t) for t in DUE])

        agente.giro_bluetooth = finto_bluetooth
        agente.giro_allarme = lambda conf: []
        agente.leggi_blink = blink_con_due
        agente.spedisci = lambda conf, pacco: (spediti.append(pacco), {"ok": True})[1]

        await agente.un_giro({"nome": "prova"})
        nomi = [a["nome"] for a in spediti[0]["apparecchi"]]
        self.assertEqual(nomi, ["Ective 1", "Ingresso", "Garage"])


if __name__ == "__main__":
    unittest.main()
