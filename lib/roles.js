// สิทธิ์ตามบทบาท (ใช้ทั้งฝั่ง server และ client — ฝั่ง server เป็นตัวบังคับจริง)
export const ROLES = {
  admin: 'ผู้ดูแลระบบ',
  doctor: 'แพทย์',
  bt: 'BT (ผู้ช่วยแพทย์/ถ่ายภาพ)',
  sales: 'เซลล์',
  sales_lead: 'หัวหน้าเซลล์',
  checker: 'ผู้ตรวจ',
};

const MATRIX = {
  fillForm: ['admin', 'bt', 'sales', 'sales_lead'], // กรอกและส่งฟอร์ม
  upload: ['admin', 'bt'], // อัปโหลดรูป/วิดีโอ
  viewImages: ['admin', 'doctor', 'checker'], // ดูรูป/วิดีโอและข้อมูลคนไข้
  viewStats: ['admin', 'doctor', 'sales_lead'], // ดูรายงาน Dashboard
  manage: ['admin'], // จัดการผู้ใช้ ฟอร์ม และตั้งค่า
};

export const can = (role, perm) => !!MATRIX[perm]?.includes(role);
export const permsOf = (role) => Object.fromEntries(Object.keys(MATRIX).map((p) => [p, can(role, p)]));
// ค้นหา/เปิดข้อมูลคนไข้ได้เฉพาะผู้ที่มีสิทธิ์ดูรูป (หลัก least-privilege: เซลล์/BT ไม่ต้องเห็นข้อมูลคนไข้ย้อนหลัง)
export const canSearch = (role) => can(role, 'viewImages');
