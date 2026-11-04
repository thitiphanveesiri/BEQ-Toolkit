import { route, audit } from '../../../../lib/api.js';
import { patientDetail } from '../../../../lib/records.js';
import { AppError } from '../../../../lib/errors.js';

export const GET = route({ perm: 'viewImages' }, async ({ req, user, params }) => {
  const d = await patientDetail(decodeURIComponent(params.opd), { withMedia: true });
  if (!d) throw new AppError(404, 'ไม่พบคนไข้');
  audit(req, user, 'view_patient', d.opd);
  return d;
});
