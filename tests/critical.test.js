import test from 'node:test';
import assert from 'node:assert/strict';
import { resumableUpload } from '../lib/resumableUpload.js';
import { activeReservation, occupiedMediaCount, sameTarget, withMediaLock } from '../lib/media.js';
import { assignedFollowups, autofill, cellIdFromUsers, recordRequestHash, requestIdOf } from '../lib/records.js';
import { can, canFill } from '../lib/roles.js';

class FakeXMLHttpRequest {
  constructor() {
    this.upload = {};
    this.requestHeaders = {};
    this.status = 0;
    this.requests = [];
  }
  open(method, url) { this.method = method; this.url = url; }
  setRequestHeader(name, value) { this.requestHeaders[name] = value; }
  getResponseHeader(name) { return name.toLowerCase() === 'range' && this.status === 308 ? this.range : null; }
  send(body) {
    const range = this.requestHeaders['Content-Range'];
    const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(range);
    if (!match) throw new Error('invalid test range');
    const start = Number(match[1]), end = Number(match[2]), total = Number(match[3]);
    assert.equal(body.size, end - start + 1);
    this.requests.push({ start, end, total });
    this.status = end === total - 1 ? 200 : 308;
    this.range = `bytes=0-${end}`;
    queueMicrotask(() => this.onload());
  }
}

test('BT and sales can fill both form types without broader history access', () => {
  assert.equal(canFill('bt', 'day0'), true);
  assert.equal(canFill('bt', 'case'), true);
  assert.equal(canFill('sales', 'day0'), true);
  assert.equal(canFill('sales', 'case'), true);
  assert.equal(can('bt', 'viewFollowups'), false);
  assert.equal(can('sales', 'viewDay0'), false);
  assert.equal(can('sales', 'upload'), false);
});

test('resumable upload sends every chunk of a file larger than 32 MiB', async () => {
  const original = globalThis.XMLHttpRequest;
  const xhrs = [];
  globalThis.XMLHttpRequest = class extends FakeXMLHttpRequest {
    constructor() { super(); xhrs.push(this); }
  };
  try {
    const file = new File([new Uint8Array(36 * 1024 * 1024 + 123)], 'large.mp4', { type: 'video/mp4' });
    const offsets = [];
    await resumableUpload({ url: 'https://upload.test/session', file, onOffset: (offset) => offsets.push(offset) });
    assert.equal(xhrs.length, 10);
    assert.deepEqual(xhrs.map((x) => x.requests[0].start), Array.from({ length: 10 }, (_, i) => i * 4 * 1024 * 1024));
    assert.equal(offsets.at(-1), file.size);
    assert.equal(xhrs.at(-1).status, 200);
  } finally {
    globalThis.XMLHttpRequest = original;
  }
});

test('media lock serializes tasks and continues after a rejected task', async () => {
  const previous = globalThis.__beqMediaOps;
  globalThis.__beqMediaOps = Promise.resolve();
  try {
    let active = 0, maximum = 0;
    const order = [];
    const tasks = Array.from({ length: 5 }, (_, i) => withMediaLock(async () => {
      active++; maximum = Math.max(maximum, active); order.push(`start-${i}`);
      await new Promise((resolve) => setTimeout(resolve, 5));
      order.push(`end-${i}`); active--;
    }));
    await Promise.all(tasks);
    assert.equal(maximum, 1);
    assert.deepEqual(order, ['start-0', 'end-0', 'start-1', 'end-1', 'start-2', 'end-2', 'start-3', 'end-3', 'start-4', 'end-4']);
    await assert.rejects(withMediaLock(async () => { throw new Error('expected'); }), /expected/);
    assert.equal(await withMediaLock(async () => 42), 42);
  } finally {
    globalThis.__beqMediaOps = previous;
  }
});

test('an expired completed reservation cannot overfill an occupied media slot', () => {
  const now = Date.parse('2026-11-25T12:00:00.000Z');
  const ready = { id: 'M-ready', recordId: 'R-1', group: 'single', kind: 'image', slot: 'front-0', status: 'ready' };
  const expired = { id: 'M-expired', recordId: 'R-1', group: 'single', kind: 'image', slot: 'front-0', status: 'uploading', reservedAt: '2026-11-23T12:00:00.000Z' };
  const candidate = { id: expired.id, recordId: 'R-1', group: 'single', kind: 'image', slot: 'front-0' };
  assert.equal(activeReservation(expired, now), false);
  assert.equal(occupiedMediaCount([ready, expired], candidate, now), 1);
  assert.equal(occupiedMediaCount([expired], candidate, now), 0);
});

test('legacy and current video slots share the same capacity and identity', () => {
  const legacy = { id: 'M-legacy-video', recordId: 'R-1', group: 'single', kind: 'video', slot: 'video', mime: 'video/mp4', size: '10', status: 'ready' };
  const current = { id: legacy.id, recordId: 'R-1', group: 'single', kind: 'video', slot: '', mime: 'video/mp4', size: '10' };
  assert.equal(occupiedMediaCount([legacy], { ...current, id: 'M-new-video' }), 1);
  assert.equal(sameTarget(legacy, current), true);
});

test('sales follow-ups use immutable IDs and reject ambiguous legacy names', async () => {
  const previous = globalThis.__beqDb;
  const row = (id, formType, opd, date, extra = {}) => ({ id, formType, opd, date, createdAt: date + 'T00:00:00.000Z', ...extra });
  globalThis.__beqDb = {
    async load() {
      return {
        Users: [
          { id: 'U-sales-1', name: 'เซลล์ A', role: 'sales', active: 'TRUE', perms: '' },
          { id: 'U-sales-2', name: 'เซลล์ A', role: 'sales', active: 'TRUE', perms: '' },
          { id: 'U-other', name: 'เซลล์ B', role: 'sales', active: 'TRUE', perms: '' },
        ],
        Records: [
          row('R-legacy-day0', 'day0', 'HN-00000-0-000001', '2026-01-01', { cell: 'เซลล์ A' }),
          row('R-legacy-fu', 'case', 'HN-00000-0-000001', '2026-02-01', { cell: 'เซลล์ A' }),
          row('R-id-day0', 'day0', 'HN-00000-0-000002', '2026-01-02', { cell: 'ชื่อใหม่', cellId: 'U-sales-1' }),
          row('R-id-fu', 'case', 'HN-00000-0-000002', '2026-02-02', { cell: 'ชื่อใหม่', cellId: 'U-sales-1' }),
          row('R-other-day0', 'day0', 'HN-00000-0-000003', '2026-01-03', { cell: 'เซลล์ B', cellId: 'U-other' }),
          row('R-other-fu', 'case', 'HN-00000-0-000003', '2026-02-03', { cell: 'เซลล์ B', cellId: 'U-other' }),
        ],
      };
    },
  };
  try {
    const rows = await assignedFollowups({ id: 'U-sales-1', name: 'ชื่อที่เปลี่ยนแล้ว' });
    assert.deepEqual(rows.map((r) => r.id), ['R-id-fu']);
    assert.equal(rows[0].cellId, undefined);
    assert.equal(rows[0].requestId, undefined);
    const history = await autofill('HN-00000-0-000002');
    assert.equal(history.day0[0].cellId, undefined);
    assert.equal(history.day0[0].requestId, undefined);
    assert.equal(cellIdFromUsers([{ id: 'U-sales-1', name: 'เซลล์ A', role: 'sales', active: 'TRUE', perms: '' }], 'เซลล์ A'), 'U-sales-1');
  } finally {
    globalThis.__beqDb = previous;
  }
});

test('record request identity is validated and hashed by content, not key order', () => {
  const id = 'C-0123456789abcdef0123456789abcdef';
  assert.equal(requestIdOf(id), id);
  assert.throws(() => requestIdOf('bad'), /รหัสคำขอ/);
  assert.equal(recordRequestHash({ opd: 'HN-1', date: '2026-01-01' }), recordRequestHash({ date: '2026-01-01', opd: 'HN-1' }));
  assert.notEqual(recordRequestHash({ opd: 'HN-1' }), recordRequestHash({ opd: 'HN-2' }));
});
