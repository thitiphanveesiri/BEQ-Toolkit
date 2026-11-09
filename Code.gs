/**
 * Content Workflow Engine v1 — Google Apps Script (V8)
 * ผูกกับ Google Sheet ของทีม (Extensions > Apps Script)
 *
 * แบ่ง 3 ส่วน
 *  PART 1  กฎ + State machine (pure function ไม่แตะ Sheets ทดสอบแยกได้)
 *  PART 2  Sheets / Calendar / LINE (ส่วนที่แตะระบบจริง)
 *  PART 3  Setup, Triggers, Views, KPI
 */

/* =====================================================================
 * PART 1 — RULES & STATE MACHINE (pure)
 * ===================================================================== */

const TZ = 'Asia/Bangkok';

const ST = {
  TP: 'Theme & Planning', CD: 'Content Development', BR: 'Brief Ready',
  BA: 'Brief Approved', RFP: 'Ready for Production', IP: 'In Production', SR: 'Submitted for Review',
  RR: 'Revision Required', CR: 'Content Review', AMR: 'Assistant Manager Review',
  FA: 'Final Approval', RTP: 'Ready to Publish', PUB: 'Published',
  DONE: 'Completed', BLK: 'Blocked', CAN: 'Cancelled'
};
const TERMINAL = [ST.DONE, ST.CAN];

const POS = {
  DIR: 'Director', CEO: 'CEO', COO: 'COO', AM: 'Assistant Manager', SG: 'Senior Graphic',
  SVE: 'Senior Video Editor', VE: 'Video Editor',
  CV: 'Content & Video', GV: 'Graphic & Video'
};

// ลำดับยศ (ใช้เรื่อง "ตรวจแทน": ตำแหน่งที่สูงกว่ารับตรวจแทนผู้ตรวจเดิมที่ไม่ว่างได้)
const RANK = { 'Video Editor': 0, 'Graphic & Video': 0, 'Senior Video Editor': 1, 'Senior Graphic': 1, 'Content & Video': 2, 'Assistant Manager': 3, 'Director': 4, 'CEO': 4, 'COO': 4 };
const EXEC_POS = [POS.DIR, POS.CEO, POS.COO];
function isExecPos_(position) { return EXEC_POS.indexOf(position) >= 0; }
// ผู้บริหารที่ตรวจ Final ได้ทั้งหมด (CEO/COO/Director ที่ active) — ถ้าไม่มีใครติ๊ก is_final_approver ให้ใช้ผู้บริหารทุกคน
function execAll_(members) {
  const ex = members.filter(m => isExecPos_(m.position) && m.active !== false);
  const fin = ex.filter(m => m.is_final_approver === true);
  return fin.length ? fin : ex;
}
function execEmails_(members) { return execAll_(members).map(m => String(m.email).toLowerCase()).filter(Boolean); }
// ชื่อ + ตำแหน่ง สำหรับข้อความแจ้งเตือน
function nameP_(members, e) { const m = memberByEmail(members, e); return m ? m.name + ' (' + m.position + ')' : (e || '-'); }
// บรรทัด "ผู้ทำ / ผู้ตรวจ" (ชื่อ+ตำแหน่ง) — tk = งานย่อย (ถ้าเป็นเหตุการณ์ของงานย่อย) | tks = งานย่อยทั้งหมดของ Content
function whoLine_(members, cc, tks, tk) {
  const L = es => { const u = es.map(e => String(e || '').toLowerCase().trim()).filter((x, i, a) => x && a.indexOf(x) === i); return u.length ? u.map(e => nameP_(members, e)).join(', ') : '-'; };
  const inGate = [ST.CR, ST.AMR, ST.FA].includes(cc.current_status);
  let prod, rev;
  if (tk && !inGate) { prod = [tk.assignee_email]; rev = [tk.reviewer_email].concat(coList_(tk.co_reviewers)); }
  else {
    prod = (tks || []).map(x => x.assignee_email);
    rev = inGate ? [cc.current_owner_email].concat(coList_(cc.gate_co_reviewers)) : (tks || []).filter(x => x.status !== 'Passed').map(x => x.reviewer_email);
  }
  return 'ผู้ทำ: ' + L(prod) + '\nผู้ตรวจ: ' + L(rev) + (inGate && cc.current_gate === 'FINAL' && coList_(cc.gate_co_reviewers).length ? ' (คนใดคนหนึ่งอนุมัติได้)' : '');
}
function execMember_(members) { return members.find(m => isExecPos_(m.position) && m.active !== false); }
const TYPES = ['Reels', 'YouTube', 'Graphic', 'Banner', 'Article'];
const FUNNELS = ['Consideration', 'Consideration VDO', 'Awareness', 'Awareness VDO', 'Action', 'Action VDO', 'Relationship'];
const FAMILY = { Reels: 'Video', YouTube: 'Video', Graphic: 'Graphic', Banner: 'Graphic', Article: 'Article' };

// ด่านตรวจ: ใครตรวจ + การ์ดไปอยู่คอลัมน์ไหน
const GATES = {
  SR_VIDEO:     { pos: POS.SVE, status: ST.SR,  label: 'Sr. Video Review' },
  SR_GRAPHIC:   { pos: POS.SG,  status: ST.SR,  label: 'Sr. Graphic Review' },
  SR_VIDEO_SUB: { pos: POS.SVE, status: ST.SR,  label: 'Sr. Video Editor ตรวจ Graphic ทดแทน' },
  SR:           { pos: null,    status: ST.SR,  label: 'Senior ตรวจงานย่อย' },
  CT1:          { pos: POS.CV,  status: ST.CR,  label: 'Content Review' },
  CT2:          { pos: POS.AM,  status: ST.AMR, label: 'Assistant Manager Review' },
  AM_ARTICLE:   { pos: POS.AM,  status: ST.AMR, label: 'AM Review (เนื้อหา+แผน)' },
  FINAL:        { pos: POS.DIR, status: ST.FA,  label: 'Director Final Approval' }
};
// ลิมิตงานที่รับได้พร้อมกัน (WIP Limit)
const WIP_LIMITS = { 'Video Editor': 2, 'Senior Video Editor': 2, 'Graphic & Video': 2, 'Senior Graphic': 2, 'Content & Video': 3 };   // ค่าทดลอง R5 (ปรับได้ในชีต SLA_Config: WIP_LIMIT|<ตำแหน่ง>)
function wipLimitOf_(cfg, position) { const v = Number((cfg || {})['WIP_LIMIT|' + position]); return v > 0 ? v : (WIP_LIMITS[position] || 3); }
// ชั่วโมงมาตรฐานต่อชิ้น (ใช้ประเมินภาระงาน) แยกจาก WEIGHT_HOURS ซึ่งใช้คำนวณ Weighted Output เท่านั้น (R4)
function stdHours_(cfg, type) { const v = Number((cfg || {})['STD_HOURS|' + type]); return v > 0 ? v : (DEFAULT_SLA['STD_HOURS|' + type] || 0); }
// R6: Required Deliverables — งานย่อยที่ "บังคับ" ต้องผ่านครบ และสายงานที่ประเภทนั้นต้องมี (เช่น YouTube = Video + Graphic/Thumbnail)
// ปรับได้ที่ SLA_Config: REQ_LANES|<ประเภท> = Video,Graphic (ใส่ - = ไม่บังคับสายใดเลย)
const REQ_LANES = { YouTube: ['Video', 'Graphic'], Reels: ['Video'], Graphic: ['Graphic'], Banner: ['Graphic'], Article: ['Article'] };
function isReq_(t) { return !(t.is_required === false || String(t.is_required).toUpperCase() === 'FALSE'); }
function reqLanesOf_(cfg, type) {
  const v = (cfg || {})['REQ_LANES|' + type];
  if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim() === '-' ? [] : String(v).split(',').map(x => x.trim()).filter(Boolean);
  return REQ_LANES[type] || [];
}
function deliv_(cfg, c, tasks) {
  const req = tasks.filter(isReq_), laneOf = t => t.lane || FAMILY[c.content_type];
  const pending = req.filter(t => t.status !== 'Passed').map(t => t.label || t.task_id);
  const missing = reqLanesOf_(cfg, c.content_type).filter(l => !req.some(t => laneOf(t) === l));
  return { total: tasks.length, required: req.length, passed: req.filter(t => t.status === 'Passed').length, pending: pending, missing_lanes: missing,
    ready: req.length > 0 && !pending.length && !missing.length };
}
// ===== ระบบดาว =====
// ส่งก่อนกำหนด (เหลือเวลา ≥ EARLY_HOURS ชม.) ครบ EARLY_N ครั้ง = +1 ดาว · ส่งตรงเวลา (ทันกำหนดแต่ไม่ถึงเกณฑ์ก่อน) ครบ ONTIME_N ครั้ง = +1 ดาว · ถูกส่งกลับเพราะผู้ผลิตผิดพลาด 1 ครั้ง = −REV_PENALTY ดาว
// ปรับได้ที่ SLA_Config: STAR|EARLY_N, STAR|ONTIME_N, STAR|REV_PENALTY, STAR|EARLY_HOURS, STAR|CUTOFF_DAY (0 = นับรอบตามเดือนปฏิทิน, 1-28 = ตัดรอบวันที่นั้นของเดือน)
const STAR_DEF = { EARLY_N: 3, ONTIME_N: 5, REV_PENALTY: 0.5, EARLY_HOURS: 8, CUTOFF_DAY: 0 };
function starCfg_(cfg) { const o = {}; Object.keys(STAR_DEF).forEach(k => { const raw = (cfg || {})['STAR|' + k], v = Number(raw); o[k] = raw !== undefined && String(raw).trim() !== '' && !isNaN(v) && (v > 0 || k === 'CUTOFF_DAY' || k === 'REV_PENALTY') ? v : STAR_DEF[k]; }); return o; }
function starClass_(t, sc) {   // ก่อนกำหนด / ตรงเวลา / เลยกำหนด (นับจากการส่งครั้งแรกของงานที่ผ่านแล้ว)
  if (!t || t.status !== 'Passed') return '';
  const m = t.first_margin_h;
  if (m !== '' && m !== undefined && m !== null && !isNaN(Number(m))) return Number(m) >= sc.EARLY_HOURS ? 'early' : Number(m) >= 0 ? 'ontime' : 'late';
  const f = t.first_on_time; if (f === true || String(f).toUpperCase() === 'TRUE') return 'ontime'; if (f === false || String(f).toUpperCase() === 'FALSE') return 'late';
  return '';
}
function starCycle_(cfg, now, offset) {   // รอบนับดาว: offset 0 = รอบปัจจุบัน, -1 = รอบที่แล้ว
  const d = starCfg_(cfg).CUTOFF_DAY, y = now.getFullYear(), m = now.getMonth(), day = now.getDate();
  let endM;
  if (!d) endM = m + 1;   // เดือนปฏิทิน: [1, สิ้นเดือน]
  else endM = day <= d ? m : m + 1;   // ตัดรอบวันที่ d: ถ้าวันนี้ยังไม่เกิน d รอบจบเดือนนี้
  endM += (offset || 0);
  const to = d ? new Date(y, endM, d + 1) : new Date(y, endM, 1), from = d ? new Date(y, endM - 1, d + 1) : new Date(y, endM - 1, 1);
  const f = x => x.getFullYear() + '-' + ('0' + (x.getMonth() + 1)).slice(-2) + '-' + ('0' + x.getDate()).slice(-2);
  return { from: from, to: to, label: f(from) + ' ถึง ' + f(new Date(to.getTime() - 864e5)) };
}
// คืน {email: {early, ontime, late, rev, gained, lost, stars_raw, stars, events:[{at,kind,task_id,task,content_id,title,delta,note}]}} — events เรียงตามเวลา แสดงที่มาของการได้/เสียทุกรายการ
function starsFor_(tasks, reviews, cfg, from, to, contents) {
  const sc = starCfg_(cfg), H = d => { const x = d ? new Date(d).getTime() : 0; return isNaN(x) ? 0 : x; };
  const lo = from ? H(from) : 0, hi = to ? H(to) : Infinity, inR = d => { const v = H(d); return v > 0 && v >= lo && v < hi; };
  const cm = {}; (contents || []).forEach(x => { cm[x.content_id] = x; });
  const P = {}, g = e => { const k = String(e || '').toLowerCase(); if (!k) return null; return P[k] = P[k] || { early: 0, ontime: 0, late: 0, rev: 0, events: [] }; };
  const byId = {}; tasks.forEach(t => { byId[t.task_id] = t; });
  const ev = (s, at, kind, t, delta, note) => s.events.push({ at: at, kind: kind, task_id: t ? t.task_id : '', task: t ? (t.label || t.task_id) : '', content_id: t ? t.content_id : '', title: t && cm[t.content_id] ? cm[t.content_id].title : '', delta: delta, note: note });
  tasks.forEach(t => { const k = starClass_(t, sc); if (k && inR(t.done_at)) { const s = g(t.assignee_email); if (s) { s[k]++; s.events.push({ _t: t, at: t.done_at, kind: k }); } } });
  reviews.forEach(r => {
    if (r.result !== 'Revision Required' || r.cause_type !== 'producer_error' || r.gate_code === 'BRIEF' || !inR(r.decided_at)) return;
    const ids = r.task_id ? [r.task_id] : String(r.returned_tasks || '').split(',').map(x => x.trim()).filter(Boolean);
    ids.forEach(id => { const t = byId[id]; const s = g(t ? t.assignee_email : (r.task_id ? r.producer_email : '')); if (s) { s.rev++; s.events.push({ _t: t, at: r.decided_at, kind: 'rev', _r: r }); } });
  });
  Object.keys(P).forEach(k => {
    const s = P[k], raw = [], cnt = { early: 0, ontime: 0 };
    s.events.sort((a, b) => H(a.at) - H(b.at));
    s.events.forEach(e => { const t = e._t, r = e._r; let delta = 0, note = '';
      if (e.kind === 'early' || e.kind === 'ontime') {
        const n = sc[e.kind === 'early' ? 'EARLY_N' : 'ONTIME_N']; cnt[e.kind]++;
        const lbl = e.kind === 'early' ? 'ส่งก่อนกำหนด' : 'ส่งตรงเวลา';
        if (cnt[e.kind] % n === 0) { delta = 1; note = lbl + ' ครั้งที่ ' + cnt[e.kind] + ' → ครบ ' + n + ' ครั้ง ได้ +1 ดาว'; } else note = lbl + ' ครั้งที่ ' + cnt[e.kind] + ' (สะสม ' + (cnt[e.kind] % n) + '/' + n + ')';
      } else if (e.kind === 'late') { note = 'ส่งเลยกำหนด (ไม่ได้แต้ม ไม่ถูกหัก)'; }
      else if (e.kind === 'rev') { delta = -sc.REV_PENALTY; note = 'ถูกส่งกลับให้แก้ (ผู้ผลิตผิดพลาด)' + (r && r.reason ? ': ' + String(r.reason).slice(0, 80) : '') + ' → −' + sc.REV_PENALTY + ' ดาว'; }
      e.task_id = t ? t.task_id : ''; e.task = t ? (t.label || t.task_id) : ''; e.content_id = t ? t.content_id : (r ? r.content_id : ''); e.title = cm[e.content_id] ? cm[e.content_id].title : ''; e.delta = delta; e.note = note;
      delete e._t; delete e._r; });
    s.gained = s.events.filter(e => e.delta > 0).reduce((a, e) => a + e.delta, 0);
    s.lost = s.events.filter(e => e.delta < 0).reduce((a, e) => a - e.delta, 0);
    s.stars_raw = s.gained - s.lost; s.stars = Math.max(0, s.stars_raw);
    s.to_next_early = sc.EARLY_N - (s.early % sc.EARLY_N); s.to_next_ontime = sc.ONTIME_N - (s.ontime % sc.ONTIME_N);
  });
  return P;
}
function taskHours_(t, cfg, type) { const e = Number(t.estimated_hours); return e > 0 ? e : stdHours_(cfg, type); }
// ค่า SLA เริ่มต้น (วันทำงาน) ปรับได้ใน Sheet SLA_Config
const DEFAULT_SLA = {
  'CONTENT|*': 3, 'BRIEF_CHECK|*': 1,
  'PROD|Reels': 3, 'PROD|YouTube': 7, 'PROD|Graphic': 2, 'PROD|Banner': 2, 'PROD|Article': 3,
  'REV_SR_VIDEO|Reels': 1, 'REV_SR_VIDEO|YouTube': 2,
  'REV_SR_GRAPHIC|*': 1, 'REV_SR_VIDEO_SUB|*': 1,
  'REV_CT1|Reels': 1, 'REV_CT1|YouTube': 1, 'REV_CT1|Graphic': 0.5, 'REV_CT1|Banner': 0.5,
  'REV_CT2|Reels': 0.5, 'REV_CT2|YouTube': 1, 'REV_CT2|Graphic': 0.5, 'REV_CT2|Banner': 0.5,
  'REV_AM_ARTICLE|*': 1, 'REV_FINAL|*': 1,
  'REVISION|Reels': 1, 'REVISION|YouTube': 3, 'REVISION|Graphic': 1, 'REVISION|Banner': 1, 'REVISION|Article': 1,
  'WEIGHT_HOURS|Reels': 4, 'WEIGHT_HOURS|YouTube': 20, 'WEIGHT_HOURS|Graphic': 3,
  'WEIGHT_HOURS|Banner': 3, 'WEIGHT_HOURS|Article': 6,
  'STD_HOURS|Reels': 6, 'STD_HOURS|YouTube': 16, 'STD_HOURS|Graphic': 4, 'STD_HOURS|Banner': 4, 'STD_HOURS|Article': 5   // ค่าเริ่มต้นสำหรับทดลอง: ทีมต้องปรับเอง
};

function slaWd(cfg, stage, type) {
  const m = cfg || DEFAULT_SLA;
  const k1 = stage + '|' + type, k2 = stage + '|*';
  const has = v => v !== undefined && v !== null && String(v).trim() !== '' && !isNaN(Number(v));
  if (has(m[k1])) return Number(m[k1]);
  if (has(m[k2])) return Number(m[k2]);
  if (DEFAULT_SLA[k1] !== undefined) return DEFAULT_SLA[k1];
  if (DEFAULT_SLA[k2] !== undefined) return DEFAULT_SLA[k2];
  return null;
}

// 1 วันทำงาน = 24 ชม. นับเฉพาะ จ-ศ (ยังไม่รู้วันหยุดนักขัตฤกษ์)

// ด่านตรวจระดับงานรวม (หลังงานย่อยทุกชิ้นผ่าน Senior แล้ว): Article = AM > Director / Video,Graphic = Content > AM > Director
function buildGates(type) {
  return FAMILY[type] === 'Article' ? ['AM_ARTICLE', 'FINAL'] : ['CT1', 'CT2', 'FINAL'];
}
// ผู้ตรวจหลายคน: ผู้ตรวจหลัก + ผู้ตรวจร่วม ต้องอนุมัติครบทุกคนถึงผ่าน / ใครสั่งแก้คนเดียวก็ส่งกลับ
function coList_(s) { return String(s || '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean); }
function isRevT_(t, e) { e = String(e || '').toLowerCase(); return String(t.reviewer_email || '').toLowerCase() === e || coList_(t.co_reviewers).indexOf(e) >= 0; }
function isRevC_(c, e) { e = String(e || '').toLowerCase(); return String(c.current_owner_email || '').toLowerCase() === e || coList_(c.gate_co_reviewers).indexOf(e) >= 0; }
function pendRev_(primary, co, approved) {
  const need = [String(primary || '').toLowerCase()].concat(coList_(co)).filter(Boolean).filter((x, i, a) => a.indexOf(x) === i), ap = coList_(approved);
  return need.filter(e => ap.indexOf(e) < 0);
}
const LANES = ['Video', 'Graphic', 'Article'];
function canProduceLane(m, lane) { return String(m.can_produce || '').split(',').map(x => x.trim()).includes(lane); }

function parseDT(s) { // 'YYYY-MM-DD HH:mm'
  if (!s) return null;
  if (s instanceof Date) return isNaN(s) ? null : s;
  const m = String(s).trim().match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/);
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  return isNaN(d) ? null : d;
}
function isUrl(s) { return /^https?:\/\/\S+\.\S+/.test(String(s || '').trim()); }
function pad(n, w) { return String(n).padStart(w, '0'); }
function fmtD(d) {
  if (!d) return '-';
  const x = new Date(d);
  return pad(x.getDate(), 2) + '/' + pad(x.getMonth() + 1, 2) + ' ' + pad(x.getHours(), 2) + ':' + pad(x.getMinutes(), 2);
}

function memberByPos(members, pos) { return isExecPos_(pos) ? execMember_(members) : members.find(m => m.position === pos && m.active !== false); }
function memberByEmail(members, email) { return members.find(m => String(m.email).toLowerCase() === String(email).toLowerCase()); }
function canProduce(m, type) { return String(m.can_produce || '').split(',').map(s => s.trim()).includes(FAMILY[type]); }

/**
 * applyAction: ตัดสินว่า Action ทำได้ไหม และจะเปลี่ยนอะไรบ้าง
 */
function applyAction(ctx) {
  const I = ctx.input, members = ctx.members, cfg = ctx.cfg, now = ctx.now;
  const c = ctx.content ? Object.assign({}, ctx.content) : null;
  const tasks = (ctx.tasks || (ctx.task ? [ctx.task] : [])).map(x => Object.assign({}, x));
  let t = null;
  if (I.taskId) t = tasks.find(x => x.task_id === I.taskId) || null;
  else if (tasks.length === 1) t = tasks[0];
  const out = { ok: false, logs: [], notify: [], content: null, task: null, review: null, brief: null, newContent: false, newTask: false, newTasks: [], audit: [] };
  const actor = memberByEmail(members, I.email);
  const nameOf = e => { const m = memberByEmail(members, e); return m ? m.name : (e || '-'); };
  const stamp = Math.floor(now.getTime() / 60000);

  const log = (event, from, to, reason, extra) => out.logs.push({
    content_id: c ? c.content_id : '', task_id: t ? t.task_id : '', event_type: event,
    actor_email: I.email, actor_role_in_task: actor ? actor.position : '',
    from_status: from || '', to_status: to || '', reason: reason || '', at: now, source: 'miniapp',
    payload_json: extra ? JSON.stringify(extra) : ''
  });
  const msg = (icon, line) => {
    const cc = out.content || c;
    return icon + ' ' + line + '\n[' + (cc.title || '-') + '] ' + cc.content_id + ' (' + cc.content_type + ')\n' +
      'สถานะ: ' + cc.current_status + ' | ผู้รับผิดชอบ: ' + nameP_(members, cc.current_owner_email) +
      '\n' + whoLine_(members, cc, tasks, out.task || (I.taskId ? t : null)) +
      (actor ? '\nดำเนินการโดย: ' + nameP_(members, actor.email) : '') +
      '\nกำหนด: ' + fmtD(cc.current_due_at) + (ctx.baseUrl ? '\n' + ctx.baseUrl : '');
  };
  const note = (event, text, to) => out.notify.push({ event: event, key: event + '|' + (out.content || c).content_id + '|' + stamp + (to ? '|' + to.join(',') : '') + '|' + h32_(text), text: text, to: to });
  const urgentExtra = () => { const v = String(I.priority || '').toLowerCase(); return (I.optional === true || String(I.optional).toLowerCase() === 'true' || I.optional === 'ใช่') && (v === 'urgent' || v === 'high' || v === 'ด่วน'); };
  const urgentRecipients = extra => { const a = (extra || []).slice(); if (urgentExtra()) { const am = memberByPos(members, POS.AM); [am && am.email].concat(execEmails_(members)).forEach(e => { if (e && a.indexOf(e) < 0) a.push(e); }); } return a.filter(Boolean); };
  const upd = tk => { out.taskUpdates = out.taskUpdates || []; if (out.taskUpdates.indexOf(tk) < 0) out.taskUpdates.push(tk); out.task = tk; return tk; };
  const reject = reason => {
    out.ok = false; out.reason = reason;
    out.logs.length = 0;
    const st = c ? c.current_status : '';
    log('rejected_attempt', st, st, '[' + I.action + '] ' + reason);
    out.notify.length = 0;
    out.notify.push({
      event: 'rejected_attempt', key: 'REJ|' + (c ? c.content_id : '-') + '|' + I.email + '|' + stamp,
      text: '⛔ ปฏิเสธ Action ' + I.action + (c ? ' (' + c.content_id + ')' : '') + '\nผู้กด: ' + (actor ? nameP_(members, actor.email) : I.email) + '\nเหตุผล: ' + reason
    });
    return out;
  };
  const fin = (fn) => { out.ok = true; if (fn) fn(); return out; };

  if (!actor || actor.active === false) return reject('อีเมลนี้ไม่อยู่ใน Team_Members หรือถูกปิดใช้งาน');
  const themeAct = ['CREATE_THEME', 'UPDATE_THEME', 'SET_THEME_ACTIVE', 'DELETE_THEME'].indexOf(I.action) >= 0;
  if (!themeAct && !(memberByPos(members, POS.DIR) && memberByPos(members, POS.AM) && memberByPos(members, POS.CV)))
    return reject('Team_Members ต้องมี Director, Assistant Manager และ Content & Video ที่เปิดใช้งานอย่างน้อยอย่างละ 1 คน');
  const pos = actor.position;
  const cvOf = cc => { const m = memberByEmail(members, cc.creator_email); return (m && m.position === POS.CV && m.active !== false) ? m : memberByPos(members, POS.CV); };
  const laneOf = tk => (tk && tk.lane) || FAMILY[c.content_type];
  const seniorPosOf = lane => lane === 'Video' ? POS.SVE : lane === 'Graphic' ? POS.SG : null;
  // งานที่ AM ลงมือทำเอง ไม่ต้องผ่านการตรวจ — ให้ Director Approve (FINAL) เท่านั้น
  const isAMp = e => { const m = memberByEmail(members, e); return !!m && m.position === POS.AM; };
  const gatesFor = () => {
    let g = buildGates(c.content_type);
    const prods = tasks.map(x => x.assignee_email).filter(Boolean);
    if (prods.length && prods.every(isAMp)) return ['FINAL'];                         // AM ทำทั้งหมด → Director อย่างเดียว
    if (prods.some(isAMp)) g = g.filter(x => x !== 'CT2' && x !== 'AM_ARTICLE');       // ทำร่วมกับคนอื่น → ข้ามด่าน AM (ไม่ตรวจงานตัวเอง)
    const cvm = cvOf(c), cvE = cvm ? String(cvm.email).toLowerCase() : '';
    // Content เป็นผู้ตรวจ (หลัก/ร่วม) ของทุกงานย่อยแล้ว → ไม่ต้องตรวจงานรวมซ้ำที่ด่าน Content
    if (cvE && tasks.length && tasks.every(x => String(x.reviewer_email || '').toLowerCase() === cvE || coList_(x.co_reviewers).indexOf(cvE) >= 0)) g = g.filter(x => x !== 'CT1');
    return g;
  };
  // ตรวจผู้ตรวจร่วม: ไม่ใช่ผู้ผลิต, Content ตรวจได้เฉพาะงานตัวเอง
  const vCo = (list, producers) => {
    const res = [];
    for (const raw of coList_(list)) {
      const m = memberByEmail(members, raw);
      if (!m || m.active === false) return { err: 'ไม่พบผู้ตรวจร่วม ' + raw + ' ใน Team_Members' };
      if (producers.indexOf(raw) >= 0) return { err: 'ห้ามตั้งผู้ผลิตเป็นผู้ตรวจร่วมของงานตัวเอง (' + m.name + ')' };
      if (m.position === POS.CV && cvOf(c) && String(cvOf(c).email).toLowerCase() !== raw) return { err: 'Content ตรวจได้เฉพาะงานของตัวเอง (' + m.name + ')' };
      if (res.indexOf(raw) < 0) res.push(raw);
    }
    return { ok: true, list: res };
  };
  const subReviewer = (tk, producer) => {
    if (isAMp(producer.email)) return null;   // งานย่อยที่ AM ทำเอง ผ่านทันที ไม่ต้องให้ Senior/Content ตรวจ
    const lane = laneOf(tk); if (lane === 'Article') return null;
    const sp = seniorPosOf(lane), sm = sp && memberByPos(members, sp);
    // ผู้ตรวจต้องไม่ใช่ผู้ที่ลงมือทำงานนี้: ผู้ผลิตปัจจุบัน หรือคนที่เคยส่งต่องานชิ้นนี้ (Delegate) → ให้ Content ตรวจแทน
    const conflict = [String(producer.email).toLowerCase()].concat(String(tk.delegated_by || '').toLowerCase().split(',').map(x => x.trim()).filter(Boolean));
    return (sm && conflict.indexOf(sm.email.toLowerCase()) < 0) ? sm : cvOf(c);
  };
  const isOwnerCV = () => pos === POS.CV && c && (String(c.current_owner_email).toLowerCase() === I.email || String(c.creator_email).toLowerCase() === I.email);
  const syncProd = cc => {
    const ds = tasks.filter(x => x.status !== 'Passed').map(x => x.sla_due_at).filter(Boolean).map(d => new Date(d).getTime());
    cc.current_due_at = ds.length ? new Date(Math.min.apply(null, ds)) : ''; cc.updated_at = now;
  };
  const finishTasks = () => {
    const gates = gatesFor();
    const rg = tasks.map(x => x.return_gate).find(g => g && g !== 'FIRST' && gates.indexOf(g) >= 0);
    tasks.forEach(x => { if (x.return_gate) { x.return_gate = ''; upd(x); } });
    const gate = gates[rg ? gates.indexOf(rg) : 0];
    return { gate: gate, r: enterGate(c, null, gate, tasks.map(x => x.assignee_email)) };
  };
  const LANE_TH = { Video: 'วิดีโอ', Graphic: 'กราฟิก/Thumbnail', Article: 'บทความ' };
  const afterTaskPassed = () => {
    // R7: งานที่รอชิ้นนี้อยู่ → แจ้งผู้ผลิตว่าเริ่มได้แล้ว (เฉพาะเมื่อ Dependency ครบทุกชิ้น)
    const doneId = out.task && out.task.task_id;
    if (doneId) tasks.filter(x => x.status === ST.RFP && String(x.depends_on || '').split(',').map(y => y.trim()).indexOf(doneId) >= 0 &&
      String(x.depends_on).split(',').map(y => y.trim()).filter(Boolean).every(id => { const d = tasks.find(z => z.task_id === id); return !d || d.status === 'Passed'; }))
      .forEach(x => note('DEP_READY', msg('🟢', 'เริ่มงาน "' + (x.label || x.task_id) + '" ได้แล้ว งานที่ต้องรอผ่านครบแล้ว'), [x.assignee_email]));
    // R6: Review Gate เริ่มเมื่อ "งานบังคับ" ผ่านครบ และมีงานครบทุกสายที่ประเภทนี้ต้องมี (เช่น YouTube ต้องมีทั้ง Video และ Thumbnail)
    const ds = deliv_(cfg, c, tasks);
    if (ds.ready) {
      const f = finishTasks();
      if (f.r === 'OK') note('ALLPASSED', msg('📦', 'งานย่อยบังคับผ่านครบทุกชิ้น รอ ' + GATES[f.gate].label + ' ตรวจงานรวม'));
      else note('ROUTER_BLOCK', msg('🚧', 'หาผู้ตรวจงานรวมไม่ได้ (' + f.r + ') AM ต้องจัดการ'));
    } else {
      syncProd(c);   // ยังไม่ครบ: อัปเดต Deadline ของงานหลักเป็นชิ้นที่ใกล้สุด
      if (!ds.pending.length && ds.missing_lanes.length) note('DELIV_MISSING', msg('⏳', 'งานที่มีผ่านครบแล้ว แต่ยังขาดงานสาย ' + ds.missing_lanes.map(l => LANE_TH[l] || l).join(', ') + ' — AM/Content ต้องมอบหมายเพิ่ม'));
    }
  };
  const needC = () => !c ? 'ไม่พบ Content ID นี้' : null;
  // R5 WIP: นับงานที่ "กำลังถืออยู่และไม่ได้หยุดรอข้อมูล" ของคนนั้นทุก Content (งานที่ PAUSE รอข้อมูลแสดงแยก ไม่นับเข้า Limit)
  const WIP_ACTIVE = ['Ready for Production', 'In Production', 'Revision Required'];
  const mineActive = e => tasks.filter(x => String(x.assignee_email).toLowerCase() === e && WIP_ACTIVE.indexOf(x.status) >= 0 && !x.wait_since);
  const wipBase = e => ctx.workload ? (ctx.workload[e] || 0) : mineActive(e).length;
  const hoursBase = e => ctx.workloadHours ? (ctx.workloadHours[e] || 0) : mineActive(e).reduce((s, x) => s + taskHours_(x, cfg, c.content_type), 0);
  const estOf = raw => { const n = Number(raw); return n > 0 ? n : stdHours_(cfg, c.content_type); };
  const badEst = raw => raw !== undefined && raw !== null && String(raw).trim() !== '' && !(Number(raw) > 0 && Number(raw) <= 200);
  // add = จำนวนชิ้น/ชั่วโมงที่จะเพิ่มให้คนนี้ (รวมชิ้นที่เพิ่งคิวไว้ใน Batch เดียวกัน)
  const wipCheck = (pr, add, addH) => {
    const e = pr.email.toLowerCase(), n = wipBase(e) + add, lim = wipLimitOf_(cfg, pr.position);
    const cap = Number(pr.weekly_capacity_hours) || 0, h = hoursBase(e) + (addH || 0), why = [];
    if (n > lim) why.push('ถืองาน ' + n + '/' + lim + ' ชิ้น (WIP Limit)');
    if (cap > 0 && h > cap) why.push('ภาระงาน ' + (Math.round(h * 10) / 10) + '/' + cap + ' ชม. ต่อสัปดาห์ (Capacity)');
    if (!why.length) return { ok: true };
    const head = pr.name + ' เกิน: ' + why.join(', ') + ' ';
    if (!I.override_wip) return { err: head + 'ให้เลือกคนอื่น หรือให้ AM/CEO/COO/Director Override พร้อมเหตุผล' };
    if (!(pos === POS.AM || isExecPos_(pos))) return { err: head + 'เฉพาะ AM/CEO/COO/Director เท่านั้นที่ Override ได้' };
    if (String(I.override_reason || '').trim().length < 3) return { err: head + 'ต้องระบุเหตุผลที่ Override' };
    return { ok: true, over: true, text: pr.name + ' ' + why.join(', ') + ': ' + String(I.override_reason).trim() };
  };
  const logOverride = (ov, from, tk) => { (ov || []).forEach(o => { log('wip_override', from, c.current_status, o); if (tk) out.logs[out.logs.length - 1].task_id = tk.task_id; }); };
  const dueFrom = (stage, from) => { const w = slaWd(cfg, stage, c.content_type); return w === null ? null : addWorkDays(from, w); };

  const handoff = (cc, status, ownerEmail, due, gate) => {
    cc.current_status = status; cc.current_gate = gate || '';
    cc.block_reason = ''; cc.blocked_since = status === ST.BLK ? now : ''; cc.review_started_at = ''; cc.gate_co_reviewers = ''; cc.gate_co_approved = '';   // R2: เริ่มติดขัดเมื่อไร
    cc.current_owner_email = ownerEmail || ''; cc.current_owner_name = nameOf(ownerEmail);
    cc.current_started_at = now; cc.current_due_at = due || ''; cc.is_waiting = false; cc.updated_at = now;
  };
  const enterGate = (cc, tt, gateCode, producerEmail) => {
    const g = GATES[gateCode];
    const prods = [].concat(producerEmail || []).map(e => String(e).toLowerCase());
    // Final: ผู้บริหารทุกคนที่มีสิทธิ์ (CEO/COO/Director) ตรวจได้ คนใดคนหนึ่งอนุมัติก็พอ — ตัดคนที่เป็นผู้ผลิตงานนี้ออก
    const finalCands = gateCode === 'FINAL' ? execAll_(members).filter(m => prods.indexOf(String(m.email).toLowerCase()) < 0) : [];
    const reviewer = gateCode === 'CT1' ? cvOf(cc) : gateCode === 'FINAL' ? (finalCands[0] || execMember_(members)) : memberByPos(members, g.pos);
    if (!reviewer) { handoff(cc, ST.BLK, memberByPos(members, POS.AM).email, null, gateCode); cc.block_reason = 'NO_REVIEWER'; return 'NO_REVIEWER'; }
    if (prods.indexOf(reviewer.email.toLowerCase()) >= 0) {
      handoff(cc, ST.BLK, memberByPos(members, POS.AM).email, null, gateCode); cc.block_reason = 'SELF_REVIEW'; return 'SELF_REVIEW';
    }
    let due = dueFrom('REV_' + gateCode, now);
    if (gateCode === 'FINAL') {
      const cutoff = cc.planned_publish_at ? new Date(new Date(cc.planned_publish_at).getTime() - 24 * 3600e3) : null;
      if (cutoff && (!due || cutoff < due)) due = cutoff;
    }
    handoff(cc, g.status, reviewer.email, due, gateCode);
    if (gateCode === 'FINAL') cc.gate_co_reviewers = finalCands.slice(1).map(m => String(m.email).toLowerCase()).join(',');   // ผู้บริหารคนอื่น = ผู้ตรวจ Final ร่วม (ไม่ต้องผ่านทุกคน)
    return 'OK';
  };

  switch (I.action) {
    case 'CREATE_THEME': {
      if (!(pos === POS.AM || isExecPos_(pos))) return reject('เฉพาะ CEO / COO / Director หรือ AM สร้าง/กำหนด Theme ได้');
      const nm = String(I.title || '').trim();
      if (!nm) return reject('ต้องใส่ชื่อ Theme');
      if ((ctx.themes || []).some(x => String(x.name).trim().toLowerCase() === nm.toLowerCase())) return reject('มี Theme ชื่อนี้อยู่แล้ว');
      const sd = I.start ? parseDT(I.start + (String(I.start).length === 10 ? ' 00:00' : '')) : null;
      const ed = I.end ? parseDT(I.end + (String(I.end).length === 10 ? ' 00:00' : '')) : null;
      if (I.start && !sd) return reject('วันเริ่ม Theme ต้องเป็น YYYY-MM-DD');
      if (I.end && !ed) return reject('วันสิ้นสุด Theme ต้องเป็น YYYY-MM-DD');
      if (sd && ed && ed < sd) return reject('วันสิ้นสุดต้องไม่ก่อนวันเริ่ม');
      const tid = 'THM-' + now.getFullYear() + '-' + pad((ctx.nextThemeSeq || 1), 3);
      out.theme = { theme_id: tid, name: nm, objective: I.objective || '', description: I.detail || '', start_date: sd || '', end_date: ed || '',
        created_by: I.email, active: true, created_at: now };
      return fin(() => {
        out.logs.push({ content_id: '', task_id: '', event_type: 'theme_created', actor_email: I.email, actor_role_in_task: pos, from_status: '', to_status: '',
          reason: nm, at: now, source: 'miniapp', payload_json: JSON.stringify({ theme_id: tid }) });
        out.notify.push({ event: 'THEME', key: 'THEME|' + tid, text: '🎯 Director ตั้ง Theme ใหม่: ' + nm + (I.objective ? '\nเป้าหมาย: ' + I.objective : '') });
      });
    }
    case 'UPDATE_THEME': case 'SET_THEME_ACTIVE': case 'DELETE_THEME': {
      if (!(pos === POS.AM || isExecPos_(pos))) return reject('เฉพาะ CEO / COO / Director หรือ AM แก้ไข/ปิด/ลบ Theme ได้');
      const th = (ctx.themes || []).find(x => x.theme_id === I.themeId);
      if (!th) return reject('ไม่พบ Theme นี้');
      const lg = (event, reason) => out.logs.push({ content_id: '', task_id: '', event_type: event, actor_email: I.email, actor_role_in_task: pos, from_status: '', to_status: '',
        reason: reason, at: now, source: 'miniapp', payload_json: JSON.stringify({ theme_id: th.theme_id }) });
      if (I.action === 'DELETE_THEME') {
        const n = Number(ctx.themeContentCount || 0);
        if (n > 0) return reject('มีงานที่ยังไม่ยกเลิก ' + n + ' ชิ้นอยู่ใต้ Theme นี้ ลบไม่ได้ ให้ยกเลิกงานเหล่านั้นก่อน หรือ "ปิด Theme" แทน');
        out.themeDelete = { _row: th._row };
        return fin(() => lg('theme_deleted', th.name));
      }
      if (I.action === 'SET_THEME_ACTIVE') {
        const on = String(I.active) === 'true';
        out.themeUpdate = { _row: th._row, fields: { active: on } };
        return fin(() => lg(on ? 'theme_reopened' : 'theme_closed', th.name));
      }
      const nm = String(I.title || '').trim();
      if (!nm) return reject('ต้องใส่ชื่อ Theme');
      if ((ctx.themes || []).some(x => x.theme_id !== th.theme_id && String(x.name).trim().toLowerCase() === nm.toLowerCase())) return reject('มี Theme ชื่อนี้อยู่แล้ว');
      const sd = I.start ? parseDT(I.start + (String(I.start).length === 10 ? ' 00:00' : '')) : null;
      const ed = I.end ? parseDT(I.end + (String(I.end).length === 10 ? ' 00:00' : '')) : null;
      if (I.start && !sd) return reject('วันเริ่ม Theme ต้องเป็น YYYY-MM-DD');
      if (I.end && !ed) return reject('วันสิ้นสุด Theme ต้องเป็น YYYY-MM-DD');
      if (sd && ed && ed < sd) return reject('วันสิ้นสุดต้องไม่ก่อนวันเริ่ม');
      out.themeUpdate = { _row: th._row, fields: { name: nm, objective: I.objective || '', description: I.detail || '', start_date: sd || '', end_date: ed || '' },
        rename: nm !== th.name ? { id: th.theme_id, name: nm } : null };
      return fin(() => lg('theme_updated', th.name + (nm !== th.name ? ' → ' + nm : '')));
    }
    case 'CREATE': {
      if (!(isExecPos_(pos) || pos === POS.AM || pos === POS.CV)) return reject('เฉพาะ Content & Video (หรือ CEO/COO/Director/AM ผ่านปุ่มสร้างงาน) สร้างงานได้');
      if (!I.title) return reject('ต้องใส่ชื่อผลงาน');
      if (!TYPES.includes(I.type)) return reject('ประเภทงานต้องเป็น ' + TYPES.join('/'));
      if (I.funnel && !FUNNELS.includes(I.funnel)) return reject('Funnel ต้องเป็น ' + FUNNELS.join(' / '));
      let th = null;
      const want = String(I.themeId || I.theme || '').trim();
      if (!want) return reject('ต้องเลือก Theme');
      if (ctx.themes && ctx.themes.length) {
        th = ctx.themes.find(x => x.active !== false && (x.theme_id === want || String(x.name).trim() === want));
        if (!th) return reject('ไม่พบ Theme นี้ (หรือถูกปิดแล้ว) ให้ Director สร้าง Theme ก่อน');
      }
      let targets = Array.isArray(I.targets) ? I.targets.map(x => String(x).trim()).filter(Boolean) : [];
      if (!targets.length && I.channel) {
        targets = String(I.channelAccount || '').split('|').map(x => x.trim()).filter(Boolean).map(a => I.channel + '›' + a);
        if (!targets.length) targets = [I.channel + '›'];
      }
      if (!targets.length) return reject('ต้องเลือกช่องทางเผยแพร่และบัญชี/เพจ');
      const chSet = [], accSet = [];
      for (const tg of targets) {
        const [ch, ac] = tg.split('›').map(x => (x || '').trim());
        if (!ch) return reject('รูปแบบช่องทางไม่ถูกต้อง: ' + tg);
        if (ctx.channels && ctx.channels.length) {
          if (!ctx.channels.some(x => x.channel === ch)) return reject('ช่องทางเผยแพร่ต้องเป็นหนึ่งใน: ' + ctx.channels.map(x => x.channel).filter((v, k, a) => a.indexOf(v) === k).join(' / '));
          if (!ac) return reject('ต้องเลือกบัญชี/เพจที่จะลงของ ' + ch);
          if (!ctx.channels.some(x => x.channel === ch && x.account === ac)) return reject('ไม่พบบัญชี ' + ac + ' ในช่องทาง ' + ch);
        }
        if (chSet.indexOf(ch) < 0) chSet.push(ch);
        accSet.push(ac ? ch + ' › ' + ac : ch);
      }
      const pd = parseDT(I.planned);
      if (!pd) return reject('วันเผยแพร่ต้องเป็นรูปแบบ YYYY-MM-DD HH:mm');
      const cvOwner = pos === POS.CV ? actor : memberByPos(members, POS.CV);
      if (!cvOwner) return reject('ไม่พบ Content & Video ใน Team_Members');
      const seq = ctx.nextContentSeq;
      const nc = {
        content_id: 'CNT-' + now.getFullYear() + '-' + pad(seq, 4), title: I.title, content_type: I.type, channel: chSet.join(' + '),
        theme: th ? th.name : want, theme_id: th ? th.theme_id : '', pillar: '', objective: '', cta: '', reference_url: '', detail: I.detail || '',
        current_status: '', current_gate: '', current_owner_email: '', current_owner_name: '', current_started_at: '', current_due_at: '',
        is_waiting: false, creator_email: I.email, brief_current_id: '', planned_publish_at: pd, actual_publish_at: '', publish_url: '',
        final_approval_status: 'Pending', priority: I.priority || 'Normal', created_at: now, updated_at: now, funnel: I.funnel || '', channel_account: accSet.join(' | ')
      };
      out.content = nc; out.newContent = true;
      handoff(nc, ST.CD, cvOwner.email, addWorkDays(now, slaWd(cfg, 'CONTENT', I.type) || 3), '');
      log('created', '', ST.CD, 'Theme: ' + nc.theme);
      out.logs[out.logs.length - 1].content_id = nc.content_id;
      return fin(() => note('CREATED', msg('🆕', 'สร้างงานใหม่ใต้ Theme "' + nc.theme + '" โดย ' + actor.name + (cvOwner.email !== I.email ? '\nให้ ' + cvOwner.name + ' เขียน Brief' : ''))));
    }
    case 'START_CONTENT': {
      if (needC()) return reject(needC());
      if (!(pos === POS.AM || isExecPos_(pos))) return reject('เฉพาะ AM/CEO/COO/Director ส่งงานให้ Content ได้');
      if (c.current_status !== ST.TP) return reject('งานต้องอยู่ที่ ' + ST.TP + ' (ตอนนี้: ' + c.current_status + ')');
      const cv = memberByPos(members, POS.CV);
      if (!cv) return reject('ไม่พบ Content & Video ใน Team_Members');
      out.content = c; const from = c.current_status;
      handoff(c, ST.CD, cv.email, dueFrom('CONTENT', now), '');
      return fin(() => { log('status_changed', from, c.current_status, 'ส่งให้ Content คิดงาน'); note('ASSIGNED', msg('🆕', 'มอบหมายให้คิด Content: ' + cv.name)); });
    }
    case 'SUBMIT_BRIEF': {
      if (needC()) return reject(needC());
      const amSelf = pos === POS.AM;   // AM ทำ Brief เอง → ข้ามการตรวจ ไปสถานะ Brief Approved แล้วมอบหมายงานได้เลย
      if (pos !== POS.CV && !amSelf) return reject('เฉพาะ Content & Video หรือ AM ส่ง Brief ได้');
      if (c.current_status !== ST.CD && !(amSelf && c.current_status === ST.TP)) return reject('Brief ส่งได้เฉพาะตอนอยู่ ' + ST.CD + (amSelf ? ' หรือ ' + ST.TP : '') + ' (ตอนนี้: ' + c.current_status + ')');
      if (!isUrl(I.link)) return reject('ต้องแนบลิงก์ Brief (https://...)');
      if (!I.objective || !I.cta) return reject('ต้องใส่ Objective และ CTA');
      out.content = c; const from = c.current_status;
      const ver = (ctx.briefCount || 0) + 1;
      out.brief = { brief_id: c.content_id + '-B' + pad(ver, 2), content_id: c.content_id, version_no: ver, author_email: I.email,
        content_body: I.link, reference: I.reference || '', cta: I.cta, objective: I.objective, change_reason: I.reason || 'initial',
        changed_after_production_start: false, created_at: now, attachments: I.attachments || '' };
      c.objective = I.objective; c.cta = I.cta; c.reference_url = I.reference || c.reference_url; c.brief_current_id = out.brief.brief_id;
      if (amSelf) {
        handoff(c, ST.BA, I.email, null, '');
        return fin(() => { log('brief_submitted', from, ST.BA, 'AM ทำ Brief เอง v' + ver + ' (ข้ามการตรวจ)'); note('BRIEF_OK', msg('✅', 'AM ' + actor.name + ' ทำ Brief เอง (v' + ver + ') — พร้อมมอบหมายงานได้เลย')); });
      }
      const am = memberByPos(members, POS.AM);
      handoff(c, ST.BR, am.email, dueFrom('BRIEF_CHECK', now), '');
      return fin(() => { log('brief_submitted', from, c.current_status, 'Brief v' + ver); note('BRIEF', msg('📝', 'Brief พร้อมให้ AM ตรวจ (v' + ver + ')')); });
    }
    case 'ASSIGN': {
      if (needC()) return reject(needC());
      if (!I.taskId) t = null;
      const isSenior = [POS.SVE, POS.SG].includes(pos);
      if (I.taskId && !t) return reject('ไม่พบงานย่อยนี้');
      if (t) {
        const mineT = String(t.assignee_email).toLowerCase() === I.email;
        if (!(pos === POS.AM || isOwnerCV() || (isSenior && mineT))) return reject('เฉพาะ Content เจ้าของงาน / AM หรือ Senior ผู้ถืองานย่อยนี้ มอบหมายต่อได้');
        if (![ST.RFP, ST.IP, ST.RR].includes(t.status)) return reject('งานย่อยอยู่ในสถานะ ' + t.status + ' เปลี่ยนผู้ผลิตไม่ได้');
      } else {
        if (!(pos === POS.AM || isOwnerCV())) return reject('เฉพาะ Content เจ้าของงาน หรือ AM มอบหมายงานย่อยใหม่ได้');
        if (![ST.BA, ST.IP].includes(c.current_status)) return reject(c.current_status === ST.BR ? 'ต้องให้ AM อนุมัติ Brief ก่อนถึงจะมอบหมายได้' : 'มอบหมายงานย่อยใหม่ไม่ได้ในสถานะ ' + c.current_status);
      }
      const pr = memberByEmail(members, I.assignee);
      if (!pr || pr.active === false) return reject('ไม่พบผู้รับงานใน Team_Members');
      const lane = t ? laneOf(t) : (I.lane || FAMILY[c.content_type]);
      if (!LANES.includes(lane)) return reject('lane ต้องเป็น ' + LANES.join('/'));
      if (!canProduceLane(pr, lane)) return reject(pr.name + ' ไม่มีสิทธิ์ผลิตงานสาย ' + lane);
      if (!I.deadline) return reject('ต้องกำหนด Deadline ทุกครั้งที่มอบหมายงาน');
      const dl = parseDT(I.deadline);
      if (!dl) return reject('Deadline ต้องเป็นรูปแบบ YYYY-MM-DD HH:mm');
      if (dl.getTime() <= now.getTime()) return reject('Deadline ต้องเป็นเวลาในอนาคต');
      if (badEst(I.est_hours)) return reject('ชั่วโมงประเมินต้องเป็นตัวเลข 0.5-200');
      const estH = Number(I.est_hours) > 0 ? Number(I.est_hours) : (t && Number(t.estimated_hours) > 0 ? Number(t.estimated_hours) : estOf(''));
      const same = t && String(t.assignee_email).toLowerCase() === pr.email.toLowerCase();
      const wc = wipCheck(pr, same ? 0 : 1, same ? 0 : estH);   // มอบให้คนเดิมไม่นับเพิ่ม
      if (wc.err) return reject(wc.err);
      const ovList = wc.over ? [wc.text] : [];
      const coV = t ? { ok: true, list: [] } : vCo(I.co_reviewers, [pr.email.toLowerCase()]);
      if (coV.err) return reject(coV.err);
      out.content = c; const from = c.current_status;
      if (!t) {
        const label = String(I.label || '').trim();
        if (!label) return reject('ต้องตั้งชื่องานย่อย เช่น วิดีโอหลัก, ปก, ภาพประกอบ');
        const seq = c.content_id.split('-').pop();
        const n = tasks.reduce((m, x) => Math.max(m, parseInt(String(x.task_id).split('-').pop(), 10) || 0), 0) + 1;
        const nt = { task_id: 'TSK-' + seq + '-' + pad(n, 2), content_id: c.content_id, step_code: 'PRODUCTION', assignee_email: pr.email, role_in_task: pr.position, status: ST.RFP, gates_json: '', return_gate: '', attempt_no: 0, rev_count_producer: 0, rev_count_brief: 0, sla_start_at: now, sla_due_at: dl, started_at: '', first_submitted_at: '', first_on_time: '', submitted_at: '', done_at: '', wait_minutes: 0, wait_since: '', wait_reason: '', work_link: '', is_brief_change: false, label: label, assigned_by: I.email, parent_task_id: '', lane: lane, reviewer_email: '' };
        nt.estimated_hours = estH; nt.co_reviewers = coV.list.join(','); nt.co_approved = '';
        nt.is_required = !(I.optional === true || String(I.optional).toLowerCase() === 'true' || I.optional === 'ใช่');
        const dep = String(I.depends_on || '').trim();
        if (dep) { const dt = tasks.find(x => x.task_id === dep); if (!dt) return reject('ไม่พบงานที่ต้องรอ (' + dep + ') ใน Content นี้'); nt.depends_on = dep; }
        tasks.push(nt); out.task = nt; out.newTask = true;
        if (from === ST.BA) handoff(c, ST.IP, cvOf(c).email, dl, '');
        syncProd(c);
        return fin(() => { log('assigned', from, c.current_status, label + ' -> ' + pr.name + ' (Deadline ' + fmtD(dl) + ')'); out.logs[out.logs.length - 1].task_id = nt.task_id; logOverride(ovList, from, nt); note(urgentExtra() ? 'URGENT_EXTRA' : 'ASSIGNED', msg(urgentExtra() ? '🚨 งานเสริมด่วน' : '[สร้าง]', 'มอบหมายงานย่อย "' + label + '" ให้ ' + pr.name + '\nDeadline: ' + fmtD(dl) + (urgentExtra() ? '\nแจ้ง AM และ Director แล้ว' : '')), urgentRecipients([pr.email])); });
      }
      const oldA = t.assignee_email; upd(t);
      t.assignee_email = pr.email; t.role_in_task = pr.position; t.sla_due_at = dl; t.assigned_by = I.email; t.estimated_hours = estH;
      if (isSenior && !isOwnerCV() && pos !== POS.AM) t.parent_task_id = t.parent_task_id || t.task_id;
      if (t.status === ST.IP && t.started_at) { t.status = ST.RFP; t.started_at = ''; }
      syncProd(c);
      return fin(() => { log('reassigned', from, c.current_status, t.label + ': ' + oldA + ' -> ' + pr.email); out.logs[out.logs.length - 1].task_id = t.task_id; logOverride(ovList, from, t); note('REASSIGNED', msg('[เปลี่ยน]', 'งานย่อย "' + (t.label || '-') + '" มอบให้ ' + pr.name + '\nDeadline: ' + fmtD(dl)), [pr.email, oldA, memberByPos(members, POS.AM) && memberByPos(members, POS.AM).email].filter(Boolean)); });
    }

    case 'BATCH_ASSIGN': {
      if (needC()) return reject(needC());
      if (!(pos === POS.AM || isOwnerCV())) return reject('เฉพาะ Content เจ้าของงาน หรือ AM มอบหมายงานย่อยใหม่ได้');
      if (![ST.BA, ST.IP].includes(c.current_status)) return reject('มอบหมายงานย่อยใหม่ไม่ได้ในสถานะ ' + c.current_status);
      if (!Array.isArray(I.batch_tasks) || !I.batch_tasks.length) return reject('ไม่มีข้อมูลงานย่อยที่ต้องการมอบหมาย');
      if (I.batch_tasks.length > 10) return reject('มอบหมายพร้อมกันได้ครั้งละไม่เกิน 10 ชิ้น');

      const newTasks = [], queued = {}, queuedH = {}, ovList = [];
      for (const bt of I.batch_tasks) {
        const pr = memberByEmail(members, bt.assignee);
        if (!pr || pr.active === false) return reject('ไม่พบผู้รับงาน ' + bt.assignee + ' ใน Team_Members');
        const lane = bt.lane || FAMILY[c.content_type];
        if (!LANES.includes(lane)) return reject('lane ต้องเป็น ' + LANES.join('/'));
        if (!canProduceLane(pr, lane)) return reject(pr.name + ' ไม่มีสิทธิ์ผลิตงานสาย ' + lane);
        if (!bt.deadline) return reject('ต้องกำหนด Deadline ทุกครั้ง');
        const dl = parseDT(bt.deadline);
        if (!dl) return reject('Deadline ต้องเป็นรูปแบบ YYYY-MM-DD HH:mm');
        if (dl.getTime() <= now.getTime()) return reject('Deadline ต้องเป็นเวลาในอนาคต');
        if (!bt.label) return reject('ต้องตั้งชื่องานย่อย');
        const coB = vCo(bt.co_reviewers, [pr.email.toLowerCase()]); if (coB.err) return reject(coB.err);
        const ek = pr.email.toLowerCase(); queued[ek] = (queued[ek] || 0) + 1;
        if (badEst(bt.est_hours)) return reject('ชั่วโมงประเมินต้องเป็นตัวเลข 0.5-200');
        const est = estOf(bt.est_hours); queuedH[ek] = (queuedH[ek] || 0) + est;
        const wc = wipCheck(pr, queued[ek], queuedH[ek]);   // นับชิ้น/ชั่วโมงที่เพิ่งคิวไว้ใน Batch เดียวกันด้วย
        if (wc.err) return reject(wc.err);
        if (wc.over) ovList.push(wc.text);
        newTasks.push({ pr: pr, lane: lane, dl: dl, bt: bt, est: est, co: coB.list });
      }

      out.content = c; const from = c.current_status;
      let minDue = null;

      const labelSeen = {};
      for (const item of newTasks) {
        const seq = c.content_id.split('-').pop();
        const n = tasks.reduce((m, x) => Math.max(m, parseInt(String(x.task_id).split('-').pop(), 10) || 0), 0) + 1;
        const nt = { task_id: 'TSK-' + seq + '-' + pad(n, 2), content_id: c.content_id, step_code: 'PRODUCTION', assignee_email: item.pr.email, role_in_task: item.pr.position, status: ST.RFP, gates_json: '', return_gate: '', attempt_no: 0, rev_count_producer: 0, rev_count_brief: 0, sla_start_at: now, sla_due_at: item.dl, started_at: '', first_submitted_at: '', first_on_time: '', submitted_at: '', done_at: '', wait_minutes: 0, wait_since: '', wait_reason: '', work_link: '', is_brief_change: false, label: item.bt.label, assigned_by: I.email, parent_task_id: '', lane: item.lane, reviewer_email: '' };
        
        nt.estimated_hours = item.est;
        nt.is_required = !(item.bt.optional === true || String(item.bt.optional).toLowerCase() === 'true');
        const dl2 = String(item.bt.depends_label || '').trim();
        if (dl2) { const dt = tasks.find(x => String(x.label || '').trim() === dl2); if (!dt) return reject('ไม่พบงานที่ต้องรอชื่อ "' + dl2 + '" (ต้องเป็นชิ้นที่มีอยู่แล้ว หรืออยู่ก่อนหน้าในรายการนี้)'); nt.depends_on = dt.task_id; }
        labelSeen[String(item.bt.label).trim()] = nt.task_id;
        nt.co_reviewers = (item.co || []).join(','); nt.co_approved = '';
        tasks.push(nt); out.task = nt; out.newTask = true; out.newTasks.push(nt);   // เก็บทุกชิ้น (เดิมเก็บแค่ชิ้นสุดท้าย)
        if (!minDue || item.dl.getTime() < minDue.getTime()) minDue = item.dl;

        note((item.bt.optional === true || String(item.bt.optional).toLowerCase() === 'true') && (String(I.priority || '').toLowerCase() === 'urgent' || String(I.priority || '').toLowerCase() === 'ด่วน') ? 'URGENT_EXTRA' : 'ASSIGNED', msg((item.bt.optional === true || String(item.bt.optional).toLowerCase() === 'true') && (String(I.priority || '').toLowerCase() === 'urgent' || String(I.priority || '').toLowerCase() === 'ด่วน') ? '🚨 งานเสริมด่วน' : '[งานใหม่]', 'มอบหมายงานย่อย "' + item.bt.label + '" ให้ ' + item.pr.name + '\nDeadline: ' + fmtD(item.dl)), urgentRecipients([item.pr.email].concat((item.bt.optional === true || String(item.bt.optional).toLowerCase() === 'true') && (String(I.priority || '').toLowerCase() === 'urgent' || String(I.priority || '').toLowerCase() === 'ด่วน') ? [memberByPos(members, POS.AM) && memberByPos(members, POS.AM).email, memberByPos(members, POS.DIR) && memberByPos(members, POS.DIR).email] : [])));
      }

      if (from === ST.BA) handoff(c, ST.IP, cvOf(c).email, minDue, '');
      syncProd(c);
      log('batch_assigned', from, c.current_status, 'มอบหมายงานย่อย ' + newTasks.length + ' ชิ้น');
      logOverride(ovList.filter((x, i, a) => a.indexOf(x) === i), from, null);
      return fin();
    }

    case 'SET_DELIVERABLE': {   // แก้ "บังคับ/เสริม" และ Dependency หลังมอบหมาย (AM หรือ Content เจ้าของงาน)
      if (needC()) return reject(needC());
      if (!(pos === POS.AM || isOwnerCV())) return reject('เฉพาะ AM หรือ Content เจ้าของงานแก้ได้');
      if (!t) return reject('ไม่พบงานย่อยนี้');
      if (t.status === 'Passed') return reject('งานย่อยที่ผ่านแล้วแก้ไม่ได้');
      const dep = String(I.depends_on || '').trim();
      if (dep) {
        if (dep === t.task_id) return reject('งานย่อยรอตัวเองไม่ได้');
        if (!tasks.find(x => x.task_id === dep)) return reject('ไม่พบงานที่ต้องรอ (' + dep + ')');
        let cur = dep, hops = 0;   // กันวงจร: ไล่ตามสายที่งานนั้นรออยู่ ถ้าวนกลับมาที่ t = วงจร
        while (cur && hops++ < 20) { const x = tasks.find(y => y.task_id === cur); const nx = x ? String(x.depends_on || '').split(',')[0].trim() : ''; if (nx === t.task_id) return reject('Dependency วนกันเอง (ต่างฝ่ายต่างรอกัน)'); cur = nx; }
      }
      const optional = I.optional === true || String(I.optional).toLowerCase() === 'true';
      out.content = c; upd(t); t.is_required = !optional; t.depends_on = dep;
      return fin(() => { log('deliverable_changed', c.current_status, c.current_status, (t.label || t.task_id) + ': ' + (optional ? 'งานเสริม' : 'งานบังคับ') + (dep ? ', รอ ' + dep : ', ไม่มี Dependency') + (I.reason ? ' — ' + I.reason : '')); out.logs[out.logs.length - 1].task_id = t.task_id;
        if ([ST.IP, ST.BA].includes(c.current_status) && tasks.some(x => x.status === 'Passed')) afterTaskPassed(); });   // เปลี่ยนเป็นงานเสริมแล้วอาจครบเงื่อนไขเข้าด่านตรวจ
    }

    case 'SPLIT_TASK': {   // ข้อ 11: งานชิ้นเดียวแบ่งกันทำหลายคน (เช่น คลิปเดียวตัดกัน 2 คน) — ผู้ถืองานแบ่งส่วนให้คนอื่นเองโดยไม่ผ่าน Content, เก็บประวัติ, ผู้ถือเดิมยังถืองานของตัวเองต่อ
      if (needC()) return reject(needC());
      if (!t) return reject('ไม่พบงานย่อยนี้');
      const mineS = String(t.assignee_email).toLowerCase() === I.email;
      if (!(mineS || pos === POS.AM || isOwnerCV())) return reject('เฉพาะผู้ถืองานนี้ / Content เจ้าของงาน / AM แบ่งงานได้');
      if (![ST.RFP, ST.IP, ST.RR].includes(t.status)) return reject('แบ่งงานได้เฉพาะตอนที่ยังไม่ส่งตรวจ (ตอนนี้: ' + t.status + ')');
      const ps = memberByEmail(members, I.assignee);
      if (!ps || ps.active === false) return reject('ไม่พบผู้รับงานใน Team_Members');
      if (String(ps.email).toLowerCase() === String(t.assignee_email).toLowerCase()) return reject('แบ่งงานให้ผู้ถืองานเดิมไม่ได้ (เลือกคนอื่น)');
      if (tasks.some(x => x.parent_task_id === (t.parent_task_id || t.task_id) && String(x.assignee_email).toLowerCase() === ps.email.toLowerCase() && x.status !== 'Passed' && laneOf(x) === laneOf(t))) return reject(ps.name + ' ถือส่วนของงานนี้อยู่แล้ว');
      if (!canProduceLane(ps, laneOf(t))) return reject(ps.name + ' ไม่มีสิทธิ์ผลิตงานสาย ' + laneOf(t));
      const dlS = parseDT(I.deadline);
      if (!dlS || dlS.getTime() <= now.getTime()) return reject('ต้องกำหนด Deadline ของส่วนที่แบ่ง (เวลาในอนาคต)');
      if (badEst(I.est_hours)) return reject('ชั่วโมงประเมินต้องเป็นตัวเลข 0.5-200');
      const estS = Number(I.est_hours) > 0 ? Number(I.est_hours) : estOf('');
      if (!I.reason) return reject('ต้องระบุว่าแบ่งส่วนไหนให้ (เช่น ตัดช่วงนาทีที่ 5-10)');
      const wcS = wipCheck(ps, 1, estS);
      if (wcS.err || wcS.over) return reject((wcS.err || '') + (wcS.over ? ps.name + ' เกิน WIP/Capacity: ' : '') + ' แบ่งงานไม่ได้ ให้ AM มอบหมายใหม่พร้อม Override');
      out.content = c; const fromS = c.current_status;
      const rootId = t.parent_task_id || t.task_id;
      const seqS = c.content_id.split('-').pop();
      const nS = tasks.reduce((m, x) => Math.max(m, parseInt(String(x.task_id).split('-').pop(), 10) || 0), 0) + 1;
      const nt = Object.assign({}, t);
      delete nt._row;
      Object.assign(nt, { task_id: 'TSK-' + seqS + '-' + pad(nS, 2), assignee_email: ps.email, role_in_task: ps.position, status: ST.RFP, return_gate: '', attempt_no: 0, rev_count_producer: 0, rev_count_brief: 0,
        sla_start_at: now, sla_due_at: dlS, started_at: '', first_submitted_at: '', first_on_time: '', first_margin_h: '', submitted_at: '', done_at: '', work_link: '', reviewer_email: '', review_started_at: '', wait_since: '', wait_minutes: 0, wait_reason: '',
        delegated_by: '', parent_task_id: rootId, assigned_by: I.email, estimated_hours: estS, is_required: true, depends_on: '', label: String(I.label || '').trim() || ((t.label || 'งาน') + ' (ส่วนของ ' + ps.name + ')') });
      tasks.push(nt); out.task = nt; out.newTask = true;
      out.audit.push({ sheet: 'Task_Delegations', row: { delegation_id: 'DLG-' + Utilities.getUuid().slice(0, 8), parent_task_id: rootId, delegated_task_id: nt.task_id, delegated_by: t.assignee_email, delegated_to: ps.email, instruction: String(I.reason).slice(0, 500), reason: 'split', deadline: dlS, status: 'Split', created_at: now, returned_at: '' } });
      syncProd(c);
      return fin(() => {
        log('task_split', fromS, c.current_status, (t.label || '-') + ': ' + t.assignee_email + ' แบ่งให้ ' + ps.email + ' — ' + I.reason, { task: nt.task_id });
        out.logs[out.logs.length - 1].task_id = nt.task_id;
        note('SPLIT', msg('[แบ่งงาน]', 'คุณได้รับส่วนหนึ่งของงาน "' + (t.label || '-') + '" จาก ' + nameOf(t.assignee_email) + '\nรายละเอียด: ' + I.reason + '\nDeadline: ' + fmtD(dlS)), [ps.email, (memberByPos(members, POS.AM) || {}).email].filter(Boolean));
      });
    }
    case 'DELEGATE': {
      if (needC()) return reject(needC());
      if (!t || t.assignee_email.toLowerCase() !== I.email) return reject('เฉพาะผู้ที่ถูกมอบหมายงานนี้เท่านั้นที่ส่งต่อให้คนอื่นได้');
      if (![ST.RFP, ST.IP, ST.RR].includes(t.status)) return reject('ส่งต่องานได้เฉพาะตอนที่ยังไม่ส่งตรวจ');
      
      const pr = memberByEmail(members, I.assignee);
      if (!pr || pr.active === false) return reject('ไม่พบผู้รับงานใน Team_Members');
      if (pr.email.toLowerCase() === I.email) return reject('ส่งต่องานให้ตัวเองไม่ได้');
      if (!canProduceLane(pr, laneOf(t))) return reject(pr.name + ' ไม่มีสิทธิ์ผลิตงานสาย ' + laneOf(t));
      if (!I.deadline) return reject('ต้องกำหนด Deadline ใหม่');
      const dl = parseDT(I.deadline);
      if (!dl || dl.getTime() <= now.getTime()) return reject('Deadline ไม่ถูกต้อง');
      const wcD = wipCheck(pr, 1, taskHours_(t, cfg, c.content_type));   // คนรับต้องไม่เกิน WIP/Capacity (ถ้าเกินให้ AM มอบหมายใหม่พร้อม Override)
      if (wcD.err || wcD.over) return reject((wcD.err || '') + (wcD.over ? pr.name + ' เกิน WIP/Capacity: ' : '') + ' ส่งต่อไม่ได้ ให้ AM มอบหมายใหม่ผ่านปุ่ม "มอบต่อ / เปลี่ยนผู้ผลิต"');
      out.content = c; upd(t); const from = c.current_status;
      const oldA = t.assignee_email;
      
      t.assignee_email = pr.email; 
      t.role_in_task = pr.position; 
      t.sla_due_at = dl; 
      t.assigned_by = I.email; 
      t.parent_task_id = t.parent_task_id || t.task_id; 
      t.delegated_by = (t.delegated_by ? t.delegated_by + ',' : '') + oldA;   // ผู้ส่งต่อห้ามเป็นผู้ตรวจงานชิ้นนี้ (ดู subReviewer)
      out.audit.push({ sheet: 'Task_Delegations', row: { delegation_id: 'DLG-' + Utilities.getUuid().slice(0, 8), parent_task_id: t.parent_task_id, delegated_task_id: t.task_id, delegated_by: oldA, delegated_to: pr.email, instruction: '', reason: I.reason || '', deadline: dl, status: 'Active', created_at: now, returned_at: '' } });

      syncProd(c);
      return fin(() => { 
        log('delegated', from, c.current_status, t.label + ': ' + oldA + ' -> ' + pr.email, { reason: I.reason }); 
        out.logs[out.logs.length - 1].task_id = t.task_id;
        note('DELEGATED', msg('[ส่งต่อ]', 'ผู้รับงานเดิมส่งต่องาน "' + (t.label || '-') + '" ให้ ' + pr.name + '\nเหตุผล: ' + (I.reason || '-') + '\nDeadline: ' + fmtD(dl)), [pr.email, oldA, (memberByPos(members, POS.AM) || {}).email].filter(Boolean)); 
      });
    }
    case 'START': {
      if (needC()) return reject(needC());
      if (!t || t.assignee_email.toLowerCase() !== I.email) return reject('เฉพาะผู้ผลิตที่ถูกมอบหมายกดเริ่มได้');
      if (t.status !== ST.RFP) return reject('เริ่มงานได้เฉพาะงานย่อยที่ยังไม่เริ่ม (สถานะ ' + t.status + ')');
      const waitDeps = String(t.depends_on || '').split(',').map(x => x.trim()).filter(Boolean).map(id => tasks.find(x => x.task_id === id)).filter(d => d && d.status !== 'Passed');
      if (waitDeps.length) return reject('เริ่มงานไม่ได้: ต้องรอ ' + waitDeps.map(d => '"' + (d.label || d.task_id) + '" (' + nameOf(d.assignee_email) + ', สถานะ ' + d.status + ')').join(', ') + ' ผ่านก่อน');
      out.content = c; upd(t); c.updated_at = now;
      t.status = ST.IP; t.started_at = now;
      return fin(() => log('started', c.current_status, c.current_status, t.label || ''));
    }
    case 'PAUSE': {
      if (needC()) return reject(needC());
      if (!t) return reject('ต้องระบุงานย่อย');
      if (!(pos === POS.AM || isOwnerCV())) return reject('เฉพาะ Content เจ้าของงาน หรือ AM หยุดเวลาได้ (ผู้ผลิตให้แจ้ง Content/AM)');
      if (![ST.RFP, ST.IP, ST.RR].includes(t.status)) return reject('หยุดเวลาได้เฉพาะตอนผู้ผลิตถืองาน');
      if (t.wait_since) return reject('งานย่อยนี้หยุดเวลาอยู่แล้ว');
      if (!I.reason) return reject('ต้องระบุว่ารอข้อมูลอะไรจากใคร');
      out.content = c; upd(t); t.wait_since = now; t.wait_reason = I.reason; c.updated_at = now;
      return fin(() => { log('paused', c.current_status, c.current_status, I.reason); note('PAUSE', msg('⏸', 'หยุดนับ SLA งานย่อย "' + (t.label || '-') + '": ' + I.reason)); });
    }
    case 'RESUME': {
      if (needC()) return reject(needC());
      if (!t || !t.wait_since) return reject('งานย่อยนี้ไม่ได้หยุดเวลาอยู่');
      if (!(pos === POS.AM || isOwnerCV())) return reject('เฉพาะ Content เจ้าของงาน หรือ AM เริ่มนับเวลาต่อได้');
      out.content = c; upd(t);
      const waited = Math.max(0, now.getTime() - new Date(t.wait_since).getTime());
      t.wait_minutes = Number(t.wait_minutes || 0) + Math.round(waited / 60000);
      if (t.sla_due_at) t.sla_due_at = new Date(new Date(t.sla_due_at).getTime() + waited);
      t.wait_since = ''; syncProd(c);
      return fin(() => { log('resumed', c.current_status, c.current_status, 'รอไป ' + Math.round(waited / 60000) + ' นาที'); note('RESUME', msg('▶️', 'นับเวลาต่อ งานย่อย "' + (t.label || '-') + '"')); });
    }
    case 'SUBMIT_WORK': {
      if (needC()) return reject(needC());
      if (!t || t.assignee_email.toLowerCase() !== I.email) return reject('เฉพาะผู้ผลิตที่ถูกมอบหมายส่งงานได้');
      if (![ST.IP, ST.RR].includes(t.status)) return reject('ส่งงานได้เฉพาะงานย่อยที่อยู่ ' + ST.IP + ' หรือ ' + ST.RR + ' (ตอนนี้: ' + t.status + ')');
      if (t.wait_since) return reject('งานหยุดเวลาอยู่ ให้ RESUME ก่อนส่ง');
      const wfiles = Array.isArray(I.work_files) ? I.work_files : [];
      if (!isUrl(I.link) && !wfiles.length) return reject('ต้องแนบลิงก์ไฟล์/Preview (https://...) หรืออัปโหลดรูป/คลิปอย่างน้อย 1 ไฟล์');
      out.content = c; upd(t); const from = c.current_status;
      const first = !t.first_submitted_at;
      t.attempt_no = Number(t.attempt_no || 0) + 1; t.submitted_at = now; t.work_link = I.link || ''; t.review_started_at = ''; t.co_approved = '';
      out.audit.push({ sheet: 'Task_Submissions', op: 'submit', task_id: t.task_id, row: { submission_id: 'SUB-' + Utilities.getUuid().slice(0, 8), task_id: t.task_id, version_no: t.attempt_no, submitted_by: I.email, submitted_at: now, media_type: laneOf(t), file_url: I.link || '', file_name: '', submission_status: 'Current', client_submission_id: '' } });
      wfiles.forEach(f => out.audit.push({ sheet: 'Task_Submissions', op: 'file', task_id: t.task_id, row: { submission_id: 'SUB-' + Utilities.getUuid().slice(0, 8), task_id: t.task_id, version_no: t.attempt_no, submitted_by: I.email, submitted_at: now, media_type: f.kind, file_url: f.path, file_name: f.name, submission_status: 'Current', client_submission_id: '' } }));
      if (first) { t.first_submitted_at = now; t.first_on_time = t.sla_due_at ? (now.getTime() <= new Date(t.sla_due_at).getTime()) : ''; t.first_margin_h = t.sla_due_at ? Math.round((new Date(t.sla_due_at).getTime() - now.getTime()) / 36e3) / 100 : ''; }   // เหลือเวลาอีกกี่ชม. ตอนส่งครั้งแรก (ใช้คิดดาว)
      let rv = subReviewer(t, actor);
      if (!rv && !isAMp(actor.email) && coList_(t.co_reviewers).length) { const cl0 = coList_(t.co_reviewers); rv = memberByEmail(members, cl0[0]); t.co_reviewers = cl0.slice(1).join(','); }   // ไม่มี Senior แต่มีผู้ตรวจร่วม → คนแรกเป็นผู้ตรวจหลัก
      if (!rv) {
        t.status = 'Passed'; t.done_at = now; t.reviewer_email = '';
        return fin(() => { log('work_submitted', from, c.current_status, (t.label || '') + ' ครั้งที่ ' + t.attempt_no, { link: I.link, task: t.task_id }); afterTaskPassed(); });
      }
      const w = slaWd(cfg, laneOf(t) === 'Video' ? 'REV_SR_VIDEO' : 'REV_SR_GRAPHIC', c.content_type);
      t.status = ST.SR; t.reviewer_email = rv.email; t.sla_due_at = addWorkDays(now, w === null ? 1 : w);
      syncProd(c);
      return fin(() => {
        log('work_submitted', from, c.current_status, (t.label || '') + ' ครั้งที่ ' + t.attempt_no, { link: I.link, task: t.task_id, reviewer: rv.email });
        out.logs[out.logs.length - 1].task_id = t.task_id;
        if (rv.position === POS.CV) log('senior_review_skipped', from, c.current_status, 'Senior ผลิตเอง/ไม่มี Senior ให้ Content ตรวจแทน', null);
        note('SUBMITTED', msg('📥', 'งานย่อย "' + (t.label || '-') + '" รอ ' + [rv.name].concat(coList_(t.co_reviewers).map(nameOf)).join(' + ') + ' ตรวจ (ส่งครั้งที่ ' + t.attempt_no + ')'), [rv.email, t.assignee_email].concat(coList_(t.co_reviewers)));
      });
    }
    case 'WITHDRAW_WORK': {
      if (needC()) return reject(needC());
      if (!t || t.assignee_email.toLowerCase() !== I.email) return reject('เฉพาะผู้ผลิตที่ถูกมอบหมายดึงงานกลับได้');
      if (t.status !== ST.SR) return reject('ดึงงานกลับได้เฉพาะตอนที่อยู่ระหว่างรอตรวจ (สถานะ Submitted for Review) เท่านั้น');
      if (t.review_started_at || coList_(t.co_approved).length) return reject('ผู้ตรวจเริ่มตรวจงานนี้แล้ว ดึงกลับไม่ได้ (ให้รอผลตรวจ แล้วแก้ตามที่ส่งกลับ)');
      if (!I.reason) return reject('ต้องระบุเหตุผลที่ดึงงานกลับ');
      out.content = c; upd(t); const from = c.current_status;
      t.status = ST.IP; t.reviewer_email = ''; t.submitted_at = ''; 
      out.audit.push({ sheet: 'Task_Submissions', op: 'withdraw', task_id: t.task_id });
      syncProd(c);
      return fin(() => { 
        log('work_withdrawn', from, c.current_status, I.reason, { task: t.task_id }); 
        out.logs[out.logs.length - 1].task_id = t.task_id;
        note('WITHDRAWN', msg('🔄', 'ผู้ผลิตดึงงาน "' + (t.label || '-') + '" กลับมาแก้ก่อนตรวจ\nเหตุผล: ' + I.reason), [(memberByPos(members, POS.AM) || {}).email].filter(Boolean)); 
      });
    }
    case 'WITHDRAW_GATE': {   // ข้อ 7: ดึงงานกลับมาแก้ ขณะรอผู้ตรวจด่านรวม (Content/AM/CEO/COO/Director) เปิดตรวจ — ผู้ผลิตหรือ Content เจ้าของงาน
      if (needC()) return reject(needC());
      if (![ST.CR, ST.AMR, ST.FA].includes(c.current_status)) return reject('ดึงกลับได้เฉพาะตอนงานรออยู่ในด่านตรวจ (ตอนนี้: ' + c.current_status + ')');
      if (c.review_started_at || coList_(c.gate_co_approved).length) return reject('ผู้ตรวจเริ่มตรวจแล้ว ดึงกลับไม่ได้ (รอผลตรวจแล้วแก้ตามที่ส่งกลับ)');
      if (!I.reason) return reject('ต้องระบุเหตุผลที่ดึงงานกลับ');
      const owner = cvOf(c), isOwner = owner && String(owner.email).toLowerCase() === I.email;
      const mineT = tasks.filter(x => String(x.assignee_email).toLowerCase() === I.email);
      if (!isOwner && !mineT.length) return reject('เฉพาะผู้ผลิตหรือ Content เจ้าของงานดึงกลับได้');
      const picked = String(I.returnTasks || '').split(/[,|]/).map(x => x.trim()).filter(Boolean);
      const back = isOwner ? (picked.length ? tasks.filter(x => picked.indexOf(x.task_id) >= 0) : tasks.slice()) : mineT;
      if (!back.length) return reject('ไม่พบงานย่อยที่จะดึงกลับ');
      out.content = c; const from = c.current_status, gateCode = c.current_gate, gateLabel = (GATES[gateCode] || {}).label || gateCode;
      const prevOwner = c.current_owner_email, due = addWorkDays(now, slaWd(cfg, 'REVISION', c.content_type));
      back.forEach(x => { upd(x); x.status = ST.RR; x.sla_due_at = due; x.return_gate = gateCode; x.submitted_at = ''; });
      handoff(c, ST.IP, owner.email, due, '');
      syncProd(c);
      return fin(() => {
        log('work_withdrawn', from, c.current_status, I.reason, { gate: gateCode, tasks: back.map(x => x.task_id) });
        note('WITHDRAWN', msg('🔄', 'ดึงงานกลับจาก ' + gateLabel + ' เพื่อแก้ก่อนตรวจ: ' + back.map(x => x.label || x.task_id).join(', ') + '\nเหตุผล: ' + I.reason), [prevOwner].filter(Boolean));
      });
    }
    case 'ADD_REVIEWER': case 'REMOVE_REVIEWER': {   // เพิ่ม/ถอดผู้ตรวจร่วม (ต้องอนุมัติครบทุกคน)
      if (needC()) return reject(needC());
      const addR = I.action === 'ADD_REVIEWER', who = memberByEmail(members, I.assignee);
      if (!who || who.active === false) return reject('ต้องเลือกผู้ตรวจ');
      const wE = who.email.toLowerCase(); out.content = c;
      if (I.taskId) {
        if (!t) return reject('ไม่พบงานย่อยนี้');
        if (['Passed', 'Cancelled'].includes(t.status)) return reject('งานย่อยนี้ผ่านแล้ว แก้ผู้ตรวจไม่ได้');
        if (!((pos === POS.AM || isExecPos_(pos)) || isRevT_(t, I.email) || isOwnerCV() || String(t.assigned_by).toLowerCase() === I.email)) return reject('เฉพาะ AM/CEO/COO/Director ผู้ตรวจ Content เจ้าของงาน หรือผู้มอบหมายงานนี้');
        const cur = coList_(t.co_reviewers);
        if (addR) {
          const v = vCo(wE, [String(t.assignee_email).toLowerCase()]); if (v.err) return reject(v.err);
          if (wE === String(t.reviewer_email).toLowerCase() || cur.indexOf(wE) >= 0) return reject(who.name + ' เป็นผู้ตรวจงานนี้อยู่แล้ว');
          cur.push(wE);
        } else {
          if (cur.indexOf(wE) < 0) return reject(who.name + ' ไม่ใช่ผู้ตรวจร่วม (ถ้าจะเปลี่ยนผู้ตรวจหลักให้ใช้ "โอนผู้ตรวจ")');
          cur.splice(cur.indexOf(wE), 1);
        }
        upd(t); t.co_reviewers = cur.join(',');
        if (!addR) t.co_approved = coList_(t.co_approved).filter(x => x !== wE).join(',');
        const allDone = !addR && t.status === ST.SR && !pendRev_(t.reviewer_email, t.co_reviewers, t.co_approved).length;
        return fin(() => { log(addR ? 'reviewer_added' : 'reviewer_removed', c.current_status, c.current_status, (addR ? 'เพิ่ม ' : 'ถอด ') + who.name + ' เป็นผู้ตรวจร่วม งาน "' + (t.label || '') + '"', { task: t.task_id, reviewer: wE });
          out.logs[out.logs.length - 1].task_id = t.task_id;
          note('REVIEWER_CHG', msg(addR ? '➕' : '➖', (addR ? 'เพิ่ม ' : 'ถอด ') + who.name + ' เป็นผู้ตรวจร่วม งานย่อย "' + (t.label || '-') + '"' + (allDone ? '\nผู้ตรวจที่เหลืออนุมัติครบแล้ว ให้กดอนุมัติอีกครั้งเพื่อปิดการตรวจ' : '')), [wE, t.reviewer_email, t.assignee_email]); });
      }
      if (![ST.CR, ST.AMR].includes(c.current_status) || !GATES[c.current_gate] || c.current_gate === 'FINAL') return reject('เพิ่มผู้ตรวจร่วมระดับงานรวมได้เฉพาะด่าน Content/AM (งานย่อยเลือกชิ้นที่ต้องการ)');
      if (!((pos === POS.AM || isExecPos_(pos)) || isRevC_(c, I.email) || isOwnerCV())) return reject('เฉพาะ AM/CEO/COO/Director ผู้ตรวจด่านนี้ หรือ Content เจ้าของงาน');
      const curC = coList_(c.gate_co_reviewers);
      if (addR) {
        const v = vCo(wE, tasks.map(x => String(x.assignee_email).toLowerCase())); if (v.err) return reject(v.err);
        if (wE === String(c.current_owner_email).toLowerCase() || curC.indexOf(wE) >= 0) return reject(who.name + ' เป็นผู้ตรวจด่านนี้อยู่แล้ว');
        curC.push(wE);
      } else {
        if (curC.indexOf(wE) < 0) return reject(who.name + ' ไม่ใช่ผู้ตรวจร่วมของด่านนี้');
        curC.splice(curC.indexOf(wE), 1);
      }
      c.gate_co_reviewers = curC.join(','); c.updated_at = now;
      if (!addR) c.gate_co_approved = coList_(c.gate_co_approved).filter(x => x !== wE).join(',');
      return fin(() => { log(addR ? 'reviewer_added' : 'reviewer_removed', c.current_status, c.current_status, (addR ? 'เพิ่ม ' : 'ถอด ') + who.name + ' เป็นผู้ตรวจร่วม ' + GATES[c.current_gate].label, { gate: c.current_gate, reviewer: wE });
        note('REVIEWER_CHG', msg(addR ? '➕' : '➖', (addR ? 'เพิ่ม ' : 'ถอด ') + who.name + ' เป็นผู้ตรวจร่วม ' + GATES[c.current_gate].label), [wE, c.current_owner_email]); });
    }
    case 'START_REVIEW': {   // ผู้ตรวจเปิดฟอร์มตรวจ → บันทึก opened_at (แยกเวลารอคิว/เวลาตรวจ) และล็อกไม่ให้ผู้ผลิตดึงงานกลับ
      if (needC()) return reject(needC());
      out.content = c;
      if (I.taskId) {
        if (!t || t.status !== ST.SR) return reject('งานย่อยนี้ไม่ได้อยู่ระหว่างรอตรวจ');
        if (!isRevT_(t, I.email)) return reject('เฉพาะผู้ตรวจของงานนี้');
        if (!t.review_started_at) { upd(t); t.review_started_at = now; return fin(() => { log('review_started', c.current_status, c.current_status, t.label || '', { task: t.task_id }); out.logs[out.logs.length - 1].task_id = t.task_id; }); }
        return fin();
      }
      if (![ST.CR, ST.AMR, ST.FA].includes(c.current_status)) return reject('งานนี้ไม่ได้อยู่ในด่านตรวจ');
      if (!isRevC_(c, I.email)) return reject('เฉพาะผู้ตรวจของด่านนี้');
      if (!c.review_started_at) { c.review_started_at = now; c.updated_at = now; return fin(() => { log('review_started', c.current_status, c.current_status, c.current_gate || '', { gate: c.current_gate }); }); }
      return fin();
    }
    case 'TRANSFER_REVIEW': {   // R3: โอนผู้ตรวจ (ไม่ใช่ระบบเลือกให้เอง) เก็บประวัติ ผู้ตรวจเก่า → ใหม่
      if (needC()) return reject(needC());
      const to = memberByEmail(members, I.assignee), why = String(I.reason || '').trim();
      if (!to || to.active === false) return reject('ต้องเลือกผู้ตรวจคนใหม่');
      if (why.length < 3) return reject('ต้องระบุเหตุผลที่โอนผู้ตรวจ');
      const isMgrA = (pos === POS.AM || isExecPos_(pos)), toE = to.email.toLowerCase();
      let curE, producers, gateCode;
      if (I.taskId) {
        if (!t || t.status !== ST.SR) return reject('งานย่อยนี้ไม่ได้อยู่ระหว่างรอตรวจ');
        curE = String(t.reviewer_email).toLowerCase(); producers = [String(t.assignee_email).toLowerCase()]; gateCode = 'SR';
        if ((RANK[to.position] || 0) < 1) return reject('ผู้ตรวจคนใหม่ต้องเป็นระดับ Senior ขึ้นไป');
      } else {
        if (![ST.CR, ST.AMR].includes(c.current_status) || !GATES[c.current_gate] || c.current_gate === 'FINAL') return reject('โอนได้เฉพาะงานรวมที่อยู่ด่านตรวจเนื้อหา/AM (ด่าน Final ให้ Director)');
        curE = String(c.current_owner_email).toLowerCase(); producers = tasks.map(x => String(x.assignee_email).toLowerCase()); gateCode = c.current_gate;
        if (!(to.position === GATES[gateCode].pos || (to.position === POS.AM || isExecPos_(to.position)))) return reject('ผู้ตรวจคนใหม่ต้องเป็นตำแหน่งที่ด่านนี้กำหนด');
        if (to.position === POS.CV && cvOf(c) && cvOf(c).email.toLowerCase() !== toE) return reject('Content ตรวจได้เฉพาะงานของตัวเอง');
      }
      if (toE === curE) return reject('คนนี้เป็นผู้ตรวจอยู่แล้ว');
      if (producers.indexOf(toE) >= 0) return reject('ห้ามโอนให้ผู้ที่ผลิตงานชิ้นนี้');
      const backup = String((memberByEmail(members, curE) || {}).backup_email || '').toLowerCase();
      if (!(isMgrA || (I.email === curE && backup && backup === toE))) return reject('โอนได้เฉพาะ AM/CEO/COO/Director หรือผู้ตรวจเดิมโอนให้ "ผู้ตรวจสำรอง" ของตัวเอง');
      out.content = c; if (t) upd(t);
      if (I.taskId) { t.reviewer_email = to.email; t.review_started_at = ''; t.co_reviewers = coList_(t.co_reviewers).filter(x => x !== toE).join(','); } else { c.gate_co_reviewers = coList_(c.gate_co_reviewers).filter(x => x !== toE).join(','); c.current_owner_email = to.email; c.current_owner_name = to.name; c.review_started_at = ''; c.updated_at = now; }
      out.audit.push({ sheet: 'Review_Transfers', row: { transfer_id: 'RT-' + Utilities.getUuid().slice(0, 8), content_id: c.content_id, task_id: t ? t.task_id : '', gate_code: gateCode,
        from_reviewer: curE, to_reviewer: toE, transferred_by: I.email, kind: isMgrA && I.email !== curE ? 'manager' : 'backup', reason: why, at: now } });
      return fin(() => { log('review_transferred', c.current_status, c.current_status, nameOf(curE) + ' → ' + to.name + ': ' + why, { from: curE, to: toE, task: t ? t.task_id : '' }); if (t) out.logs[out.logs.length - 1].task_id = t.task_id;
        note('REVIEW_TRANSFER', msg('🔀', 'โอนผู้ตรวจ' + (t ? ' งานย่อย "' + (t.label || '-') + '"' : ' (' + GATES[gateCode].label + ')') + ' จาก ' + nameOf(curE) + ' → ' + to.name + '\nเหตุผล: ' + why), [toE, curE]); });
    }
    case 'TAKE_REVIEW': {
      if (needC()) return reject(needC());
      const myRank = RANK[pos] || 0;
      if (pos === POS.CV && !isOwnerCV()) return reject('Content ตรวจแทนได้เฉพาะงานของตัวเอง');
      const why = String(I.reason || '').trim() || 'ผู้ตรวจเดิมไม่ว่าง';
      out.content = c;
      if (I.taskId) {
        if (!t) return reject('ไม่พบงานย่อยนี้');
        if (t.status !== ST.SR) return reject('งานย่อยนี้ไม่ได้อยู่ระหว่างรอตรวจ (สถานะ ' + t.status + ')');
        if (t.assignee_email.toLowerCase() === I.email) return reject('ห้ามตรวจงานของตัวเอง');
        const cur = memberByEmail(members, t.reviewer_email);
        if (cur && cur.email.toLowerCase() === I.email) return reject('คุณเป็นผู้ตรวจของงานนี้อยู่แล้ว');
        if (!(myRank > (cur ? (RANK[cur.position] || 0) : 0))) return reject('รับตรวจแทนได้เฉพาะตำแหน่งที่สูงกว่าผู้ตรวจเดิม');
        const prev = t.reviewer_email; upd(t); t.reviewer_email = I.email; t.review_started_at = '';
        out.audit.push({ sheet: 'Review_Transfers', row: { transfer_id: 'RT-' + Utilities.getUuid().slice(0, 8), content_id: c.content_id, task_id: t.task_id, gate_code: 'SR', from_reviewer: String(prev).toLowerCase(), to_reviewer: I.email, transferred_by: I.email, kind: 'takeover', reason: why, at: now } });
        return fin(() => { log('review_taken_over', c.current_status, c.current_status, (t.label || '') + ' ตรวจแทน ' + nameOf(prev) + ': ' + why, { from: prev, task: t.task_id });
          note('REVIEW_COVER', msg('🔀', actor.name + ' รับตรวจแทน ' + nameOf(prev) + ' งานย่อย "' + (t.label || '-') + '"\nเหตุผล: ' + why), [prev, t.assignee_email]); });
      }
      if (![ST.CR, ST.AMR].includes(c.current_status) || !GATES[c.current_gate] || c.current_gate === 'FINAL') return reject('รับตรวจแทนได้เฉพาะงานรวมที่อยู่ด่านตรวจของ Content หรือ AM');
      if (tasks.some(x => x.assignee_email.toLowerCase() === I.email)) return reject('ห้ามตรวจงานที่ตัวเองผลิต');
      const curO = memberByEmail(members, c.current_owner_email);
      if (curO && curO.email.toLowerCase() === I.email) return reject('คุณเป็นผู้ตรวจของด่านนี้อยู่แล้ว');
      if (!(myRank > (curO ? (RANK[curO.position] || 0) : 0))) return reject('รับตรวจแทนได้เฉพาะตำแหน่งที่สูงกว่าผู้ตรวจเดิม');
      const prevO = c.current_owner_email; c.current_owner_email = actor.email; c.current_owner_name = actor.name; c.updated_at = now; c.review_started_at = '';
      out.audit.push({ sheet: 'Review_Transfers', row: { transfer_id: 'RT-' + Utilities.getUuid().slice(0, 8), content_id: c.content_id, task_id: '', gate_code: c.current_gate, from_reviewer: String(prevO).toLowerCase(), to_reviewer: I.email, transferred_by: I.email, kind: 'takeover', reason: why, at: now } });
      return fin(() => { log('review_taken_over', c.current_status, c.current_status, GATES[c.current_gate].label + ' ตรวจแทน ' + nameOf(prevO) + ': ' + why, { from: prevO, gate: c.current_gate });
        note('REVIEW_COVER', msg('🔀', actor.name + ' รับตรวจแทน ' + nameOf(prevO) + ' (' + GATES[c.current_gate].label + ')\nเหตุผล: ' + why), [prevO]); });
    }
    case 'REVIEW': {
      if (needC()) return reject(needC());
      const dec = I.decision;
      if (![ 'Approved', 'Revision Required', 'Rejected', 'Approved_with_Follow_up' ].includes(dec)) return reject('ผลตรวจไม่ถูกต้อง');
      
      if (c.current_status === ST.BR) {
        if (pos !== POS.AM) return reject('เฉพาะ AM ตรวจ Brief');
        if (!['Approved', 'Revision Required', 'Approved_with_Follow_up'].includes(dec)) return reject('ผลตรวจ Brief ไม่ถูกต้อง');
        out.content = c;
        // ข้อ 1: บันทึกผลตรวจ Brief ลง Review_History (gate BRIEF) เพื่อวัดอัตราผ่านรอบแรก / แก้ย้อนหลัง
        out.review = { review_id: 'RV-' + c.content_id + '-BRIEF-' + pad((ctx.briefRound || 0) + 1, 2), task_id: '', content_id: c.content_id, gate_code: 'BRIEF', round_no: (ctx.briefRound || 0) + 1,
          reviewer_email: I.email, producer_email: c.creator_email || '', result: dec, reason: I.reason || (dec === 'Approved_with_Follow_up' ? String(I.fu_desc || '') : ''), cause_type: dec === 'Revision Required' ? 'brief_error' : '', return_scope: '',
          requested_at: c.current_started_at, opened_at: c.review_started_at || '', decided_at: now, due_at: c.current_due_at || '',
          on_time: c.current_due_at ? now.getTime() <= new Date(c.current_due_at).getTime() : '' };
        const cvm = memberByEmail(members, c.creator_email);
        const cv = (cvm && cvm.position === POS.CV) ? cvm : memberByPos(members, POS.CV);
        
        if (dec === 'Approved' || dec === 'Approved_with_Follow_up') {
          const isFollowUp = dec === 'Approved_with_Follow_up';
          let fuOwner = null, fuDue = null;
          if (isFollowUp) {   // CR 2.2: อนุมัติแบบมีเงื่อนไข ต้องมีรายการที่ต้องตามแก้ + ผู้รับผิดชอบ + วันครบกำหนด
            if (!String(I.fu_desc || '').trim()) return reject('ต้องระบุสิ่งที่ต้องตามแก้ (Follow-up)');
            fuOwner = memberByEmail(members, I.fu_owner);
            if (!fuOwner || fuOwner.active === false) return reject('ต้องเลือกผู้รับผิดชอบ Follow-up ที่อยู่ใน Team_Members');
            fuDue = parseDT(I.fu_due);
            if (!fuDue || fuDue.getTime() <= now.getTime()) return reject('ต้องระบุวันครบกำหนด Follow-up ที่เป็นเวลาในอนาคต (YYYY-MM-DD HH:mm)');
            out.audit.push({ sheet: 'Brief_Followups', row: { followup_id: 'FUP-' + Utilities.getUuid().slice(0, 8), content_id: c.content_id, brief_version_id: c.brief_current_id || '', description: String(I.fu_desc).trim().slice(0, 1000),
              owner_id: fuOwner.email, due_at: fuDue, affected_task_id: '', status: 'Open', created_by: I.email, created_at: now, closed_at: '' } });
          }
          handoff(c, ST.BA, cv.email, null, '');
          return fin(() => { 
            log(isFollowUp ? 'brief_approved_followup' : 'brief_approved', ST.BR, ST.BA, isFollowUp ? String(I.fu_desc).trim() : (I.reason || '')); 
            note('BRIEF_OK', msg(isFollowUp ? '⚠️' : '✅', (isFollowUp ? 'AM อนุมัติ Brief (มีเงื่อนไขให้ตามแก้)' : 'AM อนุมัติ Brief แล้ว') + ' ' + cv.name + ' มอบหมายงานผลิตได้เลย\n' + (isFollowUp ? 'Follow-up: ' + String(I.fu_desc).trim() + '\nผู้รับผิดชอบ: ' + fuOwner.name + ' · ครบกำหนด ' + fmtD(fuDue) : (I.reason || '')))); 
            if (isFollowUp) note('FOLLOWUP', msg('📌', 'คุณได้รับ Follow-up จาก Brief "' + (c.title || '-') + '"\n' + String(I.fu_desc).trim() + '\nครบกำหนด ' + fmtD(fuDue)), [fuOwner.email]);
          });
        }
        if (!I.reason) return reject('ต้องใส่เหตุผล (ข้อความหรือลิงก์) เมื่อ Brief ไม่ผ่าน');
        handoff(c, ST.CD, cv.email, dueFrom('CONTENT', now), '');
        return fin(() => { log('brief_returned', ST.BR, ST.CD, I.reason); note('BRIEF_RETURN', msg('🔁', 'Brief ถูกส่งกลับแก้: ' + I.reason)); });
      }
      
      if (t && t.status === ST.SR) {
        if (dec === 'Rejected') return reject('งานย่อยใช้ผลตรวจ Approved หรือ Revision Required (ถ้าไม่ผ่านให้ส่งกลับแก้พร้อมเหตุผล)');
        if (!isRevT_(t, I.email)) return reject('คุณไม่ใช่ผู้ตรวจงานย่อยนี้ (ผู้ตรวจคือ ' + [t.reviewer_email].concat(coList_(t.co_reviewers)).map(nameOf).join(', ') + ')');
        if (t.assignee_email.toLowerCase() === I.email) return reject('ห้ามตรวจงานของตัวเอง');
        if (dec !== 'Approved' && (!I.reason || I.reason.length < 3)) return reject('ต้องใส่เหตุผล/Comment (ข้อความหรือลิงก์) เมื่อไม่ผ่าน');
        if (dec === 'Revision Required' && !['producer_error', 'brief_change'].includes(I.cause)) return reject('ต้องระบุสาเหตุแก้: producer_error หรือ brief_change');
        out.content = c; upd(t); const from = c.current_status;
        const round = (ctx.reviewRound || 0) + 1;
        out.review = { review_id: 'RV-' + t.task_id + '-SR-' + pad(round, 2), task_id: t.task_id, content_id: c.content_id, gate_code: 'SR', round_no: round,
          reviewer_email: I.email, producer_email: t.assignee_email, result: dec, reason: I.reason || '', cause_type: dec === 'Revision Required' ? I.cause : '',
          return_scope: dec === 'Revision Required' ? 'same_gate' : '', requested_at: t.submitted_at, opened_at: t.review_started_at || '', decided_at: now, due_at: t.sla_due_at || '',
          on_time: t.sla_due_at ? now.getTime() <= new Date(t.sla_due_at).getTime() : '' };
        if (dec === 'Approved') {
          const apT = coList_(t.co_approved); if (apT.indexOf(I.email) < 0) apT.push(I.email); t.co_approved = apT.join(',');
          const leftT = pendRev_(t.reviewer_email, t.co_reviewers, t.co_approved);
          if (leftT.length) return fin(() => { log('review_partial', from, c.current_status, (t.label || '') + ' — ' + actor.name + ' อนุมัติแล้ว รออีก ' + leftT.map(nameOf).join(', '), { gate: 'SR', task: t.task_id });
            out.logs[out.logs.length - 1].task_id = t.task_id;
            note('PARTIAL', msg('☑️', actor.name + ' อนุมัติงานย่อย "' + (t.label || '-') + '" แล้ว · รอ ' + leftT.map(nameOf).join(', ') + ' ตรวจอีก'), [t.assignee_email].concat(leftT)); });
          t.status = 'Passed'; t.done_at = now;
          return fin(() => { log('review_approved', from, c.current_status, (t.label || '') + (I.reason ? ': ' + I.reason : ''), { gate: 'SR', task: t.task_id });
            out.logs[out.logs.length - 1].task_id = t.task_id;
            note('PASSED', msg('✅', 'งานย่อย "' + (t.label || '-') + '" ผ่าน Senior แล้ว'), [t.assignee_email, c.current_owner_email]); afterTaskPassed(); });
        }
        if (I.cause === 'producer_error') t.rev_count_producer = Number(t.rev_count_producer || 0) + 1; else t.rev_count_brief = Number(t.rev_count_brief || 0) + 1;
        t.status = ST.RR; t.sla_due_at = addWorkDays(now, slaWd(cfg, 'REVISION', c.content_type)); t.co_approved = '';
        syncProd(c);
        return fin(() => { log('revision_required', from, c.current_status, I.reason, { gate: 'SR', cause: I.cause, round: round, task: t.task_id });
          out.logs[out.logs.length - 1].task_id = t.task_id;
          note('REVISION', msg('🔁', 'ส่งกลับแก้งานย่อย "' + (t.label || '-') + '" (รอบ ' + round + ')\nเหตุผล: ' + I.reason), [t.assignee_email]);
          if (t.rev_count_producer >= 3) note('REV_ESC', msg('⚠️', 'งานย่อย "' + (t.label || '-') + '" แก้เพราะผู้ผลิตครบ ' + t.rev_count_producer + ' ครั้ง แจ้ง AM ดูแล')); });
      }
      
      const g = GATES[c.current_gate];
      if (!g || ![ST.CR, ST.AMR, ST.FA].includes(c.current_status)) return reject('งานนี้ไม่ได้อยู่ในด่านตรวจ (สถานะ: ' + c.current_status + ')');
      if (!isRevC_(c, I.email)) return reject('คุณไม่ใช่ผู้ตรวจของด่านนี้ (ผู้ตรวจคือ ' + [c.current_owner_email].concat(coList_(c.gate_co_reviewers)).map(nameOf).join(', ') + ')');
      if (tasks.some(x => x.assignee_email.toLowerCase() === I.email)) return reject('ห้ามตรวจงานที่ตัวเองผลิต');
      if (c.current_gate === 'FINAL' && !(isExecPos_(pos) && actor.is_final_approver === true)) return reject('Final Approval ทำได้เฉพาะ CEO / COO / Director');
      if (dec !== 'Approved' && (!I.reason || I.reason.length < 3)) return reject('ต้องใส่เหตุผล/Comment (ข้อความหรือลิงก์) เมื่อไม่ผ่าน');
      if (dec === 'Revision Required' && !['producer_error', 'brief_change'].includes(I.cause)) return reject('ต้องระบุสาเหตุแก้: producer_error หรือ brief_change');
      if ((dec === 'Approved' || dec === 'Approved_with_Follow_up') && tasks.length) {
        const dsg = deliv_(cfg, c, tasks);
        if (dsg.pending.length) return reject('อนุมัติด่านนี้ไม่ได้: ยังมีงานย่อยบังคับที่ไม่ผ่านครบ (' + tasks.filter(x => isReq_(x) && x.status !== 'Passed').map(x => (x.label || x.task_id) + ' = ' + x.status).join(', ') + ') ให้ส่งกลับแก้หรือรอให้ผ่านก่อน');
        if (dsg.missing_lanes.length) return reject('อนุมัติด่านนี้ไม่ได้: ยังขาดงานสาย ' + dsg.missing_lanes.map(l => LANE_TH[l] || l).join(', ') + ' ให้ AM มอบหมายเพิ่มก่อน');
      }
      const picked = String(I.returnTasks || '').split(/[,|]/).map(x => x.trim()).filter(Boolean);
      const back = picked.length ? tasks.filter(x => picked.indexOf(x.task_id) >= 0) : tasks.slice();
      if (dec === 'Revision Required' && !back.length) return reject('ไม่พบงานย่อยที่เลือกส่งกลับ');
      out.content = c; const from = c.current_status; const gateCode = c.current_gate;
      const round = (ctx.reviewRound || 0) + 1;
      out.review = { review_id: 'RV-' + c.content_id + '-' + gateCode + '-' + pad(round, 2), task_id: '', content_id: c.content_id,
        gate_code: gateCode, round_no: round, reviewer_email: I.email, producer_email: tasks.map(x => x.assignee_email).join(','), result: dec, reason: I.reason || '',
        cause_type: dec === 'Revision Required' ? I.cause : '', return_scope: dec === 'Revision Required' ? (I.scope || 'same_gate') : '', returned_tasks: dec === 'Revision Required' ? back.map(x => x.task_id).join(',') : '',
        requested_at: c.current_started_at, opened_at: c.review_started_at || '', decided_at: now, due_at: c.current_due_at || '',
        on_time: c.current_due_at ? now.getTime() <= new Date(c.current_due_at).getTime() : '' };

      if ((dec === 'Approved' || dec === 'Approved_with_Follow_up') && gateCode !== 'FINAL') {
        const apC = coList_(c.gate_co_approved); if (apC.indexOf(I.email) < 0) apC.push(I.email); c.gate_co_approved = apC.join(',');
        const leftC = pendRev_(c.current_owner_email, c.gate_co_reviewers, c.gate_co_approved);
        if (leftC.length) { c.updated_at = now; return fin(() => { log('review_partial', from, c.current_status, actor.name + ' อนุมัติ ' + g.label + ' แล้ว รออีก ' + leftC.map(nameOf).join(', '), { gate: gateCode });
          note('PARTIAL', msg('☑️', actor.name + ' อนุมัติ ' + g.label + ' แล้ว · รอ ' + leftC.map(nameOf).join(', ') + ' ตรวจอีก'), [c.current_owner_email].concat(leftC)); }); }
      }
      if (dec === 'Approved' || dec === 'Approved_with_Follow_up') {
        const gates = gatesFor();
        const next = gates[gates.indexOf(gateCode) + 1];
        if (gateCode === 'FINAL' || !next) {
          c.final_approval_status = 'Approved';
          const pub = members.find(m => m.can_publish === true && m.active !== false) || memberByPos(members, POS.AM);
          const due = c.planned_publish_at ? new Date(new Date(c.planned_publish_at).getTime() + 2 * 3600e3) : '';
          handoff(c, ST.RTP, pub.email, due, '');
          return fin(() => { log('final_approved', from, c.current_status, I.reason || ''); note('APPROVED', msg('✅', (actor ? nameP_(members, actor.email) : 'ผู้บริหาร') + ' อนุมัติ Final แล้ว (ยังไม่ Published) เตรียมเผยแพร่ ' + fmtD(c.planned_publish_at))); });
        }
        const r = enterGate(c, null, next, tasks.map(x => x.assignee_email));
        return fin(() => { log('review_approved', from, c.current_status, I.reason || '', { gate: gateCode });
          if (r === 'OK') note('PASSED', msg('✅', 'ผ่าน ' + g.label + ' → รอ ' + GATES[next].label));
          else note('ROUTER_BLOCK', msg('🚧', 'หาผู้ตรวจด่านถัดไปไม่ได้ (' + r + ')')); });
      }

      if (dec === 'Revision Required') {
        const due = addWorkDays(now, slaWd(cfg, 'REVISION', c.content_type));
        back.forEach(x => {
          upd(x);
          if (I.cause === 'producer_error') x.rev_count_producer = Number(x.rev_count_producer || 0) + 1; else x.rev_count_brief = Number(x.rev_count_brief || 0) + 1;
          x.status = ST.RR; x.sla_due_at = due; x.return_gate = (I.scope === 'restart') ? 'FIRST' : gateCode;
        });
        if (gateCode === 'FINAL') c.final_approval_status = 'Pending';
        handoff(c, ST.IP, cvOf(c).email, due, '');
        syncProd(c);
        return fin(() => {
          log('revision_required', from, c.current_status, I.reason, { gate: gateCode, cause: I.cause, round: round, tasks: back.map(x => x.task_id) });
          note('REVISION', msg('🔁', 'ส่งกลับแก้ (' + g.label + ' รอบ ' + round + ') งานย่อย: ' + back.map(x => x.label || x.task_id).join(', ') + '\nเหตุผล: ' + I.reason),
            back.map(x => x.assignee_email).concat([cvOf(c).email]));
        });
      }

      const owner = (gateCode === 'FINAL') ? (execAll_(members).find(m => String(m.email).toLowerCase() !== I.email) || execMember_(members)) : memberByPos(members, POS.AM);
      if (gateCode === 'FINAL') c.final_approval_status = 'Rejected';
      handoff(c, ST.BLK, owner.email, null, gateCode);
      const deciders = gateCode === 'FINAL' ? execAll_(members) : [owner];
      return fin(() => { log('rejected', from, c.current_status, I.reason, { gate: gateCode });
        note('REJECTED', msg('🛑', 'ไม่ผ่าน ' + g.label + '\nเหตุผล: ' + I.reason + '\nรอ ' + deciders.map(m => m.name + ' (' + m.position + ')').join(' หรือ ') + ' ตัดสินใจ')); });
    }
    case 'RESOLVE_BLOCK': {
      if (needC()) return reject(needC());
      if (c.current_status !== ST.BLK) return reject('งานนี้ไม่ได้อยู่สถานะ Blocked');
      const finalBlock = c.current_gate === 'FINAL';
      if (finalBlock ? !isExecPos_(pos) : !(pos === POS.AM || isExecPos_(pos))) return reject(finalBlock ? 'งานที่ Director ปฏิเสธ Director ตัดสินเอง' : 'เฉพาะ AM/CEO/COO/Director แก้ Blocked ได้');
      if (!['Rework', 'Delay', 'Cancel', 'Retry'].includes(I.decision)) return reject('ต้องเลือก Rework / Delay / Cancel / Retry');
      if (!I.reason) return reject('ต้องใส่เหตุผล');
      out.content = c; const from = c.current_status;
      if (I.decision === 'Retry') { 
        if (['NO_REVIEWER', 'SELF_REVIEW'].indexOf(c.block_reason) < 0 || !GATES[c.current_gate]) return reject('Retry ใช้ได้เฉพาะงานที่ติดเพราะหาผู้ตรวจไม่ได้ (ไม่ใช่งานที่ถูกปฏิเสธ)');
        if (!tasks.length || !tasks.every(x => x.status === 'Passed')) return reject('งานย่อยยังผ่านไม่ครบ');
        const gc = c.current_gate;
        const rr = enterGate(c, null, gc, tasks.map(x => x.assignee_email));
        if (rr !== 'OK') return reject('ยังส่งตรวจไม่ได้ (' + rr + ') แก้ Team_Members ให้มีผู้ตรวจที่ไม่ใช่ผู้ผลิตก่อน');
        return fin(() => { log('block_resolved', from, c.current_status, 'Retry: ' + I.reason);
          note('UNBLOCK_RETRY', msg('🔁', 'ส่งเข้า ' + GATES[gc].label + ' อีกครั้ง'), [c.current_owner_email, memberByPos(members, POS.AM).email]); });
      }
      if (I.decision === 'Cancel') {
        if (!isExecPos_(pos)) return reject('ยกเลิกงานได้เฉพาะ CEO / COO / Director');
        handoff(c, ST.CAN, '', null, ''); c.final_approval_status = c.final_approval_status || 'Pending';
        return fin(() => { log('cancelled', from, c.current_status, I.reason); note('CANCELLED', msg('⚫', 'ยกเลิกงาน: ' + I.reason)); });
      }
      if (!tasks.length) return reject('ไม่พบงานย่อย');
      if (I.decision === 'Delay') {
        if (!isExecPos_(pos)) return reject('เลื่อนวันเผยแพร่ได้เฉพาะ CEO / COO / Director');
        const nd = parseDT(I.planned); if (!nd) return reject('Delay ต้องระบุวันเผยแพร่ใหม่ YYYY-MM-DD HH:mm');
        if (nd.getTime() <= now.getTime()) return reject('วันและเวลาต้องเป็นอนาคต');
        c.original_planned_at = c.original_planned_at || c.planned_publish_at; c.planned_publish_at = nd; out.calendarDelayed = true;
      }
      const due = addWorkDays(now, slaWd(cfg, 'REVISION', c.content_type));
      const rg = (I.scope === 'restart' || !c.current_gate) ? 'FIRST' : c.current_gate;
      const picked = String(I.returnTasks || '').split(/[,|]/).map(x => x.trim()).filter(Boolean);
      const back = picked.length ? tasks.filter(x => picked.indexOf(x.task_id) >= 0) : tasks.slice();
      back.forEach(x => { upd(x); x.status = ST.RR; x.sla_due_at = due; x.return_gate = rg; });
      if (c.current_gate === 'FINAL') c.final_approval_status = 'Pending';
      handoff(c, ST.IP, cvOf(c).email, due, '');
      syncProd(c);
      return fin(() => { log('block_resolved', from, c.current_status, I.decision + ': ' + I.reason);
        note('UNBLOCK', msg('🔁', 'ตัดสิน ' + I.decision + ' → ส่งกลับแก้งานย่อย: ' + back.map(x => x.label || x.task_id).join(', ') + '\n' + I.reason), back.map(x => x.assignee_email).concat([cvOf(c).email])); });
    }
    case 'SET_FUNNEL': {
      if (needC()) return reject(needC());
      if (!(pos === POS.AM || isExecPos_(pos))) return reject('เฉพาะ AM/CEO/COO/Director แก้ Funnel ได้');
      if (!FUNNELS.includes(I.funnel)) return reject('Funnel ต้องเป็น ' + FUNNELS.join(' / '));
      out.content = c; const oldF = c.funnel; c.funnel = I.funnel; c.updated_at = now;
      return fin(() => log('funnel_set', c.current_status, c.current_status, (oldF || '-') + ' -> ' + I.funnel));
    }
    case 'RESCHEDULE': {
      if (needC()) return reject(needC());
      if (!isExecPos_(pos)) return reject('เลื่อนวันเผยแพร่ได้เฉพาะ CEO / COO / Director');
      if (TERMINAL.includes(c.current_status) || c.current_status === ST.PUB) return reject('งานนี้จบแล้ว เลื่อนไม่ได้');
      const nd = parseDT(I.planned); if (!nd) return reject('วันใหม่ต้องเป็น YYYY-MM-DD HH:mm');
      if (nd.getTime() <= now.getTime()) return reject('วันและเวลาต้องเป็นอนาคต'); 
      if (!I.reason) return reject('ต้องใส่เหตุผลการเลื่อน');
      out.content = c; out.calendarDelayed = true;
      const old = c.planned_publish_at; c.original_planned_at = c.original_planned_at || old; c.planned_publish_at = nd; c.updated_at = now;
      if (c.current_status === ST.RTP) c.current_due_at = new Date(nd.getTime() + 2 * 3600e3);
      return fin(() => { log('rescheduled', c.current_status, c.current_status, I.reason, { from: old, to: nd }); note('RESCHEDULE', msg('📅', 'เลื่อนวันเผยแพร่เป็น ' + fmtD(nd) + ' เหตุผล: ' + I.reason)); });
    }
    case 'RECORD_PUBLISH': {
      if (needC()) return reject(needC());
      if (!(pos === POS.AM || actor.can_publish === true)) return reject('คุณไม่มีสิทธิ์บันทึกการเผยแพร่');
      if (c.current_status !== ST.RTP) return reject('บันทึกเผยแพร่ได้เฉพาะงานที่อยู่ ' + ST.RTP + ' (ผ่าน Final Approval แล้ว)');
      if (c.final_approval_status !== 'Approved') return reject('ยังไม่มีหลักฐาน Final Approval');
      if (!isUrl(I.link)) return reject('ต้องมี URL โพสต์จริง (https://...) ถึงจะเปลี่ยนเป็น Published');
      let at = now; if (I.actual) { at = parseDT(I.actual); if (!at) return reject('เวลาเผยแพร่จริงต้องเป็น YYYY-MM-DD HH:mm'); }
      out.content = c; const from = c.current_status;
      c.actual_publish_at = at; c.publish_url = I.link;
      handoff(c, ST.PUB, memberByPos(members, POS.AM).email, null, '');
      return fin(() => { log('published', from, c.current_status, I.link, { actual: at });
        note('PUBLISHED', msg('🚀', 'เผยแพร่แล้ว ' + fmtD(at) + '\n' + I.link)); });
    }
    case 'CLOSE': {
      if (needC()) return reject(needC());
      if (pos !== POS.AM) return reject('เฉพาะ AM ปิดงาน');
      if (c.current_status !== ST.PUB) return reject('ปิดงานได้เฉพาะงานที่ Published แล้ว');
      out.content = c; const from = c.current_status;
      handoff(c, ST.DONE, '', null, '');
      return fin(() => log('completed', from, c.current_status, I.reason || ''));
    }
    case 'CHANGE_BRIEF': {
      if (needC()) return reject(needC());
      if (![POS.CV, POS.AM].includes(pos)) return reject('เฉพาะ Content & Video หรือ AM แก้ Brief ได้');
      if (pos === POS.CV && !isOwnerCV()) return reject('เฉพาะ Content เจ้าของงานนี้ หรือ AM แก้ Brief ได้');
      if ([ST.PUB, ST.DONE, ST.CAN, ST.TP].includes(c.current_status)) return reject('สถานะ ' + c.current_status + ' แก้ Brief ไม่ได้');
      if (!isUrl(I.link) || !I.reason) return reject('ต้องแนบลิงก์ Brief ใหม่ และเหตุผลการเปลี่ยน');
      out.content = c;
      const ver = (ctx.briefCount || 0) + 1;
      const afterStart = [ST.IP, ST.SR, ST.RR, ST.CR, ST.AMR, ST.FA, ST.RTP].includes(c.current_status);
      out.brief = { brief_id: c.content_id + '-B' + pad(ver, 2), content_id: c.content_id, version_no: ver, author_email: I.email,
        content_body: I.link, reference: I.reference || '', cta: I.cta, objective: I.objective, change_reason: I.reason || 'initial',
        changed_after_production_start: afterStart, created_at: now, attachments: I.attachments || '' }; // 👈 เติมตรงนี้
      c.brief_current_id = out.brief.brief_id; c.updated_at = now;
      if (tasks.length && afterStart) {
        tasks.filter(x => x.status !== 'Passed').forEach(x => {
          upd(x); x.is_brief_change = true;
          if ([ST.IP, ST.RR, ST.RFP].includes(x.status)) x.sla_due_at = addWorkDays(now, slaWd(cfg, 'REVISION', c.content_type));
        });
        syncProd(c);
      }
      return fin(() => { log('brief_changed', c.current_status, c.current_status, I.reason, { version: ver, after_production_start: afterStart });
        note('BRIEF_CHANGE', msg('📝', 'Brief เปลี่ยนเป็น v' + ver + (afterStart ? ' (หลังเริ่มผลิต ไม่นับเป็นความผิดผู้ผลิต)' : '') + '\n' + I.reason)); });
    }
    case 'CANCEL': {
      if (needC()) return reject(needC());
      if (!isExecPos_(pos)) return reject('ยกเลิกงานได้เฉพาะ CEO / COO / Director');
      if ([ST.PUB, ST.DONE, ST.CAN].includes(c.current_status)) return reject('งานนี้จบแล้ว ยกเลิกไม่ได้');
      if (!I.reason) return reject('ต้องใส่เหตุผล');
      out.content = c; const from = c.current_status;
      handoff(c, ST.CAN, '', null, '');
      return fin(() => { log('cancelled', from, c.current_status, I.reason); note('CANCELLED', msg('⚫', 'ยกเลิกงาน: ' + I.reason)); });
    }
    default:
      return reject('ไม่รู้จัก Action: ' + I.action);
  }
}

/* =====================================================================
 * PART 2 — SHEETS / FORM / CALENDAR / LINE
 * ===================================================================== */

const HEADERS = {
  Content_Master: ['content_id','title','content_type','channel','theme','pillar','objective','cta','reference_url','detail',
    'current_status','current_gate','current_owner_email','current_owner_name','current_started_at','current_due_at','is_waiting',
    'creator_email','brief_current_id','planned_publish_at','original_planned_at','actual_publish_at','publish_url','final_approval_status',
    'priority','created_at','updated_at','funnel','channel_account','theme_id','block_reason','blocked_since','review_started_at','gate_co_reviewers','gate_co_approved'],
  Themes: ['theme_id','name','objective','description','start_date','end_date','created_by','active','created_at'],
  Workflow_Tasks: ['task_id','content_id','step_code','assignee_email','role_in_task','status','gates_json','return_gate','attempt_no',
    'rev_count_producer','rev_count_brief','sla_start_at','sla_due_at','started_at','first_submitted_at','first_on_time','submitted_at',
    'done_at','wait_minutes','wait_since','wait_reason','work_link','is_brief_change','label','assigned_by','parent_task_id','lane','reviewer_email','review_started_at','delegated_by','estimated_hours','is_required','depends_on','first_margin_h','co_reviewers','co_approved'],
  Review_History: ['review_id','task_id','content_id','gate_code','round_no','reviewer_email','producer_email','result','reason',
    'cause_type','return_scope','requested_at','decided_at','due_at','on_time','opened_at','returned_tasks'],
  Activity_Log: ['log_id','content_id','task_id','event_type','actor_email','actor_role_in_task','from_status','to_status','reason','at','source','payload_json'],
  Content_Calendar: ['calendar_id','content_id','planned_publish_at','original_planned_at','calendar_status','actual_publish_at','publish_url',
    'final_approval_status','delay_reason','gcal_event_id','gcal_sig'],
  Team_Members: ['member_id','name','email','position','can_produce','can_publish','is_final_approver','line_user_id','active','bind_code','bind_expires','backup_email','weekly_capacity_hours'],
  Checklist_Templates: ['template_id','content_type','step_code','item_no','item_text','is_mandatory','version'],
  KPI_Data: ['kpi_id','period','member_email','role_kind','metric','numerator','denominator','value','calculated_at'],
  Brief_Versions: ['brief_id','content_id','version_no','author_email','content_body','reference','cta','objective','change_reason',
    'changed_after_production_start','created_at','attachments'], // 👈 เพิ่ม attachments
  Notification_Log: ['notif_id','dedupe_key','event_type','sent_to','sent_at','status','retry_count','text','to_email'],
  Channel_Options: ['channel','account','active','sort'],
  SLA_Config: ['key','value_wd','note'],
  Config: ['key','value','note'],
  
  // เพิ่มสำหรับ Phase A
  Task_Submissions: ['submission_id','task_id','version_no','submitted_by','submitted_at','media_type','file_url','file_name','submission_status','client_submission_id'],
  Task_Delegations: ['delegation_id','parent_task_id','delegated_task_id','delegated_by','delegated_to','instruction','reason','deadline','status','created_at','returned_at'],
  Chat_Members: ['room_id','member_email','joined_at','last_read_at'],
  // R3: ประวัติการโอน/รับตรวจแทน (ผู้ตรวจเก่า → ใหม่)
  Review_Transfers: ['transfer_id','content_id','task_id','gate_code','from_reviewer','to_reviewer','transferred_by','kind','reason','at'],
  Brief_Change_History: ['change_id','content_id','from_version','to_version','changed_fields_json','cause_type','requested_by','recorded_by','agreed_at','recorded_at','reason'],
  // เฟส E: ไทม์โค้ด/รูปประกอบตอนตรวจ (revision_request_id = review_id ใน Review_History)
  Brief_Followups: ['followup_id','content_id','brief_version_id','description','owner_id','due_at','affected_task_id','status','created_by','created_at','closed_at'],
  Review_Annotations: ['annotation_id','revision_request_id','submission_id','annotation_type','time_start','time_end','body_markdown','attachment_file_id','annotation_json','created_by','created_at']
};

function ss_() { return SpreadsheetApp.getActive(); }
function sh_(n) { return ss_().getSheetByName(n); }
function readAll_(name) {
  const s = sh_(name); if (!s || s.getLastRow() < 2) return [];
  const v = s.getDataRange().getValues(); const h = v.shift();
  return v.map((r, i) => { const o = { _row: i + 2 }; h.forEach((k, j) => { o[k] = r[j]; }); return o; });
}
function safe_(v) {
  if (typeof v !== 'string') return v;
  const s = v.length > 5000 ? v.slice(0, 5000) : v;
  return /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
}
function colLetter_(n) { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }
function colOf_(sheet, header) { return colLetter_(HEADERS[sheet].indexOf(header) + 1); }
function prop_(k) { return PropertiesService.getScriptProperties().getProperty(k) || ''; }

function normMembers_() {
  return readAll_('Team_Members').map(m => ({
    member_id: m.member_id, name: m.name, line_user_id: String(m.line_user_id || '').trim(), bind_code: String(m.bind_code || '').trim(), _row: m._row, email: String(m.email || '').toLowerCase().trim(), position: m.position,
    can_produce: m.can_produce, can_publish: m.can_publish === true || String(m.can_publish).toUpperCase() === 'TRUE',
    is_final_approver: m.is_final_approver === true || String(m.is_final_approver).toUpperCase() === 'TRUE',
    active: !(m.active === false || String(m.active).toUpperCase() === 'FALSE'),
    weekly_capacity_hours: Number(m.weekly_capacity_hours) > 0 ? Number(m.weekly_capacity_hours) : 0,   // ชม./สัปดาห์ (ว่าง = ไม่ตรวจ Capacity)
    backup_email: String(m.backup_email || '').toLowerCase().trim()   // ผู้ตรวจสำรอง (กรอกในชีต Team_Members)
  }));
}
function loadCfg_() {
  const cfg = {}; readAll_('SLA_Config').forEach(r => { if (r.key !== '') cfg[r.key] = r.value_wd; }); return cfg;
}
function baseUrl_() { return prop_('MINIAPP_URL') || ss_().getUrl(); }

function persist_(res, c, t, now) {
  res.logs.forEach(l => { l.log_id = 'LOG-' + Utilities.getUuid().slice(0, 8); appendRow_('Activity_Log', l); });
  if (!res.ok) return;
  if (res.theme) { appendRow_('Themes', res.theme); return; }
  if (res.themeDelete) { sh_('Themes').deleteRow(res.themeDelete._row); return; }
  if (res.themeUpdate) {
    updateRow_('Themes', res.themeUpdate._row, res.themeUpdate.fields);
    if (res.themeUpdate.rename) readAll_('Content_Master').filter(x => x.theme_id === res.themeUpdate.rename.id).forEach(x => updateRow_('Content_Master', x._row, { theme: res.themeUpdate.rename.name }));
    return;
  }
  if (res.brief) appendRow_('Brief_Versions', res.brief);
  if (res.review) appendRow_('Review_History', res.review);
  if (res.newContent) appendRow_('Content_Master', res.content);
  else if (res.content && c) updateRow_('Content_Master', c._row, res.content);
  if (res.newTasks && res.newTasks.length) res.newTasks.forEach(x => appendRow_('Workflow_Tasks', x));   // Batch: ลงทุกชิ้น
  else if (res.newTask) appendRow_('Workflow_Tasks', res.task);
  (res.audit || []).forEach(a => {   // ตารางประวัติ: ถ้ายังไม่ได้สร้างชีต (ยังไม่รัน migrateV2) ให้ข้าม ไม่ให้งานหลักพัง
    try {
      if (!sh_(a.sheet)) return;
      if (a.sheet === 'Task_Submissions' && a.op !== 'file') readAll_('Task_Submissions').filter(r => r.task_id === a.task_id && r.submission_status === 'Current')
        .forEach(r => updateRow_('Task_Submissions', r._row, { submission_status: a.op === 'withdraw' ? 'Withdrawn' : 'Superseded' }));
      if (a.row) appendRow_(a.sheet, a.row);
    } catch (e) { console.error('audit ' + a.sheet, e); }
  });
  (res.taskUpdates || []).forEach(x => { if (x._row) updateRow_('Workflow_Tasks', x._row, x); });
  const cid = res.content.content_id;
  syncCalendarRow_(cid, !!res.calendarDelayed, '', res.content);
}

/* ---------- Calendar ---------- */
function calStatusOf_(c, existing) {
  if (c.current_status === ST.CAN) return 'Cancelled';
  if (c.current_status === ST.PUB || c.current_status === ST.DONE) return 'Published';
  if (c.final_approval_status === 'Approved' && c.current_status === ST.RTP) return 'Scheduled';
  if (existing === 'Delayed') return 'Delayed';
  return 'Planned';
}
function calSig_(c, status) {
  const t = d => d ? new Date(d).getTime() : '';
  return [c.title, t(c.planned_publish_at), status, c.current_status, c.current_owner_name, c.final_approval_status, t(c.actual_publish_at), c.publish_url].join('|');
}
function syncCalendarRow_(contentId, forceDelayed, reason, cObj) {
  const c = cObj || readAll_('Content_Master').find(x => x.content_id === contentId); if (!c) return;
  const row = readAll_('Content_Calendar').find(x => x.content_id === contentId);
  let status = calStatusOf_(c, row && row.calendar_status);
  if (forceDelayed && ![ST.PUB, ST.DONE, ST.CAN].includes(c.current_status)) status = 'Delayed';
  const data = { content_id: contentId, planned_publish_at: c.planned_publish_at, original_planned_at: c.original_planned_at || (row && row.original_planned_at) || '',
    calendar_status: status, actual_publish_at: c.actual_publish_at, publish_url: c.publish_url, final_approval_status: c.final_approval_status,
    delay_reason: reason || (row && row.delay_reason) || '', gcal_event_id: row ? row.gcal_event_id : '', gcal_sig: row ? row.gcal_sig : '' };
  if (row) updateRow_('Content_Calendar', row._row, data);
  else { data.calendar_id = 'CAL-' + contentId; appendRow_('Content_Calendar', data); }
}
function calGuests_(c, tasksByContent) {
  // เฉพาะคนที่มีงานค้างของคอนเทนต์นี้ (+ผู้รับผิดชอบปัจจุบัน) — ไม่ส่งให้ทุกคน
  const set = {}, add = e => { e = String(e || '').trim().toLowerCase(); if (e) set[e] = 1; };
  (tasksByContent[c.content_id] || []).forEach(t => add(t.assignee_email));
  add(c.current_owner_email);
  return Object.keys(set).sort();
}
function syncGcal_(c, status, eventId, guests, cancelled) {
  try {
    const calId = prop_('CALENDAR_ID');
    const cal = calId ? CalendarApp.getCalendarById(calId) : CalendarApp.getDefaultCalendar();
    if (cancelled) {   // งานยกเลิก → ลบออกจากปฏิทิน (ของทุกคนที่ถูกเชิญ)
      if (eventId) { const old = cal.getEventById(eventId); if (old) old.deleteEvent(); }
      return 'DELETED';
    }
    if (!c.planned_publish_at) return eventId;
    const start = new Date(c.planned_publish_at), end = new Date(start.getTime() + 30 * 60000);
    const title = '[' + status + '] ' + c.title;
    const desc = ['ID: ' + c.content_id, 'ประเภท: ' + c.content_type, 'Theme: ' + c.theme, 'ช่องทาง: ' + c.channel,
      'สถานะงาน: ' + c.current_status, 'ผู้รับผิดชอบ: ' + (c.current_owner_name || '-'), 'Final Approval: ' + c.final_approval_status,
      'เผยแพร่จริง: ' + (c.actual_publish_at ? fmtD(c.actual_publish_at) : '-'), 'URL: ' + (c.publish_url || '-'), 'Sheet: ' + baseUrl_()].join('\n');
    const color = { Planned: CalendarApp.EventColor.GRAY, Scheduled: CalendarApp.EventColor.BLUE, Published: CalendarApp.EventColor.GREEN,
      Delayed: CalendarApp.EventColor.RED }[status];
    let ev = eventId ? cal.getEventById(eventId) : null;
    if (!ev) ev = cal.createEvent(title, start, end, { description: desc });
    else { ev.setTitle(title); ev.setTime(start, end); ev.setDescription(desc); }
    if (color) ev.setColor(color);
    // ผู้ร่วมงาน = เฉพาะเจ้าของงานที่เกี่ยวข้อง: เพิ่มคนใหม่ / ถอดคนที่ไม่มีงานแล้ว
    const want = guests || [], have = ev.getGuestList().map(g => g.getEmail().toLowerCase());
    want.filter(e => !have.includes(e)).forEach(e => ev.addGuest(e));
    have.filter(e => !want.includes(e)).forEach(e => ev.removeGuest(e));
    return ev.getId();
  } catch (err) { console.error('calendar: ' + err); return eventId; }
}

/* ---------- SLA Monitor ---------- */
function slaCompute_() {   // คำนวณอย่างเดียว ไม่เขียนชีต/ไม่ส่งอะไร — งานเขียนถูกเลื่อนไปไว้ใน delayed แล้ว slaMonitor ค่อยทำใต้ล็อกสั้น ๆ
  const delayed = [];
  const syncCalendarRow_ = (cid, force, reason) => delayed.push({ cid: cid, reason: reason });
  const appendRow_ = (name, row) => delayed.push({ name: name, log: row });
  {
    const now = new Date(), members = normMembers_();
    const nameOf = e => { const m = memberByEmail(members, e); return m ? m.name : '-'; };
    const dir = memberByPos(members, POS.DIR), am = memberByPos(members, POS.AM), execE = execEmails_(members);
    const wt = readAll_('Workflow_Tasks'), wtBy = {}; wt.forEach(x => { (wtBy[x.content_id] = wtBy[x.content_id] || []).push(x); });
    const contents = readAll_('Content_Master');
    const out = [];
    const calMap = {}; readAll_('Content_Calendar').forEach(x => { calMap[x.content_id] = x; });
    contents.forEach(c => {
      const open = ![ST.PUB, ST.DONE, ST.CAN].includes(c.current_status);
      const line = (icon, head) => icon + ' ' + head + '\n[' + c.title + '] ' + c.content_id + ' (' + c.content_type + ')\nสถานะ: ' + c.current_status +
        ' | ผู้รับผิดชอบ: ' + nameP_(members, c.current_owner_email) + '\n' + whoLine_(members, c, wtBy[c.content_id] || []) + '\nกำหนด: ' + fmtD(c.current_due_at) + '\n' + baseUrl_();
      if (open && c.current_status !== ST.BLK && c.current_status !== ST.IP && c.current_due_at && c.current_started_at && c.is_waiting !== true) {
        const start = new Date(c.current_started_at).getTime(), due = new Date(c.current_due_at).getTime();
        if (now.getTime() >= due) {
          const bucket = Math.min(2, Math.floor((now.getTime() - due) / (4 * 3600e3)));
          out.push({ event: 'SLA_BREACH', key: 'SLA_BREACH|' + c.content_id + '|' + due + '|' + bucket, text: line('🔴', 'เกิน SLA แจ้ง ' + nameOf(c.current_owner_email) + ' และ AM ' + (am ? am.name : '')) });
          if (now.getTime() - due > 24 * 3600e3) out.push({ event: 'SLA_ESC', key: 'SLA_ESC|' + c.content_id + '|' + due, text: line('⛔', 'Escalate ถึงผู้บริหาร (' + execAll_(members).map(m => m.name + ' ' + m.position).join(', ') + '): เกิน SLA มากกว่า 1 วัน') });
        } else if ((now.getTime() - start) / (due - start) >= 0.8) {
          out.push({ event: 'SLA_WARN', key: 'SLA_WARN|' + c.content_id + '|' + due, text: line('⏰', 'ใกล้ครบกำหนด (ใช้เวลาไป 80%)') });
        }
      }
      if (open && c.planned_publish_at && c.final_approval_status !== 'Approved') {
        const hrs = (new Date(c.planned_publish_at).getTime() - now.getTime()) / 3600e3;
        const lvl = hrs <= 0 ? 4 : hrs <= 4 ? 3 : hrs <= 12 ? 2 : hrs <= 24 ? 1 : 0;
        if (lvl > 0) {
          const heads = { 1: 'ยังไม่มี Final Approval (เหลือไม่เกิน 24 ชม.)', 2: 'URGENT: ยังไม่มี Final Approval (เหลือไม่เกิน 12 ชม.)',
            3: 'CRITICAL: ยังไม่มี Final Approval (เหลือไม่เกิน 4 ชม.)', 4: 'ถึงเวลาเผยแพร่แล้วแต่ไม่มี Final Approval → ห้ามเผยแพร่ ตั้งเป็น Delayed รอ Director' };
          const isFinalGate = c.current_gate === 'FINAL' || [ST.FA, ST.RTP].includes(c.current_status);
          const targets = isFinalGate ? execE.concat([am && am.email]) : [am && am.email];
          out.push({ event: 'GATE_L' + lvl, key: 'GATE|' + c.content_id + '|' + new Date(c.planned_publish_at).getTime() + '|L' + lvl,
            text: line(lvl >= 3 ? '🚨' : '⚠️', heads[lvl]) + '\nผู้ต้องอนุมัติ: ' + (execAll_(members).map(m => m.name + ' (' + m.position + ')').join(' หรือ ') || 'Director'),
            to: targets
          });
          if (lvl === 4) { const cal = calMap[c.content_id];
            if (!cal || cal.calendar_status !== 'Delayed') { syncCalendarRow_(c.content_id, true, 'ไม่มี Final Approval ก่อนเวลาเผยแพร่'); calMap[c.content_id] = { calendar_status: 'Delayed' };
              appendRow_('Activity_Log', { log_id: 'LOG-' + Utilities.getUuid().slice(0, 8), content_id: c.content_id, event_type: 'auto_delayed', actor_email: 'system',
                from_status: c.current_status, to_status: c.current_status, reason: 'ไม่มี Final Approval ตอนถึงเวลาเผยแพร่', at: now, source: 'slaMonitor' }); } }
        }
      }
      if (c.current_status === ST.RTP && c.planned_publish_at) {
        const late = now.getTime() - (new Date(c.planned_publish_at).getTime() + 2 * 3600e3);
        if (late > 0) { const b = Math.min(2, Math.floor(late / (2 * 3600e3)));
          out.push({ event: 'NO_PUBLISH_PROOF', key: 'NOPUB|' + c.content_id + '|' + b, text: line('⚠️', 'เลยเวลาเผยแพร่แล้วแต่ยังไม่มี URL หลักฐาน') });
          const cal = calMap[c.content_id];
          if (!cal || cal.calendar_status !== 'Delayed') { syncCalendarRow_(c.content_id, true, 'เลยเวลาเผยแพร่ ไม่มีหลักฐานเผยแพร่'); calMap[c.content_id] = { calendar_status: 'Delayed' }; } }
      }
    });
    const cmap = {}; contents.forEach(c => { cmap[c.content_id] = c; });
    wt.forEach(t => {
      const c = cmap[t.content_id]; if (!c || [ST.PUB, ST.DONE, ST.CAN, ST.BLK].includes(c.current_status)) return;
      const inRev = t.status === ST.SR;
      if (!(inRev || ['Ready for Production', 'In Production', 'Revision Required'].includes(t.status)) || t.wait_since || !t.sla_due_at) return;
      const who = inRev ? t.reviewer_email : t.assignee_email, startAt = inRev ? t.submitted_at : t.sla_start_at;
      if (!startAt) return;
      const start = new Date(startAt).getTime(), due = new Date(t.sla_due_at).getTime();
      const line = (icon, head) => icon + ' ' + head + '\nงานย่อย: ' + (t.label || t.task_id) + (inRev ? ' (รอตรวจ)' : '') + '\nผู้ทำ: ' + nameP_(members, t.assignee_email) + '\nผู้ตรวจ: ' + ([t.reviewer_email].concat(coList_(t.co_reviewers)).filter(Boolean).map(e => nameP_(members, e)).join(', ') || '-') + '\n[' + c.title + '] ' + c.content_id + '\nกำหนด: ' + fmtD(t.sla_due_at) + '\n' + baseUrl_();
      if (now.getTime() >= due) {
        const bucket = Math.min(2, Math.floor((now.getTime() - due) / (4 * 3600e3)));
        out.push({ event: 'SLA_BREACH', key: 'SLA_BREACH|' + t.task_id + '|' + due + '|' + bucket, text: line('🔴', 'เกินกำหนด แจ้ง ' + nameOf(who)), to: [who, c.current_owner_email, am && am.email] });
        if (now.getTime() - due > 24 * 3600e3) out.push({ event: 'SLA_ESC', key: 'SLA_ESC|' + t.task_id + '|' + due, text: line('⛔', 'Escalate: เกินกำหนดมากกว่า 1 วัน'), to: execE.concat([am && am.email]) });
      } else if (due > start && (now.getTime() - start) / (due - start) >= 0.8) {
        out.push({ event: 'SLA_WARN', key: 'SLA_WARN|' + t.task_id + '|' + due, text: line('⏰', 'ใกล้ครบกำหนด (ใช้เวลาไป 80%)'), to: [who] });
      }
    });
    // R7: Smart nudge (กันซ้ำด้วย key ใน Notification_Log + ส่งซ้ำเมื่อล้มเหลวด้วย retryFailed_) ไม่ย้ายงาน/โอนผู้ตรวจให้เอง
    const allT = wt, lastAct = {}, dayB = Math.floor(now.getTime() / 86400e3);
    readTail_('Activity_Log', 2500).forEach(l => { if (l.content_id && l.at) { const a = new Date(l.at).getTime(); if (!(lastAct[l.content_id] >= a)) lastAct[l.content_id] = a; } });
    contents.forEach(c => {
      if ([ST.PUB, ST.DONE, ST.CAN].includes(c.current_status)) return;
      const mine = allT.filter(t => t.content_id === c.content_id), head = '[' + c.title + '] ' + c.content_id + '\n' + baseUrl_();
      if (c.current_status === ST.BLK) {   // ติดขัดนาน: เตือน AM ทุก 8 ชม. (สูงสุด 3 ครั้ง)
        const since = new Date(c.blocked_since || c.current_started_at || now).getTime(), h = (now.getTime() - since) / 3600e3;
        if (h >= 8) out.push({ event: 'BLOCKED_STALE', key: 'BLKSTALE|' + c.content_id + '|' + since + '|' + Math.min(2, Math.floor(h / 8) - 1), text: '🛑 งานติดขัดมา ' + Math.floor(h) + ' ชม. ยังไม่มีคนแก้\n' + head, to: [am && am.email] });
        return;
      }
      const act = mine.filter(t => ['Ready for Production', 'In Production', 'Revision Required'].includes(t.status) && !t.wait_since);
      const idle = (now.getTime() - Math.max(lastAct[c.content_id] || 0, c.updated_at ? new Date(c.updated_at).getTime() : 0)) / 3600e3;
      if (act.length && idle >= 24 && c.is_waiting !== true)   // ไม่มีความเคลื่อนไหว ≥ 24 ชม. ทั้งที่มีงานค้าง: เตือนผู้ผลิต วันละครั้ง
        out.push({ event: 'IDLE_NUDGE', key: 'IDLE|' + c.content_id + '|' + dayB, text: '⏰ งานนี้ไม่มีความเคลื่อนไหวมา ' + Math.floor(idle) + ' ชม. มีงานค้าง ' + act.length + ' ชิ้น\n' + head, to: act.map(t => t.assignee_email) });
      mine.filter(t => t.status === ST.SR && !t.review_started_at && t.submitted_at && !t.wait_since).forEach(t => {   // รอเปิดตรวจนาน
        const h = (now.getTime() - new Date(t.submitted_at).getTime()) / 3600e3; if (h < 4) return;
        const rm = memberByEmail(members, t.reviewer_email), bk = rm && rm.backup_email ? memberByEmail(members, rm.backup_email) : null, b = Math.min(3, Math.floor(h / 4));
        out.push({ event: 'REVIEW_STALE', key: 'RVSTALE|' + t.task_id + '|' + new Date(t.submitted_at).getTime() + '|' + b, text: '🔍 งานย่อย "' + (t.label || t.task_id) + '" รอเปิดตรวจมา ' + Math.floor(h) + ' ชม.' +
          (h >= 12 && bk ? '\nถ้าไม่ว่าง AM/ผู้ตรวจ โอนให้ผู้ตรวจสำรอง ' + bk.name + ' ได้' : '') + '\n' + head, to: [t.reviewer_email].concat(h >= 12 ? [am && am.email] : []) });
      });
      if ([ST.CR, ST.AMR, ST.FA].includes(c.current_status) && !c.review_started_at && c.current_started_at) {
        const h = (now.getTime() - new Date(c.current_started_at).getTime()) / 3600e3;
        if (h >= 4) out.push({ event: 'REVIEW_STALE', key: 'RVSTALE|' + c.content_id + '|' + new Date(c.current_started_at).getTime() + '|' + Math.min(3, Math.floor(h / 4)), text: '🔍 งานรอตรวจ (' + c.current_status + ') มา ' + Math.floor(h) + ' ชม. ยังไม่เปิดตรวจ\n' + head, to: [c.current_owner_email].concat(h >= 12 ? [am && am.email] : []) });
      }
    });
    return { out: out, delayed: delayed };
  }
}

function dailyDigest() {
  const now = new Date(), horizon = now.getTime() + 24 * 3600e3;
  const rows = readAll_('Content_Master').filter(c => ![ST.PUB, ST.DONE, ST.CAN].includes(c.current_status));
  const over = rows.filter(c => c.current_due_at && new Date(c.current_due_at).getTime() < now.getTime() && c.current_status !== ST.BLK);
  const soon = rows.filter(c => c.current_due_at && new Date(c.current_due_at).getTime() >= now.getTime() && new Date(c.current_due_at).getTime() <= horizon);
  const blk = rows.filter(c => c.current_status === ST.BLK);
  const pub = rows.filter(c => c.planned_publish_at && new Date(c.planned_publish_at).getTime() <= now.getTime() + 3 * 86400e3 && c.final_approval_status !== 'Approved');
  const li = a => a.slice(0, 8).map(c => '• ' + c.content_id + ' ' + c.title + ' → ' + (c.current_owner_name || '-')).join('\n') || '-';
  const text = '📋 สรุปเช้า ' + Utilities.formatDate(now, TZ, 'dd/MM/yyyy') + '\n🔴 เกิน SLA (' + over.length + ')\n' + li(over) + '\n⏰ ครบใน 24 ชม. (' + soon.length + ')\n' + li(soon) +
    '\n🛑 Blocked (' + blk.length + ')\n' + li(blk) + '\n⚠️ เผยแพร่ใน 3 วันแต่ยังไม่ Approved (' + pub.length + ')\n' + li(pub) + undeliverableLine_();
  sendNotification_({ event: 'DIGEST', key: 'DIGEST|' + Utilities.formatDate(now, TZ, 'yyyyMMdd'), text: text });
}

function integrityCheck() {
  const last = {}; readAll_('Activity_Log').forEach(l => { if (l.content_id && l.to_status) last[l.content_id] = l.to_status; });
  const bad = readAll_('Content_Master').filter(c => last[c.content_id] !== undefined && last[c.content_id] !== c.current_status);
  if (!bad.length) return;
  sendNotification_({ event: 'INTEGRITY', key: 'INTEG|' + Utilities.formatDate(new Date(), TZ, 'yyyyMMdd') + '|' + bad.length,
    text: '🔍 พบสถานะไม่ตรงกับ Activity_Log (มีคนแก้ Sheet ด้วยมือ?)\n' + bad.map(c => c.content_id + ': Sheet=' + c.current_status + ' / Log=' + last[c.content_id]).join('\n') });
}

/* =====================================================================
 * PART 3 — SETUP / VIEWS / KPI
 * ===================================================================== */

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Workflow')
    .addItem('1) Setup ทั้งระบบ (ครั้งแรก)', 'setupAll')
    .addItem('2) อัปเดตฐานข้อมูล V3 (สร้างตารางใหม่)', 'migrateV3')
    .addItem('3) ปิด Action Form เดิม (เลิกใช้แล้ว)', 'retireActionForm')
    .addItem('4) ติดตั้ง Triggers', 'installTriggers')
    .addItem('5) ล็อกชีตประวัติ', 'protectSheets')
    .addItem('สร้างรหัสผูกบัญชี LINE (Mini App)', 'generateBindCodes')
    .addItem('อัปเดตหัวคอลัมน์ v2 (ครั้งเดียว)', 'migrateV2')
    .addItem('ทดสอบส่ง LINE เข้ากลุ่ม', 'testLine')
    .addItem('ทดสอบส่ง LINE หาตัวเอง', 'testPushToMe')
    .addItem('คำนวณ KPI ตอนนี้', 'kpiAggregate')
    .addItem('ล็อกคอลัมน์ระบบ (Content_Master)', 'protectSystemColumns')
    .addItem('ตรวจโครงสร้างชีต', 'schemaCheckMenu')
    .addItem('สร้างชีต Holidays', 'createHolidaysSheet')
    .addToUi();
}

function setupAll() {
  const ss = ss_();
  Object.keys(HEADERS).forEach(n => {
    let s = ss.getSheetByName(n); if (!s) s = ss.insertSheet(n);
    if (s.getLastRow() === 0) { s.getRange(1, 1, 1, HEADERS[n].length).setValues([HEADERS[n]]).setFontWeight('bold').setBackground('#e8eaf6'); s.setFrozenRows(1); }
  });
  seedConfig_(); seedMembers_(); seedChecklists_(); seedChannels_();
  buildKanban_(); buildTaskDetail_(); buildKpiExec_();
  SpreadsheetApp.getUi().alert('Setup เสร็จ\n1) แก้ Team_Members ให้เป็นอีเมลจริง\n2) ใส่ Script Properties (ดู README)\n3) เมนู Workflow > อัปเดตฐานข้อมูล V3 > ติดตั้ง Triggers > ล็อกชีตประวัติ');
}

function migrateV3() {
  const newSheets = {
    Task_Submissions: HEADERS.Task_Submissions,
    Task_Delegations: HEADERS.Task_Delegations,
    Chat_Members: HEADERS.Chat_Members,
    Brief_Change_History: HEADERS.Brief_Change_History,
    Review_Annotations: HEADERS.Review_Annotations,
    Brief_Followups: HEADERS.Brief_Followups,
    Review_Transfers: HEADERS.Review_Transfers
  };
  const ss = ss_();
  // ตารางเดิม: เติมคอลัมน์ใหม่ท้ายตาราง (idempotent) เช่น blocked_since, review_started_at, delegated_by
  ['Content_Master', 'Workflow_Tasks', 'Review_History', 'Team_Members'].forEach(name => {
    const s0 = ss.getSheetByName(name); if (!s0) return;
    const have0 = s0.getLastColumn(), want0 = HEADERS[name];
    if (have0 < want0.length) s0.getRange(1, have0 + 1, 1, want0.length - have0).setValues([want0.slice(have0)]).setFontWeight('bold').setBackground('#e8eaf6');
  });
  Object.keys(newSheets).forEach(name => {
    let s = ss.getSheetByName(name);
    if (!s) {
      s = ss.insertSheet(name);
      s.getRange(1, 1, 1, newSheets[name].length).setValues([newSheets[name]]).setFontWeight('bold').setBackground('#e8eaf6');
      s.setFrozenRows(1);
    } else {
      const have = s.getLastColumn(), want = newSheets[name];
      if (have < want.length) s.getRange(1, have + 1, 1, want.length - have).setValues([want.slice(have)]).setFontWeight('bold').setBackground('#e8eaf6');
    }
  });
  SpreadsheetApp.getUi().alert('Migration V3 เสร็จสิ้น: เพิ่มตารางสำหรับ Submissions, Delegations, Chat Members และ Brief History เรียบร้อยครับ');
}

function seedConfig_() {
  const s = sh_('SLA_Config'); if (s.getLastRow() > 1) return;
  const rows = Object.keys(DEFAULT_SLA).map(k => [k, DEFAULT_SLA[k], k.indexOf('STD_HOURS') === 0 ? 'ชั่วโมงประเมินต่อชิ้น (ใช้คำนวณภาระงาน/Capacity)' : k.indexOf('WEIGHT_HOURS') === 0 ? 'ชั่วโมงมาตรฐาน (ใช้คำนวณ Weighted Output)' : 'วันทำงาน (1 วัน = 24 ชม. นับ จ-ศ)']);
  s.getRange(2, 1, rows.length, 3).setValues(rows);
}
function seedMembers_() {
  const s = sh_('Team_Members'); if (s.getLastRow() > 1) return;
  const rows = [
    ['M01', 'ชื่อ Director', 'director@example.com', POS.DIR, '', false, true, '', true],
    ['M02', 'ชื่อ Asst. Manager', 'am@example.com', POS.AM, '', true, false, '', true],
    ['M03', 'ชื่อ Sr. Graphic', 'srgraphic@example.com', POS.SG, 'Graphic', false, false, '', true],
    ['M04', 'ชื่อ Sr. Video Editor', 'srvideo@example.com', POS.SVE, 'Video', false, false, '', true],
    ['M05', 'ชื่อ Video Editor', 'video@example.com', POS.VE, 'Video', false, false, '', true],
    ['M06', 'ชื่อ Content & Video', 'content@example.com', POS.CV, 'Article', false, false, '', true],
    ['M07', 'ชื่อ Graphic & Video', 'gv@example.com', POS.GV, 'Video,Graphic', false, false, '', true]];
  s.getRange(2, 1, rows.length, rows[0].length).setValues(rows);
}
function seedChecklists_() {
  const s = sh_('Checklist_Templates'); if (s.getLastRow() > 1) return;
  const L = {
    Reels: { PROD: ['Hook 3 วินาทีแรก','อัตราส่วน 9:16','ซับสะกดถูก','เพลง/ภาพไม่ละเมิดลิขสิทธิ์','CTA ท้ายคลิป','ความยาวตาม Brief'],
      SR_VIDEO: ['ภาพ/เสียงคม','จังหวะตัดต่อ','Safe zone','Export ถูกสเปก'] },
    YouTube: { PROD: ['อัตราส่วน 16:9','Intro/Outro','ซับ/Lower third','เสียงสะอาด','ลิขสิทธิ์','ตรง Script','(Thumbnail: สร้างเป็น Task Graphic แยก)'],
      SR_VIDEO: ['คุณภาพภาพ/เสียง','จังหวะ','Chapter ตรงเวลา'] },
    Graphic: { PROD: ['ตรง Brief','ฟอนต์/สีตามแบรนด์','ความละเอียดพอ','ข้อความสะกดถูก'], SR_GRAPHIC: ['Layout/Hierarchy','สี','คุณภาพภาพ'] },
    Banner: { PROD: ['ครบทุกขนาด','น้ำหนักไฟล์ตามกำหนด','Safe zone','CTA ตรงตัว','ลิงก์ปลายทางถูก'], SR_GRAPHIC: ['ทุกขนาดอ่านชัด','สีตรงกันทุกขนาด'] },
    Article: { PROD: ['ตรง Theme','ข้อเท็จจริงมีแหล่งอ้างอิง','สะกด/ไวยากรณ์','CTA','Heading ครบ'], AM_ARTICLE: ['(เนื้อหา) ถูกต้อง/Reference/Tone','(แผน) ครบ Brief/วันเผยแพร่'] }
  };
  const common = { CT1: ['ข้อความถูกต้อง','ตรง Theme','Caption/Title/Description','CTA'], CT2: ['ครบตามแผน','ช่องทางถูก','วัน/เวลาถูก'], FINAL: ['ตรงแบรนด์','ตรง Theme'] };
  const rows = []; let id = 1;
  TYPES.forEach(tp => {
    const steps = Object.assign({}, L[tp]); if (tp !== 'Article') { steps.CT1 = common.CT1; steps.CT2 = common.CT2; } steps.FINAL = common.FINAL;
    Object.keys(steps).forEach(st => steps[st].forEach((txt, i) => rows.push(['CK' + pad(id++, 3), tp, st, i + 1, txt, true, 1])));
  });
  s.getRange(2, 1, rows.length, 7).setValues(rows);
}

function buildKanban_() {
  const s = sh_('Kanban_View') || ss_().insertSheet('Kanban_View'); s.clear();
  const cols = [ST.TP, ST.CD, ST.BR, ST.BA, ST.RFP, ST.IP, ST.SR, ST.RR, ST.CR, ST.AMR, ST.FA, ST.RTP, ST.PUB, ST.DONE, ST.BLK, ST.CAN];
  const A = colOf_('Content_Master', 'content_id'), B = colOf_('Content_Master', 'title'), T = colOf_('Content_Master', 'content_type'),
    O = colOf_('Content_Master', 'current_owner_name'), D = colOf_('Content_Master', 'current_due_at'), S = colOf_('Content_Master', 'current_status');
  const color = ['#d9d9d9','#cfe2ff','#fff3cd','#d1e7dd','#d9d9d9','#cfe2ff','#ffe0b3','#fff3cd','#fff3cd','#e2d9f3','#d1e7dd','#d1e7dd','#a3cfbb','#e9ecef','#f8d7da','#adb5bd'];
  cols.forEach((name, i) => {
    const c0 = i * 5 + 1;
    s.getRange(1, c0, 1, 4).merge().setValue(name).setFontWeight('bold').setBackground(color[i]).setHorizontalAlignment('center');
    s.getRange(2, c0, 1, 4).setValues([['ID', 'ชื่องาน', 'ผู้รับผิดชอบ', 'กำหนด']]).setFontStyle('italic');
    const nm = name.replace(/'/g, "''");
    const q = '=IFERROR(QUERY(Content_Master!A:AA,"select ' + A + ',' + B + ',' + O + ',' + D + ' where ' + S + ' = \'' + nm + '\'",0),"")';
    s.getRange(3, c0).setFormula(q);
    s.setColumnWidth(c0, 110); s.setColumnWidth(c0 + 1, 200); s.setColumnWidth(c0 + 2, 120); s.setColumnWidth(c0 + 3, 100); s.setColumnWidth(c0 + 4, 20);
  });
  s.setFrozenRows(2);
  s.getRange('A1').setNote('Kanban แบบอ่านอย่างเดียว ลากการ์ดไม่ได้ ใช้ Mini App เปลี่ยนสถานะ');
}

function buildTaskDetail_() {
  const s = sh_('Task_Detail') || ss_().insertSheet('Task_Detail'); s.clear();
  s.getRange('A1').setValue('พิมพ์ Content ID ที่ช่องขวา →').setFontWeight('bold');
  s.getRange('B1').setBackground('#fff3cd');
  const fields = ['title','content_type','channel','theme','pillar','objective','cta','reference_url','detail','current_status','current_gate','current_owner_name',
    'current_due_at','is_waiting','planned_publish_at','actual_publish_at','publish_url','final_approval_status','priority','brief_current_id'];
  fields.forEach((f, i) => {
    s.getRange(i + 2, 1).setValue(f).setFontWeight('bold');
    const col = colOf_('Content_Master', f);
    s.getRange(i + 2, 2).setFormula('=IFERROR(INDEX(Content_Master!' + col + ':' + col + ',MATCH($B$1,Content_Master!A:A,0)),"")');
  });
  const r0 = fields.length + 4;
  s.getRange(r0, 1).setValue('Brief ทุกเวอร์ชัน').setFontWeight('bold');
  s.getRange(r0 + 1, 1).setFormula('=IFERROR(FILTER(Brief_Versions!A:K,Brief_Versions!B:B=$B$1),"")');
  s.getRange(r0 + 8, 1).setValue('ประวัติการตรวจ').setFontWeight('bold');
  s.getRange(r0 + 9, 1).setFormula('=IFERROR(FILTER(Review_History!A:O,Review_History!C:C=$B$1),"")');
  s.getRange(r0 + 20, 1).setValue('Checklist ของประเภทงานนี้').setFontWeight('bold');
  s.getRange(r0 + 21, 1).setFormula('=IFERROR(SORT(FILTER({Checklist_Templates!C:C,Checklist_Templates!D:D,Checklist_Templates!E:E},Checklist_Templates!B:B=$B$3),1,TRUE,2,TRUE),"")');
  s.getRange(r0 + 40, 1).setValue('Timeline (Activity_Log)').setFontWeight('bold');
  s.getRange(r0 + 41, 1).setFormula('=IFERROR(SORT(FILTER(Activity_Log!A:L,Activity_Log!B:B=$B$1),10,TRUE),"")');
  s.setColumnWidth(1, 200); s.setColumnWidth(2, 320);
}

function buildKpiExec_() {
  const s = sh_('KPI_Exec') || ss_().insertSheet('KPI_Exec'); s.clear();
  s.getRange('A1').setValue('KPI ภาพรวม (ข้อมูลจาก KPI_Data รันทุกคืน) — ดูนิยามสูตรใน README').setFontWeight('bold');
  s.getRange('A3').setValue('เลือกเดือน (YYYY-MM)'); s.getRange('B3').setValue(Utilities.formatDate(new Date(), TZ, 'yyyy-MM')).setBackground('#fff3cd');
  s.getRange('A5').setFormula('=IFERROR(QUERY(KPI_Data!A:I,"select C,D,E,F,G,H where B = \'"&$B$3&"\' order by D,C,E",1),"ยังไม่มีข้อมูล")');
}

function retireActionForm() {
  const props = PropertiesService.getScriptProperties(), id = props.getProperty('FORM_ID');
  let msg = [];
  if (id) {
    try { FormApp.openById(id).setAcceptingResponses(false); msg.push('ปิดรับคำตอบของฟอร์มแล้ว'); }
    catch (e) { msg.push('เปิดฟอร์มไม่ได้ (' + e.message + ') ให้ปิดรับคำตอบด้วยมือ'); }
    props.deleteProperty('FORM_ID');
  } else msg.push('ไม่พบ FORM_ID ถ้าเคยสร้างฟอร์มไว้ ให้เปิดฟอร์มแล้วปิด Accepting responses ด้วยมือ');
  let n = 0;
  ScriptApp.getProjectTriggers().forEach(t => { if (t.getHandlerFunction() === 'onActionSubmit') { ScriptApp.deleteTrigger(t); n++; } });
  msg.push('ลบ trigger ฟอร์ม ' + n + ' ตัว');
  msg.push('ขั้นต่อไป: ตรวจชีต "Form Responses" แล้ว Unlink form / ลบฟอร์มใน Drive');
  SpreadsheetApp.getUi().alert(msg.join('\n'));
}


function protectSheets() {
  const me = Session.getEffectiveUser();
  // กลุ่ม 1: ประวัติ/หลักฐาน → เฉพาะเจ้าของสคริปต์แก้ได้ (Web App รันในนามเจ้าของจึงเขียนได้ปกติ)
  ['Activity_Log', 'Review_History', 'Brief_Versions', 'Notification_Log', 'KPI_Data', 'Task_Submissions', 'Task_Delegations', 'Chat_Members', 'Brief_Change_History', 'Review_Annotations', 'Brief_Followups', 'Review_Transfers'].forEach(n => {
    const sh = sh_(n); if (!sh) return;   // ยังไม่มีชีต (ยังไม่รัน migrate) ให้ข้าม
    sh.getProtections(SpreadsheetApp.ProtectionType.SHEET).forEach(x => x.remove());
    const p = sh.protect().setDescription('ระบบเท่านั้นเขียนได้');
    p.addEditor(me); p.removeEditors(p.getEditors().filter(u => u.getEmail() !== me.getEmail()));
    if (p.canDomainEdit()) p.setDomainEdit(false);
  });
  // กลุ่ม 2: ตารางหลักที่ Two-way Sync (onEdit) ยังต้องให้คนแก้จากชีตได้ → แสดงคำเตือนก่อนแก้ ไม่ห้าม (ฟิลด์ระบบถูกกันใน onEdit อยู่แล้ว)
  ['Content_Master', 'Workflow_Tasks', 'Content_Calendar', 'Team_Members'].forEach(n => {
    const sh = sh_(n); if (!sh) return;
    sh.getProtections(SpreadsheetApp.ProtectionType.SHEET).forEach(x => x.remove());
    sh.protect().setDescription('ตารางหลัก: แก้มือได้เฉพาะที่จำเป็น ระบบบันทึกการแก้ไว้ใน Activity_Log').setWarningOnly(true);
  });
  SpreadsheetApp.getUi().alert('ล็อกแล้ว\n- ชีตประวัติ/หลักฐาน: เฉพาะเจ้าของสคริปต์แก้ได้\n- Content_Master, Workflow_Tasks, Content_Calendar, Team_Members: ขึ้นคำเตือนก่อนแก้ (Two-way Sync ยังใช้ได้)');
}

function testLine() {
  const st = sendLine_('✅ ทดสอบระบบแจ้งเตือน Content Workflow ' + Utilities.formatDate(new Date(), TZ, 'HH:mm'));
  SpreadsheetApp.getUi().alert('ผลส่ง: ' + st);
}

/* ---------- KPI (รันทุกคืน) ---------- */
function kpiAggregate() {
  const now = new Date();
  const periods = [Utilities.formatDate(now, TZ, 'yyyy-MM'), Utilities.formatDate(new Date(now.getFullYear(), now.getMonth() - 1, 15), TZ, 'yyyy-MM')];
  const cfg = loadCfg_(); const members = normMembers_();
  const contents = readAll_('Content_Master'); const cmap = {}; contents.forEach(c => { cmap[c.content_id] = c; });
  const tasks = readAll_('Workflow_Tasks'), reviews = readAll_('Review_History');
  const per = d => d ? Utilities.formatDate(new Date(d), TZ, 'yyyy-MM') : '';
  const rows = [];
  const add = (p, email, kind, metric, num, den, val) => rows.push({ period: p, member_email: email, role_kind: kind, metric: metric, numerator: num, denominator: den, value: val });
  const avg = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : '';
  periods.forEach(p => {
    members.forEach(m => {
      const mine = tasks.filter(t => String(t.assignee_email).toLowerCase() === m.email && per(t.sla_start_at) === p);
      if (mine.length) {
        const sub = mine.filter(t => t.first_submitted_at);
        add(p, m.email, 'producer', 'assigned', mine.length, '', mine.length);
        add(p, m.email, 'producer', 'submitted', sub.length, mine.length, sub.length);
        const ot = sub.filter(t => t.first_on_time === true || String(t.first_on_time).toUpperCase() === 'TRUE').length;
        add(p, m.email, 'producer', 'on_time_submission_rate', ot, sub.length, sub.length ? ot / sub.length : '');
        add(p, m.email, 'producer', 'sla_breach_count', sub.length - ot, sub.length, sub.length - ot);
        const r1 = reviews.filter(r => r.gate_code === 'SR' && String(r.producer_email).toLowerCase() === m.email && Number(r.round_no) === 1 && per(r.decided_at) === p);
        const ok1 = r1.filter(r => r.result === 'Approved').length;
        add(p, m.email, 'producer', 'first_pass_approval_rate', ok1, r1.length, r1.length ? ok1 / r1.length : '');
        const pe = mine.reduce((x, t) => x + Number(t.rev_count_producer || 0), 0);
        add(p, m.email, 'producer', 'avg_revisions_producer_error', pe, sub.length, sub.length ? pe / sub.length : '');
        const bc = mine.reduce((x, t) => x + Number(t.rev_count_brief || 0), 0);
        add(p, m.email, 'producer', 'revisions_from_brief_change', bc, '', bc);
        const hrs = sub.filter(t => t.started_at).map(t => (new Date(t.first_submitted_at) - new Date(t.started_at)) / 3600e3 - Number(t.wait_minutes || 0) / 60);
        add(p, m.email, 'producer', 'avg_production_hours_excl_wait', '', hrs.length, avg(hrs));
        const w = sub.reduce((x, t) => x + Number(cfg['WEIGHT_HOURS|' + (cmap[t.content_id] || {}).content_type] || 0), 0);
        add(p, m.email, 'producer', 'weighted_output_hours', '', sub.length, w);
      }
      const rv = reviews.filter(r => String(r.reviewer_email).toLowerCase() === m.email && per(r.decided_at) === p);
      const kind = isExecPos_(m.position) ? 'approver' : 'reviewer';
      const rvNF = rv.filter(r => r.gate_code !== 'FINAL' || kind === 'approver');
      if (rvNF.length) {
        const ta = rvNF.map(r => (new Date(r.decided_at) - new Date(r.requested_at)) / 3600e3);
        add(p, m.email, kind, 'avg_turnaround_hours (รอคิว+ตรวจรวมกัน)', '', rvNF.length, avg(ta));
        const qd = rvNF.filter(r => r.opened_at);   // R3: แยกเวลารอคิว (requested→opened) กับเวลาตรวจ (opened→decided)
        if (qd.length) {
          add(p, m.email, kind, 'review_queue_time_hours', '', qd.length, avg(qd.map(r => (new Date(r.opened_at) - new Date(r.requested_at)) / 3600e3)));
          add(p, m.email, kind, 'review_processing_time_hours', '', qd.length, avg(qd.map(r => (new Date(r.decided_at) - new Date(r.opened_at)) / 3600e3)));
        }
        const ot = rvNF.filter(r => r.on_time === true || String(r.on_time).toUpperCase() === 'TRUE').length;
        add(p, m.email, kind, 'review_sla_compliance', ot, rvNF.length, ot / rvNF.length);
        add(p, m.email, kind, 'overdue_reviews', rvNF.length - ot, rvNF.length, rvNF.length - ot);
        const okN = rvNF.filter(r => r.result === 'Approved' || r.result === 'Approved_with_Follow_up').length;
        add(p, m.email, kind, 'reviews_total', '', '', rvNF.length);
        add(p, m.email, kind, 'reviews_passed', okN, rvNF.length, okN);
        add(p, m.email, kind, 'reviews_returned', rvNF.length - okN, rvNF.length, rvNF.length - okN);
        add(p, m.email, kind, 'review_pass_rate', okN, rvNF.length, okN / rvNF.length);
        if (kind === 'approver') {
          const fin = rvNF.filter(r => r.gate_code === 'FINAL' && cmap[r.content_id] && cmap[r.content_id].planned_publish_at);
          const early = fin.filter(r => new Date(r.decided_at) <= new Date(new Date(cmap[r.content_id].planned_publish_at) - 24 * 3600e3)).length;
          add(p, m.email, kind, 'approved_before_t24_rate', early, fin.length, fin.length ? early / fin.length : '');
        }
      }
    });
    const posOf = {}; members.forEach(m => { posOf[m.email] = m.position; });
    const byPos = {};
    reviews.filter(r => per(r.decided_at) === p).forEach(r => { const ps = posOf[String(r.reviewer_email).toLowerCase()]; if (ps) (byPos[ps] = byPos[ps] || []).push(r); });
    Object.keys(byPos).forEach(ps => {
      const a = byPos[ps], okN = a.filter(r => r.result === 'Approved' || r.result === 'Approved_with_Follow_up').length, ot = a.filter(r => r.on_time === true || String(r.on_time).toUpperCase() === 'TRUE').length;
      const key = 'POS:' + ps;
      add(p, key, 'position', 'reviews_total', '', '', a.length);
      add(p, key, 'position', 'reviews_passed', okN, a.length, okN);
      add(p, key, 'position', 'reviews_returned', a.length - okN, a.length, a.length - okN);
      add(p, key, 'position', 'review_pass_rate', okN, a.length, okN / a.length);
      add(p, key, 'position', 'review_sla_compliance', ot, a.length, ot / a.length);
    });
    // Brief: นับจากเหตุการณ์ที่บันทึกจริงเท่านั้น (ไม่เดาจากการตกลงปากเปล่าที่ไม่ได้บันทึก)
    const bl = readAll_('Activity_Log').filter(l => per(l.at) === p && ['brief_approved', 'brief_approved_followup', 'brief_returned'].indexOf(l.event_type) >= 0);
    if (bl.length) {
      const bc = bl.filter(l => l.event_type === 'brief_approved').length, bf = bl.filter(l => l.event_type === 'brief_approved_followup').length, br = bl.filter(l => l.event_type === 'brief_returned').length;
      add(p, 'TEAM', 'brief', 'brief_clean_approved', bc, bl.length, bc); add(p, 'TEAM', 'brief', 'brief_conditional_approved', bf, bl.length, bf); add(p, 'TEAM', 'brief', 'brief_returned', br, bl.length, br);
      add(p, 'TEAM', 'brief', 'brief_clean_approval_rate', bc, bl.length, bc / bl.length);
    }
    const pubs = contents.filter(c => c.actual_publish_at && per(c.planned_publish_at) === p);
    const onSched = pubs.filter(c => Utilities.formatDate(new Date(c.actual_publish_at), TZ, 'yyyyMMdd') <= Utilities.formatDate(new Date(c.planned_publish_at), TZ, 'yyyyMMdd')).length;
    add(p, 'TEAM', 'team', 'published_on_schedule_rate', onSched, pubs.length, pubs.length ? onSched / pubs.length : '');
    const lead = pubs.map(c => (new Date(c.actual_publish_at) - new Date(c.created_at)) / 86400e3);
    add(p, 'TEAM', 'team', 'avg_lead_time_days', '', pubs.length, avg(lead));
  });
  kpiWrite_(rows, now);
}

/* =====================================================================
 * PART 4 — TWO-WAY SYNC (ดักจับเมื่อมนุษย์แก้ Sheet)
 * ===================================================================== */

// ตรวจ Content ที่ค้างในด่านตรวจทั้งที่ยังมีงานบังคับไม่ผ่านครบ/ขาดสายงาน (ข้อมูลเก่าก่อนใช้กติกา R6) — รันมือหนึ่งครั้งหลังติดตั้ง ไม่แก้ข้อมูลใด ๆ
function auditLegacyGates() {
  const cfg = loadCfg_(), tasks = readAll_('Workflow_Tasks'), rows = [];
  readAll_('Content_Master').forEach(c => {
    if (![ST.CR, ST.AMR, ST.FA].includes(c.current_status)) return;
    const ds = deliv_(cfg, c, tasks.filter(t => t.content_id === c.content_id));
    if (ds.pending.length || ds.missing_lanes.length) rows.push(c.content_id + ' [' + c.current_status + '] ' + (ds.pending.length ? 'ยังไม่ผ่าน: ' + ds.pending.join(', ') : '') + (ds.missing_lanes.length ? ' ขาดสาย: ' + ds.missing_lanes.join(', ') : ''));
  });
  SpreadsheetApp.getUi().alert(rows.length ? 'พบ ' + rows.length + ' งานที่อยู่ในด่านตรวจแต่งานย่อยยังไม่ครบตามกติกาใหม่ (ระบบจะไม่ให้อนุมัติจนกว่าจะแก้):\n\n' + rows.join('\n') + '\n\nวิธีแก้: ให้ผู้ตรวจส่งกลับแก้ หรือ AM มอบหมาย/ปรับงานบังคับ' : 'ไม่พบงานค้างที่ขัดกติกาใหม่');
  return rows;
}

/* =====================================================================
 * PART 5 — รวมจาก Patch P0 + P1 (Sheet IO, SLA, Holidays, Backup, Two-way sync)
 * ===================================================================== */

/* =====================================================================
 * 5.1 TWO-WAY SYNC / TRIGGERS (จาก P0)
 * ===================================================================== */
/* =====================================================================
 * 3) TWO-WAY SYNC
 * ===================================================================== */
const SYSTEM_FIELDS_ = ['current_status', 'current_owner_email', 'final_approval_status', 'publish_url'];
const EDITABLE_FIELDS_ = ['title', 'planned_publish_at', 'detail', 'funnel', 'channel_account'];
const MANAGED_TRIGGERS_ = ['slaMonitor', 'dailyDigest', 'kpiAggregate', 'integrityCheck', 'onEditInstalled', 'onActionSubmit', 'nightlyMaintenance'];

// ต้องติดตั้งเป็น installable trigger (installTriggers ด้านล่างทำให้) เพราะ simple trigger เรียก UrlFetch ไม่ได้
function onEditInstalled(e) {
  if (!e || !e.range) return;
  const sh = e.range.getSheet(), name = sh.getName();
  if (name !== 'Content_Master' && name !== 'Themes') return;
  const r0 = e.range.getRow(), nRows = e.range.getNumRows(), c0 = e.range.getColumn(), nCols = e.range.getNumColumns();
  if (r0 + nRows - 1 < 2) return;                       // แก้แค่แถวหัวตาราง
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) { console.error('onEditInstalled: lock busy, skipped'); return; }
  try {
    const who = (e.user && e.user.getEmail && e.user.getEmail()) || Session.getActiveUser().getEmail() || 'unknown';
    const head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
    const cols = head.slice(c0 - 1, c0 - 1 + nCols);
    const firstRow = Math.max(2, r0), lastRow = Math.min(r0 + nRows - 1, firstRow + 199);   // กันวางทีเป็นพันแถว
    const log = (cid, type, reason) => appendRow_('Activity_Log', {
      log_id: 'LOG-' + Utilities.getUuid().slice(0, 8), content_id: cid, event_type: type, actor_email: who, reason: reason, at: new Date(), source: 'sheet' });

    if (name === 'Themes') {
      if (cols.indexOf('name') < 0) return;
      const ids = sh.getRange(2, 1, Math.max(1, sh.getLastRow() - 1), 1).getValues().map(r => String(r[0] || ''));
      let seq = ids.reduce((m, id) => Math.max(m, parseInt(id.split('-').pop(), 10) || 0), 0);
      for (let row = firstRow; row <= lastRow; row++) {
        if (!sh.getRange(row, 2).getValue()) continue;
        if (!ids[row - 2]) { seq++; sh.getRange(row, 1).setValue('THM-' + new Date().getFullYear() + '-' + pad(seq, 3)); }   // max+1 ไม่ใช้เลขแถว (กัน ID ชน)
      }
      log('', 'theme_edited_via_sheet', 'แก้ Theme ใน Sheet (' + (lastRow - firstRow + 1) + ' แถว)');
      bump_();
      return;
    }

    // ----- Content_Master -----
    const sys = cols.filter(c => SYSTEM_FIELDS_.indexOf(c) >= 0);
    if (sys.length) {
      const single = nRows === 1 && nCols === 1;
      if (single) e.range.setValue(e.oldValue === undefined ? '' : e.oldValue);   // ย้อนค่าเดิมได้เฉพาะแก้เซลล์เดียว
      const cid = sh.getRange(firstRow, 1).getValue();
      log(cid, 'rejected_sheet_edit', 'แก้ฟิลด์ระบบ (' + sys.join(',') + ') ใน Sheet โดย ' + who + (single ? ' — ย้อนค่าแล้ว' : ' — วาง/ลากหลายเซลล์ ย้อนอัตโนมัติไม่ได้ ต้องตรวจด้วยมือ'));
      sendNotification_({ event: 'INTEGRITY', key: 'EDIT_BLOCK|' + cid + '|' + Date.now(),
        text: '🛑 มีการแก้ฟิลด์ระบบ (' + sys.join(', ') + ') ใน Google Sheet โดย ' + who + '\nงาน: ' + (cid || '-') + (single ? '\nระบบย้อนค่าเดิมแล้ว' : '\n⚠️ แก้หลายเซลล์ ระบบย้อนให้ไม่ได้ กรุณาตรวจ Activity_Log / รัน integrityCheck') });
      bump_();
      return;
    }
    if (cols.some(c => EDITABLE_FIELDS_.indexOf(c) >= 0)) {
      const uCol = head.indexOf('updated_at') + 1;
      for (let row = firstRow; row <= lastRow; row++) {
        const cid = sh.getRange(row, 1).getValue(); if (!cid) continue;
        if (uCol > 0) sh.getRange(row, uCol).setValue(new Date());   // เขียนเซลล์เดียว ไม่ทับทั้งแถว (เดิม updateRow_ เสี่ยง lost update)
        log(cid, 'sheet_edited', 'แก้ ' + cols.filter(c => EDITABLE_FIELDS_.indexOf(c) >= 0).join(',') + ' ผ่าน Sheet');
      }
      bump_();
    }
  } finally { lock.releaseLock(); }
}

// ล็อกคอลัมน์ระบบแบบ "ห้ามจริง" (เฉพาะเจ้าของสคริปต์แก้ได้) กันวาง/ลากหลายเซลล์ที่ onEdit ย้อนค่าไม่ได้
// Web App รันในนามเจ้าของ จึงเขียนได้ตามปกติ
function protectSystemColumns() {
  const sh = sh_('Content_Master'); if (!sh) return;
  const me = Session.getEffectiveUser(), head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  sh.getProtections(SpreadsheetApp.ProtectionType.RANGE).forEach(p => { if (String(p.getDescription()).indexOf('SYSTEM_COL:') === 0) p.remove(); });
  const done = [];
  SYSTEM_FIELDS_.forEach(f => {
    const ci = head.indexOf(f); if (ci < 0) return;
    const p = sh.getRange(2, ci + 1, Math.max(1, sh.getMaxRows() - 1), 1).protect().setDescription('SYSTEM_COL:' + f);
    p.addEditor(me);
    p.removeEditors(p.getEditors().filter(u => u.getEmail() !== me.getEmail()));
    if (p.canDomainEdit()) p.setDomainEdit(false);
    done.push(f);
  });
  SpreadsheetApp.getUi().alert('ล็อกคอลัมน์ระบบแล้ว: ' + done.join(', ') + '\n(เฉพาะเจ้าของสคริปต์/Web App แก้ได้)');
}

// แทนของเดิม: ลบเฉพาะ trigger ที่ระบบจัดการเอง (ไม่ลบ trigger อื่นที่เพิ่มไว้) + เพิ่ม installable onEdit
function installTriggers() {
  ScriptApp.getProjectTriggers().forEach(t => { if (MANAGED_TRIGGERS_.indexOf(t.getHandlerFunction()) >= 0) ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('slaMonitor').timeBased().everyMinutes(15).create();
  ScriptApp.newTrigger('dailyDigest').timeBased().atHour(9).everyDays(1).inTimezone(TZ).create();
  ScriptApp.newTrigger('kpiAggregate').timeBased().atHour(23).everyDays(1).inTimezone(TZ).create();
  ScriptApp.newTrigger('integrityCheck').timeBased().atHour(23).nearMinute(30).everyDays(1).inTimezone(TZ).create();
  ScriptApp.newTrigger('nightlyMaintenance').timeBased().atHour(2).everyDays(1).inTimezone(TZ).create();
  ScriptApp.newTrigger('onEditInstalled').forSpreadsheet(ss_()).onEdit().create();
  SpreadsheetApp.getUi().alert('ติดตั้ง Triggers แล้ว: SLA ทุก 15 นาที, Digest 09:00, KPI 23:00, Integrity 23:30, Backup/ดูแลระบบ 02:00, onEdit (installable)');
}

/* =====================================================================
 * 5.2 SHEET IO ตามหัวคอลัมน์จริง (จาก P1-A)
 * ===================================================================== */
const _hdrCache = {};
function hdr_(name) {
  if (_hdrCache[name]) return _hdrCache[name];
  const s = sh_(name);
  return (_hdrCache[name] = s.getRange(1, 1, 1, Math.max(1, s.getLastColumn())).getValues()[0].map(String));
}
function readTail_(name, n) {
  const s = sh_(name), last = s.getLastRow(); if (last < 2) return [];
  const h = hdr_(name), start = Math.max(2, last - n + 1);
  return s.getRange(start, 1, last - start + 1, h.length).getValues().map((r, i) => { const o = { _row: start + i }; h.forEach((k, j) => { o[k] = r[j]; }); return o; });
}
function appendRows_(name, objs) {
  if (!objs.length) return;
  const s = sh_(name), h = hdr_(name);
  s.getRange(s.getLastRow() + 1, 1, objs.length, h.length).setValues(objs.map(o => h.map(k => o[k] === undefined ? '' : safe_(o[k]))));
}
function appendRow_(name, obj) {
  const h = hdr_(name);
  sh_(name).appendRow(h.map(k => obj[k] === undefined ? '' : safe_(obj[k])));
}
function updateRow_(name, rowNo, obj) {
  const s = sh_(name), h = hdr_(name);
  const rng = s.getRange(rowNo, 1, 1, h.length), row = rng.getValues()[0];
  h.forEach((k, j) => { if (obj[k] !== undefined) row[j] = safe_(obj[k]); });
  rng.setValues([row]);
}
// คืนรายการปัญหา (ว่าง = ปกติ) — ขาดคอลัมน์ = เขียนข้อมูลบางฟิลด์ทิ้งเงียบ ๆ ต้องแก้
function schemaCheck_(includeMissingSheets) {
  const bad = [];
  Object.keys(HEADERS).forEach(name => {
    const s = sh_(name);
    if (!s) { if (includeMissingSheets) bad.push(name + ': ไม่พบชีต'); return; }
    const real = s.getRange(1, 1, 1, Math.max(1, s.getLastColumn())).getValues()[0].map(String);
    const miss = HEADERS[name].filter(k => real.indexOf(k) < 0);
    if (miss.length) bad.push(name + ': ขาดคอลัมน์ ' + miss.join(', '));
  });
  return bad;
}
function schemaCheckMenu() {
  const bad = schemaCheck_(true);
  SpreadsheetApp.getUi().alert(bad.length ? 'พบปัญหา:\n' + bad.join('\n') : 'โครงสร้างชีตครบทุกคอลัมน์ ✅');
}

/* =====================================================================
 * 5.3 HELPERS: dedupe hash / lock
 * ===================================================================== */
// hash สั้น ๆ ของข้อความ ใส่ท้าย key ของ note() กันแจ้งเตือนต่างงานย่อยชนกันในนาทีเดียว
function h32_(s) { let h = 5381; s = String(s); for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); }
function withLock_(fn, ms) {
  const lock = LockService.getScriptLock(); lock.waitLock(ms || 20000);
  try { return fn(); } finally { lock.releaseLock(); }
}

/* =====================================================================
 * 5.4 SLA MONITOR + CALENDAR FLUSH (จาก P1-D)
 * ===================================================================== */
function slaMonitor() {
  loadHolidays_();
  const r = slaCompute_();
  withLock_(() => {
    r.delayed.forEach(d => { if (d.cid) syncCalendarRow_(d.cid, true, d.reason); else appendRow_(d.name, d.log); });
    sendNotifications_(r.out);
  }, 20000);
  flushCalendar_();
  retryFailed_();
}
function flushCalendar_() {
  const cs = {}; readAll_('Content_Master').forEach(c => { cs[c.content_id] = c; });
  const tbc = {}; readAll_('Workflow_Tasks').forEach(t => {
    if (['Passed', 'Done', 'Cancelled', 'Superseded'].includes(t.status)) return;
    (tbc[t.content_id] = tbc[t.content_id] || []).push(t);
  });
  const writes = []; let n = 0;
  readAll_('Content_Calendar').forEach(r => {
    const c = cs[r.content_id]; if (!c || n >= 15) return;
    const cancelled = r.calendar_status === 'Cancelled' || c.current_status === ST.CAN;
    const guests = cancelled ? [] : calGuests_(c, tbc);
    const sig = calSig_(c, r.calendar_status) + '|' + guests.join(',');
    if (sig === r.gcal_sig) return;
    if (cancelled && !r.gcal_event_id) { writes.push({ row: r._row, f: { gcal_sig: sig } }); return; }
    n++; const ev = syncGcal_(c, r.calendar_status, r.gcal_event_id, guests, cancelled);   // เรียก Calendar API นอกล็อก (ช้า)
    writes.push({ row: r._row, f: { gcal_event_id: cancelled ? (ev === 'DELETED' ? '' : r.gcal_event_id) : (ev || r.gcal_event_id), gcal_sig: cancelled && ev !== 'DELETED' ? '' : sig } });
  });
  if (writes.length) withLock_(() => writes.forEach(w => updateRow_('Content_Calendar', w.row, w.f)), 20000);
}

/* =====================================================================
 * 5.5 KPI WRITE / HOLIDAYS / NIGHTLY (จาก P1-E,G,H)
 * ===================================================================== */
function kpiWrite_(rows, now) {
  const s = sh_('KPI_Data'), h = hdr_('KPI_Data'), ki = h.indexOf('kpi_id'), last = s.getLastRow();
  const vals = last >= 2 ? s.getRange(2, 1, last - 1, h.length).getValues() : [], idx = {}, fresh = [];
  vals.forEach((r, i) => { idx[r[ki]] = i; });
  rows.forEach(r => {
    r.calculated_at = now; const k = r.period + '|' + r.member_email + '|' + r.metric; r.kpi_id = k;
    const line = h.map(c => r[c] === undefined ? '' : safe_(r[c]));
    if (idx[k] !== undefined) vals[idx[k]] = line; else fresh.push(line);
  });
  withLock_(() => {
    if (vals.length) s.getRange(2, 1, vals.length, h.length).setValues(vals);
    if (fresh.length) s.getRange(s.getLastRow() + 1, 1, fresh.length, h.length).setValues(fresh);
  }, 20000);
}

let HOLIDAYS_ = {};
function dayKey_(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1, 2) + '-' + pad(d.getDate(), 2); }
function isOff_(d) { const g = d.getDay(); return g === 0 || g === 6 || HOLIDAYS_[dayKey_(d)] === true; }
function loadHolidays_() {
  HOLIDAYS_ = {};
  try {
    const s = sh_('Holidays'); if (!s || s.getLastRow() < 2) return;
    s.getRange(2, 1, s.getLastRow() - 1, 1).getValues().forEach(r => {
      const d = r[0] instanceof Date ? r[0] : new Date(String(r[0]).trim());
      if (!isNaN(d.getTime())) HOLIDAYS_[dayKey_(d)] = true;
    });
  } catch (e) { console.error('holidays', e); }
}
function addWorkDays(d, n) {
  let r = new Date(d.getTime()), whole = Math.floor(n);
  const frac = n - whole;
  while (whole > 0) { r.setDate(r.getDate() + 1); if (!isOff_(r)) whole--; }
  r = new Date(r.getTime() + frac * 86400000);
  while (isOff_(r)) r.setDate(r.getDate() + 1);
  return r;
}
function createHolidaysSheet() {
  let s = sh_('Holidays');
  if (!s) { s = ss_().insertSheet('Holidays'); s.getRange(1, 1, 1, 2).setValues([['date', 'name']]); s.getRange('A2:A').setNumberFormat('yyyy-mm-dd'); }
  SpreadsheetApp.getUi().alert('ชีต Holidays พร้อมแล้ว: ใส่วันหยุดนักขัตฤกษ์/วันหยุดบริษัทที่คอลัมน์ A (รูปแบบ yyyy-mm-dd) ระบบจะข้ามวันเหล่านี้ตอนคำนวณ SLA');
}

/* =====================================================================
 * H) NIGHTLY: backup + schema check + archive
 * ===================================================================== */
function backupSpreadsheet_() {
  const ss = ss_(), fid = prop_('BACKUP_FOLDER_ID'), keep = Number(prop_('BACKUP_KEEP_DAYS')) || 30;
  const prefix = ss.getName() + ' [backup] ', name = prefix + Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
  const folder = fid ? DriveApp.getFolderById(fid) : DriveApp.getRootFolder();
  if (folder.getFilesByName(name).hasNext()) return 'exists';
  DriveApp.getFileById(ss.getId()).makeCopy(name, folder);
  const cutoff = Date.now() - keep * 86400e3, it = folder.searchFiles('title contains "[backup]"');
  while (it.hasNext()) { const f = it.next(); if (f.getName().indexOf(prefix) === 0 && f.getDateCreated().getTime() < cutoff) f.setTrashed(true); }
  return 'ok';
}
function archiveNotificationLog_(keepDays) {
  const s = sh_('Notification_Log'); if (!s || s.getLastRow() < 2) return 0;
  const h = hdr_('Notification_Log'), ai = h.indexOf('sent_at'); if (ai < 0) return 0;
  const cutoff = Date.now() - keepDays * 86400e3;
  return withLock_(() => {
    const vals = s.getRange(2, 1, s.getLastRow() - 1, h.length).getValues();
    const old = [], keep = [];
    vals.forEach(r => { const t = r[ai] ? new Date(r[ai]).getTime() : 0; (t && t < cutoff && String(r[h.indexOf('status')]).indexOf('failed') !== 0 ? old : keep).push(r); });
    if (!old.length) return 0;
    let a = sh_('Notification_Log_Archive');
    if (!a) { a = ss_().insertSheet('Notification_Log_Archive'); a.getRange(1, 1, 1, h.length).setValues([h]); }
    a.getRange(a.getLastRow() + 1, 1, old.length, h.length).setValues(old);
    s.getRange(2, 1, vals.length, h.length).clearContent();
    if (keep.length) s.getRange(2, 1, keep.length, h.length).setValues(keep);
    return old.length;
  }, 25000);
}
function nightlyMaintenance() {
  let bk = '';
  try { bk = backupSpreadsheet_(); } catch (e) { console.error('backup', e); bk = 'ERR ' + e; }
  const bad = schemaCheck_(false);
  const msgs = [];
  if (String(bk).indexOf('ERR') === 0) msgs.push('💾 Backup ล้มเหลว: ' + bk);
  if (bad.length) msgs.push('🧱 โครงสร้างชีตไม่ครบ (ข้อมูลบางฟิลด์จะไม่ถูกบันทึก):\n' + bad.join('\n'));
  if (msgs.length) withLock_(() => sendNotification_({ event: 'INTEGRITY', key: 'MAINT|' + Utilities.formatDate(new Date(), TZ, 'yyyyMMdd') + '|' + msgs.length, text: msgs.join('\n\n') }), 20000);
  try { archiveNotificationLog_(Number(prop_('NOTIF_KEEP_DAYS')) || 180); } catch (e) { console.error('archive', e); }
}
// ใส่ท้าย dailyDigest: รายชื่อคนที่ LINE ส่งไม่ถึงใน 24 ชม. (ยังไม่ add OA / บล็อก)
function undeliverableLine_() {
  const since = Date.now() - 24 * 3600e3, who = {};
  readTail_('Notification_Log', 500).forEach(r => { if (String(r.status).indexOf('undeliverable') === 0 && r.to_email && new Date(r.sent_at).getTime() >= since) who[String(r.to_email).toLowerCase()] = true; });
  const ms = members_(), names = Object.keys(who).map(e => { const m = memberByEmail(ms, e); return m ? m.name : e; });
  return names.length ? '\n📵 LINE ส่งไม่ถึง (ยังไม่ add OA/บล็อก): ' + names.join(', ') : '';
}
