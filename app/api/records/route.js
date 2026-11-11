import { route, audit } from '../../../lib/api.js';
import { addRecord, listRecords, updateRecord } from '../../../lib/db.js';
import { cleanRecord, findDuplicate, findDay0, latestRound, lockBasics, existingCell, getFormOptions } from '../../../lib/records.js';
import { prepareFolders } from '../../../lib/drive.js';
import { AppError } from '../../../lib/errors.js';
import { canFill } from '../../../lib/roles.js';

export const POST = route({ perm: 'fillForm' }, async ({ req, user, body }) => {
  if (!canFill(user, body?.formType)) throw new AppError(403, 'บัญชีนี้ไม่มีสิทธิ์กรอกฟอร์มนี้');
  // ฟอร์ม F/U: ช่องเซลล์ล็อก — ใช้เซลล์เดิมของคนไข้ (ไม่รับค่าจากฟอร์ม)
  const input = body?.formType === 'case' ? { ...body?.data, cell: undefined } : body?.data;
  const rec = await lockBasics(cleanRecord(body?.formType, input, await getFormOptions(body?.formType)));
  if (rec.formType === 'case') rec.cell = await existingCell(rec.opd);
  if (rec.formType === 'case') rec.round = await latestRound(rec.opd);
  // Day 0 ซ้ำ HN เดิมและครั้งที่เดิม → อัปเดตข้อมูลเดิม (คงวันที่มาปลูกเดิม) และรูปใหม่จะเข้าชุดเดิม/โฟลเดอร์เดิม
  if (rec.formType === 'day0') {
    const old = await findDay0(rec);
    if (old) {
      const saved = await updateRecord({ ...old, ...rec, date: old.date, note: rec.note || old.note, createdBy: old.createdBy, createdAt: old.createdAt });
      await prepareFolders(saved).catch(() => {});
      audit(req, user, 'record_update_day0', saved.id, `day0 ${rec.opd} ${rec.round}`);
      return { id: saved.id, opd: saved.opd, updated: true };
    }
  } else if (!body?.force && (await findDuplicate(rec))) {
    throw Object.assign(new AppError(409, `OPD ${rec.opd} มีฟอร์มนี้ของวันที่ ${rec.date}${rec.visitPeriod ? ' ระยะ ' + rec.visitPeriod : ''} อยู่แล้ว`), { dup: true });
  }
  const saved = await addRecord({ ...rec, createdBy: user.id });
  await prepareFolders(saved).catch(() => {}); // สร้างโฟลเดอร์ใน Drive ล่วงหน้าทีละอัน กันโฟลเดอร์ซ้ำ
  audit(req, user, 'record_create', saved.id, `${rec.formType} ${rec.opd}`);
  return { id: saved.id, opd: saved.opd };
});
