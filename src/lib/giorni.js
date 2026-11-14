// I giorni teorici.
//
// Un viaggio si pensa per giorni prima che per date: «il secondo giorno si
// scende a Trento», e la partenza si decide dopo, quando si sa delle ferie. Qui
// i numeri diventano date, una volta sola.
//
// Tutto passa per mezzogiorno UTC. Sommare giorni all'ora zero locale e'
// il modo classico di perdere un giorno la notte in cui cambia l'ora: a
// mezzogiorno nessuno sposta niente.
const MEZZOGIORNO = 12 * 3600 * 1000;

const comeGiornata = v => {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null
    : Date.UTC(v.getUTCFullYear(), v.getUTCMonth(), v.getUTCDate()) + MEZZOGIORNO;
  const m = String(v ?? '').trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const [a, me, g] = [+m[1], +m[2], +m[3]];
  const t = Date.UTC(a, me - 1, g) + MEZZOGIORNO;
  const d = new Date(t);
  // Il 45 novembre: Date lo accetta e scivola a dicembre, e una data che non
  // esiste non deve diventare un'altra data
  if (d.getUTCFullYear() !== a || d.getUTCMonth() !== me - 1 || d.getUTCDate() !== g) return null;
  return t;
};

const scritta = t => new Date(t).toISOString().slice(0, 10);

// Il giorno 1 e' il giorno della partenza: si sommano i giorni passati, non i
// giorni contati.
export function dataDelGiorno(partenza, giorno) {
  const p = comeGiornata(partenza);
  const n = Number(giorno);
  if (p == null || !Number.isInteger(n) || n < 1) return null;
  return scritta(p + (n - 1) * 86400000);
}

// Il contrario: serve a mostrare «giorno 3» anche a chi ha gia' la sua data.
export function giornoDellaData(partenza, data) {
  const p = comeGiornata(partenza), d = comeGiornata(data);
  if (p == null || d == null) return null;
  const n = Math.round((d - p) / 86400000) + 1;
  return n >= 1 ? n : null;
}
