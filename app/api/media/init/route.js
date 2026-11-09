import { route } from '../../../../lib/api.js';
import { listRecords, listMedia, uid } from '../../../../lib/db.js';
import { signToken } from '../../../../lib/auth.js';
import { startUpload, safeName } from '../../../../lib/drive.js';
import { groupsFor, groupLabel, isImageSlot, slotCap, slotFile, EXTRA_SLOT, VIDEO_SLOT } from '../../../../lib/fields.js';
import { classify, extOf } from '../../../../lib/mediatypes.js';
import { AppError } from '../../../../lib/errors.js';

const mb = (n) => n * 1024 * 1024;

// ขั้น 1: ตรวจสิทธิ์/ชนิดไฟล์/ขนาด แล้วให้ URL สำหรับส่งไฟล์ตรงเข้า Drive พร้อมโทเคนยืนยัน (ไม่เขียนชีต)
export const POST = route({ perm: 'upload' }, async ({ req, user, body }) => {
  const rec = (await listRecords()).find((r) => r.id === body?.recordId);
  if (!rec) throw new AppError(404, 'ไม่พบเคสที่จะแนบรูป');
  // ผู้มีสิทธิ์อัปโหลดแนบรูปเข้าเคสได้ (รวมกรณีกรอก Day 0 ซ้ำเพื่ออัปเดตเคสเดิม)
  const group = String(body.group || '');
  if (!groupsFor(rec.formType).some((g) => g[0] === group)) throw new AppError(400, 'ช่องรูปภาพไม่ถูกต้อง');
  const size = Number(body.size);
  const cls = classify(body.name, body.mime); // รับทุกสกุลรูปภาพ/วิดีโอ (ไม่รวม SVG)
  if (!cls) throw new AppError(400, 'ไฟล์นี้ไม่ใช่รูปภาพหรือวิดีโอที่รองรับ');
  const { kind, mime } = cls;
  const ext = '.' + (extOf(body.name) || mime.split('/')[1].replace(/[^a-z0-9]/g, '').slice(0, 5) || (kind === 'image' ? 'jpg' : 'mp4'));
  const limit = mb(Number(kind === 'image' ? process.env.MAX_IMAGE_MB || 25 : process.env.MAX_VIDEO_MB || 1024));
  if (!(size > 0) || size > limit) throw new AppError(400, `ไฟล์ใหญ่เกินกำหนด (${kind === 'image' ? 'รูป' : 'วิดีโอ'}สูงสุด ${Math.round(limit / mb(1))} MB)`);
  // รูปภาพต้องระบุช่องมุมถ่ายภาพ (หน้าตรง 0°/45°/90°/Vortex, หันซ้าย/ขวา 45°, ด้านหลัง ... หรือ "ภาพเพิ่มเติม") · วิดีโอไม่ผูกมุม
  const slot = kind === 'video' ? VIDEO_SLOT : String(body.slot || '');
  if (kind === 'image' && !isImageSlot(slot)) throw new AppError(400, 'ไม่พบช่องมุมถ่ายภาพนี้ — กรุณารีเฟรชหน้าเว็บ (ระบบอัปเดตช่องรูปภาพใหม่) แล้วลองอีกครั้ง');
  const max = slotCap(kind, slot);
  const have = (await listMedia()).filter((m) => m.recordId === rec.id && m.group === group && m.kind === kind && m.status === 'ready' && (kind === 'video' || m.slot === slot)).length;
  const seq = Math.max(0, Math.min(max, Number(body.seq) || 0));
  if (have + seq >= max) throw new AppError(400, kind === 'video' ? `ช่องวิดีโอนี้เต็มแล้ว (สูงสุด ${max} คลิป)` : slot === EXTRA_SLOT ? `ช่องภาพเพิ่มเติมเต็มแล้ว (สูงสุด ${max} ภาพ)` : 'ช่องมุมนี้มีรูปอยู่แล้ว — ถ้าต้องการรูปเพิ่มให้ใส่ในช่อง “ภาพเพิ่มเติม”');
  // ตั้งชื่อไฟล์ตามกฎ: OPD-ชื่อ-วันที่-เครื่องมือ-ช่อง-มุม(-ลำดับ เฉพาะภาพเพิ่มเติม/วิดีโอ)
  const nn = kind === 'video' || slot === EXTRA_SLOT ? String(have + seq + 1).padStart(2, '0') : '';
  const fileName = [rec.opd, rec.name, rec.date, (rec.hairMethod || rec.tool || rec.inj || ''), group === 'single' ? '' : groupLabel(group), slotFile(slot, kind), nn].filter(Boolean).map(safeName).join('-') + ext;
  const mediaId = uid('M-');
  const { driveId, uploadUrl } = await startUpload({ rec, group, fileName, mime, size, origin: req.headers.get('origin'), mediaId });
  const token = signToken({ u: user.id, id: mediaId, d: driveId, r: rec.id, o: rec.opd, g: group, k: kind, sl: slot, n: fileName, m: mime, s: size });
  return { uploadUrl, token, fileName };
});
