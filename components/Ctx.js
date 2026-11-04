'use client';
import { createContext, useCallback, useContext, useRef, useState } from 'react';

export const MeCtx = createContext(null);
export const useMe = () => useContext(MeCtx);

const ToastCtx = createContext(() => {});
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }) {
  const [msg, setMsg] = useState('');
  const t = useRef();
  const show = useCallback((m) => { setMsg(m); clearTimeout(t.current); t.current = setTimeout(() => setMsg(''), 3200); }, []);
  return <ToastCtx.Provider value={show}>{children}{msg && <div id="toast" role="status" aria-live="polite">{msg}</div>}</ToastCtx.Provider>;
}

export function Spinner({ text = 'กำลังโหลด...' }) { return <div className="empty"><span className="spin" /> {text}</div>; }
export function Denied() { return <div className="card empty">🔒 บัญชีนี้ไม่มีสิทธิ์ใช้งานหน้านี้</div>; }
