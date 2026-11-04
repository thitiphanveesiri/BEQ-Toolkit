import { route, audit } from '../../../lib/api.js';
import { getOptions, setOptions } from '../../../lib/db.js';
import { OPTION_GROUPS } from '../../../lib/fields.js';
import { AppError } from '../../../lib/errors.js';

export const GET = route({}, async () => ({ options: await getOptions() }));

export const PUT = route({ perm: 'manage' }, async ({ req, user, body }) => {
  if (!(body?.key in OPTION_GROUPS)) throw new AppError(400, 'ไม่พบกลุ่มตัวเลือก');
  const list = [...new Set((Array.isArray(body.list) ? body.list : []).map((x) => String(x).trim()).filter(Boolean))];
  if (list.length > 100 || list.some((x) => x.length > 60)) throw new AppError(400, 'ตัวเลือกมากเกินไปหรือยาวเกินไป (สูงสุด 100 รายการ รายการละ 60 ตัวอักษร)');
  await setOptions(body.key, list);
  audit(req, user, 'options_update', body.key, `${list.length} รายการ`);
  return { options: await getOptions() };
});
