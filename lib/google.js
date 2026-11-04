// ชั้นเชื่อมต่อ Google API ฝั่ง server เท่านั้น (ใช้ refresh token จาก environment variables)
import { AppError } from './errors.js';

let tok = { v: null, exp: 0 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function accessToken() {
  if (tok.v && Date.now() < tok.exp) return tok.v;
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN } = process.env;
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REFRESH_TOKEN) {
    throw new AppError(500, 'ยังไม่ได้ตั้งค่าการเชื่อมต่อ Google (ตรวจสอบ environment variables)');
  }
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      refresh_token: GOOGLE_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  });
  if (!r.ok) {
    throw new AppError(502, 'เชื่อมต่อบัญชี Google ไม่สำเร็จ อาจต้องขอ refresh token ใหม่ (npm run get-token)');
  }
  const j = await r.json();
  tok = { v: j.access_token, exp: Date.now() + (j.expires_in - 120) * 1000 };
  return tok.v;
}

// จำกัดจำนวนคำขอพร้อมกัน
let active = 0;
const waiters = [];
const MAX = 6;
async function acquire() {
  if (active < MAX) { active++; return; }
  await new Promise((r) => waiters.push(r));
  active++;
}
function release() {
  active--;
  const n = waiters.shift();
  if (n) n();
}

// retry แบบ exponential backoff เฉพาะข้อผิดพลาดชั่วคราว (429/5xx/401 token หมดอายุ)
// ไม่ retry 400/403/404
export async function gfetch(url, opt = {}, { retries = 3, limited = true } = {}) {
  if (limited) await acquire();
  try {
    for (let i = 0; ; i++) {
      const t = await accessToken();
      let r;
      try {
        r = await fetch(url, { ...opt, headers: { Authorization: 'Bearer ' + t, ...(opt.headers || {}) } });
      } catch (e) {
        if (i < retries) { await sleep(300 * 2 ** i); continue; }
        throw new AppError(502, 'เชื่อมต่อ Google ไม่ได้ในขณะนี้ กรุณาลองใหม่');
      }
      if (r.status === 401 && i < retries) { tok = { v: null, exp: 0 }; continue; }
      if ((r.status === 429 || r.status >= 500) && i < retries) {
        await sleep(300 * 2 ** i + Math.random() * 200);
        continue;
      }
      return r;
    }
  } finally {
    if (limited) release();
  }
}

export async function gjson(url, opt, what = 'Google') {
  const r = await gfetch(url, opt);
  if (!r.ok) {
    if (r.status === 403) throw new AppError(502, `บัญชี Google ไม่มีสิทธิ์เข้าถึง ${what}`);
    if (r.status === 404) throw new AppError(502, `ไม่พบ ${what} (ตรวจสอบ SHEET_ID / สิทธิ์)`);
    if (r.status === 429) throw new AppError(503, 'Google จำกัดจำนวนคำขอชั่วคราว กรุณาลองใหม่อีกครั้ง');
    throw new AppError(502, `${what} ตอบกลับผิดปกติ (${r.status})`);
  }
  return r.json();
}
