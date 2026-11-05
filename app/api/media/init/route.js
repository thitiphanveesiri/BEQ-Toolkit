import { route } from '../../../../lib/api.js';
import { listRecords, listMedia, uid } from '../../../../lib/db.js';
import { signToken } from '../../../../lib/auth.js';
import { startUpload, safeName } from '../../../../lib/drive.js';
import { groupsFor, groupLabel } from '../../../../lib/fields.js';
import { AppError } from '../../../../lib/errors.js';

const MAX_PER_GROUP = 30;
const IMG = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/heic': '.heic', 'image/heif': '.heif' };
const VID = { 'video/mp4': '.mp4', 'video/quicktime': '.mov', 'video/webm': '.webm', 'video/x-m4v': '.m4v' };
const mb = (n) => n * 1024 * 1024;

// ขั้น 1: ตรวจสิทธิ์/ชนิดไฟล์/ขนาด แล้วให้ URL สำหรับส่งไฟล์ตรงเข้า Drive พร้อมโทเคนยืนยัน (ไม่เขียนชีต)
export const POST = route({ perm: 'upload' }, async ({ req, user, body }) => {
  const rec = (await listRecords()).find((r) => r.id === body?.recordId);
  if (!rec) throw new AppError(404, 'ไม่พบเคสที่จะแนบรูป');
  // ผู้มีสิทธิ์อัปโหลดแนบรูปเข้าเคสได้ (รวมกรณีกรอก Day 0 ซ้ำเพื่ออัปเดตเคสเดิม)
  const group = String(body.group || '');
  if (!groupsFor(rec.formType).some((g) => g[0] === group)) throw new AppError(400, 'ช่องรูปภาพไม่ถูกต้อง');
  const mime = String(body.mime || '').toLowerCase(), size = Number(body.size);
  const ext = IMG[mime] || VID[mime];
  if (!ext) throw new AppError(400, 'รองรับเฉพาะรูป JPG/PNG/WebP/HEIC และวิดีโอ MP4/MOV/WebM');
  const kind = IMG[mime] ? 'image' : 'video';
  const limit = mb(Number(kind === 'image' ? process.env.MAX_IMAGE_MB || 25 : process.env.MAX_VIDEO_MB || 1024));
  if (!(size > 0) || size > limit) throw new AppError(400, `ไฟล์ใหญ่เกินกำหนด (${kind === 'image' ? 'รูป' : 'วิดีโอ'}สูงสุด ${Math.round(limit / mb(1))} MB)`);
  const have = (await listMedia()).filter((m) => m.recordId === rec.id && m.group === group && m.status === 'ready').length;
  const seq = Math.max(0, Math.min(MAX_PER_GROUP, Number(body.seq) || 0));
  if (have + seq >= MAX_PER_GROUP) throw new AppError(400, `ช่องนี้เต็มแล้ว (สูงสุด ${MAX_PER_GROUP} ไฟล์)`);
  // ตั้งชื่อไฟล์ตามกฎ: OPD-ชื่อ-วันที่-เครื่องมือ-ช่อง-ลำดับ
  const fileName = [rec.opd, rec.name, rec.date, (rec.hairMethod || rec.tool || rec.inj || ''), groupLabel(group), String(have + seq + 1).padStart(2, '0')].filter(Boolean).map(safeName).join('-') + ext;
  const mediaId = uid('M-');
  const { driveId, uploadUrl } = await startUpload({ rec, group, fileName, mime, size, origin: req.headers.get('origin'), mediaId });
  const token = signToken({ u: user.id, id: mediaId, d: driveId, r: rec.id, o: rec.opd, g: group, k: kind, n: fileName, m: mime, s: size });
  return { uploadUrl, token, fileName };
});
