import { route } from '../../../../lib/api.js';
import { toCsv } from '../../../../lib/csv.js';
import { HEADERS } from '../../../../lib/dataio.js';

// เทมเพลต CSV: มีแต่หัวตาราง (ไม่ใส่แถวตัวอย่าง กันถูกนำเข้าเป็นคนไข้จริงโดยไม่ตั้งใจ)
export const GET = route({ perm: 'importData' }, async () => new Response(toCsv(HEADERS, []), {
  headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="beq-import-template.csv"', 'Cache-Control': 'no-store' },
}));
