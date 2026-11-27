import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, toCsv } from '../lib/csv.js';
import { buildXlsx } from '../lib/xlsx.js';
import { COLUMNS, HEADERS, exportTable, parseDate, parseImport, parseTimestamp, templateHeaders } from '../lib/dataio.js';
import { DEFAULT_OPTIONS } from '../lib/fields.js';

const options = { ...DEFAULT_OPTIONS };
const users = [
  { id: 'U-1', username: 'admin', name: 'ผู้ดูแล', role: 'admin', active: 'TRUE' },
  { id: 'U-2', username: 'sale1', name: 'สมศรี เซลล์', role: 'sales', active: 'TRUE' },
  { id: 'U-3', username: 'doc1', name: 'ใจดี', role: 'doctor', active: 'TRUE' },
];
const importer = users[0];
const H = ['เวลาที่ส่ง', 'เลข OPD', 'ชื่อคนไข้', 'ปลูกผมย้ายราก', 'บริเวณที่ทำ', 'ปลูกด้วย Stem cell', 'งานฉีดและอื่นๆ', 'วันที่ปลูก', 'ประเภทเคส', 'เซลล์', 'แพทย์', 'ผู้ถ่าย', 'ตรวจสอบโดย', 'ผู้ส่ง', 'จำนวนไฟล์', 'สถานะ', 'ที่มา', 'โฟลเดอร์ภาพ'];
const run = (lines, existing = []) => parseImport(parseCsv([H.join(','), ...lines].join('\r\n')), { options, users, existing, importer, now: '2026-11-27T03:00:00.000Z' });

test('หัวตาราง 18 คอลัมน์แรกตรงตามที่กำหนด (ปลูกผมย้ายราก / Stem cell / งานฉีด แยกกัน) และเรียงตามลำดับ', () => {
  assert.deepEqual(HEADERS.slice(0, 18), H);
  assert.ok(!HEADERS.includes('ปลูกด้วย stem cell งานฉีดและอื่นๆ'), 'ไม่ส่งออกคอลัมน์รวมแบบเก่า');
  assert.deepEqual(COLUMNS.filter((c) => c.req).map((c) => c.label), ['เลข OPD', 'ชื่อคนไข้', 'วันที่ปลูก']);
});

test('CSV: เขียน/อ่านวนกลับได้ รองรับเครื่องหมายคำพูด ขึ้นบรรทัดใหม่ในช่อง BOM และตัวคั่น ; และแท็บ', () => {
  const rows = [['a,b', 'say "hi"', 'ขึ้น\nบรรทัด', ' มีช่องว่าง '], ['ไทย', '', '1', '2']];
  const csv = toCsv(['h1', 'h2', 'h3', 'h4'], rows);
  assert.equal(csv.charCodeAt(0), 0xFEFF); assert.ok(csv.includes('\r\n'));
  assert.deepEqual(parseCsv(csv).slice(1), rows);
  assert.deepEqual(parseCsv('a;b\n1;"2;3"'), [['a', 'b'], ['1', '2;3']]);
  assert.deepEqual(parseCsv('a\tb\r\n1\t2\r\n\r\n'), [['a', 'b'], ['1', '2']]);
});

test('CSV: ข้อความที่ขึ้นต้นด้วย = + - @ ถูกกันเป็นสูตร และตอนนำเข้ากลับถูกตัดเครื่องหมายออก', () => {
  const csv = toCsv(['x'], [['=HYPERLINK("http://evil")'], ['+1'], ['-2'], ['@SUM(A1)'], ['ปกติ']]);
  const body = parseCsv(csv).slice(1).map((r) => r[0]);
  assert.ok(body.slice(0, 4).every((v) => v.startsWith("'")), 'ต้องมี \' นำหน้า');
  assert.equal(body[4], 'ปกติ');
});

test('XLSX: เป็นไฟล์ ZIP ที่มีไฟล์ครบและเขียนตัวอักษรพิเศษถูกต้อง', () => {
  const buf = buildXlsx({ sheetName: 'ทดสอบ', headers: ['A', 'B'], rows: [['x & <y>', 3], ['=1+1', null]], widths: [10, 10] });
  assert.equal(buf.subarray(0, 2).toString(), 'PK');
  const s = buf.toString('latin1');
  for (const n of ['[Content_Types].xml', 'xl/workbook.xml', 'xl/worksheets/sheet1.xml', 'xl/styles.xml']) assert.ok(s.includes(n), n);
  assert.ok(buf.toString('utf8').includes('x &amp; &lt;y&gt;'));
});

test('วันที่/เวลา: รองรับ ค.ศ. พ.ศ. วัน/เดือน/ปี และเขตเวลา', () => {
  assert.equal(parseDate('2026-11-27'), '2026-11-27');
  assert.equal(parseDate('27/11/2026'), '2026-11-27');
  assert.equal(parseDate('27/11/2569'), '2026-11-27');
  assert.equal(parseDate('31/02/2026'), null);
  assert.equal(parseTimestamp('2026-11-27 14:30'), '2026-11-27T07:30:00.000Z'); // เวลาไทย = UTC+7
  assert.equal(parseTimestamp('27/11/2569 14:30:05'), '2026-11-27T07:30:05.000Z');
  assert.equal(parseTimestamp('2026-11-27T07:30:00Z'), '2026-11-27T07:30:00.000Z');
  assert.equal(parseTimestamp('วันนี้'), null);
});

test('นำเข้า: แถวปกติ แยกปลูกด้วย/Rejuvenation ให้ถูก และสร้างข้อมูลครบตามรูปแบบของระบบ', () => {
  const { results, unknownPeople } = run(['27/11/2569 14:30,12345-6-789012,นายตัวอย่าง ใจดี,fue,"ผม, คิ้ว",iStemz,PRP,2026-11-20,รีวิว,สมศรี เซลล์,ใจดี,ช่างภาพนอก,ใจดี,sale1,,,ฟอร์ม Day 0,']);
  const [r] = results; assert.equal(r.status, 'ok', r.message);
  const x = r.rec;
  assert.equal(x.opd, 'HN-12345-6-789012'); assert.equal(x.formType, 'day0');
  assert.equal(x.name, 'นายตัวอย่าง ใจดี'); assert.equal(x.fname, 'นายตัวอย่าง'); assert.equal(x.lname, 'ใจดี');
  assert.equal(x.hairMethod, 'FUE'); assert.equal(x.area, 'ผม, คิ้ว'); assert.equal(x.tool, 'iStemz'); assert.equal(x.inj, 'PRP');
  assert.equal(x.procType, 'Hair Transplantation, Cell Therapy, Rejuvenation');
  assert.equal(x.date, '2026-11-20'); assert.equal(x.plantDate, ''); assert.equal(x.createdAt, '2026-11-27T07:30:00.000Z');
  assert.equal(x.createdBy, 'U-2'); assert.equal(x.cellId, 'U-2'); assert.equal(x.ph, 'ช่างภาพนอก');
  assert.match(x.requestId, /^IMP-[0-9a-f]{24}$/);
  assert.deepEqual(unknownPeople, ['ช่างภาพนอก']);
});

test('นำเข้า: ค่าที่ผิดแจ้งเป็นรายแถว แถวอื่นยังผ่าน', () => {
  const { results } = run([
    ',1.23457E+11,ก ข,,,,,2026-11-20,,,,,,,,,,',          // OPD ถูก Excel แปลง
    ',12345-6-789012,ก ข,XXX,,,,2026-11-20,,,,,,,,,,',      // วิธีปลูกไม่อยู่ในรายการ
    ',12345-6-789012,ก ข,,,"Botox",,2026-11-20,,,,,,,,,,',  // รายการที่ไม่รู้จัก
    ',12345-6-789012,ก ข,,,,,31/02/2026,,,,,,,,,,',          // วันที่ไม่มีจริง
    ',12345-6-789012,,,,,,2026-11-20,,,,,,,,,,',             // ไม่มีชื่อ
    ',12345-6-789012,ก ข,,,,,2026-11-20,,,,,,,,,,',          // ผ่าน
  ]);
  assert.deepEqual(results.map((r) => r.status), ['error', 'error', 'error', 'error', 'error', 'ok']);
  assert.match(results[0].message, /เลขวิทยาศาสตร์/); assert.match(results[1].message, /วิธีปลูก/);
  assert.match(results[2].message, /Botox/); assert.match(results[3].message, /วันที่ปลูก/); assert.match(results[4].message, /ชื่อ/);
  assert.deepEqual(results.map((r) => r.row), [2, 3, 4, 5, 6, 7]); // เลขแถวตามที่เห็นใน Excel
});

test('นำเข้า: ซ้ำกับของเดิม/ซ้ำในไฟล์ถูกข้าม และชื่อไม่ตรงกับ HN เดิมถูกปฏิเสธ', () => {
  const existing = [{ id: 'R-1', formType: 'day0', opd: 'HN-12345-6-789012', name: 'ก ข', date: '2026-11-20', round: 'ครั้งที่ 1', gender: 'ชาย', age: '30', nat: 'ไทย' }];
  const { results } = run([
    ',12345-6-789012,ก ข,,,,,2026-11-25,,,,,,,,,,',   // Day 0 รอบที่ 1 ของ HN นี้มีแล้ว
    ',22222-2-222222,ค ง,,,,,2026-11-20,,,,,,,,,,',    // ผ่าน
    ',22222-2-222222,ค ง,,,,,2026-11-21,,,,,,,,,,',    // Day 0 รอบเดียวกันซ้ำในไฟล์
    ',12345-6-789012,คนละคน,,,,,2026-11-20,,,,,,,,,,', // ชื่อไม่ตรง
  ], existing);
  assert.deepEqual(results.map((r) => r.status), ['duplicate', 'ok', 'duplicate', 'error']);
  assert.match(results[2].message, /ในไฟล์/); assert.match(results[3].message, /ชื่อไม่ตรง/);
});

test('นำเข้า: แถว F/U ต้องมีวันที่เข้ามารับบริการ และเติมเพศ/อายุ/สัญชาติจากข้อมูลเดิมของ HN', () => {
  const existing = [{ id: 'R-1', formType: 'day0', opd: 'HN-12345-6-789012', name: 'ก ข', date: '2026-01-01', round: 'ครั้งที่ 1', gender: 'หญิง', age: '41', nat: 'ไทย' }];
  const parse = (extraHead, line) => parseImport(parseCsv([[...H, ...extraHead].join(','), line].join('\r\n')), { options, users, existing, importer });
  const noVisit = parse([], ',12345-6-789012,ก ข,,,,,2026-01-01,,,,,,,,,ฟอร์ม F/U,').results[0];
  assert.equal(noVisit.status, 'error'); assert.match(noVisit.message, /F\/U/);
  const ok = parse(['วันที่เข้ามารับบริการ (F/U)', 'ระยะที่เข้ามาตรวจ'], ',12345-6-789012,ก ข,,,,,2026-01-01,,,,,,,,,ฟอร์ม F/U,,2026-02-01,1 เดือน').results[0];
  assert.equal(ok.status, 'ok', ok.message);
  assert.equal(ok.rec.formType, 'case'); assert.equal(ok.rec.date, '2026-02-01'); assert.equal(ok.rec.plantDate, '2026-01-01'); assert.equal(ok.rec.visitPeriod, '1 เดือน');
  assert.deepEqual([ok.rec.gender, ok.rec.age, ok.rec.nat], ['หญิง', '41', 'ไทย']);
});

test('นำเข้า: หัวตารางไม่ครบแจ้งชื่อคอลัมน์ที่ขาด, ยอมรับชื่อหัวตารางทางเลือก และรายงานคอลัมน์ที่ไม่รู้จัก', () => {
  assert.throws(() => parseImport(parseCsv('ชื่อคนไข้,วันที่ปลูก\r\nก ข,2026-01-01'), { options }), /เลข OPD/);
  const r = parseImport(parseCsv('HN;ชื่อ-นามสกุล;วันที่มาปลูก;คอลัมน์แปลก\r\n123456789012;ก ข;20/11/2569;x'), { options, users, importer });
  assert.equal(r.results[0].status, 'ok', r.results[0].message); assert.deepEqual(r.ignored, ['คอลัมน์แปลก']);
  assert.throws(() => parseImport([[...H], ...Array.from({ length: 2001 }, () => [])], { options }), /2000/);
});

test('ส่งออก → นำเข้ากลับ: ได้ข้อมูลเท่าเดิม (ใช้กับ DB ว่าง)', () => {
  const rec = (o) => ({ id: 'R-' + o.formType + o.opd, createdAt: '2026-11-20T03:00:00.000Z', gender: 'ชาย', age: '35', nat: 'ไทย', round: 'ครั้งที่ 1', createdBy: 'U-2', requestId: 'C-abcdefghijklmnop', ...o });
  const day0 = rec({ formType: 'day0', opd: 'HN-11111-1-111111', name: 'สมชาย ใจดี', fname: 'สมชาย', lname: 'ใจดี', date: '2026-11-20', hairMethod: 'FUE', area: 'ผม, คิ้ว', tool: 'iStemz', inj: 'PRP', ct: 'รีวิว', cell: 'สมศรี เซลล์', doc: 'ใจดี', ph: 'สมศรี เซลล์', ck: 'ใจดี', procType: 'Hair Transplantation, Cell Therapy, Rejuvenation', note: 'หมายเหตุ, มีจุลภาค' });
  const fu = rec({ formType: 'case', opd: 'HN-11111-1-111111', name: 'สมชาย ใจดี', fname: 'สมชาย', lname: 'ใจดี', date: '2026-12-20', plantDate: '2026-11-20', visitPeriod: '1 เดือน', seeDoctor: 'พบแพทย์', createdAt: '2026-12-20T03:00:00.000Z', cell: 'สมศรี เซลล์', doc: 'ใจดี', ph: 'สมศรี เซลล์', ck: 'ใจดี' });
  const media = [{ id: 'M-1', recordId: day0.id, status: 'ready' }, { id: 'M-2', recordId: day0.id, status: 'ready' }];
  const folders = [{ key: 'V:HN-111111111111:Day0', driveId: 'FOLDER1' }];
  const t = exportTable([fu, day0], { users, media, folders, google: true });
  assert.equal(t.rows.length, 2);
  const [a, b] = t.rows; // เรียงตามเวลาที่ส่ง: Day 0 ก่อน
  const col = (row, label) => row[HEADERS.indexOf(label)];
  assert.equal(col(a, 'เวลาที่ส่ง'), '2026-11-20 10:00:00'); // เวลาไทย
  assert.equal(col(a, 'ปลูกด้วย Stem cell'), 'iStemz'); assert.equal(col(a, 'งานฉีดและอื่นๆ'), 'PRP'); assert.equal(col(a, 'ผู้ส่ง'), 'สมศรี เซลล์');
  assert.equal(col(a, 'จำนวนไฟล์'), 2); assert.equal(col(a, 'สถานะ'), 'มีไฟล์แล้ว'); assert.equal(col(a, 'ที่มา'), 'ฟอร์ม Day 0');
  assert.equal(col(a, 'โฟลเดอร์ภาพ'), 'https://drive.google.com/drive/folders/FOLDER1');
  assert.equal(col(b, 'จำนวนไฟล์'), 0); assert.equal(col(b, 'สถานะ'), 'ยังไม่มีไฟล์'); assert.equal(col(b, 'ที่มา'), 'ฟอร์ม F/U');

  const csv = toCsv(t.headers, t.rows);
  const back = parseImport(parseCsv(csv), { options, users, existing: [], importer });
  assert.deepEqual(back.results.map((r) => r.status), ['ok', 'ok'], back.results.map((r) => r.message).join('|'));
  const [d0, f1] = back.results.map((r) => r.rec);
  for (const k of ['formType', 'opd', 'name', 'date', 'hairMethod', 'area', 'tool', 'inj', 'ct', 'cell', 'doc', 'ph', 'ck', 'gender', 'age', 'nat', 'round', 'procType', 'note', 'createdBy', 'createdAt']) assert.equal(d0[k], day0[k], k);
  for (const k of ['formType', 'date', 'plantDate', 'visitPeriod', 'seeDoctor', 'createdAt']) assert.equal(f1[k], fu[k], k);
  // ส่งออกซ้ำเข้าระบบเดิมที่มีข้อมูลอยู่แล้ว = ซ้ำทั้งหมด ไม่สร้างแถวใหม่
  const again = parseImport(parseCsv(csv), { options, users, existing: [day0, fu], importer });
  assert.deepEqual(again.results.map((r) => r.status), ['duplicate', 'duplicate']);
});

test('นำเข้า: Stem cell กับงานฉีดแยกคอลัมน์ — หลายค่า, ใส่ ✓ แทนชื่อรายการ, และไม่ทำหมวดที่ไม่ได้กรอก', () => {
  const head = 'เลข OPD,ชื่อคนไข้,วันที่ปลูก,ปลูกผมย้ายราก,บริเวณที่ทำ,ปลูกด้วย Stem cell,งานฉีดและอื่นๆ';
  const go = (...lines) => parseImport(parseCsv([head, ...lines].join('\r\n')), { options, users, importer }).results;
  const [a, b, c, d] = go(
    '111111111111,ก ข,2026-11-20,,,"iStemz, ReCell Plus3X",PRP',   // Stem cell + ฉีด ไม่ปลูกผม
    '222222222222,ค ง,2026-11-20,✓,,,',                              // ปลูกผมย้ายราก ไม่ระบุวิธี
    '333333333333,จ ฉ,2026-11-20,FUE,ผม,,',                          // ปลูกผมอย่างเดียว
    '444444444444,ช ซ,2026-11-20,,,,✓',                              // งานฉีดอย่างเดียว ไม่ระบุรายการ
  );
  for (const r of [a, b, c, d]) assert.equal(r.status, 'ok', r.message);
  assert.deepEqual([a.rec.tool, a.rec.inj, a.rec.hairMethod, a.rec.procType], ['iStemz, ReCell Plus3X', 'PRP', '', 'Cell Therapy, Rejuvenation']);
  assert.deepEqual([b.rec.hairMethod, b.rec.procType], ['', 'Hair Transplantation']);
  assert.deepEqual([c.rec.hairMethod, c.rec.area, c.rec.procType], ['FUE', 'ผม', 'Hair Transplantation']);
  assert.deepEqual([d.rec.inj, d.rec.procType], ['', 'Rejuvenation']);
});

test('นำเข้า: ใส่รายการผิดคอลัมน์ (PRP ในช่อง Stem cell) แจ้งให้ย้าย ไม่เดาให้เอง', () => {
  const head = 'เลข OPD,ชื่อคนไข้,วันที่ปลูก,ปลูกด้วย Stem cell,งานฉีดและอื่นๆ';
  const r = parseImport(parseCsv([head, '111111111111,ก ข,2026-11-20,PRP,', '222222222222,ค ง,2026-11-20,,iStemz', '333333333333,จ ฉ,2026-11-20,Botox,'].join('\r\n')), { options, users, importer }).results;
  assert.deepEqual(r.map((x) => x.status), ['error', 'error', 'error']);
  assert.match(r[0].message, /งานฉีดและอื่นๆ.*ย้าย/); assert.match(r[1].message, /ปลูกด้วย Stem cell.*ย้าย/); assert.match(r[2].message, /ไม่อยู่ในรายการ/);
});

test('นำเข้า: ไฟล์เก่าที่รวม Stem cell กับงานฉีดไว้ช่องเดียวยังนำเข้าได้', () => {
  const r = parseImport(parseCsv('เลข OPD,ชื่อคนไข้,วันที่ปลูก,ปลูกด้วย stem cell งานฉีดและอื่นๆ\r\n111111111111,ก ข,2026-11-20,"iStemz, PRP"'), { options, users, importer }).results[0];
  assert.equal(r.status, 'ok', r.message); assert.deepEqual([r.rec.tool, r.rec.inj, r.rec.procType], ['iStemz', 'PRP', 'Cell Therapy, Rejuvenation']);
});

test('วันที่ เดือน/วัน/ปี: ดูทั้งไฟล์ · ปนกันปฏิเสธ · ค่ากำกวมเตือน', () => {
  assert.equal(parseDate('3/4/2026', true), '2026-03-04');
  assert.equal(parseTimestamp('11/27/2026 14:30', true), '2026-11-27T07:30:00.000Z');
  const go = (...dates) => parseImport(parseCsv(['เลข OPD,ชื่อคนไข้,วันที่ปลูก', ...dates.map((d, i) => `${111111111111 + i},ก ข${i},${d}`)].join('\r\n')), { options, users, importer });
  const us = go('11/27/2026', '3/4/2026');
  assert.match(us.dateNote, /เดือน\/วัน\/ปี/);
  assert.deepEqual(us.results.map((r) => r.rec.date), ['2026-11-27', '2026-03-04']);
  const th = go('27/11/2026', '3/4/2026');
  assert.equal(th.dateNote, '');
  assert.equal(th.results[1].rec.date, '2026-04-03');
  assert.match(go('3/4/2026').dateNote, /อ่านเป็น วัน\/เดือน\/ปี/);
  assert.throws(() => go('27/11/2026', '11/27/2026'), /ปนกัน/);
});

test('เลือกชนิดไฟล์ Day 0 / F/U: บังคับทั้งไฟล์ และจับไฟล์ผิดชนิด', () => {
  const head = 'เลข OPD,ชื่อคนไข้,วันที่ปลูก,วันที่เข้ามารับบริการ (F/U),ที่มา';
  const go = (formType, ...lines) => parseImport(parseCsv([head, ...lines].join('\r\n')), { options, users, importer, formType }).results;
  const fu = go('case', '111111111111,ก ข,2026-01-01,2026-02-01,')[0];
  assert.equal(fu.status, 'ok'); assert.equal(fu.rec.formType, 'case'); assert.equal(fu.rec.date, '2026-02-01');
  assert.equal(go('day0', '111111111111,ก ข,2026-01-01,,')[0].rec.formType, 'day0');
  assert.match(go('day0', '111111111111,ก ข,2026-01-01,2026-02-01,ฟอร์ม F/U')[0].message, /ไม่ตรงกับชนิดไฟล์/);
  assert.match(go('case', '111111111111,ก ข,2026-01-01,2026-02-01,ฟอร์ม Day 0')[0].message, /ไม่ตรงกับชนิดไฟล์/);
  assert.throws(() => parseImport(parseCsv('เลข OPD,ชื่อคนไข้,วันที่ปลูก\r\n111111111111,ก ข,2026-01-01'), { options, users, importer, formType: 'case' }), /ไฟล์ F\/U ต้องมีคอลัมน์/);
});

test('เทมเพลต Day 0 ไม่มีช่องเฉพาะ F/U', () => {
  assert.ok(!templateHeaders('day0').includes('วันที่เข้ามารับบริการ (F/U)'));
  assert.deepEqual(templateHeaders('case'), HEADERS);
});

test('นำเข้า .xlsx: เซลล์วันที่ของ Excel (รวมรูปแบบ พ.ศ.) อ่านเป็นวันที่จริง และผ่าน parseImport', async () => {
  const { readFileSync } = await import('node:fs');
  const { readXlsx, buildXlsx } = await import('../lib/xlsx.js');
  // ไฟล์ตัวอย่างสร้างด้วย openpyxl: sharedStrings + deflate + รูปแบบวันที่แบบ built-in/custom/ไทย
  const rows = readXlsx(readFileSync(new URL('./fixtures/import-sample.xlsx', import.meta.url)));
  assert.deepEqual(rows[1], ['2026-11-27 14:30:00', '123456789012', 'สมชาย ใจดี', '2026-03-04', '2026-04-05', '35', 'F/U']);
  assert.equal(rows.length, 3); // แถวว่างท้ายไฟล์ถูกตัด
  const r = parseImport(rows, { options, users, importer, formType: 'case' });
  assert.equal(r.dateNote, ''); // วันที่จาก Excel ไม่ต้องเดา วัน/เดือน
  assert.deepEqual(r.results.map((x) => [x.status, x.rec?.plantDate, x.rec?.date]), [['ok', '2026-03-04', '2026-04-05'], ['ok', '2026-11-20', '2026-11-27']]);
  assert.equal(r.results[0].rec.createdAt, '2026-11-27T07:30:00.000Z');
  // ส่งออก .xlsx ของระบบเอง → อ่านกลับได้เท่าเดิม
  const back = readXlsx(buildXlsx({ headers: ['a', 'b'], rows: [['=1+1', 'ก & <ข>'], [5, '']] }));
  assert.deepEqual(back, [['a', 'b'], ['=1+1', 'ก & <ข>'], ['5']]);
  assert.throws(() => readXlsx(Buffer.from('not a zip')), /อ่านไฟล์ Excel ไม่ได้/);
});
