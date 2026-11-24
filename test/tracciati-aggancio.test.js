// Di quale tappa e' un tragitto, e come si cuciono le tappe unite.
//
// Disegno: docs/superpowers/specs/2026-11-24-tracciati-veri-design.md
//
// L'aggancio si fa **per data e finestra di orari**, non per identificativo.
// E' la regola che regge le tappe unite: quando si importa, i tragitti
// separati da una sosta breve diventano una tappa sola, e nei tracciati
// restano separati. Con la finestra si ritrovano tutti.
//
// **Un tragitto che cade in due tappe, o in nessuna, non si attacca.** Meglio
// una tappa senza traccia che una traccia sulla tappa sbagliata: una
// ricostruzione la si mette in dubbio, un tracciato vero no.
import test from 'node:test';
import assert from 'node:assert/strict';
import { finestraDellaTappa, tragittiDellaTappa, assegna, cuci } from '../src/lib/tracciati.js';

const q = s => new Date(s.replace(' ', 'T')).getTime();
const tragitto = (id, da, a, punti) => ({ id, da: q(da), a: q(a),
  punti: punti.map(([lat, lon], i) => ({ t: q(da) + i * 15000, lat, lon })) });

const TRAGITTO_1118 = tragitto(1, '2026-11-21 11:18:29', '2026-11-21 14:02:04', [[46.05, 11.45], [46.08, 13.19]]);
const TRAGITTO_0930 = tragitto(1, '2026-11-21 09:30:00', '2026-11-21 10:00:00', [[46.0, 11.4], [46.0, 11.6]]);
const TRAGITTO_1300 = tragitto(2, '2026-11-21 13:00:00', '2026-11-21 13:40:00', [[46.0, 11.6], [46.0, 11.9]]);
const TRAGITTO_2345 = tragitto(3, '2026-11-20 23:45:00', '2026-11-21 00:10:00', [[45.9, 12.0], [45.9, 12.2]]);
const TRAGITTO_A = tragitto(4, '2026-11-21 09:00:00', '2026-11-21 09:30:00', [[45, 11], [45.1, 11.1]]);
const TRAGITTO_B = tragitto(5, '2026-11-21 10:00:00', '2026-11-21 10:30:00', [[45.3, 11.3], [45.4, 11.4]]);

const tappa = (o) => ({ id: 1, mezzo: 'camper', ...o });

test('un tragitto dentro la finestra della tappa le appartiene', () => {
  const t = tappa({ date: '2026-11-21', start_time: '11:18', end_time: '14:02' });
  assert.equal(tragittiDellaTappa([TRAGITTO_1118], t).length, 1);
});

test('una tappa unita si prende tutti i suoi tragitti, in ordine', () => {
  const t = tappa({ date: '2026-11-21', start_time: '09:00', end_time: '14:00' });
  const dentro = tragittiDellaTappa([TRAGITTO_1300, TRAGITTO_0930], t);
  assert.deepEqual(dentro.map(x => x.id), [1, 2], 'non sono in ordine di tempo');
});

test('una tappa senza orari non aggancia niente', () => {
  // Senza finestra non c'e' modo di sbagliare con prudenza.
  assert.equal(finestraDellaTappa(tappa({ date: '2026-11-21' })), null);
  assert.equal(tragittiDellaTappa([TRAGITTO_1118], tappa({ date: '2026-11-21' })).length, 0);
});

test('una tappa che non e’ in camper non aggancia niente', () => {
  // Un traghetto non segue le statali: e' la stessa regola dei luoghi
  // dichiarati.
  assert.equal(finestraDellaTappa({ id: 1, mezzo: 'traghetto', date: '2026-11-21',
    start_time: '11:18', end_time: '14:02' }), null);
});

test('un tragitto che scavalca la mezzanotte non si perde', () => {
  // 23:45 -> 00:10 e' una tappa sola, non due.
  const t = tappa({ date: '2026-11-20', start_time: '23:40', end_time: '00:20' });
  const f = finestraDellaTappa(t);
  assert.ok(f.a > f.da, 'la finestra si chiude prima di aprirsi');
  assert.equal(tragittiDellaTappa([TRAGITTO_2345], t).length, 1);
});

test('un tragitto che cade in due tappe non si attacca a nessuna', () => {
  const a = tappa({ id: 1, date: '2026-11-21', start_time: '11:00', end_time: '15:00' });
  const b = tappa({ id: 2, date: '2026-11-21', start_time: '11:10', end_time: '12:00' });
  const r = assegna([TRAGITTO_1118], [a, b]);
  assert.equal(r.perTappa.size, 0, 'ha scelto una tappa a caso fra due');
  assert.equal(r.fuori.length, 1);
});

test('un tragitto che non cade in nessuna tappa finisce fuori', () => {
  const r = assegna([TRAGITTO_1118], [tappa({ date: '2026-08-03', start_time: '08:46', end_time: '10:43' })]);
  assert.equal(r.fuori.length, 1);
  assert.equal(r.perTappa.size, 0);
});

// Il nome di prima era «la cucitura mette i buchi delle soste, non una riga
// continua», e la revisione del 24/11/2026 ha fatto notare che **non lo
// provava**: misurava la lunghezza e i due capi, cioe' passava su qualunque
// concatenazione -- compresa quella continua, che e' quel che `cuci` fa
// davvero. Una prova che afferma col suo nome una cosa che il codice non fa
// e' peggio di nessuna prova: fa sembrare coperta la cosa piu' delicata.
//
// I buchi **non ci sono**, e per metterli servirebbe cambiare il formato
// della geometria (una riga per segmento) in tutti i posti che la disegnano e
// la misurano, mappa dell'ospite compresa. Deciso di non farlo adesso: fra
// due tragitti uniti in una tappa sola il camper e' fermo nello stesso posto,
// quindi il segmento che li unisce e' lungo pochi metri e non si vede. Il
// caso in cui si vedrebbe -- un tragitto estraneo finito nella finestra -- lo
// copre `tracciaPiuLunga` in pagina, che lo dice invece di disegnarlo e
// tacere.
//
// Quel che la prova prova davvero, col nome giusto:
test('la cucitura tiene tutti i punti dei suoi tragitti, in ordine', () => {
  const riga = cuci([TRAGITTO_A, TRAGITTO_B]);
  assert.equal(riga.length, TRAGITTO_A.punti.length + TRAGITTO_B.punti.length,
    'un punto per punto: non si perde ne’ si duplica niente');
  assert.deepEqual(riga[0], [45, 11], 'si parte dal primo punto del primo tragitto');
  assert.deepEqual(riga[riga.length - 1], [45.4, 11.4], 'e si finisce sull’ultimo dell’ultimo');
});

test('i punti si campionano, ma i capi restano', () => {
  const tanti = { id: 1, da: 0, a: 1, punti: Array.from({ length: 2000 },
    (_, i) => ({ t: i, lat: 45 + i / 1e5, lon: 12 })) };
  const riga = cuci([tanti], { massimo: 600 });
  // `samplePoints` avanza con un passo in virgola mobile e poi aggiunge
  // comunque l'ultimo punto: puo' sforare di due. E' il campionatore gia' in
  // uso per le strade calcolate, e due punti su seicento non si vedono.
  assert.ok(riga.length <= 602, `ne ha tenuti ${riga.length}`);
  assert.deepEqual(riga[0], [45, 12]);
  assert.deepEqual(riga[riga.length - 1], [45 + 1999 / 1e5, 12]);
});

test('senza tragitti non si cuce niente', () => {
  assert.deepEqual(cuci([]), []);
  assert.deepEqual(cuci(null), []);
});
