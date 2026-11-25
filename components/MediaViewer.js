'use client';
import { useMemo, useState } from 'react';
import { D } from '../lib/client.js';
import { groupLabel, roundNo, slotBucket, slotLabel, slotOrder } from '../lib/fields.js';
import MediaLightbox from './MediaLightbox.js';

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
    .map((s) => ({ ...s, groups: [...s.groups.entries()].sort((a, b) => GROUP_ORDER.indexOf(a[0]) - GROUP_ORDER.indexOf(b[0])).map(([g, items]) => ({ key: s.key + '/' + g, g, label: groupLabel(g), items: items.sort((a, b) => slotOrder(a) - slotOrder(b) || a.name.localeCompare(b.name)) })) }))
    .map((s) => ({ ...s, count: s.groups.reduce((n, g) => n + g.items.length, 0) }))
    .sort((a, b) => a.round - b.round || (a.day0 === b.day0 ? a.date.localeCompare(b.date) : a.day0 ? -1 : 1));
}

function Thumb({ m, i, onOpen }) {
  const [bad, setBad] = useState(false);
  return (
    <figure style={{ margin: 0 }}>
      <button type="button" className="thumb" onClick={() => onOpen(i)} aria-label={`เปิดดู ${m.name}`}>
        {m.kind === 'video' ? <span className="ph">🎬</span> : bad ? <span className="ph">🖼️</span> : <img src={`/api/media/${m.id}?thumb=1`} alt={m.name} loading="lazy" decoding="async" onError={() => setBad(true)} />}
        {m.kind === 'video' && <span className="play">▶</span>}
        <span className="no">#{i + 1}</span>
      </button>
      {slotLabel(m.slot, m.kind) && <figcaption className="mu" style={{ fontSize: 11, textAlign: 'center', marginTop: 2 }}>{slotLabel(m.slot, m.kind)}</figcaption>}
    </figure>
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

  // แบ่งหัวข้อตามมุมถ่ายภาพ (ข้อมูลเก่าที่ไม่ระบุมุมแสดงรวมกันเหมือนเดิม)
  const grid = (g) => {
    const buckets = [];
    for (const m of g.items) { const [k, label] = slotBucket(m); let b = buckets.find((x) => x.k === k); if (!b) buckets.push((b = { k, label, list: [] })); b.list.push(m); }
    const plain = buckets.length === 1 && buckets[0].k === 'other';
    return buckets.map((b) => (
      <div key={b.k}>
        {!plain && <div className="slot-h">{b.label} <span className="mu" style={{ fontWeight: 400 }}>({b.list.length})</span></div>}
        <div className="imgs">{b.list.map((m) => { const i = g.items.indexOf(m); return <Thumb key={m.id} m={m} i={i} onOpen={(x) => setLb({ items: g.items, i: x })} />; })}</div>
      </div>
    ));
  };
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
      {lb && <MediaLightbox items={lb.items} start={lb.i} onClose={() => setLb(null)} />}
    </>
  );
}
