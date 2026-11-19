"""Le prove di `installa.sh`: che non si dimentichi i passaggi che non danno errore.

`installa.sh` gira sulla scatoletta, con `sudo`, e installa pacchetti: non si
puo' eseguire in una prova. Ma il suo guasto peggiore non e' un comando che
fallisce -- quello si vede subito, a schermo, mentre lo lanci. E' un passaggio
**che manca**, e che non fa fallire niente.

La notte del 18/11 e' andata cosi': lo script accendeva il servizio Bluetooth,
e il servizio partiva. Tutto verde. Solo che su Raspberry Pi OS Lite la radio
nasce bloccata da un interruttore software, e un servizio attivo con la radio
bloccata e' indistinguibile — dall'esterno — da un servizio che funziona. La
scatoletta ha girato dieci ore scrivendo «niente da mandare» ogni cinque
minuti, con l'installazione riuscita e il sistema in ordine.

Da qui una prova che legge lo script invece di eseguirlo: non verifica che
funzioni, verifica che i passaggi silenziosi ci siano ancora.
"""
import unittest
from pathlib import Path

QUI = Path(__file__).resolve().parent
SCRIPT = (QUI.parent / "installa.sh").read_text()


class ProveInstalla(unittest.TestCase):
    def test_sblocca_la_radio_bluetooth(self):
        # L'interruttore e' un file sotto /sys/class/rfkill: si cerca fra gli
        # interruttori quello di tipo `bluetooth` e gli si scrive `soft` a
        # zero. `rfkill` come comando non c'e' su Lite, quindi non lo si cerca.
        self.assertIn("/sys/class/rfkill/", SCRIPT,
                      "manca lo sblocco della radio: il servizio partira' con "
                      "la radio bloccata, senza dare alcun errore")
        self.assertIn('"bluetooth"', SCRIPT)
        self.assertIn("soft", SCRIPT)

    def test_il_servizio_parte_da_solo_a_ogni_accensione(self):
        self.assertIn("systemctl enable", SCRIPT)
        self.assertIn("Restart=always", SCRIPT)

    def test_le_librerie_stanno_in_un_ambiente_a_parte(self):
        # Su Raspberry Pi OS non si installa con pip a livello di sistema:
        # Debian lo vieta e pip si rifiuta.
        self.assertIn("python3 -m venv", SCRIPT)
        for libreria in ("bleak", "tinytuya", "blinkpy", "cryptography"):
            self.assertIn(libreria, SCRIPT, f"manca {libreria}")

    def test_il_diario_non_consuma_la_scheda(self):
        # Le schede di memoria si consumano a forza di scritture, ed e' il
        # guasto piu' comune di un Raspberry montato su un veicolo.
        self.assertIn("Storage=volatile", SCRIPT)


if __name__ == "__main__":
    unittest.main()
