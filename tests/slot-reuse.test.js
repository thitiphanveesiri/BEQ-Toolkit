import test from 'node:test';
import assert from 'node:assert/strict';
import { occupiedMediaCount, planSingleSlot, slotOccupants } from '../lib/media.js';

const now = Date.parse('2026-11-26T10:00:00Z');
const base = { recordId: 'R-1', group: 'single', kind: 'image', slot: 'a1-1', mime: 'image/jpeg', size: '2400000', uploadedBy: 'U-1' };
const row = (o) => ({ id: 'M-' + Math.random().toString(36).slice(2, 10), status: 'ready', reservedAt: '', ...base, ...o });
const target = { ...base, id: 'M-new0001' };
const me = { userId: 'U-1', size: 2400000, mime: 'image/jpeg' };

test('ช่องว่าง: ไม่มีผู้ครอบครอง', () => {
  assert.deepEqual(slotOccupants([row({ slot: 'other' })], target, now), []);
  assert.equal(occupiedMediaCount([row({ status: 'cancelled' })], target, now), 0);
});

test('เลือกรูปเดิมซ้ำหลังรีเฟรช (บันทึกแล้ว ไฟล์เดียวกัน) -> reuse ไม่ error', () => {
  const ready = row({});
  assert.equal(planSingleSlot(slotOccupants([ready], target, now), me).action, 'reuse');
});

test('ช่องมีรูปอื่น (ขนาดต่างกัน หรือคนอื่นอัปโหลด) -> reject ไม่ทับรูปเดิม', () => {
  const ready = row({});
  assert.equal(planSingleSlot([ready], { ...me, size: 999 }).action, 'reject');
  assert.equal(planSingleSlot([ready], { ...me, userId: 'U-2' }).action, 'reject');
  assert.equal(planSingleSlot([ready], { ...me, mime: 'image/png' }).action, 'reject');
});

test('การจองค้างของตัวเอง (รหัสไฟล์เปลี่ยนหลังรีเฟรช) -> takeover ไม่ต้องรอ 24 ชม.', () => {
  const stale = row({ status: 'uploading', reservedAt: new Date(now - 3600000).toISOString() });
  const occ = slotOccupants([stale], target, now);
  assert.equal(occ.length, 1);
  const plan = planSingleSlot(occ, me);
  assert.equal(plan.action, 'takeover');
  assert.deepEqual(plan.stale, [stale]);
  assert.deepEqual(plan.same, [stale]);                           // ไฟล์เดียวกัน -> ถ้าบน Drive ครบ จะบันทึกให้เลย
  assert.deepEqual(planSingleSlot(occ, { ...me, size: 5 }).same, []); // คนละไฟล์ -> ยกเลิกของเก่าแล้วส่งใหม่
});

test('อีกคนกำลังอัปโหลดช่องนี้อยู่ -> reject (busy)', () => {
  const theirs = row({ status: 'uploading', uploadedBy: 'U-2', reservedAt: new Date(now - 1000).toISOString() });
  const plan = planSingleSlot(slotOccupants([theirs], target, now), me);
  assert.equal(plan.action, 'reject'); assert.equal(plan.busy, true);
});

test('การจองที่หมดอายุแล้วไม่ครอบครองช่อง', () => {
  const old = row({ status: 'uploading', reservedAt: new Date(now - 30 * 3600000).toISOString() });
  assert.deepEqual(slotOccupants([old], target, now), []);
});
