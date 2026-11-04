// ชั้นข้อมูล: Google Sheets (production) หรือไฟล์ JSON ในเครื่อง (โหมดทดลอง)
// - อ่านเป็นชุดด้วย batchGet ครั้งเดียว แล้วเก็บ cache ในหน่วยความจำ (CACHE_TTL_SECONDS, ค่าเริ่มต้น 20 วินาที)
// - เขียนด้วย append/update แล้วอัปเดต cache ทันที (write-through) ผู้ใช้จึงเห็นข้อมูลที่เพิ่งบันทึกโดยไม่ต้องรอ
// - เขียนแบบ RAW เสมอ เพื่อไม่ให้ค่าที่ผู้ใช้กรอกถูกตีความเป็นสูตร (formula injection)
import fs from 'node:fs';
import path from 'node:path';
import { AppError } from './errors.js';
import { gjson } from './google.js';
import { DEFAULT_OPTIONS } from './fields.js';

export const TABS = {
  Users: ['id', 'username', 'name', 'role', 'active', 'passwordHash', 'createdAt', 'updatedAt'],
  Records: ['id', 'formType', 'opd', 'name', 'gender', 'date', 'plantDate', 'nat', 'hairMethod', 'area', 'tool', 'inj', 'ct', 'visitPeriod', 'cell', 'doc', 'ph', 'ck', 'note', 'createdBy', 'createdAt', 'updatedAt', 'fname', 'lname'],
  Media: ['id', 'recordId', 'opd', 'group', 'kind', 'driveId', 'name', 'mime', 'size', 'status', 'uploadedBy', 'uploadedAt'],
  Options: ['key', 'json'],
  Folders: ['key', 'driveId'],
  Audit: ['ts', 'user', 'action', 'target', 'detail', 'ip'],
};
const CACHED = Object.keys(TABS).filter((t) => t !== 'Audit');

export const dataMode = () => process.env.DATA_MODE || (process.env.NODE_ENV === 'production' ? 'google' : 'mock');
export const uid = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
export const nowIso = () => new Date().toISOString();

const col = (n) => { let s = ''; for (n++; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };
const rowToObj = (tab, r, row) => { const o = { _row: row }; TABS[tab].forEach((h, i) => (o[h] = String(r[i] ?? ''))); return o; };
const objToRow = (tab, o) => TABS[tab].map((h) => String(o[h] ?? ''));
const norm = (tab, o) => Object.fromEntries(TABS[tab].map((h) => [h, String(o[h] ?? '')]));

function applyOp(cache, op) {
  const list = cache[op.tab];
  if (!list) return;
  if (op.type === 'append') { if (!list.some((x) => x._row === op.row)) list.push({ ...op.obj, _row: op.row }); }
  else { const i = list.findIndex((x) => x._row === op.row); if (i >= 0) list[i] = { ...op.obj, _row: op.row }; }
}

/* ---------------- Google Sheets ---------------- */
const SHEETS = 'https://sheets.googleapis.com/v4/spreadsheets';
class SheetsBackend {
  constructor() { this.id = process.env.SHEET_ID; this.cache = null; this.at = 0; this.loading = null; this.during = null; }
  ttl() { return (Number(process.env.CACHE_TTL_SECONDS) || 20) * 1000; }
  async load() {
    if (!this.id) throw new AppError(500, 'ยังไม่ได้ตั้งค่า SHEET_ID (รัน npm run setup)');
    if (this.cache && Date.now() - this.at < this.ttl()) return this.cache;
    if (this.loading) return this.loading;
    this.during = [];
    this.loading = (async () => {
      try {
        const qs = CACHED.map((n) => 'ranges=' + encodeURIComponent(`${n}!A2:${col(TABS[n].length - 1)}`)).join('&');
        const j = await gjson(`${SHEETS}/${this.id}/values:batchGet?${qs}`, undefined, 'Google Sheet');
        const fresh = {};
        j.valueRanges.forEach((vr, i) => {
          const t = CACHED[i];
          fresh[t] = (vr.values || []).map((r, k) => rowToObj(t, r, k + 2)).filter((o) => TABS[t].some((h) => o[h] !== ''));
        });
        for (const op of this.during) applyOp(fresh, op); // เขียนที่เกิดระหว่างโหลดต้องไม่หาย
        this.cache = fresh; this.at = Date.now();
        return fresh;
      } finally { this.during = null; this.loading = null; }
    })();
    return this.loading;
  }
  async append(tab, obj) {
    const r = await gjson(`${SHEETS}/${this.id}/values/${encodeURIComponent(tab + '!A1')}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ values: [objToRow(tab, obj)] }) }, 'Google Sheet');
    const m = /!A(\d+)/.exec(r.updates?.updatedRange || '');
    const row = m ? +m[1] : 0;
    if (tab !== 'Audit') { const op = { type: 'append', tab, row, obj: norm(tab, obj) }; this.during?.push(op); if (this.cache) applyOp(this.cache, op); }
    return row;
  }
  // เพิ่มหลายแถวในคำขอเดียว (ประหยัดโควตาเขียนของ Google Sheets — อัปโหลดรูป 30 ไฟล์ = เขียน 1 ครั้ง)
  async appendMany(tab, objs) {
    if (!objs.length) return;
    const r = await gjson(`${SHEETS}/${this.id}/values/${encodeURIComponent(tab + '!A1')}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ values: objs.map((o) => objToRow(tab, o)) }) }, 'Google Sheet');
    const m = /!A(\d+)/.exec(r.updates?.updatedRange || '');
    const start = m ? +m[1] : 0;
    objs.forEach((obj, i) => { const op = { type: 'append', tab, row: start + i, obj: norm(tab, obj) }; this.during?.push(op); if (this.cache) applyOp(this.cache, op); });
  }
  async update(tab, row, obj) {
    await gjson(`${SHEETS}/${this.id}/values/${encodeURIComponent(`${tab}!A${row}:${col(TABS[tab].length - 1)}${row}`)}?valueInputOption=RAW`,
      { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ values: [objToRow(tab, obj)] }) }, 'Google Sheet');
    const op = { type: 'update', tab, row, obj: norm(tab, obj) }; this.during?.push(op); if (this.cache) applyOp(this.cache, op);
  }
  async readAudit(limit) {
    const j = await gjson(`${SHEETS}/${this.id}/values/${encodeURIComponent('Audit!A2:F')}`, undefined, 'Google Sheet');
    return (j.values || []).slice(-limit).reverse().map((r) => rowToObj('Audit', r, 0));
  }
}

/* ---------------- โหมดทดลอง (ไฟล์ JSON ในเครื่อง — ไม่ใช่ฐานข้อมูลจริง ห้ามใช้ใน production) ---------------- */
export const MOCK_DIR = path.resolve(process.env.MOCK_DIR || '.data');
class MockBackend {
  constructor() { this.file = path.join(MOCK_DIR, 'db.json'); this.cache = null; this.loading = null; }
  async load() {
    if (this.cache) return this.cache;
    if (!this.loading) this.loading = (async () => {
      if (fs.existsSync(this.file)) this.cache = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      else {
        this.cache = Object.fromEntries(Object.keys(TABS).map((t) => [t, []]));
        if (process.env.MOCK_SEED !== '0') { const { seedMock } = await import('./mockseed.js'); await seedMock(this.cache, MOCK_DIR); }
        this.save();
      }
      return this.cache;
    })();
    return this.loading;
  }
  save() { fs.mkdirSync(MOCK_DIR, { recursive: true }); fs.writeFileSync(this.file, JSON.stringify(this.cache)); }
  async append(tab, obj) {
    await this.load();
    const list = this.cache[tab]; const row = list.length + 2;
    list.push({ ...norm(tab, obj), _row: row }); this.save(); return row;
  }
  async appendMany(tab, objs) { for (const o of objs) await this.append(tab, o); }
  async update(tab, row, obj) {
    await this.load();
    const i = this.cache[tab].findIndex((x) => x._row === row);
    if (i >= 0) this.cache[tab][i] = { ...norm(tab, obj), _row: row };
    this.save();
  }
  async readAudit(limit) { await this.load(); return this.cache.Audit.slice(-limit).reverse(); }
}

const g = globalThis;
function be() {
  if (!g.__beqDb) {
    const mode = dataMode();
    if (mode === 'mock' && process.env.NODE_ENV === 'production') throw new AppError(500, 'โหมดทดลอง (mock) ใช้ใน production ไม่ได้ — ตั้ง DATA_MODE=google');
    g.__beqDb = mode === 'google' ? new SheetsBackend() : new MockBackend();
  }
  return g.__beqDb;
}
const tab = async (t) => (await be().load())[t];

/* ---------------- API ระดับธุรกิจ ---------------- */
export const listUsers = () => tab('Users');
export const getUserById = async (id) => (await listUsers()).find((u) => u.id === id);
export const getUserByUsername = async (n) => (await listUsers()).find((u) => u.username.toLowerCase() === String(n).toLowerCase());
export async function createUser(u) {
  const o = { id: uid('U-'), active: 'TRUE', createdAt: nowIso(), updatedAt: nowIso(), ...u };
  await be().append('Users', o); return o;
}
export async function updateUser(u) { u.updatedAt = nowIso(); await be().update('Users', u._row, u); return u; }

export const listRecords = () => tab('Records');
export async function addRecord(r) {
  const o = { id: uid('R-'), createdAt: nowIso(), updatedAt: nowIso(), ...r };
  await be().append('Records', o); return o;
}
export async function updateRecord(r) { r.updatedAt = nowIso(); await be().update('Records', r._row, r); return r; }

export const listMedia = () => tab('Media');
export async function addMediaMany(list) {
  const rows = list.map((m) => ({ status: 'ready', uploadedAt: nowIso(), ...m }));
  await be().appendMany('Media', rows); return rows;
}

export async function getOptions() {
  const stored = Object.fromEntries((await tab('Options')).map((o) => { try { return [o.key, JSON.parse(o.json)]; } catch { return [o.key, null]; } }));
  return Object.fromEntries(Object.keys(DEFAULT_OPTIONS).map((k) => [k, Array.isArray(stored[k]) ? stored[k] : DEFAULT_OPTIONS[k]]));
}
export async function setOptions(key, list) {
  const existing = (await tab('Options')).find((o) => o.key === key);
  const obj = { key, json: JSON.stringify(list) };
  if (existing) await be().update('Options', existing._row, obj); else await be().append('Options', obj);
}

export const folderGet = async (key) => (await tab('Folders')).find((f) => f.key === key)?.driveId;
export const folderSet = (key, driveId) => be().append('Folders', { key, driveId });

export const logAudit = (e) => be().append('Audit', { ts: nowIso(), ...e });
export const readAudit = (limit = 100) => be().readAudit(limit);

/* ---------------- ใช้ใน scripts/setup.mjs ---------------- */
export async function createSpreadsheet(title) {
  const j = await gjson(SHEETS, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ properties: { title } }) }, 'Google Sheet');
  return j.spreadsheetId;
}
export async function ensureSchema(id = process.env.SHEET_ID) {
  const meta = await gjson(`${SHEETS}/${id}?fields=sheets.properties.title`, undefined, 'Google Sheet');
  const have = new Set(meta.sheets.map((s) => s.properties.title));
  const add = Object.keys(TABS).filter((n) => !have.has(n));
  if (add.length) {
    await gjson(`${SHEETS}/${id}:batchUpdate`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests: add.map((title) => ({ addSheet: { properties: { title, gridProperties: { frozenRowCount: 1 } } } })) }) }, 'Google Sheet');
  }
  await gjson(`${SHEETS}/${id}/values:batchUpdate`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ valueInputOption: 'RAW', data: Object.keys(TABS).map((n) => ({ range: `${n}!A1`, values: [TABS[n]] })) }) }, 'Google Sheet');
  return add;
}
