import { route, audit } from '../../../../lib/api.js';
import { verifyUpload } from '../../../../lib/drive.js';
import { listMedia, listRecords, updateMediaMany, nowIso, refreshDb } from '../../../../lib/db.js';
import { slotCap } from '../../../../lib/fields.js';
import { mediaIdOf, withMediaLock } from '../../../../lib/media.js';
import { AppError } from '../../../../lib/errors.js';

export const POST = route({ perm: 'upload' }, async ({ req, user, body }) => {
  const failed = [], ids = [];
  for (const value of Array.isArray(body?.mediaIds) ? body.mediaIds.slice(0, 60) : []) {
    try { const id = mediaIdOf(value); if (!ids.includes(id)) ids.push(id); }
    catch (e) { failed.push({ mediaId: String(value || ''), error: e.message }); }
  }
  const saved = [], updates = [];
  await withMediaLock(async () => {
    let [existing, records] = await Promise.all([listMedia(), listRecords()]);
    // แถวจอง (/init) อาจถูกเขียนโดย server instance อื่นที่ cache ของเรายังไม่เห็น: ถ้ามี ID ที่หาไม่เจอ ให้อ่านจาก Sheets ใหม่ 1 ครั้งก่อนตัดสินว่า "ไม่พบ"
    if (ids.some((id) => !existing.some((m) => m.id === id))) {
      await refreshDb();
      [existing, records] = await Promise.all([listMedia(), listRecords()]);
    }
    const byId = new Map(existing.map((m) => [m.id, m])), byRecord = new Map(records.map((r) => [r.id, r]));
    const count = new Map(), key = (m) => `${m.recordId}|${m.group}|${m.kind}|${m.kind === 'video' ? '' : m.slot || ''}`;
    for (const m of existing) if (m.status === 'ready') count.set(key(m), (count.get(key(m)) || 0) + 1);
    const checked = await Promise.all(ids.map(async (id) => {
      const prior = byId.get(id);
      if (!prior) return { id, error: 'ไม่พบไฟล์ที่จองไว้' };
      if (prior.uploadedBy !== user.id) return { id, error: 'ไม่พบไฟล์ที่ต้องการบันทึก' };
      if (prior.status === 'ready') return { id, saved: true };
      if (prior.status === 'cancelled') return { id, error: 'การจองไฟล์นี้ถูกยกเลิกแล้ว' };
      if (prior.status !== 'uploading') return { id, error: 'สถานะไฟล์ไม่ถูกต้อง' };
      const rec = byRecord.get(prior.recordId);
      if (!rec) return { id, error: 'ไม่พบเคสของไฟล์นี้' };
      try {
        if (!await verifyUpload(prior.driveId, prior.size)) return { id, prior, rec, error: 'ไฟล์ยังอัปโหลดไม่ครบ' };
        const k = key(prior), max = slotCap(prior.kind, prior.slot);
        if ((count.get(k) || 0) >= max) return { id, error: 'ช่องนี้เต็มแล้ว ไฟล์ไม่ถูกบันทึก' };
        count.set(k, (count.get(k) || 0) + 1);
        return { id, prior, rec };
      } catch (e) { return { id, error: e.message }; }
    }));
    for (const item of checked) {
      if (item.error) failed.push({ mediaId: item.id, error: item.error });
      else if (item.saved) saved.push(item.id);
      else updates.push({ ...item.prior, opd: item.rec.opd, status: 'ready', uploadedAt: nowIso(), reservedAt: '' });
    }
    await updateMediaMany(updates);
    saved.push(...updates.map((m) => m.id));
  });
  if (updates.length) audit(req, user, 'media_upload', updates[0].recordId, `${updates.length} ไฟล์`);
  return { saved, failed };
});
