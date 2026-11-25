import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { route } from '../../../../lib/api.js';
import { dataMode, MOCK_DIR, listMedia } from '../../../../lib/db.js';
import { activeReservation, mediaIdOf, withMediaLock } from '../../../../lib/media.js';
import { AppError } from '../../../../lib/errors.js';

export const PUT = route({ perm: 'upload', raw: true }, async ({ req, user, params }) => withMediaLock(async () => {
  if (dataMode() !== 'mock') throw new AppError(404, 'ไม่พบ');
  const id = mediaIdOf(params.id), media = (await listMedia()).find((m) => m.id === id);
  if (!media || media.uploadedBy !== user.id) throw new AppError(404, 'ไม่พบไฟล์');
  if (media.status === 'ready') throw new AppError(409, 'ไฟล์นี้บันทึกแล้ว');
  if (media.status !== 'uploading' || !activeReservation(media)) throw new AppError(410, 'การจองไฟล์หมดอายุ กรุณาเริ่มอัปโหลดใหม่');
  const file = path.join(MOCK_DIR, 'media', id), totalExpected = Number(media.size);
  const sizeNow = () => fs.existsSync(file) ? fs.statSync(file).size : 0;
  const range = req.headers.get('content-range') || '', status = /^bytes \*\/(\d+)$/.exec(range);
  if (status) {
    if (Number(status[1]) !== totalExpected) throw new AppError(400, 'ขนาดไฟล์ไม่ตรงกับการจอง');
    const size = sizeNow();
    if (size > totalExpected) throw new AppError(409, 'ไฟล์ชั่วคราวมีขนาดเกินกำหนด');
    return size === totalExpected ? new Response(null, { status: 200 }) : new Response(null, { status: 308, headers: size ? { Range: `bytes=0-${size - 1}` } : undefined });
  }
  const m = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(range);
  if (!m) throw new AppError(400, 'รูปแบบส่วนไฟล์ไม่ถูกต้อง');
  const start = Number(m[1]), end = Number(m[2]), total = Number(m[3]);
  if (total !== totalExpected || start < 0 || end < start || end >= total || !req.body) throw new AppError(400, 'ส่วนไฟล์ไม่ถูกต้อง');
  const current = sizeNow();
  if (current > total) throw new AppError(409, 'ไฟล์ชั่วคราวมีขนาดเกินกำหนด');
  if (start !== current) return new Response(null, { status: 308, headers: current ? { Range: `bytes=0-${current - 1}` } : undefined });
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await pipeline(Readable.fromWeb(req.body), fs.createWriteStream(file, { flags: start > 0 ? 'r+' : 'w', start }));
  const size = sizeNow();
  if (size === total) return new Response(null, { status: 200 });
  if (size > total) throw new AppError(409, 'ไฟล์ชั่วคราวมีขนาดเกินกำหนด');
  return new Response(null, { status: 308, headers: { Range: `bytes=0-${size - 1}` } });
}));
