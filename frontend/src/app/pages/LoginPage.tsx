/**
 * LoginPage — พอร์ตจาก figma/Redesign Corporate Web App (PageLogin + LoginRightPanel)
 *
 * ── ต่างจากดีไซน์ ──────────────────────────────────────────────────────────
 * 1. ดีไซน์ setTimeout 1.2 วิแล้วเข้าระบบเลย ของเรายิง POST /auth/login จริง
 *    และแยกข้อความ 401 (รหัสผิด) ออกจาก error อื่น (เน็ต/เซิร์ฟเวอร์ล่ม) —
 *    สองอย่างนี้คนละปัญหาและแก้คนละวิธี ถ้าขึ้น "รหัสผ่านไม่ถูกต้อง" ตอนเซิร์ฟเวอร์ล่ม
 *    ผู้ใช้จะนั่งพิมพ์รหัสซ้ำอยู่นั่นแหละ
 * 2. ดีไซน์ hardcode สีแผงขวาเป็น hex (#00bdfe, #44c166, #da9500) ของเราใช้ token
 *    ยกเว้นพื้นหลังไล่สีน้ำเงินเข้มของแผงเอง ซึ่งตั้งใจให้เป็นสีเดียวทั้งสองธีม
 *    (แผงนี้เป็นภาพประกอบ ไม่ใช่ผิวหน้าเว็บ — สลับตามธีมแล้วภาพจะจืดในธีมสว่าง)
 * 3. ดีไซน์เขียน v0.5.0 ตายตัว ของเราอ่านจาก __APP_VERSION__ ที่ vite ดึงจาก
 *    app/main.py ตอน build
 * 4. แผงขวาซ่อนที่จอแคบตามดีไซน์ (hidden md:flex) — บนมือถือเหลือแค่ฟอร์ม
 * 5. ตัด "จำฉันไว้" / "ลืมรหัสผ่าน" ที่ดีไซน์รอบก่อนมี — JWT อายุ 12 ชม.
 *    อยู่ใน localStorage ข้าม session อยู่แล้ว และไม่มี flow กู้รหัสผ่าน
 *    (รหัสเป็น bcrypt hash ใน .env ต้อง SSH เข้า Pi ไปรัน scripts/hash_password.py)
 * 6. ไม่ใส่ defaultValue="admin"/"123456789" แบบไฟล์ดีไซน์ — ห้ามฝังรหัสตัวอย่าง
 *    ในหน้า login ของระบบจริง
 */
import { useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { Check, Cpu, Eye, EyeOff, Moon, Phone, RadioTower, RefreshCw, Sun } from 'lucide-react';

import { cn } from '@/app/components/ui/utils';
import { login } from '../api/auth';
import { ApiError, setToken } from '../api/client';
import { Alert } from '../components/Alert';
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
    <div
      className={cn(
        'grid min-h-screen place-items-center p-4 sm:p-6',
        // ไล่สีจากมุมขวาบน ให้แผงภาพประกอบทางขวาเนียนต่อกับพื้นหลัง ไม่ใช่ลอยเป็นแผ่นเดี่ยว
        dark
          ? 'bg-[radial-gradient(ellipse_at_60%_40%,#071828_0%,rgb(var(--bg))_70%)]'
          : 'bg-[radial-gradient(ellipse_at_60%_40%,#e0f5ff_0%,rgb(var(--bg))_70%)]',
      )}
    >
      <div className="lg-fade-in flex w-full max-w-[860px] overflow-hidden rounded-[20px] shadow-[0_16px_60px_rgba(0,0,0,0.12),0_0_0_1px_rgb(var(--line))] md:min-h-[500px] dark:shadow-[0_24px_80px_rgba(0,0,0,0.7),0_0_0_1px_rgb(var(--line))]">
        {/* ── ซ้าย: ฟอร์ม ── */}
        <div className="flex w-full flex-col justify-center bg-surface px-7 py-10 sm:px-10 md:max-w-[400px] md:shrink-0">
          <div className="mb-8 flex items-center gap-3">
            <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-brand font-mono text-caption font-extrabold text-brand-ink shadow-[0_0_0_5px_rgb(var(--accent-soft))]">
              4G
            </span>
            <div className="min-w-0">
              <p className="text-lead leading-[1.15] font-bold">{T.app_name}</p>
              <p className="font-mono text-micro text-brand-strong">{T.login_sub}</p>
            </div>
          </div>

          <h1 className="text-h2 font-bold">{T.login_submit}</h1>
          <p className="mt-1 mb-6 text-caption text-ink-2">{T.login_welcome}</p>

          <form onSubmit={submit} className="flex flex-col gap-3.5">
            {err ? <Alert tone="bad">{err}</Alert> : null}

            <label className="flex flex-col gap-1.5">
              <span className="text-micro font-medium text-ink-2">{T.login_username}</span>
              <input
                className={`${inputCls} font-mono`}
                value={user}
                onChange={(e) => setUser(e.target.value)}
                autoComplete="username"
                autoFocus
              />
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="text-micro font-medium text-ink-2">{T.login_password}</span>
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

            <Btn variant="primary" type="submit" className="mt-1.5 w-full py-3.5 text-body" disabled={loading}>
              {loading ? <RefreshCw size={14} className="animate-spin" /> : null}
              {T.login_submit}
            </Btn>
          </form>

          {/* เวอร์ชัน + ปุ่มภาษา/ธีม อยู่ในการ์ดตามดีไซน์ (เดิมลอยอยู่ใต้การ์ด)
              ตรึงขนาดปุ่มไว้ 38×30 กับ 30×30 — ถ้าปล่อยให้ยืดตามเนื้อหา ปุ่มภาษาจะกว้าง
              ไม่เท่ากันระหว่าง "EN" กับ "TH" และสูงไม่เท่าปุ่มธีมที่วัดจากไอคอน */}
          <div className="mt-7 flex items-center gap-2.5 border-t border-line pt-4 font-mono text-micro text-ink-2">
            <span className="flex-1">{T.app_version(__APP_VERSION__)}</span>
            <button
              type="button"
              onClick={toggleLang}
              className="flex h-[30px] w-[38px] items-center justify-center gap-1 rounded-control border border-line bg-surface-2 tracking-[0.06em] transition-colors hover:border-brand-strong"
              aria-label={lang === 'th' ? 'Switch to English' : 'เปลี่ยนเป็นภาษาไทย'}
              title={lang === 'th' ? 'Switch to English' : 'เปลี่ยนเป็นภาษาไทย'}
            >
              {lang === 'th' ? 'EN' : 'TH'}
            </button>
            <button
              type="button"
              onClick={toggleDark}
              className="grid size-[30px] place-items-center rounded-control border border-line bg-surface-2 transition-colors hover:border-brand-strong"
              aria-label="theme"
            >
              {dark ? <Sun size={13} /> : <Moon size={13} />}
            </button>
          </div>
        </div>

        {/* ── ขวา: ภาพประกอบ (ซ่อนที่จอแคบ — บีบแล้วของทับกันจนอ่านไม่ออก) ── */}
        <div className="hidden flex-1 md:block">
          <LoginArtPanel />
        </div>
      </div>
    </div>
  );
}

/** ความสูงสัมพัทธ์ของแถบคลื่นเสียงใต้ป้าย 4G — คงที่ ไม่ได้อ่านจากอะไรจริง */
const WAVE_BARS = [0.35, 0.55, 0.9, 1.0, 0.7, 0.5, 0.8, 0.6, 0.4];

/**
 * แผงภาพประกอบทางขวา — ตกแต่งล้วน ไม่มีค่าไหนมาจากระบบจริง
 *
 * เขียนไว้ตรงนี้ให้ชัด: การ์ด 4 ใบ ("เชื่อมต่อสำเร็จ" / "กำลังโทร…" ฯลฯ) เป็นข้อความ
 * ตายตัวที่วนแอนิเมชันอยู่ ไม่ใช่สถานะของเกตเวย์ — ตอนอยู่หน้านี้ยังไม่มี token
 * จึงเรียก API ไม่ได้เลยแม้แต่ตัวเดียว ถ้าวันหลังอยากให้มันเป็นของจริงต้องเปิด
 * endpoint สาธารณะก่อน ซึ่งเท่ากับเปิดเผยสถานะระบบให้คนที่ยังไม่ login เห็น
 */
function LoginArtPanel() {
  const { T } = useApp();

  /**
   * ไอคอนอยู่ในแผ่นเรืองแสงของตัวเอง ไม่ใช่ไอคอนจิ๋วแทรกในชิป
   *
   * ของเดิมไอคอนขนาด 14px วางเบียดอยู่ระหว่างจุดกะพริบกับข้อความ เล็กจนแทบแยกไม่ออก
   * ว่าเป็นรูปอะไร — บนแผงที่มืดและมีของขยับหลายชั้นยิ่งมองไม่เห็น
   * แยกออกมาเป็นแผ่น 38px มีขอบและแสงเรืองสีเดียวกับสถานะ ไอคอนจึงอ่านออกจริง
   * และได้เป็นจุดสีกระจายรอบวงแหวนแทนที่จะกองอยู่แค่บนกับล่าง
   *
   * วางเป็น 4 มุมด้วย absolute — วงแหวนกลางกว้าง 200px อยู่กึ่งกลาง มุมทั้งสี่จึงไม่ทับกัน
   */
  const cards: { tone: string; icon: ReactNode; label: string; delay: string; pos: string }[] = [
    {
      tone: '--art-ok',
      icon: <Check size={18} />,
      label: T.login_panel_connected,
      delay: '0s',
      pos: 'top-7 left-5',
    },
    {
      tone: '--art-accent',
      icon: <RadioTower size={18} />,
      label: T.login_panel_sent,
      delay: '0.5s',
      pos: 'top-7 right-5',
    },
    {
      tone: '--art-warn',
      icon: <Phone size={18} />,
      label: T.login_panel_dialing,
      delay: '1s',
      pos: 'bottom-28 left-5',
    },
    {
      tone: '--art-accent',
      icon: <Cpu size={18} />,
      label: T.login_panel_signal,
      delay: '1.5s',
      pos: 'bottom-28 right-5',
    },
  ];

  return (
    <div
      // สีชุดนี้ตรึงไว้ทั้งสองธีมโดยตั้งใจ (ดูหมายเหตุข้อ 2 ด้านบน) — ประกาศเป็นตัวแปร
      // ตรงนี้ที่เดียว ลูกๆ ข้างในจึงอ้าง --art-* ได้โดยไม่ต้องพก hex ติดตัวไปทุกจุด
      style={
        {
          '--art-accent': '0 189 254',
          '--art-ok': '68 193 102',
          '--art-warn': '218 149 0',
        } as CSSProperties
      }
      className="relative flex h-full min-h-[500px] flex-col items-center justify-center overflow-hidden bg-[linear-gradient(145deg,#050e1a_0%,#071828_55%,#031020_100%)]"
    >
      {/* พื้นหลังจุดไข่ปลา */}
      <svg className="pointer-events-none absolute inset-0 size-full opacity-[0.07]" aria-hidden>
        <defs>
          <pattern id="lg-grid" width="36" height="36" patternUnits="userSpaceOnUse">
            <circle cx="18" cy="18" r="1" fill="rgb(var(--art-accent))" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#lg-grid)" />
      </svg>

      {/* ── ไอคอนสถานะ 4 มุม ── */}
      {cards.map((c) => (
        <div
          key={c.label}
          className={cn('lg-card absolute z-[4] flex items-center gap-2', c.pos)}
          style={{ animationDelay: c.delay }}
        >
          <span
            className="lg-bob grid size-[38px] shrink-0 place-items-center rounded-xl border"
            style={{
              color: `rgb(var(${c.tone}))`,
              borderColor: `rgb(var(${c.tone}) / 0.4)`,
              backgroundColor: `rgb(var(${c.tone}) / 0.13)`,
              boxShadow: `0 0 20px rgb(var(${c.tone}) / 0.28)`,
              animationDelay: c.delay,
            }}
          >
            {c.icon}
          </span>
          <span className="flex items-center gap-1.5 rounded-[10px] border border-white/10 bg-white/[0.07] px-2.5 py-1.5 whitespace-nowrap backdrop-blur-md">
            <span
              className="lg-blink size-[7px] shrink-0 rounded-full"
              style={{ backgroundColor: `rgb(var(${c.tone}))`, animationDelay: c.delay }}
            />
            <span className="text-micro font-medium text-white/80">{c.label}</span>
          </span>
        </div>
      ))}


      {/* กลาง: วงแหวน + เส้นโค้งสัญญาณ + ป้าย 4G */}
      <div className="relative z-[3] size-[200px] shrink-0">
        {['lg-ring-1', 'lg-ring-2', 'lg-ring-3'].map((cls) => (
          <span
            key={cls}
            className={cn('absolute inset-0 rounded-full border-[1.5px]', cls)}
            style={{ borderColor: 'rgb(var(--art-accent) / 0.55)' }}
          />
        ))}

        <svg className="absolute inset-[6px] size-[188px]" viewBox="0 0 188 188" aria-hidden>
          <path
            d="M20 160 Q94 20 168 160"
            fill="none"
            stroke="rgb(var(--art-accent))"
            strokeWidth="1.5"
            strokeDasharray="5 4"
            className="lg-dash"
          />
          {/* จุดวิ่งตามเส้นโค้ง = "ข้อความเดินทางออกไปทางเสาสัญญาณ" ชุดเดียวกับที่การ์ด
              Signal Flow ใช้ระหว่างโหนด — คนที่เคยเห็นหน้าแรกแล้วจะจำจังหวะนี้ได้ */}
          <circle r="4" fill="rgb(var(--art-accent))" opacity="0.9">
            <animateMotion dur="2s" repeatCount="indefinite" path="M20,160 Q94,20 168,160" />
          </circle>
        </svg>

        <div className="lg-float absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
          <span className="grid size-[72px] place-items-center rounded-[18px] bg-[linear-gradient(135deg,#00bdfe_0%,#005f8a_100%)] font-mono text-[20px] leading-none font-black tracking-[-1px] text-black shadow-[0_0_44px_rgba(0,189,254,0.5),0_0_0_6px_rgba(0,189,254,0.12)]">
            4G
          </span>
        </div>
      </div>


      {/* แถบคลื่นเสียง — คาบไม่เท่ากันรายแถบ (0.7 + i×0.12 วิ) จึงไม่ขยับพร้อมกันเป็นบล็อก */}
      <div className="z-[2] mt-5 flex items-end gap-1">
        {WAVE_BARS.map((h, i) => (
          <span
            key={i}
            className="lg-wave-bar w-[5px] rounded-[3px] opacity-70"
            style={{
              backgroundColor: 'rgb(var(--art-accent))',
              height: `${h * 32}px`,
              animation: `lg-wave ${0.7 + i * 0.12}s ease-in-out ${i * 0.08}s infinite alternate`,
            }}
          />
        ))}
      </div>

      <span className="absolute right-4 bottom-3.5 z-[2] font-mono text-[10px] leading-[1.5] text-white/20">
        {T.app_name} · {__APP_VERSION__}
      </span>
    </div>
  );
}
