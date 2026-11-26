import { AppError } from './errors.js';

export const MEDIA_ID_RE = /^M-[a-z0-9]{6,40}$/;
export const mediaIdOf = (v) => {
  const id = String(v || '');
  if (!MEDIA_ID_RE.test(id)) throw new AppError(400, 'รหัสไฟล์ไม่ถูกต้อง');
  return id;
};

const reservationTtl = () => {
  const hours = Number(process.env.MEDIA_RESERVATION_HOURS || 24);
  return (Number.isFinite(hours) && hours > 0 ? hours : 24) * 3600000;
};
export const activeReservation = (m, now = Date.now()) => m?.status === 'uploading' && Date.parse(m.reservedAt) > 0 && now - Date.parse(m.reservedAt) <= reservationTtl();

// รายการไฟล์ที่ "ครอบครองช่อง" เดียวกับ candidate อยู่ (บันทึกแล้ว หรือจองไว้และยังไม่หมดอายุ) ไม่นับ candidate เอง
export function slotOccupants(all, candidate, now = Date.now()) {
  return all.filter((m) =>
    m.id !== candidate.id &&
    m.recordId === candidate.recordId &&
    m.group === candidate.group &&
    m.kind === candidate.kind &&
    (candidate.kind === 'video' || (m.slot || '') === (candidate.slot || '')) &&
    (m.status === 'ready' || activeReservation(m, now))
  );
}
export const occupiedMediaCount = (all, candidate, now = Date.now()) => slotOccupants(all, candidate, now).length;

// ช่องมุมถ่าย (รับได้ 1 รูป) ถูกครอบครองอยู่เมื่อมีไฟล์ใหม่เข้ามา — ตัดสินว่าควรทำอะไร (ไม่มี side effect ฝั่ง server เรียกใช้เองตามผล)
//  reuse    : รูปที่บันทึกแล้วเป็นไฟล์เดียวกัน (ผู้อัปโหลด ชนิด และขนาดตรงกัน) เช่น เลือกรูปเดิมซ้ำหลังรีเฟรช -> ถือว่าบันทึกแล้ว ไม่ต้องอัปโหลดซ้ำ
//  reject   : ช่องมีรูปอื่นอยู่แล้ว หรืออีกคนกำลังอัปโหลดช่องนี้ -> ไม่ทับ
//  takeover : เหลือแต่การจองที่ค้างของผู้ใช้คนเดียวกัน (เช่น รีเฟรชแล้วรหัสไฟล์เปลี่ยน) -> ยกเลิกของเก่าแล้วใช้ช่องต่อ
export function planSingleSlot(occupants, { userId, size, mime }) {
  const same = (m) => m.uploadedBy === userId && String(m.size) === String(size) && m.mime === mime;
  const ready = occupants.find((m) => m.status === 'ready');
  if (ready) return same(ready) ? { action: 'reuse', media: ready } : { action: 'reject', media: ready };
  const mine = occupants.filter((m) => m.status === 'uploading' && m.uploadedBy === userId);
  const other = occupants.find((m) => !mine.includes(m));
  if (other) return { action: 'reject', media: other, busy: true };
  return { action: 'takeover', stale: mine, same: mine.filter(same) };
}

export const mediaTarget = (rec, group, kind, slot, mime, size) => ({
  recordId: rec.id,
  group,
  kind,
  slot: kind === 'video' ? '' : slot,
  mime,
  size: String(size),
});
export const sameTarget = (m, t) => m.recordId === t.recordId && m.group === t.group && m.kind === t.kind && (t.kind === 'video' || (m.slot || '') === (t.slot || '')) && m.mime === t.mime && String(m.size) === String(t.size);

export function withMediaLock(task) {
  const previous = globalThis.__beqMediaOps || Promise.resolve();
  const run = previous.then(task, task);
  globalThis.__beqMediaOps = run.catch(() => {});
  return run;
}
