import { route } from '../../../../lib/api.js';
import { listMedia } from '../../../../lib/db.js';
import { sendFile, sendThumb } from '../../../../lib/drive.js';
import { AppError } from '../../../../lib/errors.js';

// ส่งรูป/วิดีโอผ่าน server เสมอ เพื่อตรวจสิทธิ์ทุกครั้ง (ไม่มีลิงก์สาธารณะ) — รองรับ Range สำหรับเล่นวิดีโอ
export const GET = route({ perm: 'viewImages' }, async ({ req, params }) => {
  const m = (await listMedia()).find((x) => x.id === params.id && x.status === 'ready');
  if (!m) throw new AppError(404, 'ไม่พบไฟล์');
  if (new URL(req.url).searchParams.get('thumb') === '1' && m.kind === 'image') {
    const t = await sendThumb(m);
    if (t) return t;
  }
  return sendFile(m, req.headers.get('range'));
});
