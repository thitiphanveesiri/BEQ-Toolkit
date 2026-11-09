// รันที่โฟลเดอร์โปรเจกต์: node apply-age.mjs
// เพิ่มช่อง "อายุ", เปลี่ยนตัวเลือกเพศ, เอาปุ่มถ่ายรูป/ถ่ายวิดีโอออก — ถ้ามีจุดไหนหาไม่เจอจะไม่แก้ไฟล์ใดเลย
import fs from 'node:fs';
const edits = {
  'lib/fields.js': [
    ["export const GENDERS = ['ชาย', 'หญิง', 'อื่น ๆ'];", "export const GENDERS = ['ชาย', 'หญิง', 'LGBTQ+', 'ไม่ระบุ'];"],
    ["  gender: { l: 'เพศ', t: 'pills', o: GENDERS },\n", "  gender: { l: 'เพศ', t: 'pills', o: GENDERS },\n  age: { l: 'อายุ (ปี)', t: 'text', num: 1, ph: 'เช่น 35', req: 1 },\n"],
    ["['opd', 'fname', 'lname', 'gender', 'date', 'plantDate', 'nat']", "['opd', 'fname', 'lname', 'gender', 'age', 'date', 'plantDate', 'nat']"],
    ["['opd', 'fname', 'lname', 'gender', 'date', 'nat']", "['opd', 'fname', 'lname', 'gender', 'age', 'date', 'nat']"],
  ],
  'lib/db.js': [["'fname', 'lname', 'procType']", "'fname', 'lname', 'procType', 'age']"]],
  'lib/records.js': [["    if (f.t === 'date' && !validDate(v))", "    if (k === 'age' && !(/^\\d{1,3}$/.test(v) && Number(v) <= 120)) { errs.push('อายุต้องเป็นตัวเลข 0–120'); continue; }\n    if (f.t === 'date' && !validDate(v))"]],
  'components/Field.js': [["onChange={(e) => onChange(k, e.target.value)} placeholder={f.ph}", "onChange={(e) => onChange(k, f.num ? e.target.value.replace(/\\D/g, '').slice(0, 3) : e.target.value)} inputMode={f.num ? 'numeric' : undefined} placeholder={f.ph}"]],
  'app/(app)/patient/[opd]/page.js': [["'gender', 'date', 'plantDate'", "'gender', 'age', 'date', 'plantDate'"]],
};
const out = {}; let bad = 0;
for (const [file, list] of Object.entries(edits)) {
  const raw = fs.readFileSync(file, 'utf8'), crlf = raw.includes('\r\n');
  let s = raw.replace(/\r\n/g, '\n'); // ไฟล์บน Windows ใช้ CRLF — แปลงเป็น LF ชั่วคราวเพื่อค้นหา แล้วแปลงกลับตอนบันทึก
  for (const [a, b] of list) { const n = s.split(a).length - 1; if (n !== 1) { console.log(`✗ ${file}: หาข้อความไม่เจอหรือเจอหลายที่ (${n}) → ${a.slice(0, 50)}`); bad++; } else s = s.replace(a, () => b); }
  out[file] = crlf ? s.replace(/\n/g, '\r\n') : s;
}
const cf = 'components/CaseForm.js';
const lines = fs.readFileSync(cf, 'utf8').split('\n'), keep = lines.filter((l) => !l.includes('capture="environment"'));
if (lines.length - keep.length !== 2) { console.log(`✗ ${cf}: ควรพบปุ่มถ่ายรูป/วิดีโอ 2 บรรทัด แต่พบ ${lines.length - keep.length}`); bad++; } else out[cf] = keep.join('\n');
if (bad) { console.log('\nไม่ได้แก้ไฟล์ใดเลย — ส่งข้อความด้านบนมาให้ผมดู'); process.exit(1); }
for (const [f, s] of Object.entries(out)) fs.writeFileSync(f, s);
console.log('✓ แก้ครบ', Object.keys(out).length, 'ไฟล์');
