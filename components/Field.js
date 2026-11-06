'use client';
import { useState } from 'react';
const BIG = 8; // รายการยาวกว่านี้ใช้ช่องเลือกแบบค้นหาได้
import { F, isReq, fmtDigits, OPD_LEN, PERIOD_RE, PERIOD_UNITS, PERIOD_QUICK, labelOf, splitMulti, MULTI_SEP } from '../lib/fields.js';

// ช่องกรอกตามนิยามใน lib/fields.js (ใช้ทั้งฟอร์มส่งเคสและหน้าแก้ไขของผู้ดูแล)
export default function Field({ k, value, onChange, options, error, idp = 'f', formType, minDate, locked = false, note }) {
  const f = F[k], lbl = labelOf(k, formType);
  const [q, setQ] = useState('');
  const [pu, setPu] = useState('เดือน'); // หน่วยที่เลือกของช่องระยะ (ใช้ตอนยังไม่ได้ใส่ตัวเลข)
  let list = f.o || (f.og ? options?.[f.og] || [] : null);
  if (list && (k === 'hairMethod' || k === 'inj')) list = [...list].sort((a, b) => (a === 'อื่น ๆ') - (b === 'อื่น ๆ') || a.localeCompare(b, 'en', { sensitivity: 'base' })); // เรียงตามตัวอักษร (อื่น ๆ ไว้ท้าย)
  const cur = f.t === 'multi' ? splitMulti(value) : [];
  // ค่าเดิมที่ไม่อยู่ในรายการแล้ว (ข้อมูลเก่า/ผู้ใช้ที่ถูกปิด) ยังแสดงให้เห็นเพื่อไม่ให้ข้อมูลหาย
  if (list && f.t === 'select' && value && !list.includes(value)) list = [value, ...list];
  if (list && f.t === 'multi') list = [...list, ...cur.filter((x) => !list.includes(x))];
  const emptyMsg = f.empty || 'ยังไม่มีตัวเลือก — ให้ผู้ดูแลระบบเพิ่มที่เมนู “จัดการฟอร์ม”';
  const id = `${idp}-${k}`;
  let input;
  if (f.t === 'opd') {
    const digits = String(value || '').replace(/^HN-/, '').replace(/\D/g, '');
    input = (
      <>
        <div className="opdbox"><span className="opdpre" aria-hidden="true">HN-</span>
          <input id={id} inputMode="numeric" autoComplete="off" disabled={locked} maxLength={OPD_LEN + 2} placeholder="00000-0-000000" value={fmtDigits(digits)} aria-invalid={!!error} aria-describedby={id + '-h'}
            onChange={(e) => { const d = e.target.value.replace(/\D/g, '').slice(0, OPD_LEN); onChange(k, d ? 'HN-' + fmtDigits(d) : ''); }} />
        </div>
        <p id={id + '-h'} className="mu" style={{ margin: '3px 0 0', fontSize: 12 }}>พิมพ์ตัวเลข {OPD_LEN} หลักต่อกันได้เลย ระบบใส่ขีดให้เอง ({digits.length}/{OPD_LEN})</p>
      </>
    );
  } else if (f.t === 'pills') {
    input = list.length ? (
      <div className="pills" role="radiogroup" aria-label={lbl}>
        {list.map((z) => (
          <label className="pill" key={z}><input type="radio" name={id} value={z} checked={value === z} disabled={locked} onChange={() => onChange(k, z)} /><span>{z}</span></label>
        ))}
      </div>
    ) : <p className="mu">{emptyMsg}</p>;
  } else if (f.t === 'multi') {
    // เลือกได้หลายข้อ เก็บเป็นข้อความคั่นด้วย ", " ตามลำดับในรายการ
    const toggle = (z) => {
      const next = cur.includes(z) ? cur.filter((x) => x !== z) : [...cur, z];
      onChange(k, list.filter((x) => next.includes(x)).join(MULTI_SEP));
    };
    const big = list.length > BIG, shown = big && q.trim() ? list.filter((z) => z.toLowerCase().includes(q.trim().toLowerCase())) : list;
    input = list.length && big ? (
      <div className="msel">
        {cur.length > 0 && (
          <div className="pills" aria-label="ที่เลือกไว้">
            {cur.map((z) => <button type="button" key={z} className="chip on" onClick={() => toggle(z)} title="กดเพื่อเอาออก">{z} ✕</button>)}
            <button type="button" className="chip" onClick={() => onChange(k, '')}>ล้างทั้งหมด</button>
          </div>
        )}
        <input type="search" className="msq" placeholder={`ค้นหา (ทั้งหมด ${list.length} รายการ)`} value={q} onChange={(e) => setQ(e.target.value)} aria-label={'ค้นหา' + lbl} />
        <div className="mslist" role="group" aria-label={lbl} aria-invalid={!!error}>
          {shown.length ? shown.map((z) => (
            <label className="mrow" key={z}><input type="checkbox" value={z} checked={cur.includes(z)} onChange={() => toggle(z)} /><span>{z}</span></label>
          )) : <p className="mu" style={{ margin: 6 }}>ไม่พบรายการที่ค้นหา</p>}
        </div>
        <p className="mu" style={{ margin: '3px 0 0', fontSize: 12 }}>เลือกได้หลายข้อ · เลือกแล้ว {cur.length} รายการ</p>
      </div>
    ) : list.length ? (
      <>
        <div className="pills" role="group" aria-label={lbl} aria-invalid={!!error}>
          {list.map((z) => (
            <label className="pill" key={z}><input type="checkbox" value={z} checked={cur.includes(z)} onChange={() => toggle(z)} /><span>{z}</span></label>
          ))}
        </div>
        <p className="mu" style={{ margin: '3px 0 0', fontSize: 12 }}>เลือกได้หลายข้อ</p>
      </>
    ) : <p className="mu">{emptyMsg}</p>;
  } else if (f.t === 'period') {
    const m = PERIOD_RE.exec(String(value || '')), num = m ? m[1] : '', unit = m ? m[2] : pu;
    const legacy = value && !m; // ค่าเดิมที่ไม่ใช่รูปแบบ ตัวเลข+หน่วย
    const set2 = (n, u) => onChange(k, n ? `${Number(n)} ${u}` : '');
    input = (
      <>
        <div className="period">
          <input id={id} inputMode="numeric" autoComplete="off" maxLength={3} placeholder="ตัวเลข เช่น 13" value={num} aria-invalid={!!error}
            onChange={(e) => set2(e.target.value.replace(/\D/g, '').slice(0, 3), unit)} />
          <select aria-label="หน่วยของระยะเวลา" value={unit} onChange={(e) => { setPu(e.target.value); set2(num, e.target.value); }}>
            {PERIOD_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
          </select>
        </div>
        <div className="pills quick" role="group" aria-label="เลือกระยะที่ใช้บ่อย">
          {PERIOD_QUICK.map((q) => <button type="button" key={q} className={'chip' + (value === q ? ' on' : '')} onClick={() => onChange(k, q)}>{q}</button>)}
        </div>
        {legacy && <p className="mu" style={{ margin: '3px 0 0', fontSize: 12 }}>ค่าเดิม: {value} — กรอกตัวเลขและหน่วยเพื่อเปลี่ยน</p>}
      </>
    );
  } else if (f.t === 'select') {
    input = (
      <select id={id} value={value} onChange={(e) => onChange(k, e.target.value)} aria-invalid={!!error} disabled={locked || !list.length}>
        {!list.length && !value ? <option value="">— {emptyMsg} —</option> : f.blank && <option value="">— เลือก —</option>}
        {(value && !list.includes(value) ? [value, ...list] : list).map((z) => <option key={z} value={z}>{f.og?.startsWith('t') ? options?.titles?.[z] || z : z}</option>)}
      </select>
    );
  } else {
    input = (
      <>
        <input id={id} type={f.t === 'date' ? 'date' : 'text'} min={f.t === 'date' && minDate ? minDate : undefined} value={value} readOnly={locked} onChange={(e) => onChange(k, f.num ? e.target.value.replace(/\D/g, '').slice(0, 3) : e.target.value)} inputMode={f.num ? 'numeric' : undefined} placeholder={f.ph} list={f.sug ? id + '-l' : undefined}
          aria-invalid={!!error} autoComplete="off" autoCapitalize={k === 'opd' ? 'characters' : undefined} maxLength={120} />
        {f.sug && <datalist id={id + '-l'}>{f.sug.map((z) => <option key={z} value={z} />)}</datalist>}
      </>
    );
  }
  return (
    <div className={'fld' + (locked ? ' lk' : '') + (isReq(k, formType) && !String(value || '').trim() ? ' need' : '')} style={['multi', 'pills', 'period'].includes(f.t) ? { gridColumn: '1 / -1' } : undefined}>
      <label htmlFor={['pills', 'multi'].includes(f.t) ? undefined : id}>{lbl}{isReq(k, formType) ? <span className="req"> *</span> : <span className="opt"> (ไม่บังคับ)</span>}</label>
      {input}
      {f.t === 'date' && minDate && <p className="mu" style={{ margin: '3px 0 0', fontSize: 12 }}>เลือกย้อนหลังได้ไม่เกิน 1 วัน (วันนี้และอนาคตเลือกได้)</p>}
      {(f.hintBy?.[formType] || f.hint) && <p className="mu" style={{ margin: '3px 0 0', fontSize: 12 }}>{f.hintBy?.[formType] || f.hint}</p>}
      {locked && <p className="mu" style={{ margin: '3px 0 0', fontSize: 12 }}>🔒 ข้อมูลเดิมของ HN นี้ — แก้ไขได้ที่หน้าข้อมูลคนไข้เท่านั้น</p>}
      {note && <p className="mu" style={{ margin: '3px 0 0', fontSize: 12, color: 'var(--ac, #0a7)' }}>{note}</p>}
      {error && <p className="fe" role="alert">{error}</p>}
    </div>
  );
}
