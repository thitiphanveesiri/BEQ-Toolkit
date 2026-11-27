// CSV: อ่าน/เขียนตาม RFC 4180 (ไม่พึ่งไลบรารี)
// เขียน: UTF-8 + BOM (Excel ภาษาไทยเปิดแล้วไม่เพี้ยน), ขึ้นบรรทัดใหม่แบบ CRLF, กัน CSV/formula injection
// อ่าน: รับ BOM, ตัวคั่น , ; แท็บ (เดาจากบรรทัดหัวตาราง — Excel บางภาษาเซฟเป็น ;), ช่องที่มีเครื่องหมายคำพูด/ขึ้นบรรทัดใหม่ในช่อง

const FORMULA_START = /^[=+\-@\t\r]/;
// ข้อความที่ขึ้นต้นด้วย = + - @ จะถูก Excel ตีความเป็นสูตรได้ → เติม ' นำหน้า (ฝั่งอ่านจะตัดออกให้)
export const csvGuard = (s) => (FORMULA_START.test(s) ? "'" + s : s);
export const csvUnguard = (s) => (/^'[=+\-@\t\r]/.test(s) ? s.slice(1) : s);

const cell = (v) => {
  if (v == null) return '';
  let s = typeof v === 'number' ? String(v) : csvGuard(String(v));
  if (/[",\r\n]/.test(s) || /^\s|\s$/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
  return s;
};
export const toCsv = (headers, rows) => '\uFEFF' + [headers, ...rows].map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';

function detectDelimiter(text) {
  // นับตัวคั่นในบรรทัดแรก (นอกเครื่องหมายคำพูด) แล้วเลือกตัวที่เจอมากสุด
  const counts = { ',': 0, ';': 0, '\t': 0 };
  let q = false;
  for (const ch of text) {
    if (ch === '"') q = !q;
    else if (!q && (ch === '\n' || ch === '\r')) break;
    else if (!q && ch in counts) counts[ch]++;
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][1] ? Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0] : ',';
}

// คืน array ของแถว (แต่ละแถวเป็น array ของข้อความ) ตัดแถวว่างทิ้ง
export function parseCsv(input) {
  let text = String(input ?? '');
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  const d = detectDelimiter(text);
  const rows = [];
  let row = [], field = '', q = false, i = 0, touched = false;
  const endField = () => { row.push(field); field = ''; };
  const endRow = () => { endField(); if (touched || row.some((x) => x !== '')) rows.push(row); row = []; touched = false; };
  while (i < text.length) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i += 2; continue; } q = false; i++; continue; }
      field += ch; i++; continue;
    }
    if (ch === '"' && field === '') { q = true; touched = true; i++; continue; }
    if (ch === d) { endField(); touched = true; i++; continue; }
    if (ch === '\r') { endRow(); i += text[i + 1] === '\n' ? 2 : 1; continue; }
    if (ch === '\n') { endRow(); i++; continue; }
    field += ch; i++;
  }
  if (field !== '' || row.length || touched) endRow();
  return rows.filter((r) => r.some((x) => String(x).trim() !== ''));
}
