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
        {isNew && <><label htmlFor="un">Username</label><input id="un" value={f.username} onChange={(e) => set('username', e.target.value.replace(/[^A-Za-z0-9._-]/g, '').slice(0, 32))} required autoCapitalize="none" autoComplete="off" minLength={3} maxLength={32} title="ใช้ได้เฉพาะ a-z 0-9 . _ - ความยาว 3–32 ตัว" /><p className="mu" style={{ margin: '3px 0 0', fontSize: 12 }}>ใช้ได้เฉพาะ a-z, 0-9, . _ - (ตัวพิมพ์ใหญ่จะถูกเก็บเป็นตัวเล็ก ช่องว่างและตัวอักษรอื่นจะถูกลบให้อัตโนมัติ)</p></>}
        <label htmlFor="nm">ชื่อที่แสดง</label><input id="nm" value={f.name} onChange={(e) => set('name', e.target.value)} required maxLength={80} />
        {['doctor', 'doctor_lead'].includes(f.role) && <><label htmlFor="tt">คำนำหน้า (แสดงหน้าชื่อในรายการเลือกแพทย์)</label><select id="tt" value={f.title || DOC_TITLES[0]} onChange={(e) => set('title', e.target.value)}>{DOC_TITLES.map((t) => <option key={t} value={t}>{t}</option>)}</select></>}
        <label htmlFor="rl">บทบาท</label>
        <select id="rl" value={f.role} onChange={(e) => set('role', e.target.value)}>{Object.entries(ROLES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        <h3 style={{ margin: '16px 0 2px' }}>สิทธิ์การใช้งาน</h3>
        <p className="mu" style={{ margin: '0 0 6px', fontSize: 12 }}>ติ๊กเพื่ออนุญาต — ค่าเริ่มต้นตามบทบาท ถ้าติ๊กต่างจากบทบาทจะแสดงเป็น “ปรับเฉพาะบัญชีนี้”{f.role === 'admin' ? ' · ผู้ดูแลระบบมีสิทธิ์ทุกอย่างเสมอ' : ''}</p>
        <div className="permlist">
          {PERM_LABELS.map(([p, l]) => {
            const fixed = f.role === 'admin' || !OVERRIDABLE.includes(p), base = can(f.role, p);
            const on = fixed ? base : f.ov[p] === '1' ? true : f.ov[p] === '0' ? false : base;
            const changed = !fixed && on !== base;
            return (
              <label key={p} className={'permcheck' + (changed ? ' chg' : '')} style={{ opacity: fixed ? 0.6 : 1 }}>
                <input type="checkbox" checked={on} disabled={fixed} onChange={(e) => setF((s) => ({ ...s, ov: { ...s.ov, [p]: e.target.checked === base ? '' : e.target.checked ? '1' : '0' } }))} />
                <span>{l}</span>{changed && <small className="tag w">ปรับเฉพาะบัญชีนี้</small>}{fixed && f.role !== 'admin' && <small className="mu">ตามบทบาท</small>}
              </label>
            );
          })}
        </div>
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
