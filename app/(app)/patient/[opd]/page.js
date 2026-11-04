'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMe, Denied, Spinner } from '../../../../components/Ctx.js';
import MediaViewer from '../../../../components/MediaViewer.js';
import RecordEditor from '../../../../components/RecordEditor.js';
import { useApi, D } from '../../../../lib/client.js';
import { F, procLabel } from '../../../../lib/fields.js';

const SHOW = ['opd', 'name', 'gender', 'age', 'date', 'plantDate', 'nat', 'procType', 'hairMethod', 'proc', 'area', 'tool', 'inj', 'ct', 'visitPeriod', 'cell', 'doc', 'ph', 'ck'];
const label = (k) => (k === 'proc' ? 'หัตถการ' : F[k].l);
const val = (k, v) => (F[k]?.t === 'date' ? D(v) : v);
const Grid = ({ o }) => (
  <div className="detail-grid">{SHOW.filter((k) => o[k] && o[k] !== '—' && !(k === 'proc' && o.procType)).map((k) => <div key={k}><small>{label(k)}</small><b>{val(k, o[k])}</b></div>)}</div>
);

export default function Patient() {
  const { perms } = useMe();
  const { opd } = useParams();
  const { data: p, loading, error, reload } = useApi(perms.viewImages ? '/api/patients/' + opd : null);
  const [tab, setTab] = useState('info'), [edit, setEdit] = useState(null);
  if (!perms.viewImages) return <Denied />;
  if (error && !p) return <div className="card empty" style={{ color: 'var(--dn)' }}>{error}</div>;
  if (loading && !p) return <Spinner />;
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
          <Grid o={p.info} />
          <h2 style={{ marginTop: 18 }}>ประวัติฟอร์มของ OPD นี้ ({p.records.length})</h2>
          <div className="grid">
            {p.records.map((r) => (
              <div className="card" style={{ margin: 0 }} key={r.id}>
                <div className="row sp"><b>{r.formType === 'day0' ? 'Day 0 ก่อนวาดเส้น' : r.visitPeriod || 'BEQ Hair Center'}</b><span className="tag">{D(r.date)}</span></div>
                <Grid o={{ ...r, proc: procOf(r) }} />
                {r.note && <p className="mu">หมายเหตุ: {r.note}</p>}
                <p className="mu">รูป/วิดีโอ: {p.media.filter((m) => m.recordId === r.id).length} ไฟล์</p>
                {perms.manage && <button className="btn s sm" onClick={() => setEdit(r)}>แก้ไข</button>}
              </div>
            ))}
          </div>
        </div>
      ) : <div className="card"><MediaViewer records={p.records} media={p.media} /></div>}
      {edit && <RecordEditor record={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />}
    </>
  );
}
