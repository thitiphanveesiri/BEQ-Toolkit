'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { MeCtx, ToastProvider } from './Ctx.js';
import { ROLES } from '../lib/roles.js';
import { api, clearApiCache } from '../lib/client.js';

const NAV = [
  { h: 'MAIN', items: [{ href: '/dashboard', l: '▦ Dashboard', ic: '▦', s: 'หน้าหลัก' }] },
  { h: 'PATIENT MANAGEMENT', items: [
    { href: '/new/case', l: '👤 คนไข้ติดตามผลตามระยะ Follow-Up(F/U)', ic: '👤', s: 'F/U', p: 'fillForm' },
    { href: '/new/day0', l: '🖼️ คนไข้เข้ารับบริการ(DAY 0)', ic: '🖼️', s: 'Day 0', p: 'fillForm' },
    { href: '/search', l: '🔎 ค้นหาคนไข้', ic: '🔎', s: 'ค้นหา', p: 'viewImages' },
    { href: '/reports', l: '📊 รายงาน Dashboard', ic: '📊', s: 'รายงาน', p: 'viewStats' },
  ] },
  { h: 'ADMIN', items: [
    { href: '/users', l: '👥 จัดการผู้ใช้', ic: '👥', s: 'ผู้ใช้', p: 'manage' },
    { href: '/forms', l: '🧩 จัดการฟอร์ม', ic: '🧩', s: 'ฟอร์ม', p: 'manage' },
    { href: '/settings', l: '⚙ Settings', ic: '⚙', s: 'ตั้งค่า', p: 'manage' },
  ] },
];

export default function Shell({ user, perms, mock, children }) {
  const path = usePathname(), router = useRouter();
  const [nav, setNav] = useState(false), [dark, setDark] = useState(false);
  const groups = NAV.map((g) => ({ ...g, items: g.items.filter((i) => !i.p || perms[i.p]) })).filter((g) => g.items.length);
  const flat = groups.flatMap((g) => g.items);
  const active = (h) => path === h || (h === '/search' && path.startsWith('/patient')) || (h !== '/dashboard' && path.startsWith(h));
  const ini = user.name.replace(/^(นาย|นางสาว|นาง)/, '').trim()[0] || '?';

  const acctRef = useRef(null), [ask, setAsk] = useState(false);
  useEffect(() => { setNav(false); window.scrollTo(0, 0); acctRef.current?.removeAttribute('open'); }, [path]);
  // แตะนอกเมนู/กด Esc = ปิดเมนูบัญชี (ยกเลิกการออกจากระบบ)
  useEffect(() => {
    const close = (e) => { const d = acctRef.current; if (!d?.open) return; if (e.type === 'keydown' ? e.key === 'Escape' : !d.contains(e.target) || e.target === d) { d.removeAttribute('open'); setAsk(false); } };
    document.addEventListener('pointerdown', close); document.addEventListener('keydown', close);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', close); };
  }, []);
  useEffect(() => { setDark(getComputedStyle(document.documentElement).colorScheme === 'dark'); }, []);
  // เอฟเฟกต์ไฟส่องขอบการ์ดตามเมาส์ (เหมือน prototype) — เฉพาะอุปกรณ์ที่มีเมาส์
  useEffect(() => {
    if (!matchMedia('(hover:hover)').matches) return;
    let raf = 0;
    const mv = (e) => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const el = e.target.closest?.('.card,.mcard,.btn.big');
        if (!el) return;
        const r = el.getBoundingClientRect();
        el.style.setProperty('--x', e.clientX - r.left + 'px'); el.style.setProperty('--y', e.clientY - r.top + 'px'); el.style.setProperty('--o', 1);
      });
    };
    const out = (e) => { const el = e.target.closest?.('.card,.mcard,.btn.big'); if (el) el.style.setProperty('--o', 0); };
    document.addEventListener('pointermove', mv, { passive: true }); document.addEventListener('pointerout', out, { passive: true });
    return () => { document.removeEventListener('pointermove', mv); document.removeEventListener('pointerout', out); };
  }, []);

  function toggleTheme() {
    const next = dark ? 'light' : 'dark';
    document.documentElement.dataset.theme = next; setDark(!dark);
    try { localStorage.setItem('beq-theme', next); } catch {}
  }
  async function logout() { try { await api('/api/auth/logout', { method: 'POST', body: {} }); } catch {} clearApiCache(); location.href = '/login'; }
  const title = flat.find((i) => active(i.href))?.l.replace(/^\S+\s/, '') || '';

  return (
    <MeCtx.Provider value={{ user, perms, mock }}>
      <ToastProvider>
        <div className={'shell' + (nav ? ' nav-open' : '')}>
          <div className="scrim" onClick={() => setNav(false)} />
          <aside>
            <div className="logo"><img className="brand-mark" src="/logo-mark.jpg" alt="" /><div>BEQ HAIR CLINIC<small>TOOLKIT</small></div></div>
            {groups.map((g) => (
              <div key={g.h} style={{ display: 'contents' }}>
                <h6>{g.h}</h6>
                {g.items.map((i) => <Link key={i.href} href={i.href} prefetch className={'navlink' + (active(i.href) ? ' on' : '')}>{i.l}</Link>)}
              </div>
            ))}
            <div className="pm">{mock ? <><b>โหมดทดลอง</b><br />ข้อมูลสมมติ เก็บในเครื่องนี้</> : <><b>BEQ Toolkit</b><br />ข้อมูลเก็บใน Google Sheets / Drive ของบริษัท</>}</div>
          </aside>
          <div className="mn">
            <header>
              <button className="hb btn s" onClick={() => setNav(true)} aria-label="เมนู">☰</button>
              <span className="mu">Dashboard{path === '/dashboard' || !title ? '' : ' › ' + title}</span>
              <div className="who">
                <button type="button" className="btn s sm theme-toggle" onClick={toggleTheme} aria-label={dark ? 'เปลี่ยนเป็นธีมสว่าง' : 'เปลี่ยนเป็นธีมมืด'} title="สลับธีม">{dark ? '☀️' : '🌙'}</button>
                <details className="acct" ref={acctRef} onToggle={(e) => { if (!e.currentTarget.open) setAsk(false); }}>
                  <summary><span className="av">{ini}</span><span><b>{user.name}</b><br /><small className="mu">{ROLES[user.role]} ▾</small></span></summary>
                  <div className="acctmenu"><strong>{user.name}</strong>{ask ? (<><p className="mu" style={{ margin: '6px 0' }}>ออกจากระบบใช่ไหม?</p><div className="row" style={{ gap: 8 }}><button type="button" className="btn s" style={{ flex: 1 }} onClick={() => { setAsk(false); acctRef.current?.removeAttribute('open'); }}>ยกเลิก</button><button type="button" className="btn d" style={{ flex: 1 }} onClick={logout}>ออกจากระบบ</button></div></>) : (<button type="button" onClick={() => setAsk(true)}>ออกจากระบบ</button>)}</div>
                </details>
              </div>
            </header>
            <main>
              {mock && <div className="banner">⚠️ <b>โหมดทดลอง</b> — ข้อมูลทั้งหมดเป็นข้อมูลสมมติ เก็บในเครื่องนี้เท่านั้น ยังไม่ได้เชื่อมต่อ Google Sheets / Drive</div>}
              {children}
            </main>
          </div>
          <nav className="bn" aria-label="เมนูหลัก">
            {flat.slice(0, 4).map((i) => <button key={i.href} className={active(i.href) ? 'on' : ''} onClick={() => router.push(i.href)}><span>{i.ic}</span>{i.s}</button>)}
            <button onClick={() => setNav(true)}><span>☰</span>เมนู</button>
          </nav>
        </div>
      </ToastProvider>
    </MeCtx.Provider>
  );
}
