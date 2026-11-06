import { parseOverrides, parseTeams } from './roles.js';
// ข้อมูลผู้ใช้ที่ส่งออกสู่ client (ตัด hash รหัสผ่านและเลขแถวภายในออก)
export const pub = ({ passwordHash, _row, ...u }) => ({ ...u, active: u.active === 'TRUE', perms: u.perms || '', title: u.title || '', overrides: parseOverrides(u.perms), teams: parseTeams(u.perms) });
