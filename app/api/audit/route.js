import { route } from '../../../lib/api.js';
import { readAudit, dataMode } from '../../../lib/db.js';

export const GET = route({ perm: 'manage' }, async () => ({
  mode: dataMode(),
  drive: !!process.env.GOOGLE_REFRESH_TOKEN,
  rows: (await readAudit(100)).map(({ _row, ...r }) => r),
}));
