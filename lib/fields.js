// นิยามฟิลด์ฟอร์มตาม prototype — ใช้ร่วมกันทั้ง client และ server
export const GENDERS = ['ชาย', 'หญิง', 'อื่น ๆ'];

export const OPTION_GROUPS = {
  hairMethod: 'ปลูกผมย้ายราก',
  area: 'บริเวณ',
  tool: 'ปลูกด้วย',
  inj: 'งานฉีด',
  ct: 'ประเภทเคส',
  cell: 'เซลล์',
  doc: 'แพทย์เจ้าของเคส',
  staff: 'ทีมงาน (ใครถ่าย / ตรวจสอบโดย)',
  nat: 'สัญชาติ',
};

export const DEFAULT_OPTIONS = {
  hairMethod: ['FUE', 'FUT', 'DHI', 'Sapphire FUE', 'อื่นๆ'],
  area: ['ผม', 'คิ้ว', 'หนวด', 'เครา', 'จอน'],
  tool: ['istemz', 'Recall', 'Recall Plus3X', 'Recall Plus'],
  inj: ['PRP', 'รักษาอื่นๆ (ไม่ใช่การปลูก)', 'Consult'],
  ct: ['Influ', 'ฟรีรีวิว', 'รีวิว', 'ขอใช้ภาพ', 'อื่นๆ'],
  cell: [],
  doc: [],
  staff: [],
  nat: ['ไทย', 'ต่างชาติ'],
};

// เลข OPD = HN- ตามด้วยตัวเลข 11 หลักเท่านั้น
export const OPD_RE = /^HN-\d{11}$/;
export const OPD_ERR = 'เลข OPD ต้องเป็นตัวเลข 11 หลัก (HN-xxxxxxxxxxx)';

export const F = {
  opd: { l: 'เลข OPD (HN)', t: 'opd', req: 1 },
  fname: { l: 'ชื่อ', t: 'text', req: 1 },
  lname: { l: 'นามสกุล', t: 'text', req: 1 },
  name: { l: 'ชื่อ-นามสกุล', t: 'derived' }, // สร้างอัตโนมัติจาก ชื่อ + นามสกุล (ใช้แสดงผล/ค้นหา/ตั้งชื่อโฟลเดอร์)
  gender: { l: 'เพศ', t: 'pills', o: GENDERS },
  date: { l: 'วันที่เข้ามา', t: 'date', req: 1 },
  plantDate: { l: 'วันที่ปลูก', t: 'date', req: 1 },
  nat: { l: 'สัญชาติ', t: 'select', og: 'nat', req: 1 },
  hairMethod: { l: 'ปลูกผมย้ายราก', t: 'select', og: 'hairMethod' },
  area: { l: 'บริเวณ', t: 'pills', og: 'area' },
  tool: { l: 'ปลูกด้วย', t: 'pills', og: 'tool' },
  inj: { l: 'งานฉีด', t: 'pills', og: 'inj' },
  ct: { l: 'ประเภทเคส', t: 'select', og: 'ct' },
  visitPeriod: { l: 'ระยะที่เข้ามาตรวจ', t: 'text', ph: 'เช่น 1 เดือน, 3 เดือน', req: 1, sug: ['Day 1', 'Day 7', 'Day 14', '1 เดือน', '2 เดือน', '3 เดือน', '4 เดือน', '5 เดือน', '6 เดือน', '8 เดือน', '10 เดือน', '12 เดือน'] },
  cell: { l: 'เซลล์', t: 'select', og: 'cell', req: 1 },
  doc: { l: 'แพทย์เจ้าของเคส', t: 'select', og: 'doc', req: 1 },
  ph: { l: 'ใครถ่าย', t: 'select', og: 'staff', req: 1 },
  ck: { l: 'ตรวจสอบโดย', t: 'select', og: 'staff', req: 1 },
};

export const STEPS = {
  case: [
    ['ข้อมูลพื้นฐาน', ['opd', 'fname', 'lname', 'gender', 'date', 'plantDate', 'nat']],
    ['หัตถการ', ['hairMethod', 'area', 'tool', 'inj', 'ct', 'visitPeriod']],
    ['ทีมงาน', ['doc', 'ph', 'ck']],
  ],
  day0: [
    ['ข้อมูลพื้นฐาน', ['opd', 'fname', 'lname', 'gender', 'date', 'nat']],
    ['หัตถการ', ['hairMethod', 'area', 'tool', 'inj', 'ct']],
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
export const procLabel = (c) => (c.area ? 'ปลูก' + c.area : c.inj || '—');
