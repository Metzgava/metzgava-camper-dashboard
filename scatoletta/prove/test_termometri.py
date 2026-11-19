"""Le prove della scelta dei termometri: solo i nostri.

Il 19/11, primo giro con il Bluetooth davvero accesso, la scatoletta ha spedito
questo:

    {"tipo": "termometro", "nome": "D0:13:6E:5C:A2:B4",
     "dati": {"temperatura": 9.9, "umidita": 78, "rssi": -77}}

Un termometro che non e' nostro. I sensori BTHome e ATC trasmettono in chiaro a
chiunque passi, e il primo giro ne ha raccolto uno dei vicini a settantasette
decibel di distanza.

La versione di prima teneva tutto e, a chi non era in elenco, dava il proprio
indirizzo come nome -- con il commento «meglio un nome brutto che un sensore
anonimo». Era una scelta ragionevole scritta prima di sapere che la scatoletta
avrebbe sentito i sensori del quartiere. Due motivi per cambiarla: l'archivio
del camper non deve riempirsi delle misure dei vicini, e quelle misure non sono
nostre da conservare.

Pero' gli estranei non si buttano in silenzio: quando comprerai i tuoi
termometri, l'unico modo di scoprire il loro indirizzo e' sentirli. Quindi si
scartano dai dati e si scrivono nel diario — dove servono a te e a nessun
archivio.
"""
import sys
import unittest
from pathlib import Path

QUI = Path(__file__).resolve().parent
sys.path.insert(0, str(QUI.parent))

from agente import termometri_scelti  # noqa: E402


class ProveTermometri(unittest.TestCase):
    # Quel che arriva dall'ascolto Bluetooth: indirizzo -> (nome, letture)
    SENTITI = {
        "AA:BB:CC:00:00:01": ("ATC_000001", {"temperatura": 4.5, "umidita": 61}),
        "D0:13:6E:5C:A2:B4": ("", {"temperatura": 9.9, "umidita": 78}),
    }

    def test_chi_e_in_elenco_si_tiene_col_nome_che_gli_hai_dato(self):
        nostri, _ = termometri_scelti(self.SENTITI, {"aa:bb:cc:00:00:01": "frigo"})
        self.assertEqual([(i, e) for i, e, _ in nostri],
                         [("AA:BB:CC:00:00:01", "frigo")])

    def test_chi_non_e_in_elenco_non_si_spedisce(self):
        nostri, estranei = termometri_scelti(self.SENTITI,
                                             {"aa:bb:cc:00:00:01": "frigo"})
        indirizzi = [i for i, _, _ in nostri]
        self.assertNotIn("D0:13:6E:5C:A2:B4", indirizzi)
        self.assertEqual([i for i, _, _ in estranei], ["D0:13:6E:5C:A2:B4"])

    def test_l_estraneo_porta_con_se_le_sue_letture(self):
        # Servono nel diario: senza la temperatura non riconosci il tuo quando
        # lo accendi sul tavolo accanto agli altri.
        _, estranei = termometri_scelti(self.SENTITI, {})
        letture = {i: l for i, _, l in estranei}
        self.assertEqual(letture["D0:13:6E:5C:A2:B4"]["temperatura"], 9.9)

    def test_l_indirizzo_si_confronta_senza_badare_alle_maiuscole(self):
        # In config.json l'indirizzo lo scrivi a mano, copiandolo dal diario:
        # maiuscole e minuscole non devono decidere se il sensore e' tuo.
        nostri, _ = termometri_scelti(self.SENTITI, {"AA:BB:CC:00:00:01": "frigo"})
        self.assertEqual(len(nostri), 1)

    def test_con_l_elenco_vuoto_non_si_spedisce_niente(self):
        # E' il caso del 19/11: `termometri` vuoto in config.json. Prima
        # passavano tutti, ed e' quel che ha mandato in coda il sensore di un
        # vicino.
        nostri, estranei = termometri_scelti(self.SENTITI, {})
        self.assertEqual(nostri, [])
        self.assertEqual(len(estranei), 2)


if __name__ == "__main__":
    unittest.main()
