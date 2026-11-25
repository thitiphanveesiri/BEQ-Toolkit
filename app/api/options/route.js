import { route, audit } from '../../../lib/api.js';
import { getOptions, setOptions } from '../../../lib/db.js';
import { getFormOptions } from '../../../lib/records.js';
import { OPTION_GROUPS } from '../../../lib/fields.js';
import { can, canFill } from '../../../lib/roles.js';
import { AppError } from '../../../lib/errors.js';

// ?formType=case|day0 (เฉพาะผู้มีสิทธิ์กรอกฟอร์ม) จะได้รายชื่อทีมงานตามบทบาทมาด้วย: tDoc, tCell, tPh, tCk
export const GET = route({}, async ({ req, user }) => {
  const ft = new URL(req.url).searchParams.get('formType');
  const limits = { imageMb: Number(process.env.MAX_IMAGE_MB || 25), videoMb: Number(process.env.MAX_VIDEO_MB || 1024) };
  if (ft && ['case', 'day0'].includes(ft) && canFill(user, ft)) return { options: await getFormOptions(ft), limits };
  return { options: await getOptions(), limits };
});

export const PUT = route({ perm: 'manage' }, async ({ req, user, body }) => {
  if (!(body?.key in OPTION_GROUPS)) throw new AppError(400, 'ไม่พบกลุ่มตัวเลือก');
  const list = [...new Set((Array.isArray(body.list) ? body.list : []).map((x) => String(x).trim()).filter(Boolean))];
  if (list.length > 100 || list.some((x) => x.length > 60)) throw new AppError(400, 'ตัวเลือกมากเกินไปหรือยาวเกินไป (สูงสุด 100 รายการ รายการละ 60 ตัวอักษร)');
  if (list.some((x) => x.includes(','))) throw new AppError(400, 'ตัวเลือกห้ามมีเครื่องหมายจุลภาค (,)');
  await setOptions(body.key, list);
  audit(req, user, 'options_update', body.key, `${list.length} รายการ`);
  return { options: await getOptions() };
});
