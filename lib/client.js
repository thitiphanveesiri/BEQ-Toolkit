// ตัวช่วยฝั่ง browser
import { useCallback, useEffect, useRef, useState } from 'react';

export async function api(url, opt = {}) {
  const r = await fetch(url, { credentials: 'same-origin', ...opt, headers: opt.body ? { 'Content-Type': 'application/json' } : undefined, body: opt.body ? JSON.stringify(opt.body) : undefined });
  let j = null; try { j = await r.json(); } catch {}
  if (!r.ok) {
    if (r.status === 401 && !url.includes('/auth/')) { location.href = '/login'; }
    throw Object.assign(new Error(j?.error || 'เกิดข้อผิดพลาด กรุณาลองใหม่'), { status: r.status });
  }
  return j;
}

// โหลดข้อมูลแบบ stale-while-revalidate: แสดงข้อมูลเก่าจาก cache ทันที แล้วค่อยรีเฟรชเบื้องหลัง (ลดความรู้สึกหน่วง)
const cache = new Map();
export function useApi(url) {
  const [state, set] = useState(() => ({ data: url ? cache.get(url) : undefined, error: null, loading: !!url && !cache.has(url) }));
  const seq = useRef(0);
  const load = useCallback(async () => {
    if (!url) return;
    const n = ++seq.current;
    try { const d = await api(url); cache.set(url, d); if (n === seq.current) set({ data: d, error: null, loading: false }); }
    catch (e) { if (n === seq.current) set((s) => ({ ...s, error: e.message, loading: false })); }
  }, [url]);
  useEffect(() => { set({ data: url ? cache.get(url) : undefined, error: null, loading: !!url && !cache.has(url) }); load(); }, [url, load]);
  return { ...state, reload: load, mutate: (d) => { cache.set(url, d); set((s) => ({ ...s, data: d })); } };
}
export const clearApiCache = () => cache.clear();

export const D = (d) => (d ? new Date(d + (d.length === 10 ? 'T00:00:00' : '')).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' }) : '-');
export const monthLabel = (m) => new Date(m + '-01T00:00:00').toLocaleDateString('th-TH', { month: 'short', year: '2-digit' });
export const today = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
export const bytes = (n) => (n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');
