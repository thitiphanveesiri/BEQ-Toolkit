import { route, audit, ipOf } from '../../../../lib/api.js';
import { verifyLogin, startSession, loginGuard, loginFailed, loginOk } from '../../../../lib/auth.js';
import { AppError } from '../../../../lib/errors.js';

export const POST = route({ public: true }, async ({ req, body }) => {
  const username = String(body?.username || '').trim().slice(0, 60);
  const key = ipOf(req) + '|' + username.toLowerCase();
  loginGuard(key);
  const u = await verifyLogin(username, body?.password);
  if (!u) {
    loginFailed(key);
    audit(req, { username }, 'login_failed');
    throw new AppError(401, 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
  }
  loginOk(key);
  await startSession(u);
  audit(req, u, 'login');
  return { ok: true };
});
