import { route, audit } from '../../../lib/api.js';
import { addRecord } from '../../../lib/db.js';
import { cleanRecord, findDuplicate, getFormOptions } from '../../../lib/records.js';
import { prepareFolders } from '../../../lib/drive.js';
import { AppError } from '../../../lib/errors.js';

export const POST = route({ perm: 'fillForm' }, async ({ req, user, body }) => {
  const rec = cleanRecord(body?.formType, body?.data, await getFormOptions(body?.formType));
  if (!body?.force && (await findDuplicate(rec))) {
    throw Object.assign(new AppError(409, `OPD ${rec.opd} มีฟอร์มนี้ของวันที่ ${rec.date}${rec.visitPeriod ? ' ระยะ ' + rec.visitPeriod : ''} อยู่แล้ว`), { dup: true });
  }
  const saved = await addRecord({ ...rec, createdBy: user.id });
  await prepareFolders(saved).catch(() => {}); // สร้างโฟลเดอร์ใน Drive ล่วงหน้าทีละอัน กันโฟลเดอร์ซ้ำ
  audit(req, user, 'record_create', saved.id, `${rec.formType} ${rec.opd}`);
  return { id: saved.id, opd: saved.opd };
});
