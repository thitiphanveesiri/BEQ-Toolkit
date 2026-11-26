import test from 'node:test';
import assert from 'node:assert/strict';
import { resumableUpload, tuning } from '../lib/resumableUpload.js';

const KiB = 1024, MiB = 1024 * KiB;

// จำลอง Drive: ถ้าชิ้นที่ส่งใหญ่เกิน limit จะ "ค้าง" (ไม่ตอบ) แต่ไบต์ส่วนหนึ่ง (พหุคูณ 256 KiB) ถูกเก็บไว้แล้ว
// เหมือนมือถือที่ uplink ช้า — ฝั่ง client ต้องตัดเองเมื่อไม่มีความคืบหน้า
function installSlowDrive({ total, stallOver, commitPerStall = 256 * KiB }) {
  const state = { committed: 0, total, requests: [], stalls: 0 };
  const original = globalThis.XMLHttpRequest;
  globalThis.XMLHttpRequest = class {
    constructor() { this.upload = {}; this.h = {}; this.status = 0; }
    open() {}
    setRequestHeader(k, v) { this.h[k] = v; }
    getResponseHeader(n) { return n.toLowerCase() === 'range' && this.status === 308 && state.committed ? `bytes=0-${state.committed - 1}` : null; }
    abort() { this.aborted = true; clearTimeout(this.t); this.onabort?.(); }
    send(body) {
      const cr = this.h['Content-Range'];
      if (/^bytes \*\//.test(cr)) {
        this.status = state.committed >= total ? 200 : 308;
        return queueMicrotask(() => this.onload());
      }
      const [, s, e] = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(cr).map(Number);
      assert.equal(s, state.committed, 'ต้องส่งต่อจาก offset ที่ Drive รับไว้');
      state.requests.push(e - s + 1);
      if (e - s + 1 > stallOver) {
        state.stalls++;
        state.committed = Math.min(total, s + commitPerStall); // ได้ไปบางส่วนก่อนค้าง
        return; // ไม่เรียก onload -> client ต้องตัดเองด้วย stall timer
      }
      state.committed = e + 1;
      this.status = state.committed >= total ? 200 : 308;
      queueMicrotask(() => this.onload());
    }
  };
  return { state, restore: () => { globalThis.XMLHttpRequest = original; } };
}

const quick = () => Object.assign(tuning, { stallMs: 30, responseMs: 30, queryMs: 30, retryBaseMs: 1 });
const saved = { ...tuning };

test('ไฟล์ที่ชิ้น 4 MiB ส่งไม่ทันจะย่อชิ้นลงแล้วส่งต่อจน สำเร็จ', async () => {
  quick();
  const total = 6 * MiB + 321;
  const { state, restore } = installSlowDrive({ total, stallOver: 1 * MiB });
  try {
    const file = new File([new Uint8Array(total)], 'clip.mp4', { type: 'video/mp4' });
    await resumableUpload({ url: 'https://upload.test/s', file });
    assert.equal(state.committed, total);
    assert.ok(state.stalls >= 1, 'ต้องมีการค้างอย่างน้อยหนึ่งครั้ง');
    assert.ok(state.requests.some((n) => n <= 1 * MiB), 'ต้องลดขนาดชิ้นหลังค้าง');
  } finally { restore(); Object.assign(tuning, saved); }
});

test('ค้างหลายรอบติดกันแต่ offset ยังขยับ ต้องไม่ถูกนับเป็นล้มเหลว (เดิมพังที่รอบ 9)', async () => {
  quick();
  tuning.chunkMax = tuning.chunkMin = 1 * MiB; // ล็อกขนาดชิ้นเพื่อให้ค้างทุกรอบ
  const total = 3 * MiB; // 12 รอบ x 256 KiB ต่อรอบที่ค้าง > 8 รอบที่โค้ดเดิมยอมให้
  const { state, restore } = installSlowDrive({ total, stallOver: 0 });
  try {
    const file = new File([new Uint8Array(total)], 'photo.jpg', { type: 'image/jpeg' });
    await resumableUpload({ url: 'https://upload.test/s', file });
    assert.equal(state.committed, total);
    assert.ok(state.stalls > 8, `stalls=${state.stalls}`);
  } finally { restore(); Object.assign(tuning, saved); }
});

test('ค้างโดย offset ไม่ขยับเลย ต้องยอมแพ้พร้อมบอกสาเหตุ', async () => {
  quick(); tuning.maxStalledRetries = 2;
  const { restore } = installSlowDrive({ total: 2 * MiB, stallOver: 0, commitPerStall: 0 });
  try {
    const file = new File([new Uint8Array(2 * MiB)], 'photo.jpg', { type: 'image/jpeg' });
    await assert.rejects(resumableUpload({ url: 'https://upload.test/s', file }), /ลองหลายครั้ง.*ตอบสนองช้า/);
  } finally { restore(); Object.assign(tuning, saved); }
});
