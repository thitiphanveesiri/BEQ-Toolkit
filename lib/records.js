// ตรรกะฟอร์ม/คนไข้/สถิติ (ฝั่ง server) — ตรวจสอบข้อมูลทุกครั้งก่อนบันทึก
import { F, keysFor, procLabel } from './fields.js';
import { listRecords, listMedia, dataMode } from './db.js';
import { AppError } from './errors.js';

export const normOpd = (s) => String(s || '').trim().replace(/\s+/g, ' ').toUpperCase();
const validDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
const byLatest = (a, b) => (b.date || '').localeCompare(a.date || '') || (b.createdAt || '').localeCompare(a.createdAt || '');

export function cleanRecord(formType, input, options) {
  if (!['case', 'day0'].includes(formType)) throw new AppError(400, 'ชนิดฟอร์มไม่ถูกต้อง');
  const out = { formType }, errs = [];
  for (const k of keysFor(formType)) {
    const f = F[k];
    let v = String(input?.[k] ?? '').trim();
    if (v.length > 120) v = v.slice(0, 120);
    if (k === 'opd') v = normOpd(v);
    if (!v) { if (f.req) errs.push(`กรุณากรอก${f.l}`); out[k] = ''; continue; }
    if (f.t === 'date' && !validDate(v)) { errs.push(`${f.l}ไม่ถูกต้อง`); continue; }
    const list = f.o || (f.og && options[f.og]);
    if (list && !list.includes(v)) { errs.push(`${f.l}ไม่อยู่ในรายการที่กำหนด`); continue; }
    out[k] = v;
  }
  out.note = String(input?.note ?? '').trim().slice(0, 1000);
  if (errs.length) throw new AppError(400, errs[0]);
  return out;
}

// ข้อมูลเดิมของ OPD เดียวกัน ใช้เติมฟอร์มอัตโนมัติ (ไม่เติมวันที่เข้ามา/ระยะตรวจ เพราะเป็นของครั้งใหม่)
export async function autofill(opd) {
  const recs = (await listRecords()).filter((r) => r.opd === normOpd(opd)).sort(byLatest);
  if (!recs.length) return null;
  const out = {};
  for (const k of ['name', 'gender', 'plantDate', 'nat', 'hairMethod', 'area', 'tool', 'inj', 'ct', 'cell', 'doc', 'ph', 'ck']) {
    const r = recs.find((x) => x[k]); if (r) out[k] = r[k];
  }
  return out;
}

export async function findDuplicate(rec) {
  return (await listRecords()).find((r) => r.opd === rec.opd && r.formType === rec.formType && r.date === rec.date && r.visitPeriod === (rec.visitPeriod || ''));
}

const strip = ({ _row, ...r }) => r;

export async function searchPatients(q, limit = 50) {
  const [recs, media] = await Promise.all([listRecords(), listMedia()]);
  const t = String(q || '').trim().toLowerCase();
  const mc = new Map();
  for (const m of media) if (m.status === 'ready') mc.set(m.opd, (mc.get(m.opd) || 0) + 1);
  const by = new Map();
  for (const r of recs) { const a = by.get(r.opd); if (a) a.push(r); else by.set(r.opd, [r]); }
  const rows = [];
  for (const [opd, list] of by) {
    list.sort(byLatest);
    const l = list[0];
    if (t && !(opd.toLowerCase().includes(t) || list.some((x) => x.name.toLowerCase().includes(t)))) continue;
    rows.push({ opd, name: l.name, date: l.date, proc: procLabel(l), tool: l.tool, ct: l.ct, forms: list.length, photos: mc.get(opd) || 0, last: l.createdAt });
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
  info.proc = procLabel(info);
  const ids = new Set(recs.map((r) => r.id));
  const media = !withMedia ? [] : (await listMedia()).filter((m) => ids.has(m.recordId) && m.status === 'ready')
    .map((m) => ({ id: m.id, recordId: m.recordId, group: m.group, kind: m.kind, name: m.name, mime: m.mime, size: Number(m.size) || 0, at: m.uploadedAt, drive: dataMode() === 'google' ? `https://drive.google.com/file/d/${m.driveId}/view` : '' }));
  return { opd: key, name: recs[0].name, info, records: recs.map(strip).map(({ createdBy, ...r }) => r), media };
}

/* ---------- สถิติ Dashboard (รวมค่า ไม่มีข้อมูลระบุตัวคนไข้) ---------- */
const tally = (arr, pick, order) => {
  const m = new Map((order || []).map((o) => [o, 0]));
  for (const x of arr) { const v = pick(x); if (v) m.set(v, (m.get(v) || 0) + 1); }
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
      returning: [...perOpd.values()].filter((n) => n > 1).length,
    },
    charts: [
      { id: 'month', title: 'ฟอร์มที่ส่งต่อเดือน', data: months, month: true },
      { id: 'visit', title: 'ระยะที่เข้ามาตรวจ (F/U)', data: tally(cases, (r) => r.visitPeriod) },
      { id: 'tool', title: 'เครื่องมือที่ใช้ (ปลูกด้วย)', data: tally(recs, (r) => r.tool) },
      { id: 'inj', title: 'งานฉีด', data: tally(recs, (r) => r.inj) },
      { id: 'ct', title: 'ประเภทเคส', data: tally(recs, (r) => r.ct) },
      { id: 'cell', title: 'เซลล์ (จากฟอร์ม Day 0)', data: tally(recs, (r) => r.cell) },
      { id: 'doc', title: 'แพทย์เจ้าของเคส', data: tally(recs, (r) => r.doc) },
      { id: 'ph', title: 'ผู้ถ่ายภาพ', data: tally(recs, (r) => r.ph) },
      { id: 'ck', title: 'ผู้ตรวจสอบ', data: tally(recs, (r) => r.ck) },
      { id: 'method', title: 'วิธีปลูก', data: tally(recs, (r) => r.hairMethod) },
      { id: 'area', title: 'บริเวณ', data: tally(recs, (r) => r.area) },
      { id: 'nat', title: 'สัญชาติ', data: tally(recs, (r) => r.nat) },
      { id: 'ret', title: 'คนไข้กลับมาถ่ายภาพ F/U กี่ครั้ง', data: tally([...perOpd.values()], (n) => `${n} ครั้ง`).sort((a, b) => parseInt(a[0]) - parseInt(b[0])) },
    ].map((c) => ({ ...c, data: c.id === 'month' || c.id === 'ret' ? c.data : c.data.sort((a, b) => b[1] - a[1]) })),
  };
}
