import { route } from '../../../../lib/api.js';
import { toCsv } from '../../../../lib/csv.js';
import { templateHeaders } from '../../../../lib/dataio.js';

// เทมเพลต CSV: มีแต่หัวตาราง (ไม่ใส่แถวตัวอย่าง กันถูกนำเข้าเป็นคนไข้จริงโดยไม่ตั้งใจ) · ?formType=day0|case
export const GET = route({ perm: 'importData' }, async ({ req }) => {
  const ft = new URL(req.url).searchParams.get('formType');
  const formType = ['day0', 'case'].includes(ft) ? ft : '';
  const name = formType === 'day0' ? 'day0' : formType === 'case' ? 'fu' : 'all';
  return new Response(toCsv(templateHeaders(formType), []), {
    headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="beq-import-template-${name}.csv"`, 'Cache-Control': 'no-store' },
  });
});
