import { route, audit } from '../../../../lib/api.js';
import { listUsers, updateUser } from '../../../../lib/db.js';
import { hashPassword } from '../../../../lib/auth.js';
import { ROLES, serializePerms, parseOverrides, parseTeams, cleanTitle } from '../../../../lib/roles.js';
import { AppError } from '../../../../lib/errors.js';
import { pub } from '../../../../lib/userview.js';

export const PATCH = route({ perm: 'manage' }, async ({ req, user, params, body }) => {
  const users = await listUsers();
  const u = users.find((x) => x.id === params.id);
  if (!u || u.active === 'DELETED') throw new AppError(404, 'ไม่พบผู้ใช้');
  const next = { ...u };
  if (body.username !== undefined) { // เปลี่ยน Username (ชื่อที่ใช้ล็อกอิน) — ข้อมูลที่เคยกรอก/ประวัติไม่ได้ผูกกับ Username จึงไม่กระทบ
    const nu = String(body.username).trim().toLowerCase();
    if (!/^[a-z0-9._-]{3,32}$/.test(nu)) throw new AppError(400, 'ชื่อผู้ใช้ใช้ได้เฉพาะ a-z 0-9 . _ - ความยาว 3–32 ตัว');
    if (users.some((x) => x.id !== u.id && x.username.toLowerCase() === nu)) throw new AppError(409, 'ชื่อผู้ใช้นี้ถูกใช้แล้ว');
    next.username = nu;
  }
  if (body.name !== undefined) { next.name = String(body.name).trim().slice(0, 80); if (!next.name) throw new AppError(400, 'กรุณากรอกชื่อ'); }
  if (body.role !== undefined) { if (!(body.role in ROLES)) throw new AppError(400, 'บทบาทไม่ถูกต้อง'); next.role = body.role; }
  if (body.title !== undefined) next.title = cleanTitle(body.title);
  if (body.overrides !== undefined || body.teams !== undefined || next.role === 'admin') next.perms = serializePerms(body.overrides ?? parseOverrides(u.perms), body.teams ?? parseTeams(u.perms), next.role);
  if (body.active !== undefined) next.active = body.active ? 'TRUE' : 'FALSE';
  if (body.password) { if (String(body.password).length < 8) throw new AppError(400, 'รหัสผ่านต้องยาวอย่างน้อย 8 ตัวอักษร'); next.passwordHash = await hashPassword(body.password); }
  // กันล็อกตัวเองออก และต้องเหลือแอดมินที่ใช้งานได้อย่างน้อย 1 คน
  const admins = users.filter((x) => x.id !== u.id && x.role === 'admin' && x.active === 'TRUE').length;
  if (next.id === user.id && (next.role !== 'admin' || next.active !== 'TRUE')) throw new AppError(400, 'ไม่สามารถปิดหรือลดสิทธิ์บัญชีของตัวเองได้');
  if (admins === 0 && (next.role !== 'admin' || next.active !== 'TRUE')) throw new AppError(400, 'ต้องมีผู้ดูแลระบบที่ใช้งานได้อย่างน้อย 1 คน');
  await updateUser(next);
  audit(req, user, 'user_update', u.username + (next.username !== u.username ? ' → ' + next.username : ''), [body.role && 'role', body.active !== undefined && 'active', (body.overrides !== undefined || body.teams !== undefined) && 'perms', body.password && 'password', body.name && 'name'].filter(Boolean).join(','));
  return { user: pub(next) };
});

// ลบผู้ใช้: ถอนสิทธิ์และถอดชื่อออกจากทุกรายการทันที (ล็อกอินไม่ได้ ไม่ขึ้นในรายการเลือก) แต่เก็บแถวไว้ในชีตแบบถูกปิดสถานะ
// เพื่อให้ประวัติ "ผู้กรอก" ของเคสเก่ายังอ้างอิงได้ และไม่ทำให้ลำดับแถวในชีตเลื่อน — ใช้ Username เดิมสร้างบัญชีใหม่ได้
export const DELETE = route({ perm: 'manage' }, async ({ req, user, params }) => {
  const users = await listUsers();
  const u = users.find((x) => x.id === params.id);
  if (!u || u.active === 'DELETED') throw new AppError(404, 'ไม่พบผู้ใช้');
  if (u.id === user.id) throw new AppError(400, 'ไม่สามารถลบบัญชีของตัวเองได้');
  if (u.role === 'admin' && u.active === 'TRUE' && !users.some((x) => x.id !== u.id && x.role === 'admin' && x.active === 'TRUE')) throw new AppError(400, 'ต้องเหลือผู้ดูแลระบบที่ใช้งานได้อย่างน้อย 1 คน');
  await updateUser({ ...u, active: 'DELETED', username: `deleted_${u.id}`, passwordHash: '', perms: '' });
  audit(req, user, 'user_delete', u.username, u.role);
  return { ok: true };
});
