'use client';
import { useState } from 'react';
import { useMe, useToast, Denied, Spinner } from '../../../components/Ctx.js';
import { api, useApi } from '../../../lib/client.js';
import { ROLES, OVERRIDABLE, DOC_TITLES, can } from '../../../lib/roles.js';

const PERM_LABELS = [['fillForm', 'กรอก/ส่งฟอร์ม'], ['upload', 'อัปโหลดรูป/วิดีโอ'], ['viewImages', 'ดูรูป/วิดีโอ'], ['viewStats', 'ดูรายงาน'], ['editData', 'แก้ไขข้อมูลคนไข้'], ['manage', 'จัดการระบบ']];

function Editor({ u, onClose, onSaved }) {
  const toast = useToast(), isNew = !u;
  const [f, setF] = useState({ username: '', name: u?.name || '', title: u?.title || '', role: u?.role || 'bt', active: u ? u.active : true, password: '', ov: Object.fromEntries(OVERRIDABLE.map((p) => [p, u?.overrides?.[p] === true ? '1' : u?.overrides?.[p] === false ? '0' : ''])) });
  const overrides = Object.fromEntries(OVERRIDABLE.filter((p) => f.ov[p]).map((p) => [p, f.ov[p] === '1']));
  const who = { role: f.role, perms: Object.entries(overrides).map(([k, v]) => `${k}:${v ? 1 : 0}`).join(',') }; // บทบาท + สิทธิ์รายบัญชีที่เลือกอยู่
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));
  async function save(e) {
    e.preventDefault(); setBusy(true);
    try {
      if (isNew) await api('/api/users', { method: 'POST', body: { ...f, overrides } });
      else await api('/api/users/' + u.id, { method: 'PATCH', body: { name: f.name, title: f.title, role: f.role, active: f.active, overrides, ...(f.password ? { password: f.password } : {}) } });
      toast('บันทึกผู้ใช้แล้ว'); onSaved();
    } catch (x) { toast('❌ ' + x.message); setBusy(false); }
  }
  return (
    <div className="ov" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <form className="mod" id="userEditor" onSubmit={save}>
        <h2>{isNew ? 'เพิ่มผู้ใช้' : 'แก้ไขผู้ใช้ · ' + u.username}</h2>
        {isNew && <><label htmlFor="un">Username</label><input id="un" value={f.username} onChange={(e) => set('username', e.target.value)} required autoCapitalize="none" autoComplete="off" pattern="[A-Za-z0-9._\-]{3,32}" title="a-z 0-9 . _ - ความยาว 3–32 ตัว" /></>}
        <label htmlFor="nm">ชื่อที่แสดง</label><input id="nm" value={f.name} onChange={(e) => set('name', e.target.value)} required maxLength={80} />
        {['doctor', 'doctor_lead'].includes(f.role) && <><label htmlFor="tt">คำนำหน้า (แสดงหน้าชื่อในรายการเลือกแพทย์)</label><select id="tt" value={f.title || DOC_TITLES[0]} onChange={(e) => set('title', e.target.value)}>{DOC_TITLES.map((t) => <option key={t} value={t}>{t}</option>)}</select></>}
        <label htmlFor="rl">บทบาท</label>
        <select id="rl" value={f.role} onChange={(e) => set('role', e.target.value)}>{Object.entries(ROLES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        <div className="chips">{PERM_LABELS.map(([p, l]) => <span key={p} className={'tag ' + (can(who, p) ? 'o' : '')} style={{ opacity: can(who, p) ? 1 : 0.45 }}>{can(who, p) ? '✓' : '✕'} {l}</span>)}</div>
        {f.role !== 'admin' && (
          <>
            <h3 style={{ margin: '16px 0 2px' }}>ปรับสิทธิ์เฉพาะบัญชีนี้</h3>
            <p className="mu" style={{ margin: '0 0 4px', fontSize: 12 }}>ค่าเริ่มต้นเป็นไปตามบทบาท เลือก “อนุญาต/ไม่อนุญาต” เพื่อเปลี่ยนเฉพาะบัญชีนี้</p>
            {OVERRIDABLE.map((p) => (
              <div key={p}><label htmlFor={'ov-' + p}>{PERM_LABELS.find((x) => x[0] === p)[1]}</label>
                <select id={'ov-' + p} value={f.ov[p]} onChange={(e) => setF((s) => ({ ...s, ov: { ...s.ov, [p]: e.target.value } }))}>
                  <option value="">ตามบทบาท ({can(f.role, p) ? 'อนุญาต' : 'ไม่อนุญาต'})</option><option value="1">อนุญาต</option><option value="0">ไม่อนุญาต</option>
                </select></div>
            ))}
          </>
        )}
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
                  <td className="perm-summary">{PERM_LABELS.filter(([p]) => can(u, p)).map(([, l]) => l).join(' · ')}</td>
                  <td><span className={'tag ' + (u.active ? 'o' : 'x')}>{u.active ? 'ใช้งาน' : 'ปิดอยู่'}</span></td>
                  <td><button className="btn s sm" onClick={() => setEd(u)}>แก้ไข</button></td></tr>
              ))}</tbody>
            </table></div>
            <div className="users-cards">{data.users.map((u) => (
              <div className="user-card" key={u.id}>
                <div className="user-card-head"><div className="user-ident"><b>{u.name}{u.id === me.id ? ' (คุณ)' : ''}</b><small>{u.username} · {ROLES[u.role]}</small></div><span className={'tag ' + (u.active ? 'o' : 'x')}>{u.active ? 'ใช้งาน' : 'ปิดอยู่'}</span></div>
                <div className="user-perms">{PERM_LABELS.map(([p, l]) => <div className="user-perm-row" key={p}><span>{l}</span><span className={can(u, p) ? 'perm-yes' : 'perm-no'}>{can(u, p) ? '✓' : '—'}</span></div>)}</div>
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
