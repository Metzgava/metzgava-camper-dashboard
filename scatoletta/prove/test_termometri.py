"""Le prove della scelta dei termometri: solo i nostri, e solo se credibili.

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

**Il terzo mucchio.** Nello stesso giro, uno dei sensori del quartiere diceva
`127.0` gradi: non una temperatura, il valore che quei sensori mandano quando
non hanno una lettura. Quello era di un estraneo e si e' fermato da se', ma la
domanda vera e' l'altra: se lo dicesse un termometro *nostro*?

La regola 2 della scatoletta dice che una lettura fuori scala non si spedisce,
e fino a qui non era scritta in nessuna riga: era vera solo perche' il server
para il colpo a [-40, 90]. Para il colpo a meta', pero' — rifiuta la misura
nello storico e scrive comunque l'istantanea, che e' quella che l'app mostra
nel riquadro «adesso». Un 127 dei nostri sarebbe finito sotto gli occhi.

Quindi i termometri si dividono in tre: i nostri, gli estranei, e quelli che
dicono cose impossibili. Un valore assurdo quasi sempre vuol dire che il
decodificatore ha perso un byte, e allora **tutta** la lettura e' sospetta: non
si tiene l'umidita' di un pacchetto in cui la temperatura e' sbagliata.
"""
import sys
import unittest
from pathlib import Path

QUI = Path(__file__).resolve().parent
sys.path.insert(0, str(QUI.parent))

from agente import termometri_scelti, pacco_termometro  # noqa: E402


class ProveTermometri(unittest.TestCase):
    # Quel che arriva dall'ascolto Bluetooth: indirizzo -> (nome, letture)
    SENTITI = {
        "AA:BB:CC:00:00:01": ("ATC_000001", {"temperatura": 4.5, "umidita": 61}),
        "D0:13:6E:5C:A2:B4": ("", {"temperatura": 9.9, "umidita": 78}),
    }

    def test_chi_e_in_elenco_si_tiene_col_nome_che_gli_hai_dato(self):
        nostri, _, _ = termometri_scelti(self.SENTITI,
                                         {"aa:bb:cc:00:00:01": "frigo"})
        self.assertEqual([(i, e) for i, e, _ in nostri],
                         [("AA:BB:CC:00:00:01", "frigo")])

    def test_chi_non_e_in_elenco_non_si_spedisce(self):
        nostri, estranei, _ = termometri_scelti(self.SENTITI,
                                                {"aa:bb:cc:00:00:01": "frigo"})
        indirizzi = [i for i, _, _ in nostri]
        self.assertNotIn("D0:13:6E:5C:A2:B4", indirizzi)
        self.assertEqual([i for i, _, _ in estranei], ["D0:13:6E:5C:A2:B4"])

    def test_l_estraneo_porta_con_se_le_sue_letture(self):
        # Servono nel diario: senza la temperatura non riconosci il tuo quando
        # lo accendi sul tavolo accanto agli altri.
        _, estranei, _ = termometri_scelti(self.SENTITI, {})
        letture = {i: l for i, _, l in estranei}
        self.assertEqual(letture["D0:13:6E:5C:A2:B4"]["temperatura"], 9.9)

    def test_l_indirizzo_si_confronta_senza_badare_alle_maiuscole(self):
        # In config.json l'indirizzo lo scrivi a mano, copiandolo dal diario:
        # maiuscole e minuscole non devono decidere se il sensore e' tuo.
        nostri, _, _ = termometri_scelti(self.SENTITI,
                                         {"AA:BB:CC:00:00:01": "frigo"})
        self.assertEqual(len(nostri), 1)

    def test_con_l_elenco_vuoto_non_si_spedisce_niente(self):
        # E' il caso del 19/11: `termometri` vuoto in config.json. Prima
        # passavano tutti, ed e' quel che ha mandato in coda il sensore di un
        # vicino.
        nostri, estranei, assurdi = termometri_scelti(self.SENTITI, {})
        self.assertEqual(nostri, [])
        self.assertEqual(len(estranei), 2)
        self.assertEqual(assurdi, [])

    # --- la regola 2: una lettura fuori scala non si spedisce ---

    def test_un_termometro_nostro_che_dice_127_gradi_non_si_spedisce(self):
        # Il valore visto il 19/11 nel diario. Non e' una temperatura: e' quel
        # che quei sensori mandano quando non hanno una lettura.
        sentiti = {"AA:BB:CC:00:00:01": ("ATC_000001",
                                         {"temperatura": 127.0, "umidita": 61})}
        nostri, _, assurdi = termometri_scelti(sentiti,
                                               {"aa:bb:cc:00:00:01": "frigo"})
        self.assertEqual(nostri, [])
        self.assertEqual([i for i, _, _, _ in assurdi], ["AA:BB:CC:00:00:01"])

    def test_l_assurdo_dice_quale_grandezza_e_quanto_valeva(self):
        # Serve nel diario: «fuori scala» senza il numero non dice se e' il
        # sensore che tace o il decodificatore che ha perso un byte.
        sentiti = {"AA:BB:CC:00:00:01": ("ATC_000001", {"temperatura": 127.0})}
        _, _, assurdi = termometri_scelti(sentiti,
                                          {"aa:bb:cc:00:00:01": "frigo"})
        _, etichetta, _, fuori = assurdi[0]
        self.assertEqual(etichetta, "frigo")
        self.assertEqual(fuori, [("temperatura", 127.0)])

    def test_si_butta_tutta_la_lettura_non_solo_il_valore_sbagliato(self):
        # Un byte perso sposta i byte dopo: l'umidita' di un pacchetto con la
        # temperatura sbagliata non e' piu' attendibile di lei.
        sentiti = {"AA:BB:CC:00:00:01": ("ATC_000001",
                                         {"temperatura": 127.0, "umidita": 61})}
        nostri, _, _ = termometri_scelti(sentiti,
                                         {"aa:bb:cc:00:00:01": "frigo"})
        self.assertEqual(nostri, [])

    def test_anche_l_umidita_e_la_pila_hanno_una_scala(self):
        sentiti = {"AA:BB:CC:00:00:01": ("ATC_000001",
                                         {"temperatura": 4.5, "umidita": 255})}
        nostri, _, assurdi = termometri_scelti(sentiti,
                                               {"aa:bb:cc:00:00:01": "frigo"})
        self.assertEqual(nostri, [])
        self.assertEqual(assurdi[0][3], [("umidita", 255)])

    def test_gli_estremi_della_scala_sono_buoni(self):
        # Il server accetta [-40, 90] compresi: la scatoletta non deve essere
        # piu' severa di lui, o scarterebbe letture che l'archivio prenderebbe.
        sentiti = {"AA:BB:CC:00:00:01": ("ATC_000001", {"temperatura": -40.0}),
                   "AA:BB:CC:00:00:02": ("ATC_000002", {"temperatura": 90.0})}
        nostri, _, assurdi = termometri_scelti(
            sentiti, {"aa:bb:cc:00:00:01": "cella", "aa:bb:cc:00:00:02": "tetto"})
        self.assertEqual(len(nostri), 2)
        self.assertEqual(assurdi, [])

    def test_una_grandezza_che_non_conosciamo_non_ferma_la_lettura(self):
        # I sensori mandano anche cose che non spediamo (il contatore dei
        # pacchetti, per esempio). Non avere una scala per loro non e' un
        # motivo per buttare la temperatura.
        sentiti = {"AA:BB:CC:00:00:01": ("ATC_000001",
                                         {"temperatura": 4.5, "contatore": 9999})}
        nostri, _, assurdi = termometri_scelti(sentiti,
                                               {"aa:bb:cc:00:00:01": "frigo"})
        self.assertEqual(len(nostri), 1)
        self.assertEqual(assurdi, [])

    def test_un_estraneo_assurdo_resta_un_estraneo(self):
        # E' il caso vero del 19/11: i 127 gradi erano di un vicino. Non
        # servono due righe nel diario per lo stesso sensore, e «non e' tuo» e'
        # il motivo piu' utile da leggere.
        sentiti = {"F8:98:CA:F1:42:56": ("", {"temperatura": 127.0})}
        nostri, estranei, assurdi = termometri_scelti(sentiti, {})
        self.assertEqual(nostri, [])
        self.assertEqual(len(estranei), 1)
        self.assertEqual(assurdi, [])


class ProvePacco(unittest.TestCase):
    """Come si impacchetta un termometro per il server.

    **Il tipo va scritto due volte**, e non e' una ripetizione per sbaglio: il
    server, nell'istantanea, conserva soltanto `dati` -- e l'istantanea e' quel
    che l'app mostra nel riquadro «adesso». Un `tipo` scritto solo accanto a
    `dati` arriva al server, viene usato per lo storico, e **non arriva mai in
    pagina**.

    Il 19/11/2026 e' costato una sezione «Temperature» che diceva «nessun
    termometro in elenco» mentre i tre termometri mandavano regolarmente: il
    filtro della pagina cercava `dati.tipo`, che non c'era. Blink lo scrive due
    volte dal primo giorno; i termometri no, e nessuno se ne era accorto perche'
    nessuna pagina li guardava ancora.
    """

    def test_il_tipo_sta_anche_dentro_dati(self):
        pacco = pacco_termometro("AA:BB:CC:00:00:01", "frigo",
                                 {"temperatura": 4.5, "umidita": 61}, -55)
        self.assertEqual(pacco["tipo"], "termometro")
        self.assertEqual(pacco["dati"]["tipo"], "termometro",
                         "senza questo la pagina non lo vede")

    def test_il_nome_sta_anche_dentro_dati(self):
        # Stessa ragione: la pagina legge l'etichetta da `dati`, non
        # dall'identificativo, che e' un MAC senza i due punti.
        pacco = pacco_termometro("AA:BB:CC:00:00:01", "frigo",
                                 {"temperatura": 4.5}, None)
        self.assertEqual(pacco["dati"]["nome"], "frigo")

    def test_le_misure_sono_solo_numeri_da_mettere_in_archivio(self):
        # `tipo` e `nome` non sono grandezze: il server le scarterebbe con una
        # riga negli eventi a ogni giro, come gia' succedeva all'umidita'.
        pacco = pacco_termometro("AA:BB:CC:00:00:01", "frigo",
                                 {"temperatura": 4.5, "umidita": 61, "pila": 88}, -55)
        self.assertEqual(set(pacco["misure"]),
                         {"temperatura", "umidita", "pila", "rssi"})

    def test_la_potenza_del_segnale_entra_nei_dati_e_nelle_misure(self):
        pacco = pacco_termometro("AA:BB:CC:00:00:01", "frigo", {"temperatura": 4.5}, -55)
        self.assertEqual(pacco["dati"]["rssi"], -55)
        self.assertEqual(pacco["misure"]["rssi"], -55)

    def test_senza_potenza_non_si_inventa_un_rssi(self):
        pacco = pacco_termometro("AA:BB:CC:00:00:01", "frigo", {"temperatura": 4.5}, None)
        self.assertNotIn("rssi", pacco["dati"])
        self.assertNotIn("rssi", pacco["misure"])

    def test_l_identificativo_viene_dall_indirizzo(self):
        pacco = pacco_termometro("AA:BB:CC:00:00:01", "frigo", {"temperatura": 4.5}, None)
        self.assertEqual(pacco["id"], "term-aabbcc000001")


if __name__ == "__main__":
    unittest.main()
