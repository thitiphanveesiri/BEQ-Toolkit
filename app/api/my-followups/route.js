import { route } from '../../../lib/api.js';
import { assignedFollowups } from '../../../lib/records.js';

export const GET = route({ perm: 'viewFollowups' }, async ({ user }) => ({ rows: await assignedFollowups(user) }));
