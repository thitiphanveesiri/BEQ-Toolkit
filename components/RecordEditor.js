'use client';
import { useState } from 'react';
import Field from './Field.js';
import { useToast } from './Ctx.js';
import { PROC_DEP_KEYS, isShown, keysFor } from '../lib/fields.js';
import { api, useApi } from '../lib/client.js';

// ผู้ดูแลระบบแก้ข้อมูลที่กรอกผิด (บันทึกใน audit ทุกครั้ง)
export default function RecordEditor({ record, onClose, onSaved }) {
  const toast = useToast();
  const { data } = useApi('/api/options?formType=' + record.formType);
  const [v, setV] = useState(() => ({ ...record })), [errs, setErrs] = useState({}), [busy, setBusy] = useState(false);
  const set = (k, val) => { setV((p) => ({ ...p, [k]: val, ...(k === 'procType' && val !== p.procType ? Object.fromEntries(PROC_DEP_KEYS.map((d) => [d, ''])) : {}) })); setErrs((e) => ({ ...e, [k]: '' })); };
  async function save(e) {
    e.preventDefault(); setBusy(true);
    try { await api('/api/records/' + record.id, { method: 'PATCH', body: { data: v } }); toast('บันทึกการแก้ไขแล้ว'); onSaved(); }
    catch (x) { toast('❌ ' + x.message); setBusy(false); }
  }
  return (
    <div className="ov" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <form className="mod wide" onSubmit={save} aria-label="แก้ไขข้อมูล">
        <h2>แก้ไขข้อมูล · {record.formType === 'day0' ? 'Day 0' : record.visitPeriod || 'BEQ Hair Center'}</h2>
        <div className="f2">{keysFor(record.formType).filter((k) => isShown(k, v)).map((k) => <Field key={k} idp="e" k={k} value={v[k] ?? ''} onChange={set} options={data?.options} error={errs[k]} />)}</div>
        <label htmlFor="e-note">หมายเหตุ</label><textarea id="e-note" rows={2} value={v.note || ''} onChange={(e) => set('note', e.target.value)} maxLength={1000} />
        <div className="row" style={{ marginTop: 16, justifyContent: 'flex-end' }}><button type="button" className="btn s" onClick={onClose}>ยกเลิก</button><button className="btn" disabled={busy}>{busy ? 'กำลังบันทึก...' : 'บันทึก'}</button></div>
      </form>
    </div>
  );
}
