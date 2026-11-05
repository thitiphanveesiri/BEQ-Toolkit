// ขอบเขตข้อมูลคนไข้ของแพทย์
// ตอนนี้แพทย์ทุกคนค้นหา/ดู/(แก้ไขตามสิทธิ์) คนไข้ได้ทั้งหมด ไม่ต้องเป็นแพทย์เจ้าของเคส (คืน null = ไม่จำกัด)
// ถ้าต้องการกลับไปจำกัดให้แพทย์เห็นเฉพาะเคสของตัวเอง ให้ตั้ง RESTRICT_DOCTORS = true
// จับคู่ด้วยชื่อที่แสดงของบัญชี (ชื่อเดียวกับที่ปรากฏใน dropdown แพทย์เจ้าของเคส)
import { listRecords } from './db.js';

const RESTRICT_DOCTORS = false;

// OPD ที่แพทย์คนนี้เป็น "แพทย์เจ้าของเคส" ในฟอร์มใดฟอร์มหนึ่ง (เฉพาะบทบาท doctor)
export async function myOpds(user) {
  if (user.role !== 'doctor') return null;
  const name = String(user.name || '').trim();
  return new Set((await listRecords()).filter((r) => String(r.doc || '').trim() === name).map((r) => r.opd));
}

export async function ownedOpds(user) {
  return RESTRICT_DOCTORS ? myOpds(user) : null;
}
