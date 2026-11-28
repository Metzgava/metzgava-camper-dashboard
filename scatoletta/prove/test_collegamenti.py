# Chi ci tiene occupato un apparecchio, e come lo si libera.
#
# Il 21/11/2026 alle 11:01 una fotografia della Bluetti e' stata interrotta a
# meta': `raccolta.sh` era appena stato modificato, e il riavvio del servizio
# manda **SIGTERM a tutto il gruppo** (`KillMode=control-group`,
# `KillSignal=15`). Python con SIGTERM muore subito: l'`async with` non arriva
# mai a chiudere il `BleakClient`, e il collegamento resta aperto dentro
# bluetoothd.
#
# **Un apparecchio BLE con un cliente attaccato smette di annunciarsi a tutti
# gli altri.** Da fuori e' identico a uno spento. Cosi' per **sette giorni** la
# raccolta ha scritto «la Bluetti non si sente» ogni mezz'ora -- 58 giri di
# fila -- mentre la macchina funzionava benissimo, e io ho fatto fare al
# proprietario prove inutili: spegnere, accendere, chiudere l'app, cambiare
# modalita', svegliare il display. Nessuna poteva funzionare: il guasto stava
# dalla nostra parte.
#
# `async with` non puo' proteggere da un segnale che uccide il processo.
# Quindi la cura non sta nel momento del collegamento, sta **dopo**: chi va a
# cercare un apparecchio e non lo sente deve chiedersi se e' lui a tenerlo
# occupato, prima di dire che non c'e'.
#
# Qui si prova la parte che decide. Il parlare con bluetoothd sta fuori: il
# testo dei suoi comandi arriva da dentro le prove, cosi' girano senza radio.
import unittest

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import collegamenti


# Quel che stampa `hcitool con` con un collegamento appeso alla Bluetti: e'
# la riga vera letta il 28/11/2026, tabulazione e spazio finale compresi.
HCITOOL_UNO = "Connections:\n\t< LE 90:70:69:35:76:F2 handle 65 state 1 lm CENTRAL \n"
HCITOOL_NESSUNO = "Connections:\n"
HCITOOL_DUE = (
    "Connections:\n"
    "\t< LE 90:70:69:35:76:F2 handle 65 state 1 lm CENTRAL \n"
    "\t< LE 37:73:1E:04:2D:C3 handle 64 state 1 lm CENTRAL \n"
)

# Quel che stampa `bluetoothctl info <indirizzo>`, accorciato ai campi che
# contano. **Il nome lo sa bluetoothd anche mentre l'apparecchio non si
# annuncia**: e' per questo che si puo' riconoscere chi ci tiene occupati
# senza avere l'indirizzo scritto da nessuna parte.
INFO_BLUETTI = (
    "Device 90:70:69:35:76:F2 (public)\n"
    "\tName: EL3002605110301917\n"
    "\tAlias: Bluetti del camper\n"
    "\tPaired: no\n"
    "\tConnected: yes\n"
)
INFO_ECTIVE = (
    "Device 37:73:1E:04:2D:C3 (random)\n"
    "\tName: NWJ20220412010323\n"
    "\tConnected: yes\n"
)


class ProveIndirizziCollegati(unittest.TestCase):

    def test_un_collegamento_appeso_si_legge(self):
        self.assertEqual(collegamenti.indirizzi_collegati(HCITOOL_UNO),
                         ["90:70:69:35:76:F2"])

    def test_senza_collegamenti_la_lista_e_vuota(self):
        # Il caso normale, e il piu' importante: non deve inventarsi niente da
        # staccare.
        self.assertEqual(collegamenti.indirizzi_collegati(HCITOOL_NESSUNO), [])

    def test_due_collegamenti_vengono_tutti_e_due(self):
        self.assertEqual(collegamenti.indirizzi_collegati(HCITOOL_DUE),
                         ["90:70:69:35:76:F2", "37:73:1E:04:2D:C3"])

    def test_un_testo_che_non_c_entra_niente_non_fa_danni(self):
        # Se `hcitool` non c'e' o cambia formato, meglio «nessuno» che una
        # riga interpretata a caso: staccare l'apparecchio sbagliato
        # interromperebbe una lettura buona.
        for sciocchezza in ("", "comando non trovato", "Connections:\n\t< LE handle 65\n"):
            self.assertEqual(collegamenti.indirizzi_collegati(sciocchezza), [],
                             f"ha trovato un indirizzo in «{sciocchezza}»")


class ProveIlNome(unittest.TestCase):

    def test_il_nome_si_estrae(self):
        self.assertEqual(collegamenti.nome_collegato(INFO_BLUETTI),
                         "EL3002605110301917")

    def test_l_alias_non_viene_preso_per_il_nome(self):
        # `Alias` e' una riga vicina e si assomiglia -- e l'alias lo puo'
        # cambiare chi vuole, mentre il prefisso che cerchiamo (`EL300`) sta
        # nel nome che l'apparecchio dichiara. Qui l'alias e' «Bluetti del
        # camper»: se la lettura prendesse quello, il riconoscimento per
        # prefisso fallirebbe e torneremmo a dire «non si sente».
        self.assertEqual(collegamenti.nome_collegato(INFO_BLUETTI),
                         "EL3002605110301917")
        self.assertNotIn("Bluetti del camper", collegamenti.nome_collegato(INFO_BLUETTI))

    def test_senza_nome_torna_none(self):
        # Un apparecchio senza nome esiste, e `None` si distingue da "".
        self.assertIsNone(collegamenti.nome_collegato(
            "Device AA:BB:CC:DD:EE:FF (public)\n\tConnected: yes\n"))

    def test_un_errore_di_bluetoothctl_non_e_un_nome(self):
        self.assertIsNone(collegamenti.nome_collegato("Device AA:BB:CC:DD:EE:FF not available"))


class ProveChiTieneOccupato(unittest.TestCase):
    """Dato chi e' collegato, chi di questi e' l'apparecchio che cerco."""

    def nomi(self):
        return {"90:70:69:35:76:F2": "EL3002605110301917",
                "37:73:1E:04:2D:C3": "NWJ20220412010323"}

    def test_lo_trova_dal_prefisso_del_nome(self):
        # Il caso del 21/11: cerco EL300, non si annuncia, e il collegamento
        # appeso e' proprio il suo.
        self.assertEqual(
            collegamenti.chi_tiene_occupato("EL300", list(self.nomi()),
                                            self.nomi().get),
            "90:70:69:35:76:F2")

    def test_il_prefisso_non_guarda_le_maiuscole(self):
        self.assertEqual(
            collegamenti.chi_tiene_occupato("el300", list(self.nomi()),
                                            self.nomi().get),
            "90:70:69:35:76:F2")

    def test_un_collegamento_a_un_altro_apparecchio_non_si_tocca(self):
        # **La prova piu' importante.** Mentre la scatoletta legge una Ective,
        # il suo collegamento compare in `hcitool con`. Staccarlo perche'
        # stiamo cercando la Bluetti romperebbe una lettura buona -- cioe'
        # faremmo a un altro il danno che vogliamo riparare.
        self.assertIsNone(
            collegamenti.chi_tiene_occupato("EL300", ["37:73:1E:04:2D:C3"],
                                            self.nomi().get))

    def test_senza_collegamenti_non_c_e_nessun_colpevole(self):
        # Se non teniamo niente e l'apparecchio tace, allora tace per davvero:
        # e questa e' la risposta onesta, non «riprovo a staccare qualcosa».
        self.assertIsNone(collegamenti.chi_tiene_occupato("EL300", [], self.nomi().get))

    def test_un_collegamento_senza_nome_non_si_stacca_per_sospetto(self):
        # Un indirizzo di cui bluetoothd non sa il nome potrebbe essere
        # qualunque cosa, anche di un vicino. Nel dubbio non si tocca.
        self.assertIsNone(
            collegamenti.chi_tiene_occupato("EL300", ["AA:BB:CC:DD:EE:FF"],
                                            lambda _i: None))

    def test_fra_due_candidati_si_prende_quello_col_nome_giusto(self):
        self.assertEqual(
            collegamenti.chi_tiene_occupato("NWJ", list(self.nomi()),
                                            self.nomi().get),
            "37:73:1E:04:2D:C3")


if __name__ == "__main__":
    unittest.main()
