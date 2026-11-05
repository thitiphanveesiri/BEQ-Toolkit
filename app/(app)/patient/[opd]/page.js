'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMe, Denied, Spinner } from '../../../../components/Ctx.js';
import MediaViewer from '../../../../components/MediaViewer.js';
import RecordEditor from '../../../../components/RecordEditor.js';
import { useApi, D } from '../../../../lib/client.js';
import { F, procLabel, roundNo, labelOf } from '../../../../lib/fields.js';

// ข้อมูลประจำตัวคนไข้ (ด้านบน) และข้อมูลของแต่ละครั้งที่ส่งฟอร์ม (ในแต่ละ dropdown)
const SHOW = ['opd', 'name', 'gender', 'age', 'nat', 'round', 'plant', 'uploaded', 'procType', 'area', 'hairMethod', 'tool', 'inj', 'ct', 'visitPeriod', 'cell', 'doc', 'ph', 'ck'];
const REC_SHOW = ['date', 'plantDate', 'uploaded', 'round', 'procType', 'area', 'hairMethod', 'tool', 'inj', 'ct', 'visitPeriod', 'cell', 'doc', 'ph', 'ck'];
const EXTRA = { proc: 'หัตถการ', plant: 'วันที่มาปลูก', uploaded: 'วันที่อัปโหลด' }; // ช่องที่คำนวณเอง ไม่ได้เก็บเป็นคอลัมน์
const label = (k, ft) => EXTRA[k] || labelOf(k, ft);
const val = (k, v) => (F[k]?.t === 'date' || k === 'plant' || k === 'uploaded' ? D(v) : v);
const Grid = ({ o, keys = SHOW, ft }) => (
  <div className="detail-grid">{keys.filter((k) => o[k] && o[k] !== '—').map((k) => <div key={k}><small>{label(k, ft)}</small><b>{val(k, o[k])}</b></div>)}</div>
);
// เรียง: Day 0 ก่อน แล้วตามวันที่ (เก่า → ใหม่) ให้ตรงกับหน้ารูปภาพ
const order = (a, b) => roundNo(a.round) - roundNo(b.round) || (a.formType === b.formType ? (a.date || '').localeCompare(b.date || '') : a.formType === 'day0' ? -1 : 1);

export default function Patient() {
  const { perms } = useMe();
  const { opd } = useParams();
  const { data: p, loading, error, reload } = useApi(perms.viewImages ? '/api/patients/' + opd : null);
  const [tab, setTab] = useState('info'), [edit, setEdit] = useState(null), [open, setOpen] = useState(null), [sumOpen, setSumOpen] = useState(true);
  if (!perms.viewImages) return <Denied />;
  if (error && !p) return <div className="card empty" style={{ color: 'var(--dn)' }}>{error}</div>;
  if (loading && !p) return <Spinner />;
  const recs = [...p.records].sort(order);
  const isOpen = (id) => (open ? open.has(id) : id === recs[recs.length - 1]?.id); // ค่าเริ่มต้น: เปิดเฉพาะครั้งล่าสุด
  const toggle = (id) => setOpen((cur) => { const n = new Set(cur || [recs[recs.length - 1]?.id]); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const multi = recs.some((r) => roundNo(r.round) > 1), pre = (r) => (multi ? `ครั้งที่ ${roundNo(r.round)} · ` : '');
  const day0s = recs.filter((r) => r.formType === 'day0'), lastDay0 = day0s[day0s.length - 1];
  // วันที่อัปโหลด = วันที่ส่งฟอร์ม/รูปเข้าระบบ (ไม่ใช่วันที่มาปลูก)
  const upAt = (r) => p.media.filter((m) => m.recordId === r.id).map((m) => m.at).sort()[0] || r.createdAt || '';
  const summary = { ...p.info, round: lastDay0?.round || p.info.round, plant: lastDay0?.date || p.info.plantDate, uploaded: recs.map(upAt).sort().pop() };
  const procOf = (r) => (r.procType ? '' : procLabel(r) === '—' ? '' : procLabel(r));
  return (
    <>
      <div className="row sp"><Link className="btn s sm" href="/search">← ย้อนกลับ</Link><span className="mu">{p.opd}</span></div>
      <h1 style={{ marginTop: 10 }}>{p.name}</h1>
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'info'} className={tab === 'info' ? 'on' : ''} onClick={() => setTab('info')}>ข้อมูลคนไข้</button>
        <button role="tab" aria-selected={tab === 'img'} className={tab === 'img' ? 'on' : ''} onClick={() => setTab('img')}>รูปภาพ / วิดีโอ ({p.media.length})</button>
      </div>
      {tab === 'info' ? (
        <div className="card">
          <section className="acc" style={{ marginTop: 0 }}>
            <button className="acc-h" aria-expanded={sumOpen} onClick={() => setSumOpen(!sumOpen)}><span className="ch">▸</span><span>ข้อมูลล่าสุดของคนไข้</span><span className="sp2" /></button>
            {sumOpen && <div className="acc-b"><Grid o={summary} /></div>}
          </section>
          <div className="row sp" style={{ marginTop: 18 }}>
            <h2 style={{ margin: 0 }}>ประวัติฟอร์มของ OPD นี้ ({recs.length})</h2>
            <span className="row" style={{ gap: 8 }}>
              <button className="btn s sm" onClick={() => setOpen(new Set(recs.map((r) => r.id)))}>ขยายทั้งหมด</button>
              <button className="btn s sm" onClick={() => setOpen(new Set())}>ย่อทั้งหมด</button>
            </span>
          </div>
          {recs.map((r) => {
            const o = isOpen(r.id), n = p.media.filter((m) => m.recordId === r.id).length;
            return (
              <section className="acc" key={r.id}>
                <button className="acc-h" aria-expanded={o} aria-controls={'r-' + r.id} onClick={() => toggle(r.id)}>
                  <span className="ch">▸</span><span>{pre(r)}{r.formType === 'day0' ? 'Day 0 ก่อนวาดเส้น' : r.visitPeriod || 'BEQ Hair Center'}</span>
                  <span className="mu" style={{ fontWeight: 400 }}>{D(r.date)}</span><span className="sp2" /><span className="tag">{n} ไฟล์</span>
                </button>
                {o && (
                  <div className="acc-b" id={'r-' + r.id}>
                    <Grid o={{ ...r, proc: procOf(r), uploaded: upAt(r) }} keys={['proc', ...REC_SHOW]} ft={r.formType} />
                    {r.note && <p className="mu">หมายเหตุ: {r.note}</p>}
                    <div className="row" style={{ gap: 8, marginTop: 8 }}>
                      {n > 0 && <button className="btn s sm" onClick={() => setTab('img')}>ดูรูป ({n})</button>}
                      {perms.manage && <button className="btn s sm" onClick={() => setEdit(r)}>แก้ไข</button>}
                    </div>
                  </div>
                )}
              </section>
            );
          })}
        </div>
      ) : <div className="card"><MediaViewer records={p.records} media={p.media} /></div>}
      {edit && <RecordEditor record={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />}
    </>
  );
}
