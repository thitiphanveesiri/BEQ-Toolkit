'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Field from './Field.js';
import { useMe, useToast, Denied, Spinner } from './Ctx.js';
import { F, BASIC_LOCK, STEPS, GENDERS, ROUNDS, FORM_TITLES, depsToClear, isShown, shownKeys, groupsFor, keysFor, labelOf, minDateFor, OPD_RE, OPD_ERR } from '../lib/fields.js';
import { api, useApi, today, bytes } from '../lib/client.js';

const MAX_FILES = 30;
const VIDEO_EXT = { mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', m4v: 'video/x-m4v' };
const IMG_EXT = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', heic: 'image/heic', heif: 'image/heif' };
let seqId = 0;

// ย่อรูปก่อนอัปโหลด (ด้านยาวสุด 1600px, JPEG 85%) ให้ส่งเร็วและประหยัดพื้นที่ — ถ้าย่อไม่ได้ (เช่น HEIC) ส่งไฟล์เดิม
async function shrink(f) {
  try {
    const b = await createImageBitmap(f), k = Math.min(1, 1600 / Math.max(b.width, b.height));
    if (k === 1 && f.size < 1.5 * 1048576 && f.type === 'image/jpeg') return f;
    const c = document.createElement('canvas'); c.width = Math.round(b.width * k); c.height = Math.round(b.height * k);
    c.getContext('2d').drawImage(b, 0, 0, c.width, c.height);
    const bl = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.85));
    return bl ? new File([bl], f.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' }) : f;
  } catch { return f; }
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
  const { perms } = useMe(), toast = useToast(), router = useRouter();
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
  useEffect(() => { if (opt && !v) setV(blank(opt)); }, [opt, v, blank]);
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
        const ok = ([k, val]) => keysFor(formType).includes(k) &&  (!/^t[A-Z]/.test(F[k].og || '') || opt?.[F[k].og]?.includes(val));
        if (data) {
          const fill = Object.entries(data).filter(ok).filter(([k]) => !(k === 'round' && formType === 'day0')); // Day 0: ให้ผู้กรอกเลือกครั้งที่เอง
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
    setV((p) => ({ ...p, [k]: val, ...(k === 'procType' ? depsToClear(val) : {}) }));
    setErrs((e) => (e[k] || k === 'procType' ? { ...e, [k]: '', ...(k === 'procType' ? Object.fromEntries(Object.keys(depsToClear(val)).map((d) => [d, ''])) : {}) } : e));
  };
  const patch = (id, p) => commit(filesRef.current.map((f) => (f.id === id ? { ...f, ...p } : f)));
  const busy = phase === 'busy';
  // ครั้งที่เข้ามารับหัตถการ: Day 0 แสดงเมื่อใส่ HN เดิม · BEQ Hair Center แสดงเมื่อมีหัตถการมากกว่า 1 รอบ · ไม่แสดง = ครั้งที่ 1
  const showRound = formType === 'day0' ? !!meta : (meta?.maxRound || 1) > 1;
  const roundNote = formType === 'day0' && meta?.day0Rounds?.includes(ROUNDS.indexOf(v.round) + 1) ? 'มี Day 0 ของรอบนี้อยู่แล้ว — บันทึกแล้วข้อมูลจะอัปเดตทับของเดิม และรูปใหม่จะเข้าชุดเดิม' : '';

  async function addFiles(group, list) {
    const have = filesRef.current.filter((f) => f.group === group).length;
    const room = MAX_FILES - have;
    if (room <= 0) return toast(`ช่องนี้เลือกครบ ${MAX_FILES} ไฟล์แล้ว`);
    const picked = [...list];
    if (picked.length > room) toast(`เพิ่มได้อีก ${room} ไฟล์ (จำกัด ${MAX_FILES} ไฟล์ต่อช่อง)`);
    const out = [];
    for (const f of picked.slice(0, room)) {
      const ext = f.name.split('.').pop().toLowerCase();
      const type = f.type || VIDEO_EXT[ext] || IMG_EXT[ext] || '';
      if (type.startsWith('image/')) { const s = await shrink(f.type ? f : new File([f], f.name, { type })); out.push({ id: ++seqId, group, file: s, kind: 'image', url: URL.createObjectURL(s), status: 'queued', pct: 0 }); }
      else if (type.startsWith('video/')) { const vf = f.type ? f : new File([f], f.name, { type }); out.push({ id: ++seqId, group, file: vf, kind: 'video', url: URL.createObjectURL(vf), status: 'queued', pct: 0 }); }
      else toast(`ไม่รองรับไฟล์ ${f.name}`);
    }
    commit([...filesRef.current, ...out]); setPhotoErr('');
  }
  const remove = (id) => { const f = filesRef.current.find((x) => x.id === id); if (f?.url) URL.revokeObjectURL(f.url); commit(filesRef.current.filter((x) => x.id !== id)); };

  function validate() {
    const e = {};
    for (const k of shownKeys(formType, v)) { const f = F[k]; if (f.req && !String(v[k] || '').trim()) e[k] = ['select', 'multi', 'pills'].includes(f.t) ? `กรุณาเลือก${labelOf(k, formType)}` : `กรุณากรอก${labelOf(k, formType)}`; }
    for (const k of shownKeys(formType, v)) { const min = minDateFor(k, formType, today()); if (!e[k] && min && v[k] < min) e[k] = `${labelOf(k, formType)}เลือกย้อนหลังได้ไม่เกิน 1 วัน`; }
    if (!e.opd && !OPD_RE.test(v.opd || '')) e.opd = OPD_ERR;
    setErrs(e);
    const bad = steps.findIndex((s) => s[1].some((k) => e[k]));
    if (bad >= 0) { setStep(bad); toast(Object.values(e)[0]); setTimeout(() => document.querySelector('#nf [aria-invalid=true]')?.focus(), 50); return false; }
    if (canUpload && !files.length) { setStep(imageStep); setPhotoErr('ต้องเลือกอย่างน้อย 1 รูปหรือวิดีโอก่อนบันทึกเคส'); toast('กรุณาเลือกรูปหรือวิดีโออย่างน้อย 1 ไฟล์'); return false; }
    return true;
  }

  async function runUploads(rid) {
    const todo = filesRef.current.filter((f) => f.status !== 'saved');
    const perGroup = {}; const queue = todo.map((f) => ({ f, seq: (perGroup[f.group] = (perGroup[f.group] ?? -1) + 1) }));
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
    await Promise.all([worker(), worker(), worker()]);
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
    if (matchMedia('(max-width:900px)').matches && step < totalSteps - 1) return go(1);
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
        setRecordId(rid);
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
  function reset() { files.forEach((f) => f.url && URL.revokeObjectURL(f.url)); commit([]); setV(blank(opt)); setErrs({}); setStep(0); setRecordId(null); filledFor.current = ''; setPhase('edit'); window.scrollTo(0, 0); }
  const go = (d) => { setStep((s) => Math.max(0, Math.min(totalSteps - 1, s + d))); window.scrollTo(0, 0); };
  const stepTitles = [...steps.map((s) => s[0]), ...(canUpload ? ['รูปภาพ'] : [])];

  if (phase === 'done') return (
    <div className="card empty" style={{ padding: 36 }}>
      <div style={{ fontSize: 44 }}>✅</div><h2>บันทึกเคสเรียบร้อยแล้ว</h2>
      <p className="mu">{v.opd} · {v.fname} {v.lname}{files.length ? ` · ${files.length} ไฟล์` : ''}</p>
      <div className="row" style={{ justifyContent: 'center', marginTop: 12 }}><button className="btn" onClick={reset}>+ เพิ่มเคสใหม่</button><button className="btn s" onClick={() => router.push('/dashboard')}>← กลับหน้าหลัก</button></div>
    </div>
  );

  const photoCard = (g) => {
    const items = files.filter((f) => f.group === g[0]), isShut = shut.has(g[0]);
    const done = items.filter((f) => f.status === 'saved').length, bad = items.filter((f) => f.status === 'error').length;
    return (
      <div className="card acc-card" key={g[0]}>
        <button type="button" className="acc-h" style={{ padding: '4px 2px', minHeight: 44 }} aria-expanded={!isShut} onClick={() => setShut((s) => { const n = new Set(s); n.has(g[0]) ? n.delete(g[0]) : n.add(g[0]); return n; })}>
          <span className="ch">▸</span><span>{g[1]}</span><span className="sp2" />
          <span className="tag">{items.length}/{MAX_FILES} ไฟล์{done ? ` · ✓${done}` : ''}{bad ? ` · ⚠${bad}` : ''}</span>
        </button>
        {!isShut && phase === 'edit' && (
          <div className="row" style={{ margin: '8px 0' }}>
            <label className="btn s">🖼️ เลือกไฟล์<input type="file" accept="image/*,video/*" multiple hidden onChange={(e) => { addFiles(g[0], e.target.files); e.target.value = ''; }} /></label>
          </div>
        )}
        {!isShut && (items.length ? (
          <div className="imgs">
            {items.map((f) => (
              <figure key={f.id} className={'up-item ' + (f.status === 'error' ? 'err' : f.status === 'saved' ? 'ok' : '')}>
                {f.kind === 'image' ? <img src={f.url} alt={f.file.name} /> : <video src={f.url + '#t=0.1'} controls playsInline preload="metadata" aria-label={f.file.name} />}
                <figcaption>{f.file.name.length > 22 ? f.file.name.slice(0, 20) + '…' : f.file.name} · {bytes(f.file.size)}</figcaption>
                {(f.status === 'uploading' || f.status === 'uploaded') && <div className="bar"><i style={{ width: f.pct + '%' }} /></div>}
                <div className="st">{{ queued: '', uploading: `กำลังอัปโหลด ${f.pct}%`, uploaded: 'กำลังบันทึก...', saved: '✓ เรียบร้อย', error: f.error }[f.status]}</div>
                {phase === 'edit' && <button type="button" className="btn d sm photo-remove" onClick={() => remove(f.id)} aria-label={'ลบ ' + f.file.name}>ลบ</button>}
              </figure>
            ))}
          </div>
        ) : <div className="empty">ยังไม่มีไฟล์</div>)}
      </div>
    );
  };

  const failed = files.filter((f) => f.status === 'error').length;
  const missing = shownKeys(formType, v).filter((k) => F[k].req && !String(v[k] || '').trim()).length; // จำนวนช่องบังคับที่ยังว่าง
  return (
    <>
      <div className="row sp"><h1>{FORM_TITLES[formType]}</h1><button className="btn s" onClick={() => router.push('/dashboard')} disabled={busy}>← ยกเลิก</button></div>
      <div className="stp"><div className="bar"><i style={{ width: Math.round(((step + 1) * 100) / totalSteps) + '%' }} /></div><p className="mu">ขั้นตอน {step + 1}/{totalSteps} · {stepTitles[step]}{missing > 0 && <span className="todo"> · ยังต้องกรอก {missing} ช่อง</span>}</p></div>
      <form id="nf" className={'s' + step} noValidate onSubmit={submit}>
        {steps.map((s, i) => (
          <div className="card sec" data-s={i} key={s[0]}>
            <h2>{s[0]}</h2>
            <div className="f2">{s[1].filter((k) => isShown(k, v) && (k !== 'round' || showRound)).map((k) => <Field key={k} locked={locked.has(k)} note={k === 'round' ? roundNote : ''} k={k} formType={formType} minDate={minDateFor(k, formType, today())} value={v[k] ?? ''} onChange={set} options={opt} error={errs[k]} />)}</div>
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
              {step > 0 ? <button type="button" className="btn s" onClick={() => go(-1)} disabled={busy}>← ย้อนกลับ</button> : <button type="button" className="btn s" onClick={() => router.push('/dashboard')}>ยกเลิก</button>}
              {step < totalSteps - 1 ? <button key="next" type="button" className="btn" onClick={() => go(1)}>ถัดไป →</button> : <button key="save" type="submit" className="btn" disabled={busy}>{busy ? 'กำลังบันทึก...' : '💾 บันทึกเคส'}</button>}
            </div>
          </>
        )}
      </form>
    </>
  );
}
