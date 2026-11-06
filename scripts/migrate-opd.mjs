// แปลงเลข HN เดิม (HN-123456789012) ในชีต Records/Media และชื่อโฟลเดอร์ใน Drive ให้เป็นรูปแบบมีขีด (HN-12345-6-789012)
// ใช้: npm run migrate-opd           (ลองดูก่อน ไม่แก้อะไร)
//      npm run migrate-opd -- --apply (แก้จริง) — รันซ้ำได้ ปลอดภัย
process.env.DATA_MODE = 'google';
const apply = process.argv.includes('--apply');
const db = await import('../lib/db.js');
const { gjson } = await import('../lib/google.js');
const { canonOpd, OPD_RE } = await import('../lib/fields.js');
const rawRecords = await db.listRecords();
let n = 0;
// อ่านผ่าน listRecords แล้วค่า opd ถูกแปลงให้แล้ว → เขียนกลับทุกแถวที่ถูกแปลง (เทียบกับค่าดิบไม่ได้ จึงเขียนทุกแถวที่เป็นรูปแบบใหม่)
for (const r of rawRecords) { if (!OPD_RE.test(r.opd)) continue; n++; if (apply) await db.updateRecord(r); }
console.log(`Records: ${n} แถว${apply ? ' (เขียนแล้ว)' : ' (จะถูกเขียน)'}`);
const media = await db.listMedia(); let m = 0;
for (const x of media) { if (!OPD_RE.test(x.opd)) continue; m++; if (apply) await db.updateMedia(x); }
console.log(`Media: ${m} แถว${apply ? ' (เขียนแล้ว)' : ' (จะถูกเขียน)'}`);
// เปลี่ยนชื่อโฟลเดอร์คนไข้ใน Drive: "HN-123456789012 - ชื่อ" → "HN-12345-6-789012 - ชื่อ"
const names = new Map(rawRecords.map((r) => [r.opd, r.name]));
const folders = await (async () => { const { listFolders } = db; return listFolders ? listFolders() : []; })();
let f = 0;
for (const x of folders) {
  if (!x.key.startsWith('P:')) continue;
  const opd = canonOpd(x.key.slice(2)); const nm = names.get(opd); if (!nm || !OPD_RE.test(opd)) continue;
  f++;
  if (apply) await gjson(`https://www.googleapis.com/drive/v3/files/${x.driveId}?fields=id&supportsAllDrives=true`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: `${opd} - ${String(nm).replace(/[\\/:*?"<>|]/g, '_')}` }) }, 'Google Drive');
}
console.log(`โฟลเดอร์ Drive: ${f} โฟลเดอร์${apply ? ' (เปลี่ยนชื่อแล้ว)' : ' (จะถูกเปลี่ยนชื่อ)'}`);
if (!apply) console.log('\nตรวจแล้วถูกต้อง ให้รันอีกครั้งด้วย: npm run migrate-opd -- --apply');
