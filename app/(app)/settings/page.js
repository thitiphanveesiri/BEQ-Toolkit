'use client';
import { useMe, Denied, Spinner } from '../../../components/Ctx.js';
import { useApi } from '../../../lib/client.js';

export default function Settings() {
  const { perms } = useMe();
  const { data, error, reload } = useApi(perms.manage ? '/api/audit' : null);
  if (!perms.manage) return <Denied />;
  return (
    <>
      <h1>Settings</h1>
      <div className="grid2" style={{ marginBottom: 16 }}>
        <div className="card stat"><span className="mu">โหมดข้อมูล</span><b style={{ fontSize: 20 }}>{!data ? '…' : data.mode === 'google' ? 'Google Sheets' : 'ทดลอง (ในเครื่อง)'}</b></div>
        <div className="card stat"><span className="mu">การเชื่อมต่อ Google Drive</span><b style={{ fontSize: 20 }}>{!data ? '…' : data.mode === 'mock' ? 'ไม่ใช้ (โหมดทดลอง)' : data.drive ? 'ตั้งค่าแล้ว' : 'ยังไม่ตั้งค่า'}</b></div>
      </div>
      <div className="card">
        <div className="row sp"><h2>บันทึกการใช้งานล่าสุด (Audit log)</h2><button className="btn s sm" onClick={reload}>รีเฟรช</button></div>
        <p className="mu">บันทึกว่าใครเข้าสู่ระบบ ส่งฟอร์ม อัปโหลดรูป หรือเปิดดูข้อมูลคนไข้ (ไม่เก็บรหัสผ่านหรือ token) — 100 รายการล่าสุด</p>
        {error ? <div className="empty" style={{ color: 'var(--dn)' }}>{error}</div> : !data ? <Spinner /> : !data.rows.length ? <div className="empty">ยังไม่มีบันทึก</div> : (
          <div className="tw"><table><thead><tr><th>เวลา</th><th>ผู้ใช้</th><th>การกระทำ</th><th>เป้าหมาย</th><th>รายละเอียด</th><th>IP</th></tr></thead>
            <tbody>{data.rows.map((r, i) => <tr key={i}><td>{new Date(r.ts).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'medium' })}</td><td>{r.user}</td><td>{r.action}</td><td>{r.target}</td><td>{r.detail}</td><td>{r.ip}</td></tr>)}</tbody></table></div>
        )}
      </div>
    </>
  );
}
