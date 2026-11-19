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
    "aggiungi-victron.sh",  # la chiave di cifratura di una Victron
    "elenca-victron.py",    # quel che `aggiungi-victron.sh` chiama per sentirle
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
        # Una scheda appena scritta da Imager ha anche le impostazioni: la
        # finta scheda deve somigliargli, altrimenti le prove girano su un
        # caso che in pratica non si deve nemmeno verificare.
        self.cloud_init()

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

    # Il 18/11 lo script ha stampato `ssh UTENTE@scatoletta.local`: un
    # segnaposto al posto del nome utente e il nome del config.json al posto di
    # quello di rete. La riga era inservibile, ed e' finita anche nella nota
    # sulla scheda.
    #
    # La causa: leggeva `userconf.txt` e `firstrun.sh`, il formato del vecchio
    # Imager. Imager 2.0 scrive invece i file di cloud-init (`user-data`), e di
    # quelli lo script non sapeva niente. Non trovando i suoi file metteva un
    # segnaposto **senza dirlo**, che e' la parte peggiore: una riga sbagliata
    # che sembra giusta.
    def cloud_init(self, nome="bergava-scatoletta", utente="metz"):
        (self.scheda / "user-data").write_text(
            "#cloud-config\n"
            f'hostname: "{nome}"\n'
            "manage_etc_hosts: true\n"
            "user:\n"
            f'  name: "{utente}"\n'
            "  shell: /bin/bash\n"
            "ssh_pwauth: true\n"
        )

    def test_la_riga_legge_nome_e_utente_da_cloud_init(self):
        self.cloud_init()
        self.lancia()
        nota = (self.scheda / "scatoletta" / "COME-SI-FINISCE.txt").read_text()
        self.assertIn("metz@bergava-scatoletta.local", nota)
        self.assertNotIn("UTENTE", nota)

    def test_la_riga_legge_ancora_il_formato_vecchio(self):
        # Le schede scritte col vecchio Imager devono continuare a funzionare:
        # qui non si sostituisce un formato, se ne aggiunge uno.
        (self.scheda / "userconf.txt").write_text("pi:$6$finta$hash\n")
        (self.scheda / "firstrun.sh").write_text(
            "#!/bin/bash\nset_hostname vecchio-nome\n")
        self.lancia()
        nota = (self.scheda / "scatoletta" / "COME-SI-FINISCE.txt").read_text()
        self.assertIn("pi@vecchio-nome.local", nota)

    def test_senza_nessuno_dei_due_formati_si_rifiuta(self):
        # Nessun formato riconosciuto vuol dire una cosa sola: Imager ha
        # scritto il sistema e ha buttato via l'ingranaggio. Quella scheda non
        # ha utente, password, WiFi ne' SSH: il Raspberry parte e resta
        # irraggiungibile. Non e' un dettaglio della riga da stampare -- e' una
        # scheda da rifare, e lo script si deve fermare.
        (self.scheda / "user-data").unlink()
        r = self.lancia()
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("non riesco a ricavare", (r.stdout + r.stderr).lower())
        self.assertFalse((self.scheda / "scatoletta" / "agente.py").exists())

    def test_senza_chiave_non_scrive_niente(self):
        self.config.write_text(json.dumps({"chiave": "METTI-QUI-LA-CHIAVE"}))
        r = self.lancia()
        self.assertNotEqual(r.returncode, 0)
        self.assertFalse((self.scheda / "scatoletta" / "agente.py").exists())


if __name__ == "__main__":
    unittest.main()
