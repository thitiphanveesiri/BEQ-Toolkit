// ตรวจไฟล์ .env.local และทดสอบ refresh token กับ Google (ไม่แสดงค่าลับ)  ใช้: node scripts/check-env.mjs
import fs from 'node:fs';
const raw = fs.existsSync('.env.local') ? fs.readFileSync('.env.local', 'utf8') : null;
if (raw === null) { console.log('❌ ไม่พบไฟล์ .env.local ในโฟลเดอร์นี้ (ตรวจว่าไม่ใช่ .env.local.txt)'); process.exit(); }
const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
const vals = {}, count = {};
for (const l of lines) { const i = l.indexOf('='); if (i < 0) continue; const k = l.slice(0, i).trim(); count[k] = (count[k] || 0) + 1; vals[k] = l.slice(i + 1); }
let bad = false; const no = (m) => { bad = true; console.log('❌ ' + m); };
for (const k of ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REFRESH_TOKEN']) {
  const v = vals[k];
  if (!v) { no(`${k} ว่างหรือไม่มี`); continue; }
  if (count[k] > 1) no(`${k} มี ${count[k]} บรรทัดซ้ำ — เหลือบรรทัดเดียว`);
  if (/^["']|["']$/.test(v)) no(`${k} มีเครื่องหมายคำพูดครอบ — ลบออก`);
  if (v !== v.trim() || /\s/.test(v)) no(`${k} มีช่องว่างปน`);
  if (v.includes('GOOGLE_')) no(`${k} มีชื่อตัวแปรซ้อนอยู่ในค่า (คัดลอกซ้ำ) — ใส่เฉพาะส่วนหลังเครื่องหมาย =`);
}
const id = vals.GOOGLE_CLIENT_ID || '', rt = vals.GOOGLE_REFRESH_TOKEN || '';
if (id && !id.endsWith('.apps.googleusercontent.com')) no('GOOGLE_CLIENT_ID ควรลงท้ายด้วย .apps.googleusercontent.com');
if (rt && !rt.startsWith('1//')) no('GOOGLE_REFRESH_TOKEN ควรขึ้นต้นด้วย 1//');
if (rt && rt.length < 80) no(`GOOGLE_REFRESH_TOKEN สั้นผิดปกติ (${rt.length} ตัวอักษร) อาจถูกตัด`);
console.log(`ความยาว: CLIENT_ID ${id.length}, SECRET ${(vals.GOOGLE_CLIENT_SECRET || '').length}, REFRESH_TOKEN ${rt.length}`);
if (vals.DATA_MODE === 'mock') no('DATA_MODE=mock ทำให้ไม่ต่อ Google — ลบบรรทัดนี้');
const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', body: new URLSearchParams({ client_id: id, client_secret: vals.GOOGLE_CLIENT_SECRET || '', refresh_token: rt, grant_type: 'refresh_token' }) });
const j = await r.json().catch(() => ({}));
if (r.ok) console.log('✅ Google ยอมรับ token แล้ว' + (bad ? ' (แต่แก้ข้อที่แจ้งด้านบนด้วย)' : ' — รัน npm run setup ได้เลย'));
else {
  console.log(`❌ Google ตอบ: ${j.error} ${j.error_description || ''}`);
  if (j.error === 'invalid_client') console.log('→ CLIENT_ID หรือ CLIENT_SECRET ไม่ตรงกัน/ผิด');
  if (j.error === 'invalid_grant') console.log('→ token ใช้ไม่ได้: ให้ Publish app ที่ OAuth consent screen, ถอนสิทธิ์ที่ myaccount.google.com/permissions แล้วรัน npm run get-token ใหม่ (ใช้ CLIENT_ID/SECRET ชุดเดียวกับที่อยู่ในไฟล์)');
}
