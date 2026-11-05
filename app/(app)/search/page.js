'use client';
import { useEffect, useState } from 'react';
import { useMe, Denied, Spinner } from '../../../components/Ctx.js';
import { useApi } from '../../../lib/client.js';
import PatientTable from '../../../components/PatientTable.js';

export default function Search() {
  const { perms } = useMe();
  const [q, setQ] = useState(''), [dq, setDq] = useState('');
  useEffect(() => { const t = setTimeout(() => setDq(q.trim()), 250); return () => clearTimeout(t); }, [q]);
  const { data, loading, error } = useApi(perms.viewImages ? '/api/patients?q=' + encodeURIComponent(dq) : null);
  if (!perms.viewImages) return <Denied />;
  return (
    <>
      <div className="row sp"><h1>ค้นหาคนไข้</h1></div>
      <div className="card">
        <div className="sk">
          <label htmlFor="q" className="mu" style={{ position: 'absolute', left: -9999 }}>ค้นหา</label>
          <input id="q" type="search" placeholder="พิมพ์ชื่อหรือเลข OPD เช่น OPD-9002" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" />
          <p className="mu" style={{ margin: '8px 0 0' }}>{data ? `พบ ${data.total} คน${data.total > data.rows.length ? ` (แสดง ${data.rows.length} รายการแรก — พิมพ์ค้นหาให้เจาะจงขึ้น)` : ''}` : ''}</p>
        </div>
        {error ? <div className="empty" style={{ color: 'var(--dn)' }}>{error}</div> : loading && !data ? <Spinner /> : <PatientTable rows={data?.rows || []} />}
      </div>
    </>
  );
}
