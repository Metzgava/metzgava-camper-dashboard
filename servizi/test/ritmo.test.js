// La pagina vuole sapere fra quanto arriva la lettura successiva, per mostrare
// un conto alla rovescia e ricaricarsi da sola quando scade.
//
// Quel momento lo sa solo il server, perche' il giro periodico vive li'. E non
// si puo' dedurre dall'ora dell'ultima lettura mostrata: quella puo' essere un
// ripiego vecchio di mezz'ora, mentre il giro continua a scattare puntuale.
// Da qui un posto solo che tiene il ritmo, scritto dal giro e letto da /stato.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { passoMinuti, segnaGiro, prossimoGiro, dimentica } from '../src/lib/ritmo.js';

const conPasso = (valore, f) => {
  const prima = process.env.LETTURE_MINUTI;
  if (valore === null) delete process.env.LETTURE_MINUTI;
  else process.env.LETTURE_MINUTI = String(valore);
  try { f(); } finally {
    if (prima === undefined) delete process.env.LETTURE_MINUTI;
    else process.env.LETTURE_MINUTI = prima;
  }
};

test('prima che sia girato qualcosa non si inventa un orario', () => {
  dimentica();
  assert.equal(prossimoGiro(), null);
});

test('dopo un giro, il prossimo e’ un passo piu’ in la’', () => {
  dimentica();
  conPasso(5, () => {
    const t = new Date('2026-11-18T14:00:00Z');
    segnaGiro(t);
    assert.equal(prossimoGiro()?.toISOString(), '2026-11-18T14:05:00.000Z');
  });
});

test('col passo a zero le letture sono spente: nessun orario da promettere', () => {
  dimentica();
  conPasso(0, () => {
    segnaGiro(new Date('2026-11-18T14:00:00Z'));
    assert.equal(prossimoGiro(), null);
  });
});

test('senza la variabile il passo e’ quindici minuti', () => {
  conPasso(null, () => assert.equal(passoMinuti(), 15));
});

test('un passo scritto storto non diventa NaN: si torna alla riserva', () => {
  // Una variabile d'ambiente e' una stringa che scrive una persona, e una
  // persona puo' scriverci «un minuto». Meglio il valore di riserva che un
  // conto alla rovescia che dice NaN.
  conPasso('un minuto', () => assert.equal(passoMinuti(), 15));
});

test('il giro successivo si sposta a ogni giro, non resta quello del primo', () => {
  dimentica();
  conPasso(1, () => {
    segnaGiro(new Date('2026-11-18T14:00:00Z'));
    segnaGiro(new Date('2026-11-18T14:01:00Z'));
    assert.equal(prossimoGiro()?.toISOString(), '2026-11-18T14:02:00.000Z');
  });
});
