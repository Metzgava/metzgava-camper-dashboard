// Quanto sono vecchi i dati che arrivano dal camper.
//
// Prove: test/eta-dei-dati.test.js, che raccontano perche' esiste.
//
// In breve: in testata c'era `letto alle HH:MM`, e dietro c'era
// `letto_il: new Date()` -- l'istante in cui il **server** ha composto la
// risposta. Dice quanto fa hai ricaricato la pagina, e sembra dire quanto
// sono freschi i dati. Il 28/11/2026 ha ingannato chi ha scritto il codice,
// mentre cercava di sapere se la scatoletta stesse mandando.
//
// Qui si calcola la cosa vera: **da quanto non parla il camper**.

// Il cloud Bluetti non viene dal camper: e' l'unico che scrive questa fonte,
// e passa da internet senza toccare la scatoletta. Puo' essere freschissimo
// mentre la scatoletta tace da un'ora.
//
// La regola e' **negativa apposta**: il nome che la scatoletta si da' sta in
// `config.json` (`conf["nome"]`) e il proprietario lo puo' cambiare, quindi
// non si puo' scrivere qui quale sia. Si sa invece con certezza quale non e'.
const CLOUD = 'bluetti';

/**
 * `{ quando, eta_minuti }` della lettura piu' fresca arrivata dal camper.
 *
 * Entrambi `null` quando non ce n'e' nessuna: **zero vorrebbe dire
 * «freschissima»**, e «non ne ho mai avute» e' un'altra affermazione.
 *
 * L'eta' non scende mai sotto zero: la scatoletta e il server hanno due
 * orologi, e «dati di -3 minuti fa» non si legge.
 */
export function etaDeiDati(righe, adesso = new Date()) {
  const ora = new Date(adesso).getTime();
  let ultima = null;
  for (const r of righe || []) {
    if (String(r?.fonte || '') === CLOUD) continue;
    const t = new Date(r?.quando).getTime();
    if (!Number.isFinite(t)) continue;           // una data storta si salta
    if (ultima == null || t > ultima) ultima = t;
  }
  if (ultima == null) return { quando: null, eta_minuti: null };
  return {
    quando: new Date(ultima).toISOString(),
    eta_minuti: Math.max(0, Math.round((ora - ultima) / 60000)),
  };
}
