// เตรียม Google Sheet: สร้างไฟล์ (ถ้ายังไม่มี SHEET_ID), สร้างแท็บ+หัวคอลัมน์, สร้างผู้ดูแลระบบคนแรก
// ใช้: npm run setup   (อ่านค่าจาก .env.local) — รันซ้ำได้ ไม่ทับข้อมูลเดิม
import bcrypt from 'bcryptjs';
process.env.DATA_MODE = 'google';
const db = await import('../lib/db.js');

for (const k of ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REFRESH_TOKEN']) {
  if (!process.env[k]) { console.error(`ยังไม่ได้ตั้ง ${k} ใน .env.local (ดู README)`); process.exit(1); }
}
try {
  if (!process.env.SHEET_ID) {
    process.env.SHEET_ID = await db.createSpreadsheet('BEQ Toolkit — ข้อมูลระบบ');
    console.log(`\nสร้าง Google Sheet แล้ว — เพิ่มบรรทัดนี้ใน .env.local และที่ที่ deploy:\nSHEET_ID=${process.env.SHEET_ID}\n`);
  }
  const added = await db.ensureSchema();
  console.log(added.length ? `สร้างแท็บ: ${added.join(', ')}` : 'โครงสร้างชีตครบแล้ว');
  if (!(await db.listUsers()).length) {
    const { ADMIN_USERNAME = 'admin', ADMIN_PASSWORD } = process.env;
    if (!ADMIN_PASSWORD || ADMIN_PASSWORD.length < 8) { console.error('ยังไม่มีผู้ใช้: ตั้ง ADMIN_PASSWORD (อย่างน้อย 8 ตัวอักษร) ใน .env.local แล้วรันใหม่'); process.exit(1); }
    await db.createUser({ username: ADMIN_USERNAME.toLowerCase(), name: 'ผู้ดูแลระบบ', role: 'admin', passwordHash: await bcrypt.hash(ADMIN_PASSWORD, 11) });
    console.log(`สร้างผู้ดูแลระบบ "${ADMIN_USERNAME}" แล้ว — เข้าสู่ระบบแล้วเปลี่ยนรหัสผ่านได้ และลบ ADMIN_PASSWORD ออกจาก .env.local`);
  }
  console.log('เสร็จเรียบร้อย');
} catch (e) { console.error('ผิดพลาด:', e.message); process.exit(1); }
