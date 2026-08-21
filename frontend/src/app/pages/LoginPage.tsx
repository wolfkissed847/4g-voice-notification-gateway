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
 * 7. ข้อความเตือนไม่ได้อยู่ในฟอร์มแบบดีไซน์ แต่ลอยอยู่ล่างจอ (ดูหมายเหตุตรงจุดนั้น)
 */
import { Fragment, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import {
  Check,
  Cpu,
  Eye,
  EyeOff,
  Moon,
  PhoneCall,
  RadioTower,
  RefreshCw,
  Send,
  SignalHigh,
  Sun,
  Users,
} from 'lucide-react';

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
      <div className="lg-fade-in flex w-full max-w-[53.75rem] overflow-hidden rounded-[20px] shadow-[0_16px_60px_rgba(0,0,0,0.12),0_0_0_1px_rgb(var(--line))] md:min-h-[31.25rem] dark:shadow-[0_24px_80px_rgba(0,0,0,0.7),0_0_0_1px_rgb(var(--line))]">
        {/* ── ซ้าย: ฟอร์ม ── */}
        <div className="flex w-full flex-col justify-center bg-surface px-7 py-10 sm:px-10 md:max-w-[25rem] md:shrink-0">
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
            <label className="flex flex-col gap-1.5">
              <span className="text-micro font-medium text-ink-2">{T.login_username}</span>
              <input
                className={`${inputCls} font-mono`}
                value={user}
                onChange={(e) => {
                  setUser(e.target.value);
                  clearErr();
                }}
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
                  onChange={(e) => {
                    setPass(e.target.value);
                    clearErr();
                  }}
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

      {/* ── ข้อความเตือน: ลอยล่างจอ ไม่ได้อยู่ในฟอร์ม ──
          จงใจใช้ fixed แทนที่จะแทรกไว้เหนือช่องชื่อผู้ใช้แบบเดิม เพราะกล่องนี้โผล่มา
          ตอนที่คนเพิ่งกดปุ่มพลาด — ถ้ามันไปดันให้การ์ดสูงขึ้น ช่องกรอกกับปุ่มจะเลื่อนหนี
          จากใต้เมาส์พอดีจังหวะที่กำลังจะกดซ้ำ

          ตัวห่อ (aria-live) ต้องอยู่ใน DOM ตลอด ไม่ใช่โผล่มาพร้อมข้อความ ไม่งั้น
          screen reader จะไม่อ่านให้ — live region ที่เพิ่งถูก mount จะไม่ถูกประกาศ */}
      <div aria-live="assertive" className="pointer-events-none fixed inset-x-0 bottom-5 z-50 flex justify-center px-4">
        {err ? (
          <Alert
            tone="bad"
            className="pointer-events-auto max-w-[min(92vw,420px)] shadow-[0_10px_36px_rgba(0,0,0,0.28)]"
          >
            {err}
          </Alert>
        ) : null}
      </div>
    </div>
  );
}

/** ความสูงสัมพัทธ์ของแถบคลื่นเสียงใต้ป้าย 4G — คงที่ ไม่ได้อ่านจากอะไรจริง */
const WAVE_BARS = [0.35, 0.55, 0.9, 1.0, 0.7, 0.5, 0.8, 0.6, 0.4];

type ArtChip = {
  tone: string;
  icon: ReactNode;
  label: string;
  /** เหลื่อมเวลาโผล่เข้าเฟรม + เหลื่อมจังหวะจุดกะพริบ */
  delay: string;
  /** คาบการลอยขึ้นลง — ตั้งไม่เท่ากันรายใบ จะได้ไม่ขยับพร้อมกันทั้งสี่ใบ */
  bob: string;
  /** ระยะลอยขึ้นลง (px) — ตั้งไม่เท่ากันรายใบเช่นกัน */
  bobY: number;
  side: 'left' | 'right';
  /**
   * เยื้องจากตำแหน่งที่ flexbox จัดให้ + ย่อ/หรี่นิดหน่อย
   *
   * ตัวเลขชุดนี้ตั้งมือให้ดู "ไม่ลงกริด" โดยเฉพาะ — สี่ใบที่อยู่มุมเป๊ะ สูงเท่ากันเป๊ะ
   * ใหญ่เท่ากันเป๊ะ มันอ่านออกทันทีว่าถูกวางด้วยตาราง ไม่ได้ลอยอยู่จริง พอเยื้องคนละ
   * ระยะและอยู่คนละระยะลึก (ใบที่เล็กกว่า+จางกว่า = อยู่ไกลกว่า) ภาพถึงดูเป็นของ
   * ที่กระจายอยู่ในที่ว่าง
   *
   * ทำเป็น transform ไม่ใช่ margin เพราะ transform ไม่กินพื้นที่ในผัง — ระยะเยื้อง
   * จึงไปกินที่ว่างระหว่างแถวกับภาพตรงกลางเฉยๆ ไม่ไปบีบให้ของอื่นขยับตาม
   */
  dx: number;
  dy: number;
  scale: number;
  dim: number;
};

/**
 * แผงภาพประกอบทางขวา — ตกแต่งล้วน ไม่มีค่าไหนมาจากระบบจริง
 *
 * เขียนไว้ตรงนี้ให้ชัด: ป้ายสถานะ 4 ใบ ("เชื่อมต่อสำเร็จ" / "กำลังโทร…" ฯลฯ) เป็นข้อความ
 * ตายตัวที่วนแอนิเมชันอยู่ ไม่ใช่สถานะของเกตเวย์ — ตอนอยู่หน้านี้ยังไม่มี token
 * จึงเรียก API ไม่ได้เลยแม้แต่ตัวเดียว ถ้าวันหลังอยากให้มันเป็นของจริงต้องเปิด
 * endpoint สาธารณะก่อน ซึ่งเท่ากับเปิดเผยสถานะระบบให้คนที่ยังไม่ login เห็น
 *
 * ── การจัดวาง ──
 * เลิกวางป้ายสี่ใบด้วย absolute สี่มุมแล้ว เปลี่ยนเป็นแถวบน / ภาพกลาง / แถวล่าง เรียง
 * ตามสายน้ำปกติ เพราะ absolute ต้องเดาเองว่ากล่องไหนจะไปชนวงแหวนตรงกลางที่จุดไหน
 * พอสลับภาษา (ไทย↔อังกฤษ ยาวไม่เท่ากัน) หรือความสูงการ์ดขยับ ก็ต้องมานั่งเดาใหม่ทุกครั้ง
 * แบบเรียงตามสายน้ำ flexbox กันไม่ให้ทับกันให้เองโดยไม่ต้องเดาเลย
 */
function LoginArtPanel() {
  const { T } = useApp();

  /**
   * ไอคอนต้องตรงกับข้อความที่มันปะอยู่
   *
   * ของเดิม "สัญญาณดี" ใช้ไอคอนชิป (Cpu) ซึ่งเป็นคนละเรื่องกัน — เห็นรูปชิปแล้วนึกถึง
   * ตัวเครื่อง ไม่ใช่ความแรงสัญญาณ ตอนนี้จับคู่ให้ตรงทุกใบ: สำเร็จ=เครื่องหมายถูก /
   * ส่งแล้ว=เครื่องบินกระดาษ / กำลังโทร=หูโทรศัพท์ / สัญญาณดี=ขีดสัญญาณ
   */
  const chips: ArtChip[] = [
    {
      tone: '--art-ok',
      icon: <Check size={19} />,
      label: T.login_panel_connected,
      delay: '0s',
      bob: '4.2s',
      bobY: 6,
      side: 'left',
      dx: 4,
      dy: 0,
      scale: 1,
      dim: 1,
    },
    {
      tone: '--art-accent',
      icon: <Send size={18} />,
      label: T.login_panel_sent,
      delay: '0.45s',
      bob: '5.9s',
      bobY: 4,
      side: 'right',
      dx: -3,
      dy: 19,
      scale: 0.93,
      dim: 0.88,
    },
    {
      tone: '--art-warn',
      icon: <PhoneCall size={18} />,
      label: T.login_panel_dialing,
      delay: '0.9s',
      bob: '4.7s',
      bobY: 7,
      side: 'left',
      dx: 13,
      dy: -17,
      scale: 0.97,
      dim: 0.97,
    },
    {
      tone: '--art-accent',
      icon: <SignalHigh size={19} />,
      label: T.login_panel_signal,
      delay: '1.35s',
      bob: '5.3s',
      bobY: 5,
      side: 'right',
      dx: -7,
      dy: 4,
      scale: 0.9,
      dim: 0.85,
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
      className="relative flex h-full min-h-[31.25rem] flex-col justify-between overflow-hidden bg-[linear-gradient(145deg,#050e1a_0%,#071828_55%,#031020_100%)] px-5 pt-7 pb-10"
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

      {/* ── แถวบน ── */}
      <div className="relative z-[4] flex items-start justify-between gap-3">
        <ArtChipView chip={chips[0]} />
        <ArtChipView chip={chips[1]} />
      </div>

      {/* ── กลาง: วงแหวน + เส้นโค้งสัญญาณ + ป้าย 4G + คลื่นเสียง + แถบขั้นตอน ── */}
      <div className="relative z-[3] flex flex-col items-center">
        <div className="relative size-[176px] shrink-0">
          {['lg-ring-1', 'lg-ring-2', 'lg-ring-3'].map((cls) => (
            <span
              key={cls}
              className={cn('absolute inset-0 rounded-full border-[1.5px]', cls)}
              style={{ borderColor: 'rgb(var(--art-accent) / 0.55)' }}
            />
          ))}

          {/* viewBox คงเป็น 188 เท่าเดิมทั้งที่กล่องเหลือ 164 — SVG ย่อพิกัดในนั้นให้เอง
              เส้นโค้งกับ path ของ animateMotion จึงไม่ต้องคำนวณใหม่ */}
          <svg className="absolute inset-[6px] size-[164px]" viewBox="0 0 188 188" aria-hidden>
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
            <span className="grid size-[70px] place-items-center rounded-[18px] bg-[linear-gradient(135deg,#00bdfe_0%,#005f8a_100%)] font-mono text-[20px] leading-none font-black tracking-[-1px] text-black shadow-[0_0_44px_rgba(0,189,254,0.5),0_0_0_6px_rgba(0,189,254,0.12)]">
              4G
            </span>
          </div>
        </div>

        {/* แถบคลื่นเสียง — คาบไม่เท่ากันรายแถบ (0.7 + i×0.12 วิ) จึงไม่ขยับพร้อมกันเป็นบล็อก */}
        <div className="mt-4 flex items-end gap-1">
          {WAVE_BARS.map((h, i) => (
            <span
              key={i}
              className="lg-wave-bar w-[5px] rounded-[3px] opacity-70"
              style={{
                backgroundColor: 'rgb(var(--art-accent))',
                height: `${h * 30}px`,
                animation: `lg-wave ${0.7 + i * 0.12}s ease-in-out ${i * 0.08}s infinite alternate`,
              }}
            />
          ))}
        </div>

        <ArtFlowStrip />
      </div>

      {/* ── แถวล่าง ── */}
      <div className="relative z-[4] flex items-end justify-between gap-3">
        <ArtChipView chip={chips[2]} />
        <ArtChipView chip={chips[3]} />
      </div>

      <span className="absolute right-4 bottom-2.5 z-[2] font-mono text-[10px] leading-[1.5] text-white/20">
        {T.app_name} · {__APP_VERSION__}
      </span>
    </div>
  );
}

/**
 * ป้ายสถานะ 1 ใบ = แผ่นไอคอนเรืองแสง + ป้ายข้อความ
 *
 * ใบฝั่งขวาสลับด้าน (flex-row-reverse) ทั้งตัวป้ายและข้างในป้าย ไอคอนจึงหันออกนอกแผง
 * เหมือนกันทั้งซ้ายขวา — ถ้าปล่อยให้ไอคอนอยู่ซ้ายทั้งสี่ใบแบบเดิม ใบฝั่งขวาจะดูเหมือน
 * ถูกดันไปติดขอบ มากกว่าจะดูเป็นคู่กระจกกับฝั่งซ้าย
 *
 * ป้ายข้อความตรึง min-width ไว้ ไม่ปล่อยให้กว้างตามตัวอักษร — ไม่งั้นสี่ใบยาวไม่เท่ากัน
 * แล้วขอบด้านในของสองคอลัมน์จะเยื้องกันเป็นฟันปลา
 */
function ArtChipView({ chip }: { chip: ArtChip }) {
  const right = chip.side === 'right';
  const rgb = `rgb(var(${chip.tone}))`;
  return (
    // ซ้อนสองชั้นเพราะ lg-card ยึด transform ของชั้นนอกไว้ตลอด (fill: both) ถ้าใส่ระยะ
    // เยื้องลงไปที่ชั้นเดียวกัน แอนิเมชันตอนโผล่เข้าเฟรมจะลบมันทิ้งพอเล่นจบ
    <div className="lg-card" style={{ animationDelay: chip.delay }}>
      <div
        className={cn(
          'flex min-w-0 items-center gap-2.5',
          // ย่อจากขอบด้านนอกเข้ามา ป้ายที่ถูกย่อจึงยังชิดขอบแผงเท่าเดิม ไม่ลอยเข้ามากลาง
          right ? 'origin-right flex-row-reverse' : 'origin-left',
        )}
        style={{
          transform: `translate(${chip.dx}px, ${chip.dy}px) scale(${chip.scale})`,
          opacity: chip.dim,
        }}
      >
        <span
          className="lg-bob relative grid size-[42px] shrink-0 place-items-center rounded-[13px] border"
          style={
            {
              color: rgb,
              borderColor: `rgb(var(${chip.tone}) / 0.45)`,
              backgroundImage: `linear-gradient(150deg, rgb(var(${chip.tone}) / 0.3) 0%, rgb(var(${chip.tone}) / 0.06) 100%)`,
              boxShadow: `0 6px 18px rgb(var(${chip.tone}) / 0.22), inset 0 1px 0 rgb(var(${chip.tone}) / 0.35)`,
              animationDelay: chip.delay,
              animationDuration: chip.bob,
              '--lg-bob-y': `${chip.bobY}px`,
            } as CSSProperties
          }
        >
          {/* แสงเรืองใต้แผ่น — เบลอออกนอกขอบนิดหน่อย ไอคอนจึงดูสว่างจากข้างในจริงๆ
              ไม่ใช่แค่กล่องสีจางวางบนพื้นมืด */}
          <span
            aria-hidden
            className="pointer-events-none absolute -inset-1 -z-10 rounded-[17px] opacity-70 blur-[10px]"
            style={{ backgroundColor: `rgb(var(${chip.tone}) / 0.3)` }}
          />
          {chip.icon}
        </span>
        <span
          className={cn(
            'flex min-w-[8.25rem] items-center gap-1.5 rounded-[10px] border border-white/10 bg-white/[0.07] px-2.5 py-[7px] whitespace-nowrap backdrop-blur-md',
            right && 'flex-row-reverse',
          )}
        >
          <span
            className="lg-blink size-[7px] shrink-0 rounded-full"
            style={{ backgroundColor: rgb, boxShadow: `0 0 8px ${rgb}`, animationDelay: chip.delay }}
          />
          <span className="text-micro font-medium text-white/85">{chip.label}</span>
        </span>
      </div>
    </div>
  );
}

/**
 * แถบสามขั้น อุปกรณ์ → เกตเวย์ 4G → โทรหาผู้รับ
 *
 * มีไว้ตอบคำถามเดียวที่คนเห็นหน้านี้ครั้งแรกอยากรู้: ไอ้กล่องนี้มันทำอะไร — ป้ายสถานะ
 * สี่ใบบอกแค่ว่า "ตอนนี้เป็นยังไง" แต่ไม่ได้บอกว่า "มันทำอะไร"
 *
 * ชื่ออยู่ใต้ไอคอนตรงกลางพอดีเพราะ flex-col items-center จัดให้ ไม่ได้ไล่ระยะเอง
 * จึงไม่มีทางเยื้องกันไม่ว่าข้อความจะยาวแค่ไหนหรือเปลี่ยนภาษาเป็นอะไร
 */
function ArtFlowStrip() {
  const { T } = useApp();

  /**
   * dy = เยื้องขึ้นลงรายขั้น ให้สามขั้นวางโค้งตามส่วนโค้งสัญญาณที่อยู่เหนือมัน
   * ไม่ใช่วางเรียงบนเส้นตรงเป๊ะ — ขั้นกลางยกสูงกว่าสองข้างเล็กน้อย ตามทรงโค้ง
   * (ระยะไม่เท่ากันซ้ายขวาโดยตั้งใจ เส้นโค้งที่สมมาตรเป๊ะก็ยังอ่านว่าเป็นกริดอยู่ดี)
   */
  const steps: { icon: ReactNode; label: string; dy: number }[] = [
    { icon: <Cpu size={16} />, label: T.login_flow_device, dy: 7 },
    { icon: <RadioTower size={16} />, label: T.login_flow_gateway, dy: -2 },
    { icon: <Users size={16} />, label: T.login_flow_people, dy: 5 },
  ];

  return (
    <div className="lg-card mt-4 flex items-start justify-center" style={{ animationDelay: '1.8s' }}>
      {steps.map((s, i) => (
        <Fragment key={s.label}>
          {/* จุดสามเม็ดกะพริบไล่จากซ้ายไปขวา = ทิศทางที่ข้อมูลเดินทาง
              ตัวคั่นวางกึ่งกลางระหว่างไอคอนสองขั้นที่มันเชื่อม จึงต้องเฉลี่ย dy ของทั้งคู่
              ไม่งั้นมันจะลอยหลุดจากแนวโค้ง */}
          {i > 0 ? (
            <span
              className="flex shrink-0 items-center gap-[3px] px-2"
              style={{ marginTop: 15 + (steps[i - 1].dy + s.dy) / 2 }}
            >
              {[0, 1, 2].map((d) => (
                <span
                  key={d}
                  className="lg-blink size-[3px] rounded-full"
                  style={{
                    backgroundColor: 'rgb(var(--art-accent) / 0.9)',
                    animationDelay: `${i * 0.5 + d * 0.16}s`,
                  }}
                />
              ))}
            </span>
          ) : null}
          <span className="flex w-[4.75rem] flex-col items-center gap-1.5" style={{ marginTop: s.dy }}>
            <span className="grid size-[34px] place-items-center rounded-full border border-white/[0.12] bg-white/[0.06] text-white/70 backdrop-blur-md">
              {s.icon}
            </span>
            <span className="text-center text-[10px] leading-[1.45] font-medium text-white/45">{s.label}</span>
          </span>
        </Fragment>
      ))}
    </div>
  );
}
