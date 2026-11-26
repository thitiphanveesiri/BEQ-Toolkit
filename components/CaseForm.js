'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Field from './Field.js';
import MediaLightbox from './MediaLightbox.js';
import RecordFormView from './RecordFormView.js';
import { useMe, useToast, Denied, Spinner } from './Ctx.js';
import { F, isReq, fmtOpd, BASIC_LOCK, STEPS, GENDERS, ROUNDS, FORM_TITLES, depsToClear, isShown, shownKeys, groupsFor, keysFor, labelOf, minDateFor, OPD_RE, OPD_ERR, ANGLES, MAX_EXTRA, MAX_VIDEOS, EXTRA_SLOT, VIDEO_SLOT, IMAGES_PER_GROUP } from '../lib/fields.js';
import { api, useApi, today, bytes, D } from '../lib/client.js';
import { classify, ACCEPT_IMG, ACCEPT_VID } from '../lib/mediatypes.js';
import { loadDraft, loadDraftFiles, saveDraft, saveDraftSnapshot, deleteDraft, newFileId, newRequestId } from '../lib/drafts.js';
import { queryUpload, resumableUpload, SessionExpiredError } from '../lib/resumableUpload.js';

const UPLOAD_IMAGE_WORKERS = 2;
// กันหน้าจอดับ/เบราว์เซอร์หยุดเครือข่ายระหว่างอัปโหลด (Wake Lock หลุดเองเมื่อสลับแอป จึงขอใหม่เมื่อกลับมาที่หน้านี้)
async function keepAwake() {
  let lock = null, stopped = false;
  const acquire = async () => { try { if (!stopped && navigator.wakeLock && document.visibilityState === 'visible') lock = await navigator.wakeLock.request('screen'); } catch { /* ไม่รองรับ/ถูกปฏิเสธ — ข้าม */ } };
  const onVis = () => { if (document.visibilityState === 'visible') acquire(); };
  document.addEventListener('visibilitychange', onVis);
  await acquire();
  return { release() { stopped = true; document.removeEventListener('visibilitychange', onVis); lock?.release?.().catch(() => {}); } };
}

const nameOf = (f) => f.file?.name || f.fileName || f.name || 'ไฟล์ที่เลือกไว้';
const sizeOf = (f) => (f.file?.size ?? f.fileSize ?? Number(f.size)) || 0;
const typeOf = (f) => f.file?.type || f.fileType || f.mime || '';
const draftFile = ({ url, file, ...f }) => ({ ...f, ...(file ? { fileName: file.name, fileType: file.type, fileSize: file.size, fileModified: file.lastModified } : {}) });

function Pv({ f, onOpen }) {
  const [bad, setBad] = useState(false);
  if (!f.file) return <div className="pv pv-missing"><span>{f.status === 'saved' ? 'บันทึกไฟล์แล้ว' : 'ไม่พบไฟล์ต้นฉบับในเครื่อง'}</span></div>;
  return (
    <button type="button" className="pv" onClick={onOpen} aria-label={`เปิดดู ${nameOf(f)} แบบเต็มจอ`}>
      {f.kind === 'image' && !bad ? <img src={f.url} alt={nameOf(f)} onError={() => setBad(true)} /> : <span className="pv-video"><span>{f.kind === 'video' ? 'วิดีโอ' : 'รูปภาพ'}</span><small>{bad ? 'เปิดในหน้าต่างใหญ่เพื่อดาวน์โหลด' : 'แตะเพื่อเล่นวิดีโอ'}</small></span>}
      <span className="pv-open">ดูใหญ่</span>
    </button>
  );
}

export default function CaseForm({ formType }) {
  const { perms, user } = useMe(), toast = useToast(), router = useRouter();
  const { data: od } = useApi('/api/options?formType=' + formType), opt = od?.options;
  const limits = od?.limits || { imageMb: 25, videoMb: 1024 };
  const steps = STEPS[formType], canUpload = perms.upload, groups = useMemo(() => groupsFor(formType), [formType]);
  const imageStep = steps.length;
  const [v, setV] = useState(null), [errs, setErrs] = useState({});
  const [files, setFiles] = useState([]), [createId, setCreateId] = useState(() => newRequestId());
  const [phase, setPhase] = useState('edit'), [recordId, setRecordId] = useState(null), [photoErr, setPhotoErr] = useState('');
  const [meta, setMeta] = useState(null), [locked, setLocked] = useState(() => new Set());
  const [openSections, setOpenSections] = useState(() => new Set([0]));
  const [shut, setShut] = useState(() => new Set(groups.map((g) => g[0])));
  const [lightbox, setLightbox] = useState(null), [restored, setRestored] = useState(''), [draftError, setDraftError] = useState(''), [draftReady, setDraftReady] = useState(false);
  const filledFor = useRef(''), filesRef = useRef([]), wasLocked = useRef(false), hydrated = useRef(false), retryRef = useRef(null);
  const draftEpoch = useRef(0), draftWrites = useRef(Promise.resolve()), formRef = useRef(null);
  const commit = (next) => { filesRef.current = next; setFiles(next); };
  const draftKey = `beq-draft:${user?.id || 'u'}:${formType}`;
  formRef.current = { v, recordId, phase, openSections, shut, requestId: createId };
  const queueDraftWrite = useCallback((task) => {
    const run = draftWrites.current.then(task, task);
    draftWrites.current = run.catch(() => {});
    return run;
  }, []);

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

  const clearDraft = useCallback(async () => {
    draftEpoch.current += 1;
    const epoch = draftEpoch.current;
    await queueDraftWrite(async () => {
      if (epoch !== draftEpoch.current) return;
      try { await deleteDraft(draftKey); } catch {}
      try { localStorage.removeItem(draftKey); } catch {}
    });
  }, [draftKey, queueDraftWrite]);

  useEffect(() => {
    if (!opt || v || !user) return;
    let cancelled = false;
    (async () => {
      const base = blank(opt);
      let draft = null, blobs = [];
      try { [draft, blobs] = await Promise.all([loadDraft(draftKey), loadDraftFiles(draftKey)]); }
      catch { setDraftError('เบราว์เซอร์นี้เก็บร่างอัตโนมัติไม่ได้ ข้อมูลจะยังบันทึกเป็นปกติเมื่อออนไลน์'); }
      let legacy = null;
      try { legacy = JSON.parse(localStorage.getItem(draftKey) || 'null'); } catch {}
      if (!draft && legacy?.v) draft = { ...legacy, version: 1 };
      if (!cancelled && draft?.v && (draft.v.opd !== undefined || draft.v.fname !== undefined)) {
        const fileMap = new Map(blobs.map((x) => [x.id, x.file]));
        const restoredFiles = (draft.files || []).map((f) => {
          const file = fileMap.get(f.id);
          if (file) return { ...f, file, url: URL.createObjectURL(file), status: f.status === 'saved' ? 'saved' : f.status === 'uploaded' ? 'uploaded' : 'queued', missing: false };
          const status = f.status === 'saved' ? 'saved' : f.status === 'uploaded' || Number(f.offset || 0) >= Number(f.fileSize || 0) ? 'uploaded' : 'missing';
          return { ...f, file: null, url: '', status, missing: status === 'missing', error: status === 'missing' ? 'ไม่พบไฟล์ต้นฉบับในเครื่อง — เลือกไฟล์เดิมอีกครั้งเพื่ออัปโหลดต่อ' : f.error || '' };
        });
        setV({ ...base, ...draft.v });
        setRecordId(draft.recordId || null);
        setCreateId(draft.requestId || newRequestId());
        commit(restoredFiles);
        if (restoredFiles.some((f) => f.status === 'missing')) setDraftError('พบไฟล์ในร่างที่ไฟล์ต้นฉบับไม่ได้ถูกเก็บไว้ เลือกไฟล์เดิมอีกครั้งจากรายการที่ติดเครื่องก่อน อัปโหลดต่อ');
        setOpenSections(new Set(draft.openSections?.length ? draft.openSections : [0]));
        setShut(new Set(draft.shut?.length ? draft.shut : groups.map((g) => g[0])));
        setPhase(draft.recordId && canUpload ? 'retry' : 'edit');
        setRestored(new Date(draft.at || Date.now()).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' }));
        try { localStorage.removeItem(draftKey); } catch {}
      } else if (!cancelled) setV(base);
      if (!cancelled) { hydrated.current = true; setDraftReady(true); }
    })();
    return () => { cancelled = true; };
  }, [opt, v, blank, draftKey, user, canUpload, groups]);

  const persistNow = useCallback(async (override = {}, includeFiles = false) => {
    if (!v || !hydrated.current || phase === 'done') return;
    const epoch = draftEpoch.current;
    await queueDraftWrite(async () => {
      if (epoch !== draftEpoch.current) return;
      const draft = {
        version: 2,
        v,
        files: filesRef.current.map(draftFile),
        recordId,
        requestId: createId,
        phase: phase === 'busy' ? 'retry' : phase,
        openSections: [...openSections],
        shut: [...shut],
        at: Date.now(),
        ...override,
      };
      if (includeFiles) await saveDraftSnapshot(draftKey, draft, filesRef.current);
      else await saveDraft(draftKey, draft);
    });
  }, [v, recordId, phase, openSections, shut, createId, draftKey, queueDraftWrite]);

  const fileStateSig = files.map((f) => [f.id, f.status, f.offset || 0, f.uploadUrl || '', f.driveId || '', f.error || ''].join(':')).join('|');
  const blobSig = files.map((f) => [f.id, !!f.file, sizeOf(f), f.file?.lastModified || 0].join(':')).join('|');
  useEffect(() => {
    if (!draftReady || !v || phase === 'done') return;
    const t = setTimeout(() => { persistNow().catch(() => setDraftError('เก็บร่างอัตโนมัติไม่สำเร็จ ควรคงเปิดหน้านี้ไว้จนกว่าจะบันทึกเสร็จ')); }, 500);
    return () => clearTimeout(t);
  }, [v, recordId, phase, openSections, shut, fileStateSig, draftReady, persistNow]);
  useEffect(() => {
    if (!draftReady || !v) return;
    const epoch = draftEpoch.current, snapshot = filesRef.current;
    const t = setTimeout(() => {
      queueDraftWrite(async () => {
        if (epoch !== draftEpoch.current) return;
        const current = formRef.current;
        if (!current?.v || current.phase === 'done') return;
        await saveDraftSnapshot(draftKey, {
          version: 2,
          v: current.v,
          files: snapshot.map(draftFile),
          recordId: current.recordId,
          requestId: current.requestId,
          phase: current.phase === 'busy' ? 'retry' : current.phase,
          openSections: [...current.openSections],
          shut: [...current.shut],
          at: Date.now(),
        }, snapshot);
      }).catch(() => setDraftError('เก็บไฟล์ในร่างไม่สำเร็จ ควรคงเปิดหน้านี้ไว้จนกว่าจะบันทึกเสร็จ'));
    }, 250);
    return () => clearTimeout(t);
  }, [blobSig, draftReady, draftKey, queueDraftWrite]);
  useEffect(() => () => filesRef.current.forEach((f) => f.url && URL.revokeObjectURL(f.url)), []);
  useEffect(() => {
    if (phase !== 'busy') return;
    const h = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', h); return () => window.removeEventListener('beforeunload', h);
  }, [phase]);
  useEffect(() => {
    const online = () => { if (navigator.onLine && phase === 'retry') { toast('อินเทอร์เน็ตกลับมา ระบบกำลังลองอัปโหลดต่อ'); retryRef.current?.(); } };
    window.addEventListener('online', online); return () => window.removeEventListener('online', online);
  }, [phase, toast]);

  useEffect(() => {
    const opd = v?.opd;
    if (recordId || opd === filledFor.current) return;
    if (wasLocked.current) {
      wasLocked.current = false; filledFor.current = '';
      setLocked(new Set()); setMeta(null);
      setV((p) => ({ ...p, ...Object.fromEntries(BASIC_LOCK.map((k) => [k, k === 'gender' ? GENDERS[0] : k === 'plantDate' ? today() : ''])), round: ROUNDS[0] }));
    }
    if (!opd || !OPD_RE.test(opd)) return;
    const t = setTimeout(async () => {
      try {
        const { data, meta: m, day0 } = await api('/api/records/autofill?opd=' + encodeURIComponent(opd));
        if (cancelled) return;
        filledFor.current = opd;
        setMeta({ ...(m || {}), day0: day0 || [] });
        const ok = ([k, val]) => keysFor(formType).includes(k) && (!/^t[A-Z]/.test(F[k].og || '') || (formType === 'case' && k === 'cell') || opt?.[F[k].og]?.includes(val));
        if (data) {
          const fill = Object.entries(data).filter(ok).filter(([k]) => !(k === 'round' && formType === 'day0'));
          setV((p) => ({ ...p, ...Object.fromEntries(fill) }));
          const lk = new Set(BASIC_LOCK.filter((k) => keysFor(formType).includes(k) && String(data[k] || '').trim()));
          wasLocked.current = lk.size > 0; setLocked(lk);
          toast('เติมข้อมูลเดิมของ HN นี้ให้แล้ว' + (lk.size ? ' (ข้อมูลพื้นฐานล็อกไว้)' : ''));
        }
      } catch {}
    }, 450);
    return () => clearTimeout(t);
  }, [v?.opd, formType, toast, opt, recordId]);

  if (!(formType === 'day0' ? perms.fillDay0 : perms.fillCase)) return <Denied />;
  if (!v) return <Spinner />;

  const set = (k, val) => {
    if (recordId) return;
    setV((p) => ({ ...p, [k]: val, ...(k === 'procType' ? depsToClear(val) : {}) }));
    setErrs((e) => (e[k] || k === 'procType' ? { ...e, [k]: '', ...(k === 'procType' ? Object.fromEntries(Object.keys(depsToClear(val)).map((d) => [d, ''])) : {}) } : e));
  };
  const patch = (id, p) => commit(filesRef.current.map((f) => f.id === id ? { ...f, ...p } : f));
  const busy = phase === 'busy';
  const showRound = formType === 'day0' && !!meta;
  const roundNote = formType === 'day0' && meta?.day0Rounds?.includes(ROUNDS.indexOf(v.round) + 1) ? 'มี Day 0 ของรอบนี้อยู่แล้ว — บันทึกแล้วข้อมูลจะอัปเดตทับของเดิม และรูปใหม่จะเข้าชุดเดิม' : '';
  const toggleSection = (i) => setOpenSections((cur) => { const n = new Set(cur); n.has(i) ? n.delete(i) : n.add(i); return n; });
  const nextSection = (i) => { setOpenSections((cur) => { const n = new Set(cur); n.delete(i); n.add(i + 1); return n; }); document.querySelector(`#sec-${i + 1}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' }); };
  const openGroup = (group) => setShut((cur) => { const n = new Set(cur); n.delete(group); return n; });
  const openPreview = (f) => {
    const items = filesRef.current.filter((x) => x.group === f.group && x.file).map((x) => ({ ...x, name: nameOf(x), mime: typeOf(x), size: sizeOf(x) }));
    setLightbox({ items, start: Math.max(0, items.findIndex((x) => x.id === f.id)) });
  };

  const prep = (f, want) => {
    const cls = classify(f.name, f.type);
    if (!cls) { toast(`ไม่ใช่ไฟล์รูปภาพ/วิดีโอ — ข้าม ${f.name}`); return null; }
    if (cls.kind !== want) { toast(`ช่องนี้รับเฉพาะ${want === 'image' ? 'รูปภาพ' : 'วิดีโอ'} — ข้าม ${f.name}`); return null; }
    const max = (want === 'image' ? limits.imageMb : limits.videoMb) * 1048576;
    if (f.size > max) { toast(`${f.name} ใหญ่เกินกำหนด (สูงสุด ${want === 'image' ? limits.imageMb : limits.videoMb} MB)`); return null; }
    return f.type === cls.mime ? f : new File([f], f.name, { type: cls.mime, lastModified: f.lastModified });
  };
  const mk = (group, slot, file, kind) => ({ id: newFileId(), group, slot, file, kind, url: URL.createObjectURL(file), status: 'queued', pct: 0, offset: 0, error: '' });
  const replaceMissing = (f, picked) => {
    const file = prep(picked, f.kind);
    if (!file) return;
    if (file.name !== nameOf(f) || file.size !== sizeOf(f) || file.type !== typeOf(f)) { toast('ต้องเลือกไฟล์เดิมชื่อ ประเภท และขนาดเดียวกันกับไฟล์ที่อยู่ในร่าง'); return; }
    if (f.url) URL.revokeObjectURL(f.url);
    commit(filesRef.current.map((x) => x.id === f.id ? { ...x, file, url: URL.createObjectURL(file), fileName: file.name, fileType: file.type, fileSize: file.size, fileModified: file.lastModified, missing: false, status: x.status === 'uploaded' ? 'uploaded' : 'queued', error: '' } : x));
    if (!filesRef.current.some((x) => x.id !== f.id && x.status === 'missing')) setDraftError('');
  };
  const addFiles = (group, want, list) => {
    const slotId = want === 'image' ? EXTRA_SLOT : VIDEO_SLOT, MAX = want === 'image' ? MAX_EXTRA : MAX_VIDEOS, unit = want === 'image' ? 'ภาพ' : 'คลิป';
    const room = MAX - filesRef.current.filter((f) => f.group === group && f.slot === slotId).length;
    if (room <= 0) return toast(`ช่องนี้เลือกครบ ${MAX} ${unit}แล้ว`);
    const picked = [...list].slice(0, room);
    if (list.length > room) toast(`เพิ่มได้อีก ${room} ${unit} (จำกัด ${MAX} ${unit}ต่อช่อง)`);
    const out = picked.map((f) => prep(f, want)).filter(Boolean).map((file) => mk(group, slotId, file, want));
    commit([...filesRef.current, ...out]); openGroup(group); setPhotoErr('');
  };
  const setSlotFile = (group, slotId, f) => {
    const file = prep(f, 'image'); if (!file) return;
    const old = filesRef.current.find((x) => x.group === group && x.slot === slotId);
    if (old?.url) URL.revokeObjectURL(old.url);
    commit([...filesRef.current.filter((x) => x !== old), mk(group, slotId, file, 'image')]); openGroup(group); setPhotoErr('');
  };
  const fillAngle = (group, a, list) => {
    const empty = a.slots.map((s) => `${a.id}-${s.k}`).filter((id) => !filesRef.current.some((x) => x.group === group && x.slot === id));
    if (!empty.length) return toast('มุมนี้ครบทุกช่องแล้ว — กด “ลบ” ที่รูปก่อนถ้าต้องการเปลี่ยน');
    const picked = [...list].slice(0, empty.length);
    if (list.length > empty.length) toast(`มุมนี้ว่างอีก ${empty.length} ช่อง — ใช้ ${empty.length} รูปแรก`);
    const out = picked.map((f) => prep(f, 'image')).filter(Boolean).map((file, i) => mk(group, empty[i], file, 'image'));
    commit([...filesRef.current, ...out]); openGroup(group); setPhotoErr('');
  };
  const remove = async (id) => {
    const f = filesRef.current.find((x) => x.id === id);
    if (phase === 'retry' && f?.status !== 'saved') {
      try { await api(`/api/media/${id}`, { method: 'DELETE' }); }
      catch (x) { if (x.status !== 404) { toast('ลบไฟล์ค้างไม่สำเร็จ: ' + x.message); return; } }
    }
    if (f?.url) URL.revokeObjectURL(f.url);
    commit(filesRef.current.filter((x) => x.id !== id));
  };

  const validate = () => {
    const e = {};
    for (const k of shownKeys(formType, v)) { const f = F[k]; if (isReq(k, formType) && !String(v[k] || '').trim()) e[k] = ['select', 'multi', 'pills'].includes(f.t) ? `กรุณาเลือก${labelOf(k, formType)}` : `กรุณากรอก${labelOf(k, formType)}`; }
    for (const k of shownKeys(formType, v)) { const min = minDateFor(k, formType, today()); if (!e[k] && min && v[k] < min) e[k] = `${labelOf(k, formType)}เลือกย้อนหลังได้ไม่เกิน 1 วัน`; }
    if (!e.opd && !OPD_RE.test(v.opd || '')) e.opd = OPD_ERR;
    setErrs(e);
    const bad = steps.findIndex((s) => s[1].some((k) => e[k]));
    if (bad >= 0) {
      setOpenSections((cur) => new Set([...cur, bad]));
      toast(Object.values(e)[0]);
      setTimeout(() => { const el = document.querySelector(`#sec-${bad} [aria-invalid=true]`); el?.focus?.(); (document.querySelector(`#sec-${bad} .fe`) || el)?.scrollIntoView({ block: 'center', behavior: 'smooth' }); }, 50);
      return false;
    }
    if (canUpload) {
      if (!filesRef.current.length) {
        setOpenSections((cur) => new Set([...cur, imageStep])); setShut(new Set());
        setPhotoErr('ต้องเลือกอย่างน้อย 1 รูปหรือวิดีโอก่อนบันทึกเคส'); toast('กรุณาเลือกรูปหรือวิดีโออย่างน้อย 1 ไฟล์');
        setTimeout(() => document.querySelector('.acc-card')?.scrollIntoView({ block: 'center' }), 50); return false;
      }
      const missingFile = filesRef.current.find((f) => f.status === 'missing');
      if (missingFile) { setPhotoErr(`ไฟล์ ${nameOf(missingFile)} ต้นฉบับหายไปจากเครื่อง — เลือกไฟล์เดิมอีกครั้งก่อนบันทึก`); setOpenSections((cur) => new Set([...cur, imageStep])); return false; }
      const badFile = filesRef.current.find((f) => f.file && (!classify(nameOf(f), typeOf(f)) || sizeOf(f) > (f.kind === 'image' ? limits.imageMb : limits.videoMb) * 1048576));
      if (badFile) { setPhotoErr(`ไฟล์ ${nameOf(badFile)} ไม่รองรับหรือใหญ่เกินกำหนด`); setOpenSections((cur) => new Set([...cur, imageStep])); return false; }
    }
    return true;
  };

  const initBody = (f, rid, seq) => ({ recordId: rid, group: f.group, slot: f.slot, name: nameOf(f), mime: typeOf(f), size: sizeOf(f), seq, mediaId: f.id });
  const initFile = (f, rid, seq) => api('/api/media/init', { method: 'POST', body: initBody(f, rid, seq) });

  async function uploadOne(f, rid, seq) {
    let cur = filesRef.current.find((x) => x.id === f.id) || f;
    if (!cur.file) {
      if (cur.status === 'uploaded') { patch(cur.id, { error: '' }); return filesRef.current.find((x) => x.id === cur.id); }
      return null;
    }
    patch(cur.id, { status: 'uploading', error: '' });
    const start = async () => {
      patch(cur.id, { uploadUrl: '', driveId: '', offset: 0, status: 'uploading', error: '' });
      const init = await initFile(filesRef.current.find((x) => x.id === cur.id) || cur, rid, seq);
      if (init.alreadySaved) { patch(cur.id, { status: 'saved', pct: 100, offset: cur.file.size }); return null; }
      patch(cur.id, { uploadUrl: init.uploadUrl, driveId: init.driveId, offset: 0, status: 'uploading' });
      return filesRef.current.find((x) => x.id === cur.id);
    };
    const send = async () => {
      try {
        await resumableUpload({ url: cur.uploadUrl, file: cur.file, offset: cur.offset,
          onOffset: (offset) => patch(cur.id, { offset }),
          onProgress: (pct) => patch(cur.id, { pct }),
        });
        return true;
      } catch (x) {
        if (!(x instanceof SessionExpiredError)) throw x;
        cur = await start();
        if (!cur) return false;
        const state = await queryUpload(cur.uploadUrl, cur.file);
        patch(cur.id, { offset: state.offset, pct: Math.round(state.offset * 100 / cur.file.size) });
        cur = filesRef.current.find((x) => x.id === cur.id);
        if (state.complete) return true;
        await resumableUpload({ url: cur.uploadUrl, file: cur.file, offset: cur.offset,
          onOffset: (offset) => patch(cur.id, { offset }),
          onProgress: (pct) => patch(cur.id, { pct }),
        });
        return true;
      }
    };
    try {
      if (!cur.uploadUrl) { cur = await start(); if (!cur) return null; }
      if (cur.status !== 'uploaded' && cur.offset < cur.file.size) {
        let state;
        try { state = await queryUpload(cur.uploadUrl, cur.file); }
        catch (x) {
          if (!(x instanceof SessionExpiredError)) throw x;
          cur = await start();
          if (!cur) return null;
          state = await queryUpload(cur.uploadUrl, cur.file);
        }
        patch(cur.id, { offset: state.offset, pct: Math.round(state.offset * 100 / cur.file.size) });
        cur = filesRef.current.find((x) => x.id === cur.id);
        if (state.complete) patch(cur.id, { status: 'uploaded', pct: 100 });
      }
      cur = filesRef.current.find((x) => x.id === cur.id);
      if (cur.offset >= cur.file.size && cur.status !== 'uploaded') patch(cur.id, { status: 'uploaded', pct: 100 });
      cur = filesRef.current.find((x) => x.id === cur.id);
      if (cur.status !== 'uploaded' && !await send()) return null;
      patch(cur.id, { status: 'uploaded', pct: 100, offset: cur.file.size, error: '' });
      return filesRef.current.find((x) => x.id === cur.id);
    } catch (x) {
      const latest = filesRef.current.find((y) => y.id === cur.id) || cur;
      const uploaded = latest.status === 'uploaded' || latest.offset >= latest.file.size;
      patch(cur.id, uploaded ? { status: 'uploaded', error: x.message } : { status: 'error', error: x.message });
      return null;
    }
  }

  async function runUploads(rid) {
    const todo = filesRef.current.filter((f) => f.status !== 'saved');
    if (!todo.length) return true;
    const perGroup = {}, queue = todo.map((f) => { const k = f.group + f.slot; return { f, seq: (perGroup[k] = (perGroup[k] ?? -1) + 1) }; });
    const images = queue.filter((x) => x.f.kind === 'image'), videos = queue.filter((x) => x.f.kind === 'video');
    const ready = []; let workersDone = false;
    const completeBatch = async (batch) => {
      try {
        const r = await api('/api/media/complete', { method: 'POST', body: { mediaIds: batch.map((f) => f.id) } });
        const bad = new Map(r.failed.map((x) => [x.mediaId, x.error]));
        batch.forEach((f) => patch(f.id, bad.has(f.id) ? { status: f.file ? 'uploaded' : 'missing', error: bad.get(f.id) } : { status: 'saved', error: '' }));
      } catch (x) { batch.forEach((f) => patch(f.id, { status: 'uploaded', error: x.message })); }
    };
    const finalizer = async () => {
      while (!workersDone || ready.length) {
        if (!ready.length) { await new Promise((r) => setTimeout(r, 120)); continue; }
        await completeBatch(ready.splice(0, 10));
      }
    };
    const worker = async (q) => { while (q.length) { const { f, seq } = q.shift(); const up = await uploadOne(f, rid, seq); if (up) ready.push(up); } };
    const fin = finalizer();
    // uplink ของมือถือมีจำกัด: ส่งหลายสตรีมพร้อมกันไม่ได้เร็วขึ้น แต่ทำให้แต่ละไฟล์ช้าลงจนหลุด/ค้าง จึงใช้ 2 รูป + 1 วิดีโอ
    const workers = Array.from({ length: Math.min(UPLOAD_IMAGE_WORKERS, images.length) }, () => worker(images));
    if (videos.length) workers.push(worker(videos));
    const wake = await keepAwake();
    try { await Promise.all(workers); } finally { wake.release(); }
    workersDone = true; await fin;
    return filesRef.current.every((f) => f.status === 'saved');
  }

  async function submit(e) {
    e?.preventDefault();
    if (busy || !validate()) return;
    setPhase('busy'); setOpenSections(new Set(canUpload ? [imageStep] : []));
    try {
      await persistNow({}, true).catch(() => setDraftError('เก็บร่างอัตโนมัติไม่สำเร็จ ควรคงเปิดหน้านี้ไว้จนกว่าจะบันทึกเสร็จ'));
      let rid = recordId;
      if (!rid) {
        const body = { formType, data: v, requestId: createId };
        const res = await api('/api/records', { method: 'POST', body });
        rid = res.id;
        if (res.recovered) toast('กู้คืนฟอร์มที่บันทึกค้างไว้แล้ว');
        else if (res.updated) toast('อัปเดต Day 0 เดิมของ HN นี้แล้ว');
        setRecordId(rid);
        await persistNow({ recordId: rid, phase: 'retry' }).catch(() => setDraftError('เก็บร่างอัตโนมัติไม่สำเร็จ ควรคงเปิดหน้านี้ไว้จนกว่าจะบันทึกเสร็จ'));
      }
      if (canUpload && filesRef.current.length) {
        toast('กำลังอัปโหลดไฟล์ต้นฉบับ...');
        const ok = await runUploads(rid);
        if (!ok) { setPhase('retry'); toast('บันทึกข้อมูลแล้ว แต่มีไฟล์ที่ยังอัปโหลดไม่สำเร็จ ไฟล์ยังอยู่ในเครื่อง'); return; }
      }
      setPhase('done'); await clearDraft();
    } catch (x) { toast('บันทึกไม่สำเร็จ: ' + x.message); setPhase(recordId ? 'retry' : 'edit'); }
  }

  async function retry() {
    if (busy || !recordId) return;
    setPhase('busy'); setOpenSections(new Set([imageStep]));
    const ok = await runUploads(recordId);
    setPhase(ok ? 'done' : 'retry');
    if (ok) await clearDraft(); else toast('ยังมีไฟล์ที่อัปโหลดไม่สำเร็จ ระบบเก็บไว้ให้ลองต่อได้');
  }
  retryRef.current = retry;

  const reset = async () => { await clearDraft(); filesRef.current.forEach((f) => f.url && URL.revokeObjectURL(f.url)); commit([]); setV(blank(opt)); setCreateId(newRequestId()); setErrs({}); setOpenSections(new Set([0])); setShut(new Set(groups.map((g) => g[0]))); setRecordId(null); setLocked(new Set()); setMeta(null); filledFor.current = ''; setPhase('edit'); setRestored(''); setDraftError(''); setPhotoErr(''); window.scrollTo(0, 0); };
  const startOver = async () => { await clearDraft(); filesRef.current.forEach((f) => f.url && URL.revokeObjectURL(f.url)); commit([]); setV(blank(opt)); setCreateId(newRequestId()); setErrs({}); setOpenSections(new Set([0])); setShut(new Set(groups.map((g) => g[0]))); setLocked(new Set()); setMeta(null); filledFor.current = ''; setRestored(''); setDraftError(''); setPhotoErr(''); toast('ล้างข้อมูลและไฟล์ที่กรอกแล้ว'); };

  if (phase === 'done') return (
    <div className="card empty" style={{ padding: 36 }}>
      <div aria-hidden="true" style={{ fontSize: 44, color: 'var(--ok)' }}>✓</div><h2>บันทึกเคสเรียบร้อยแล้ว</h2>
      <p className="mu">{fmtOpd(v.opd)} · {v.fname} {v.lname}{files.length ? ` · ${files.length} ไฟล์` : ''}</p>
      <div className="row" style={{ justifyContent: 'center', marginTop: 12 }}><button className="btn" onClick={reset}>+ เพิ่มเคสใหม่</button><button className="btn s" onClick={() => router.push('/dashboard')}>← กลับหน้าหลัก</button></div>
    </div>
  );

  const statusText = (f) => ({ queued: '', uploading: `กำลังอัปโหลด ${f.pct || 0}%`, uploaded: f.error || 'กำลังบันทึก...', saved: '✓ เรียบร้อย', missing: f.error, error: f.error })[f.status];
  const missingPicker = (f, label) => f.status === 'missing' && phase !== 'busy' ? (
    <label className="btn s sm">เลือกไฟล์เดิม<input type="file" accept={f.kind === 'image' ? ACCEPT_IMG : ACCEPT_VID} hidden aria-label={label} onChange={(e) => { const picked = e.target.files?.[0]; if (picked) replaceMissing(f, picked); e.target.value = ''; }} /></label>
  ) : null;
  const fileItems = (items) => (
    <div className="imgs">
      {items.map((f) => (
        <figure key={f.id} className={'up-item ' + (f.status === 'error' || f.status === 'missing' ? 'err' : f.status === 'saved' ? 'ok' : '')}>
          <Pv f={f} onOpen={() => openPreview(f)} />
          <figcaption>{nameOf(f).length > 22 ? nameOf(f).slice(0, 20) + '…' : nameOf(f)} · {bytes(sizeOf(f))}</figcaption>
          {(f.status === 'uploading' || f.status === 'uploaded') && <div className="bar"><i style={{ width: (f.pct || 0) + '%' }} /></div>}
          <div className="st">{statusText(f)}</div>
          {missingPicker(f, `เลือกไฟล์เดิม ${nameOf(f)}`)}
          {phase !== 'busy' && f.status !== 'saved' && <button type="button" className="btn d sm photo-remove" onClick={() => remove(f.id)} aria-label={'ลบ ' + nameOf(f)}>ลบ</button>}
        </figure>
      ))}
    </div>
  );
  const slotTile = (g, a, s) => {
    const id = `${a.id}-${s.k}`, f = files.find((x) => x.group === g[0] && x.slot === id);
    return (
      <details className={'sl' + (f ? ' has' : '')} key={id}>
        <summary className="sl-t"><b>{s.t}</b><span className="mu">{s.hint}</span></summary>
        <div className="sl-body">
          {f ? (
            <figure className={'up-item ' + (f.status === 'error' || f.status === 'missing' ? 'err' : f.status === 'saved' ? 'ok' : '')} style={{ margin: 0 }}>
              <Pv f={f} onOpen={() => openPreview(f)} />
              <figcaption>{nameOf(f).length > 18 ? nameOf(f).slice(0, 16) + '…' : nameOf(f)} · {bytes(sizeOf(f))}</figcaption>
              {(f.status === 'uploading' || f.status === 'uploaded') && <div className="bar"><i style={{ width: (f.pct || 0) + '%' }} /></div>}
              <div className="st">{statusText(f)}</div>
              {missingPicker(f, `เลือกไฟล์เดิม ${a.label} ${s.t}`)}
              {phase !== 'busy' && f.status !== 'saved' && <button type="button" className="btn d sm photo-remove" onClick={() => remove(f.id)} aria-label={`ลบรูป ${a.label} ${s.t}`}>ลบ</button>}
            </figure>
          ) : phase === 'edit' ? (
            <label className="sl-add"><span aria-hidden="true">＋</span>เลือกรูป<input type="file" accept={ACCEPT_IMG} hidden aria-label={`เลือกรูป ${a.label} ${s.t}`} onChange={(e) => { const f1 = e.target.files?.[0]; if (f1) setSlotFile(g[0], id, f1); e.target.value = ''; }} /></label>
          ) : <div className="sl-empty">—</div>}
        </div>
      </details>
    );
  };
  const angleCard = (g, a) => {
    const n = files.filter((f) => f.group === g[0] && f.slot?.startsWith(a.id + '-')).length;
    return (
      <details className="angle" key={a.id}>
        <summary><b>{a.no}. {a.label} <span className="mu" style={{ fontWeight: 400 }}>{n}/{a.slots.length} รูป</span></b></summary>
        <div className="angle-b">
          {phase === 'edit' && <label className="btn multi">กดปุ่มนี้เพื่อเลือกหลายรูปพร้อมกัน<input type="file" accept={ACCEPT_IMG} multiple hidden onChange={(e) => { fillAngle(g[0], a, e.target.files); e.target.value = ''; }} /></label>}
          <div className="slots">{a.slots.map((s) => slotTile(g, a, s))}</div>
        </div>
      </details>
    );
  };
  const kindBox = (g, kind) => {
    const slotId = kind === 'image' ? EXTRA_SLOT : VIDEO_SLOT, max = kind === 'image' ? MAX_EXTRA : MAX_VIDEOS;
    const items = files.filter((f) => f.group === g[0] && f.slot === slotId);
    return (
      <details className="slot angle" key={kind}>
        <summary><b>{kind === 'image' ? 'ภาพเพิ่มเติม' : 'วิดีโอ'} <span className="mu" style={{ fontWeight: 400 }}>{items.length}/{max} {kind === 'image' ? 'ภาพ' : 'คลิป'}</span></b></summary>
        <div className="angle-b">
          {phase === 'edit' && <label className="btn s">{kind === 'image' ? 'เลือกภาพเพิ่มเติม' : 'เลือกวิดีโอ'}<input type="file" accept={kind === 'image' ? ACCEPT_IMG : ACCEPT_VID} multiple hidden onChange={(e) => { addFiles(g[0], kind, e.target.files); e.target.value = ''; }} /></label>}
          {items.length ? fileItems(items) : <div className="empty">{kind === 'image' ? 'ยังไม่มีภาพเพิ่มเติม' : 'ยังไม่มีวิดีโอ'}</div>}
        </div>
      </details>
    );
  };
  const photoCard = (g) => {
    const items = files.filter((f) => f.group === g[0]), isShut = shut.has(g[0]);
    const imgs = items.filter((f) => f.kind === 'image').length, vids = items.length - imgs;
    const done = items.filter((f) => f.status === 'saved').length, bad = items.filter((f) => f.status === 'error' || f.status === 'missing').length;
    return (
      <div className="card acc-card" key={g[0]}>
        <button type="button" className="acc-h" style={{ padding: '4px 2px', minHeight: 44 }} aria-expanded={!isShut} onClick={() => setShut((s) => { const n = new Set(s); n.has(g[0]) ? n.delete(g[0]) : n.add(g[0]); return n; })}>
          <span className="ch">▸</span><span>{g[1]}</span><span className="sp2" />
          <span className="tag">รูป {imgs}/{IMAGES_PER_GROUP} · วิดีโอ {vids}/{MAX_VIDEOS}{done ? ` · สำเร็จ ${done}` : ''}{bad ? ` · ค้าง ${bad}` : ''}</span>
        </button>
        {!isShut && <>{ANGLES.map((a) => angleCard(g, a))}{kindBox(g, 'image')}{kindBox(g, 'video')}</>}
      </div>
    );
  };

  const failed = files.filter((f) => f.status === 'error' || f.status === 'missing' || (f.status === 'uploaded' && f.error)).length;
  const missingFiles = files.filter((f) => f.status === 'missing').length;
  const missing = shownKeys(formType, v).filter((k) => isReq(k, formType) && !String(v[k] || '').trim()).length;
  const sectionCount = (i) => { const keys = steps[i][1].filter((k) => isShown(k, v) && (k !== 'round' || showRound)); return `${keys.filter((k) => String(v[k] ?? '').trim()).length}/${keys.length}`; };
  return (
    <>
      <div className="row sp"><h1>{FORM_TITLES[formType]}</h1><button className="btn s" onClick={() => router.push('/dashboard')} disabled={busy}>← ยกเลิก</button></div>
      {missing > 0 && <div className="stp"><p className="mu"><span className="todo">ยังต้องกรอก {missing} ช่อง</span></p></div>}
      {draftError && <div className="banner" role="alert">{draftError}</div>}
      {restored && <div className="banner" role="status">กู้คืนข้อมูล{files.length ? 'และไฟล์ที่เลือกไว้' : ''}เมื่อ {restored} {recordId ? '· ระบบจะอัปโหลดไฟล์ที่เหลือต่อได้' : ''}{!recordId && <button type="button" className="btn s sm" style={{ marginLeft: 8 }} onClick={startOver} disabled={busy}>ล้างและเริ่มใหม่</button>}</div>}
      <p className="mu" style={{ fontSize: 12, margin: '0 0 8px' }}>ข้อมูลและไฟล์ที่เลือกจะถูกเก็บเป็นร่างในเครื่องนี้อัตโนมัติ หากอินเทอร์เน็ตหลุดหรือปิดหน้าเว็บโดยไม่ตั้งใจ</p>
      <form id="nf" className="s" noValidate onSubmit={submit}>
        {steps.map((s, i) => {
          const isOpen = openSections.has(i);
          return (
            <section className="acc form-sec" id={`sec-${i}`} key={s[0]}>
              <button type="button" className="acc-h" aria-expanded={isOpen} aria-controls={`body-${i}`} onClick={() => toggleSection(i)}>
                <span className="ch">▸</span><span>{i + 1}. {s[0]}</span><span className="sp2" /><span className="tag">{sectionCount(i)} ช่อง</span>
              </button>
              {isOpen && (
                <div className="acc-b" id={`body-${i}`}>
                  <div className="f2">{s[1].filter((k) => isShown(k, v) && (k !== 'round' || showRound)).map((k) => <Field key={k} locked={locked.has(k) || (formType === 'case' && k === 'cell') || !!recordId} lockNote={recordId ? 'บันทึกฟอร์มนี้แล้ว — แก้ไขได้ที่หน้าข้อมูลคนไข้' : undefined} note={k === 'round' ? roundNote : ''} k={k} formType={formType} minDate={minDateFor(k, formType, today())} value={v[k] ?? ''} onChange={set} options={opt} error={errs[k]} />)}</div>
                  {s[0] === 'หัตถการ' && <><h3 style={{ margin: '16px 0 4px' }}>ข้อมูลเพิ่มเติม</h3><label htmlFor="f-note">หมายเหตุ</label><textarea id="f-note" rows={2} value={v.note} disabled={!!recordId} onChange={(e) => set('note', e.target.value)} maxLength={1000} /></>}
                  {i === 0 && formType === 'case' && perms.viewDay0 && !!meta?.day0?.length && (
                    <div className="day0-history">
                      <h3>ข้อมูล Day 0 ของ HN นี้</h3>
                      {meta.day0.map((r) => (
                        <details className="acc sub" key={r.id}>
                          <summary className="acc-h"><span className="ch">▸</span><span>{r.round || 'ครั้งที่ 1'} · {D(r.date)}</span><span className="sp2" /><span className="tag">Day 0</span></summary>
                          <div className="acc-b"><RecordFormView record={r} /></div>
                        </details>
                      ))}
                    </div>
                  )}
                  {i < steps.length - 1 && <div className="row" style={{ justifyContent: 'flex-end', marginTop: 14 }}><button type="button" className="btn s" onClick={() => nextSection(i)}>ถัดไป ↓</button></div>}
                </div>
              )}
            </section>
          );
        })}
        {canUpload && (
          <section className="acc form-sec" id={`sec-${imageStep}`}>
            <button type="button" className="acc-h" aria-expanded={openSections.has(imageStep)} aria-controls={`body-${imageStep}`} onClick={() => toggleSection(imageStep)}>
              <span className="ch">▸</span><span>{imageStep + 1}. {formType === 'day0' ? 'ส่งรูปภาพตามขั้นตอน' : 'ส่งรูปภาพ'} <span className="req">*</span></span><span className="sp2" /><span className="tag">{files.length} ไฟล์</span>
            </button>
            {openSections.has(imageStep) && (
              <div className="acc-b" id={`body-${imageStep}`}>
                <p className="mu">ถ่ายครบ 6 มุม มุมละ 3 รูป (ด้านหน้า (ตรง) และด้านหลัง เพิ่มรูปที่ 4 = Vortex) · แต่ละรูปมี 3 ระยะกล้อง: <b>0°</b> กล้องขนานกับหน้า · <b>45°</b> มุมบน · <b>90°</b> จากด้านบน · เพิ่มภาพอื่นได้อีก {MAX_EXTRA} ภาพ และวิดีโอ {MAX_VIDEOS} คลิปต่อช่อง</p>
                <p className="mu" style={{ marginTop: 0 }}>ต้องเลือกอย่างน้อย 1 ไฟล์ก่อนบันทึกเคส (ไม่จำเป็นต้องครบทุกมุม) · ระบบส่งไฟล์ต้นฉบับโดยไม่ย่อและไม่บีบอัด · รองรับวิดีโอ MP4/MOV</p>
                <details className="guide"><summary>ดูตัวอย่างภาพถ่ายครบทุกมุม</summary><a href="/photo-guide.jpg" target="_blank" rel="noopener noreferrer"><img src="/photo-guide.jpg" alt="ตัวอย่างภาพถ่ายคนไข้ปลูกผมครบทุกมุมที่ต้องการ" loading="lazy" /></a><p className="mu" style={{ fontSize: 12 }}>แตะรูปเพื่อเปิดขนาดเต็ม</p></details>
                {photoErr && <p className="fe" role="alert">{photoErr}</p>}
                {groups.length > 1 && <div className="row" style={{ gap: 8, marginBottom: 8 }}><button type="button" className="btn s sm" onClick={() => setShut(new Set(groups.map((g) => g[0])))}>ย่อทั้งหมด</button><button type="button" className="btn s sm" onClick={() => setShut(new Set())}>ขยายทั้งหมด</button></div>}
                <div className="grid2">{groups.map(photoCard)}</div>
                {phase === 'retry' && (
                  <div className="banner" style={{ marginTop: 12 }}>{missingFiles ? `บันทึกข้อมูลเคสแล้ว แต่มี ${missingFiles} ไฟล์ที่หาไฟล์ต้นฉบับไม่พบในเครื่อง กรุณาเลือกไฟล์เดิมจากรายการที่ติดเครื่อง แล้วลองอัปโหลดต่อ` : failed ? `บันทึกข้อมูลเคสแล้ว แต่มี ${failed} ไฟล์ที่ยังอัปโหลดไม่สำเร็จ ไฟล์ยังอยู่ในเครื่องและจะต่อจากส่วนที่ส่งถึงแล้ว` : 'บันทึกข้อมูลเคสแล้ว ระบบจะตรวจสอบไฟล์ที่อัปโหลดค้างไว้ก่อนปิดร่าง'}
                    <div className="row" style={{ marginTop: 8 }}><button type="button" className="btn" onClick={retry}>ตรวจสอบและลองอัปโหลดต่อ</button></div>
                  </div>
                )}
              </div>
            )}
          </section>
        )}
        {phase !== 'retry' && (
          <>
            <div className="row dsk"><button className="btn" disabled={busy}>{busy ? <><span className="spin" /> กำลังบันทึก...</> : 'บันทึกเคส'}</button><button type="button" className="btn s" onClick={() => router.push('/dashboard')} disabled={busy}>ยกเลิก</button></div>
            <div className="stpbar"><button type="button" className="btn s" onClick={() => router.push('/dashboard')} disabled={busy}>ยกเลิก</button><button key="save" type="submit" className="btn" disabled={busy}>{busy ? 'กำลังบันทึก...' : 'บันทึกเคส'}</button></div>
          </>
        )}
      </form>
      {lightbox && <MediaLightbox items={lightbox.items} start={lightbox.start} onClose={() => setLightbox(null)} />}
    </>
  );
}
