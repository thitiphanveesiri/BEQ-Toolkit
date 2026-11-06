'use client';
import { useState } from 'react';

// ช่องรหัสผ่านพร้อมปุ่มแสดง/ซ่อน: ตรวจได้ว่าพิมพ์ตัวใหญ่/ตัวเล็กถูกต้อง และปิดการแก้คำ/ตัวพิมพ์ใหญ่อัตโนมัติของคีย์บอร์ดมือถือ/iPad
// (รหัสผ่านถูกเก็บและตรวจแบบแยกตัวพิมพ์ใหญ่-เล็กตามที่พิมพ์จริง ระบบไม่แปลงตัวอักษร)
export default function PasswordInput({ id, value, onChange, autoComplete, required, minLength }) {
  const [show, setShow] = useState(false);
  return (
    <div className="pwbox">
      <input id={id} type={show ? 'text' : 'password'} value={value} onChange={onChange} autoComplete={autoComplete} required={required} minLength={minLength}
        autoCapitalize="off" autoCorrect="off" spellCheck={false} />
      <button type="button" className="pweye" onClick={() => setShow((s) => !s)} aria-label={show ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน'} aria-pressed={show}>{show ? '🙈' : '👁️'}</button>
    </div>
  );
}
