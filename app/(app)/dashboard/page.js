'use client';
import Link from 'next/link';
import { useMe, Spinner } from '../../../components/Ctx.js';
import { useApi, D } from '../../../lib/client.js';
import { ROLES } from '../../../lib/roles.js';
import { fmtOpd } from '../../../lib/fields.js';
import PatientTable from '../../../components/PatientTable.js';

export default function Dashboard() {
  const { user, perms } = useMe();
  const h = new Date().getHours();
  const hello = h < 12 ? 'ตอนเช้า' : h < 17 ? 'ตอนบ่าย' : 'ตอนเย็น';
  const { data: st } = useApi(perms.viewStats ? '/api/stats' : null);
  const { data: rem } = useApi(perms.viewImages ? '/api/reminders' : null);
  const { data: recent, loading } = useApi(perms.viewImages ? '/api/patients?q=' : null);
  const menus = [
    perms.fillForm && ['/new/case', '👤', 'คนไข้ติดตามผลตามระยะ Follow-Up(F/U)'], perms.fillForm && ['/new/day0', '🖼️', 'คนไข้เข้ารับบริการ(DAY 0)'],
    perms.viewImages && ['/search', '🔎', 'ค้นหาคนไข้'], perms.viewStats && ['/reports', '📊', 'รายงาน Dashboard'],
    perms.manage && ['/users', '👥', 'จัดการผู้ใช้'], perms.manage && ['/forms', '🧩', 'จัดการฟอร์ม'],
  ].filter(Boolean);
  return (
    <>
      <div className="hero2"><small>WELCOME BACK</small><h1>สวัสดี{hello}, {user.name}</h1><p>ยินดีต้อนรับสู่ระบบจัดการภาพคนไข้และติดตามผล</p><span className="chip">{ROLES[user.role]}</span> <span className="chip">{D(new Date().toISOString().slice(0, 10))}</span></div>
      {perms.viewStats && (
        <div className="grid kpi" style={{ marginBottom: 16 }}>
          {[['ฟอร์มที่ส่งทั้งหมด', st?.kpi.records], ['คนไข้ (OPD)', st?.kpi.patients], ['ส่งรูปภาพ (ครั้ง)', st?.kpi.photoSubmissions], ['คนไข้ที่มา F/U', st?.kpi.returning]].map(([l, n]) => (
            <div className="card stat" style={{ margin: 0 }} key={l}><span className="mu">{l}</span><b>{n ?? '–'}</b></div>
          ))}
        </div>
      )}
      <h2>เมนูที่ใช้งานได้</h2>
      <div className="grid" style={{ marginBottom: 20 }}>
        {menus.map(([href, ic, l]) => <Link key={href} href={href} className="mcard" style={{ textDecoration: 'none' }}><span>{ic}</span><b>{l}</b></Link>)}
      </div>
      {perms.viewImages && !!rem?.rows?.length && (
        <div className="card fu-card">
          <h2 style={{ marginTop: 0 }}>🔔 แจ้งเตือนนัด Follow-Up ({rem.rows.length})</h2>
          <p className="mu" style={{ marginTop: 0, fontSize: 13 }}>คนไข้ที่ใกล้ถึง (ภายใน 14 วัน) หรือเพิ่งเลยนัด F/U ระยะ 1, 3, 6, 9, 12 เดือนนับจากวันที่มาปลูก</p>
          <div className="fu-list">
            {rem.rows.slice(0, 8).map((r) => (
              <Link key={r.opd + r.months} href={'/patient/' + r.opd} className={'fu-item ' + r.status}>
                <b>{r.name}</b><span className="mu">{fmtOpd(r.opd)}</span>
                <span>F/U {r.months} เดือน · {D(r.due)}</span>
                <span className={'tag ' + (r.status === 'overdue' ? 'x' : 'w')}>{r.days > 0 ? `อีก ${r.days} วัน` : r.days === 0 ? 'วันนี้' : `เลยมา ${-r.days} วัน`}</span>
              </Link>
            ))}
          </div>
          {rem.rows.length > 8 && <p className="mu" style={{ fontSize: 12 }}>และอีก {rem.rows.length - 8} ราย — ค้นหาคนไข้เพื่อดูรายละเอียด</p>}
        </div>
      )}
      {perms.viewImages && (
        <div className="card">
          <div className="row sp"><h2>คนไข้ล่าสุด</h2><Link className="btn s sm" href="/search">ดูทั้งหมด</Link></div>
          {loading && !recent ? <Spinner /> : <PatientTable rows={(recent?.rows || []).slice(0, 5)} />}
        </div>
      )}
      {!menus.length && <div className="card empty">บัญชีนี้ยังไม่ได้รับสิทธิ์ใช้งานเมนูใด ติดต่อผู้ดูแลระบบ</div>}
    </>
  );
}
