import { route, audit } from '../../../../lib/api.js';
import { listRecords, listMedia, updateRecord, updateMediaMany } from '../../../../lib/db.js';
import { cleanRecord, getFormOptions, requireCellId } from '../../../../lib/records.js';
import { ownedOpds } from '../../../../lib/scope.js';
import { can } from '../../../../lib/roles.js';
import { AppError } from '../../../../lib/errors.js';

// แก้ไขข้อมูลคนไข้: ผู้มีสิทธิ์ editData (ค่าเริ่มต้น: ผู้ดูแล/แพทย์/หัวหน้าแพทย์ — แพทย์แก้ได้เฉพาะเคสที่ตัวเองดูแล)
// เลข OPD เปลี่ยนได้เฉพาะผู้ดูแลระบบ และทุกการแก้ไขบันทึกใน audit
const BASIC = ['fname', 'mname', 'lname', 'name', 'gender', 'age', 'nat'];
export const PATCH = route({ perm: 'editData' }, async ({ req, user, params, body }) => {
  const all = await listRecords();
  const rec = all.find((r) => r.id === params.id);
  if (!rec) throw new AppError(404, 'ไม่พบข้อมูล');
  const owned = await ownedOpds(user);
  if (owned && !owned.has(rec.opd)) throw new AppError(404, 'ไม่พบข้อมูล');
  const input = { ...body?.data, ...(can(user, 'manage') ? {} : { opd: rec.opd }) };
  const clean = cleanRecord(rec.formType, input, await getFormOptions(rec.formType), rec);
  clean.cellId = clean.cell === rec.cell ? rec.cellId || '' : await requireCellId(clean.cell);
  const opdChanged = clean.opd !== rec.opd;
  if (opdChanged && all.some((r) => r.id !== rec.id && r.opd === clean.opd)) throw new AppError(409, 'เลข OPD นี้มีข้อมูลอยู่แล้ว ไม่สามารถนำข้อมูลสองคนมารวมกันอัตโนมัติได้');
  await updateRecord({ ...rec, ...clean });
  for (const r of all.filter((x) => x.opd === rec.opd && x.id !== rec.id)) {
    const patch = { ...(opdChanged ? { opd: clean.opd } : {}), ...Object.fromEntries(BASIC.filter((k) => r[k] !== clean[k]).map((k) => [k, clean[k]])) };
    if (Object.keys(patch).length) await updateRecord({ ...r, ...patch });
  }
  if (opdChanged) {
    const media = (await listMedia()).filter((m) => m.opd === rec.opd).map((m) => ({ ...m, opd: clean.opd }));
    await updateMediaMany(media);
  }
  audit(req, user, 'record_update', rec.id, opdChanged ? `${rec.opd} → ${clean.opd}` : rec.opd);
  return { ok: true };
});
