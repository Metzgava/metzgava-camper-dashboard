// Quando il cloud di Bluetti ci lascia a piedi, e per quanto.
//
// Il 19/11/2026 e' stato in avaria **due ore**: il quadrante mostrava una
// carica di novanta minuti prima, e un loro timeout ha portato giu' la pagina
// per sedici secondi. E' l'argomento piu' forte per leggere la Bluetti via
// Bluetooth invece che dal loro server.
//
// Ma e' **un** episodio. Se capita una volta ogni sei mesi il guadagno di quel
// lavoro e' modesto; se capita ogni due settimane e' la prima cosa da fare.
// Quel numero non ce l'abbiamo, e deciderlo senza sarebbe un gusto travestito
// da scelta tecnica. Quindi prima si guarda, per qualche settimana.
//
// **Si segnano i passaggi, non i tentativi.** Una riga a ogni lettura fallita
// riempirebbe la tabella di rumore, e non direbbe comunque la **durata** --
// che e' la cosa che conta, perche' «due ore» e' quel che fa danno, non «e'
// fallita una volta».

const durata = minuti => {
  if (minuti < 60) return `${minuti} minuti`;
  const ore = Math.floor(minuti / 60), resto = minuti % 60;
  const h = ore === 1 ? 'un’ora' : `${ore} ore`;
  return resto ? `${h} e ${resto} minuti` : h;
};

/**
 * Il passaggio da raccontare, o `null` se non e' cambiato niente.
 *
 * `prima` e' lo stato dell'ultima volta (`{ ok, da }`) oppure `null` al primo
 * giro. Il nuovo stato torna dentro il passaggio: chi chiama lo tiene da
 * parte e lo ripassa, senza che questo modulo si ricordi niente da solo --
 * cosi' si prova senza orologi veri.
 */
export function passaggioCloud(prima, ok, adesso = Date.now(), dettaglio = '') {
  const stato = { ok: !!ok, da: adesso };
  // Primo giro: se va, non e' una notizia. Se non va, l'avaria comincia qui.
  if (!prima) {
    if (ok) return null;
    return { tipo: 'cloud-giu', minuti: 0, stato,
      testo: `Il cloud di Bluetti non risponde${dettaglio ? ` (${dettaglio})` : ''}.` };
  }
  if (prima.ok === !!ok) return null;          // niente di nuovo da dire
  const minuti = Math.round((adesso - prima.da) / 60_000);
  return ok
    ? { tipo: 'cloud-su', minuti, stato,
        testo: `Il cloud di Bluetti risponde di nuovo: era giu’ da ${durata(minuti)}.` }
    : { tipo: 'cloud-giu', minuti: 0, stato,
        testo: `Il cloud di Bluetti non risponde${dettaglio ? ` (${dettaglio})` : ''}.` };
}
