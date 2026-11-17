"""Il termometro SwitchBot Outdoor Meter (WoSensorTHO, modello W3400010).

Il riferimento e' il campione che SwitchBot pubblica nella sua documentazione
(`devicetypes/meter.md`, sezione «Outdoor Temperature/Humidity Sensor»):

    Type 0xFF (costruttore): 6909 XXXXXXXXXXXX 36 03 02 96 37 00
    Type 0x16 (servizio):    3D FD 77 00 64

che vale 22,2 gradi, 55 % di umidita' e batteria al 100 %.

Una cosa che la documentazione nasconde: la sezione dell'Outdoor indicizza i
byte **contando anche i due byte dell'azienda** (6909), mentre bleak li
consegna gia' togliati. Levati quelli, gli offset sono gli stessi della
tabella generale dei Meter — quindi un decodificatore solo serve tutta la
famiglia, e la fama di «eccezione» riguarda solo i dati di servizio.
"""
import sys
import unittest
from pathlib import Path

QUI = Path(__file__).resolve().parent
sys.path.insert(0, str(QUI.parent))

from agente import switchbot_leggi  # noqa: E402

# Come lo consegna bleak: manufacturer_data[0x0969], senza i due byte azienda.
CAMPIONE = bytes.fromhex('aabbccddeeff' + '360302963700')
SERVIZIO = bytes.fromhex('770064')          # service_data[fd3d], senza l'UUID


class ProveSwitchBot(unittest.TestCase):
    def test_il_campione_della_documentazione(self):
        letto = switchbot_leggi(CAMPIONE, SERVIZIO)
        self.assertEqual(letto["temperatura"], 22.2)
        self.assertEqual(letto["umidita"], 55)
        self.assertEqual(letto["pila"], 100)

    def test_sotto_zero(self):
        # bit7 del byte 9 a zero vuol dire negativa: -5,3 gradi.
        d = bytearray(CAMPIONE)
        d[8], d[9] = 0x03, 0x05
        self.assertEqual(switchbot_leggi(bytes(d), SERVIZIO)["temperatura"], -5.3)

    def test_il_display_in_fahrenheit_non_sporca_l_umidita(self):
        # bit7 del byte 10 dice in che unita' il DISPLAY mostra i gradi: non
        # c'entra col valore, e se non lo si maschera l'umidita' diventa 183.
        d = bytearray(CAMPIONE)
        d[10] = 0x37 | 0x80
        self.assertEqual(switchbot_leggi(bytes(d), SERVIZIO)["umidita"], 55)

    def test_senza_i_dati_di_servizio_la_temperatura_si_legge_comunque(self):
        letto = switchbot_leggi(CAMPIONE, None)
        self.assertEqual(letto["temperatura"], 22.2)
        self.assertIsNone(letto.get("pila"))

    def test_un_pacchetto_corto_non_si_inventa(self):
        self.assertIsNone(switchbot_leggi(b'\x01\x02\x03', SERVIZIO))
        self.assertIsNone(switchbot_leggi(None, SERVIZIO))

    def test_la_batteria_si_maschera(self):
        # bit7 del byte 2 del servizio non e' carica: va tolto, o una batteria
        # al 100 % diventerebbe 228.
        self.assertEqual(switchbot_leggi(CAMPIONE, bytes.fromhex('7700e4'))["pila"], 100)


if __name__ == "__main__":
    unittest.main()
