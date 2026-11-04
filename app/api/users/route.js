import { route, audit } from '../../../lib/api.js';
import { listUsers, createUser, getUserByUsername } from '../../../lib/db.js';
import { hashPassword } from '../../../lib/auth.js';
import { ROLES, serializeOverrides } from '../../../lib/roles.js';
import { AppError } from '../../../lib/errors.js';
import { pub } from '../../../lib/userview.js';


export const GET = route({ perm: 'manage' }, async () => ({ users: (await listUsers()).map(pub) }));

export const POST = route({ perm: 'manage' }, async ({ req, user, body }) => {
  const username = String(body?.username || '').trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,32}$/.test(username)) throw new AppError(400, 'ชื่อผู้ใช้ใช้ได้เฉพาะ a-z 0-9 . _ - ความยาว 3–32 ตัว');
  if (!(body.role in ROLES)) throw new AppError(400, 'บทบาทไม่ถูกต้อง');
  const name = String(body.name || '').trim().slice(0, 80);
  if (!name) throw new AppError(400, 'กรุณากรอกชื่อ');
  if (String(body.password || '').length < 8) throw new AppError(400, 'รหัสผ่านต้องยาวอย่างน้อย 8 ตัวอักษร');
  if (await getUserByUsername(username)) throw new AppError(409, 'ชื่อผู้ใช้นี้ถูกใช้แล้ว');
  const u = await createUser({ username, name, role: body.role, perms: body.role === 'admin' ? '' : serializeOverrides(body.overrides), passwordHash: await hashPassword(body.password) });
  audit(req, user, 'user_create', username, body.role);
  return { user: pub(u) };
});
