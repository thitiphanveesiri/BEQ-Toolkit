// สิทธิ์ตามบทบาท (ใช้ทั้งฝั่ง server และ client — ฝั่ง server เป็นตัวบังคับจริง)
export const ROLES = {
  admin: 'ผู้ดูแลระบบ',
  doctor: 'แพทย์',
  doctor_lead: 'หัวหน้าแพทย์',
  bt: 'BT (ผู้ช่วยแพทย์/ถ่ายภาพ)',
  sales: 'เซลล์',
  sales_lead: 'หัวหน้าเซลล์',
  checker: 'ผู้ตรวจ',
};

const MATRIX = {
  fillForm: ['admin', 'bt', 'sales', 'sales_lead'], // กรอกและส่งฟอร์ม
  upload: ['admin', 'bt'], // อัปโหลดรูป/วิดีโอ
  viewImages: ['admin', 'doctor', 'doctor_lead', 'checker'], // ดูรูป/วิดีโอและข้อมูลคนไข้
  viewStats: ['admin', 'doctor', 'doctor_lead', 'sales_lead'], // ดูรายงาน Dashboard
  editData: ['admin', 'doctor', 'doctor_lead'], // แก้ไขข้อมูลคนไข้จากหน้าข้อมูลคนไข้ (แพทย์เห็น/แก้ได้เฉพาะเคสที่ตัวเองดูแล)
  manage: ['admin'], // จัดการผู้ใช้ ฟอร์ม และตั้งค่า
};

// ผู้ดูแลปรับสิทธิ์รายบัญชีได้ 4 ข้อ (นอกเหนือจากบทบาท) เก็บในคอลัมน์ perms ของชีต Users เช่น "upload:1,viewStats:0"
// 1 = อนุญาตเพิ่ม, 0 = ไม่อนุญาต, ไม่มี = ตามบทบาท  (สิทธิ์ของ admin ปรับลดไม่ได้)
// คำนำหน้าของแพทย์ที่แสดงหน้าชื่อในรายการเลือก (ค่าว่าง = นายแพทย์)
export const DOC_TITLES = ['นายแพทย์', 'แพทย์หญิง'];
export const cleanTitle = (t) => (DOC_TITLES.includes(t) ? t : '');
export const OVERRIDABLE = ['viewImages', 'upload', 'viewStats', 'editData'];
export const parseOverrides = (s) => Object.fromEntries(String(s || '').split(',').map((x) => x.trim().split(':')).filter(([k, v]) => OVERRIDABLE.includes(k) && (v === '1' || v === '0')).map(([k, v]) => [k, v === '1']));
export const serializeOverrides = (o) => OVERRIDABLE.filter((k) => typeof o?.[k] === 'boolean').map((k) => `${k}:${o[k] ? 1 : 0}`).join(',');

// subject = ชื่อบทบาท (string) หรือผู้ใช้ {role, perms}
export function can(subject, perm) {
  const role = typeof subject === 'string' ? subject : subject?.role;
  if (role === 'admin') return !!MATRIX[perm]?.includes('admin');
  const ov = typeof subject === 'string' ? {} : parseOverrides(subject?.perms);
  if (perm in ov) return ov[perm];
  return !!MATRIX[perm]?.includes(role);
}
export const permsOf = (subject) => Object.fromEntries(Object.keys(MATRIX).map((p) => [p, can(subject, p)]));
// ค้นหา/เปิดข้อมูลคนไข้ได้เฉพาะผู้ที่มีสิทธิ์ดูรูป (หลัก least-privilege: เซลล์/BT ไม่ต้องเห็นข้อมูลคนไข้ย้อนหลัง)
export const canSearch = (subject) => can(subject, 'viewImages');
