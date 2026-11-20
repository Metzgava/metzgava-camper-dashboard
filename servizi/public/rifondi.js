// Porta il DOM vivo a somigliare a quello nuovo, toccando solo le differenze.
//
// Perche' esiste. Fino a oggi la pagina si rifaceva cosi':
//
//     $('#app').innerHTML = guscio(dentro);
//
// Una riga, e distrugge tutto per ricostruirlo identico tranne un numero. Da
// quella riga vengono tre guai che sembravano slegati:
//
// 1. **I tasti rotti.** Il 19/11/2026, col vivo acceso, la pagina si rifaceva
//    ogni due secondi e mezzo. Un tocco su un telefono dura qualche decimo di
//    secondo: se il ridisegno capitava in mezzo, il dito finiva su un tasto
//    che non esisteva piu'. «Riassocia l'apparecchio» premuto piu' volte,
//    nessuna richiesta arrivata al server. Il rimedio di allora fu smettere di
//    ridisegnare per dieci secondi dopo ogni tocco — cioe' curare il tempo
//    reale per salvare i tasti.
// 2. **Niente animazioni.** Una transizione CSS ha bisogno che l'elemento sia
//    lo stesso prima e dopo. Se lo si butta e ricrea, non c'e' un «prima» da
//    cui partire: ogni numero salta, ogni lancetta si teletrasporta.
// 3. **La pagina che scatta.** Posizione dello scorrimento, fuoco, selezione:
//    tutto perso a ogni giro.
//
// Confrontare invece di sostituire li chiude tutti e tre in una volta, e senza
// toccare una riga delle viste: restano funzioni che tornano HTML.
//
// Cosa NON fa. Non e' un framework e non tiene uno stato: ogni giro parte
// dall'HTML nuovo e dal DOM vivo, e non si ricorda niente del giro prima. Se
// un giorno servisse di piu', la cosa da guardare e' morphdom — che fa questo
// e qualche caso in piu'. Qui bastano cento righe lette da chi le mantiene.

// L'identita' di un elemento, quando ne ha una. Un `id` vuol dire «questo
// nodo e' questo nodo anche se si sposta»: cosi' un riquadro che cambia di
// posto nell'elenco viene spostato, non ricreato.
const haId = n => n.nodeType === 1 && !!n.id;

// Due nodi si possono far combaciare se sono della stessa specie. L'id e'
// vincolante in entrambi i versi: se il vecchio ha un id e il nuovo no, non si
// trasforma il vecchio — potrebbe servire piu' avanti nell'elenco, e
// trasformarlo lo perderebbe per sempre.
function paragonabili(v, n) {
  if (v.nodeType !== n.nodeType) return false;
  if (v.nodeType !== 1) return true;                  // testo, commento
  if (v.nodeName !== n.nodeName) return false;
  return (v.id || '') === (n.id || '');
}

function sincronizzaAttributi(v, n) {
  // Prima si levano quelli spariti. Al contrario — mettere e poi levare —
  // `class` passerebbe per un istante dal vecchio al nuovo valore due volte.
  for (const a of Array.from(v.attributes)) {
    if (!n.hasAttribute(a.name)) v.removeAttribute(a.name);
  }
  for (const a of Array.from(n.attributes)) {
    if (v.getAttribute(a.name) !== a.value) v.setAttribute(a.name, a.value);
  }

  // `value` e `checked` sono un caso a parte: su una casella l'attributo e la
  // proprieta' si scollegano appena qualcuno ci scrive dentro, e dopo quel
  // momento e' la proprieta' che si vede. Quindi la si allinea a mano — ma
  // **mai su quella che ha il fuoco**: la' dentro c'e' quel che si sta
  // battendo, e vale piu' di un numero arrivato dal server mezzo secondo fa.
  const scrivendo = v.ownerDocument && v === v.ownerDocument.activeElement;
  if (scrivendo) return;
  if ('value' in v && n.hasAttribute('value')) {
    const atteso = n.getAttribute('value');
    if (v.value !== atteso) v.value = atteso;
  }
  if ('checked' in v && typeof v.checked === 'boolean') {
    const atteso = n.hasAttribute('checked');
    if (v.checked !== atteso) v.checked = atteso;
  }
}

function rifondiNodo(v, n) {
  if (v.nodeType !== 1) {
    if (v.nodeValue !== n.nodeValue) v.nodeValue = n.nodeValue;
    return;
  }
  // Un elemento marcato `data-fermo` lo governa la pagina per conto suo — il
  // conto alla rovescia nell'angolo del quadrante, che si riscrive ogni
  // secondo con il suo testo e la sua classe. L'HTML delle viste lo dichiara
  // vuoto, quindi rifonderlo lo svuoterebbe a ogni giro: lampeggerebbe. Non si
  // tocca niente, nemmeno gli attributi.
  if (v.hasAttribute('data-fermo')) return;
  sincronizzaAttributi(v, n);
  rifondiFigli(v, n);
}

function rifondiFigli(vecchio, nuovo) {
  // Dove stanno i figli con id, per ritrovarli se l'ordine e' cambiato.
  const perId = new Map();
  for (let f = vecchio.firstChild; f; f = f.nextSibling) {
    if (haId(f) && !perId.has(f.id)) perId.set(f.id, f);
  }

  let v = vecchio.firstChild;
  let n = nuovo.firstChild;

  while (n) {
    // Si prende adesso: `n` sta per essere spostato nell'albero vivo, e dopo
    // lo spostamento non ha piu' i fratelli di prima.
    const prossimoN = n.nextSibling;
    let bersaglio = null;

    if (haId(n) && perId.has(n.id)) {
      bersaglio = perId.get(n.id);
      perId.delete(n.id);
      if (bersaglio === v) {
        v = v.nextSibling;                 // e' gia' al suo posto
      } else {
        vecchio.insertBefore(bersaglio, v);  // lo si porta qui
      }
    } else if (v && paragonabili(v, n)) {
      bersaglio = v;
      v = v.nextSibling;
    }

    if (bersaglio) rifondiNodo(bersaglio, n);
    else vecchio.insertBefore(n, v);        // nodo nuovo: lo si sposta qui

    n = prossimoN;
  }

  // Quel che e' rimasto in coda non serve piu'.
  while (v) {
    const prossimo = v.nextSibling;
    vecchio.removeChild(v);
    v = prossimo;
  }
}

// L'unica porta d'ingresso: un contenitore vivo e l'HTML che dovrebbe avere
// dentro.
//
// L'HTML si fa interpretare da un `div` di servizio e non da un `template`: il
// contenuto di un template vive in un documento a parte, e i nodi andrebbero
// adottati prima di spostarli. Da un div nascono nello stesso documento, e
// `<svg>` nasce comunque nello spazio dei nomi giusto perche' e' l'analizzatore
// HTML a deciderlo, non noi.
export function rifondi(vivo, html) {
  const banco = vivo.ownerDocument.createElement('div');
  banco.innerHTML = html;
  rifondiFigli(vivo, banco);
}
