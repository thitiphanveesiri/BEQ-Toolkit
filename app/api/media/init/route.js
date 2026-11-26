import { route } from '../../../../lib/api.js';
import { listRecords, listMedia, addMedia, updateMedia, nowIso } from '../../../../lib/db.js';
import { startUpload, safeName, verifyUpload, removeUpload } from '../../../../lib/drive.js';
import { groupsFor, groupLabel, isImageSlot, slotCap, slotFile, EXTRA_SLOT, VIDEO_SLOT } from '../../../../lib/fields.js';
import { classify, extOf } from '../../../../lib/mediatypes.js';
import { activeReservation, mediaIdOf, mediaTarget, occupiedMediaCount, planSingleSlot, sameTarget, slotOccupants, withMediaLock } from '../../../../lib/media.js';
import { AppError } from '../../../../lib/errors.js';

const mb = (n) => n * 1024 * 1024;

export const POST = route({ perm: 'upload' }, async ({ req, user, body }) => withMediaLock(async () => {
  const rec = (await listRecords()).find((r) => r.id === body?.recordId);
  if (!rec) throw new AppError(404, 'ไม่พบเคสที่จะแนบรูป');
  const group = String(body.group || '');
  if (!groupsFor(rec.formType).some((g) => g[0] === group)) throw new AppError(400, 'ช่องรูปภาพไม่ถูกต้อง');
  const size = Number(body.size);
  const cls = classify(body.name, body.mime);
  if (!cls) throw new AppError(400, 'ไฟล์นี้ไม่ใช่รูปภาพหรือวิดีโอที่รองรับ');
  const { kind, mime } = cls;
  const ext = '.' + (extOf(body.name) || mime.split('/')[1].replace(/[^a-z0-9]/g, '').slice(0, 5) || (kind === 'image' ? 'jpg' : 'mp4'));
  const limit = mb(Number(kind === 'image' ? process.env.MAX_IMAGE_MB || 25 : process.env.MAX_VIDEO_MB || 1024));
  if (!(size > 0) || size > limit) throw new AppError(400, `ไฟล์ใหญ่เกินกำหนด (${kind === 'image' ? 'รูป' : 'วิดีโอ'}สูงสุด ${Math.round(limit / mb(1))} MB)`);
  const slot = kind === 'video' ? VIDEO_SLOT : String(body.slot || '');
  if (kind === 'image' && !isImageSlot(slot)) throw new AppError(400, 'ไม่พบช่องมุมถ่ายภาพนี้ — กรุณารีเฟรชหน้าเว็บ แล้วลองอีกครั้ง');
  const max = slotCap(kind, slot), target = mediaTarget(rec, group, kind, slot, mime, size);
  const mediaId = mediaIdOf(body.mediaId);
  let allMedia = await listMedia();
  const prior = allMedia.find((m) => m.id === mediaId);
  if (prior && prior.uploadedBy !== user.id) throw new AppError(403, 'ไม่พบไฟล์ที่ต้องการอัปโหลดต่อ');
  if (prior && !sameTarget(prior, target)) throw new AppError(409, 'รหัสไฟล์นี้ถูกใช้กับไฟล์หรือช่องอื่นแล้ว');
  if (prior?.status === 'ready') return { mediaId, alreadySaved: true, fileName: prior.name };
  // ช่องมุมถ่าย (รับ 1 รูป) ที่มีไฟล์อื่นครอบครองอยู่: หลังรีเฟรช/ล้างร่าง ไฟล์เดิมจะได้รหัสใหม่ ถ้าปฏิเสธทุกกรณีผู้ใช้จะติดอยู่กับรูปของตัวเอง (การจองค้างนานได้ถึง 24 ชม.)
  if (kind === 'image' && max === 1 && !activeReservation(prior)) {
    const occupants = slotOccupants(allMedia, { ...target, id: mediaId });
    if (occupants.length) {
      const plan = planSingleSlot(occupants, { userId: user.id, size, mime });
      if (plan.action === 'reuse') return { mediaId, alreadySaved: true, fileName: plan.media.name };
      if (plan.action === 'reject') throw new AppError(409, plan.busy
        ? 'ช่องมุมนี้กำลังมีการอัปโหลดรูปอื่นอยู่ — รอสักครู่แล้วลองใหม่'
        : `ช่องมุมนี้มีรูปบันทึกไว้แล้ว (${plan.media.name}) — ถ้าต้องการรูปเพิ่มให้ใส่ในช่อง “ภาพเพิ่มเติม” หรือให้ผู้ดูแลลบรูปเดิมออกก่อน`);
      // ไฟล์ที่จองไว้แต่ส่งขึ้น Drive ครบแล้ว (บันทึกไม่ทัน) และเป็นไฟล์เดียวกัน -> บันทึกให้เลย ไม่ต้องส่งใหม่
      for (const old of plan.same) {
        if (await verifyUpload(old.driveId, old.size)) {
          const saved = await updateMedia({ ...old, opd: rec.opd, status: 'ready', uploadedAt: nowIso(), reservedAt: '' });
          return { mediaId, alreadySaved: true, fileName: saved.name };
        }
      }
      for (const old of plan.stale) { await removeUpload(old.driveId); await updateMedia({ ...old, status: 'cancelled', reservedAt: '' }); }
      allMedia = await listMedia();
    }
  }
  const have = occupiedMediaCount(allMedia, { ...target, id: mediaId });
  if (!activeReservation(prior) && have >= max) throw new AppError(400, kind === 'video' ? `ช่องวิดีโอนี้เต็มแล้ว (สูงสุด ${max} คลิป)` : slot === EXTRA_SLOT ? `ช่องภาพเพิ่มเติมเต็มแล้ว (สูงสุด ${max} ภาพ)` : 'ช่องมุมนี้มีรูปอยู่แล้ว — ถ้าต้องการรูปเพิ่มให้ใส่ในช่อง “ภาพเพิ่มเติม”');
  if (prior && prior.status !== 'cancelled' && await verifyUpload(prior.driveId, prior.size)) {
    const saved = await updateMedia({ ...prior, opd: rec.opd, status: 'ready', uploadedAt: nowIso(), reservedAt: '' });
    return { mediaId, alreadySaved: true, fileName: saved.name };
  }
  const seq = Math.max(0, Math.floor(Number(body.seq) || 0));
  const nn = kind === 'video' || slot === EXTRA_SLOT ? String(have + seq + 1).padStart(2, '0') : '';
  const fileName = prior?.name || [rec.opd, rec.name, rec.date, (rec.hairMethod || rec.tool || rec.inj || ''), group === 'single' ? '' : groupLabel(group), slotFile(slot, kind), nn].filter(Boolean).map(safeName).join('-') + ext;
  if (prior?.driveId) await removeUpload(prior.driveId);
  const { driveId, uploadUrl } = await startUpload({ rec, group, fileName, mime, size, origin: req.headers.get('origin'), mediaId });
  const pending = { id: mediaId, ...target, opd: rec.opd, driveId, name: fileName, status: 'uploading', uploadedBy: user.id, reservedAt: nowIso() };
  if (prior) await updateMedia({ ...prior, ...pending });
  else await addMedia(pending);
  return { mediaId, driveId, uploadUrl, fileName };
}));
