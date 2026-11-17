"""Le prove di `aggiungi-rete.sh`: la seconda rete sulla scatoletta.

Il proprietario cambiera' portante — oggi il TP-Link `bergamobile`, domani
magari il WiFi di Starlink — e un tasto nell'app che cambia rete sarebbe una
trappola: il comando viaggia sulla rete che sta per spegnere, e se la nuova non
c'e' la scatoletta resta dove non la raggiungi piu'.

La via buona e' tenerne in memoria **due** e lasciare che NetworkManager
agganci quella che trova. Questo script le aggiunge, e queste prove fissano le
tre cose che devono essere vere:

- la password non passa mai dalla riga di comando (`ps` la vedrebbe);
- il file nasce leggibile solo da root;
- riaggiungere la stessa rete la **corregge**, non la duplica.

Girano sul Mac, senza NetworkManager: `nmcli` e' finto e si limita a scrivere
in un diario quel che gli viene chiesto.
"""
import os
import stat
import subprocess
import tempfile
import unittest
from pathlib import Path

QUI = Path(__file__).resolve().parent
SCRIPT = QUI.parent / "aggiungi-rete.sh"


def falso_nmcli(dove: Path) -> Path:
    """Un `nmcli` che non fa niente e scrive in `diario` quel che riceve."""
    cestino = dove / "bin"
    cestino.mkdir(parents=True, exist_ok=True)
    finto = cestino / "nmcli"
    finto.write_text(
        '#!/bin/bash\n'
        f'echo "$@" >> "{dove}/diario"\n'
        'exit 0\n'
    )
    finto.chmod(0o755)
    return cestino


def lancia(risposte: str, dove: Path):
    cestino = falso_nmcli(dove)
    nm = dove / "system-connections"
    nm.mkdir(parents=True, exist_ok=True)
    amb = dict(os.environ)
    amb["PATH"] = f"{cestino}:{amb['PATH']}"
    amb["NM_DIR"] = str(nm)
    amb["SUDO"] = ""          # nelle prove non si chiama sudo
    return subprocess.run(["bash", str(SCRIPT)], input=risposte, text=True,
                          capture_output=True, env=amb, timeout=30)


class ProveAggiungiRete(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dove = Path(self.tmp.name)
        self.nm = self.dove / "system-connections"

    def tearDown(self):
        self.tmp.cleanup()

    def test_scrive_il_file_con_nome_e_password(self):
        r = lancia("StarlinkCamper\nsegretissima\nn\n", self.dove)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        f = self.nm / "StarlinkCamper.nmconnection"
        self.assertTrue(f.exists(), f"manca {f}: {r.stdout}")
        testo = f.read_text()
        self.assertIn("ssid=StarlinkCamper", testo)
        self.assertIn("psk=segretissima", testo)
        self.assertIn("key-mgmt=wpa-psk", testo)

    def test_il_file_lo_legge_solo_root(self):
        lancia("StarlinkCamper\nsegretissima\nn\n", self.dove)
        f = self.nm / "StarlinkCamper.nmconnection"
        self.assertEqual(stat.S_IMODE(f.stat().st_mode), 0o600)

    def test_la_password_non_passa_dalla_riga_di_comando(self):
        # `ps` mostra gli argomenti dei processi: una password li' la vede
        # chiunque sia connesso alla scatoletta in quel momento.
        lancia("StarlinkCamper\nsegretissima\nn\n", self.dove)
        diario = (self.dove / "diario")
        testo = diario.read_text() if diario.exists() else ""
        self.assertNotIn("segretissima", testo)

    def test_dice_a_networkmanager_di_rileggere(self):
        lancia("StarlinkCamper\nsegretissima\nn\n", self.dove)
        self.assertIn("connection reload", (self.dove / "diario").read_text())

    def test_preferita_prende_la_priorita_piu_alta(self):
        lancia("StarlinkCamper\nsegretissima\ns\n", self.dove)
        testo = (self.nm / "StarlinkCamper.nmconnection").read_text()
        self.assertIn("autoconnect-priority=20", testo)

    def test_non_preferita_prende_la_priorita_bassa(self):
        lancia("StarlinkCamper\nsegretissima\nn\n", self.dove)
        testo = (self.nm / "StarlinkCamper.nmconnection").read_text()
        self.assertIn("autoconnect-priority=5", testo)

    def test_aggiungere_due_volte_corregge_e_non_duplica(self):
        # Le due password hanno almeno otto caratteri, come vuole WPA: con una
        # piu' corta lo script rifiuterebbe per un altro motivo e la prova non
        # direbbe niente sui duplicati.
        lancia("StarlinkCamper\nprimadituttonet\nn\n", self.dove)
        lancia("StarlinkCamper\nsecondadipoinet\nn\n", self.dove)
        file = sorted(self.nm.glob("*.nmconnection"))
        self.assertEqual(len(file), 1, f"duplicati: {file}")
        self.assertIn("psk=secondadipoinet", file[0].read_text())

    def test_nome_vuoto_non_scrive_niente(self):
        r = lancia("\n", self.dove)
        self.assertNotEqual(r.returncode, 0)
        self.assertEqual(list(self.nm.glob("*.nmconnection")), [])

    def test_password_vuota_non_scrive_niente(self):
        r = lancia("StarlinkCamper\n\n", self.dove)
        self.assertNotEqual(r.returncode, 0)
        self.assertEqual(list(self.nm.glob("*.nmconnection")), [])

    def test_password_troppo_corta_non_scrive_niente(self):
        # WPA vuole almeno otto caratteri: accettarne meno significa scrivere
        # un file che NetworkManager rifiutera', e scoprirlo in camper.
        r = lancia("StarlinkCamper\ncorta\n", self.dove)
        self.assertNotEqual(r.returncode, 0)
        self.assertEqual(list(self.nm.glob("*.nmconnection")), [])

    def test_la_password_non_finisce_a_schermo(self):
        r = lancia("StarlinkCamper\nsegretissima\nn\n", self.dove)
        self.assertNotIn("segretissima", r.stdout)
        self.assertNotIn("segretissima", r.stderr)


if __name__ == "__main__":
    unittest.main()
