import { route, audit } from '../../../lib/api.js';
import { AppError } from '../../../lib/errors.js';
import { addRecords, listRecords, listUsers } from '../../../lib/db.js';
import { getFormOptions } from '../../../lib/records.js';
import { parseCsv } from '../../../lib/csv.js';
import { parseImport } from '../../../lib/dataio.js';
import { withMediaLock } from '../../../lib/media.js';

// Vercel รับ body ได้ราว 4.5 MB — ไทยใน UTF-8 ใช้ 3 ไบต์/ตัว จึงนับเป็นไบต์ (ฝั่งเบราว์เซอร์เช็กเพดานเดียวกันก่อนส่ง)
const MAX_BYTES = 4_000_000;

// POST { csv: "<ข้อความ CSV>", commit: false|true, formType: 'day0'|'case'|'' }
// commit=false → ตรวจสอบอย่างเดียว (ไม่เขียนอะไร) ส่งสรุปให้ดูก่อน · commit=true → บันทึกเฉพาะแถวที่ผ่าน (แถวผิดพลาด/ซ้ำถูกข้าม)
export const POST = route({ perm: 'importData' }, async ({ req, user, body }) => {
  const text = typeof body?.csv === 'string' ? body.csv : '';
  if (!text.trim()) throw new AppError(400, 'ไม่พบข้อมูลในไฟล์');
  if (Buffer.byteLength(text) > MAX_BYTES) throw new AppError(400, 'ไฟล์ใหญ่เกินไป — กรุณาแบ่งไฟล์');
  const commit = body.commit === true;
  const formType = ['day0', 'case'].includes(body.formType) ? body.formType : '';
  const run = async () => {
    const [existing, users, options] = await Promise.all([listRecords(), listUsers(), getFormOptions('day0')]);
    const parsed = parseImport(parseCsv(text), { options, users, existing, importer: user, formType });
    const ok = parsed.results.filter((r) => r.status === 'ok');
    if (commit && ok.length) await addRecords(ok.map((r) => r.rec));
    const count = (s) => parsed.results.filter((r) => r.status === s).length;
    return {
      commit, total: parsed.results.length, create: ok.length, duplicate: count('duplicate'), error: count('error'),
      created: commit ? ok.length : 0, ignored: parsed.ignored, unknownPeople: parsed.unknownPeople, dateNote: parsed.dateNote,
      // ส่งเฉพาะแถวที่ต้องดู (ข้าม/ผิดพลาด) ไม่ส่งข้อมูลคนไข้ของแถวปกติกลับไป
      issues: parsed.results.filter((r) => r.status !== 'ok').slice(0, 300).map(({ row, status, opd, name, message }) => ({ row, status, opd, name, message })),
    };
  };
  const out = commit ? await withMediaLock(run) : await run(); // บันทึกจริงทีละคำขอ กันนำเข้าไฟล์เดียวกันซ้อนกันแล้วเกิดแถวซ้ำ
  audit(req, user, commit ? 'import_csv' : 'import_preview', 'records', `${formType ? (formType === 'case' ? 'F/U · ' : 'Day 0 · ') : ''}${out.total} แถว · ใหม่ ${out.create} · ซ้ำ ${out.duplicate} · ผิดพลาด ${out.error}`);
  return out;
});
