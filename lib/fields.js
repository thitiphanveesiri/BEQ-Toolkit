// นิยามฟิลด์ฟอร์มตาม prototype — ใช้ร่วมกันทั้ง client และ server
export const GENDERS = ['ชาย', 'หญิง', 'LGBTQ+', 'ไม่ระบุ'];

export const OPTION_GROUPS = {
  hairMethod: 'ปลูกผมย้ายราก',
  area: 'บริเวณ',
  tool: 'ปลูกด้วย',
  inj: 'งานฉีด',
  ct: 'ประเภทเคส',
  nat: 'สัญชาติ',
};

export const DEFAULT_OPTIONS = {
  hairMethod: ['FUE', 'FUT', 'DHI', 'Sapphire FUE', 'อื่นๆ'],
  area: ['ผม', 'คิ้ว', 'หนวด', 'เครา', 'จอน'],
  tool: ['istemz', 'Recall', 'Recall Plus3X', 'Recall Plus'],
  inj: ['PRP/รักษาอื่นๆ (ไม่ใช่การปลูกผม)', 'Consult'],
  ct: ['Influ', 'ฟรีรีวิว', 'รีวิว', 'ขอใช้ภาพ', 'อื่นๆ'],
  nat: ['ไทย', 'ต่างชาติ'],
};

// เลข OPD = HN- ตามด้วยตัวเลข 11 หลักเท่านั้น
export const OPD_RE = /^HN-\d{11}$/;
export const OPD_ERR = 'เลข OPD ต้องเป็นตัวเลข 11 หลัก (HN-xxxxxxxxxxx)';

// ประเภทหัตถการ: เลือก 1 ข้อ แล้วฟอร์มจะแสดงช่องย่อยตามที่เลือก
export const PROC = { hair: 'ปลูกผมย้ายราก', stem: 'ปลูก Stem Cell', inject: 'งานฉีด' };
export const PROC_TYPES = Object.values(PROC);
export const PROC_FIELDS = { [PROC.hair]: ['hairMethod', 'area'], [PROC.stem]: ['tool'], [PROC.inject]: ['inj'] };
export const PROC_DEP_KEYS = ['hairMethod', 'area', 'tool', 'inj'];
const PROC_DEP = PROC_DEP_KEYS;
export const isShown = (k, v) => !PROC_DEP.includes(k) || (PROC_FIELDS[v?.procType] || []).includes(k);

// รายชื่อทีมงานดึงจากบัญชีผู้ใช้ตามบทบาท (เปลี่ยนกฎได้ที่นี่ที่เดียว)
// ph (ใครถ่าย) ต่างกันตามฟอร์ม: Day 0 = เซลล์, BEQ Hair Center (F/U) = BT
export const TEAM_ROLES = {
  tDoc: ['doctor', 'doctor_lead'],
  tCell: ['sales'],
  tPh: { day0: ['sales'], case: ['bt'] },
  tCk: ['sales', 'doctor', 'doctor_lead'],
};

export const MULTI_SEP = ', ';
export const splitMulti = (v) => String(v || '').split(MULTI_SEP).map((x) => x.trim()).filter(Boolean);

export const F = {
  opd: { l: 'เลข OPD (HN)', t: 'opd', req: 1 },
  fname: { l: 'ชื่อ', t: 'text', req: 1 },
  lname: { l: 'นามสกุล', t: 'text', req: 1 },
  name: { l: 'ชื่อ-นามสกุล', t: 'derived' }, // สร้างอัตโนมัติจาก ชื่อ + นามสกุล (ใช้แสดงผล/ค้นหา/ตั้งชื่อโฟลเดอร์)
  gender: { l: 'เพศ', t: 'pills', o: GENDERS },
  age: { l: 'อายุ (ปี)', t: 'text', num: 1, ph: 'เช่น 35', req: 1 },
  date: { l: 'วันที่เข้ามา', t: 'date', req: 1 },
  plantDate: { l: 'วันที่ปลูก', t: 'date', req: 1 },
  nat: { l: 'สัญชาติ', t: 'select', og: 'nat', req: 1 },
  procType: { l: 'ประเภทหัตถการ', t: 'pills', o: PROC_TYPES, req: 1 },
  hairMethod: { l: 'วิธีการปลูก', t: 'select', og: 'hairMethod', blank: 1, req: 1 },
  area: { l: 'บริเวณ', t: 'multi', og: 'area', req: 1 },
  tool: { l: 'ปลูกด้วย', t: 'multi', og: 'tool', req: 1 },
  inj: { l: 'งานฉีด', t: 'multi', og: 'inj', req: 1 },
  ct: { l: 'ประเภทเคส', t: 'select', og: 'ct' },
  visitPeriod: { l: 'ระยะที่เข้ามาตรวจ', t: 'text', ph: 'เช่น 1 เดือน, 3 เดือน', req: 1, sug: ['Day 1', 'Day 7', 'Day 14', '1 เดือน', '2 เดือน', '3 เดือน', '4 เดือน', '5 เดือน', '6 เดือน', '8 เดือน', '10 เดือน', '12 เดือน'] },
  cell: { l: 'เซลล์', t: 'select', og: 'tCell', blank: 1, req: 1, empty: 'ยังไม่มีผู้ใช้บทบาท “เซลล์” — ให้ผู้ดูแลเพิ่มที่เมนู “จัดการผู้ใช้”' },
  doc: { l: 'แพทย์เจ้าของเคส', t: 'select', og: 'tDoc', blank: 1, req: 1, empty: 'ยังไม่มีผู้ใช้บทบาท “แพทย์” — ให้ผู้ดูแลเพิ่มที่เมนู “จัดการผู้ใช้”' },
  ph: { l: 'ใครถ่าย', t: 'select', og: 'tPh', blank: 1, req: 1, empty: 'ยังไม่มีผู้ใช้ในบทบาทที่เลือกได้ — ให้ผู้ดูแลเพิ่มที่เมนู “จัดการผู้ใช้”' },
  ck: { l: 'ตรวจสอบโดย', t: 'select', og: 'tCk', blank: 1, req: 1, empty: 'ยังไม่มีผู้ใช้บทบาท “เซลล์/แพทย์” — ให้ผู้ดูแลเพิ่มที่เมนู “จัดการผู้ใช้”' },
};

export const STEPS = {
  case: [
    ['ข้อมูลพื้นฐาน', ['opd', 'fname', 'lname', 'gender', 'age', 'date', 'plantDate', 'nat']],
    ['หัตถการ', ['procType', 'hairMethod', 'area', 'tool', 'inj', 'ct', 'visitPeriod']],
    ['ทีมงาน', ['doc', 'ph', 'ck']],
  ],
  day0: [
    ['ข้อมูลพื้นฐาน', ['opd', 'fname', 'lname', 'gender', 'age', 'date', 'nat']],
    ['หัตถการ', ['procType', 'hairMethod', 'area', 'tool', 'inj', 'ct']],
    ['ทีมงาน', ['cell', 'doc', 'ph', 'ck']],
  ],
};

export const FORM_TITLES = { case: 'BEQ Hair Center', day0: 'Day 0 ก่อนวาดเส้น' };
export const GROUPS_DAY0 = [
  ['front', 'ก่อนวาดเส้น'],
  ['left', 'หลังวาดเส้น'],
  ['right', 'หลังปลูกเสร็จทันที'],
];
export const groupsFor = (formType) => (formType === 'day0' ? GROUPS_DAY0 : [['single', 'รูปภาพ / วิดีโอ']]);
export const groupLabel = (g) => ([...GROUPS_DAY0, ['single', 'รูปภาพ / วิดีโอ']].find((x) => x[0] === g) || [0, g])[1];

export const keysFor = (formType) => STEPS[formType].flatMap((s) => s[1]);
export const shownKeys = (formType, v) => keysFor(formType).filter((k) => isShown(k, v));

// ข้อความสรุปหัตถการ (รองรับข้อมูลเก่าที่ยังไม่มี procType)
export function procLabel(c) {
  if (c.procType === PROC.hair) return c.area ? 'ปลูก' + splitMulti(c.area).join('/') : PROC.hair;
  if (c.procType === PROC.stem) return PROC.stem;
  if (c.procType === PROC.inject) return c.inj || PROC.inject;
  return c.area ? 'ปลูก' + c.area : c.inj || '—';
}
