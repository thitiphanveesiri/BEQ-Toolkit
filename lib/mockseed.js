// ข้อมูลสมมติสำหรับโหมดทดลองเท่านั้น (DATA_MODE=mock) — ไม่ถูกใช้ใน production
// ทุกชื่อ/รูปเป็นข้อมูลตัวอย่าง ไม่ใช่ข้อมูลคนไข้จริง
import fs from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';

const now = new Date().toISOString();
const svg = (label, hue) => `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue} 55% 38%)"/><stop offset="1" stop-color="hsl(${(hue + 50) % 360} 60% 22%)"/></linearGradient></defs><rect width="800" height="600" fill="url(#g)"/><circle cx="400" cy="250" r="110" fill="#ffffff22"/><text x="400" y="450" text-anchor="middle" font-size="34" fill="#fff" font-family="sans-serif">${label}</text><text x="400" y="500" text-anchor="middle" font-size="22" fill="#ffffffaa" font-family="sans-serif">รูปตัวอย่าง (mock)</text></svg>`;

export async function seedMock(db, dir) {
  const hash = bcrypt.hashSync('demo1234', 8);
  const U = [['admin', 'ผู้ดูแล ตัวอย่าง', 'admin'], ['doctor', 'แพทย์ ตัวอย่าง', 'doctor'], ['bt', 'BT ตัวอย่าง', 'bt'], ['sales', 'เซลล์ ตัวอย่าง', 'sales'], ['lead', 'หัวหน้าเซลล์ ตัวอย่าง', 'sales_lead'], ['checker', 'ผู้ตรวจ ตัวอย่าง', 'checker']];
  U.forEach(([username, name, role], i) => db.Users.push({ _row: i + 2, id: 'U-demo' + i, username, name, role, active: 'TRUE', passwordHash: hash, createdAt: now, updatedAt: now }));
  const opt = { cell: ['ณัฐ', 'พิมพ์', 'ภัทร'], doc: ['นพ.อนุชา', 'พญ.ศศิธร'], staff: ['สุดา', 'สมชาย', 'ปราณี'] };
  Object.entries(opt).forEach(([key, v], i) => db.Options.push({ _row: i + 2, key, json: JSON.stringify(v) }));

  const people = [
    ['OPD-9001', 'นายตัวอย่าง ใจดี', 'ชาย', 'FUE', 'ผม', 'istemz', 'PRP', 'Influ', 'ไทย'],
    ['OPD-9002', 'นางสาวสมมติ รักสุข', 'หญิง', 'DHI', 'คิ้ว', 'Recall', 'Consult', 'รีวิว', 'ไทย'],
    ['OPD-9003', 'Mr. Demo Patient', 'ชาย', 'FUT', 'จอน', 'Recall Plus', 'PRP', 'ฟรีรีวิว', 'ต่างชาติ'],
    ['OPD-9004', 'นายทดสอบ เก่งกล้า', 'ชาย', 'Sapphire FUE', 'หนวด', 'Recall Plus3X', 'รักษาอื่นๆ (ไม่ใช่การปลูก)', 'ขอใช้ภาพ', 'ไทย'],
  ];
  const plan = [['Day 0', 0], ['1 เดือน', 31], ['3 เดือน', 92], ['6 เดือน', 183]];
  let r = 2, m = 2;
  fs.mkdirSync(path.join(dir, 'media'), { recursive: true });
  people.forEach((p, pi) => {
    const base = new Date('2026-04-01'); base.setDate(base.getDate() + pi * 9);
    plan.forEach(([period, off], k) => {
      if (pi === 3 && k > 1) return; // บางเคสยังไม่ถึงกำหนดติดตาม
      const d = new Date(base); d.setDate(d.getDate() + off); const date = d.toISOString().slice(0, 10);
      const day0 = k === 0, id = `R-demo${pi}${k}`;
      db.Records.push({ _row: r++, id, formType: day0 ? 'day0' : 'case', opd: p[0], name: p[1], gender: p[2], date, plantDate: day0 ? '' : base.toISOString().slice(0, 10),
        nat: p[8], hairMethod: p[3], area: p[4], tool: p[5], inj: p[6], ct: p[7], visitPeriod: day0 ? '' : period, cell: day0 ? opt.cell[pi % 3] : '', doc: opt.doc[pi % 2],
        ph: opt.staff[(pi + k) % 3], ck: opt.staff[(pi + k + 1) % 3], note: pi === 0 && k === 0 ? 'ข้อมูลตัวอย่างสำหรับทดสอบระบบ' : '', createdBy: 'U-demo2', createdAt: now, updatedAt: now });
      const groups = day0 ? [['front', 'ก่อนวาดเส้น', 3], ['left', 'หลังวาดเส้น', 2], ['right', 'หลังปลูกเสร็จทันที', 2]] : [['single', period, 4 + (pi % 2)]];
      groups.forEach(([g, label, n], gi) => {
        for (let i = 1; i <= n; i++) {
          const mid = `M-demo${pi}${k}${gi}${i}`;
          fs.writeFileSync(path.join(dir, 'media', mid), svg(`${p[0]} · ${label} #${i}`, (pi * 70 + k * 40 + gi * 25 + i * 9) % 360));
          db.Media.push({ _row: m++, id: mid, recordId: id, opd: p[0], group: g, kind: 'image', driveId: mid, name: `${p[0]}-${label}-${String(i).padStart(2, '0')}.svg`, mime: 'image/svg+xml', size: '2000', status: 'ready', uploadedBy: 'U-demo2', uploadedAt: now });
        }
      });
    });
  });
}
