/**
 * LoginPage — ฟอร์มเข้าระบบ + แผงภาพประกอบ
 *
 * ── ต่างจากไฟล์ดีไซน์ ─────────────────────────────────────────────────────
 * 1. ดีไซน์ setTimeout 1.2 วิแล้วเข้าระบบเลย ของเรายิง POST /auth/login จริง
 *    และแยกข้อความ 401 (รหัสผิด) ออกจาก error อื่น (เน็ต/เซิร์ฟเวอร์ล่ม) —
 *    สองอย่างนี้คนละปัญหาและแก้คนละวิธี ถ้าขึ้น "รหัสผ่านไม่ถูกต้อง" ตอนเซิร์ฟเวอร์ล่ม
 *    ผู้ใช้จะนั่งพิมพ์รหัสซ้ำอยู่นั่นแหละ
 * 2. ดีไซน์เขียน v0.5.0 ตายตัว ของเราอ่านจาก __APP_VERSION__ ที่ vite ดึงจาก
 *    app/main.py ตอน build
 * 3. แผงขวาซ่อนที่จอแคบ (hidden md:block) — บีบแล้วภาพเสียสัดส่วนจนไม่เหลือความหมาย
 * 4. ไม่ใส่ defaultValue="admin"/"123456789" แบบไฟล์ดีไซน์ — ห้ามฝังรหัสตัวอย่าง
 *    ในหน้า login ของระบบจริง
 *
 * ── ของที่ดีไซน์มีแต่ไม่ได้ทำ เพราะ backend ไม่รองรับ ──────────────────────
 * "เข้าสู่ระบบด้วย Google" / "ลืมรหัสผ่าน?" / "จดจำฉัน" — ทั้งสามอันไม่มีอะไรรองรับ:
 *   Google  = ไม่มี OAuth ในระบบเลย มีแต่ user/password เดียวใน .env
 *   ลืมรหัส  = ไม่มี flow กู้รหัส (รหัสเป็น bcrypt hash ใน .env ต้อง SSH เข้า Pi
 *              ไปรัน scripts/hash_password.py) ปุ่มนี้จึงกดแล้วไม่มีอะไรเกิดขึ้นได้เลย
 *   จดจำฉัน  = JWT อายุ 12 ชม. อยู่ใน localStorage ข้ามการปิดเบราว์เซอร์อยู่แล้ว
 *              ติ๊กหรือไม่ติ๊กก็ได้ผลเหมือนกัน = สวิตช์ที่ไม่ได้ต่อกับอะไร
 * ไม่ทำเป็นช่องหลอกไว้ ถ้าจะเพิ่มทีหลังต้องเริ่มที่ backend ก่อน
 *
 * ── ทำไมแผงขวาเป็นสีน้ำเงินเข้มทั้งสองธีม ────────────────────────────────
 * มันเป็นภาพประกอบ ไม่ใช่ผิวหน้าเว็บ — ถ้าสลับเป็นพื้นสว่างตามธีม แสงเรืองทั้งหมด
 * (ลูกบาศก์ ลำแสง วงแหวนฐาน) จะจืดจนไม่เหลืออะไร เพราะมันทำงานด้วยการสว่างกว่าพื้น
 */
import { useState, type CSSProperties, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { Eye, EyeOff, Lock, Moon, Phone, RadioTower, RefreshCw, SignalHigh, Sun, User } from 'lucide-react';

import { cn } from '@/app/components/ui/utils';
import { login } from '../api/auth';
import { ApiError, setToken } from '../api/client';
import { Alert } from '../components/Alert';
import { useApp } from '../context/AppContext';

export function LoginPage() {
  const { T, dark, toggleDark, lang, toggleLang } = useApp();
  const navigate = useNavigate();
  const [user, setUser] = useState('');
  const [pass, setPass] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  /** พิมพ์แก้เมื่อไหร่ ข้อความเตือนหายทันที — ไม่ต้องกดปุ่มอีกรอบถึงจะรู้ว่าระบบเห็นแล้ว */
  const clearErr = () => {
    if (err) setErr('');
  };

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

  /** ช่องกรอกมีไอคอนอยู่ข้างใน จึงต้องเผื่อ padding ซ้ายไว้ให้ไอคอน */
  const fieldCls =
    'w-full rounded-control border border-line bg-surface-2 py-3 ps-10 pe-3 text-body outline-none transition-colors ' +
    'placeholder:text-ink-2/70 focus:border-brand-strong';

  return (
    <div
      className={cn(
        'grid min-h-screen place-items-center p-4 sm:p-6',
        dark
          ? 'bg-[radial-gradient(ellipse_at_60%_40%,#071828_0%,rgb(var(--bg))_70%)]'
          : 'bg-[radial-gradient(ellipse_at_60%_40%,#e0f5ff_0%,rgb(var(--bg))_70%)]',
      )}
    >
      <div className="lg-fade-in flex w-full max-w-[62.5rem] overflow-hidden rounded-[1.5rem] shadow-[0_16px_60px_rgba(0,0,0,0.14),0_0_0_1px_rgb(var(--line))] md:min-h-[34rem] dark:shadow-[0_24px_80px_rgba(0,0,0,0.7),0_0_0_1px_rgb(var(--line))]">
        {/* ── ซ้าย: ฟอร์ม ── */}
        <div className="flex w-full flex-col justify-center bg-surface px-7 py-10 sm:px-10 md:max-w-[26.25rem] md:shrink-0">
          <div className="mb-9 flex items-center gap-3.5">
            {/* ไอคอนแอป: ไล่สีทแยงกับแสงเรือง ให้เป็นวัตถุชิ้นเดียวกับลูกบาศก์ในแผงขวา */}
            <span className="grid size-14 shrink-0 place-items-center rounded-[1.125rem] bg-brand font-mono text-lead font-black tracking-[-0.03em] text-brand-ink shadow-[0_6px_18px_rgb(var(--accent)/0.4)]">
              4G
            </span>
            <div className="min-w-0">
              <p className="text-h2 leading-[1.15] font-bold">{T.app_name}</p>
              <p className="mt-0.5 text-caption text-ink-2">{T.login_sub}</p>
            </div>
          </div>

          <h1 className="text-lead font-bold">{T.login_submit}</h1>
          <p className="mt-1 mb-6 text-caption text-ink-2">{T.login_welcome}</p>

          <form onSubmit={submit} className="flex flex-col gap-4">
            <label className="flex flex-col gap-1.5">
              <span className="text-caption font-medium">{T.login_username}</span>
              <span className="relative flex">
                <User size={16} className="absolute start-3 top-1/2 -translate-y-1/2 text-ink-2" />
                <input
                  className={`${fieldCls} font-mono`}
                  value={user}
                  onChange={(e) => {
                    setUser(e.target.value);
                    clearErr();
                  }}
                  placeholder={T.login_username_ph}
                  autoComplete="username"
                  autoFocus
                />
              </span>
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="text-caption font-medium">{T.login_password}</span>
              <span className="relative flex">
                <Lock size={16} className="absolute start-3 top-1/2 -translate-y-1/2 text-ink-2" />
                <input
                  className={`${fieldCls} pe-10 font-mono`}
                  type={showPass ? 'text' : 'password'}
                  value={pass}
                  onChange={(e) => {
                    setPass(e.target.value);
                    clearErr();
                  }}
                  placeholder={T.login_password_ph}
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPass((v) => !v)}
                  className="absolute end-3 top-1/2 -translate-y-1/2 text-ink-2 transition-colors hover:text-ink"
                  aria-label="toggle password visibility"
                >
                  {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </span>
            </label>

            <button
              type="submit"
              disabled={loading}
              className="relative mt-1 flex w-full items-center justify-center rounded-control bg-brand px-4 py-3.5 text-body font-semibold text-brand-ink shadow-[0_8px_22px_rgb(var(--accent)/0.32)] transition-[filter] hover:brightness-110 disabled:opacity-70"
            >
              {loading ? <RefreshCw size={16} className="me-2 animate-spin" /> : null}
              {T.login_submit}
            </button>
          </form>

          <div className="mt-8 flex items-center gap-2.5 border-t border-line pt-4 text-micro text-ink-2">
            <span className="flex-1 font-mono">{T.app_version(__APP_VERSION__)}</span>
            <button
              type="button"
              onClick={toggleLang}
              className="flex h-[1.875rem] w-[2.375rem] items-center justify-center rounded-control border border-line bg-surface-2 font-mono tracking-[0.06em] transition-colors hover:border-brand-strong"
              aria-label={lang === 'th' ? 'Switch to English' : 'เปลี่ยนเป็นภาษาไทย'}
              title={lang === 'th' ? 'Switch to English' : 'เปลี่ยนเป็นภาษาไทย'}
            >
              {lang === 'th' ? 'EN' : 'TH'}
            </button>
            <button
              type="button"
              onClick={toggleDark}
              className="grid size-[1.875rem] place-items-center rounded-control border border-line bg-surface-2 transition-colors hover:border-brand-strong"
              aria-label="theme"
            >
              {dark ? <Sun size={14} /> : <Moon size={14} />}
            </button>
          </div>
        </div>

        {/* ── ขวา: ภาพประกอบ (ซ่อนที่จอแคบ) ── */}
        <div className="hidden flex-1 md:block">
          <LoginArtPanel />
        </div>
      </div>

      {/* ── ข้อความเตือน: ลอยล่างจอ ไม่ได้อยู่ในฟอร์ม ──
          จงใจใช้ fixed แทนที่จะแทรกไว้เหนือช่องชื่อผู้ใช้ เพราะกล่องนี้โผล่มาตอนที่คน
          เพิ่งกดปุ่มพลาด — ถ้ามันไปดันให้การ์ดสูงขึ้น ช่องกรอกกับปุ่มจะเลื่อนหนีจาก
          ใต้เมาส์พอดีจังหวะที่กำลังจะกดซ้ำ

          ตัวห่อ (aria-live) ต้องอยู่ใน DOM ตลอด ไม่ใช่โผล่มาพร้อมข้อความ ไม่งั้น
          screen reader จะไม่อ่านให้ — live region ที่เพิ่งถูก mount จะไม่ถูกประกาศ */}
      <div aria-live="assertive" className="pointer-events-none fixed inset-x-0 bottom-5 z-50 flex justify-center px-4">
        {err ? (
          <Alert
            tone="bad"
            className="pointer-events-auto max-w-[min(92vw,26.25rem)] shadow-[0_10px_36px_rgba(0,0,0,0.28)]"
          >
            {err}
          </Alert>
        ) : null}
      </div>
    </div>
  );
}

/**
 * ป้ายไอคอนที่ลอยรอบลูกบาศก์ — ตำแหน่งเป็น % ของแผง จะได้ขยับตามขนาดแผงเอง
 *
 * side บอกว่าข้อความไปอยู่ข้างไหนของไอคอน: ตัวที่อยู่ชิดขวาของแผงต้องให้ข้อความ
 * ไปทางซ้าย ไม่งั้นมันทะลุขอบแผงออกไป (และได้เป็นคู่กระจกกับตัวฝั่งซ้ายพอดี)
 *
 * ข้อความเป็นของตายตัวที่วนแอนิเมชันอยู่ ไม่ใช่สถานะจริงของเกตเวย์ — ตอนอยู่หน้านี้
 * ยังไม่มี token จึงเรียก API ไม่ได้เลยแม้แต่ตัวเดียว
 */
const ORBIT_BADGES = [
  {
    Icon: Phone,
    tone: '--art-warn',
    labelKey: 'login_panel_dialing',
    side: 'right',
    top: '25%',
    left: '10%',
    delay: '0s',
    x: '5px',
    y: '-9px',
  },
  {
    Icon: SignalHigh,
    tone: '--art-ok',
    labelKey: 'login_panel_signal',
    side: 'left',
    top: '16%',
    left: '62%',
    delay: '1.6s',
    x: '-6px',
    y: '-7px',
  },
  {
    Icon: RadioTower,
    tone: '--art-accent',
    labelKey: 'login_panel_sent',
    side: 'left',
    top: '64%',
    left: '66%',
    delay: '3.1s',
    x: '-4px',
    y: '8px',
  },
] as const;

/** ฝุ่นแสงที่ลอยขึ้นจากฐาน — ตำแหน่ง/คาบ/ดีเลย์ตายตัว ไม่ได้สุ่มตอน render
 *  (สุ่มตอน render = ทุกครั้งที่ React วาดใหม่ ฝุ่นจะกระโดดไปที่ใหม่ทั้งแผง) */
const DUST = [
  { left: '18%', bottom: '18%', dur: '5.5s', delay: '0s' },
  { left: '29%', bottom: '12%', dur: '7s', delay: '1.4s' },
  { left: '44%', bottom: '22%', dur: '6.2s', delay: '2.9s' },
  { left: '58%', bottom: '14%', dur: '7.8s', delay: '0.8s' },
  { left: '71%', bottom: '20%', dur: '6.6s', delay: '3.6s' },
  { left: '84%', bottom: '15%', dur: '8.4s', delay: '2.1s' },
];

/** ความยาวด้านของลูกบาศก์ (px) — ต้องเป็นตัวเลข เพราะเอาไปหารครึ่งใช้กับ translateZ */
const CUBE = 128;

/**
 * แผงภาพประกอบทางขวา — ตกแต่งล้วน ไม่มีค่าไหนมาจากระบบจริง
 *
 * ตอนอยู่หน้านี้ยังไม่มี token จึงเรียก API ไม่ได้เลยแม้แต่ตัวเดียว ถ้าวันหลังอยากให้
 * ตัวเลขบนนี้เป็นของจริงต้องเปิด endpoint สาธารณะก่อน ซึ่งเท่ากับเปิดเผยสถานะระบบ
 * ให้คนที่ยังไม่ login เห็น — ตั้งใจไม่ทำ
 *
 * ── โครงภาพ ──
 * ลูกบาศก์ 4G ลอยกลางแผง มีลำแสงยิงลงไปที่ฐานวงแหวนที่แผ่ออกเป็นระลอก รอบๆ มี
 * ป้ายไอคอนสามอันเกาะบนวงโคจรเส้นประ และมีฝุ่นแสงลอยขึ้นจากฐาน
 *
 * ลูกบาศก์เป็น CSS 3D จริง (สามหน้าประกอบกันด้วย transform) ไม่ใช่รูปสี่เหลี่ยมที่เอียง
 * เพราะมันหมุนระหว่างแอนิเมชัน — ถ้าเป็นภาพแบนที่เอียงไว้ พอหมุนแล้วมุมมองจะผิดทันที
 */
function LoginArtPanel() {
  const { T } = useApp();

  return (
    <div
      /* สีชุดนี้ตรึงไว้ทั้งสองธีมโดยตั้งใจ (ดูหมายเหตุหัวไฟล์) — ประกาศตรงนี้ที่เดียว
         ลูกๆ ข้างในจึงอ้าง --art-* ได้โดยไม่ต้องพก hex ติดตัวไปทุกจุด
         เป็นโทนเดิมของโปรเจค ไม่ใช่สีน้ำเงินเข้มจากรูปอ้างอิง */
      style={
        {
          '--art-accent': '0 189 254',
          '--art-ok': '68 193 102',
          '--art-warn': '218 149 0',
        } as CSSProperties
      }
      className="relative flex h-full min-h-[34rem] items-center justify-center overflow-hidden bg-[linear-gradient(145deg,#050e1a_0%,#071828_55%,#031020_100%)]"
    >
      {/* พื้นหลังจุดไข่ปลา — จางมาก มีไว้ให้พื้นไม่เรียบเป็นสีเดียว */}
      <svg className="pointer-events-none absolute inset-0 size-full opacity-[0.09]" aria-hidden>
        <defs>
          <pattern id="lg-grid" width="34" height="34" patternUnits="userSpaceOnUse">
            <circle cx="17" cy="17" r="1" fill="rgb(var(--art-accent))" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#lg-grid)" />
      </svg>

      {/* วงโคจรเส้นประ — วงรีเอียง อ่านเป็นระนาบที่มองจากด้านบนเฉียงๆ เข้าชุดกับฐานข้างล่าง */}
      <svg
        className="pointer-events-none absolute inset-0 size-full"
        viewBox="0 0 420 540"
        preserveAspectRatio="none"
        aria-hidden
      >
        <ellipse
          cx="210"
          cy="228"
          rx="178"
          ry="150"
          fill="none"
          stroke="rgb(var(--art-accent))"
          strokeOpacity="0.3"
          strokeWidth="1"
          strokeDasharray="4 7"
          transform="rotate(-18 210 228)"
        />
        <ellipse
          cx="210"
          cy="250"
          rx="130"
          ry="188"
          fill="none"
          stroke="rgb(var(--art-accent))"
          strokeOpacity="0.18"
          strokeWidth="1"
          strokeDasharray="4 9"
          transform="rotate(24 210 250)"
        />
      </svg>

      {/* ── กลาง: ลูกบาศก์ + ลำแสง + ฐานวงแหวน ── */}
      <div className="relative z-[3] grid place-items-center" style={{ perspective: '900px' }}>
        {/* แสงเรืองรอบลูกบาศก์ — อยู่หลังลูกบาศก์ ไม่งั้นมันฟุ้งทับตัวอักษร */}
        <span
          aria-hidden
          className="pointer-events-none absolute size-[18rem] rounded-full bg-[radial-gradient(circle,rgb(var(--art-accent)/0.42)_0%,rgb(var(--art-accent)/0)_65%)]"
        />

        <div className="lg-cube relative" style={{ width: CUBE, height: CUBE }}>
          {/* หน้าหน้า — หันเข้าหาคนดู เป็นหน้าที่สว่างสุดและเป็นที่อยู่ของตัวอักษร */}
          <span
            className="absolute inset-0 rounded-[1.25rem] bg-[linear-gradient(140deg,#57cdf0_0%,#0e9ed2_52%,#0b7099_100%)]"
            style={{ transform: `translateZ(${CUBE / 2}px)` }}
          />
          {/* หน้าข้างกับหน้าบน เข้มกว่าหน้าหน้า จึงอ่านเป็นก้อนทึบที่มีความหนา ไม่ใช่แผ่นแบน */}
          <span
            className="absolute inset-0 rounded-[1.25rem] bg-[linear-gradient(180deg,#0c7fae_0%,#075978_100%)]"
            style={{ transform: `rotateY(90deg) translateZ(${CUBE / 2}px)` }}
          />
          <span
            className="absolute inset-0 rounded-[1.25rem] bg-[linear-gradient(160deg,#31bbe4_0%,#0d8cbe_100%)]"
            style={{ transform: `rotateX(90deg) translateZ(${CUBE / 2}px)` }}
          />
          {/* ตัวอักษรวางบนหน้าหน้า ยกขึ้นอีก 1px กันซ้อนกับพื้นผิว */}
          <span
            /* พื้นหน้าเข้มลงแล้ว ตัวอักษรจึงกลับมาเป็นสีขาวได้ คอนทราสต์ดีกว่าสีเข้มบนฟ้าสว่าง */
            className="absolute inset-0 grid place-items-center font-mono text-[2.25rem] leading-none font-black tracking-[-0.04em] text-white"
            style={{ transform: `translateZ(${CUBE / 2 + 1}px)` }}
          >
            4G
          </span>
        </div>

        {/* ลำแสงลงฐาน — เส้นกลางยาวสุด สองข้างสั้นลง อ่านเป็นลำแสงทรงกรวย */}
        {/* top ต้องพ้นครึ่งล่างของลูกบาศก์ ไม่งั้นลำแสงโผล่อยู่หลังตัวลูกบาศก์แล้วมองไม่เห็น */}
        <span aria-hidden className="pointer-events-none absolute top-[calc(50%+3.75rem)] flex gap-2.5">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="w-[3px] rounded-full bg-[linear-gradient(180deg,rgb(var(--art-accent)/0)_0%,rgb(var(--art-accent)/0.95)_50%,rgb(var(--art-accent)/0)_100%)]"
              style={{
                height: `${96 - Math.abs(i - 1) * 26}px`,
                animation: `lg-beam ${2.4 + i * 0.35}s ease-in-out ${i * 0.4}s infinite`,
              }}
            />
          ))}
        </span>

        {/* ฐานวงแหวน — เอียงด้วย rotateX ให้เป็นวงรีที่มองจากด้านบนเฉียง */}
        <span
          aria-hidden
          className="pointer-events-none absolute top-[calc(50%+7rem)] grid place-items-center"
          style={{ transform: 'rotateX(72deg)' }}
        >
          {['lg-base-1', 'lg-base-2', 'lg-base-3'].map((cls) => (
            <span
              key={cls}
              className={cn('absolute size-[14rem] rounded-full border-2', cls)}
              style={{ borderColor: 'rgb(var(--art-accent))' }}
            />
          ))}
          <span className="size-[5rem] rounded-full bg-[radial-gradient(circle,rgb(var(--art-accent)/0.85)_0%,rgb(var(--art-accent)/0)_70%)]" />
        </span>
      </div>

      {/* ── ป้ายไอคอนโคจร ── */}
      {ORBIT_BADGES.map((b, i) => (
        <span
          key={i}
          className={cn('lg-orbit absolute z-[4] flex items-center gap-2', b.side === 'left' && 'flex-row-reverse')}
          style={
            {
              top: b.top,
              left: b.left,
              animationDelay: b.delay,
              '--lg-orbit-x': b.x,
              '--lg-orbit-y': b.y,
            } as CSSProperties
          }
        >
          <span
            className="grid size-12 shrink-0 place-items-center rounded-full border backdrop-blur-sm"
            style={{
              color: `rgb(var(${b.tone}))`,
              borderColor: `rgb(var(${b.tone}) / 0.5)`,
              backgroundColor: `rgb(var(${b.tone}) / 0.14)`,
              boxShadow: `0 0 26px rgb(var(${b.tone}) / 0.4)`,
            }}
          >
            <b.Icon size={20} />
          </span>
          {/* จุดกะพริบสีเดียวกับไอคอน อยู่ด้านที่ติดกับไอคอนเสมอ (flex-row-reverse
              สลับทั้งป้ายและข้างในป้าย) ทั้งสองฝั่งจึงเป็นคู่กระจกกันพอดี */}
          <span
            className={cn(
              'flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.07] px-2.5 py-1 whitespace-nowrap backdrop-blur-md',
              b.side === 'left' && 'flex-row-reverse',
            )}
          >
            <span
              className="lg-blink size-[0.4375rem] shrink-0 rounded-full"
              style={{ backgroundColor: `rgb(var(${b.tone}))`, animationDelay: b.delay }}
            />
            <span className="text-micro font-medium text-white/85">{T[b.labelKey]}</span>
          </span>
        </span>
      ))}

      {/* ── ฝุ่นแสงลอยขึ้น ── */}
      {DUST.map((d, i) => (
        <span
          key={i}
          aria-hidden
          className="pointer-events-none absolute size-[3px] rounded-full"
          style={{
            left: d.left,
            bottom: d.bottom,
            backgroundColor: 'rgb(var(--art-accent))',
            animation: `lg-dust ${d.dur} linear ${d.delay} infinite`,
          }}
        />
      ))}

      <span className="absolute right-5 bottom-4 z-[2] font-mono text-[0.625rem] text-white/25">
        {T.app_name} · {__APP_VERSION__}
      </span>
    </div>
  );
}
