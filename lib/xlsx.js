import zlib from 'node:zlib';
import { AppError } from './errors.js';
// สร้างไฟล์ .xlsx แบบไม่พึ่งไลบรารี (ZIP แบบไม่บีบอัด + SpreadsheetML ขั้นต่ำ)
// - ข้อความเก็บเป็น inline string เสมอ: เลข OPD/วันที่จึงไม่ถูก Excel แปลงเป็นตัวเลข/วันที่ และสูตรไม่ทำงาน
// - แถวหัวตารางตัวหนา + ตรึงแถวแรก + ตัวกรอง + กำหนดความกว้างคอลัมน์
const T = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (buf) => { let c = 0xFFFFFFFF; for (let i = 0; i < buf.length; i++) c = T[(c ^ buf[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };

function zip(files) {
  const now = new Date(), dt = ((now.getFullYear() - 1980) << 9 | (now.getMonth() + 1) << 5 | now.getDate()) & 0xFFFF, tm = (now.getHours() << 11 | now.getMinutes() << 5 | (now.getSeconds() >> 1)) & 0xFFFF;
  const parts = [], central = [];
  let offset = 0;
  for (const [name, data] of files) {
    const nameB = Buffer.from(name, 'utf8'), buf = Buffer.from(data, 'utf8'), crc = crc32(buf);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(0, 8);
    local.writeUInt16LE(tm, 10); local.writeUInt16LE(dt, 12); local.writeUInt32LE(crc, 14); local.writeUInt32LE(buf.length, 18); local.writeUInt32LE(buf.length, 22);
    local.writeUInt16LE(nameB.length, 26); local.writeUInt16LE(0, 28);
    parts.push(local, nameB, buf);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(0, 10);
    c.writeUInt16LE(tm, 12); c.writeUInt16LE(dt, 14); c.writeUInt32LE(crc, 16); c.writeUInt32LE(buf.length, 20); c.writeUInt32LE(buf.length, 24);
    c.writeUInt16LE(nameB.length, 28); c.writeUInt32LE(offset, 42);
    central.push(c, nameB);
    offset += 30 + nameB.length + buf.length;
  }
  const cd = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cd, end]);
}

const esc = (s) => String(s).replace(/[^\u0009\u000A\u000D\u0020-\uD7FF\uE000-\uFFFD]/gu, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const colName = (n) => { let s = ''; for (n++; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };

export function buildXlsx({ sheetName = 'Sheet1', headers, rows, widths = [] }) {
  const cellXml = (v, r, c, style) => {
    const ref = colName(c) + (r + 1), s = style ? ` s="${style}"` : '';
    if (v == null || v === '') return '';
    if (typeof v === 'number' && Number.isFinite(v)) return `<c r="${ref}"${s}><v>${v}</v></c>`;
    return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${esc(String(v).slice(0, 32000))}</t></is></c>`;
  };
  const line = (arr, r, style) => `<row r="${r + 1}">${arr.map((v, c) => cellXml(v, r, c, style)).join('')}</row>`;
  const last = colName(headers.length - 1) + (rows.length + 1);
  const cols = headers.map((_, i) => `<col min="${i + 1}" max="${i + 1}" width="${widths[i] || 16}" customWidth="1"/>`).join('');
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/><cols>${cols}</cols><sheetData>${line(headers, 0, 1)}${rows.map((r, i) => line(r, i + 1, 0)).join('')}</sheetData><autoFilter ref="A1:${last}"/></worksheet>`;
  const name = esc(sheetName.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Sheet1');
  return zip([
    ['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>'],
    ['_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
    ['xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${name}" sheetId="1" r:id="rId1"/></sheets></workbook>`],
    ['xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'],
    ['xl/styles.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFDDEFE6"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>'],
    ['xl/worksheets/sheet1.xml', sheet],
  ]);
}

/* ------------------------------ อ่าน .xlsx (นำเข้า) ------------------------------ */
// อ่านเฉพาะชีตแรก คืน array ของแถว (array ของข้อความ) แบบเดียวกับ parseCsv
// เซลล์วันที่ของ Excel (เก็บเป็นตัวเลข serial) แปลงเป็น YYYY-MM-DD หรือ YYYY-MM-DD HH:MM:SS (เวลาตามที่เห็นในเซลล์)

const MAX_UNZIP = 60 * 1024 * 1024; // กันไฟล์ zip bomb
const bad = () => new AppError(400, 'อ่านไฟล์ Excel ไม่ได้ — ต้องเป็น .xlsx ที่ไม่ได้ตั้งรหัสผ่าน (ไฟล์ .xls แบบเก่าให้เซฟใหม่เป็น .xlsx หรือ CSV UTF-8)');

function unzip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw bad();
  const files = new Map(), n = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16), total = 0;
  for (let k = 0; k < n; k++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw bad();
    const method = buf.readUInt16LE(p + 10), size = buf.readUInt32LE(p + 20), nl = buf.readUInt16LE(p + 28), el = buf.readUInt16LE(p + 30), cl = buf.readUInt16LE(p + 32), off = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nl);
    p += 46 + nl + el + cl;
    if (!/\.(xml|rels)$/.test(name)) continue;
    const start = off + 30 + buf.readUInt16LE(off + 26) + buf.readUInt16LE(off + 28), raw = buf.subarray(start, start + size);
    let data;
    try { data = method === 0 ? raw : method === 8 ? zlib.inflateRawSync(raw, { maxOutputLength: MAX_UNZIP - total }) : null; } catch { throw bad(); }
    if (!data) throw bad();
    total += data.length;
    files.set(name, data.toString('utf8'));
  }
  return files;
}

const unesc = (s) => s.replace(/&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-f]+);/gi, (_, e) => ({ lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" })[e.toLowerCase()] ?? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : +e.slice(1)));
const attr = (tag, a) => unesc(new RegExp(`\\s${a}="([^"]*)"`).exec(tag)?.[1] ?? '');
const textOf = (xml) => [...xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '').matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>|<t\b[^>]*\/>/g)].map((m) => unesc(m[1] || '')).join('');
const colIdx = (ref) => { let n = 0; for (const ch of /^[A-Z]+/.exec(ref)?.[0] || '') n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };
// รูปแบบตัวเลขในตัวที่เป็นวันที่/เวลา (รวมรูปแบบไทย 71–81)
const DATE_IDS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58, 71, 72, 73, 74, 75, 76, 77, 78, 79, 80, 81]);
const isDateCode = (code) => /[dyhวปช]/i.test(code.replace(/"[^"]*"|\[[^\]]*\]|\\./g, ''));
const pad = (n) => String(n).padStart(2, '0');
export function serialToText(v, date1904 = false) {
  const ms = Math.round((v + (date1904 ? 1462 : 0) - 25569) * 86400000), d = new Date(ms);
  const day = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  return ms % 86400000 ? `${day} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}` : day;
}

export function readXlsx(buf) {
  const f = unzip(Buffer.from(buf));
  const wb = f.get('xl/workbook.xml'); if (!wb) throw bad();
  const rid = attr(/<sheet\b[^>]*>/.exec(wb)?.[0] || '', 'r:id');
  const rel = [...(f.get('xl/_rels/workbook.xml.rels') || '').matchAll(/<Relationship\b[^>]*>/g)].map((m) => m[0]).find((t) => attr(t, 'Id') === rid);
  const target = rel ? attr(rel, 'Target').replace(/^\/?(xl\/)?/, '') : 'worksheets/sheet1.xml';
  const sheet = f.get('xl/' + target); if (!sheet) throw bad();
  const date1904 = /<workbookPr\b[^>]*date1904="(1|true)"/.test(wb);
  const shared = [...(f.get('xl/sharedStrings.xml') || '').matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>|<si\b[^>]*\/>/g)].map((m) => textOf(m[1] || ''));
  const st = f.get('xl/styles.xml') || '';
  const custom = new Map([...st.matchAll(/<numFmt\b[^>]*>/g)].map((m) => [+attr(m[0], 'numFmtId'), attr(m[0], 'formatCode')]));
  const xfs = [...(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(st)?.[1] || '').matchAll(/<xf\b[^>]*>/g)].map((m) => {
    const id = +attr(m[0], 'numFmtId');
    return DATE_IDS.has(id) || (custom.has(id) && isDateCode(custom.get(id)));
  });

  const rows = [];
  for (const rm of sheet.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const row = [];
    for (const cm of rm[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const tag = ' ' + cm[1], body = cm[2] || '', t = attr(tag, 't'), v = unesc(/<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? '');
      let out = '';
      if (t === 's') out = shared[+v] ?? '';
      else if (t === 'inlineStr') out = textOf(body);
      else if (t === 'b') out = v === '1' ? 'TRUE' : v ? 'FALSE' : '';
      else if (t === 'str') out = v;
      else if (t !== 'e' && v !== '') { const num = Number(v); out = xfs[+attr(tag, 's') || 0] && Number.isFinite(num) ? serialToText(num, date1904) : Number.isFinite(num) ? String(num) : v; }
      const ref = attr(tag, 'r'), i = ref ? colIdx(ref) : row.length;
      while (row.length < i) row.push('');
      row[i] = out;
    }
    if (row.some((x) => String(x).trim() !== '')) rows.push(row);
  }
  return rows;
}
