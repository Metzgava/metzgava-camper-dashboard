// Un archivio finto per le prove, senza Postgres.
//
// `db.js` fa `process.exit(1)` all'importazione se manca DATABASE_URL, quindi
// gliene si da' uno finto **prima** di importarlo. `pg.Pool` non si collega
// alla costruzione, quindi nessuna connessione parte davvero; e `q` chiama
// `pool.query` a ogni invocazione, quindi sostituire quel metodo basta.
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://finto:finto@finto/finto';

const { pool } = await import('../../src/lib/db.js');

export function archivio(risposte) {
  const fatte = [];
  pool.query = async (testo, parametri = []) => {
    const s = String(testo).replace(/\s+/g, ' ').trim();
    fatte.push({ s, parametri });
    for (const [spia, risposta] of risposte) {
      if (s.includes(spia)) {
        const r = typeof risposta === 'function' ? risposta(parametri) : risposta;
        return { rows: r || [], rowCount: (r || []).length };
      }
    }
    return { rows: [], rowCount: 0 };
  };
  return fatte;
}
