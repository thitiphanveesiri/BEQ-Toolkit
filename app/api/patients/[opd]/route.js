import { route, audit } from '../../../../lib/api.js';
import { patientDetail } from '../../../../lib/records.js';
import { ownedOpds } from '../../../../lib/scope.js';
import { AppError } from '../../../../lib/errors.js';

export const GET = route({ perm: 'viewImages' }, async ({ req, user, params }) => {
  const d = await patientDetail(decodeURIComponent(params.opd), { withMedia: true });
  if (!d) throw new AppError(404, 'ไม่พบคนไข้');
  const owned = await ownedOpds(user);
  if (owned && !owned.has(d.opd)) throw new AppError(404, 'ไม่พบคนไข้'); // แพทย์ไม่เห็นคนไข้ที่ไม่ใช่เจ้าของเคส (ตอบเหมือนไม่มีข้อมูล)
  audit(req, user, 'view_patient', d.opd);
  return d;
});
