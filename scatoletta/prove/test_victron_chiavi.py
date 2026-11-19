"""Le prove di `aggiungi-victron.sh`: le chiavi delle Victron, al sicuro.

Le Victron non trasmettono in chiaro come i termometri: ogni apparecchio
annuncia i suoi dati cifrati con una chiave propria, che si legge una volta
sola da VictronConnect sul telefono. Senza quella chiave la scatoletta sente
l'annuncio e lo lascia stare -- che e' la cosa giusta, ma vuol dire nessun
dato.

Perche' uno script e non una riga a mano. Tre motivi, e due sono gli stessi di
`aggiungi-rete.sh`:

1. **La chiave non passa dalla riga di comando.** `ps` mostra gli argomenti dei
   processi a chiunque sia collegato in quel momento. Si batte invisibile e
   finisce nel file, senza mai comparire.
2. **`config.json` non si riscrive a mano.** Dentro c'e' anche la chiave della
   porta del server: un `>` sbagliato e la scatoletta non parla piu' con
   nessuno. Qui il file si rilegge, si aggiunge una voce e si riscrive intero,
   e se e' illeggibile **non si tocca**.
3. **L'indirizzo non si copia a mano.** La scatoletta sa gia' quali Victron
   sente: le elenca numerate e si risponde col numero. Un MAC battuto a mano e'
   diciassette caratteri di occasioni per sbagliare, e l'errore non si vede --
   si vede solo che l'apparecchio non compare mai.

Girano sul Mac: l'elenco degli apparecchi e' finto e arriva da `ELENCO`, e il
file di configurazione e' una copia in una cartella temporanea.
"""
import json
import os
import stat
import subprocess
import tempfile
import unittest
from pathlib import Path

QUI = Path(__file__).resolve().parent
SCRIPT = QUI.parent / "aggiungi-victron.sh"

CHIAVE = "00112233445566778899aabbccddeeff"
ALTRA = "ffeeddccbbaa99887766554433221100"

SENTITI = ("dd:ee:ff:00:11:22\tOrion XS HQ2540U3UX3\n"
           "aa:bb:cc:dd:ee:ff\tSmartSolar HQ2222PUNT4\n")


def lancia(risposte: str, dove: Path, sentiti: str = SENTITI, config=None):
    """Lancia lo script con un elenco finto e un config.json in sandbox."""
    cestino = dove / "bin"
    cestino.mkdir(parents=True, exist_ok=True)
    # L'elenco finto legge da un file invece di avere il testo dentro: con
    # `printf` i caratteri di tabulazione e i ritorni a capo restavano
    # letterali, e lo script vedeva una riga sola.
    dati = dove / "sentiti.txt"
    dati.write_text(sentiti)
    finto = cestino / "elenco-finto"
    finto.write_text(f'#!/bin/bash\ncat "{dati}"\n')
    finto.chmod(0o755)

    conf = dove / "config.json"
    if config is None:
        config = json.dumps({"nome": "scatoletta",
                             "chiave": "la-chiave-della-porta",
                             "minuti": 5,
                             "termometri": {"a4:c1:38:00:00:01": "frigo"}})
    conf.write_text(config)
    conf.chmod(0o600)

    amb = dict(os.environ)
    amb["PATH"] = f"{cestino}:{amb['PATH']}"
    amb["ELENCO"] = str(finto)
    amb["AGENTE_CONFIG"] = str(conf)
    return subprocess.run(["bash", str(SCRIPT)], input=risposte, text=True,
                          capture_output=True, env=amb, timeout=30)


class ProveChiaviVictron(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dove = Path(self.tmp.name)
        self.conf = self.dove / "config.json"

    def tearDown(self):
        self.tmp.cleanup()

    def letto(self):
        return json.loads(self.conf.read_text())

    def test_elenca_numerate_le_victron_che_sente(self):
        r = lancia(f"1\n{CHIAVE}\n", self.dove)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertIn("Orion XS HQ2540U3UX3", r.stdout)
        self.assertIn("SmartSolar HQ2222PUNT4", r.stdout)
        self.assertIn("1)", r.stdout)
        self.assertIn("2)", r.stdout)

    def test_scrive_la_chiave_sotto_l_indirizzo_scelto(self):
        lancia(f"1\n{CHIAVE}\n", self.dove)
        self.assertEqual(self.letto()["victron"]["dd:ee:ff:00:11:22"], CHIAVE)

    def test_il_numero_scelto_decide_quale_apparecchio(self):
        lancia(f"2\n{CHIAVE}\n", self.dove)
        victron = self.letto()["victron"]
        self.assertIn("aa:bb:cc:dd:ee:ff", victron)
        self.assertNotIn("dd:ee:ff:00:11:22", victron)

    def test_la_chiave_non_finisce_a_schermo(self):
        r = lancia(f"1\n{CHIAVE}\n", self.dove)
        self.assertNotIn(CHIAVE, r.stdout)
        self.assertNotIn(CHIAVE, r.stderr)

    def test_non_tocca_il_resto_della_configurazione(self):
        # Dentro config.json c'e' anche la chiave della porta del server: se
        # questo script la perde, la scatoletta smette di parlare col server e
        # il guasto sembra tutt'altro.
        lancia(f"1\n{CHIAVE}\n", self.dove)
        d = self.letto()
        self.assertEqual(d["chiave"], "la-chiave-della-porta")
        self.assertEqual(d["minuti"], 5)
        self.assertEqual(d["termometri"], {"a4:c1:38:00:00:01": "frigo"})

    def test_il_file_resta_leggibile_solo_dal_proprietario(self):
        lancia(f"1\n{CHIAVE}\n", self.dove)
        self.assertEqual(stat.S_IMODE(self.conf.stat().st_mode), 0o600)

    def test_aggiungere_la_seconda_non_cancella_la_prima(self):
        lancia(f"1\n{CHIAVE}\n", self.dove)
        # La seconda volta il file ha gia' una voce `victron`: va aggiunta,
        # non sostituita. E' il caso normale -- due apparecchi, due passaggi.
        cestino = self.dove / "bin"
        amb = dict(os.environ)
        amb["PATH"] = f"{cestino}:{amb['PATH']}"
        amb["ELENCO"] = str(cestino / "elenco-finto")
        amb["AGENTE_CONFIG"] = str(self.conf)
        subprocess.run(["bash", str(SCRIPT)], input=f"2\n{ALTRA}\n", text=True,
                       capture_output=True, env=amb, timeout=30)
        victron = self.letto()["victron"]
        self.assertEqual(victron["dd:ee:ff:00:11:22"], CHIAVE)
        self.assertEqual(victron["aa:bb:cc:dd:ee:ff"], ALTRA)

    def test_rifare_lo_stesso_apparecchio_corregge_e_non_duplica(self):
        lancia(f"1\n{CHIAVE}\n", self.dove)
        cestino = self.dove / "bin"
        amb = dict(os.environ)
        amb["PATH"] = f"{cestino}:{amb['PATH']}"
        amb["ELENCO"] = str(cestino / "elenco-finto")
        amb["AGENTE_CONFIG"] = str(self.conf)
        subprocess.run(["bash", str(SCRIPT)], input=f"1\n{ALTRA}\n", text=True,
                       capture_output=True, env=amb, timeout=30)
        victron = self.letto()["victron"]
        self.assertEqual(len(victron), 1)
        self.assertEqual(victron["dd:ee:ff:00:11:22"], ALTRA)

    # --- quel che si rifiuta di fare ---

    def test_una_chiave_non_esadecimale_non_si_scrive(self):
        # La chiave si copia dal telefono: un carattere di troppo incollato
        # insieme, e la scatoletta decifrerebbe spazzatura a ogni giro senza
        # dire niente di utile.
        r = lancia("1\n" + "z" * 32 + "\n", self.dove)
        self.assertNotEqual(r.returncode, 0)
        self.assertNotIn("victron", self.letto())

    def test_una_chiave_della_lunghezza_sbagliata_non_si_scrive(self):
        r = lancia("1\n00112233\n", self.dove)
        self.assertNotEqual(r.returncode, 0)
        self.assertNotIn("victron", self.letto())
        self.assertIn("32", r.stderr)

    def test_un_numero_fuori_elenco_non_scrive_niente(self):
        r = lancia("7\n", self.dove)
        self.assertNotEqual(r.returncode, 0)
        self.assertNotIn("victron", self.letto())

    def test_se_non_sente_nessuna_victron_non_chiede_niente(self):
        # Succede davvero: la scatoletta in casa e il camper nel vialetto. Non
        # deve chiedere una chiave per un apparecchio che non c'e'.
        r = lancia("", self.dove, sentiti="")
        self.assertNotEqual(r.returncode, 0)
        self.assertNotIn("victron", self.letto())

    def test_un_config_illeggibile_non_si_sovrascrive(self):
        # Se il file e' rotto, riscriverlo da zero vorrebbe dire perdere la
        # chiave della porta e tutti i termometri. Meglio fermarsi e dirlo.
        rotto = '{"nome": "scatoletta", "minuti": 5,'
        r = lancia(f"1\n{CHIAVE}\n", self.dove, config=rotto)
        self.assertNotEqual(r.returncode, 0)
        self.assertEqual(self.conf.read_text(), rotto)


class ProveInterprete(unittest.TestCase):
    """Con quale Python ascolta la radio.

    Si legge il testo dello script invece di lanciarlo, come in
    `test_installa.py` e per lo stesso motivo: questo e' un difetto che si
    manifesta **solo** sulla scatoletta, e si manifesta travestito. `bleak`
    sta nell'ambiente a parte creato da `installa.sh`; chiamato col `python3`
    di sistema, `elenca-victron.py` muore per un import mancante, lo script
    legge un elenco vuoto e dice «non sento nessuna Victron» -- mandando ad
    avvicinare il camper per un guaio che non c'entra.
    """

    def setUp(self):
        self.testo = SCRIPT.read_text()

    def test_ascolta_col_python_dell_ambiente_a_parte(self):
        self.assertIn("ambiente/bin/python", self.testo)

    # Che lo script funzioni anche dove quell'ambiente non esiste lo
    # dimostrano le tredici prove di sopra: girano sul Mac e lo lanciano
    # davvero. Non serve una prova in piu' che legga il testo.


if __name__ == "__main__":
    unittest.main()
