import test from 'node:test';
import assert from 'node:assert/strict';

// จำลอง Google Sheets: store.Media คือแถวจริงใน Sheet ซึ่ง "instance อื่น" เขียนเข้ามาได้โดย cache ของเราไม่รู้
process.env.DATA_MODE = 'google';
process.env.SHEET_ID = 'sheet-test';
Object.assign(process.env, { GOOGLE_CLIENT_ID: 'x', GOOGLE_CLIENT_SECRET: 'y', GOOGLE_REFRESH_TOKEN: 'z' });

const store = { Users: [], Records: [], Media: [], Options: [], Folders: [] };
let batchGets = 0;
const json = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'Content-Type': 'application/json' } });
const realFetch = globalThis.fetch;
globalThis.fetch = async (url) => {
  url = String(url);
  if (url.includes('oauth2.googleapis.com/token')) return json({ access_token: 't', expires_in: 3600 });
  if (url.includes('values:batchGet')) {
    batchGets++;
    return json({ valueRanges: ['Users', 'Records', 'Media', 'Options', 'Folders'].map((t) => ({ values: store[t] })) });
  }
  throw new Error('unexpected fetch ' + url);
};

const { listMedia, refreshDb } = await import('../lib/db.js');
const mediaRow = (id) => [id, 'R-1', '123', 'single', 'image', 'drive-' + id, id + '.jpg', 'image/jpeg', '11000', 'uploading', 'U-1', '', 'extra', new Date().toISOString()];

test('cache เก่าไม่เห็นแถวที่ instance อื่นเขียน แต่ refreshDb() อ่านใหม่แล้วเจอ', async () => {
  try {
    assert.deepEqual(await listMedia(), []);            // instance นี้โหลด cache ตอนยังไม่มีแถว
    store.Media.push(mediaRow('M-abc123'));             // instance อื่นจอง (init) แถวนี้ลง Sheets
    assert.equal((await listMedia()).some((m) => m.id === 'M-abc123'), false, 'cache ยังเก่า (นี่คืออาการ "ไม่พบไฟล์ที่จองไว้")');
    const before = batchGets;
    await refreshDb();
    assert.equal((await listMedia()).some((m) => m.id === 'M-abc123'), true);
    assert.equal(batchGets, before + 1, 'อ่านใหม่แค่ 1 ครั้ง ไม่กินโควตา Sheets เพิ่มโดยไม่จำเป็น');
  } finally { /* คง fetch ปลอมไว้จนจบไฟล์นี้ */ }
});

test('refreshDb() รอโหลดที่กำลังวิ่งอยู่ก่อน เพื่อไม่ได้ snapshot ที่เริ่มก่อนแถวถูกเขียน', async () => {
  store.Media = [];
  await refreshDb();
  const slowFetch = globalThis.fetch;
  let release; const gate = new Promise((r) => { release = r; });
  globalThis.fetch = async (url, opt) => { const snapshot = String(url).includes('values:batchGet') ? JSON.stringify(store) : null; if (snapshot) await gate; return snapshot ? (batchGets++, json({ valueRanges: ['Users', 'Records', 'Media', 'Options', 'Folders'].map((t) => ({ values: JSON.parse(snapshot)[t] })) })) : slowFetch(url, opt); };
  try {
    const inflight = refreshDb();                       // เริ่มโหลด (snapshot ตอนยังไม่มีแถว)
    await new Promise((r) => setTimeout(r, 5));
    store.Media.push(mediaRow('M-late999'));            // แถวถูกเขียนหลัง snapshot ถูกถ่าย
    const second = refreshDb();                         // ผู้เรียกอีกคนต้องไม่ได้ snapshot เก่า
    release();
    await inflight; await second;
    assert.equal((await listMedia()).some((m) => m.id === 'M-late999'), true);
  } finally { globalThis.fetch = slowFetch; }
});

test.after(() => { globalThis.fetch = realFetch; });
