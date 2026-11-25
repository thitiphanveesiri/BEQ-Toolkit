import { route, audit } from '../../../../lib/api.js';
import { listMedia, updateMedia } from '../../../../lib/db.js';
import { sendFile, sendThumb, removeUpload } from '../../../../lib/drive.js';
import { mediaIdOf, withMediaLock } from '../../../../lib/media.js';
import { ownedOpds } from '../../../../lib/scope.js';
import { AppError } from '../../../../lib/errors.js';

// ส่งรูป/วิดีโอผ่าน server เสมอ เพื่อตรวจสิทธิ์ทุกครั้ง (ไม่มีลิงก์สาธารณะ) — รองรับ Range สำหรับเล่นวิดีโอ
export const GET = route({ perm: 'viewImages' }, async ({ req, user, params }) => {
  const m = (await listMedia()).find((x) => x.id === params.id && x.status === 'ready');
  if (!m) throw new AppError(404, 'ไม่พบไฟล์');
  const owned = await ownedOpds(user);
  if (owned && !owned.has(m.opd)) throw new AppError(404, 'ไม่พบไฟล์');
  if (new URL(req.url).searchParams.get('thumb') === '1' && m.kind === 'image') {
    const t = await sendThumb(m);
    if (t) return t;
  }
  const res = await sendFile(m, req.headers.get('range'));
  if (new URL(req.url).searchParams.get('download') === '1') { // ดาวน์โหลดไฟล์ต้นฉบับ (กรณีเบราว์เซอร์เปิดดูชนิดไฟล์นี้ไม่ได้)
    const h = new Headers(res.headers); h.set('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(m.name || 'file')}`);
    return new Response(res.body, { status: res.status, headers: h });
  }
  return res;
});

export const DELETE = route({ perm: 'upload' }, async ({ req, user, params }) => withMediaLock(async () => {
  const id = mediaIdOf(params.id), media = (await listMedia()).find((m) => m.id === id);
  if (!media || media.uploadedBy !== user.id) throw new AppError(404, 'ไม่พบไฟล์');
  if (media.status === 'ready') throw new AppError(409, 'ไฟล์ที่บันทึกแล้วต้องลบจากหน้าข้อมูลคนไข้');
  if (media.status !== 'cancelled') {
    await removeUpload(media.driveId);
    await updateMedia({ ...media, status: 'cancelled', reservedAt: '' });
    audit(req, user, 'media_cancel', media.recordId, id);
  }
  return { ok: true };
}));
