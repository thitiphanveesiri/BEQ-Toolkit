'use client';
import { useState } from 'react';
import { D, DT } from '../lib/client.js';
import { F, STEPS, isShown, labelOf, shownKeys } from '../lib/fields.js';

const valueText = (k, value) => {
  if (k === 'note') return value || '—';
  if (!value) return '—';
  return F[k]?.t === 'date' ? D(value) : String(value);
};

export default function RecordFormView({ record }) {
  const [open, setOpen] = useState(() => new Set([0]));
  const toggle = (i) => setOpen((cur) => { const next = new Set(cur); next.has(i) ? next.delete(i) : next.add(i); return next; });
  return (
    <div className="record-form-view">
      {STEPS[record.formType].map(([title, keys], i) => {
        const visible = keys.filter((k) => isShown(k, record) && (k !== 'round' || record.round));
        const isOpen = open.has(i);
        return (
          <section className="acc sub" key={title}>
            <button type="button" className="acc-h" aria-expanded={isOpen} aria-controls={`rf-${record.id}-${i}`} onClick={() => toggle(i)}>
              <span className="ch">▸</span><span>{title}</span><span className="sp2" /><span className="tag">{visible.length} ช่อง</span>
            </button>
            {isOpen && (
              <div className="acc-b" id={`rf-${record.id}-${i}`}>
                <div className="detail-grid">
                  {visible.map((k) => <div key={k}><small>{labelOf(k, record.formType)}</small><b>{valueText(k, record[k])}</b></div>)}
                </div>
              </div>
            )}
          </section>
        );
      })}
      <section className="acc sub">
        <div className="acc-b">
          <div className="detail-grid">
            <div><small>หมายเหตุ</small><b>{record.note || '—'}</b></div>
            <div><small>บันทึกเมื่อ</small><b>{DT(record.createdAt)}</b></div>
            {record.updatedAt && record.updatedAt !== record.createdAt && <div><small>แก้ไขล่าสุด</small><b>{DT(record.updatedAt)}</b></div>}
          </div>
        </div>
      </section>
      <p className="mu" style={{ fontSize: 12 }}>ช่องที่ไม่ได้เลือก/ไม่เกี่ยวกับประเภทหัตถการจะไม่แสดง · {shownKeys(record.formType, record).length} ช่องที่ใช้กับฟอร์มนี้</p>
    </div>
  );
}
