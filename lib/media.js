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

export function occupiedMediaCount(all, candidate, now = Date.now()) {
  return all.filter((m) =>
    m.id !== candidate.id &&
    m.recordId === candidate.recordId &&
    m.group === candidate.group &&
    m.kind === candidate.kind &&
    (candidate.kind === 'video' || (m.slot || '') === (candidate.slot || '')) &&
    (m.status === 'ready' || activeReservation(m, now))
  ).length;
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
