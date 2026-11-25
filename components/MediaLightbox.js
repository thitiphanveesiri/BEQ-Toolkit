'use client';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { bytes } from '../lib/client.js';
import { slotLabel } from '../lib/fields.js';

const srcOf = (m) => m.url || `/api/media/${m.id}`;
const clamp = (n) => Math.max(1, Math.min(5, n));

export default function MediaLightbox({ items, start, onClose }) {
  const [i, setI] = useState(start), [scale, setScale] = useState(1), [bad, setBad] = useState(false);
  const m = items[i], closeRef = useRef(), panelRef = useRef(), videoRef = useRef(), touch = useRef(null), pinch = useRef(null);
  const move = (d) => { setScale(1); setBad(false); setI((x) => (x + d + items.length) % items.length); };
  const zoom = (d) => setScale((s) => clamp(Math.round((s + d) * 100) / 100));
  useEffect(() => {
    const trigger = document.activeElement;
    closeRef.current?.focus();
    const prev = document.body.style.overflow; document.body.style.overflow = 'hidden';
    const k = (e) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'Tab') {
        const nodes = [closeRef.current, ...Array.from(panelRef.current?.querySelectorAll('button:not(:disabled),a[href],video[controls]') || [])].filter(Boolean);
        if (!nodes.length) return;
        const first = nodes[0], last = nodes[nodes.length - 1];
        if (!nodes.includes(document.activeElement)) { e.preventDefault(); first.focus(); }
        else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      } else if (['VIDEO', 'INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
      else if (e.key === 'ArrowRight') move(1);
      else if (e.key === 'ArrowLeft') move(-1);
      else if (e.key === '+' || e.key === '=') zoom(0.25);
      else if (e.key === '-') zoom(-0.25);
      else if (e.key === '0') setScale(1);
    };
    window.addEventListener('keydown', k);
    return () => { window.removeEventListener('keydown', k); document.body.style.overflow = prev; trigger?.focus?.(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setScale(1); setBad(false); }, [i]);
  const ts = (e) => {
    if (e.touches.length === 2) {
      const [a, b] = [e.touches[0], e.touches[1]];
      pinch.current = { d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), s: scale };
    } else touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  };
  const tm = (e) => {
    if (e.touches.length !== 2 || !pinch.current || m.kind !== 'image') return;
    const [a, b] = [e.touches[0], e.touches[1]], d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    if (pinch.current.d > 0) setScale(clamp(Math.round(pinch.current.s * d / pinch.current.d * 100) / 100));
  };
  const te = (e) => {
    pinch.current = null;
    const s0 = touch.current; touch.current = null;
    if (!s0 || scale > 1 || m.kind !== 'image' || items.length < 2) return;
    const t = e.changedTouches[0], dx = t.clientX - s0.x, dy = t.clientY - s0.y;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) move(dx < 0 ? 1 : -1);
  };
  const fullscreen = () => videoRef.current?.requestFullscreen?.();
  const src = srcOf(m), download = m.url ? m.url : `${src}?download=1`;
  return createPortal(
    <div className="lightbox" role="dialog" aria-modal="true" aria-label={m.kind === 'video' ? 'ดูวิดีโอ' : 'ดูรูปภาพ'} onClick={(e) => e.target === e.currentTarget && onClose()} onTouchStart={ts} onTouchMove={tm} onTouchEnd={te}>
      <button ref={closeRef} className="zoom-close" onClick={onClose} aria-label="ปิด">×</button>
      {items.length > 1 && <button className="lb-nav l" onClick={() => move(-1)} aria-label="ก่อนหน้า">‹</button>}
      <div className="lightbox-panel" ref={panelRef}>
        {bad ? (
          <div className="lb-bad">
            <p>เบราว์เซอร์นี้เปิดไฟล์ชนิดนี้ไม่ได้ ({String(m.name || '').split('.').pop().toUpperCase()})</p>
            <a className="btn" href={download} download={m.url ? m.name : undefined}>ดาวน์โหลดไฟล์ไปเปิดดู</a>
            <p className="mu" style={{ fontSize: 12 }}>ลองเปิดด้วย Safari/Chrome เวอร์ชันล่าสุด หรือแอปเล่นวิดีโอ/รูปในเครื่อง</p>
          </div>
        ) : m.kind === 'video' ? (
          <>
            <video ref={videoRef} src={src} controls autoPlay playsInline preload="metadata" onError={() => setBad(true)}>{m.mime ? <source src={src} type={m.mime} onError={() => setBad(true)} /> : null}</video>
            <div className="lb-tools"><button type="button" onClick={fullscreen}>เต็มจอ</button></div>
          </>
        ) : (
          <>
            <div className={'lightbox-scroll' + (scale > 1 ? ' zoomed' : '')} onWheel={(e) => { e.preventDefault(); zoom(e.deltaY < 0 ? 0.25 : -0.25); }} onDoubleClick={() => setScale((s) => s === 1 ? 2 : 1)}>
              <img src={src} alt={m.name} draggable={false} style={scale > 1 ? { width: `${scale * 100}%`, maxWidth: 'none', maxHeight: 'none' } : undefined} onError={() => setBad(true)} />
            </div>
            <div className="lb-tools" aria-label="เครื่องมือซูม">
              <button type="button" onClick={() => zoom(-0.25)} disabled={scale <= 1} aria-label="ซูมออก">−</button>
              <span>{Math.round(scale * 100)}%</span>
              <button type="button" onClick={() => zoom(0.25)} disabled={scale >= 5} aria-label="ซูมเข้า">＋</button>
              <button type="button" onClick={() => setScale(1)}>คืนขนาด</button>
            </div>
          </>
        )}
        <div className="lightbox-caption">{i + 1}/{items.length} · {slotLabel(m.slot, m.kind) ? slotLabel(m.slot, m.kind) + ' · ' : ''}{m.name} · {bytes(Number(m.size) || 0)} · <a href={download} download={m.url ? m.name : undefined} style={{ color: '#9be7c8' }}>ดาวน์โหลด</a>{m.drive && <> · <a href={m.drive} target="_blank" rel="noopener noreferrer" style={{ color: '#9be7c8' }}>เปิดใน Drive</a></>}</div>
        <div className="lb-hint">{m.kind === 'image' ? 'ใช้ปุ่ม +/−, เลื่อนเมาส์ หรือแตะสองนิ้วเพื่อซูม · ดับเบิลคลิกเพื่อสลับขนาด' : 'ใช้ปุ่มควบคุมของวิดีโอหรือกดเต็มจอ'}{items.length > 1 && ' · ปัดซ้าย/ขวาเพื่อเลื่อนสื่อ'}</div>
        {items.length > 1 && (
          <div className="lb-strip" role="group" aria-label="สื่อทั้งหมดในกลุ่ม">
            {items.map((x, j) => <button key={x.id || x.url} type="button" aria-current={j === i} aria-label={`สื่อที่ ${j + 1}`} onClick={() => { setScale(1); setBad(false); setI(j); }}>{x.kind === 'image' ? <img src={x.url || `/api/media/${x.id}?thumb=1`} alt="" loading="lazy" /> : <span style={{ color: '#fff' }}>▶</span>}</button>)}
          </div>
        )}
      </div>
      {items.length > 1 && <button className="lb-nav r" onClick={() => move(1)} aria-label="ถัดไป">›</button>}
    </div>,
    document.body
  );
}
