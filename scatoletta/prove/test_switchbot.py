"""Il termometro SwitchBot Outdoor Meter (WoSensorTHO, modello W3400010).

Il riferimento e' il campione che SwitchBot pubblica nella sua documentazione
(`devicetypes/meter.md`, sezione «Outdoor Temperature/Humidity Sensor»):

    Type 0xFF (costruttore): 6909 XXXXXXXXXXXX 36 03 02 96 37 00
    Type 0x16 (servizio):    3D FD 77 00 64

che vale 22,2 gradi, 55 % di umidita' e batteria al 100 %.

Una cosa che la documentazione nasconde: la sezione dell'Outdoor indicizza i
byte **contando anche i due byte dell'azienda** (6909), mentre bleak li
consegna gia' togliati. Levati quelli, gli offset sono gli stessi della
tabella generale dei Meter — quindi un decodificatore solo serve tutta la
famiglia, e la fama di «eccezione» riguarda solo i dati di servizio.
"""
import sys
import unittest
from pathlib import Path

QUI = Path(__file__).resolve().parent
sys.path.insert(0, str(QUI.parent))

from agente import switchbot_leggi, switchbot_quale, switchbot_tipo  # noqa: E402

# Come lo consegna bleak: manufacturer_data[0x0969], senza i due byte azienda.
CAMPIONE = bytes.fromhex('aabbccddeeff' + '360302963700')
SERVIZIO = bytes.fromhex('770064')          # service_data[fd3d], senza l'UUID


class ProveSwitchBot(unittest.TestCase):
    def test_il_campione_della_documentazione(self):
        letto = switchbot_leggi(CAMPIONE, SERVIZIO)
        self.assertEqual(letto["temperatura"], 22.2)
        self.assertEqual(letto["umidita"], 55)
        self.assertEqual(letto["pila"], 100)

    def test_sotto_zero(self):
        # bit7 del byte 9 a zero vuol dire negativa: -5,3 gradi.
        d = bytearray(CAMPIONE)
        d[8], d[9] = 0x03, 0x05
        self.assertEqual(switchbot_leggi(bytes(d), SERVIZIO)["temperatura"], -5.3)

    def test_il_display_in_fahrenheit_non_sporca_l_umidita(self):
        # bit7 del byte 10 dice in che unita' il DISPLAY mostra i gradi: non
        # c'entra col valore, e se non lo si maschera l'umidita' diventa 183.
        d = bytearray(CAMPIONE)
        d[10] = 0x37 | 0x80
        self.assertEqual(switchbot_leggi(bytes(d), SERVIZIO)["umidita"], 55)

    def test_senza_i_dati_di_servizio_e_senza_memoria_non_si_indovina(self):
        """Questa prova pretendeva il contrario, fino al 24/11/2026.

        Il tipo dell'apparecchio sta **solo** nei dati di servizio. Senza
        quelli, e senza averlo imparato prima, non si sa se chi parla sia un
        termometro -- e leggere i gradi da un pacchetto qualunque della
        famiglia da' un numero plausibile: e' precisamente quel che e'
        successo con l'Hub Mini.
        """
        self.assertIsNone(switchbot_leggi(CAMPIONE, None))

    def test_un_tipo_imparato_prima_fa_leggere_un_annuncio_spaiato(self):
        """Il prezzo della regola severa, pagato una volta sola.

        Misurato il 24/11/2026: «bait interno» manda cinque annunci in
        trentacinque secondi, e in un ascolto da quattordici ne sono arrivati
        solo di spaiati -- senza dati di servizio. Con la sola regola severa
        il termometro **spariva dal giro**, che e' il modo dell'errore
        opposto: un valore che si sa e non si manda.
        """
        letto = switchbot_leggi(CAMPIONE, None, tipo=0x77)
        self.assertEqual(letto["temperatura"], 22.2)
        self.assertIsNone(letto.get("pila"), "la pila sta nei dati di servizio")

    def test_un_tipo_imparato_che_non_misura_resta_un_no(self):
        self.assertIsNone(switchbot_leggi(CAMPIONE, None, tipo=0x6d))

    def test_un_pacchetto_corto_non_si_inventa(self):
        self.assertIsNone(switchbot_leggi(b'\x01\x02\x03', SERVIZIO))
        self.assertIsNone(switchbot_leggi(None, SERVIZIO))

    def test_la_batteria_si_maschera(self):
        # bit7 del byte 2 del servizio non e' carica: va tolto, o una batteria
        # al 100 % diventerebbe 228.
        self.assertEqual(switchbot_leggi(CAMPIONE, bytes.fromhex('7700e4'))["pila"], 100)

    # ------------------------------------------------------------------
    # Chi parla non e' detto che misuri
    # ------------------------------------------------------------------
    #
    # Misurato in camper il 24/11/2026: un apparecchio senza nome mandava
    # ottantanove annunci in quaranta secondi, e la scatoletta li leggeva come
    # -6,1 gradi con il 79 % di umidita'. Nel camper non c'e' nessun
    # congelatore. Erano i byte 8-10 di un pacchetto che non e' quello di un
    # termometro:
    #
    #     costruttore 0x0969: f898caf1425600ff 6b 05 d0 81
    #     servizio    0xfd3d: 6d 00
    #
    # `0x6d` e' l'Hub Mini della prima serie — un telecomando a infrarossi
    # attaccato alla 220, che di termometri non ne ha. Due byte di dati di
    # servizio invece di tre, e per quello mancava anche la pila.
    HUB_MINI = bytes.fromhex('f898caf1425600ff6b05d081')
    HUB_MINI_SERVIZIO = bytes.fromhex('6d00')

    def test_un_hub_mini_non_e_un_termometro(self):
        self.assertIsNone(switchbot_leggi(self.HUB_MINI, self.HUB_MINI_SERVIZIO))

    def test_i_sei_tipi_che_misurano_si_leggono(self):
        """Meter, Meter Plus e Indoor/Outdoor, in modo normale e in accoppiamento.

        Sono i modelli i cui gradi stanno dove li cerca questo
        decodificatore. La coppia minuscola/maiuscola e' il modo normale
        contro il modo accoppiamento, e il valore non cambia.
        """
        for tipo in (0x54, 0x74, 0x69, 0x49, 0x77, 0x57):
            with self.subTest(tipo=hex(tipo)):
                servizio = bytes([tipo, 0x00, 0x64])
                self.assertEqual(switchbot_leggi(CAMPIONE, servizio)["temperatura"], 22.2)

    def test_un_meter_pro_non_si_legge_a_questi_offset(self):
        """Il Meter Pro (0x34) e il Pro CO2 (0x35) misurano, ma altrove.

        Tenerli fuori non e' una dimenticanza: i loro gradi non stanno nei
        byte 8-10 dei dati del costruttore, quindi leggerli qui darebbe un
        numero sbagliato invece di nessun numero. Entreranno quando qualcuno
        ne avra' uno da cui misurare il formato vero.
        """
        for tipo in (0x34, 0x35, 0x14, 0x15):
            with self.subTest(tipo=hex(tipo)):
                self.assertIsNone(switchbot_leggi(CAMPIONE, bytes([tipo, 0x00, 0x64])))

    def test_il_bit_sette_del_tipo_non_e_il_tipo(self):
        # La documentazione dice di azzerare il bit 7 prima di confrontare:
        # acceso vuol dire cifrato, non «un altro apparecchio».
        servizio = bytes([0x77 | 0x80, 0x00, 0x64])
        self.assertEqual(switchbot_leggi(CAMPIONE, servizio)["temperatura"], 22.2)

    def test_un_servizio_troppo_corto_per_avere_un_tipo(self):
        self.assertIsNone(switchbot_leggi(CAMPIONE, b''))


class ProveIlTipoSiRicorda(unittest.TestCase):
    """`switchbot_quale`: impara il tipo dagli annunci che ce l'hanno.

    La memoria entra da fuori, cosi' una prova non dipende da quel che hanno
    lasciato dentro le altre.
    """
    SERVIZIO_METER = bytes.fromhex('770064')      # tipo 0x77, pila 100
    SERVIZIO_HUB = bytes.fromhex('6d00')          # tipo 0x6d, l'Hub Mini

    def test_un_annuncio_col_tipo_lo_insegna(self):
        memoria = {}
        self.assertEqual(switchbot_quale('AA:BB', self.SERVIZIO_METER, memoria), 0x77)
        self.assertEqual(memoria, {'AA:BB': 0x77})

    def test_un_annuncio_spaiato_lo_chiede_alla_memoria(self):
        memoria = {'AA:BB': 0x77}
        self.assertEqual(switchbot_quale('AA:BB', None, memoria), 0x77)

    def test_la_memoria_e_di_quell_indirizzo_e_non_di_un_altro(self):
        memoria = {'AA:BB': 0x77}
        self.assertIsNone(switchbot_quale('CC:DD', None, memoria))

    def test_senza_memoria_e_senza_tipo_non_si_inventa_un_tipo(self):
        self.assertIsNone(switchbot_quale('AA:BB', None, {}))

    def test_il_tipo_nuovo_corregge_quello_vecchio(self):
        # Non e' un caso di tutti i giorni, ma la regola giusta e' «l'ultimo
        # che ha parlato»: un indirizzo riusato da un altro apparecchio non
        # deve restare marchiato per sempre.
        memoria = {'AA:BB': 0x6d}
        self.assertEqual(switchbot_quale('AA:BB', self.SERVIZIO_METER, memoria), 0x77)

    def test_il_bit_dell_accoppiamento_non_sdoppia_la_memoria(self):
        memoria = {}
        switchbot_quale('AA:BB', bytes([0x77 | 0x80, 0x00, 0x64]), memoria)
        self.assertEqual(memoria, {'AA:BB': 0x77})

if __name__ == "__main__":
    unittest.main()
