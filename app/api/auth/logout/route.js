import { route, audit } from '../../../../lib/api.js';
import { endSession, currentUser } from '../../../../lib/auth.js';

export const POST = route({ public: true }, async ({ req }) => {
  const u = await currentUser();
  await endSession();
  if (u) audit(req, u, 'logout');
  return { ok: true };
});
