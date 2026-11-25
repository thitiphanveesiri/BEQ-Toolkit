'use client';
import { useMemo, useState } from 'react';
import { useMe, Denied, Spinner } from '../../../components/Ctx.js';
import RecordFormView from '../../../components/RecordFormView.js';
import { useApi, D, DT } from '../../../lib/client.js';
import { fmtOpd, roundNo } from '../../../lib/fields.js';

export default function Followups() {
  const { perms } = useMe();
  const { data, loading, error, reload } = useApi(perms.viewFollowups ? '/api/my-followups' : null);
  const [q, setQ] = useState(''), [open, setOpen] = useState(null);
  const rows = useMemo(() => {
    const t = q.trim().toLowerCase(), list = data?.rows || [];
    if (!t) return list;
    return list.filter((r) => [r.opd, r.name, r.visitPeriod, r.date, r.note].some((v) => String(v || '').toLowerCase().includes(t)));
  }, [data, q]);
  if (!perms.viewFollowups) return <Denied />;
  if (error && !data) return <div className="card empty" style={{ color: 'var(--dn)' }}>{error} <button className="btn s sm" onClick={reload}>ลองใหม่</button></div>;
  if (loading && !data) return <Spinner />;
  const toggle = (id) => setOpen((cur) => cur === id ? null : id);
  return (
    <>
      <div className="row sp"><h1>ฟอร์ม Follow-Up ของคนไข้ในความดูแล</h1><button className="btn s sm" onClick={reload}>รีเฟรช</button></div>
      <p className="mu">แสดงเฉพาะฟอร์ม F/U ที่คนไข้ถูกกำหนดให้กับเซลล์คนนี้ · อ่านอย่างเดียว ไม่สามารถแก้ไขหรือดูรูปภาพได้</p>
      <div className="grid kpi" style={{ marginBottom: 16 }}>
        <div className="card stat"><span className="mu">ฟอร์ม F/U ทั้งหมด</span><b>{data?.rows?.length || 0}</b></div>
        <div className="card stat"><span className="mu">คนไข้ในความดูแล</span><b>{new Set((data?.rows || []).map((r) => r.opd)).size}</b></div>
      </div>
      <div className="card">
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นหา HN, ชื่อ, ระยะ หรือวันที่" aria-label="ค้นหาฟอร์ม Follow-Up" />
      </div>
      {!rows.length ? <div className="card empty">ไม่พบฟอร์ม Follow-Up{ q ? ' ที่ค้นหา' : ' ของคนไข้ที่อยู่ในความดูแลของท่าน'}</div> : rows.map((r) => {
        const isOpen = open === r.id;
        return (
          <section className="acc" key={r.id}>
            <button type="button" className="acc-h" aria-expanded={isOpen} aria-controls={`fu-${r.id}`} onClick={() => toggle(r.id)}>
              <span className="ch">▸</span><span>{r.name}</span><span className="mu" style={{ fontWeight: 400 }}>HN {fmtOpd(r.opd)}</span>
              <span className="sp2" /><span className="tag">{r.visitPeriod || 'F/U'}</span><span className="mu">{D(r.date)}</span>
            </button>
            {isOpen && <div className="acc-b" id={`fu-${r.id}`}><p className="mu">ครั้งที่ {roundNo(r.round)} · บันทึกเมื่อ {DT(r.createdAt)}</p><RecordFormView record={r} /></div>}
          </section>
        );
      })}
    </>
  );
}
