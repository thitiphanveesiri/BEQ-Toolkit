import { route } from '../../../../lib/api.js';
import { autofill } from '../../../../lib/records.js';
import { can } from '../../../../lib/roles.js';

export const GET = route({ perm: 'fillForm' }, async ({ req, user }) => {
  const opd = new URL(req.url).searchParams.get('opd') || '';
  const r = opd.trim().length < 2 ? null : await autofill(opd);
  return { data: r?.data ?? null, meta: r?.meta ?? null, day0: can(user, 'viewDay0') ? r?.day0 ?? [] : [] };
});
