'use client';
import { useState } from 'react';
import { useMe, Denied, Spinner } from '../../../components/Ctx.js';
import { useApi, monthLabel } from '../../../lib/client.js';

export default function Reports() {
  const { perms } = useMe();
  const [from, setFrom] = useState(''), [to, setTo] = useState('');
  const { data, loading, error } = useApi(perms.viewStats ? `/api/stats?from=${from}&to=${to}` : null);
  if (!perms.viewStats) return <Denied />;
  const K = data && [['ฟอร์มที่ส่ง', data.kpi.records, '📋'], ['คนไข้ (OPD)', data.kpi.patients, '👤'], ['ส่งรูปภาพ (ครั้ง)', data.kpi.photoSubmissions, '📷'], ['ลูกค้าที่กลับมา Follow-up', data.kpi.returning, '🔁']];
  return (
    <>
      <h1>รายงาน Dashboard</h1>
      <div className="card">
        <div className="f2" style={{ alignItems: 'end' }}>
          <div><label htmlFor="from">ตั้งแต่วันที่</label><input id="from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
          <div><label htmlFor="to">ถึงวันที่</label><input id="to" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
          <div><button className="btn s" onClick={() => { setFrom(''); setTo(''); }} style={{ marginTop: 10 }}>ล้างตัวกรอง</button></div>
        </div>
        <p className="mu" style={{ marginBottom: 0 }}>นับตามจำนวนฟอร์มที่ส่ง (วันที่กรองตาม “วันที่เข้ามา”) · สูตร KPI เชิงธุรกิจเพิ่มเติมกำหนดได้ภายหลัง</p>
      </div>
      {error ? <div className="card empty" style={{ color: 'var(--dn)' }}>{error}</div> : loading && !data ? <Spinner /> : (
        <>
          <div className="grid" style={{ marginBottom: 16 }}>{K.map(([l, n, ic]) => <div className="card stat" style={{ margin: 0 }} key={l}><span className="mu">{ic} {l}</span><b>{n}</b></div>)}</div>
          <div className="grid2">
            {data.charts.map((c) => {
              const max = Math.max(1, ...c.data.map((e) => e[1]));
              return (
                <div className="card" key={c.id}>
                  <h2>{c.title}</h2>
                  {c.data.length ? c.data.map(([k, n]) => <div className="hr" key={k}><span title={k}>{c.month ? monthLabel(k) : k}</span><div><i style={{ width: (n / max) * 100 + '%' }} /></div><b>{n}</b></div>) : <div className="empty">ไม่มีข้อมูล</div>}
                </div>
              );
            })}
          </div>
        </>
      )}
    </>
  );
}
