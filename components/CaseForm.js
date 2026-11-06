'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Field from './Field.js';
import { useMe, useToast, Denied, Spinner } from './Ctx.js';
import { F, isReq, fmtOpd, BASIC_LOCK, STEPS, GENDERS, ROUNDS, FORM_TITLES, depsToClear, isShown, shownKeys, groupsFor, keysFor, labelOf, minDateFor, OPD_RE, OPD_ERR } from '../lib/fields.js';
import { api, useApi, today, bytes } from '../lib/client.js';

const MAX_IMG = 50, MAX_VID = 10; // ต่อช่อง: รูปภาพ 50 รูป, วิดีโอ 10 คลิป (แยกช่องส่งกัน)
import { classify, ACCEPT_IMG, ACCEPT_VID } from '../lib/mediatypes.js';
let seqId = 0;

// ตัวอย่างไฟล์ก่อนส่ง: ถ้าเบราว์เซอร์แสดงชนิดไฟล์นี้ไม่ได้ จะขึ้นข้อความแทนภาพว่าง (ไฟล์ยังส่งได้ตามปกติ)
function Pv({ f }) {
  const [bad, setBad] = useState(false);
  if (bad) return <div className="empty" style={{ padding: 12, fontSize: 12 }}>{f.kind === 'video' ? '🎬' : '🖼️'} ดูตัวอย่างในเบราว์เซอร์นี้ไม่ได้ — ยังส่งไฟล์ได้ตามปกติ</div>;
  return f.kind === 'image' ? <img src={f.url} alt={f.file.name} onError={() => setBad(true)} /> : <video src={f.url + '#t=0.1'} controls playsInline preload="metadata" aria-label={f.file.name} onError={() => setBad(true)} />;
}

// เตรียมรูปก่อนอัปโหลดให้ "ทุกเบราว์เซอร์เปิดดูได้": ย่อด้านยาวสุด 1600px แล้วแปลงเป็น JPEG 85%
// HEIC/HEIF (จาก iPhone) ที่เบราว์เซอร์ถอดรหัสเองไม่ได้ (เช่น Chrome/Firefox) จะแปลงด้วยไลบรารีก่อน
// ถ้าแปลงไม่ได้ (เช่น TIFF/RAW บางชนิด) หรือเป็น GIF เคลื่อนไหว จะส่งไฟล์ต้นฉบับ — ยังเก็บและดาวน์โหลดได้
async function shrink(f) {
  if (f.type === 'image/gif') return f;
  const name = f.name.replace(/\.[^.]+$/, '') + '.jpg';
  let src = f, bmp = null;
  try { bmp = await createImageBitmap(src); }
  catch {
    if (!/heic|heif/i.test(f.type) && !/\.(heic|heif|hif)$/i.test(f.name)) return f;
    try {
      const { default: heic2any } = await import('heic2any');
      const out = await heic2any({ blob: f, toType: 'image/jpeg', quality: 0.85 });
      src = new File([Array.isArray(out) ? out[0] : out], name, { type: 'image/jpeg' });
      bmp = await createImageBitmap(src);
    } catch { return f; }
  }
  try {
    const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    if (k === 1 && src.size < 1.5 * 1048576 && src.type === 'image/jpeg') return src;
    const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    const bl = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.85));
    return bl ? new File([bl], name, { type: 'image/jpeg' }) : src;
  } catch { return src; }
}

function putFile(url, file, onPct) {
  return new Promise((resolve, reject) => {
    let tries = 0;
    const go = () => {
      const x = new XMLHttpRequest();
      x.open('PUT', url); x.setRequestHeader('Content-Type', file.type);
      x.upload.onprogress = (e) => e.lengthComputable && onPct(Math.round((e.loaded * 100) / e.total));
      x.onload = () => (x.status >= 200 && x.status < 300 ? resolve() : retry());
      x.onerror = retry;
      x.send(file);
    };
    const retry = () => (++tries < 3 ? setTimeout(go, 900 * tries) : reject(new Error('อัปโหลดไม่สำเร็จ ตรวจสอบอินเทอร์เน็ตแล้วลองใหม่')));
    go();
  });
}

export default function CaseForm({ formType }) {
  const { perms, user } = useMe(), toast = useToast(), router = useRouter();
  const { data: od } = useApi('/api/options?formType=' + formType), opt = od?.options;
  const steps = STEPS[formType], canUpload = perms.upload, groups = groupsFor(formType);
  const imageStep = steps.length, totalSteps = steps.length + (canUpload ? 1 : 0);
  const [v, setV] = useState(null), [errs, setErrs] = useState({}), [step, setStep] = useState(0);
  const [files, setFiles] = useState([]); // {id,group,file,url,kind,status,pct,error}
  const [phase, setPhase] = useState('edit'), [recordId, setRecordId] = useState(null), [photoErr, setPhotoErr] = useState('');
  const filledFor = useRef(''), filesRef = useRef([]), wasLocked = useRef(false);
  const [meta, setMeta] = useState(null), [locked, setLocked] = useState(() => new Set()); // meta: ประวัติของ HN ที่กรอก, locked: ช่องข้อมูลพื้นฐานที่ล็อกอยู่
  const [shut, setShut] = useState(() => new Set()); // กลุ่มรูปที่ย่อเก็บอยู่ (ตอนส่งรูป)
  const commit = (next) => { filesRef.current = next; setFiles(next); };

  const blank = useCallback((o) => {
    const x = { note: '', date: today(), plantDate: today(), round: ROUNDS[0] };
    for (const k of keysFor(formType)) {
      const f = F[k];
      if (x[k] !== undefined) continue;
      x[k] = f.blank || f.t === 'multi' || k === 'procType' ? '' : f.o ? f.o[0] : f.og && f.t !== 'text' ? o?.[f.og]?.[0] || '' : '';
    }
    x.gender = x.gender || GENDERS[0];
    return x;
  }, [formType]);
  // ร่างอัตโนมัติ: เก็บข้อมูลที่กรอกค้างไว้ในเครื่องนี้ (เผลอสลับเมนู/ปิดหน้า/รีเฟรชแล้วข้อมูลไม่หาย) — รูป/วิดีโอต้องเลือกใหม่
  const draftKey = `beq-draft:${user?.id || 'u'}:${formType}`;
  const dirty = useRef(false);
  const [restored, setRestored] = useState('');
  const readDraft = () => { try { return JSON.parse(localStorage.getItem(draftKey) || 'null'); } catch { return null; } };
  const dropDraft = () => { try { localStorage.removeItem(draftKey); } catch {} };
  useEffect(() => {
    if (!opt || v) return;
    const base = blank(opt), d = readDraft();
    if (d?.v?.opd !== undefined || d?.v?.fname !== undefined) {
      setV({ ...base, ...d.v }); setStep(Math.min(d.step || 0, totalSteps - 1)); dirty.current = true;
      setRestored(new Date(d.at).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' }));
    } else setV(base);
  }, [opt, v, blank]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!v || phase !== 'edit' || !dirty.current) return;
    const t = setTimeout(() => { try { localStorage.setItem(draftKey, JSON.stringify({ v, step, at: Date.now() })); } catch {} }, 400);
    return () => clearTimeout(t);
  }, [v, step, phase]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => filesRef.current.forEach((f) => f.url && URL.revokeObjectURL(f.url)), []);
  useEffect(() => {
    if (phase !== 'busy') return;
    const h = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', h); return () => window.removeEventListener('beforeunload', h);
  }, [phase]);

  // พิมพ์ OPD เดิม → เติมข้อมูลเดิมของคนไข้ให้ (ไม่แตะวันที่เข้ามา/ระยะตรวจ)
  useEffect(() => {
    const opd = v?.opd;
    if (opd === filledFor.current) return;
    if (wasLocked.current) { // เปลี่ยน HN: ปลดล็อกและล้างข้อมูลพื้นฐานของคนไข้คนก่อน
      wasLocked.current = false; filledFor.current = '';
      setLocked(new Set()); setMeta(null);
      setV((p) => ({ ...p, ...Object.fromEntries(BASIC_LOCK.map((k) => [k, k === 'gender' ? GENDERS[0] : ''])), round: ROUNDS[0] }));
    }
    if (!opd || !OPD_RE.test(opd)) return;
    const t = setTimeout(async () => {
      try {
        const { data, meta: m } = await api('/api/records/autofill?opd=' + encodeURIComponent(opd));
        filledFor.current = opd;
        setMeta(m || null);
        // เติมเฉพาะช่องที่มีในฟอร์มนี้ และชื่อทีมงานที่ยังอยู่ในรายการของฟอร์มนี้
        const ok = ([k, val]) => keysFor(formType).includes(k) && (!/^t[A-Z]/.test(F[k].og || '') || (formType === 'case' && k === 'cell') || opt?.[F[k].og]?.includes(val));
        if (data) {
          const fill = Object.entries(data).filter(ok).filter(([k]) => !(k === 'round' && formType === 'day0')); // Day 0: ให้ผู้กรอกเลือกครั้งที่เอง // Day 0: ให้ผู้กรอกเลือกครั้งที่เอง
          setV((p) => ({ ...p, ...Object.fromEntries(fill) }));
          const lk = new Set(BASIC_LOCK.filter((k) => keysFor(formType).includes(k) && String(data[k] || '').trim()));
          wasLocked.current = lk.size > 0; setLocked(lk);
          toast('เติมข้อมูลเดิมของ HN นี้ให้แล้ว' + (lk.size ? ' (ข้อมูลพื้นฐานล็อกไว้)' : ''));
        }
      } catch {}
    }, 450);
    return () => clearTimeout(t);
  }, [v?.opd, formType, toast, opt]);

  if (!perms.fillForm) return <Denied />;
  if (!v) return <Spinner />;
  const set = (k, val) => {
    // เปลี่ยนประเภทหัตถการ → ล้างช่องย่อยของประเภทเดิม
    dirty.current = true;
    setV((p) => ({ ...p, [k]: val, ...(k === 'procType' ? depsToClear(val) : {}) }));
    setErrs((e) => (e[k] || k === 'procType' ? { ...e, [k]: '', ...(k === 'procType' ? Object.fromEntries(Object.keys(depsToClear(val)).map((d) => [d, ''])) : {}) } : e));
  };
  const patch = (id, p) => commit(filesRef.current.map((f) => (f.id === id ? { ...f, ...p } : f)));
  const busy = phase === 'busy';
  // ครั้งที่เข้ามารับหัตถการ: Day 0 แสดงเมื่อใส่ HN เดิม · F/U ไม่มีช่องนี้ (ใช้รอบล่าสุดของคนไข้) · ไม่แสดง = ครั้งที่ 1
  const showRound = formType === 'day0' && !!meta;
  const roundNote = formType === 'day0' && meta?.day0Rounds?.includes(ROUNDS.indexOf(v.round) + 1) ? 'มี Day 0 ของรอบนี้อยู่แล้ว — บันทึกแล้วข้อมูลจะอัปเดตทับของเดิม และรูปใหม่จะเข้าชุดเดิม' : '';

  async function addFiles(group, want, list) {
    const MAX = want === 'image' ? MAX_IMG : MAX_VID, unit = want === 'image' ? 'รูป' : 'คลิป';
    const have = filesRef.current.filter((f) => f.group === group && f.kind === want).length;
    const room = MAX - have;
    if (room <= 0) return toast(`ช่องนี้เลือกครบ ${MAX} ${unit}แล้ว`);
    const picked = [...list];
    if (picked.length > room) toast(`เพิ่มได้อีก ${room} ${unit} (จำกัด ${MAX} ${unit}ต่อช่อง)`);
    // ย่อรูปพร้อมกันหลายไฟล์ (ทีละ 4) แทนทีละรูป — เลือกรูปเยอะๆ แล้วพร้อมส่งเร็วขึ้นมาก
    const list2 = picked.slice(0, room), res = new Array(list2.length); let n = 0;
    const one = async () => {
      while (n < list2.length) {
        const i = n++, f = list2[i];
        const cls = classify(f.name, f.type); // รับทุกสกุลรูปภาพ/วิดีโอ (เทียบจากชนิดไฟล์หรือนามสกุล)
        if (!cls) { toast(`ไม่ใช่ไฟล์รูปภาพ/วิดีโอ — ข้าม ${f.name}`); continue; }
        if (cls.kind !== want) { toast(`ช่องนี้รับเฉพาะ${want === 'image' ? 'รูปภาพ' : 'วิดีโอ'} — ข้าม ${f.name}`); continue; }
        const base = f.type === cls.mime ? f : new File([f], f.name, { type: cls.mime });
        if (cls.kind === 'image') { const s = await shrink(base); res[i] = { id: ++seqId, group, file: s, kind: 'image', url: URL.createObjectURL(s), status: 'queued', pct: 0 }; }
        else res[i] = { id: ++seqId, group, file: base, kind: 'video', url: URL.createObjectURL(base), status: 'queued', pct: 0 };
      }
    };
    await Promise.all([one(), one(), one(), one()]);
    const out = res.filter(Boolean);
    commit([...filesRef.current, ...out]); setPhotoErr('');
  }
  const remove = (id) => { const f = filesRef.current.find((x) => x.id === id); if (f?.url) URL.revokeObjectURL(f.url); commit(filesRef.current.filter((x) => x.id !== id)); };

  function validate() {
    const e = {};
    for (const k of shownKeys(formType, v)) { const f = F[k]; if (isReq(k, formType) && !String(v[k] || '').trim()) e[k] = ['select', 'multi', 'pills'].includes(f.t) ? `กรุณาเลือก${labelOf(k, formType)}` : `กรุณากรอก${labelOf(k, formType)}`; }
    for (const k of shownKeys(formType, v)) { const min = minDateFor(k, formType, today()); if (!e[k] && min && v[k] < min) e[k] = `${labelOf(k, formType)}เลือกย้อนหลังได้ไม่เกิน 1 วัน`; }
    if (!e.opd && !OPD_RE.test(v.opd || '')) e.opd = OPD_ERR;
    setErrs(e);
    const bad = steps.findIndex((s) => s[1].some((k) => e[k]));
    if (bad >= 0) { setStep(bad); toast(Object.values(e)[0]); setTimeout(() => { const el = document.querySelector('#nf [aria-invalid=true]'); el?.focus?.(); (document.querySelector('#nf .fe') || el)?.scrollIntoView({ block: 'center', behavior: 'smooth' }); }, 50); return false; }
    if (canUpload && !files.length) { setTimeout(() => document.querySelector('.acc-card')?.scrollIntoView({ block: 'center' }), 50); setPhotoErr('ต้องเลือกอย่างน้อย 1 รูปหรือวิดีโอก่อนบันทึกเคส'); toast('กรุณาเลือกรูปหรือวิดีโออย่างน้อย 1 ไฟล์'); return false; }
    return true;
  }

  async function runUploads(rid) {
    const todo = filesRef.current.filter((f) => f.status !== 'saved');
    const perGroup = {}; const queue = todo.map((f) => ({ f, seq: (perGroup[f.group + f.kind] = (perGroup[f.group + f.kind] ?? -1) + 1) })); // ลำดับนับแยกรูป/วิดีโอ
    const worker = async () => {
      while (queue.length) {
        const { f, seq } = queue.shift();
        patch(f.id, { status: 'uploading', pct: 0, error: '' });
        try {
          const init = await api('/api/media/init', { method: 'POST', body: { recordId: rid, group: f.group, name: f.file.name, mime: f.file.type, size: f.file.size, seq } });
          await putFile(init.uploadUrl, f.file, (pct) => patch(f.id, { pct }));
          patch(f.id, { status: 'uploaded', token: init.token, pct: 100 });
        } catch (x) { patch(f.id, { status: 'error', error: x.message }); }
      }
    };
    await Promise.all([worker(), worker(), worker(), worker(), worker()]); // อัปโหลดพร้อมกัน 5 ไฟล์
    const up = filesRef.current.filter((f) => f.status === 'uploaded');
    for (let i = 0; i < up.length; i += 30) {
      const chunk = up.slice(i, i + 30);
      try {
        const r = await api('/api/media/complete', { method: 'POST', body: { tokens: chunk.map((f) => f.token) } });
        const bad = new Map(r.failed.map((x) => [x.token, x.error]));
        chunk.forEach((f) => patch(f.id, bad.has(f.token) ? { status: 'error', error: bad.get(f.token) } : { status: 'saved' }));
      } catch (x) { chunk.forEach((f) => patch(f.id, { status: 'error', error: x.message })); }
    }
    return filesRef.current.every((f) => f.status === 'saved');
  }

  async function submit(e) {
    e?.preventDefault();
    if (busy) return;
    if (!validate()) return;
    setPhase('busy');
    try {
      let rid = recordId;
      if (!rid) {
        const body = { formType, data: v };
        try { const res = await api('/api/records', { method: 'POST', body }); rid = res.id; if (res.updated) toast('อัปเดต Day 0 เดิมของ HN นี้แล้ว'); }
        catch (x) {
          if (x.status === 409 && confirm(x.message + '\nต้องการบันทึกซ้ำหรือไม่?')) rid = (await api('/api/records', { method: 'POST', body: { ...body, force: true } })).id;
          else throw x;
        }
        setRecordId(rid); dropDraft(); dirty.current = false; setRestored('');
      }
      if (canUpload && filesRef.current.length) {
        toast('กำลังอัปโหลดรูป/วิดีโอ...');
        const ok = await runUploads(rid);
        if (!ok) { setPhase('retry'); toast('บันทึกข้อมูลแล้ว แต่มีไฟล์อัปโหลดไม่สำเร็จ'); return; }
      }
      setPhase('done');
    } catch (x) { toast('❌ ' + x.message); setPhase(recordId ? 'retry' : 'edit'); }
  }
  async function retry() {
    setPhase('busy');
    const ok = await runUploads(recordId);
    setPhase(ok ? 'done' : 'retry'); if (!ok) toast('ยังมีไฟล์ที่อัปโหลดไม่สำเร็จ');
  }
  function startOver() { dropDraft(); dirty.current = false; setRestored(''); setV(blank(opt)); setErrs({}); setStep(0); setLocked(new Set()); setMeta(null); filledFor.current = ''; toast('ล้างข้อมูลที่กรอกแล้ว'); }
  function reset() { dropDraft(); dirty.current = false; setRestored(''); files.forEach((f) => f.url && URL.revokeObjectURL(f.url)); commit([]); setV(blank(opt)); setErrs({}); setStep(0); setRecordId(null); filledFor.current = ''; setPhase('edit'); window.scrollTo(0, 0); }
  const go = (d) => { setStep((s) => Math.max(0, Math.min(totalSteps - 1, s + d))); window.scrollTo(0, 0); };
  const stepTitles = [...steps.map((s) => s[0]), ...(canUpload ? ['รูปภาพ'] : [])];

  if (phase === 'done') return (
    <div className="card empty" style={{ padding: 36 }}>
      <div style={{ fontSize: 44 }}>✅</div><h2>บันทึกเคสเรียบร้อยแล้ว</h2>
      <p className="mu">{fmtOpd(v.opd)} · {v.fname} {v.lname}{files.length ? ` · ${files.length} ไฟล์` : ''}</p>
      <div className="row" style={{ justifyContent: 'center', marginTop: 12 }}><button className="btn" onClick={reset}>+ เพิ่มเคสใหม่</button><button className="btn s" onClick={() => router.push('/dashboard')}>← กลับหน้าหลัก</button></div>
    </div>
  );

  const fileItems = (items) => (
    <div className="imgs">
      {items.map((f) => (
        <figure key={f.id} className={'up-item ' + (f.status === 'error' ? 'err' : f.status === 'saved' ? 'ok' : '')}>
          <Pv f={f} />
          <figcaption>{f.file.name.length > 22 ? f.file.name.slice(0, 20) + '…' : f.file.name} · {bytes(f.file.size)}</figcaption>
          {(f.status === 'uploading' || f.status === 'uploaded') && <div className="bar"><i style={{ width: f.pct + '%' }} /></div>}
          <div className="st">{{ queued: '', uploading: `กำลังอัปโหลด ${f.pct}%`, uploaded: 'กำลังบันทึก...', saved: '✓ เรียบร้อย', error: f.error }[f.status]}</div>
          {phase === 'edit' && <button type="button" className="btn d sm photo-remove" onClick={() => remove(f.id)} aria-label={'ลบ ' + f.file.name}>ลบ</button>}
        </figure>
      ))}
    </div>
  );
  // ช่องส่งแยกกัน: รูปภาพ (สูงสุด 50) และวิดีโอ (สูงสุด 10) ในแต่ละกลุ่ม
  const slot = (g, kind) => {
    const items = files.filter((f) => f.group === g[0] && f.kind === kind), max = kind === 'image' ? MAX_IMG : MAX_VID;
    return (
      <div className="slot" key={kind}>
        <div className="row sp" style={{ margin: '8px 0 4px' }}>
          <b>{kind === 'image' ? '🖼️ รูปภาพ' : '🎬 วิดีโอ'} <span className="mu" style={{ fontWeight: 400 }}>{items.length}/{max} {kind === 'image' ? 'รูป' : 'คลิป'}</span></b>
          {phase === 'edit' && <label className="btn s">{kind === 'image' ? 'เลือกรูปภาพ' : 'เลือกวิดีโอ'}<input type="file" accept={kind === 'image' ? ACCEPT_IMG : ACCEPT_VID} multiple hidden onChange={(e) => { addFiles(g[0], kind, e.target.files); e.target.value = ''; }} /></label>}
        </div>
        {items.length ? fileItems(items) : <div className="empty">{kind === 'image' ? 'ยังไม่มีรูปภาพ' : 'ยังไม่มีวิดีโอ'}</div>}
      </div>
    );
  };
  const photoCard = (g) => {
    const items = files.filter((f) => f.group === g[0]), isShut = shut.has(g[0]);
    const done = items.filter((f) => f.status === 'saved').length, bad = items.filter((f) => f.status === 'error').length;
    return (
      <div className="card acc-card" key={g[0]}>
        <button type="button" className="acc-h" style={{ padding: '4px 2px', minHeight: 44 }} aria-expanded={!isShut} onClick={() => setShut((s) => { const n = new Set(s); n.has(g[0]) ? n.delete(g[0]) : n.add(g[0]); return n; })}>
          <span className="ch">▸</span><span>{g[1]}</span><span className="sp2" />
          <span className="tag">{items.length} ไฟล์{done ? ` · ✓${done}` : ''}{bad ? ` · ⚠${bad}` : ''}</span>
        </button>
        {!isShut && ['image', 'video'].map((k) => slot(g, k))}
      </div>
    );
  };

  const failed = files.filter((f) => f.status === 'error').length;
  const missing = shownKeys(formType, v).filter((k) => isReq(k, formType) && !String(v[k] || '').trim()).length; // จำนวนช่องบังคับที่ยังว่าง
  return (
    <>
      <div className="row sp"><h1>{FORM_TITLES[formType]}</h1><button className="btn s" onClick={() => router.push('/dashboard')} disabled={busy}>← ยกเลิก</button></div>
      {missing > 0 && <div className="stp"><p className="mu"><span className="todo">ยังต้องกรอก {missing} ช่อง</span></p></div>}
      {phase === 'edit' && restored && <div className="banner" role="status" style={{ margin: '0 0 10px' }}>กู้คืนข้อมูลที่กรอกค้างไว้เมื่อ {restored} — รูป/วิดีโอต้องเลือกใหม่ <button type="button" className="btn s sm" style={{ marginLeft: 8 }} onClick={startOver}>ล้างและเริ่มใหม่</button></div>}
      {phase === 'edit' && !restored && <p className="mu" style={{ fontSize: 12, margin: '0 0 8px' }}>💾 ข้อมูลที่กรอกจะถูกบันทึกเป็นร่างอัตโนมัติในเครื่องนี้ (รูป/วิดีโอไม่ถูกเก็บ)</p>}
      <form id="nf" className={'s' + step} noValidate onSubmit={submit}>
        {steps.map((s, i) => (
          <div className="card sec" data-s={i} key={s[0]}>
            <h2>{s[0]}</h2>
            <div className="f2">{s[1].filter((k) => isShown(k, v) && (k !== 'round' || showRound)).map((k) => <Field key={k} locked={locked.has(k) || (formType === 'case' && k === 'cell')} note={k === 'round' ? roundNote : ''} k={k} formType={formType} minDate={minDateFor(k, formType, today())} value={v[k] ?? ''} onChange={set} options={opt} error={errs[k]} />)}</div>
            {i === steps.length - 1 && <><h3 style={{ margin: '16px 0 4px' }}>ข้อมูลเพิ่มเติม</h3><label htmlFor="f-note">หมายเหตุ</label><textarea id="f-note" rows={2} value={v.note} onChange={(e) => set('note', e.target.value)} maxLength={1000} /></>}
          </div>
        ))}
        {canUpload && (
          <div className="card sec" data-s={imageStep}>
            <h2>{formType === 'day0' ? 'ส่งรูปภาพตามขั้นตอน' : 'ส่งรูปภาพ'} <span className="req">*</span></h2>
            <p className="mu">ต้องเลือกอย่างน้อย 1 ไฟล์ก่อนบันทึกเคส · รูปจะถูกย่อให้อัตโนมัติ · รองรับวิดีโอ MP4/MOV</p>
            {photoErr && <p className="fe" role="alert">{photoErr}</p>}
            {groups.length > 1 && (
              <div className="row" style={{ gap: 8, marginBottom: 8 }}>
                <button type="button" className="btn s sm" onClick={() => setShut(new Set(groups.map((g) => g[0])))}>ย่อทั้งหมด</button>
                <button type="button" className="btn s sm" onClick={() => setShut(new Set())}>ขยายทั้งหมด</button>
              </div>
            )}
            <div className="grid2">{groups.map(photoCard)}</div>
            {phase === 'retry' && (
              <div className="banner" style={{ marginTop: 12 }}>บันทึกข้อมูลเคสแล้ว แต่มี {failed} ไฟล์อัปโหลดไม่สำเร็จ
                <div className="row" style={{ marginTop: 8 }}><button type="button" className="btn" onClick={retry}>ลองอัปโหลดไฟล์ที่เหลืออีกครั้ง</button><button type="button" className="btn s" onClick={() => setPhase('done')}>ข้ามไฟล์ที่ไม่สำเร็จ</button></div>
              </div>
            )}
          </div>
        )}
        {phase !== 'retry' && (
          <>
            <div className="row dsk"><button className="btn" disabled={busy}>{busy ? <><span className="spin" /> กำลังบันทึก...</> : '💾 บันทึกเคส'}</button><button type="button" className="btn s" onClick={() => router.push('/dashboard')} disabled={busy}>ยกเลิก</button></div>
            <div className="stpbar">
              <button type="button" className="btn s" onClick={() => router.push('/dashboard')} disabled={busy}>ยกเลิก</button>
              <button key="save" type="submit" className="btn" disabled={busy}>{busy ? 'กำลังบันทึก...' : '💾 บันทึกเคส'}</button>
            </div>
          </>
        )}
      </form>
    </>
  );
}
