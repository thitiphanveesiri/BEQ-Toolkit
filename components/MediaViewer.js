'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { D, bytes } from '../lib/client.js';
import { groupLabel, roundNo } from '../lib/fields.js';

const GROUP_ORDER = ['front', 'left', 'right', 'single'];

// จัดรูปเป็นลำดับ: Day 0 (ก่อน/หลังวาดเส้น/หลังปลูกทันที) → แต่ละระยะที่เข้ามาตรวจ ตามวันที่
export function buildSections(records, media) {
  const rec = new Map(records.map((r) => [r.id, r]));
  const secs = new Map(), multi = records.some((r) => roundNo(r.round) > 1); // มีหลายรอบ → ใส่ "ครั้งที่ N" นำหน้าทุกหัวข้อ
  for (const m of media) {
    const r = rec.get(m.recordId); if (!r) continue;
    const n = roundNo(r.round), pre = multi ? `ครั้งที่ ${n} · ` : '';
    const day0 = r.formType === 'day0', key = day0 ? 'd0|' + r.id : `p|${n}|` + (r.visitPeriod || '-');
    if (!secs.has(key)) secs.set(key, { key, day0, round: n, date: r.date, title: day0 ? `${pre}Day 0 · ${D(r.date)}` : `${pre}ระยะ ${r.visitPeriod || 'ไม่ระบุ'}`, groups: new Map() });
    const s = secs.get(key); if (r.date < s.date) s.date = r.date;
    if (!s.groups.has(m.group)) s.groups.set(m.group, []);
    s.groups.get(m.group).push(m);
  }
  return [...secs.values()]
    .map((s) => ({ ...s, groups: [...s.groups.entries()].sort((a, b) => GROUP_ORDER.indexOf(a[0]) - GROUP_ORDER.indexOf(b[0])).map(([g, items]) => ({ key: s.key + '/' + g, g, label: groupLabel(g), items: items.sort((a, b) => a.name.localeCompare(b.name)) })) }))
    .map((s) => ({ ...s, count: s.groups.reduce((n, g) => n + g.items.length, 0) }))
    .sort((a, b) => a.round - b.round || (a.day0 === b.day0 ? a.date.localeCompare(b.date) : a.day0 ? -1 : 1));
}

function Thumb({ m, i, onOpen }) {
  const [bad, setBad] = useState(false);
  return (
    <figure style={{ margin: 0 }}>
      <button type="button" className="thumb" onClick={() => onOpen(i)} aria-label={`เปิดดู ${m.name}`}>
        {bad ? <span className="ph">{m.kind === 'video' ? '🎬' : '🖼️'}</span> : <img src={`/api/media/${m.id}?thumb=1`} alt={m.name} loading="lazy" decoding="async" onError={() => setBad(true)} />}
        {m.kind === 'video' && <span className="play">▶</span>}
        <span className="no">#{i + 1}</span>
      </button>
    </figure>
  );
}

// แสดงรูป/วิดีโอในกรอบขยาย: ถ้าเบราว์เซอร์เปิดชนิดไฟล์นี้ไม่ได้ (เช่น HEIC/TIFF บน Chrome, AVI/WMV ที่ไม่มีตัวถอดรหัส) จะแจ้งและให้ดาวน์โหลดแทนจอว่าง
function LbMedia({ m, zoom, setZoom }) {
  const [bad, setBad] = useState(false);
  const src = `/api/media/${m.id}`;
  if (bad) return (
    <div className="lb-bad">
      <p>{m.kind === 'video' ? '🎬' : '🖼️'} เบราว์เซอร์นี้เปิดไฟล์ชนิดนี้ไม่ได้ ({String(m.name || '').split('.').pop().toUpperCase()})</p>
      <a className="btn" href={`${src}?download=1`}>⬇ ดาวน์โหลดไฟล์ไปเปิดดู</a>
      <p className="mu" style={{ fontSize: 12 }}>ลองเปิดด้วย Safari/Chrome เวอร์ชันล่าสุด หรือแอปเล่นวิดีโอ/รูปในเครื่อง</p>
    </div>
  );
  return m.kind === 'video'
    ? <video src={src} controls autoPlay playsInline preload="metadata" onError={() => setBad(true)}>{m.mime ? <source src={src} type={m.mime} onError={() => setBad(true)} /> : null}</video>
    : <div className={'lightbox-scroll' + (zoom ? ' zoomed' : '')}><img src={src} alt={m.name} draggable={false} onClick={() => setZoom((z) => !z)} onError={() => setBad(true)} /></div>;
}

function Lightbox({ items, start, onClose }) {
  const [i, setI] = useState(start), [zoom, setZoom] = useState(false);
  const m = items[i], closeRef = useRef(), touch = useRef(null);
  const move = (d) => { setZoom(false); setI((x) => (x + d + items.length) % items.length); };
  useEffect(() => {
    closeRef.current?.focus();
    const prev = document.body.style.overflow; document.body.style.overflow = 'hidden';
    const k = (e) => { if (e.key === 'Escape') onClose(); else if (e.key === 'ArrowRight') move(1); else if (e.key === 'ArrowLeft') move(-1); };
    window.addEventListener('keydown', k);
    return () => { window.removeEventListener('keydown', k); document.body.style.overflow = prev; };
  }, []); // eslint-disable-line
  useEffect(() => { for (const d of [1, -1]) { const n = items[(i + d + items.length) % items.length]; if (n?.kind === 'image') new Image().src = `/api/media/${n.id}`; } }, [i, items]);
  // ปัดซ้าย/ขวาเพื่อเลื่อนรูป (ตอนซูมอยู่ การปัดจะเลื่อนดูภาพแทน)
  const ts = (e) => { const t = e.touches[0]; touch.current = { x: t.clientX, y: t.clientY }; };
  const te = (e) => {
    const s0 = touch.current; touch.current = null; if (!s0 || zoom || items.length < 2) return;
    const t = e.changedTouches[0], dx = t.clientX - s0.x, dy = t.clientY - s0.y;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) move(dx < 0 ? 1 : -1);
  };
  return createPortal(
    <div className="lightbox" role="dialog" aria-modal="true" aria-label="ดูรูปขยาย" onClick={(e) => e.target === e.currentTarget && onClose()} onTouchStart={ts} onTouchEnd={te}>
      <button ref={closeRef} className="zoom-close" onClick={onClose} aria-label="ปิด">×</button>
      {items.length > 1 && <button className="lb-nav l" onClick={() => move(-1)} aria-label="ก่อนหน้า">‹</button>}
      <div className="lightbox-panel">
        <LbMedia key={m.id} m={m} zoom={zoom} setZoom={setZoom} />
        <div className="lightbox-caption">{i + 1}/{items.length} · {m.name} · {bytes(m.size)}· <a href={`/api/media/${m.id}?download=1`} style={{ color: '#9be7c8' }}>⬇ ดาวน์โหลด</a>{m.drive && <> · <a href={m.drive} target="_blank" rel="noopener noreferrer" style={{ color: '#9be7c8' }}>เปิดใน Drive</a></>}</div>
        <div className="lb-hint">{m.kind === 'image' ? (zoom ? 'แตะที่รูปเพื่อย่อกลับ · เลื่อนดูส่วนต่างๆ ของรูปได้' : 'แตะที่รูปเพื่อซูม') : ''}{items.length > 1 && ' · ปัดซ้าย/ขวาเพื่อเลื่อนรูป'}</div>
        {items.length > 1 && (
          <div className="lb-strip" role="tablist" aria-label="รูปทั้งหมดในกลุ่ม">
            {items.map((x, j) => <button key={x.id} type="button" aria-current={j === i} aria-label={`รูปที่ ${j + 1}`} onClick={() => { setZoom(false); setI(j); }}>{x.kind === 'image' ? <img src={`/api/media/${x.id}?thumb=1`} alt="" loading="lazy" /> : <span style={{ color: '#fff' }}>▶</span>}</button>)}
          </div>
        )}
      </div>
      {items.length > 1 && <button className="lb-nav r" onClick={() => move(1)} aria-label="ถัดไป">›</button>}
    </div>,
    document.body // วาดที่ระดับ body เพื่อให้เต็มจอเสมอ ไม่ถูกจำกัดโดยการ์ดที่ครอบอยู่
  );
}

export default function MediaViewer({ records, media }) {
  const sections = useMemo(() => buildSections(records, media), [records, media]);
  const [open, setOpen] = useState(() => new Set(sections.length ? [sections[sections.length - 1].key] : []));
  const [closedSub, setClosedSub] = useState(() => new Set());
  const [lb, setLb] = useState(null), [cmp, setCmp] = useState(false), [pick, setPick] = useState([]), [showCmp, setShowCmp] = useState(false);
  const toggle = (set, setter, k) => setter((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });
  if (!sections.length) return <div className="empty">ยังไม่มีรูปภาพหรือวิดีโอ</div>;
  const allGroups = sections.flatMap((s) => s.groups.map((g) => ({ ...g, sec: s.title })));
  const picked = pick.map((k) => allGroups.find((g) => g.key === k)).filter(Boolean);
  const togglePick = (k) => setPick((p) => (p.includes(k) ? p.filter((x) => x !== k) : p.length >= 2 ? [p[1], k] : [...p, k]));

  const grid = (g) => <div className="imgs">{g.items.map((m, i) => <Thumb key={m.id} m={m} i={i} onOpen={(x) => setLb({ items: g.items, i: x })} />)}</div>;
  return (
    <>
      <div className="tb">
        <button className="btn s sm" onClick={() => setOpen(new Set(sections.map((s) => s.key)))}>ขยายทั้งหมด</button>
        <button className="btn s sm" onClick={() => { setOpen(new Set()); }}>ย่อทั้งหมด</button>
        <button className={'btn sm ' + (cmp ? '' : 's')} onClick={() => { setCmp(!cmp); setPick([]); }} aria-pressed={cmp}>↔ เปรียบเทียบ</button>
        <span className="mu">{media.length} ไฟล์ · {sections.length} ระยะ</span>
      </div>
      {cmp && <p className="mu" style={{ marginTop: 0 }}>ติ๊กเลือก 2 กลุ่มรูปที่ต้องการเทียบ (เช่น ก่อนวาดเส้น เทียบกับ 3 เดือน) แล้วกด “ดูเทียบ”</p>}
      {sections.map((s) => {
        const isOpen = open.has(s.key);
        return (
          <section className="acc" key={s.key}>
            <button className="acc-h" aria-expanded={isOpen} aria-controls={'b-' + s.key} onClick={() => toggle(open, setOpen, s.key)}>
              <span className="ch">▸</span><span>{s.title}</span>{!s.day0 && <span className="mu" style={{ fontWeight: 400 }}>{D(s.date)}</span>}<span className="sp2" /><span className="tag">{s.count} ไฟล์</span>
            </button>
            {isOpen && (
              <div className="acc-b" id={'b-' + s.key}>
                {s.groups.length === 1 && !s.day0 ? (
                  <>
                    {cmp && <label className="permcheck"><input type="checkbox" checked={pick.includes(s.groups[0].key)} onChange={() => togglePick(s.groups[0].key)} /> เลือกกลุ่มนี้เพื่อเปรียบเทียบ</label>}
                    {grid(s.groups[0])}
                  </>
                ) : s.groups.map((g) => {
                  const subOpen = !closedSub.has(g.key);
                  return (
                    <div className="acc sub" key={g.key}>
                      <div className="acc-h" style={{ cursor: 'default' }}>
                        <button type="button" className="acc-h" style={{ padding: 0, minHeight: 0, flex: 1, background: 'none' }} aria-expanded={subOpen} onClick={() => toggle(closedSub, setClosedSub, g.key)}>
                          <span className="ch">▸</span><span>{g.label}</span><span className="sp2" /><span className="tag">{g.items.length}</span>
                        </button>
                        {cmp && <label><input type="checkbox" checked={pick.includes(g.key)} onChange={() => togglePick(g.key)} aria-label={'เลือก ' + g.label} /> เทียบ</label>}
                      </div>
                      {subOpen && <div className="acc-b">{grid(g)}</div>}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        );
      })}
      {cmp && (
        <div className="cmpbar"><span>เลือกแล้ว {picked.length}/2 กลุ่ม</span><button className="btn sm" disabled={picked.length < 2} onClick={() => setShowCmp(true)}>ดูเทียบ</button></div>
      )}
      {showCmp && picked.length === 2 && (
        <div className="ov" onClick={(e) => e.target === e.currentTarget && setShowCmp(false)}>
          <div className="mod wide" role="dialog" aria-modal="true" aria-label="เปรียบเทียบรูป">
            <div className="row sp"><h2>เปรียบเทียบ</h2><button className="btn s sm" onClick={() => setShowCmp(false)}>ปิด</button></div>
            <div className="cmp">{picked.map((g) => <div key={g.key}><h3>{g.sec} · {g.label} ({g.items.length})</h3>{grid(g)}</div>)}</div>
          </div>
        </div>
      )}
      {lb && <Lightbox items={lb.items} start={lb.i} onClose={() => setLb(null)} />}
    </>
  );
}
