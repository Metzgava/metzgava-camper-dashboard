"""Le prove della sessione di taratura: i collegamenti si tengono aperti.

Disegno: docs/superpowers/specs/2026-11-20-consumi-per-accessorio-design.md

Il fatto che decide tutto, di nuovo, non e' software: **le Ective non si
interrogano, mandano da sole**. Pezzetti di testo su FFE4, in continuazione.
Il costo dei venti secondi non e' la lettura, e' il *collegamento*.

Da qui la forma della taratura. Non un giro piu' fitto -- quello si
accavallerebbe, ed e' il motivo per cui il giro svelto non si collega a niente
-- ma **due collegamenti tenuti aperti** per la durata della sessione, con un
campione ogni pochi secondi preso dal flusso che arriva da solo.

Due cose che un collegamento lungo porta con se', e che qui si provano:

1. **Il flusso cresce.** Mezz'ora di notifiche in una stringa che si
   concatena, riletta da capo a ogni campione, e' un conto che peggiora con
   se stesso su un Raspberry Zero. Si taglia.
2. **La sessione deve finire da sola.** Se finisse solo quando il server lo
   dice, una rete caduta lascerebbe due collegamenti aperti e la radio accesa
   finche' qualcuno non va in camper. La scadenza e' nella risposta, e vale
   anche se nessuno risponde piu'.
"""
import datetime
import sys
import unittest
from pathlib import Path

QUI = Path(__file__).resolve().parent
sys.path.insert(0, str(QUI.parent))

import agente  # noqa: E402


# Un record vero come lo manda una Ective, preso dalle letture del 20/11/2026.
# Comincia con «^» e porta volt, ampere, capacita', cicli, carica, temperatura
# e le quattro celle.
def record(volt_mv=13080, ampere_ma=-8400, carica=86):
    def le(valore, byte, segno=False):
        return valore.to_bytes(byte, "little", signed=segno).hex()
    p = (le(volt_mv, 2)                       # 0: volt
         + "0000"                             # 4: non letto
         + le(ampere_ma, 4, True)             # 8: ampere
         + le(95000, 4)                       # 16: capacita' mAh
         + le(41, 2)                          # 24: cicli
         + le(carica, 2)                      # 28: carica %
         + le(2873, 2)                        # 32: temperatura in decimi di K
         + "0000" * 3                         # 36: non letto, fino a 44
         + le(3270, 2) + le(3271, 2) + le(3269, 2) + le(3270, 2))  # 44: celle
    return "^" + p.ljust(64, "0")


class ProveTaglioDelFlusso(unittest.TestCase):
    """Un flusso che cresce per mezz'ora va tagliato, senza perdere l'ultimo."""

    def test_un_flusso_corto_non_si_tocca(self):
        testo = record()
        self.assertEqual(agente.taglia_flusso(testo, 4096), testo)

    def test_un_flusso_lungo_si_accorcia(self):
        testo = record() * 500
        tagliato = agente.taglia_flusso(testo, 4096)
        self.assertLessEqual(len(tagliato), 4096)

    def test_dopo_il_taglio_l_ultimo_record_si_legge_ancora(self):
        # E' tutto il punto: si butta via la storia, non il presente.
        testo = record(ampere_ma=-1000) * 400 + record(ampere_ma=-8400, carica=77)
        letto = agente.ective_leggi(agente.taglia_flusso(testo, 4096))
        self.assertIsNotNone(letto, "l'ultimo record deve sopravvivere al taglio")
        self.assertEqual(letto["carica"], 77)
        self.assertAlmostEqual(letto["ampere"], -8.4, places=2)

    def test_un_taglio_a_meta_record_non_inventa_un_record(self):
        # Tagliando si puo' restare con mezzo record in testa. Non deve
        # diventare una lettura: meglio nessun numero che un numero sbagliato.
        intero = record()
        mezzo = intero[: len(intero) // 2]
        self.assertIsNone(agente.ective_leggi(mezzo))


class ProveScadenza(unittest.TestCase):
    """Fino a quando si tiene aperto."""

    def fra(self, minuti):
        return (datetime.datetime.now(datetime.timezone.utc)
                + datetime.timedelta(minutes=minuti)).isoformat()

    def test_una_sessione_aperta_da_una_scadenza(self):
        fino = agente.taratura_fino_a({"taratura": {"attiva": True, "scade": self.fra(20)}})
        self.assertIsNotNone(fino)
        resta = (fino - datetime.datetime.now(datetime.timezone.utc)).total_seconds()
        self.assertTrue(1000 < resta < 1300, f"restano {resta} secondi")

    def test_nessuna_sessione_nessuna_scadenza(self):
        self.assertIsNone(agente.taratura_fino_a({"taratura": {"attiva": False}}))
        self.assertIsNone(agente.taratura_fino_a({}))
        self.assertIsNone(agente.taratura_fino_a(None))

    def test_una_scadenza_gia_passata_non_apre_niente(self):
        self.assertIsNone(agente.taratura_fino_a(
            {"taratura": {"attiva": True, "scade": self.fra(-1)}}))

    def test_una_scadenza_lontanissima_si_ignora(self):
        # Stessa regola del passo: si sbaglia verso il lento. Una scadenza fra
        # tre ore e' un errore da qualche parte, e nel dubbio non si tengono
        # due collegamenti aperti tutto il pomeriggio.
        self.assertIsNone(agente.taratura_fino_a(
            {"taratura": {"attiva": True, "scade": self.fra(180)}}))

    def test_una_scadenza_illeggibile_non_apre_niente(self):
        self.assertIsNone(agente.taratura_fino_a({"taratura": {"attiva": True, "scade": "domani"}}))
        self.assertIsNone(agente.taratura_fino_a({"taratura": {"attiva": True}}))


class ProvePacco(unittest.TestCase):
    """Dal flusso delle due batterie al pacco da spedire."""

    def test_due_batterie_fanno_due_apparecchi(self):
        pacco = agente.pacco_taratura(
            {"NWJ1": record(carica=86), "NWJ2": record(carica=84)}, "scatoletta")
        self.assertEqual(pacco["fonte"], "scatoletta")
        self.assertEqual(len(pacco["apparecchi"]), 2)
        nomi = sorted(a["id"] for a in pacco["apparecchi"])
        self.assertEqual(nomi, ["NWJ1", "NWJ2"])

    def test_porta_le_stesse_grandezze_del_giro_normale(self):
        # Se la taratura mandasse grandezze diverse da quelle del giro lento,
        # lo scalino andrebbe cercato in una colonna e il resto della pagina
        # nell'altra. Le misure sono le stesse, sempre.
        pacco = agente.pacco_taratura({"NWJ1": record()}, "scatoletta")
        misure = pacco["apparecchi"][0]["misure"]
        for grandezza in ("carica", "volt", "ampere", "watt", "temperatura"):
            self.assertIn(grandezza, misure)
        self.assertEqual(pacco["apparecchi"][0]["tipo"], "ective")

    def test_una_batteria_che_non_ha_ancora_detto_niente_si_salta(self):
        # Non manda zeri: uno zero sembra una misura. E' la prima delle tre
        # regole della scatoletta.
        pacco = agente.pacco_taratura({"NWJ1": record(), "NWJ2": ""}, "scatoletta")
        self.assertEqual(len(pacco["apparecchi"]), 1)
        self.assertEqual(pacco["apparecchi"][0]["id"], "NWJ1")

    def test_se_nessuna_ha_detto_niente_non_si_spedisce_un_pacco_vuoto(self):
        self.assertIsNone(agente.pacco_taratura({"NWJ1": "", "NWJ2": ""}, "scatoletta"))
        self.assertIsNone(agente.pacco_taratura({}, "scatoletta"))


if __name__ == "__main__":
    unittest.main()
