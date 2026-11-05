import { route, audit } from '../../../../lib/api.js';
import { listRecords, updateRecord } from '../../../../lib/db.js';
import { cleanRecord, getFormOptions } from '../../../../lib/records.js';
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
  await updateRecord({ ...rec, ...clean });
  if (clean.opd === rec.opd) {
    for (const r of all.filter((x) => x.opd === rec.opd && x.id !== rec.id)) {
      if (BASIC.some((k) => r[k] !== clean[k])) await updateRecord({ ...r, ...Object.fromEntries(BASIC.map((k) => [k, clean[k]])) });
    }
  }
  audit(req, user, 'record_update', rec.id, rec.opd);
  return { ok: true };
});
