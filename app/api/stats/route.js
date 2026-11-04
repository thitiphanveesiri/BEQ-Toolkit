import { route } from '../../../lib/api.js';
import { stats } from '../../../lib/records.js';

const ok = (s) => (/^\d{4}-\d{2}-\d{2}$/.test(s || '') ? s : '');
export const GET = route({ perm: 'viewStats' }, async ({ req }) => {
  const p = new URL(req.url).searchParams;
  return stats({ from: ok(p.get('from')), to: ok(p.get('to')) });
});
