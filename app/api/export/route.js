import { route, audit } from '../../../lib/api.js';
import { dataMode, listFolders, listMedia, listRecords, listUsers } from '../../../lib/db.js';
import { bkkDate, exportTable } from '../../../lib/dataio.js';
import { toCsv } from '../../../lib/csv.js';
import { buildXlsx } from '../../../lib/xlsx.js';
import { ownedOpds } from '../../../lib/scope.js';

const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '') ? s : '';

// GET /api/export?format=xlsx|csv&formType=day0|case&from=YYYY-MM-DD&to=YYYY-MM-DD  (from/to กรองตาม “เวลาที่ส่ง” ตามเวลาไทย)
export const GET = route({ perm: 'exportData' }, async ({ req, user }) => {
  const sp = new URL(req.url).searchParams;
  const format = sp.get('format') === 'csv' ? 'csv' : 'xlsx';
  const formType = ['day0', 'case'].includes(sp.get('formType')) ? sp.get('formType') : '';
  const from = isDate(sp.get('from')), to = isDate(sp.get('to'));
  const owned = await ownedOpds(user);
  const [all, users, media, folders] = await Promise.all([listRecords(), listUsers(), listMedia(), listFolders()]);
  const records = all.filter((r) => (!formType || r.formType === formType) && (!owned || owned.has(r.opd)) && (!from || bkkDate(r.createdAt) >= from) && (!to || bkkDate(r.createdAt) <= to));
  const { headers, rows, widths } = exportTable(records, { users, media, folders, google: dataMode() === 'google' });
  const stamp = new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-');
  audit(req, user, 'export_data', 'records', `${format} · ${rows.length} แถว${formType ? ' · ' + formType : ''}${from || to ? ` · ${from || '…'}–${to || '…'}` : ''}`);
  const csv = format === 'csv';
  return new Response(csv ? toCsv(headers, rows) : buildXlsx({ sheetName: 'BEQ Records', headers, rows, widths }), {
    headers: {
      'Content-Type': csv ? 'text/csv; charset=utf-8' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="beq-records-${stamp}.${format}"`,
      'Cache-Control': 'no-store',
    },
  });
});
