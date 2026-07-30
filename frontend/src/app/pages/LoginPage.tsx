/**
 * LoginPage — พอร์ตจาก figma/handoff/components/LoginScreen.tsx
 *
 * ── ต่างจากดีไซน์ ──────────────────────────────────────────────────────────
 * 1. ต้นฉบับใส่ defaultValue="admin" / "123456789" ไว้ในช่องกรอก — ตัดออก
 *    ห้ามฝังรหัสผ่านตัวอย่างในหน้า login ของระบบจริง (ทั้งชี้นำและเสี่ยงถูก commit ต่อ)
 * 2. ต้นฉบับมี "จำฉันไว้" + "ลืมรหัสผ่าน" — ตัดออกทั้งคู่
 *    remember: JWT อายุ 12 ชม.อยู่แล้วและเก็บใน localStorage ซึ่งอยู่ข้าม session
 *              checkbox ที่ไม่ได้ต่อกับอะไรจะหลอกผู้ใช้
 *    forgot:   ไม่มี flow กู้รหัสผ่าน (รหัสเป็น bcrypt hash ใน .env ของเครื่อง)
 *              ต้อง SSH เข้า Pi ไปรัน scripts/hash_password.py
 * 3. เพิ่มปุ่มดู/ซ่อนรหัสผ่าน + แสดง error จาก API (401 vs error อื่น) ตามของเดิมที่มีอยู่
 * 4. เพิ่มปุ่มสลับธีมข้างปุ่มภาษา — ต้นฉบับมีแต่ภาษา แต่หน้า login ต้องสลับธีมได้ด้วย
 *    ไม่งั้นคนที่เปิดครั้งแรกบนเครื่องธีมสว่างจะเปลี่ยนไม่ได้จนกว่าจะ login เข้าไป
 */
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { AlertTriangle, Eye, EyeOff, Moon, RefreshCw, Sun } from 'lucide-react';

import { login } from '../api/auth';
import { ApiError, setToken } from '../api/client';
import { Btn, inputCls } from '../components/primitives';
import { useApp } from '../context/AppContext';

export function LoginPage() {
  const { T, dark, toggleDark, lang, toggleLang } = useApp();
  const navigate = useNavigate();
  const [user, setUser] = useState('');
  const [pass, setPass] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!user || !pass) {
      setErr(T.login_error);
      return;
    }
    setErr('');
    setLoading(true);
    try {
      const res = await login(user, pass);
      setToken(res.access_token);
      navigate('/overview', { replace: true });
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setErr(T.login_invalid);
      else setErr(T.error_generic);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="grid min-h-screen place-items-center bg-bg bg-[radial-gradient(120%_90%_at_50%_-10%,rgb(var(--surface-2)),rgb(var(--bg)))] p-6">
      <div className="flex w-full max-w-[380px] flex-col gap-6">
        <div className="flex items-center gap-2.5">
          <span className="grid size-9 place-items-center rounded-xl bg-brand font-mono text-caption font-bold text-brand-ink">
            4G
          </span>
          <div className="min-w-0">
            <p className="text-lead leading-[1.45] font-bold">{T.app_name}</p>
            <p className="font-mono text-micro text-ink-2">{T.login_sub}</p>
          </div>
        </div>

        <form
          onSubmit={submit}
          className="flex flex-col gap-3.5 rounded-card border border-line bg-surface p-6 shadow-card"
        >
          <h1 className="text-lead font-semibold">{T.login_submit}</h1>

          {err ? (
            <div className="flex items-start gap-2 rounded-control border border-bad bg-bad-soft px-3 py-2.5">
              <AlertTriangle size={14} className="mt-0.5 shrink-0 text-bad" />
              <p className="text-caption leading-[1.7] text-bad">{err}</p>
            </div>
          ) : null}

          <label className="flex flex-col gap-1.5">
            <span className="text-caption text-ink-2">{T.login_username}</span>
            <input
              className={`${inputCls} font-mono`}
              value={user}
              onChange={(e) => setUser(e.target.value)}
              autoComplete="username"
              autoFocus
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-caption text-ink-2">{T.login_password}</span>
            <span className="relative flex">
              <input
                className={`${inputCls} pe-10 font-mono`}
                type={showPass ? 'text' : 'password'}
                value={pass}
                onChange={(e) => setPass(e.target.value)}
                autoComplete="current-password"
              />
              <button
                type="button"
                onClick={() => setShowPass((v) => !v)}
                className="absolute end-3 top-1/2 -translate-y-1/2 text-ink-2 hover:text-ink"
                aria-label="toggle password visibility"
              >
                {showPass ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </span>
          </label>

          <Btn variant="primary" type="submit" className="mt-1 w-full py-3.5 text-body" disabled={loading}>
            {loading ? <RefreshCw size={14} className="animate-spin" /> : null}
            {T.login_submit}
          </Btn>
        </form>

        <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-micro text-ink-2">
          <span>{T.app_version}</span>
          <span className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={toggleLang}
              className="rounded-full border border-line bg-surface px-2.5 py-1"
            >
              {lang === 'th' ? 'EN' : 'ไทย'}
            </button>
            <button
              type="button"
              onClick={toggleDark}
              className="grid place-items-center rounded-full border border-line bg-surface px-2.5 py-1"
              aria-label="theme"
            >
              {dark ? <Sun size={13} /> : <Moon size={13} />}
            </button>
          </span>
        </div>
      </div>
    </div>
  );
}
