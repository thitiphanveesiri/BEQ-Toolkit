// ตัวห่อ route handler: ตรวจ session + สิทธิ์ + CSRF (Origin) + จับข้อผิดพลาดให้เป็น JSON ภาษาไทย
import { after } from 'next/server';
import { AppError } from './errors.js';
import { currentUser } from './auth.js';
import { can } from './roles.js';
import { logAudit } from './db.js';

export const ipOf = (req) => (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'local';

function sameOrigin(req) {
  const o = req.headers.get('origin');
  if (!o) return true; // คำขอที่ไม่ใช่เบราว์เซอร์ (เช่น curl) ไม่มี Origin — ยังต้องมี session cookie
  try { return new URL(o).host === req.headers.get('host'); } catch { return false; }
}

// บันทึก audit หลังตอบกลับเสร็จ จึงไม่เพิ่มความหน่วงให้ผู้ใช้ — ห้ามใส่รหัสผ่าน/token ใน detail
export function audit(req, user, action, target = '', detail = '') {
  const e = { user: user?.username || '', action, target, detail: String(detail).slice(0, 300), ip: req ? ipOf(req) : '' };
  const run = () => logAudit(e).catch((x) => console.error('audit failed:', x.message));
  try { after(run); } catch { run(); }
}

export function route(opts, handler) {
  return async (req, ctx) => {
    try {
      let user = null;
      if (!opts.public) {
        user = await currentUser();
        if (!user) throw new AppError(401, 'กรุณาเข้าสู่ระบบ');
        if (opts.perm && !can(user, opts.perm)) throw new AppError(403, 'บัญชีนี้ไม่มีสิทธิ์ใช้งานส่วนนี้');
      }
      if (req.method !== 'GET' && req.method !== 'HEAD' && !sameOrigin(req)) throw new AppError(403, 'คำขอไม่ถูกต้อง');
      const params = ctx?.params ? await ctx.params : {};
      let body = null;
      if (['POST', 'PUT', 'PATCH'].includes(req.method) && !opts.raw) {
        try { body = await req.json(); } catch { throw new AppError(400, 'รูปแบบข้อมูลไม่ถูกต้อง'); }
      }
      const out = await handler({ req, user, params, body });
      return out instanceof Response ? out : Response.json(out ?? { ok: true });
    } catch (e) {
      if (e instanceof AppError) return Response.json({ error: e.message }, { status: e.status });
      console.error(e);
      return Response.json({ error: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่' }, { status: 500 });
    }
  };
}
