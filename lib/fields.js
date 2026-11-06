// นิยามฟิลด์ฟอร์มตาม prototype — ใช้ร่วมกันทั้ง client และ server
export const GENDERS = ['ชาย', 'หญิง'];
// ข้อมูลพื้นฐานของคนไข้: ถ้า HN นี้เคยมีข้อมูลแล้ว ฟอร์มจะเติมให้และล็อกไม่ให้แก้ (แก้ได้ที่หน้าข้อมูลคนไข้โดยผู้มีสิทธิ์)
export const BASIC_LOCK = ['fname', 'mname', 'lname', 'gender', 'age', 'nat'];

export const OPTION_GROUPS = {
  hairMethod: 'วิธีการปลูก (Hair Transplantation)',
  area: 'บริเวณ',
  tool: 'ปลูกด้วย',
  inj: 'Rejuvenation',
  ct: 'ประเภทเคส',
  nat: 'สัญชาติ',
};

export const DEFAULT_OPTIONS = {
  hairMethod: ['FUE', 'FUT', 'DHI', 'Sapphire FUE', 'อื่น ๆ'],
  area: ['ผม', 'คิ้ว', 'หนวด', 'เครา', 'จอน'],
  tool: ['iStemz', 'ReCell', 'ReCell Plus3X'],
  inj: ['PRP'],
  ct: ['Influ', 'ฟรีรีวิว', 'รีวิว', 'ขอใช้ภาพ', 'อื่น ๆ'],
  nat: ['ไทย', 'ต่างชาติ'],
};

// เลข OPD = HN- ตามด้วยตัวเลข 12 หลักเท่านั้น (ข้อมูลเก่าที่เป็น 11 หลักยังดูได้ตามเดิม)
export const OPD_LEN = 12;
export const OPD_RE = /^HN-\d{5}-\d-\d{6}$/; // ค่าที่เก็บ: HN-12345-6-789012 (รูปแบบเก่า HN-123456789012 ถูกแปลงให้ตอนอ่าน)
// รูปแบบแสดงผลเลข HN: 12345-6-789012 (5-1-6) — ค่าที่เก็บยังเป็น HN-123456789012
export const fmtDigits = (d) => { d = String(d || '').replace(/\D/g, '').slice(0, OPD_LEN); return d.slice(0, 5) + (d.length > 5 ? '-' + d[5] : '') + (d.length > 6 ? '-' + d.slice(6) : ''); };
export const fmtOpd = (opd) => (OPD_RE.test(opd || '') ? opd.slice(3) : opd || '');
// แปลงเลข HN ให้อยู่ในรูปแบบมาตรฐาน HN-12345-6-789012 (รับได้ทั้งเลข 12 หลักล้วน, มี/ไม่มี HN-, มี/ไม่มีขีด) — ค่าอื่นคืนตามเดิม
export const canonOpd = (s) => { const v = String(s || '').replace(/\s+/g, '').toUpperCase(); const d = v.replace(/^HN-?/, '').replace(/-/g, ''); return /^\d{12}$/.test(d) ? 'HN-' + fmtDigits(d) : v; };
export const legacyOpd = (opd) => (OPD_RE.test(opd || '') ? 'HN-' + opd.slice(3).replace(/-/g, '') : opd);
export const OPD_ERR = 'เลข OPD ต้องเป็นตัวเลข 12 หลัก (รูปแบบ 12345-6-789012)';

// ประเภทหัตถการ: เลือก 1 ข้อ แล้วฟอร์มจะแสดงช่องย่อยตามที่เลือก
export const PROC = { hair: 'Hair Transplantation', stem: 'Cell Therapy', inject: 'Rejuvenation' };
// ชื่อประเภทหัตถการเดิม (ข้อมูลที่บันทึกไว้ก่อนเปลี่ยนชื่อ) → ชื่อใหม่
const PROC_OLD = { 'ปลูกผมย้ายราก': PROC.hair, 'ปลูกย้ายราก': PROC.hair, 'ปลูก Stem Cell': PROC.stem, 'งานฉีด': PROC.inject };
export const PROC_TYPES = Object.values(PROC);
export const PROC_FIELDS = { [PROC.hair]: ['hairMethod', 'area'], [PROC.stem]: ['tool'], [PROC.inject]: ['inj'] };
export const PROC_DEP_KEYS = ['hairMethod', 'area', 'tool', 'inj'];
const PROC_DEP = PROC_DEP_KEYS;
// ประเภทหัตถการเลือกได้หลายข้อ (เก็บคั่นด้วย ", ") — ช่องย่อยของทุกประเภทที่เลือกจะแสดงและเป็นช่องบังคับ
export const isShown = (k, v) => !PROC_DEP.includes(k) || splitMulti(v?.procType).some((t) => (PROC_FIELDS[t] || []).includes(k));
// ช่องย่อยที่ต้องล้างค่า เมื่อประเภทหัตถการที่เลือกเปลี่ยนไป (เฉพาะช่องของประเภทที่ไม่ได้เลือกแล้ว)
export const depsToClear = (procType) => Object.fromEntries(PROC_DEP_KEYS.filter((d) => !isShown(d, { procType })).map((d) => [d, '']));

// รายชื่อทีมงานดึงจากบัญชีผู้ใช้ตามบทบาท (เปลี่ยนกฎได้ที่นี่ที่เดียว)
// ph (ใครถ่าย) ต่างกันตามฟอร์ม: Day 0 = เซลล์, BEQ Hair Center (F/U) = BT
export const TEAM_ROLES = {
  tDoc: ['doctor', 'doctor_lead'],
  tCell: ['sales', 'sales_lead'],
  tPh: { day0: ['sales', 'sales_lead'], case: ['bt'] },
  tCk: ['sales', 'sales_lead', 'doctor', 'doctor_lead'],
};

// ครั้งที่เข้ารับหัตถการ (ไม่ใช่การมา F/U): คนไข้คนเดิมกลับมาทำใหม่ = ครั้งที่ 2, 3
export const ROUNDS = ['ครั้งที่ 1', 'ครั้งที่ 2', 'ครั้งที่ 3'];
export const roundNo = (r) => parseInt(String(r || '').replace(/\D/g, ''), 10) || 1;

// ระยะที่เข้ามาตรวจ: ตัวเลข + หน่วย เช่น 13 วัน, 5 เดือน
export const PERIOD_UNITS = ['วัน', 'สัปดาห์', 'เดือน', 'ปี'];
export const PERIOD_RE = /^(\d{1,3}) (วัน|สัปดาห์|เดือน|ปี)$/;
export const PERIOD_QUICK = ['7 วัน', '14 วัน', '1 เดือน', '3 เดือน', '6 เดือน', '12 เดือน'];

export const MULTI_SEP = ', ';
export const splitMulti = (v) => String(v || '').split(MULTI_SEP).map((x) => x.trim()).filter(Boolean);

export const F = {
  opd: { l: 'เลข OPD (HN)', t: 'opd', req: 1 },
  fname: { l: 'ชื่อ', t: 'text', req: 1 },
  mname: { l: 'ชื่อกลาง', t: 'text', hint: 'ถ้ามี เช่น คนไข้ชาวต่างชาติ' },
  lname: { l: 'นามสกุล', t: 'text', req: 1 },
  name: { l: 'ชื่อ-นามสกุล', t: 'derived' }, // สร้างอัตโนมัติจาก ชื่อ + นามสกุล (ใช้แสดงผล/ค้นหา/ตั้งชื่อโฟลเดอร์)
  gender: { l: 'เพศ', t: 'pills', o: GENDERS, req: 1 },
  age: { l: 'อายุ (ปี)', t: 'text', num: 1, ph: 'เช่น 35', req: 1 },
  // Day 0: เรียก "วันที่มาปลูก" และเลือกย้อนหลังได้ไม่เกิน 1 วัน (วันนี้และอนาคตเลือกได้) — ตรวจซ้ำที่ server ตอนบันทึกเคสใหม่
  date: { l: 'วันที่เข้ามา', t: 'date', req: 1, ll: { day0: 'วันที่มาปลูก' }, minBack: { day0: 1 } },
  plantDate: { l: 'วันที่ปลูก', t: 'date', req: 1 },
  nat: { l: 'สัญชาติ', t: 'select', og: 'nat', req: 1 },
  round: { l: 'ครั้งที่เข้ามารับหัตถการ', t: 'pills', o: ROUNDS, req: 1, hintBy: { day0: 'ไม่ใช่การมา F/U — ครั้งที่ 1 = อัปเดต Day 0 เดิม, ครั้งที่ 2/3 = มาทำหัตถการรอบใหม่', case: 'คนไข้นี้มีหลายรอบ — เลือกรอบที่มา F/U' } },
  procType: { l: 'ประเภทหัตถการ', t: 'multi', o: PROC_TYPES, req: 1, hintBy: { case: 'เติมจากหัตถการเดิมให้ — ถ้าคนไข้ทำหัตถการเพิ่มเติม/เปลี่ยน ให้แก้ตรงนี้ ระบบจะแสดงเป็น “หัตถการเพิ่มเติม” ในข้อมูลคนไข้' } },
  hairMethod: { l: 'วิธีการปลูก', t: 'select', og: 'hairMethod', blank: 1, req: 1 },
  area: { l: 'บริเวณ', t: 'multi', og: 'area', req: 1 },
  tool: { l: 'ปลูกด้วย', t: 'multi', og: 'tool', req: 1 },
  inj: { l: 'Rejuvenation', t: 'multi', og: 'inj', req: 1 },
  ct: { l: 'ประเภทเคส', t: 'select', og: 'ct' },
  visitPeriod: { l: 'ระยะที่เข้ามาตรวจ', t: 'period', req: 1, hint: 'ระบุตัวเลขและหน่วย เช่น 13 วัน, 5 เดือน' },
  cell: { l: 'เซลล์', t: 'select', og: 'tCell', blank: 1, req: 1, empty: 'ยังไม่มีผู้ใช้บทบาท “เซลล์” — ให้ผู้ดูแลเพิ่มที่เมนู “จัดการผู้ใช้”' },
  doc: { l: 'แพทย์เจ้าของเคส', t: 'select', og: 'tDoc', blank: 1, req: 1, empty: 'ยังไม่มีผู้ใช้บทบาท “แพทย์” — ให้ผู้ดูแลเพิ่มที่เมนู “จัดการผู้ใช้”' },
  ph: { l: 'ใครถ่าย', t: 'select', og: 'tPh', blank: 1, req: 1, empty: 'ยังไม่มีผู้ใช้ในบทบาทที่เลือกได้ — ให้ผู้ดูแลเพิ่มที่เมนู “จัดการผู้ใช้”' },
  ck: { l: 'ตรวจสอบโดย', t: 'select', og: 'tCk', blank: 1, req: 1, empty: 'ยังไม่มีผู้ใช้บทบาท “เซลล์/แพทย์” — ให้ผู้ดูแลเพิ่มที่เมนู “จัดการผู้ใช้”' },
};

export const STEPS = {
  case: [
    ['ข้อมูลพื้นฐาน', ['opd', 'fname', 'mname', 'lname', 'gender', 'age', 'date', 'plantDate', 'nat']],
    ['หัตถการ', ['procType', 'hairMethod', 'area', 'tool', 'inj', 'ct', 'visitPeriod']],
    ['ทีมงาน', ['doc', 'ph', 'ck']],
  ],
  day0: [
    ['ข้อมูลพื้นฐาน', ['opd', 'fname', 'mname', 'lname', 'gender', 'age', 'date', 'nat']],
    ['หัตถการ', ['round', 'procType', 'hairMethod', 'area', 'tool', 'inj', 'ct']],
    ['ทีมงาน', ['cell', 'doc', 'ph', 'ck']],
  ],
};

export const FORM_TITLES = { case: 'คนไข้ติดตามผลตามระยะ Follow-Up(F/U)', day0: 'คนไข้เข้ารับบริการ(DAY 0)' };
export const GROUPS_DAY0 = [
  ['front', 'ก่อนวาดเส้น'],
  ['left', 'หลังวาดเส้น'],
  ['right', 'หลังปลูกเสร็จทันที'],
];
export const groupsFor = (formType) => (formType === 'day0' ? GROUPS_DAY0 : [['single', 'รูปภาพ / วิดีโอ']]);
export const groupLabel = (g) => ([...GROUPS_DAY0, ['single', 'รูปภาพ / วิดีโอ']].find((x) => x[0] === g) || [0, g])[1];

// ช่องบังคับกรอก: ฟอร์ม F/U ไม่บังคับเลือกประเภทหัตถการ (เลือกเมื่อคนไข้มาทำหัตถการเพิ่มเติมนอกเหนือจากการมา F/U)
export const isReq = (k, formType) => !!F[k].req && !(formType === 'case' && k === 'procType');
export const keysFor = (formType) => STEPS[formType].flatMap((s) => s[1]);
export const shownKeys = (formType, v) => keysFor(formType).filter((k) => isShown(k, v));

// ข้อความสรุปหัตถการ (รองรับข้อมูลเก่าที่ยังไม่มี procType)
export function procLabel(c) {
  const hair = () => PROC.hair + (c.area ? ` (${splitMulti(c.area).join(', ')})` : '');
  const types = splitMulti(c.procType);
  if (types.length) return types.map((t) => (t === PROC.hair ? hair() : t === PROC.stem ? PROC.stem : t === PROC.inject ? c.inj || PROC.inject : t)).join(' + ');
  return c.area ? hair() : c.inj || '—';
}

// รายละเอียดสั้นๆ ของหัตถการ: วิธีที่ทำ / Stem Cell ที่ใช้ / รายการฉีด
export const procDetail = (c) => {
  const types = splitMulti(c.procType);
  if (!types.length) return c.tool || c.hairMethod || c.inj || '';
  return types.map((t) => (t === PROC.hair ? c.hairMethod : t === PROC.stem ? c.tool : t === PROC.inject ? c.inj : '')).filter(Boolean).join(' · ');
};

// ชื่อช่องตามฟอร์ม (Day 0 เรียกวันที่เข้ามาว่า "วันที่มาปลูก")
export const labelOf = (k, formType) => F[k]?.ll?.[formType] || F[k]?.l || k;
// วันที่เก่าสุดที่เลือกได้ตอนกรอกเคสใหม่ (null = ไม่จำกัด) — today เป็นข้อความ YYYY-MM-DD
export function minDateFor(k, formType, today) {
  const n = F[k]?.minBack?.[formType];
  if (n == null) return null;
  const d = new Date(today + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

// ปรับข้อมูลเก่าที่บันทึกก่อนเปลี่ยนชื่อ/รูปแบบให้ตรงกับของใหม่ตอนอ่านจากชีต (ไม่แก้ชีตเดิม)
const TOOL_MAP = { istemz: 'iStemz', Recall: 'ReCell', 'Recall Plus3X': 'ReCell Plus3X' };
const OTHER = { 'อื่นๆ': 'อื่น ๆ' };
export const normProc = (v) => PROC_OLD[v] || v;
export function normLegacy(r) {
  const o = { ...r };
  if (o.opd) o.opd = canonOpd(o.opd);
  if (o.procType) o.procType = splitMulti(o.procType).map(normProc).join(MULTI_SEP);
  if (o.tool) o.tool = splitMulti(o.tool).map((x) => TOOL_MAP[x] || x).join(MULTI_SEP);
  if (o.inj) o.inj = splitMulti(o.inj).map((x) => (x === 'PRP/รักษาอื่นๆ (ไม่ใช่การปลูกผม)' ? 'PRP' : x)).join(MULTI_SEP);
  for (const k of ['hairMethod', 'ct']) if (OTHER[o[k]]) o[k] = OTHER[o[k]];
  const d = /^Day (\d{1,3})$/.exec(o.visitPeriod || ''); if (d) o.visitPeriod = `${d[1]} วัน`;
  return o;
}
