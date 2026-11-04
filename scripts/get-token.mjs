// ขอ refresh token ของบัญชี Google ที่จะใช้เก็บข้อมูล (รันครั้งเดียวบนเครื่องที่มีเบราว์เซอร์)
// ใช้: ใส่ GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET ใน .env.local แล้วรัน  npm run get-token
import http from 'node:http';

const { GOOGLE_CLIENT_ID: id, GOOGLE_CLIENT_SECRET: secret } = process.env;
if (!id || !secret) { console.error('ต้องตั้ง GOOGLE_CLIENT_ID และ GOOGLE_CLIENT_SECRET ใน .env.local ก่อน (ดู README ข้อ 2)'); process.exit(1); }
const PORT = 53682, redirect = `http://127.0.0.1:${PORT}/callback`;
// สิทธิ์ขั้นต่ำ: Sheets + Drive เฉพาะไฟล์ที่แอปนี้สร้างเอง (ไม่เห็นไฟล์อื่นใน Drive)
const scope = ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive.file'].join(' ');
const url = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({ client_id: id, redirect_uri: redirect, response_type: 'code', scope, access_type: 'offline', prompt: 'consent' });

const srv = http.createServer(async (req, res) => {
  const u = new URL(req.url, redirect);
  if (u.pathname !== '/callback') { res.end(); return; }
  const code = u.searchParams.get('code');
  if (!code) { res.end('ไม่ได้รับ code: ' + (u.searchParams.get('error') || '')); srv.close(); return; }
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', body: new URLSearchParams({ code, client_id: id, client_secret: secret, redirect_uri: redirect, grant_type: 'authorization_code' }) });
  const j = await r.json();
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  if (!j.refresh_token) { res.end('<p>ไม่ได้รับ refresh token — ไปที่ myaccount.google.com/permissions ถอนสิทธิ์แอปนี้ แล้วรันใหม่</p>'); console.error(j); srv.close(); return; }
  res.end('<p>สำเร็จ กลับไปดูที่เทอร์มินัลได้เลย</p>');
  console.log('\nGOOGLE_REFRESH_TOKEN=' + j.refresh_token + '\n\nคัดลอกบรรทัดบนไปใส่ใน .env.local (และใน Environment Variables ของที่ deploy) ห้ามแชร์ค่านี้');
  srv.close();
});
srv.listen(PORT, '127.0.0.1', () => console.log('เปิดลิงก์นี้ในเบราว์เซอร์ แล้วเข้าสู่ระบบด้วยบัญชี Google ที่จะเก็บข้อมูล:\n\n' + url + '\n'));
