import { route } from '../../../../lib/api.js';
import { autofill } from '../../../../lib/records.js';

export const GET = route({ perm: 'fillForm' }, async ({ req }) => {
  const opd = new URL(req.url).searchParams.get('opd') || '';
  return { data: opd.trim().length < 2 ? null : await autofill(opd) };
});
