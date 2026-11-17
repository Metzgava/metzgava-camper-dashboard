"""Le prove di `prepara-scheda.sh`: che sulla scheda ci sia TUTTO.

Questa prova nasce da un guasto trovato per caso. Lo script copiava
`agente.py`, `installa.sh` e `config.json` — e basta. Ma `agente.py` importa
`blink`, e `blink.py` non era fra i copiati: la scatoletta sarebbe partita e
avrebbe perso le telecamere al primo giro, in camper, con la scheda gia'
infilata.

E' il tipo di guasto che non si vede leggendo: nessun file e' sbagliato,
manca. Da qui una prova che non guarda il contenuto ma l'elenco.
"""
import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path

QUI = Path(__file__).resolve().parent
SCATOLETTA = QUI.parent
SCRIPT = SCATOLETTA / "prepara-scheda.sh"

# Quel che la scatoletta ha bisogno di trovarsi in casa alla prima accensione.
# Chi aggiunge un modulo nuovo e si dimentica di copiarlo, lo scopre qui.
SERVONO = [
    "agente.py",        # il giro
    "blink.py",         # le telecamere: `agente.py` lo importa
    "blink-accedi.py",  # l'accesso una volta sola, si lancia a mano
    "aggiungi-rete.sh", # la seconda rete WiFi
    "installa.sh",      # il servizio di sistema
    "config.json",      # la configurazione
]


class ProveScheda(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.scheda = Path(self.tmp.name) / "bootfs"
        self.scheda.mkdir()
        (self.scheda / "config.txt").write_text("# finta partizione di avvio\n")
        self.config = Path(self.tmp.name) / "config.json"
        self.config.write_text(json.dumps({
            "server": "https://esempio.invalido", "chiave": "finta-non-vera",
            "nome": "prova",
        }))

    def tearDown(self):
        self.tmp.cleanup()

    def lancia(self):
        amb = dict(os.environ)
        amb["SCHEDA_DIR"] = str(self.scheda)
        return subprocess.run(["bash", str(SCRIPT), str(self.config)],
                              capture_output=True, text=True, env=amb, timeout=60)

    def test_sulla_scheda_c_e_tutto_quel_che_serve(self):
        r = self.lancia()
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        dentro = self.scheda / "scatoletta"
        mancano = [n for n in SERVONO if not (dentro / n).exists()]
        self.assertEqual(mancano, [], f"mancano dalla scheda: {mancano}")

    def test_la_nota_con_la_riga_da_incollare(self):
        self.lancia()
        nota = self.scheda / "scatoletta" / "COME-SI-FINISCE.txt"
        self.assertTrue(nota.exists())
        self.assertIn("installa.sh", nota.read_text())

    def test_senza_chiave_non_scrive_niente(self):
        self.config.write_text(json.dumps({"chiave": "METTI-QUI-LA-CHIAVE"}))
        r = self.lancia()
        self.assertNotEqual(r.returncode, 0)
        self.assertFalse((self.scheda / "scatoletta" / "agente.py").exists())


if __name__ == "__main__":
    unittest.main()
