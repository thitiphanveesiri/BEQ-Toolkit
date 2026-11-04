// ใช้เฉพาะโหมดทดลอง: รับไฟล์แทน Google Drive (ปิดไว้ใน production)
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { route } from '../../../../lib/api.js';
import { dataMode, MOCK_DIR } from '../../../../lib/db.js';
import { AppError } from '../../../../lib/errors.js';

export const PUT = route({ perm: 'upload', raw: true }, async ({ req, params }) => {
  if (dataMode() !== 'mock') throw new AppError(404, 'ไม่พบ');
  if (!/^M-[a-z0-9]+$/.test(params.id)) throw new AppError(400, 'รหัสไม่ถูกต้อง');
  const dir = path.join(MOCK_DIR, 'media');
  fs.mkdirSync(dir, { recursive: true });
  if (!req.body) throw new AppError(400, 'ไม่มีไฟล์');
  await pipeline(Readable.fromWeb(req.body), fs.createWriteStream(path.join(dir, params.id)));
  return { ok: true };
});
