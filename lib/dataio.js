// นำเข้า/ส่งออกข้อมูลเคสเป็นตาราง (CSV / Excel) — ใช้ฝั่ง server
// คอลัมน์ 1–17 ตามที่ใช้งานจริง ส่วน "ข้อมูลเพิ่มเติม" ท้ายตารางเป็นช่องไม่บังคับ (ใส่เพื่อให้ส่งออก → แก้ → นำเข้ากลับได้ครบ ลบทิ้งได้)
import crypto from 'node:crypto';
import { GENDERS, MULTI_SEP, OPD_ERR, OPD_RE, PERIOD_RE, PROC, ROUNDS, SEE_DOCTOR, canonOpd, normLegacy, roundNo, splitMulti } from './fields.js';
import { csvUnguard } from './csv.js';
import { AppError } from './errors.js';
import { activeReservation } from './media.js';
import { recordFolderKeys } from './drive.js';
import { cellIdFromUsers } from './records.js';

export const MAX_IMPORT_ROWS = 2000;
// id: รหัสภายใน · label: หัวคอลัมน์ที่ส่งออก · alias: ชื่อหัวคอลัมน์อื่นที่ยอมรับตอนนำเข้า · req: จำเป็นตอนนำเข้า · ro: ส่งออกอย่างเดียว (นำเข้าแล้วไม่สนใจ)
export const COLUMNS = [
  { id: 'sent', label: 'เวลาที่ส่ง', w: 20, alias: ['timestamp', 'ประทับเวลา', 'วันที่ส่ง'] },
  { id: 'opd', label: 'เลข OPD', w: 20, req: 1, alias: ['opd', 'hn', 'เลขhn', 'เลขopd(hn)'] },
  { id: 'name', label: 'ชื่อคนไข้', w: 28, req: 1, alias: ['ชื่อนามสกุล', 'ชื่อ-นามสกุล', 'ชื่อ'] },
  { id: 'hairMethod', label: 'ปลูกผมย้ายราก', w: 16, alias: ['วิธีการปลูก', 'วิธีปลูก'] },
  { id: 'area', label: 'บริเวณที่ทำ', w: 18, alias: ['บริเวณ'] },
  { id: 'tool', label: 'ปลูกด้วย Stem cell', w: 20, alias: ['ปลูกด้วย', 'stemcell'] },
  { id: 'inj', label: 'งานฉีดและอื่นๆ', w: 20, alias: ['งานฉีด', 'rejuvenation'] },
  { id: 'tools', label: 'ปลูกด้วย stem cell งานฉีดและอื่นๆ', legacy: 1 }, // ไฟล์เก่าที่รวมสองหมวดไว้ช่องเดียว: ยังนำเข้าได้ แต่ไม่ส่งออก
  { id: 'plant', label: 'วันที่ปลูก', w: 14, req: 1, alias: ['วันที่มาปลูก', 'วันที่มาปลูกday0'] },
  { id: 'ct', label: 'ประเภทเคส', w: 14 },
  { id: 'cell', label: 'เซลล์', w: 18 },
  { id: 'doc', label: 'แพทย์', w: 22, alias: ['แพทย์เจ้าของเคส'] },
  { id: 'ph', label: 'ผู้ถ่าย', w: 18, alias: ['ใครถ่าย', 'ผู้ถ่ายภาพ'] },
  { id: 'ck', label: 'ตรวจสอบโดย', w: 18, alias: ['ตรวจสอบโดยใคร', 'ผู้ตรวจสอบ'] },
  { id: 'by', label: 'ผู้ส่ง', w: 18 },
  { id: 'files', label: 'จำนวนไฟล์', w: 12, ro: 1 },
  { id: 'status', label: 'สถานะ', w: 22, ro: 1 },
  { id: 'source', label: 'ที่มา', w: 20 },
  { id: 'folder', label: 'โฟลเดอร์ภาพ', w: 40, ro: 1 },
  // ---- ข้อมูลเพิ่มเติม (ไม่บังคับ) ----
  { id: 'gender', label: 'เพศ', w: 8, extra: 1 },
  { id: 'age', label: 'อายุ', w: 8, extra: 1 },
  { id: 'nat', label: 'สัญชาติ', w: 12, extra: 1 },
  { id: 'round', label: 'ครั้งที่เข้ารับหัตถการ', w: 20, extra: 1, alias: ['ครั้งที่', 'round'] },
  { id: 'visit', label: 'วันที่เข้ามารับบริการ (F/U)', w: 24, extra: 1, alias: ['วันที่เข้ามารับบริการ', 'วันที่มาfu'] },
  { id: 'period', label: 'ระยะที่เข้ามาตรวจ', w: 18, extra: 1 },
  { id: 'seeDoctor', label: 'การพบแพทย์', w: 14, extra: 1 },
  { id: 'note', label: 'หมายเหตุ', w: 30, extra: 1 },
];
const OUT = COLUMNS.filter((c) => !c.legacy);
export const HEADERS = OUT.map((c) => c.label);
// ตัวทำให้หัวคอลัมน์เทียบกันได้: ตัวพิมพ์เล็ก ตัดช่องว่าง/เครื่องหมาย
const key = (s) => String(s ?? '').toLowerCase().replace(/[^\p{L}\p{N}\p{M}]/gu, '');
const COL_KEYS = new Map(COLUMNS.flatMap((c) => [c.id, c.label, ...(c.alias || [])].map((a) => [key(a), c.id])));

const bkk = (iso) => { const t = Date.parse(iso); return Number.isNaN(t) ? '' : new Date(t + 7 * 3600000).toISOString().replace('T', ' ').slice(0, 19); };
export const bkkDate = (iso) => bkk(iso).slice(0, 10);
const sourceOf = (r) => (String(r.requestId || '').startsWith('IMP-') ? `นำเข้า CSV (${r.formType === 'case' ? 'F/U' : 'Day 0'})` : r.formType === 'case' ? 'ฟอร์ม F/U' : 'ฟอร์ม Day 0');

/* ------------------------------ ส่งออก ------------------------------ */
export function exportTable(records, { users = [], media = [], folders = [], google = false } = {}) {
  const uname = new Map(users.map((u) => [u.id, u.name]));
  const ready = new Map(), pending = new Map();
  for (const m of media) {
    if (m.status === 'ready') ready.set(m.recordId, (ready.get(m.recordId) || 0) + 1);
    else if (activeReservation(m)) pending.set(m.recordId, (pending.get(m.recordId) || 0) + 1);
  }
  const fmap = new Map(folders.map((f) => [f.key, f.driveId]));
  const rows = [...records].sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || '')).map((r) => {
    const n = ready.get(r.id) || 0, p = pending.get(r.id) || 0;
    const fid = google ? recordFolderKeys(r).map((k) => fmap.get(k)).find(Boolean) : '';
    const v = {
      sent: bkk(r.createdAt), opd: r.opd, name: r.name, hairMethod: r.hairMethod, area: r.area,
      tool: r.tool, inj: r.inj, plant: r.formType === 'day0' ? r.date : r.plantDate,
      ct: r.ct, cell: r.cell, doc: r.doc, ph: r.ph, ck: r.ck, by: uname.get(r.createdBy) || '',
      files: n, status: n ? (p ? 'มีไฟล์ (บางไฟล์ค้างอัปโหลด)' : 'มีไฟล์แล้ว') : p ? 'ไฟล์ค้างอัปโหลด' : 'ยังไม่มีไฟล์',
      source: sourceOf(r), folder: fid ? `https://drive.google.com/drive/folders/${fid}` : '',
      gender: r.gender, age: r.age, nat: r.nat, round: r.round, visit: r.formType === 'case' ? r.date : '', period: r.visitPeriod, seeDoctor: r.seeDoctor, note: r.note,
    };
    return OUT.map((c) => v[c.id] ?? '');
  });
  return { headers: HEADERS, rows, widths: OUT.map((c) => c.w) };
}

/* ------------------------------ นำเข้า ------------------------------ */
const fail = (m) => { throw new Error(m); };
const pad = (n) => String(n).padStart(2, '0');
const yearCE = (y) => (y > 2400 ? y - 543 : y); // รองรับปี พ.ศ.
function ymd(y, m, d) {
  y = yearCE(y);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d ? `${y}-${pad(m)}-${pad(d)}` : null;
}
// รับ YYYY-MM-DD, D/M/YYYY (วัน/เดือน/ปี ค.ศ. หรือ พ.ศ.) — คืน YYYY-MM-DD
export function parseDate(s) {
  s = String(s).trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T].*)?$/.exec(s); if (m) return ymd(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})(?:[ ,T].*)?$/.exec(s); if (m) return ymd(+m[3], +m[2], +m[1]);
  return null;
}
// เวลาที่ส่ง: ไม่ระบุเขตเวลา = เวลาไทย (UTC+7) — คืน ISO (UTC)
export function parseTimestamp(s) {
  s = String(s).trim();
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?)?\s*(Z|[+-]\d{2}:?\d{2})?$/i.exec(s) || (() => {
    const q = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})(?:[ ,T]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(s);
    return q && [q[0], q[3], q[2], q[1], q[4], q[5], q[6], undefined];
  })();
  if (!m) return null;
  const date = ymd(+m[1], +m[2], +m[3]); if (!date) return null;
  const [Y, M, D] = date.split('-').map(Number), h = +(m[4] || 0), mi = +(m[5] || 0), se = +(m[6] || 0);
  if (h > 23 || mi > 59 || se > 59) return null;
  let off = 7 * 60;
  if (m[7]) off = /^z$/i.test(m[7]) ? 0 : (m[7][0] === '-' ? -1 : 1) * (+m[7].slice(1, 3) * 60 + +m[7].slice(-2));
  return new Date(Date.UTC(Y, M - 1, D, h, mi, se) - off * 60000).toISOString();
}

const pickOne = (list, v) => { const k = key(v); return (list || []).find((x) => key(x) === k); };
const splitList = (v) => String(v || '').split(/[,;|\n、]+/).map((x) => x.trim()).filter(Boolean);
const sortLike = (list, items) => [...new Set(items)].sort((a, b) => list.indexOf(a) - list.indexOf(b));
const stripTitle = (n) => String(n || '').replace(/^(นายแพทย์|แพทย์หญิง|นพ\.|พญ\.|นาย|นางสาว|นาง)\s*/, '').trim().toLowerCase();
function splitName(full) {
  const t = String(full).trim().split(/\s+/).filter(Boolean);
  if (!t.length) fail('กรุณากรอกชื่อคนไข้');
  return t.length === 1 ? { fname: t[0], mname: '', lname: '' } : { fname: t[0], mname: t.slice(1, -1).join(' '), lname: t[t.length - 1] };
}
const YES = /^(ใช่|yes|y|true|1|✓|✔|x|ทำ)$/i;
const isMarker = (v, names) => YES.test(String(v).trim()) || names.some((n) => key(n) === key(v));
const GENDER_ALIAS = { m: 'ชาย', male: 'ชาย', f: 'หญิง', female: 'หญิง' };

// rows = ผลของ parseCsv (แถวแรกเป็นหัวตาราง)  ctx = { options, users, existing, importer, now }
// คืน { results, ignored, unknownPeople }: results[i] = { row, status: 'ok'|'duplicate'|'error', opd, name, message, rec }
export function parseImport(rows, { options, users = [], existing = [], importer, now = new Date().toISOString() }) {
  if (!rows.length) throw new AppError(400, 'ไฟล์ว่างเปล่า');
  const idx = {}, ignored = [];
  rows[0].forEach((h, i) => {
    const id = COL_KEYS.get(key(csvUnguard(String(h)))); // หัวคอลัมน์ซ้ำ: ใช้ตัวแรก
    if (id && !(id in idx)) idx[id] = i; else if (String(h).trim() && !id) ignored.push(String(h).trim());
  });
  const missing = COLUMNS.filter((c) => c.req && !(c.id in idx)).map((c) => c.label);
  if (missing.length) throw new AppError(400, `ไม่พบคอลัมน์ที่จำเป็น: ${missing.join(', ')} — ดาวน์โหลดเทมเพลตเพื่อดูหัวตารางที่ถูกต้อง`);
  if (rows.length - 1 > MAX_IMPORT_ROWS) throw new AppError(400, `ไฟล์มี ${rows.length - 1} แถว เกินกำหนด ${MAX_IMPORT_ROWS} แถวต่อครั้ง — กรุณาแบ่งไฟล์`);

  const active = users.filter((u) => u.active === 'TRUE');
  const people = new Set(active.map((u) => stripTitle(u.name))), unknownPeople = new Set();
  const byName = new Map(), byUser = new Map();
  for (const u of users) { if (!byName.has(stripTitle(u.name))) byName.set(stripTitle(u.name), u.id); byUser.set(String(u.username || '').toLowerCase(), u.id); }

  const dupKey = (r) => (r.formType === 'day0' ? `d|${r.opd}|${roundNo(r.round)}` : `c|${r.opd}|${r.date}|${r.visitPeriod || ''}|${roundNo(r.round)}`);
  const have = new Set(existing.map(dupKey));
  const nameOf = new Map(), basics = new Map();
  for (const r of [...existing].sort((a, b) => (b.date || '').localeCompare(a.date || ''))) {
    if (!nameOf.has(r.opd) && r.name) nameOf.set(r.opd, r.name);
    const b = basics.get(r.opd) || {}; for (const k of ['gender', 'age', 'nat']) if (!b[k] && r[k]) b[k] = r[k]; basics.set(r.opd, b);
  }
  const seen = new Set();

  const results = rows.slice(1).map((line, i) => {
    const row = i + 2; // เลขแถวตามที่เห็นใน Excel (แถว 1 = หัวตาราง)
    const get = (id) => (id in idx ? csvUnguard(String(line[idx[id]] ?? '')).trim() : '');
    const out = { row, status: 'error', opd: get('opd'), name: get('name'), message: '', rec: null };
    try {
      let opd = get('opd');
      if (!opd) fail('กรุณากรอกเลข OPD');
      if (/^\d(\.\d+)?e\+?\d+$/i.test(opd)) fail('เลข OPD ถูก Excel แปลงเป็นเลขวิทยาศาสตร์ — ตั้งคอลัมน์เป็นรูปแบบ “ข้อความ” แล้วกรอกใหม่');
      opd = canonOpd(opd); out.opd = opd;
      if (!OPD_RE.test(opd)) fail(OPD_ERR);
      const nm = splitName(get('name')), name = [nm.fname, nm.mname, nm.lname].filter(Boolean).join(' '); out.name = name;

      const src = get('source');
      const formType = /f\s*\/?\s*u|follow|ติดตาม/i.test(src) ? 'case' : 'day0';
      const plant = get('plant') ? parseDate(get('plant')) || fail('วันที่ปลูกไม่ถูกต้อง (ใช้รูปแบบ 2026-11-27 หรือ 27/11/2026)') : fail('กรุณากรอกวันที่ปลูก');
      let date = plant, plantDate = '';
      if (formType === 'case') {
        plantDate = plant;
        date = get('visit') ? parseDate(get('visit')) || fail('วันที่เข้ามารับบริการ (F/U) ไม่ถูกต้อง') : fail('แถว F/U ต้องกรอก “วันที่เข้ามารับบริการ (F/U)”');
      }
      const createdAt = get('sent') ? parseTimestamp(get('sent')) || fail('เวลาที่ส่งไม่ถูกต้อง (ใช้รูปแบบ 2026-11-27 14:30 หรือ 27/11/2026 14:30)') : now;

      const hairMark = isMarker(get('hairMethod'), ['ปลูกผมย้ายราก', 'ปลูกย้ายราก', 'Hair Transplantation']); // ใส่แค่ ✓/ชื่อหมวด = ทำหมวดนี้ แต่ไม่ระบุวิธี
      const hairMethod = get('hairMethod') && !hairMark ? pickOne(options.hairMethod, normLegacy({ hairMethod: get('hairMethod') }).hairMethod) || fail(`วิธีปลูก “${get('hairMethod')}” ไม่อยู่ในรายการ`) : '';
      const area = sortLike(options.area || [], splitList(get('area')).map((a) => pickOne(options.area, a) || fail(`บริเวณ “${a}” ไม่อยู่ในรายการ`))).join(MULTI_SEP);
      const tool = [], inj = [];
      let stemMark = false, injMark = false;
      const group = (id, list, other, otherList, label, otherLabel, out, names) => {
        for (const t of splitList(get(id))) {
          if (isMarker(t, names)) { if (id === 'tool') stemMark = true; else injMark = true; continue; }
          const n = normLegacy({ tool: t, inj: t });
          const hit = pickOne(list, id === 'tool' ? n.tool : n.inj);
          if (hit) out.push(hit);
          else if (pickOne(otherList, other === 'tool' ? n.tool : n.inj)) fail(`“${t}” เป็นรายการของ “${otherLabel}” — ย้ายไปคอลัมน์นั้น`);
          else fail(`รายการ “${t}” ในคอลัมน์ ${label} ไม่อยู่ในรายการ (ผู้ดูแลเพิ่มตัวเลือกได้ที่ Settings)`);
        }
      };
      group('tool', options.tool, 'inj', options.inj, 'ปลูกด้วย Stem cell', 'งานฉีดและอื่นๆ', tool, ['ปลูก Stem Cell', 'ปลูกด้วย Stem Cell', 'Cell Therapy']);
      group('inj', options.inj, 'tool', options.tool, 'งานฉีดและอื่นๆ', 'ปลูกด้วย Stem cell', inj, ['งานฉีด', 'งานฉีดและอื่นๆ', 'Rejuvenation']);
      for (const t of splitList(get('tools'))) { // คอลัมน์รวมแบบเก่า: แยกให้ตามรายการตัวเลือก
        const n = normLegacy({ tool: t, inj: t });
        const a = pickOne(options.tool, n.tool), b = pickOne(options.inj, n.inj);
        if (a) tool.push(a); else if (b) inj.push(b); else fail(`รายการ “${t}” ในคอลัมน์ ปลูกด้วย/งานฉีด ไม่อยู่ในรายการ (ผู้ดูแลเพิ่มตัวเลือกได้ที่ Settings)`);
      }
      const ct = get('ct') ? pickOne(options.ct, normLegacy({ ct: get('ct') }).ct) || fail(`ประเภทเคส “${get('ct')}” ไม่อยู่ในรายการ`) : '';

      const prior = basics.get(opd) || {};
      let gender = get('gender'); if (gender) gender = GENDER_ALIAS[gender.toLowerCase()] || pickOne(GENDERS, gender) || fail('เพศต้องเป็น ชาย หรือ หญิง');
      let age = get('age'); if (age) { const m = /^(\d{1,3})\s*(ปี)?$/.exec(age); if (!m || +m[1] > 120) fail('อายุต้องเป็นตัวเลข 0–120'); age = String(+m[1]); }
      const nat = get('nat') ? pickOne(options.nat, get('nat')) || fail(`สัญชาติ “${get('nat')}” ไม่อยู่ในรายการ`) : '';
      let round = ROUNDS[0];
      if (get('round')) { const n = parseInt(get('round').replace(/\D/g, ''), 10); if (!(n >= 1 && n <= ROUNDS.length)) fail(`ครั้งที่เข้ารับหัตถการต้องเป็น 1–${ROUNDS.length}`); round = ROUNDS[n - 1]; }
      let visitPeriod = normLegacy({ visitPeriod: get('period').replace(/\s+/g, ' ') }).visitPeriod;
      if (visitPeriod && !(PERIOD_RE.test(visitPeriod) && Number(visitPeriod.split(' ')[0]) > 0)) fail('ระยะที่เข้ามาตรวจต้องเป็นตัวเลขและหน่วย เช่น 13 วัน, 5 เดือน');
      const seeDoctor = get('seeDoctor') ? pickOne(SEE_DOCTOR, get('seeDoctor')) || fail('การพบแพทย์ต้องเป็น พบแพทย์ หรือ ไม่พบแพทย์') : '';

      // ชื่อต้องตรงกับที่มีของ HN นี้ (ในระบบ/แถวก่อนหน้าในไฟล์) — กันนำข้อมูลไปรวมกับคนไข้ผิดคน
      const known = nameOf.get(opd);
      if (known && key(known) !== key(name)) fail(`ชื่อไม่ตรงกับข้อมูลเดิมของ HN นี้ (ที่มีอยู่: ${known})`);

      const team = {};
      for (const k of ['cell', 'doc', 'ph', 'ck']) { team[k] = get(k).slice(0, 120); if (team[k] && !people.has(stripTitle(team[k]))) unknownPeople.add(team[k]); }
      const sender = get('by');
      const createdBy = (sender && (byName.get(stripTitle(sender)) || byUser.get(sender.toLowerCase()))) || importer?.id || '';
      const notes = [get('note'), sender && !(byName.get(stripTitle(sender)) || byUser.get(sender.toLowerCase())) ? `ผู้ส่งเดิม: ${sender}` : ''].filter(Boolean).join(' | ').slice(0, 1000);

      const procType = [(hairMethod || area || hairMark) && PROC.hair, (tool.length || stemMark) && PROC.stem, (inj.length || injMark) && PROC.inject].filter(Boolean).join(MULTI_SEP);
      const rec = {
        formType, opd, name, ...nm, gender: gender || prior.gender || '', age: age || prior.age || '', nat: nat || prior.nat || '',
        date, plantDate, hairMethod, area, tool: sortLike(options.tool || [], tool).join(MULTI_SEP), inj: sortLike(options.inj || [], inj).join(MULTI_SEP),
        ct, visitPeriod, round, seeDoctor, procType, ...team, cellId: cellIdFromUsers(users, team.cell), note: notes, createdBy, createdAt, updatedAt: now,
        requestBy: '', requestHash: '',
      };
      rec.requestId = 'IMP-' + crypto.createHash('sha1').update(dupKey(rec)).digest('hex').slice(0, 24);

      const k = dupKey(rec);
      if (have.has(k)) { out.status = 'duplicate'; out.message = 'มีข้อมูลนี้ในระบบแล้ว (ข้าม)'; return out; }
      if (seen.has(k)) { out.status = 'duplicate'; out.message = 'ซ้ำกับแถวก่อนหน้าในไฟล์ (ข้าม)'; return out; }
      seen.add(k); nameOf.set(opd, name);
      const b = basics.get(opd) || {}; for (const f of ['gender', 'age', 'nat']) if (!b[f] && rec[f]) b[f] = rec[f]; basics.set(opd, b);
      out.status = 'ok'; out.rec = rec;
    } catch (e) { out.message = e.message; }
    return out;
  });
  return { results, ignored: [...new Set(ignored)], unknownPeople: [...unknownPeople] };
}
