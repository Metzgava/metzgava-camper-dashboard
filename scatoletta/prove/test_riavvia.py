"""Le prove di `riavvia.sh`: il comando corto che si lancia DAL MAC.

Il 19/11/2026 l'indirizzo della scatoletta e' cambiato quattro volte in due
ore -- .163, .166, .172, .173 -- perche' col segnale al 30% il WiFi si stacca e
si riattacca, e il router le da' un indirizzo nuovo ogni volta. Ogni volta il
proprietario ha dovuto ribattere a mano una riga diversa, e due volte la
password e' finita scritta in chiaro nel terminale per un errore di tempismo.

Battere comandi e' la parte piu' faticosa per lui. Quindi la riga si accorcia a
una parola e l'indirizzo lo cerca lo script, dall'impronta della radio.

Le due cose che devono essere vere, e sono queste prove:

- **se non la trova, non fa niente.** Un indirizzo vecchio appartiene magari a
  un altro apparecchio della rete: `sudo systemctl restart` mandato alla cieca
  e' il modo di scoprire di aver riavviato il televisore.
- **l'indirizzo non si scrive dentro lo script.** E' proprio quel che cambia.
"""
import os
import stat
import subprocess
import tempfile
import unittest
from pathlib import Path

QUI = Path(__file__).resolve().parent
SCRIPT = QUI.parent / "riavvia.sh"


def finto(cestino: Path, nome: str, corpo: str):
    f = cestino / nome
    f.write_text("#!/bin/bash\n" + corpo)
    f.chmod(0o755)
    return f


def lancia(dove: Path, arp_dice: str, ssh_esito: int = 0):
    cestino = dove / "bin"
    cestino.mkdir(parents=True, exist_ok=True)
    finto(cestino, "ping", "exit 0\n")
    finto(cestino, "nc", "exit 0\n")
    finto(cestino, "arp", f'cat <<"FINEARP"\n{arp_dice}\nFINEARP\n')
    finto(cestino, "ssh", f'echo "ssh $*" >> "{dove}/diario"\nexit {ssh_esito}\n')
    amb = dict(os.environ)
    amb["PATH"] = f"{cestino}:{amb['PATH']}"
    return subprocess.run(["bash", str(SCRIPT)], text=True, capture_output=True,
                          env=amb, timeout=60)


class ProveRiavvia(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dove = Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def test_trovata_la_riavvia_a_quell_indirizzo(self):
        r = lancia(self.dove, "? (10.10.3.199) at 98:fe:54:9e:a9:9 on en0 ifscope [ethernet]")
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        diario = (self.dove / "diario").read_text()
        self.assertIn("10.10.3.199", diario)
        self.assertIn("systemctl restart scatoletta", diario)

    def test_chiede_un_terminale_per_la_password(self):
        # `sudo` la password la chiede su un terminale vero: senza `-t` lo
        # script muore senza spiegare, e sembra un guasto della scatoletta.
        lancia(self.dove, "? (10.10.3.199) at 98:fe:54:9e:a9:9 on en0 ifscope [ethernet]")
        self.assertIn("-t", (self.dove / "diario").read_text())

    def test_se_non_la_trova_non_tocca_niente(self):
        # Un indirizzo vecchio appartiene magari a un altro apparecchio della
        # rete: un riavvio mandato alla cieca e' il modo di scoprire di aver
        # riavviato il televisore.
        r = lancia(self.dove, "? (10.10.3.5) at aa:bb:cc:dd:ee:ff on en0 ifscope [ethernet]")
        self.assertNotEqual(r.returncode, 0)
        self.assertFalse((self.dove / "diario").exists(),
                         "ha provato a collegarsi senza averla trovata")
        self.assertIn("non", (r.stdout + r.stderr).lower())

    def test_l_indirizzo_non_sta_scritto_dentro_lo_script(self):
        # E' proprio quel che cambia: un indirizzo fisso qui dentro sarebbe
        # sbagliato entro un'ora.
        testo = SCRIPT.read_text()
        import re
        fissi = [n for n in re.findall(r"10\.10\.3\.(\d+)", testo) if n not in ("x", "")]
        self.assertEqual(fissi, [], f"indirizzi scritti a mano: {fissi}")


if __name__ == "__main__":
    unittest.main()
