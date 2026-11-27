'use client';
import { useRef, useState } from 'react';
import { useMe, useToast, Denied } from '../../../components/Ctx.js';
import { api, clearApiCache } from '../../../lib/client.js';

// อ่านไฟล์ CSV: UTF-8 (มี/ไม่มี BOM) ก่อน ถ้าไม่ใช่ลองถอดรหัสแบบ Windows-874 (Excel ภาษาไทยที่เซฟ “CSV (Comma delimited)” จะได้รหัสนี้)
async function readText(file) {
  const buf = await file.arrayBuffer();
  try { return { text: new TextDecoder('utf-8', { fatal: true }).decode(buf), legacy: false }; }
  catch { return { text: new TextDecoder('windows-874').decode(buf), legacy: true }; }
}

const GUIDE = [
  ['เวลาที่ส่ง', 'ไม่บังคับ — เช่น 2026-11-27 14:30 หรือ 27/11/2026 14:30 (เวลาไทย, รับปี พ.ศ.) ถ้าเว้นว่างใช้เวลาที่นำเข้า'],
  ['เลข OPD', 'บังคับ — HN-12345-6-789012 หรือเลข 12 หลัก (คอลัมน์ต้องเป็นรูปแบบ “ข้อความ” ไม่งั้น Excel จะแปลงเลข)'],
  ['ชื่อคนไข้', 'บังคับ — ชื่อ [ชื่อกลาง] นามสกุล คั่นด้วยเว้นวรรค'],
  ['ปลูกผมย้ายราก', 'วิธีปลูก เช่น FUE, FUT, DHI (ต้องอยู่ในรายการตัวเลือกของระบบ) — ใส่ ✓ ได้ถ้าไม่ทราบวิธี'],
  ['บริเวณที่ทำ', 'หลายค่าคั่นด้วยจุลภาค เช่น ผม, คิ้ว'],
  ['ปลูกด้วย Stem cell', 'เช่น iStemz, ReCell — หลายค่าคั่นด้วยจุลภาค (ใส่ ✓ ได้ถ้าไม่ทราบรายการ)'],
  ['งานฉีดและอื่นๆ', 'เช่น PRP — หลายค่าคั่นด้วยจุลภาค (ใส่ ✓ ได้ถ้าไม่ทราบรายการ)'],
  ['วันที่ปลูก', 'บังคับ — 2026-11-27 หรือ 27/11/2026'],
  ['ประเภทเคส · เซลล์ · แพทย์ · ผู้ถ่าย · ตรวจสอบโดย', 'ไม่บังคับ — ชื่อทีมงานพิมพ์ตามจริงได้ (ประเภทเคสต้องอยู่ในรายการ)'],
  ['ผู้ส่ง', 'ชื่อบัญชีผู้ใช้ ถ้าไม่ตรงกับผู้ใช้ในระบบ จะบันทึกเป็นผู้นำเข้า และเก็บชื่อเดิมไว้ในหมายเหตุ'],
  ['จำนวนไฟล์ · สถานะ · โฟลเดอร์ภาพ', 'ส่งออกอย่างเดียว — ตอนนำเข้าไม่สนใจ (นำเข้าข้อมูลเคสเท่านั้น ไม่ได้นำเข้ารูป/วิดีโอ)'],
  ['ที่มา', 'ระบุ “F/U” = ฟอร์มติดตามผล (ต้องกรอก “วันที่เข้ามารับบริการ (F/U)” ด้วย) นอกนั้นนับเป็น Day 0'],
  ['ข้อมูลเพิ่มเติม (ท้ายตาราง)', 'เพศ อายุ สัญชาติ ครั้งที่ ฯลฯ ไม่บังคับ — ลบคอลัมน์ทิ้งได้'],
];

export default function DataPage() {
  const { perms } = useMe();
  const toast = useToast();
  if (!perms.exportData && !perms.importData) return <Denied />;
  return (
    <>
      <h1>นำเข้า / ส่งออกข้อมูล</h1>
      <p className="mu">ข้อมูลเคสในรูปแบบตาราง (CSV / Excel) — ไม่รวมไฟล์รูปและวิดีโอ</p>
      {perms.exportData && <Export toast={toast} />}
      {perms.importData && <Import toast={toast} />}
    </>
  );
}

function Export({ toast }) {
  const [fmt, setFmt] = useState('xlsx'), [form, setForm] = useState(''), [from, setFrom] = useState(''), [to, setTo] = useState(''), [busy, setBusy] = useState(false);
  async function go() {
    setBusy(true);
    try {
      const qs = new URLSearchParams({ format: fmt, ...(form && { formType: form }), ...(from && { from }), ...(to && { to }) });
      const r = await fetch('/api/export?' + qs, { credentials: 'same-origin' });
      if (!r.ok) { let m = 'ส่งออกไม่สำเร็จ'; try { m = (await r.json()).error || m; } catch {} throw new Error(m); }
      const name = /filename="([^"]+)"/.exec(r.headers.get('Content-Disposition') || '')?.[1] || `beq-records.${fmt}`;
      const url = URL.createObjectURL(await r.blob());
      const a = Object.assign(document.createElement('a'), { href: url, download: name }); document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      toast('ดาวน์โหลดแล้ว');
    } catch (e) { toast(e.message); }
    setBusy(false);
  }
  return (
    <div className="card">
      <h2>ส่งออกข้อมูลปัจจุบัน</h2>
      <div className="f2" style={{ alignItems: 'end' }}>
        <div><label htmlFor="fmt">รูปแบบไฟล์</label><select id="fmt" value={fmt} onChange={(e) => setFmt(e.target.value)}><option value="xlsx">Excel (.xlsx)</option><option value="csv">CSV (.csv)</option></select></div>
        <div><label htmlFor="ft">ประเภทฟอร์ม</label><select id="ft" value={form} onChange={(e) => setForm(e.target.value)}><option value="">ทั้งหมด</option><option value="day0">Day 0</option><option value="case">F/U</option></select></div>
        <div><label htmlFor="xf">เวลาที่ส่ง ตั้งแต่</label><input id="xf" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
        <div><label htmlFor="xt">ถึง</label><input id="xt" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
      </div>
      <button className="btn" onClick={go} disabled={busy} style={{ marginTop: 6 }}>{busy ? 'กำลังสร้างไฟล์...' : '⬇ ดาวน์โหลด'}</button>
      <p className="mu" style={{ marginBottom: 0 }}>ไฟล์มีข้อมูลระบุตัวคนไข้ — เก็บรักษาตามนโยบายข้อมูลส่วนบุคคล การส่งออกทุกครั้งถูกบันทึกใน Audit log</p>
    </div>
  );
}

function Import({ toast }) {
  const input = useRef(null);
  const [file, setFile] = useState(null), [text, setText] = useState(''), [res, setRes] = useState(null), [busy, setBusy] = useState(false), [err, setErr] = useState(''), [done, setDone] = useState(null), [legacy, setLegacy] = useState(false);

  function reset() { setFile(null); setText(''); setRes(null); setErr(''); setLegacy(false); if (input.current) input.current.value = ''; }
  async function pick(e) {
    const f = e.target.files?.[0]; if (!f) return;
    reset(); setDone(null); setFile(f); setBusy(true);
    try {
      const r = await readText(f); setText(r.text); setLegacy(r.legacy);
      setRes(await api('/api/import', { method: 'POST', body: { csv: r.text, commit: false } }));
    } catch (x) { setErr(x.message); }
    setBusy(false);
  }
  async function commit() {
    setBusy(true); setErr('');
    try {
      const r = await api('/api/import', { method: 'POST', body: { csv: text, commit: true } });
      clearApiCache(); setDone(r); reset(); toast(`นำเข้า ${r.created} แถวแล้ว`);
    } catch (x) { setErr(x.message); }
    setBusy(false);
  }
  const stat = (n, l, c) => <span className={'tag ' + c} style={{ marginRight: 8 }}>{l} {n}</span>;

  return (
    <div className="card">
      <h2>นำเข้าข้อมูลจาก CSV</h2>
      <ol className="mu" style={{ margin: '0 0 12px', paddingLeft: 20 }}>
        <li>ดาวน์โหลดเทมเพลต แล้วกรอกข้อมูล (หรือใช้ไฟล์ที่ส่งออกจากระบบ/ชีตเดิมที่หัวตารางตรงกัน)</li>
        <li>เลือกไฟล์ — ระบบจะ <b>ตรวจสอบให้ดูก่อน ยังไม่บันทึกอะไร</b></li>
        <li>กด “ยืนยันนำเข้า” — เฉพาะแถวที่ผ่าน (แถวซ้ำ/ผิดพลาดจะถูกข้าม)</li>
      </ol>
      <div className="row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <a className="btn s" href="/api/import/template" download>⬇ เทมเพลต CSV</a>
        <input ref={input} type="file" accept=".csv,text/csv,text/plain" onChange={pick} disabled={busy} aria-label="เลือกไฟล์ CSV" />
      </div>
      {busy && <p className="mu">กำลังประมวลผล...</p>}
      {err && <div className="banner" role="alert" style={{ marginTop: 12, color: 'var(--dn)' }}>{err}</div>}
      {legacy && res && <div className="banner" style={{ marginTop: 12 }}>ไฟล์นี้ไม่ใช่ UTF-8 — ระบบถอดรหัสเป็นภาษาไทย (Windows-874) ให้ ตรวจดูชื่อในผลตรวจสอบว่าอ่านออกถูกต้อง หรือเซฟใหม่เป็น “CSV UTF-8”</div>}

      {res && (
        <div style={{ marginTop: 14 }}>
          <div>{stat(res.total, 'ทั้งหมด', '')}{stat(res.create, 'นำเข้าได้', 'o')}{stat(res.duplicate, 'ซ้ำ (ข้าม)', 'w')}{stat(res.error, 'ผิดพลาด', 'x')}</div>
          {!!res.ignored.length && <p className="mu">คอลัมน์ที่ไม่รู้จัก (ไม่ถูกนำเข้า): {res.ignored.join(', ')}</p>}
          {!!res.unknownPeople.length && <p className="mu">ชื่อทีมงานที่ไม่ตรงกับผู้ใช้ในระบบ (บันทึกตามที่พิมพ์): {res.unknownPeople.join(', ')}</p>}
          {!!res.issues.length && (
            <div className="tw rw" style={{ marginTop: 8 }}>
              <table className="rl">
                <thead><tr><th>แถว</th><th>เลข OPD</th><th>ชื่อ</th><th>ผล</th><th>รายละเอียด</th></tr></thead>
                <tbody>{res.issues.map((x) => <tr key={x.row}><td>{x.row}</td><td>{x.opd || '—'}</td><td>{x.name || '—'}</td><td><span className={'tag ' + (x.status === 'error' ? 'x' : 'w')}>{x.status === 'error' ? 'ผิดพลาด' : 'ข้าม'}</span></td><td>{x.message}</td></tr>)}</tbody>
              </table>
            </div>
          )}
          {res.error + res.duplicate > res.issues.length && <p className="mu">แสดง {res.issues.length} รายการแรกจาก {res.error + res.duplicate} รายการ</p>}
          <div className="row" style={{ gap: 10, marginTop: 12 }}>
            <button className="btn" onClick={commit} disabled={busy || !res.create}>ยืนยันนำเข้า {res.create} แถว</button>
            <button className="btn s" onClick={reset} disabled={busy}>ยกเลิก</button>
          </div>
        </div>
      )}
      {done && <div className="banner" style={{ marginTop: 14 }}>✓ นำเข้าสำเร็จ {done.created} แถว{done.duplicate ? ` · ข้ามที่ซ้ำ ${done.duplicate}` : ''}{done.error ? ` · ข้ามที่ผิดพลาด ${done.error}` : ''}</div>}

      <details style={{ marginTop: 14 }}>
        <summary>คำอธิบายคอลัมน์</summary>
        <div className="tw rw"><table className="rl"><tbody>{GUIDE.map(([a, b]) => <tr key={a}><td><b>{a}</b></td><td>{b}</td></tr>)}</tbody></table></div>
      </details>
    </div>
  );
}
