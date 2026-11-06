'use client';
import PasswordInput from '../../components/PasswordInput.js';
import { useState } from 'react';
import { api } from '../../lib/client.js';

const DEMO = [['admin', 'ผู้ดูแล'], ['doctor', 'แพทย์'], ['bt', 'BT'], ['sales', 'เซลล์'], ['lead', 'หัวหน้าเซลล์'], ['checker', 'ผู้ตรวจ']];

export default function LoginForm({ mock }) {
  const [u, setU] = useState(''), [p, setP] = useState(''), [err, setErr] = useState(''), [busy, setBusy] = useState(false);
  async function submit(e) {
    e.preventDefault(); setBusy(true); setErr('');
    try { await api('/api/auth/login', { method: 'POST', body: { username: u, password: p } }); location.href = '/dashboard'; }
    catch (x) { setErr(x.message); setBusy(false); }
  }
  return (
    <div className="split">
      <div className="hero">
        <small>BEQ GROUP · PATIENT TOOLKIT</small>
        <img className="brand-logo" src="/logo.jpg" alt="BEQ Group" />
        <h1>BEQ Group</h1>
        <p>BEQ Group Toolkit<br />ระบบจัดการภาพคนไข้และติดตามผล</p>
      </div>
      <div className="login">
        <h1>เข้าสู่ระบบ</h1>
        <p className="mu">ใช้บัญชีที่ผู้ดูแลระบบสร้างให้</p>
        <form onSubmit={submit}>
          <label htmlFor="u">Username</label>
          <input id="u" value={u} onChange={(e) => setU(e.target.value)} autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} required autoFocus />
          <label htmlFor="p">Password</label>
          <PasswordInput id="p" value={p} onChange={(e) => setP(e.target.value)} autoComplete="current-password" required />
          <p role="alert" className="mu" style={{ color: 'var(--dn)', minHeight: 20 }}>{err}</p>
          <button className="btn" style={{ width: '100%' }} disabled={busy}>{busy ? <><span className="spin" /> กำลังเข้าสู่ระบบ...</> : 'เข้าสู่ระบบ'}</button>
        </form>
        {mock && (
          <div className="banner" style={{ marginTop: 16 }}>
            ⚠️ <b>โหมดทดลอง</b> — ข้อมูลทั้งหมดเป็นข้อมูลสมมติ เก็บในเครื่องนี้ ไม่ได้เชื่อมต่อ Google<br />
            บัญชีทดลอง (รหัสผ่าน <code>demo1234</code>):<br />
            {DEMO.map(([k, l]) => <button key={k} type="button" className="btn s sm" style={{ margin: '6px 4px 0 0' }} onClick={() => { setU(k); setP('demo1234'); }}>{l}</button>)}
          </div>
        )}
      </div>
    </div>
  );
}
