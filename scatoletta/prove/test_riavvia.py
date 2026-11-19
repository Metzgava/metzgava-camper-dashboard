"""Le prove di `riavvia.sh`: il comando corto che si lancia DAL MAC.

Il 19/11/2026 l'indirizzo della scatoletta e' cambiato quattro volte in due
ore -- .163, .166, .172, .173 -- perche' col segnale al 30% il WiFi si stacca e
si riattacca, e il router le da' un indirizzo nuovo ogni volta. Ogni volta il
proprietario ha dovuto ribattere a mano una riga diversa; due volte la password
e' finita scritta in chiaro nel terminale per un errore di tempismo, e due
volte il comando e' andato in timeout **dopo** che l'aveva battuta.

Battere comandi e' la parte piu' faticosa, per lui. Quindi la riga si accorcia
a una parola e l'indirizzo lo cerca lo script.

**Come NON si cerca: dalla tabella ARP.** E' stata la prima stesura di questo
script, ed era sbagliata: ARP vive dentro una sola sottorete. Il Mac sta su
10.10.2.x e la scatoletta su 10.10.3.x, quindi quella tabella non la vedra' mai
-- mostra il MAC del router al posto del suo. Lo script si fermava dicendo «non
la trovo» mentre la scatoletta era raggiungibile e mandava dati.

Si cerca invece chi risponde sulla porta SSH, e poi **gli si chiede come si
chiama**. Cosi' l'identita' e' verificata e non indovinata: un apparecchio
qualunque con la porta 22 aperta non risponde `bergava-scatoletta`, e non
accetterebbe la nostra chiave.
"""
import os
import subprocess
import tempfile
import unittest
from pathlib import Path

QUI = Path(__file__).resolve().parent
SCRIPT = QUI.parent / "riavvia.sh"
NOME_ATTESO = "bergava-scatoletta"


def finto(cestino: Path, nome: str, corpo: str):
    f = cestino / nome
    f.write_text("#!/bin/bash\n" + corpo)
    f.chmod(0o755)


def lancia(dove: Path, porta_aperta=(), chi_e=None, arp_dice=""):
    """`porta_aperta`: indirizzi che rispondono su 22. `chi_e`: indirizzo ->
    come si chiama."""
    chi_e = chi_e or {}
    cestino = dove / "bin"
    cestino.mkdir(parents=True, exist_ok=True)
    finto(cestino, "ping", "exit 0\n")
    aperti = "|".join(a.replace(".", r"\.") for a in porta_aperta) or "NESSUNO"
    finto(cestino, "nc", f'[[ "$*" =~ ({aperti}) ]] && exit 0\nexit 1\n')
    finto(cestino, "arp", f'cat <<"FINEARP"\n{arp_dice}\nFINEARP\n')
    rami = "\n".join(
        f'[[ "$*" =~ {ind.replace(".", chr(92) + ".")} ]] && {{ echo "{nome}"; exit 0; }}'
        for ind, nome in chi_e.items())
    finto(cestino, "ssh",
          f'echo "ssh $*" >> "{dove}/diario"\n'
          'if [[ "$*" == *hostname* ]]; then\n'
          f'{rami}\n'
          '  exit 255\n'
          'fi\n'
          'exit 0\n')
    amb = dict(os.environ)
    amb["PATH"] = f"{cestino}:{amb['PATH']}"
    return subprocess.run(["bash", str(SCRIPT)], text=True, capture_output=True,
                          env=amb, timeout=90)


def riavvii(dove: Path):
    diario = dove / "diario"
    if not diario.exists():
        return []
    return [r for r in diario.read_text().splitlines() if "systemctl restart" in r]


class ProveRiavvia(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dove = Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def test_la_trova_e_la_riavvia(self):
        r = lancia(self.dove, porta_aperta=["10.10.3.199"],
                   chi_e={"10.10.3.199": NOME_ATTESO})
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertEqual(len(riavvii(self.dove)), 1, riavvii(self.dove))
        self.assertIn("10.10.3.199", riavvii(self.dove)[0])

    def test_non_dipende_dalla_tabella_arp(self):
        # La prova che fissa il difetto del 19/11: con ARP muta -- com'e' da
        # un'altra sottorete -- deve trovarla comunque.
        r = lancia(self.dove, porta_aperta=["10.10.3.199"],
                   chi_e={"10.10.3.199": NOME_ATTESO}, arp_dice="")
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertEqual(len(riavvii(self.dove)), 1)

    def test_chiede_un_terminale_per_la_password(self):
        # `sudo` la password la chiede su un terminale vero: senza `-t` lo
        # script muore senza spiegare, e sembra un guasto della scatoletta.
        lancia(self.dove, porta_aperta=["10.10.3.199"],
               chi_e={"10.10.3.199": NOME_ATTESO})
        self.assertIn("-t", riavvii(self.dove)[0])

    def test_chi_ha_la_porta_aperta_ma_non_e_lei_non_si_riavvia(self):
        # Su una rete di casa ci sono stampanti, dischi di rete, televisori.
        # Riavviare «il primo che risponde sulla 22» e' il modo di scoprire di
        # aver riavviato qualcos'altro.
        r = lancia(self.dove, porta_aperta=["10.10.3.50"],
                   chi_e={"10.10.3.50": "disco-di-rete"})
        self.assertNotEqual(r.returncode, 0)
        self.assertEqual(riavvii(self.dove), [])

    def test_se_non_risponde_nessuno_non_tocca_niente(self):
        r = lancia(self.dove)
        self.assertNotEqual(r.returncode, 0)
        self.assertEqual(riavvii(self.dove), [])
        self.assertIn("non", (r.stdout + r.stderr).lower())

    def test_l_indirizzo_non_sta_scritto_dentro_lo_script(self):
        # E' proprio quel che cambia: un indirizzo fisso qui dentro sarebbe
        # sbagliato entro un'ora.
        import re
        fissi = re.findall(r"10\.10\.3\.\d+", SCRIPT.read_text())
        self.assertEqual(fissi, [], f"indirizzi scritti a mano: {fissi}")


if __name__ == "__main__":
    unittest.main()
