import { route } from '../../../lib/api.js';
import { searchPatients } from '../../../lib/records.js';
import { ownedOpds } from '../../../lib/scope.js';

export const GET = route({ perm: 'viewImages' }, async ({ req, user }) => {
  const q = new URL(req.url).searchParams.get('q') || '';
  const owned = await ownedOpds(user);
  if (!owned) return searchPatients(q, 50);
  const r = await searchPatients(q, 100000); // แพทย์: กรองเหลือเฉพาะคนไข้ในความดูแลก่อนตัดจำนวน
  const rows = r.rows.filter((x) => owned.has(x.opd));
  return { total: rows.length, rows: rows.slice(0, 50) };
});
