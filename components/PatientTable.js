'use client';
import { useRouter } from 'next/navigation';
import { D } from '../lib/client.js';

export default function PatientTable({ rows }) {
  const router = useRouter();
  const open = (o) => router.push('/patient/' + encodeURIComponent(o));
  if (!rows.length) return <div className="empty">🔎 ไม่พบข้อมูลคนไข้ ลองตรวจสอบชื่อหรือเลข OPD อีกครั้ง</div>;
  return (
    <>
      <div className="tw rw">
        <table className="rl">
          <thead><tr><th>OPD</th><th>ชื่อนามสกุล</th><th>วันที่ล่าสุด</th><th>หัตถการ</th><th>ปลูกด้วย</th><th>ประเภทเคส</th><th>รูป</th><th></th></tr></thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.opd} className="click" onClick={() => open(p.opd)}>
                <td>{p.opd}</td><td>{p.name}</td><td>{D(p.date)}</td><td>{p.proc}</td><td>{p.tool || '—'}</td><td>{p.ct || '—'}</td><td>{p.photos}</td>
                <td><button type="button" className="btn s sm" onClick={(e) => { e.stopPropagation(); open(p.opd); }}>ดูข้อมูล</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="pcards">
        {rows.map((p) => (
          <article className="pc" key={p.opd} onClick={() => open(p.opd)}>
            <div className="row sp"><b>{p.name}</b><span className="tag">{p.opd}</span></div>
            <div className="mu">ล่าสุด {D(p.date)} · {p.proc}</div>
            <div className="mu">ปลูกด้วย {p.tool || '—'} · ประเภทเคส {p.ct || '—'} · {p.photos} ไฟล์</div>
            <button type="button" className="btn s" style={{ marginTop: 8 }}>ดูข้อมูล</button>
          </article>
        ))}
      </div>
    </>
  );
}
