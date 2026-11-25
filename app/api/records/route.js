import { route, audit } from '../../../lib/api.js';
import { addRecord, listRecords, updateRecord } from '../../../lib/db.js';
import { cleanRecord, findDuplicate, findDay0, latestRound, lockBasics, existingAssignment, requireCellId, getFormOptions, requestIdOf, recordRequestHash } from '../../../lib/records.js';
import { prepareFolders } from '../../../lib/drive.js';
import { AppError } from '../../../lib/errors.js';
import { canFill } from '../../../lib/roles.js';

export const POST = route({ perm: 'fillForm' }, async ({ req, user, body }) => {
  if (!canFill(user, body?.formType)) throw new AppError(403, 'บัญชีนี้ไม่มีสิทธิ์กรอกฟอร์มนี้');
  const requestId = requestIdOf(body?.requestId);
  // ฟอร์ม F/U: ช่องเซลล์ล็อก — ใช้เซลล์เดิมของคนไข้ (ไม่รับค่าจากฟอร์ม)
  const input = body?.formType === 'case' ? { ...body?.data, cell: undefined } : body?.data;
  const rec = await lockBasics(cleanRecord(body?.formType, input, await getFormOptions(body?.formType)));
  if (rec.formType === 'case') {
    const assigned = await existingAssignment(rec.opd);
    rec.cell = assigned.cell; rec.cellId = assigned.cellId; rec.round = await latestRound(rec.opd);
  } else rec.cellId = await requireCellId(rec.cell);
  const requestHash = recordRequestHash(rec), priorRequest = (await listRecords()).find((r) => r.requestId === requestId);
  if (priorRequest) {
    if (priorRequest.requestBy !== user.id || priorRequest.requestHash !== requestHash) throw Object.assign(new AppError(409, 'คำขอสร้างฟอร์มนี้ไม่ตรงกับข้อมูลที่บันทึกไว้แล้ว'), { requestConflict: true });
    return { id: priorRequest.id, opd: priorRequest.opd, recovered: true, updated: priorRequest.formType === 'day0' };
  }
  rec.requestId = requestId; rec.requestHash = requestHash; rec.requestBy = user.id;
  // Day 0 ซ้ำ HN เดิมและครั้งที่เดิม → อัปเดตข้อมูลเดิม (คงวันที่มาปลูกเดิม) และรูปใหม่จะเข้าชุดเดิม/โฟลเดอร์เดิม
  if (rec.formType === 'day0') {
    const old = await findDay0(rec);
    if (old) {
      const saved = await updateRecord({ ...old, ...rec, date: old.date, note: rec.note || old.note, createdBy: old.createdBy, createdAt: old.createdAt });
      await prepareFolders(saved).catch(() => {});
      audit(req, user, 'record_update_day0', saved.id, `day0 ${rec.opd} ${rec.round}`);
      return { id: saved.id, opd: saved.opd, updated: true };
    }
  } else if (!body?.force) {
    const dup = await findDuplicate(rec);
    if (dup) throw Object.assign(new AppError(409, `OPD ${rec.opd} มีฟอร์มนี้ของวันที่ ${rec.date}${rec.visitPeriod ? ' ระยะ ' + rec.visitPeriod : ''} อยู่แล้ว`), { dup: true, dupId: dup.id, code: 'DUPLICATE_FORM' });
  }
  const saved = await addRecord({ ...rec, createdBy: user.id });
  await prepareFolders(saved).catch(() => {}); // สร้างโฟลเดอร์ใน Drive ล่วงหน้าทีละอัน กันโฟลเดอร์ซ้ำ
  audit(req, user, 'record_create', saved.id, `${rec.formType} ${rec.opd}`);
  return { id: saved.id, opd: saved.opd };
});
