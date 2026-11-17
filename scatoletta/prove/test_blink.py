"""Le prove del lettore Blink.

Girano senza avere `blinkpy` installato: il modulo lo importa dentro la
funzione che ne ha bisogno, non in cima al file. Serve perche' queste prove
devono poter girare sul Mac mentre la scatoletta e' ancora in viaggio.
"""
import datetime
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


if __name__ == "__main__":
    unittest.main()
