'use client';
import { F } from '../lib/fields.js';

// ช่องกรอกตามนิยามใน lib/fields.js (ใช้ทั้งฟอร์มส่งเคสและหน้าแก้ไขของผู้ดูแล)
export default function Field({ k, value, onChange, options, error, idp = 'f' }) {
  const f = F[k];
  const list = f.o || (f.og ? options?.[f.og] || [] : null);
  const id = `${idp}-${k}`;
  let input;
  if (f.t === 'pills') {
    input = list.length ? (
      <div className="pills" role="radiogroup" aria-label={f.l}>
        {list.map((z) => (
          <label className="pill" key={z}><input type="radio" name={id} value={z} checked={value === z} onChange={() => onChange(k, z)} /><span>{z}</span></label>
        ))}
      </div>
    ) : <p className="mu">ยังไม่มีตัวเลือก — ให้ผู้ดูแลระบบเพิ่มที่เมนู “จัดการฟอร์ม”</p>;
  } else if (f.t === 'select') {
    input = (
      <select id={id} value={value} onChange={(e) => onChange(k, e.target.value)} aria-invalid={!!error} disabled={!list.length}>
        {!list.length && <option value="">— ยังไม่มีตัวเลือก (ให้ผู้ดูแลเพิ่มที่ “จัดการฟอร์ม”) —</option>}
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
    <div>
      <label htmlFor={f.t === 'pills' ? undefined : id}>{f.l}{f.req ? <span className="req"> *</span> : null}</label>
      {input}
      {error && <p className="fe" role="alert">{error}</p>}
    </div>
  );
}
