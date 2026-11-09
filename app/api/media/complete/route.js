import { route, audit } from '../../../../lib/api.js';
import { readToken } from '../../../../lib/auth.js';
import { verifyUpload } from '../../../../lib/drive.js';
import { addMediaMany, listMedia } from '../../../../lib/db.js';
import { AppError } from '../../../../lib/errors.js';
import { slotCap } from '../../../../lib/fields.js';

// ขั้น 3: ยืนยันกับ Drive ว่าไฟล์มีอยู่จริงและขนาดตรงกัน แล้วบันทึกข้อมูลรูปทั้งชุดลงชีตในครั้งเดียว
export const POST = route({ perm: 'upload' }, async ({ req, user, body }) => {
  const tokens = Array.isArray(body?.tokens) ? body.tokens.slice(0, 60) : [];
  const done = [], failed = [];
  const existing = await listMedia();
  const count = new Map();
  const ckey = (r, g, k, s) => `${r}|${g}|${k}|${k === 'video' ? '' : s}`; // นับแยกตามช่อง: มุมถ่ายภาพ (1 รูป) · ภาพเพิ่มเติม (12) · วิดีโอ (10)
  for (const m of existing) if (m.status === 'ready') { const k = ckey(m.recordId, m.group, m.kind, m.slot); count.set(k, (count.get(k) || 0) + 1); }
  const parsed = tokens.map((t) => { try { const d = readToken(t); if (d.u !== user.id) throw new AppError(403, 'โทเคนไม่ตรงกับผู้ใช้'); return { t, d }; } catch (e) { failed.push({ token: t, error: e.message }); return null; } }).filter(Boolean);
  await Promise.all(parsed.map(async ({ t, d }) => {
    try { if (await verifyUpload(d.d, d.s)) done.push({ t, d }); else failed.push({ token: t, error: 'ไฟล์ยังอัปโหลดไม่ครบ' }); }
    catch (e) { failed.push({ token: t, error: e.message }); }
  }));
  const rows = [], saved = [];
  for (const { t, d } of done) {
    if (existing.some((m) => m.id === d.id)) { saved.push(d.id); continue; } // ส่งยืนยันซ้ำ: บันทึกไว้แล้ว
    const k = ckey(d.r, d.g, d.k, d.sl);
    if ((count.get(k) || 0) >= slotCap(d.k, d.sl)) { failed.push({ token: t, error: 'ช่องนี้เต็มแล้ว ไฟล์ไม่ถูกบันทึก' }); continue; } // แจ้งให้เห็น ไม่ปล่อยให้หน้าจอขึ้นว่าสำเร็จทั้งที่ไม่ได้บันทึก
    count.set(k, (count.get(k) || 0) + 1);
    rows.push({ id: d.id, recordId: d.r, opd: d.o, group: d.g, kind: d.k, slot: d.k === 'video' ? '' : d.sl || '', driveId: d.d, name: d.n, mime: d.m, size: String(d.s), uploadedBy: user.id });
    saved.push(d.id);
  }
  await addMediaMany(rows);
  if (rows.length) audit(req, user, 'media_upload', rows[0].recordId, `${rows.length} ไฟล์`);
  return { saved, failed };
});
