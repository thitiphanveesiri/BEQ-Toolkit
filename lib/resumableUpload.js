const CHUNK = 4 * 1024 * 1024;
const wait = (ms, signal) => new Promise((resolve, reject) => {
  if (signal?.aborted) return reject(new DOMException('Aborted', 'AbortError'));
  const t = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); reject(new DOMException('Aborted', 'AbortError')); }, { once: true });
});

export class SessionExpiredError extends Error {
  constructor() { super('ไฟล์ session อัปโหลดหมดอายุ ระบบจะเริ่มใหม่โดยใช้ไฟล์เดิม'); this.name = 'SessionExpiredError'; }
}

function request(url, file, headers, body, onProgress, signal) {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open('PUT', url);
    for (const [k, v] of Object.entries(headers)) x.setRequestHeader(k, v);
    if (onProgress) x.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded, e.total); };
    x.timeout = 60000;
    x.onload = () => resolve({ status: x.status, headers: x, retryAfter: x.getResponseHeader('Retry-After') });
    x.onerror = () => reject(new Error('เครือข่ายหลุดระหว่างอัปโหลด'));
    x.ontimeout = () => reject(new Error('อัปโหลดตอบสนองช้า ระบบจะตรวจสอบไฟล์ต่อ'));
    x.onabort = () => reject(new DOMException('Aborted', 'AbortError'));
    if (signal) signal.addEventListener('abort', () => x.abort(), { once: true });
    x.send(body ?? null);
  });
}

function rangeOffset(headers, total) {
  const range = headers.getResponseHeader('Range');
  if (!range) return null;
  const m = /bytes=0-(\d+)/.exec(range);
  if (!m) return null;
  return Math.min(total, Number(m[1]) + 1);
}

export async function queryUpload(url, file, signal) {
  const r = await request(url, file, { 'Content-Range': `bytes */${file.size}` }, null, null, signal);
  if (r.status === 200 || r.status === 201) return { offset: file.size, complete: true };
  if (r.status === 308) return { offset: rangeOffset(r.headers, file.size) || 0, complete: false };
  if (r.status === 404 || r.status === 410) throw new SessionExpiredError();
  if (r.status === 429 || r.status >= 500) throw new Error('ตรวจสอบสถานะไฟล์ไม่สำเร็จชั่วคราว');
  throw new Error(`ตรวจสอบสถานะไฟล์ไม่สำเร็จ (${r.status})`);
}

async function queryAfterFailure(url, file, signal) {
  let last;
  for (let i = 0; i < 4; i++) {
    try { return await queryUpload(url, file, signal); }
    catch (e) { if (e instanceof SessionExpiredError) throw e; last = e; await wait(700 * 2 ** i, signal); }
  }
  throw last;
}

export async function resumableUpload({ url, file, offset = 0, onOffset, onProgress, signal }) {
  let pos = Math.max(0, Math.min(file.size, Number(offset) || 0));
  if (pos >= file.size) return;
  let failures = 0;
  while (pos < file.size) {
    const end = Math.min(file.size, pos + CHUNK) - 1;
    const chunk = file.slice(pos, end + 1);
    try {
      const r = await request(url, file, {
        'Content-Type': file.type || 'application/octet-stream',
        'Content-Range': `bytes ${pos}-${end}/${file.size}`,
      }, chunk, (loaded) => onProgress?.(Math.min(100, Math.round((pos + loaded) * 100 / file.size))), signal);
      if (r.status === 200 || r.status === 201) { pos = file.size; onOffset?.(pos); onProgress?.(100); return; }
      if (r.status === 308) {
        const next = rangeOffset(r.headers, file.size);
        if (next == null || next <= pos) throw new Error('เซิร์ฟเวอร์ไม่ยืนยันส่วนไฟล์ที่ส่งได้');
        pos = next; failures = 0; onOffset?.(pos); onProgress?.(Math.round(pos * 100 / file.size));
        continue;
      }
      if (r.status === 404 || r.status === 410) throw new SessionExpiredError();
      if (r.status !== 429 && r.status < 500) throw new Error(`อัปโหลดไฟล์ไม่สำเร็จ (${r.status})`);
      throw Object.assign(new Error('เซิร์ฟเวอร์อัปโหลดไม่พร้อมชั่วคราว'), { retryAfter: r.retryAfter });
    } catch (e) {
      if (e.name === 'AbortError' || e instanceof SessionExpiredError) throw e;
      if (!/เครือข่าย|ช้า|ชั่วคราว|ยืนยันส่วน/.test(e.message)) throw e;
      if (failures >= 8) throw new Error('อัปโหลดยังไม่สำเร็จหลังจากลองหลายครั้ง ระบบเก็บไฟล์ไว้ให้ลองต่อได้');
      const attempt = failures++;
      const state = await queryAfterFailure(url, file, signal);
      pos = state.offset; onOffset?.(pos); onProgress?.(Math.round(pos * 100 / file.size));
      if (state.complete || pos >= file.size) return;
      const delay = e.retryAfter ? Math.max(0, Number(e.retryAfter) * 1000 || 0) : Math.min(15000, 800 * 2 ** attempt) + Math.random() * 500;
      await wait(delay, signal);
    }
  }
}
