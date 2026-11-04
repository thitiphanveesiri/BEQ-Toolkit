'use client';
import { useState } from 'react';
import { useMe, useToast, Denied, Spinner } from '../../../components/Ctx.js';
import { api, useApi } from '../../../lib/client.js';
import { ROLES, can } from '../../../lib/roles.js';

const PERM_LABELS = [['fillForm', 'กรอก/ส่งฟอร์ม'], ['upload', 'อัปโหลดรูป/วิดีโอ'], ['viewImages', 'ดูรูป/วิดีโอ'], ['viewStats', 'ดูรายงาน'], ['manage', 'จัดการระบบ']];

function Editor({ u, onClose, onSaved }) {
  const toast = useToast(), isNew = !u;
  const [f, setF] = useState({ username: '', name: u?.name || '', role: u?.role || 'bt', active: u ? u.active : true, password: '' });
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));
  async function save(e) {
    e.preventDefault(); setBusy(true);
    try {
      if (isNew) await api('/api/users', { method: 'POST', body: f });
      else await api('/api/users/' + u.id, { method: 'PATCH', body: { name: f.name, role: f.role, active: f.active, ...(f.password ? { password: f.password } : {}) } });
      toast('บันทึกผู้ใช้แล้ว'); onSaved();
    } catch (x) { toast('❌ ' + x.message); setBusy(false); }
  }
  return (
    <div className="ov" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <form className="mod" id="userEditor" onSubmit={save}>
        <h2>{isNew ? 'เพิ่มผู้ใช้' : 'แก้ไขผู้ใช้ · ' + u.username}</h2>
        {isNew && <><label htmlFor="un">Username</label><input id="un" value={f.username} onChange={(e) => set('username', e.target.value)} required autoCapitalize="none" autoComplete="off" pattern="[A-Za-z0-9._\-]{3,32}" title="a-z 0-9 . _ - ความยาว 3–32 ตัว" /></>}
        <label htmlFor="nm">ชื่อที่แสดง</label><input id="nm" value={f.name} onChange={(e) => set('name', e.target.value)} required maxLength={80} />
        <label htmlFor="rl">บทบาท</label>
        <select id="rl" value={f.role} onChange={(e) => set('role', e.target.value)}>{Object.entries(ROLES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        <div className="chips">{PERM_LABELS.map(([p, l]) => <span key={p} className={'tag ' + (can(f.role, p) ? 'o' : '')} style={{ opacity: can(f.role, p) ? 1 : 0.45 }}>{can(f.role, p) ? '✓' : '✕'} {l}</span>)}</div>
        <label htmlFor="pw">{isNew ? 'รหัสผ่าน (อย่างน้อย 8 ตัวอักษร)' : 'ตั้งรหัสผ่านใหม่ (เว้นว่างถ้าไม่เปลี่ยน)'}</label>
        <input id="pw" type="password" value={f.password} onChange={(e) => set('password', e.target.value)} minLength={8} required={isNew} autoComplete="new-password" />
        {!isNew && <label className="permcheck"><input type="checkbox" checked={f.active} onChange={(e) => set('active', e.target.checked)} /> เปิดใช้งานบัญชีนี้</label>}
        <div className="row" style={{ marginTop: 16, justifyContent: 'flex-end' }}><button type="button" className="btn s" onClick={onClose}>ยกเลิก</button><button className="btn" disabled={busy}>{busy ? 'กำลังบันทึก...' : 'บันทึก'}</button></div>
      </form>
    </div>
  );
}

export default function Users() {
  const { perms, user: me } = useMe();
  const { data, loading, error, reload } = useApi(perms.manage ? '/api/users' : null);
  const [ed, setEd] = useState(undefined); // undefined=ปิด, null=เพิ่มใหม่, object=แก้ไข
  if (!perms.manage) return <Denied />;
  return (
    <>
      <div className="row sp"><h1>จัดการผู้ใช้</h1><button className="btn" onClick={() => setEd(null)}>+ เพิ่มผู้ใช้</button></div>
      <div className="card">
        {error ? <div className="empty" style={{ color: 'var(--dn)' }}>{error}</div> : loading && !data ? <Spinner /> : (
          <>
            <div className="tw users-table"><table>
              <thead><tr><th>Username</th><th>ชื่อ</th><th>บทบาท</th><th>สิทธิ์</th><th>สถานะ</th><th></th></tr></thead>
              <tbody>{data.users.map((u) => (
                <tr key={u.id}><td>{u.username}</td><td>{u.name}</td><td>{ROLES[u.role]}</td>
                  <td className="perm-summary">{PERM_LABELS.filter(([p]) => can(u.role, p)).map(([, l]) => l).join(' · ')}</td>
                  <td><span className={'tag ' + (u.active ? 'o' : 'x')}>{u.active ? 'ใช้งาน' : 'ปิดอยู่'}</span></td>
                  <td><button className="btn s sm" onClick={() => setEd(u)}>แก้ไข</button></td></tr>
              ))}</tbody>
            </table></div>
            <div className="users-cards">{data.users.map((u) => (
              <div className="user-card" key={u.id}>
                <div className="user-card-head"><div className="user-ident"><b>{u.name}{u.id === me.id ? ' (คุณ)' : ''}</b><small>{u.username} · {ROLES[u.role]}</small></div><span className={'tag ' + (u.active ? 'o' : 'x')}>{u.active ? 'ใช้งาน' : 'ปิดอยู่'}</span></div>
                <div className="user-perms">{PERM_LABELS.map(([p, l]) => <div className="user-perm-row" key={p}><span>{l}</span><span className={can(u.role, p) ? 'perm-yes' : 'perm-no'}>{can(u.role, p) ? '✓' : '—'}</span></div>)}</div>
                <div className="user-actions"><button className="btn s" onClick={() => setEd(u)}>แก้ไข</button></div>
              </div>
            ))}</div>
          </>
        )}
      </div>
      {ed !== undefined && <Editor u={ed} onClose={() => setEd(undefined)} onSaved={() => { setEd(undefined); reload(); }} />}
    </>
  );
}
