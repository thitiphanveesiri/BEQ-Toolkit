// ตรรกะฟอร์ม/คนไข้/สถิติ (ฝั่ง server) — ตรวจสอบข้อมูลทุกครั้งก่อนบันทึก
import { F, isReq, canonOpd, GENDERS, BASIC_LOCK, PROC, PROC_DEP_KEYS, TEAM_ROLES, MULTI_SEP, PERIOD_RE, ROUNDS, splitMulti, isShown, keysFor, labelOf, minDateFor, normProc, roundNo, procLabel, procDetail, OPD_RE, OPD_ERR } from './fields.js';
import { listRecords, listMedia, listUsers, getOptions, dataMode } from './db.js';
import { AppError } from './errors.js';

// รับ "12345678901" หรือ "hn-12345678901" แล้วคืน "HN-12345678901"
import { parseTeams } from './roles.js';
export const normOpd = canonOpd;
const bkkToday = () => new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10); // วันนี้ตามเวลาไทย
const validDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
const byLatest = (a, b) => (b.date || '').localeCompare(a.date || '') || (b.createdAt || '').localeCompare(a.createdAt || '');

// รายชื่อทีมงานตามบทบาทของบัญชีผู้ใช้ที่เปิดใช้งานอยู่ (ฟอร์มต่างกัน: ใครถ่าย Day 0 = เซลล์, F/U = BT)
export async function teamOptions(formType) {
  const users = (await listUsers()).filter((u) => u.active === 'TRUE');
  const out = {};
  for (const [og, roles] of Object.entries(TEAM_ROLES)) {
    const rs = Array.isArray(roles) ? roles : roles[formType] || [];
    // ค่าเริ่มต้นตามบทบาท แต่ผู้ดูแลปรับรายบัญชีได้ (เช่น แพทย์ที่ไม่เป็นเจ้าของเคส / ตรวจสอบไม่ได้)
    // เรียงตามบทบาท (ตามลำดับที่กำหนดของช่องนั้น) ก่อน แล้วเรียงตามตัวอักษรในบทบาทเดียวกัน — ผู้ที่ผู้ดูแลเพิ่มเข้ามาเองนอกบทบาทอยู่ท้าย
    const rank = (u) => { const i = rs.indexOf(u.role); return i < 0 ? rs.length : i; };
    const picked = users.filter((u) => { const t = parseTeams(u.perms)[og]; return typeof t === 'boolean' ? t : rs.includes(u.role); });
    picked.sort((x, y) => rank(x) - rank(y) || x.name.localeCompare(y.name, 'th'));
    out[og] = [...new Set(picked.map((u) => u.name))];
  }
  // คำนำหน้า "นายแพทย์" แสดงหน้าชื่อในรายการเลือกแพทย์/ผู้ตรวจสอบ (ค่าที่เก็บยังเป็นชื่อเดิม เพื่อไม่กระทบการจับคู่เคสของแพทย์)
  out.titles = {};
  for (const u of users) if (['doctor', 'doctor_lead'].includes(u.role) && !/^(นายแพทย์|แพทย์หญิง|นพ\.|พญ\.)/.test(u.name)) out.titles[u.name] = (u.title || 'นายแพทย์') + ' ' + u.name;
  return out;
}
export const getFormOptions = async (formType) => ({ ...(await getOptions()), ...(await teamOptions(formType)) });

// prev = ข้อมูลเดิมตอนผู้ดูแลแก้ไข: ยอมรับค่าเดิมที่ไม่อยู่ในรายการแล้ว (เช่น ชื่อเก่าหรือผู้ใช้ที่ถูกปิด) แต่ห้ามเลือกค่าใหม่นอกรายการ
export function cleanRecord(formType, input, options, prev = null) {
  if (!['case', 'day0'].includes(formType)) throw new AppError(400, 'ชนิดฟอร์มไม่ถูกต้อง');
  const out = { formType }, errs = [];
  const shown = { procType: splitMulti(input?.procType).map(normProc).join(MULTI_SEP) };
  for (const k of keysFor(formType)) {
    const f = F[k];
    if (!isShown(k, shown)) { out[k] = ''; continue; } // ช่องที่ไม่เกี่ยวกับประเภทหัตถการที่เลือก เก็บเป็นค่าว่าง
    const multi = f.t === 'multi';
    let v = String(input?.[k] ?? '').trim();
    if (v.length > (multi ? 300 : 120)) v = v.slice(0, multi ? 300 : 120);
    if (k === 'procType') v = splitMulti(v).map(normProc).join(MULTI_SEP);
    if (k === 'opd') { v = normOpd(v); if (!OPD_RE.test(v) && !(prev && prev.opd === v)) { errs.push(OPD_ERR); continue; } } // ผู้ดูแลแก้เคสเก่า (HN 11 หลัก) ได้ถ้าไม่เปลี่ยนเลข
    if (!v) { if (isReq(k, formType) && !(k === 'seeDoctor' && prev && !prev.seeDoctor)) errs.push(f.t === 'select' || f.t === 'multi' || f.t === 'pills' ? `กรุณาเลือก${f.l}` : `กรุณากรอก${f.l}`); out[k] = ''; continue; }
    if (k === 'age' && !(/^\d{1,3}$/.test(v) && Number(v) <= 120)) { errs.push('อายุต้องเป็นตัวเลข 0–120'); continue; }
    if (f.t === 'date' && !validDate(v)) { errs.push(`${labelOf(k, formType)}ไม่ถูกต้อง`); continue; }
    if (!prev && f.t === 'date') { const min = minDateFor(k, formType, bkkToday()); if (min && v < min) { errs.push(`${labelOf(k, formType)}เลือกย้อนหลังได้ไม่เกิน ${f.minBack[formType]} วัน`); continue; } }
    if (k === 'visitPeriod' && !(prev && prev.visitPeriod === v) && !(PERIOD_RE.test(v) && Number(v.split(' ')[0]) > 0)) { errs.push('ระยะที่เข้ามาตรวจต้องเป็นตัวเลขและหน่วย เช่น 13 วัน, 5 เดือน'); continue; }
    const list = f.o || (f.og && options[f.og]);
    if (list) {
      const old = prev?.[k] ? (multi ? splitMulti(prev[k]) : [prev[k]]) : [];
      const allow = new Set([...list, ...old]);
      const items = multi ? [...new Set(splitMulti(v))] : [v];
      if (!items.length || items.some((x) => !allow.has(x))) { errs.push(`${f.l}ไม่อยู่ในรายการที่กำหนด`); continue; }
      if (multi) { const order = [...allow]; items.sort((a, b) => order.indexOf(a) - order.indexOf(b)); v = items.join(MULTI_SEP); }
    }
    out[k] = v;
  }
  out.name = [out.fname, out.mname, out.lname].filter(Boolean).join(' ');
  out.note = String(input?.note ?? '').trim().slice(0, 1000);
  if (errs.length) throw new AppError(400, errs[0]);
  return out;
}

/* ---------- หัตถการตั้งต้น / หัตถการเพิ่มเติม / นัด F/U ---------- */
const chron = (a, b) => (a.date || '').localeCompare(b.date || '') || (a.createdAt || '').localeCompare(b.createdAt || '');
const procSig = (r) => [r.procType, ...PROC_DEP_KEYS.map((k) => r[k] || '')].join('|');
// หัตถการตั้งต้นของรอบล่าสุด = Day 0 ของรอบนั้น (ถ้าไม่มี ใช้ฟอร์มแรกที่ระบุประเภท) — ใช้เติมฟอร์ม F/U และเทียบหาหัตถการเพิ่มเติม
export function baseline(list) {
  const typed = list.filter((x) => x.procType);
  if (!typed.length) return null;
  const top = Math.max(...typed.map((x) => roundNo(x.round)));
  const inR = typed.filter((x) => roundNo(x.round) === top);
  return inR.find((x) => x.formType === 'day0') || [...inR].sort(chron)[0];
}
// ฟอร์ม F/U ที่หัตถการต่างจากตั้งต้น = ทำหัตถการเพิ่มเติม
const isExtra = (r, base) => !!base && r.formType === 'case' && !!r.procType && r.id !== base.id && roundNo(r.round) === roundNo(base.round) && procSig(r) !== procSig(base);

export const FU_MONTHS = [1, 3, 6, 9, 12]; // ระยะนัด F/U (เดือนหลังวันที่มาปลูก)
const FU_BEFORE = 14, FU_AFTER = 30;       // แจ้งเตือนล่วงหน้า 14 วัน และค้างแจ้งเตือนหลังเลยนัดไม่เกิน 30 วัน
const addMonths = (iso, n) => { const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1 + n, d)).toISOString().slice(0, 10); };
const addDays = (iso, n) => new Date(Date.parse(iso) + n * 864e5).toISOString().slice(0, 10);
const dayDiff = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);
const periodMonths = (p) => { const m = PERIOD_RE.exec(p || ''); if (!m) return null; const n = Number(m[1]); return m[2] === 'เดือน' ? n : m[2] === 'ปี' ? n * 12 : m[2] === 'สัปดาห์' ? Math.round((n * 7) / 30) : Math.round(n / 30); };
// ตารางนัด F/U ของคนไข้ 1 คน: อ้างอิงวันที่มาปลูก (Day 0 ของรอบล่าสุด)
export function fuSchedule(list, today = bkkToday()) {
  const day0 = list.filter((r) => r.formType === 'day0' && r.date);
  if (!day0.length) return [];
  const top = Math.max(...day0.map((r) => roundNo(r.round)));
  const anchor = day0.filter((r) => roundNo(r.round) === top).sort(chron)[0].date;
  const cases = list.filter((r) => r.formType === 'case' && r.date && r.date >= anchor);
  return FU_MONTHS.map((m) => {
    const due = m === 12 ? addDays(addMonths(anchor, m), -1) : addMonths(anchor, m), diff = dayDiff(today, due); // นัด 12 เดือนถอยหลัง 1 วัน (ปลูก 5/11 → นัด 4/11 ปีถัดไป)
    const done = cases.some((c) => periodMonths(c.visitPeriod) === m || Math.abs(dayDiff(due, c.date)) <= FU_BEFORE);
    const status = done ? 'done' : diff > FU_BEFORE ? 'future' : diff >= 0 ? (diff === 0 ? 'today' : 'soon') : diff >= -FU_AFTER ? 'overdue' : 'missed';
    return { months: m, due, days: diff, status };
  });
}
const FU_ACTIVE = ['soon', 'today', 'overdue'];
// รายการแจ้งเตือนนัด F/U ที่ใกล้ถึง/เลยนัดของคนไข้ทั้งหมด (ใช้บน Dashboard)
export async function reminders(owned) {
  const by = new Map();
  for (const r of await listRecords()) { if (owned && !owned.has(r.opd)) continue; (by.get(r.opd) || by.set(r.opd, []).get(r.opd)).push(r); }
  const out = [];
  for (const [opd, list] of by) {
    const doc = ([...list].sort(chron).reverse().find((r) => r.doc) || {}).doc || '';
    for (const s of fuSchedule(list)) if (FU_ACTIVE.includes(s.status)) out.push({ opd, name: list[0].name, doc, ...s });
  }
  return out.sort((a, b) => a.days - b.days);
}

// ข้อมูลเดิมของ OPD เดียวกัน ใช้เติมฟอร์มอัตโนมัติ (ไม่เติมวันที่เข้ามา/ระยะตรวจ เพราะเป็นของครั้งใหม่)
export async function autofill(opd) {
  const recs = (await listRecords()).filter((r) => r.opd === normOpd(opd)).sort(byLatest);
  if (!recs.length) return null;
  const out = {};
  // ใครถ่าย/ตรวจสอบโดย ไม่เติมให้ เพราะรายชื่อที่เลือกได้ต่างกันตามฟอร์ม
  for (const k of ['fname', 'mname', 'lname', 'gender', 'age', 'plantDate', 'nat', 'ct', 'cell', 'doc']) {
    const r = recs.find((x) => x[k] && (k !== 'gender' || GENDERS.includes(x[k]))); if (r) out[k] = r[k];
  }
  // ข้อมูลหัตถการเติมเป็นชุดเดียวจากฟอร์มล่าสุดที่มีประเภทหัตถการ (ข้อมูลเก่าที่ยังไม่มี ให้เดาประเภทจากช่องที่กรอกไว้)
  const withType = baseline(recs); // หัตถการตั้งต้นของรอบล่าสุด (ไม่ใช่หัตถการเพิ่มเติมของ F/U ครั้งก่อน)
  if (withType) for (const k of ['procType', ...PROC_DEP_KEYS]) { if (withType[k]) out[k] = withType[k]; }
  else {
    for (const k of PROC_DEP_KEYS) { const r = recs.find((x) => x[k]); if (r) out[k] = r[k]; }
    out.procType = [out.area && PROC.hair, out.tool && PROC.stem, out.inj && PROC.inject].filter(Boolean).join(MULTI_SEP);
  }
  const maxRound = Math.min(Math.max(...recs.map((r) => roundNo(r.round))), ROUNDS.length);
  out.round = ROUNDS[maxRound - 1]; // F/U ครั้งถัดไปอยู่ในรอบล่าสุด (ฟอร์ม Day 0 ให้ผู้กรอกเลือกเองเสมอ)
  const day0Rounds = [...new Set(recs.filter((r) => r.formType === 'day0').map((r) => roundNo(r.round)))].sort();
  return { data: out, meta: { maxRound, day0Rounds } };
}

// HN ที่เคยมีข้อมูลแล้ว: บังคับใช้ข้อมูลพื้นฐานเดิม (ชื่อ เพศ อายุ สัญชาติ) แทนที่ค่าที่ส่งมา — กันการแก้ผ่านฟอร์มโดยตรง
export async function lockBasics(rec) {
  const recs = (await listRecords()).filter((r) => r.opd === rec.opd).sort(byLatest);
  for (const k of BASIC_LOCK) { const r = recs.find((x) => x[k]); if (r) rec[k] = r[k]; }
  rec.name = [rec.fname, rec.mname, rec.lname].filter(Boolean).join(' ');
  return rec;
}
// Day 0 ของ HN เดียวกันและครั้งที่เดียวกันที่มีอยู่แล้ว (กรอกซ้ำ = อัปเดตของเดิม)
// ฟอร์ม F/U ไม่มีช่องครั้งที่: ใช้รอบล่าสุดของคนไข้ (รูป F/U จึงเข้าโฟลเดอร์รอบนั้น)
export async function latestRound(opd) {
  const rs = (await listRecords()).filter((r) => r.opd === opd).map((r) => roundNo(r.round));
  return ROUNDS[Math.min(Math.max(1, ...rs), ROUNDS.length) - 1];
}
export async function existingCell(opd) {
  const rs = (await listRecords()).filter((r) => r.opd === opd && r.cell).sort(byLatest);
  return rs[0]?.cell || '';
}
export async function findDay0(rec) {
  return (await listRecords()).find((r) => r.formType === 'day0' && r.opd === rec.opd && roundNo(r.round) === roundNo(rec.round));
}

export async function findDuplicate(rec) {
  return (await listRecords()).find((r) => r.opd === rec.opd && r.formType === rec.formType && r.date === rec.date && r.visitPeriod === (rec.visitPeriod || '') && roundNo(r.round) === roundNo(rec.round));
}

const strip = ({ _row, ...r }) => r;

export async function searchPatients(q, limit = 50) {
  const [recs, media] = await Promise.all([listRecords(), listMedia()]);
  const t = String(q || '').trim().toLowerCase();
  const td = t.replace(/[\s-]/g, ''); // พิมพ์เลข HN แบบมีขีดหรือไม่มีก็ค้นเจอ (12345-6-789012 = 123456789012)
  const mc = new Map();
  for (const m of media) if (m.status === 'ready') mc.set(m.opd, (mc.get(m.opd) || 0) + 1);
  const by = new Map();
  for (const r of recs) { const a = by.get(r.opd); if (a) a.push(r); else by.set(r.opd, [r]); }
  const rows = [];
  for (const [opd, list] of by) {
    list.sort(byLatest);
    const l = list[0];
    if (t && !(opd.toLowerCase().includes(t) || (td.length >= 3 && opd.replace(/\D/g, '').includes(td)) || list.some((x) => x.name.toLowerCase().includes(t)))) continue;
    const t2 = baseline(list) || l; // หัตถการตั้งต้นของรอบล่าสุด
    rows.push({ opd, name: l.name, date: l.date, proc: procLabel(t2), detail: procDetail(t2), ct: l.ct, forms: list.length, photos: mc.get(opd) || 0, last: l.createdAt });
  }
  rows.sort((a, b) => b.last.localeCompare(a.last));
  return { total: rows.length, rows: rows.slice(0, limit) };
}

export async function patientDetail(opd, { withMedia }) {
  const key = normOpd(opd);
  const recs = (await listRecords()).filter((r) => r.opd === key).sort(byLatest);
  if (!recs.length) return null;
  const info = {};
  for (const k of Object.keys(F)) { const r = recs.find((x) => x[k]); if (r) info[k] = r[k]; }
  const base = baseline(recs); // ข้อมูลหัตถการหลักใช้ตัวตั้งต้นของรอบล่าสุด ไม่ปนกับฟอร์มเก่า
  if (base) for (const k of ['procType', ...PROC_DEP_KEYS]) info[k] = base[k] || '';
  info.proc = procLabel(info);
  const extras = recs.filter((r) => isExtra(r, base)); // recs เรียงใหม่สุดก่อน
  const extra = extras[0] ? { id: extras[0].id, date: extras[0].date, period: extras[0].visitPeriod, proc: procLabel(extras[0]), detail: procDetail(extras[0]) } : null;
  const ids = new Set(recs.map((r) => r.id));
  const media = !withMedia ? [] : (await listMedia()).filter((m) => ids.has(m.recordId) && m.status === 'ready')
    .map((m) => ({ id: m.id, recordId: m.recordId, group: m.group, kind: m.kind, slot: m.slot || '', name: m.name, mime: m.mime, size: Number(m.size) || 0, at: m.uploadedAt, drive: dataMode() === 'google' ? `https://drive.google.com/file/d/${m.driveId}/view` : '' }));
  return { opd: key, name: recs[0].name, info, extra, followups: fuSchedule(recs), records: recs.map(strip).map(({ createdBy, ...r }) => ({ ...r, extra: isExtra(r, base) })), media };
}

/* ---------- สถิติ Dashboard (รวมค่า ไม่มีข้อมูลระบุตัวคนไข้) ---------- */
const tally = (arr, pick, order, multi) => {
  const m = new Map((order || []).map((o) => [o, 0]));
  for (const x of arr) for (const v of multi ? splitMulti(pick(x)) : [pick(x)]) if (v) m.set(v, (m.get(v) || 0) + 1);
  return [...m.entries()];
};

export async function stats({ from, to }) {
  const [all, media] = await Promise.all([listRecords(), listMedia()]);
  const recs = all.filter((r) => (!from || r.date >= from) && (!to || r.date <= to));
  const withPhotos = new Set(media.filter((m) => m.status === 'ready').map((m) => m.recordId));
  const cases = recs.filter((r) => r.formType === 'case');
  const perOpd = new Map();
  for (const r of cases) perOpd.set(r.opd, (perOpd.get(r.opd) || 0) + 1);
  const months = tally(recs, (r) => r.date.slice(0, 7)).sort((a, b) => (a[0] < b[0] ? -1 : 1));
  return {
    kpi: {
      records: recs.length,
      patients: new Set(recs.map((r) => r.opd)).size,
      photoSubmissions: recs.filter((r) => withPhotos.has(r.id)).length,
      returning: perOpd.size, // จำนวนคนไข้ที่มีการอัปเดต F/U อย่างน้อย 1 ครั้งในช่วงที่เลือก
    },
    charts: [
      { id: 'month', title: 'ฟอร์มที่ส่งต่อเดือน', data: months, month: true },
      { id: 'visit', title: 'ระยะที่เข้ามาตรวจ (F/U)', data: tally(cases, (r) => r.visitPeriod) },
      { id: 'proc', title: 'ประเภทหัตถการ', data: tally(recs, (r) => r.procType, null, true) },
      { id: 'round', title: 'ครั้งที่เข้ารับหัตถการ (ไม่ใช่ F/U)', data: tally(recs.filter((r) => r.formType === 'day0'), (r) => ROUNDS[roundNo(r.round) - 1] || r.round) },
      { id: 'tool', title: 'เครื่องมือที่ใช้ (ปลูกด้วย)', data: tally(recs, (r) => r.tool, null, true) },
      { id: 'inj', title: 'Rejuvenation', data: tally(recs, (r) => r.inj, null, true) },
      { id: 'ct', title: 'ประเภทเคส', data: tally(recs, (r) => r.ct) },
      { id: 'cell', title: 'เซลล์ (จากฟอร์ม Day 0)', data: tally(recs, (r) => r.cell) },
      { id: 'doc', title: 'แพทย์เจ้าของเคส', data: tally(recs, (r) => r.doc) },
      { id: 'ph', title: 'ผู้ถ่ายภาพ', data: tally(recs, (r) => r.ph) },
      { id: 'ck', title: 'ผู้ตรวจสอบ', data: tally(recs, (r) => r.ck) },
      { id: 'method', title: 'วิธีปลูก', data: tally(recs, (r) => r.hairMethod) },
      { id: 'area', title: 'บริเวณ', data: tally(recs, (r) => r.area, null, true) },
      { id: 'nat', title: 'สัญชาติ', data: tally(recs, (r) => r.nat) },
      { id: 'ret', title: 'คนไข้กลับมาถ่ายภาพ F/U กี่ครั้ง', data: tally([...perOpd.values()], (n) => `${n} ครั้ง`).sort((a, b) => parseInt(a[0]) - parseInt(b[0])) },
    ].map((c) => ({ ...c, data: c.id === 'month' || c.id === 'ret' ? c.data : c.data.sort((a, b) => b[1] - a[1]) })),
  };
}
