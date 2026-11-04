// ขอบเขตข้อมูลคนไข้ของแพทย์: แพทย์ (doctor) เห็นเฉพาะ OPD ที่ตัวเองเป็น "แพทย์เจ้าของเคส" ในฟอร์มใดฟอร์มหนึ่ง
// หัวหน้าแพทย์ / ผู้ดูแล / ผู้ตรวจ / บัญชีอื่นที่ได้สิทธิ์ดูรูป เห็นทั้งหมด (คืน null = ไม่จำกัด)
// จับคู่ด้วยชื่อที่แสดงของบัญชี (ชื่อเดียวกับที่ปรากฏใน dropdown แพทย์เจ้าของเคส) — ถ้าเปลี่ยนชื่อบัญชี ฟอร์มเก่าจะไม่ตรงกับชื่อใหม่
import { listRecords } from './db.js';

export async function ownedOpds(user) {
  if (user.role !== 'doctor') return null;
  const name = String(user.name || '').trim();
  return new Set((await listRecords()).filter((r) => String(r.doc || '').trim() === name).map((r) => r.opd));
}
