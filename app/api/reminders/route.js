import { route } from '../../../lib/api.js';
import { reminders } from '../../../lib/records.js';
import { myOpds } from '../../../lib/scope.js';

// แจ้งเตือนนัด F/U ที่ใกล้ถึง: แพทย์ (role doctor) เห็นเฉพาะนัดของคนไข้ที่ตัวเองเป็นแพทย์เจ้าของเคส ส่วนบทบาทอื่นเห็นทั้งหมด
export const GET = route({ perm: 'viewImages' }, async ({ user }) => ({ rows: await reminders(await myOpds(user)) }));
