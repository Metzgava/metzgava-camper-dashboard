"""Le prove della rilettura della configurazione.

`agente.py` leggeva `config.json` una volta sola, all'avvio. Ogni cambiamento
-- un termometro in piu', un nome da correggere, il passo delle letture da
accorciare -- chiedeva quindi un riavvio del servizio, e un riavvio chiede
`sudo`, e `sudo` chiede la password.

Il 19/11/2026 questo e' costato due volte la stessa cosa: la password del
proprietario finita scritta in chiaro nel terminale del Mac, perche' battuta un
istante prima o un istante dopo la richiesta. Non e' un difetto suo: e' un
difetto di un apparecchio che pretende un riavvio per leggere un file di testo
di venti righe.

Rileggere costa una lettura di file ogni cinque minuti, cioe' niente. Ma va
fatto con due cautele, e sono queste le prove:

- **una configurazione rotta non butta via quella buona.** Si riscrive a mano,
  e un `{` dimenticato a meta' spedizione fermerebbe la scatoletta in camper,
  lontano da chi puo' sistemarla. Meglio tirare avanti con l'ultima che
  funzionava e dirlo nel diario.
- **un file che sparisce e' lo stesso caso.** Capita durante una riscrittura.
"""
import json
import sys
import tempfile
import unittest
from pathlib import Path

QUI = Path(__file__).resolve().parent
sys.path.insert(0, str(QUI.parent))

import agente  # noqa: E402


class ProveRilettura(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.file = Path(self.tmp.name) / "config.json"
        self.buona = {"nome": "scatoletta", "server": "https://esempio",
                      "chiave": "x", "minuti": 5, "termometri": {}}
        self.file.write_text(json.dumps(self.buona))
        self.vecchio = agente.CONFIG
        agente.CONFIG = self.file

    def tearDown(self):
        agente.CONFIG = self.vecchio
        self.tmp.cleanup()

    def test_rileggere_prende_i_cambiamenti(self):
        nuova = dict(self.buona, termometri={"aa:bb": "frigo"})
        self.file.write_text(json.dumps(nuova))
        letta = agente.configurazione_fresca(self.buona)
        self.assertEqual(letta["termometri"], {"aa:bb": "frigo"})

    def test_un_file_rotto_non_butta_via_quella_buona(self):
        self.file.write_text('{"nome": "scatoletta", "minuti":')
        letta = agente.configurazione_fresca(self.buona)
        self.assertEqual(letta, self.buona)

    def test_un_file_sparito_non_butta_via_quella_buona(self):
        self.file.unlink()
        letta = agente.configurazione_fresca(self.buona)
        self.assertEqual(letta, self.buona)

    def test_un_file_vuoto_non_butta_via_quella_buona(self):
        # Il momento esatto in cui una riscrittura non atomica ha troncato il
        # file: esiste, e' leggibile, e non contiene niente.
        self.file.write_text("")
        letta = agente.configurazione_fresca(self.buona)
        self.assertEqual(letta, self.buona)

    def test_una_configurazione_senza_server_non_si_prende(self):
        # Senza `server` o senza `chiave` la scatoletta non saprebbe dove
        # mandare le letture: una configurazione cosi' e' rotta quanto un JSON
        # malformato, e va rifiutata allo stesso modo.
        self.file.write_text(json.dumps({"nome": "scatoletta", "minuti": 5}))
        letta = agente.configurazione_fresca(self.buona)
        self.assertEqual(letta, self.buona)

    def test_il_passo_segue_i_minuti_della_configurazione(self):
        self.assertEqual(agente.passo_di({"minuti": 2}), 120)
        self.assertEqual(agente.passo_di({}), 300)

    def test_un_passo_assurdo_non_si_prende(self):
        # Zero o un numero negativo vorrebbe dire radio sempre accesa e
        # batteria servizi consumata in un giorno. Si torna al valore di
        # riserva invece di obbedire a un errore di battitura.
        self.assertEqual(agente.passo_di({"minuti": 0}), 300)
        self.assertEqual(agente.passo_di({"minuti": -3}), 300)
        self.assertEqual(agente.passo_di({"minuti": "due"}), 300)


if __name__ == "__main__":
    unittest.main()
