import { route, audit } from '../../../../lib/api.js';
import { readToken } from '../../../../lib/auth.js';
import { verifyUpload } from '../../../../lib/drive.js';
import { addMediaMany, listMedia } from '../../../../lib/db.js';
import { AppError } from '../../../../lib/errors.js';

// ขั้น 3: ยืนยันกับ Drive ว่าไฟล์มีอยู่จริงและขนาดตรงกัน แล้วบันทึกข้อมูลรูปทั้งชุดลงชีตในครั้งเดียว
export const POST = route({ perm: 'upload' }, async ({ req, user, body }) => {
  const tokens = Array.isArray(body?.tokens) ? body.tokens.slice(0, 60) : [];
  const done = [], failed = [];
  const existing = await listMedia();
  const count = new Map();
  for (const m of existing) if (m.status === 'ready') count.set(m.recordId + m.group, (count.get(m.recordId + m.group) || 0) + 1);
  const parsed = tokens.map((t) => { try { const d = readToken(t); if (d.u !== user.id) throw new AppError(403, 'โทเคนไม่ตรงกับผู้ใช้'); return { t, d }; } catch (e) { failed.push({ token: t, error: e.message }); return null; } }).filter(Boolean);
  await Promise.all(parsed.map(async ({ t, d }) => {
    try { if (await verifyUpload(d.d, d.s)) done.push(d); else failed.push({ token: t, error: 'ไฟล์ยังอัปโหลดไม่ครบ' }); }
    catch (e) { failed.push({ token: t, error: e.message }); }
  }));
  const rows = [];
  for (const d of done) {
    const k = d.r + d.g;
    if ((count.get(k) || 0) >= 30 || existing.some((m) => m.id === d.id)) continue;
    count.set(k, (count.get(k) || 0) + 1);
    rows.push({ id: d.id, recordId: d.r, opd: d.o, group: d.g, kind: d.k, driveId: d.d, name: d.n, mime: d.m, size: String(d.s), uploadedBy: user.id });
  }
  await addMediaMany(rows);
  if (rows.length) audit(req, user, 'media_upload', rows[0].recordId, `${rows.length} ไฟล์`);
  return { saved: rows.map((r) => r.id), failed };
});
