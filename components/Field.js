'use client';
import { F, splitMulti, MULTI_SEP } from '../lib/fields.js';

// ช่องกรอกตามนิยามใน lib/fields.js (ใช้ทั้งฟอร์มส่งเคสและหน้าแก้ไขของผู้ดูแล)
export default function Field({ k, value, onChange, options, error, idp = 'f' }) {
  const f = F[k];
  let list = f.o || (f.og ? options?.[f.og] || [] : null);
  const cur = f.t === 'multi' ? splitMulti(value) : [];
  // ค่าเดิมที่ไม่อยู่ในรายการแล้ว (ข้อมูลเก่า/ผู้ใช้ที่ถูกปิด) ยังแสดงให้เห็นเพื่อไม่ให้ข้อมูลหาย
  if (list && f.t === 'select' && value && !list.includes(value)) list = [value, ...list];
  if (list && f.t === 'multi') list = [...list, ...cur.filter((x) => !list.includes(x))];
  const emptyMsg = f.empty || 'ยังไม่มีตัวเลือก — ให้ผู้ดูแลระบบเพิ่มที่เมนู “จัดการฟอร์ม”';
  const id = `${idp}-${k}`;
  let input;
  if (f.t === 'opd') {
    const digits = String(value || '').replace(/^HN-/, '');
    input = (
      <>
        <div className="opdbox"><span className="opdpre" aria-hidden="true">HN-</span>
          <input id={id} inputMode="numeric" autoComplete="off" maxLength={11} placeholder="เลข 11 หลัก" value={digits} aria-invalid={!!error} aria-describedby={id + '-h'}
            onChange={(e) => { const d = e.target.value.replace(/\D/g, '').slice(0, 11); onChange(k, d ? 'HN-' + d : ''); }} />
        </div>
        <p id={id + '-h'} className="mu" style={{ margin: '3px 0 0', fontSize: 12 }}>กรอกตัวเลข 11 หลัก ({digits.length}/11) ระบบเก็บเป็น HN-{digits || 'xxxxxxxxxxx'}</p>
      </>
    );
  } else if (f.t === 'pills') {
    input = list.length ? (
      <div className="pills" role="radiogroup" aria-label={f.l}>
        {list.map((z) => (
          <label className="pill" key={z}><input type="radio" name={id} value={z} checked={value === z} onChange={() => onChange(k, z)} /><span>{z}</span></label>
        ))}
      </div>
    ) : <p className="mu">{emptyMsg}</p>;
  } else if (f.t === 'multi') {
    // เลือกได้หลายข้อ เก็บเป็นข้อความคั่นด้วย ", " ตามลำดับในรายการ
    const toggle = (z) => {
      const next = cur.includes(z) ? cur.filter((x) => x !== z) : [...cur, z];
      onChange(k, list.filter((x) => next.includes(x)).join(MULTI_SEP));
    };
    input = list.length ? (
      <>
        <div className="pills" role="group" aria-label={f.l} aria-invalid={!!error}>
          {list.map((z) => (
            <label className="pill" key={z}><input type="checkbox" value={z} checked={cur.includes(z)} onChange={() => toggle(z)} /><span>{z}</span></label>
          ))}
        </div>
        <p className="mu" style={{ margin: '3px 0 0', fontSize: 12 }}>เลือกได้หลายข้อ</p>
      </>
    ) : <p className="mu">{emptyMsg}</p>;
  } else if (f.t === 'select') {
    input = (
      <select id={id} value={value} onChange={(e) => onChange(k, e.target.value)} aria-invalid={!!error} disabled={!list.length}>
        {!list.length ? <option value="">— {emptyMsg} —</option> : f.blank && <option value="">— เลือก —</option>}
        {list.map((z) => <option key={z} value={z}>{z}</option>)}
      </select>
    );
  } else {
    input = (
      <>
        <input id={id} type={f.t === 'date' ? 'date' : 'text'} value={value} onChange={(e) => onChange(k, e.target.value)} placeholder={f.ph} list={f.sug ? id + '-l' : undefined}
          aria-invalid={!!error} autoComplete="off" autoCapitalize={k === 'opd' ? 'characters' : undefined} maxLength={120} />
        {f.sug && <datalist id={id + '-l'}>{f.sug.map((z) => <option key={z} value={z} />)}</datalist>}
      </>
    );
  }
  return (
    <div style={f.t === 'multi' || k === 'procType' ? { gridColumn: '1 / -1' } : undefined}>
      <label htmlFor={f.t === 'pills' || f.t === 'multi' ? undefined : id}>{f.l}{f.req ? <span className="req"> *</span> : null}</label>
      {input}
      {error && <p className="fe" role="alert">{error}</p>}
    </div>
  );
}
