// Google Drive (ฝั่ง server): โฟลเดอร์ `งาน / OPD - ชื่อ / ระยะ`, เริ่ม resumable upload, ตรวจไฟล์, ส่งไฟล์กลับ (รองรับ Range สำหรับวิดีโอ)
// โหมดทดลอง (mock) เก็บไฟล์ใน .data/media แทน Drive โดยใช้ flow เดียวกัน
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { AppError } from './errors.js';
import { gfetch, gjson } from './google.js';
import { dataMode, folderGet, folderSet, MOCK_DIR } from './db.js';

const API = 'https://www.googleapis.com/drive/v3';
const JSON_H = { 'Content-Type': 'application/json; charset=UTF-8' };
const isMock = () => dataMode() === 'mock';

export const safeName = (s) => String(s || '').trim().replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, '_');
const safeFolder = (s) => String(s || '').trim().replace(/[\\/:*?"<>|]/g, '_').slice(0, 120) || '_';

/* ---------- โฟลเดอร์ (เก็บ ID ไว้ในชีต Folders เพื่อไม่ต้องค้นหา Drive ซ้ำ และไม่สร้างโฟลเดอร์ซ้ำ) ---------- */
const inflight = (globalThis.__beqFolders ||= new Map());
function ensureFolder(key, name, parent) {
  if (!inflight.has(key)) {
    const p = (async () => {
      const known = await folderGet(key);
      if (known) return known;
      const f = await gjson(`${API}/files?fields=id&supportsAllDrives=true`, { method: 'POST', headers: JSON_H,
        body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder', ...(parent ? { parents: [parent] } : {}) }) }, 'Google Drive');
      await folderSet(key, f.id);
      return f.id;
    })().catch((e) => { inflight.delete(key); throw e; });
    inflight.set(key, p);
  }
  return inflight.get(key);
}

export async function folderFor(rec) {
  const root = await ensureFolder('ROOT', process.env.DRIVE_ROOT_NAME || 'งาน', null);
  const pf = await ensureFolder('P:' + rec.opd, `${safeFolder(rec.opd)} - ${safeFolder(rec.name)}`, root);
  const vname = rec.formType === 'day0' ? `Day 0 - ${rec.date}` : `ระยะ ${safeFolder(rec.visitPeriod || 'ไม่ระบุระยะ')}`;
  return ensureFolder(`V:${rec.opd}:${vname}`, vname, pf);
}

/* ---------- เริ่มอัปโหลด: เบราว์เซอร์ส่งไฟล์ตรงเข้า Drive (ไม่ผ่าน server จึงไม่ติดเพดาน 4.5MB ของ Vercel) ---------- */
let idPool = [];
async function newId() {
  if (!idPool.length) idPool = (await gjson(`${API}/files/generateIds?count=20&space=drive`, undefined, 'Google Drive')).ids;
  return idPool.pop();
}

export async function startUpload({ rec, fileName, mime, size, origin, mediaId }) {
  if (isMock()) return { driveId: mediaId, uploadUrl: `/api/mock-upload/${mediaId}` };
  const [parent, id] = await Promise.all([folderFor(rec), newId()]);
  const r = await gfetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true', {
    method: 'POST',
    headers: { ...JSON_H, 'X-Upload-Content-Type': mime, 'X-Upload-Content-Length': String(size), ...(origin ? { Origin: origin } : {}) },
    body: JSON.stringify({ id, name: fileName, parents: [parent] }),
  });
  const uploadUrl = r.headers.get('location');
  if (!r.ok || !uploadUrl) throw new AppError(502, 'เริ่มอัปโหลดไป Google Drive ไม่สำเร็จ กรุณาลองใหม่');
  return { driveId: id, uploadUrl };
}

export async function verifyUpload(driveId, size) {
  if (isMock()) {
    const f = path.join(MOCK_DIR, 'media', driveId);
    return fs.existsSync(f) && fs.statSync(f).size === Number(size);
  }
  const r = await gfetch(`${API}/files/${driveId}?fields=id,size,trashed&supportsAllDrives=true`);
  if (!r.ok) return false;
  const j = await r.json();
  return !j.trashed && Number(j.size) === Number(size);
}

/* ---------- ส่งไฟล์ให้เบราว์เซอร์ (ผ่าน server เพื่อตรวจสิทธิ์ทุกครั้ง) ---------- */
const FILE_HEADERS = { 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "sandbox; default-src 'none'; style-src 'unsafe-inline'", 'Cache-Control': 'private, max-age=86400' };

export async function sendFile(media, range) {
  const type = media.mime || 'application/octet-stream';
  if (isMock()) {
    const f = path.join(MOCK_DIR, 'media', media.driveId);
    if (!fs.existsSync(f)) throw new AppError(404, 'ไม่พบไฟล์');
    const total = fs.statSync(f).size, m = /bytes=(\d*)-(\d*)/.exec(range || '');
    let s = 0, e = total - 1, status = 200;
    if (m && (m[1] || m[2])) { if (m[1]) { s = +m[1]; e = m[2] ? Math.min(+m[2], total - 1) : total - 1; } else { s = Math.max(0, total - +m[2]); } status = 206; }
    const h = { ...FILE_HEADERS, 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Length': String(e - s + 1) };
    if (status === 206) h['Content-Range'] = `bytes ${s}-${e}/${total}`;
    return new Response(Readable.toWeb(fs.createReadStream(f, { start: s, end: e })), { status, headers: h });
  }
  const r = await gfetch(`${API}/files/${media.driveId}?alt=media&supportsAllDrives=true`, { headers: range ? { Range: range } : {} }, { limited: false });
  if (r.status === 404) throw new AppError(404, 'ไม่พบไฟล์ใน Google Drive');
  if (!r.ok && r.status !== 206) throw new AppError(502, 'ดึงไฟล์จาก Google Drive ไม่สำเร็จ');
  const h = { ...FILE_HEADERS, 'Content-Type': type, 'Accept-Ranges': 'bytes' };
  for (const k of ['content-length', 'content-range']) if (r.headers.get(k)) h[k] = r.headers.get(k);
  return new Response(r.body, { status: r.status, headers: h });
}

// รูปย่อ (โหลดเร็ว ประหยัดแบนด์วิดท์เมื่อมีรูปจำนวนมาก) — ถ้า Drive ยังไม่มีรูปย่อ จะคืน null
const thumbCache = (globalThis.__beqThumb ||= new Map());
export async function sendThumb(media) {
  if (isMock()) return sendFile(media);
  const hit = thumbCache.get(media.driveId);
  let link = hit && hit.exp > Date.now() ? hit.link : null;
  if (!link) {
    const r = await gfetch(`${API}/files/${media.driveId}?fields=thumbnailLink&supportsAllDrives=true`);
    link = r.ok ? (await r.json()).thumbnailLink : null;
    if (link) thumbCache.set(media.driveId, { link, exp: Date.now() + 20 * 60000 });
  }
  if (!link) return null;
  const t = await gfetch(link.replace(/=s\d+$/, '=s480'), {}, { retries: 1 });
  if (!t.ok) return null;
  return new Response(t.body, { headers: { ...FILE_HEADERS, 'Content-Type': t.headers.get('content-type') || 'image/jpeg' } });
}
