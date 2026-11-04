import { route } from '../../../lib/api.js';
import { searchPatients } from '../../../lib/records.js';

export const GET = route({ perm: 'viewImages' }, async ({ req }) => {
  const q = new URL(req.url).searchParams.get('q') || '';
  return searchPatients(q, 50);
});
