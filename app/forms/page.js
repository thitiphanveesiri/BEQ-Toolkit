'use client';
import { useEffect, useState } from 'react';
import { useMe, useToast, Denied, Spinner } from '../../../components/Ctx.js';
import { api, useApi } from '../../../lib/client.js';
import { OPTION_GROUPS } from '../../../lib/fields.js';

function Group({ k, list, onSaved }) {
  const toast = useToast();
  const [text, setText] = useState(list.join('\n')), [busy, setBusy] = useState(false);
  useEffect(() => setText(list.join('\n')), [list]);
  const items = [...new Set(text.split('\n').map((x) => x.trim()).filter(Boolean))];
  const dirty = items.join('\n') !== list.join('\n');
  async function save() {
    setBusy(true);
    try { const r = await api('/api/options', { method: 'PUT', body: { key: k, list: items } }); onSaved(r.options); toast('บันทึกตัวเลือกแล้ว'); }
    catch (x) { toast('❌ ' + x.message); }
    setBusy(false);
  }
  return (
    <div className="card">
      <h2>{OPTION_GROUPS[k]}</h2>
      <label htmlFor={'o-' + k}>รายการตัวเลือก (1 บรรทัด = 1 ตัวเลือก ตัวแรกเป็นค่าเริ่มต้น)</label>
      <textarea id={'o-' + k} rows={Math.min(10, Math.max(4, items.length + 1))} value={text} onChange={(e) => setText(e.target.value)} />
      <div className="row sp" style={{ marginTop: 10 }}><span className="mu">{items.length} ตัวเลือก{!items.length && ' — ฟอร์มจะกรอกช่องนี้ไม่ได้จนกว่าจะเพิ่ม'}</span><button className="btn" onClick={save} disabled={!dirty || busy}>{busy ? 'กำลังบันทึก...' : 'บันทึก'}</button></div>
    </div>
  );
}

export default function Forms() {
  const { perms } = useMe();
  const { data, error, mutate } = useApi(perms.manage ? '/api/options' : null);
  if (!perms.manage) return <Denied />;
  return (
    <>
      <h1>จัดการฟอร์ม</h1>
      <p className="mu">แก้ไขรายการตัวเลือกในฟอร์ม (เช่น รายชื่อแพทย์ เซลล์ ทีมงาน เครื่องมือ) — มีผลกับฟอร์มที่กรอกใหม่ ข้อมูลเดิมไม่เปลี่ยน</p>
      {error ? <div className="card empty" style={{ color: 'var(--dn)' }}>{error}</div> : !data ? <Spinner /> : (
        <div className="grid2">{Object.keys(OPTION_GROUPS).map((k) => <Group key={k} k={k} list={data.options[k]} onSaved={(options) => mutate({ options })} />)}</div>
      )}
    </>
  );
}
