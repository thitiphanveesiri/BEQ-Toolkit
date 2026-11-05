import { route } from '../../../lib/api.js';
import { reminders } from '../../../lib/records.js';
import { ownedOpds } from '../../../lib/scope.js';

// แจ้งเตือนนัด F/U ที่ใกล้ถึง: แพทย์เห็นเฉพาะคนไข้ในความดูแลของตัวเอง
export const GET = route({ perm: 'viewImages' }, async ({ user }) => ({ rows: await reminders(await ownedOpds(user)) }));
