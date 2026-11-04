import { route, audit } from '../../../../lib/api.js';
import { listRecords, updateRecord } from '../../../../lib/db.js';
import { cleanRecord, getFormOptions } from '../../../../lib/records.js';
import { AppError } from '../../../../lib/errors.js';

// ผู้ดูแลระบบแก้ไขข้อมูลที่กรอกผิดได้ (ทุกการแก้ไขถูกบันทึกใน audit)
export const PATCH = route({ perm: 'manage' }, async ({ req, user, params, body }) => {
  const rec = (await listRecords()).find((r) => r.id === params.id);
  if (!rec) throw new AppError(404, 'ไม่พบข้อมูล');
  const clean = cleanRecord(rec.formType, body?.data, await getFormOptions(rec.formType), rec);
  await updateRecord({ ...rec, ...clean });
  audit(req, user, 'record_update', rec.id, rec.opd);
  return { ok: true };
});
