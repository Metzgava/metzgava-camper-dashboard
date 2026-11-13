// La lavagna dei posti: quello che qualcuno ha visto e vorrebbe, prima che
// diventi una tappa del viaggio. Una proposta non è ancora niente - non ha una
// data, non sta in nessun giro, non costa niente - ma ha un nome, un puntino,
// chi l'ha proposta e due righe di perché. È il posto dove finiscono le cose
// che prima si dicevano a voce e si perdevano.
import { Router } from 'express';
import { wrap } from '../lib/util.js';
import { requireAuth } from './auth.js';
import { leggiPosto } from '../lib/park4night.js';
import { linkPark4nightPosto } from '../lib/geo.js';

export const router = Router();
router.use(requireAuth);

// Dal codice di park4night al posto. Chi incolla un codice si aspetta che il
// nome e il puntino si riempiano da soli: è il motivo per cui il codice vale
// la pena di metterlo.
router.get('/park4night/:codice', wrap(async (req, res) => {
  const posto = await leggiPosto(req.params.codice);
  // Codice che non esiste e pagina che non si lascia leggere sono la stessa
  // cosa per chi sta scrivendo: in tutti e due i casi tocca a lui.
  if (!posto) return res.status(404).json({ error: 'Questo codice non l’ho trovato: mettilo tu sulla mappa' });
  res.json({ ...posto, link: linkPark4nightPosto(posto.p4n_id) });
}));
