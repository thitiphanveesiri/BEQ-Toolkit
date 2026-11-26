// Resumable upload เข้า Google Drive โดยตรงจากเบราว์เซอร์
// ปรับให้ทนเครือข่ายมือถือช้า/ไม่เสถียร:
//  - ตัดการเชื่อมต่อเมื่อ "ไม่มีความคืบหน้า" (stall) แทนการตั้งเพดานเวลารวม 60 วินาทีต่อชิ้น
//  - ชิ้นส่วนปรับขนาดอัตโนมัติ (4 MiB -> 512 KiB เมื่อช้า, กลับไป 4 MiB เมื่อเร็ว)
//  - นับ "ความล้มเหลวติดกัน" เฉพาะรอบที่ offset ไม่ขยับ (ถ้ายังคืบหน้าอยู่ไม่ถือว่าล้ม)
const KiB256 = 256 * 1024; // Google Drive ต้องการชิ้นส่วนเป็นพหุคูณของ 256 KiB (ยกเว้นชิ้นสุดท้าย)

// export ไว้เพื่อให้ test ปรับค่าได้ — ในแอปใช้ค่าเริ่มต้น
export const tuning = {
  chunkMax: 16 * KiB256,   // 4 MiB
  chunkMin: 2 * KiB256,    // 512 KiB
  stallMs: 40000,          // ไม่มี byte ใหม่ถูกส่งนานเท่านี้ = ถือว่าค้าง
  responseMs: 90000,       // ส่งครบแล้ว รอ Drive ตอบนานสุดเท่านี้
  queryMs: 20000,          // คำขอตรวจสถานะ offset
  fastMs: 12000,           // ชิ้นที่ส่งเสร็จเร็วกว่านี้ -> ขยายขนาดชิ้นถัดไป
  retryBaseMs: 800,
  maxStalledRetries: 8,    // จำนวนรอบล้มเหลวติดกันโดย offset ไม่ขยับ
};

const wait = (ms, signal) => new Promise((resolve, reject) => {
  if (signal?.aborted) return reject(new DOMException('Aborted', 'AbortError'));
  const t = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); reject(new DOMException('Aborted', 'AbortError')); }, { once: true });
});

export class SessionExpiredError extends Error {
  constructor() { super('ไฟล์ session อัปโหลดหมดอายุ ระบบจะเริ่มใหม่โดยใช้ไฟล์เดิม'); this.name = 'SessionExpiredError'; }
}

const transient = (message, extra) => Object.assign(new Error(message), { retryable: true }, extra);

function request(url, headers, body, onProgress, signal, idleMs) {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    let timer, stalled = false;
    const arm = (ms) => { clearTimeout(timer); timer = setTimeout(() => { stalled = true; x.abort(); }, ms); };
    const done = (fn, v) => { clearTimeout(timer); fn(v); };
    x.open('PUT', url);
    for (const [k, v] of Object.entries(headers)) x.setRequestHeader(k, v);
    // timer นี้ถูกรีเซ็ตทุกครั้งที่มี byte ใหม่ถูกส่งออกไป จึงไม่ตัดการอัปโหลดที่ช้าแต่ยังเดินอยู่
    x.upload.onprogress = (e) => { arm(idleMs); if (onProgress && e.lengthComputable) onProgress(e.loaded, e.total); };
    x.upload.onload = () => arm(tuning.responseMs);
    x.onload = () => done(resolve, { status: x.status, headers: x, retryAfter: x.getResponseHeader('Retry-After') });
    x.onerror = () => done(reject, transient('เครือข่ายหลุดระหว่างอัปโหลด'));
    x.ontimeout = () => done(reject, transient('อัปโหลดตอบสนองช้า ระบบจะตรวจสอบไฟล์ต่อ'));
    x.onabort = () => done(reject, stalled ? transient('อัปโหลดตอบสนองช้า ระบบจะตรวจสอบไฟล์ต่อ') : new DOMException('Aborted', 'AbortError'));
    if (signal) signal.addEventListener('abort', () => x.abort(), { once: true });
    arm(idleMs);
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
  const r = await request(url, { 'Content-Range': `bytes */${file.size}` }, null, null, signal, tuning.queryMs);
  if (r.status === 200 || r.status === 201) return { offset: file.size, complete: true };
  if (r.status === 308) return { offset: rangeOffset(r.headers, file.size) || 0, complete: false };
  if (r.status === 404 || r.status === 410) throw new SessionExpiredError();
  if (r.status === 429 || r.status >= 500) throw transient('ตรวจสอบสถานะไฟล์ไม่สำเร็จชั่วคราว');
  throw new Error(`ตรวจสอบสถานะไฟล์ไม่สำเร็จ (${r.status})`);
}

async function queryAfterFailure(url, file, signal) {
  let last;
  for (let i = 0; i < 4; i++) {
    try { return await queryUpload(url, file, signal); }
    catch (e) { if (e instanceof SessionExpiredError || e.name === 'AbortError') throw e; last = e; await wait(tuning.retryBaseMs * 2 ** i, signal); }
  }
  throw last;
}

export async function resumableUpload({ url, file, offset = 0, onOffset, onProgress, signal }) {
  let pos = Math.max(0, Math.min(file.size, Number(offset) || 0));
  if (pos >= file.size) return;
  let chunkSize = tuning.chunkMax, stalledRounds = 0;
  while (pos < file.size) {
    const end = Math.min(file.size, pos + chunkSize) - 1;
    const chunk = file.slice(pos, end + 1);
    const startedAt = Date.now();
    try {
      const r = await request(url, {
        'Content-Type': file.type || 'application/octet-stream',
        'Content-Range': `bytes ${pos}-${end}/${file.size}`,
      }, chunk, (loaded) => onProgress?.(Math.min(100, Math.round((pos + loaded) * 100 / file.size))), signal, tuning.stallMs);
      if (r.status === 200 || r.status === 201) { pos = file.size; onOffset?.(pos); onProgress?.(100); return; }
      if (r.status === 308) {
        const next = rangeOffset(r.headers, file.size);
        if (next == null || next <= pos) throw transient('เซิร์ฟเวอร์ไม่ยืนยันส่วนไฟล์ที่ส่งได้');
        pos = next; stalledRounds = 0; onOffset?.(pos); onProgress?.(Math.round(pos * 100 / file.size));
        // ชิ้นที่ผ่านเร็ว -> ลองชิ้นใหญ่ขึ้น (ไม่เกิน chunkMax)
        if (Date.now() - startedAt < tuning.fastMs) chunkSize = Math.min(tuning.chunkMax, chunkSize * 2);
        continue;
      }
      if (r.status === 404 || r.status === 410) throw new SessionExpiredError();
      if (r.status !== 429 && r.status < 500) throw Object.assign(new Error(`อัปโหลดไฟล์ไม่สำเร็จ (${r.status})`), { status: r.status });
      throw transient('เซิร์ฟเวอร์อัปโหลดไม่พร้อมชั่วคราว', { retryAfter: r.retryAfter, status: r.status });
    } catch (e) {
      if (e.name === 'AbortError' || e instanceof SessionExpiredError || !e.retryable) throw e;
      chunkSize = Math.max(tuning.chunkMin, chunkSize >> 1); // เครือข่ายช้า/หลุด -> ส่งชิ้นเล็กลงรอบหน้า
      const before = pos;
      const state = await queryAfterFailure(url, file, signal);
      pos = state.offset; onOffset?.(pos); onProgress?.(Math.round(pos * 100 / file.size));
      if (state.complete || pos >= file.size) return;
      // offset ขยับ = ยังคืบหน้า ไม่นับเป็นความล้มเหลว (เดิมนับสะสมจนครบ 8 แล้วขึ้นแดงทั้งที่ไฟล์กำลังไปต่อ)
      if (pos > before) stalledRounds = 0;
      else if (++stalledRounds > tuning.maxStalledRetries) throw new Error(`อัปโหลดยังไม่สำเร็จหลังจากลองหลายครั้ง (${e.message}) ระบบเก็บไฟล์ไว้ให้ลองต่อได้`);
      const delay = e.retryAfter ? Math.max(0, Number(e.retryAfter) * 1000 || 0) : Math.min(15000, tuning.retryBaseMs * 2 ** Math.max(0, stalledRounds - 1)) + Math.random() * 500 * (tuning.retryBaseMs / 800);
      await wait(delay, signal);
    }
  }
}
