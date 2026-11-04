// การยืนยันตัวตน: รหัสผ่านเก็บแบบ bcrypt hash, session เป็นคุกกี้ httpOnly ที่เซ็นด้วย HMAC
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { cookies } from 'next/headers';
import { AppError } from './errors.js';
import { getUserById, getUserByUsername } from './db.js';

const COOKIE = 'beq_session';
const TTL_S = 12 * 3600;
const dev = process.env.NODE_ENV !== 'production';
const devSecret = crypto.randomBytes(32).toString('hex'); // dev: เปลี่ยนทุกครั้งที่รีสตาร์ท
function secret() {
  const s = process.env.SESSION_SECRET;
  if (s && s.length >= 32) return s;
  if (dev) return (globalThis.__beqDevSecret ||= devSecret);
  throw new AppError(500, 'ต้องตั้ง SESSION_SECRET (อย่างน้อย 32 ตัวอักษร)');
}
const b64 = (b) => Buffer.from(b).toString('base64url');
const mac = (data) => crypto.createHmac('sha256', secret()).update(data).digest('base64url');

export const hashPassword = (pw) => bcrypt.hash(pw, 11);

// โทเคนเซ็น HMAC อายุสั้น ใช้ยืนยันว่า "ไฟล์นี้ถูกอนุญาตให้อัปโหลดโดยผู้ใช้นี้" ระหว่างขั้น init → complete
export function signToken(obj, ttlSec = 7200) {
  const p = b64(JSON.stringify({ ...obj, exp: Math.floor(Date.now() / 1000) + ttlSec }));
  return `${p}.${mac(p)}`;
}
export function readToken(t) {
  const [p, sig] = String(t || '').split('.');
  if (!p || !sig || sig.length !== mac(p).length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(mac(p)))) throw new AppError(400, 'โทเคนอัปโหลดไม่ถูกต้อง');
  const d = JSON.parse(Buffer.from(p, 'base64url').toString());
  if (d.exp < Date.now() / 1000) throw new AppError(400, 'โทเคนอัปโหลดหมดอายุ กรุณาลองใหม่');
  return d;
}
const DUMMY = bcrypt.hashSync('dummy-password-for-timing', 11);

export async function verifyLogin(username, password) {
  const u = await getUserByUsername(String(username || '').trim());
  const ok = await bcrypt.compare(String(password || ''), u?.passwordHash || DUMMY);
  return ok && u && u.active === 'TRUE' ? u : null;
}

export async function startSession(user) {
  const payload = b64(JSON.stringify({ uid: user.id, exp: Math.floor(Date.now() / 1000) + TTL_S }));
  (await cookies()).set(COOKIE, `${payload}.${mac(payload)}`, { httpOnly: true, sameSite: 'lax', secure: !dev, path: '/', maxAge: TTL_S });
}
export async function endSession() { (await cookies()).delete(COOKIE); }

// คืนผู้ใช้ปัจจุบัน (ตรวจซ้ำว่ายัง active และใช้บทบาทล่าสุดจากชีต) หรือ null
export async function currentUser() {
  const v = (await cookies()).get(COOKIE)?.value;
  if (!v) return null;
  const [p, sig] = v.split('.');
  if (!p || !sig) return null;
  const want = mac(p);
  if (sig.length !== want.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return null;
  let d; try { d = JSON.parse(Buffer.from(p, 'base64url').toString()); } catch { return null; }
  if (!d.exp || d.exp < Date.now() / 1000) return null;
  const u = await getUserById(d.uid);
  if (!u || u.active !== 'TRUE') return null;
  return { id: u.id, username: u.username, name: u.name, role: u.role };
}

/* จำกัดการเดารหัสผ่าน: ผิด 5 ครั้งภายใน 10 นาที (ต่อ IP+username) ล็อก 10 นาที */
const fails = (globalThis.__beqFails ||= new Map());
export function loginGuard(key) {
  const f = fails.get(key);
  if (f && f.until > Date.now()) throw new AppError(429, 'พยายามเข้าสู่ระบบผิดหลายครั้ง กรุณารอสักครู่แล้วลองใหม่');
}
export function loginFailed(key) {
  const f = fails.get(key) || { n: 0, first: Date.now(), until: 0 };
  if (Date.now() - f.first > 600000) { f.n = 0; f.first = Date.now(); }
  f.n++; if (f.n >= 5) f.until = Date.now() + 600000;
  fails.set(key, f);
}
export const loginOk = (key) => fails.delete(key);
