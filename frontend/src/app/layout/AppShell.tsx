/**
 * AppShell — เชลล์ที่ทุกหน้าใช้ร่วมกัน (nav + ธีม + ภาษา + สถานะโมดูล)
 * พอร์ตจาก figma/handoff/components/AppShell.tsx
 *
 * ── ต่างจากต้นฉบับ ────────────────────────────────────────────────────
 * 1. ต้นฉบับใช้ prop `screen` + `onNavigate` (state ในแอป)
 *    ของเราใช้ react-router — เปลี่ยนเป็น <Outlet /> + NavLink + useLocation
 * 2. ต้นฉบับถือ state ธีม/ภาษาไว้เอง ของเราใช้ AppContext ที่มีอยู่แล้ว
 *    (เก็บลง localStorage + สลับคลาส .dark/.light บน <html>)
 * 3. ต้นฉบับมี 6 แท็บ ของเรามี 8 หน้า — เพิ่ม คิวการโทร / ประเภทเหตุการณ์ / กลุ่มผู้รับ
 *    ที่ดีไซน์ยุบรวมไว้ที่อื่น แต่ backend เราแยกเป็นหน้าจริง (ดู DEPLOYMENT_MODELS.md)
 * 4. ป้ายสถานะโมดูลต้นฉบับเป็นข้อความคงที่ — ของเราดึงจาก /system/info จริง
 *
 * แทนที่ DashboardLayout เดิม (sidebar + bottom tabs) ด้วย top nav เดียวตามดีไซน์
 */
import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { ChevronDown, LogOut, Moon, Sun } from 'lucide-react';

import { cn } from '@/app/components/ui/utils';
import { clearToken } from '../api/client';
import { getSystemInfo } from '../api/system';
import { useApp } from '../context/AppContext';
import { usePolling } from '../lib/usePolling';
import { Dot } from '../components/primitives';

export function AppShell() {
  const location = useLocation();
  return (
    <div className="flex min-h-screen flex-col bg-bg text-ink">
      <Header />
      <main className="mx-auto w-full max-w-[1180px] flex-1 px-4 pt-6 pb-16 md:px-5">
        {/* key={pathname} บังคับให้ React มองเป็น element ใหม่ตอนเปลี่ยนหน้า
            animate-fade-up (keyframe เดิมใน tw-theme.css) เลยเล่นซ้ำทุกครั้งที่สลับแท็บ */}
        <div key={location.pathname} className="animate-fade-up">
          <Outlet />
        </div>
      </main>
    </div>
  );
}

const chipCls =
  'rounded-full border border-line bg-surface px-2.5 py-1 font-mono text-micro text-ink-2 transition-colors hover:border-brand';

function Header() {
  const { T, dark, toggleDark, lang, toggleLang } = useApp();
  const navigate = useNavigate();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  // ปิดเมนูทันทีที่เปลี่ยนหน้า ไม่งั้นรายการจะค้างบังเนื้อหาที่เพิ่งกดเข้าไปดู
  useEffect(() => setMenuOpen(false), [location.pathname]);

  // 30 วิพอสำหรับป้ายสถานะ — ถี่กว่านี้เปลือง log ของ container บน Pi เปล่าๆ
  const { data: info } = usePolling(getSystemInfo, 30_000);

  const tabs = [
    { path: '/overview', label: T.nav_overview },
    { path: '/queue', label: T.nav_queue },
    { path: '/history', label: T.nav_history },
    { path: '/devices', label: T.devices_title },
    { path: '/event-types', label: T.nav_event_types },
    { path: '/contacts', label: T.nav_contacts },
    { path: '/system', label: T.sys_title },
    { path: '/api-guide', label: T.nav_api },
  ];

  const logout = () => {
    clearToken();
    navigate('/login', { replace: true });
  };

  // ชื่อหน้าปัจจุบันสำหรับปุ่มเมนูบนมือถือ — startsWith เพื่อให้ /devices/12 ยังนับเป็นแท็บ "อุปกรณ์"
  const current = tabs.find((t) => location.pathname.startsWith(t.path)) ?? tabs[0];

  return (
    <header className="sticky top-0 z-20 border-b border-line bg-bg/90 backdrop-blur-md">
      <div className="mx-auto flex max-w-[1180px] flex-wrap items-center gap-3 px-4 py-3 md:px-5">
        <div className="me-auto flex items-center gap-2.5">
          <span className="grid size-7 place-items-center rounded-lg bg-brand font-mono text-micro font-bold text-brand-ink">
            4G
          </span>
          <span className="text-caption font-bold whitespace-nowrap">{T.app_name}</span>
        </div>

        {/* order-3 + w-full = แท็บอยู่บรรทัดล่างเสมอ ไม่ใช่แค่บนมือถือ
            โค้ด handoff ใส่ md:order-none md:w-auto ให้แท็บแทรกอยู่แถวเดียวกับโลโก้บนจอกว้าง
            แต่ภาพ mockup แยกเป็น 2 บรรทัดทุกขนาดจอ (โลโก้+ปุ่มขวาบรรทัดบน / แท็บบรรทัดล่าง)
            ยึดตามภาพ เพราะแท็บ 8 อันภาษาไทยแทรกแถวเดียวกันแล้วดันปุ่มขวาตกบรรทัด

            flex-wrap ไม่ใช่ overflow-x-auto: ภาพจอแคบแสดงแท็บขึ้นบรรทัดใหม่ (2 แถว)
            การเลื่อนแนวนอนซ่อนแท็บที่เลยขอบจอ ผู้ใช้ไม่รู้ว่ามีอยู่ — ยิ่งเรามี 8 แท็บ
            ยิ่งต้องเห็นครบ ดีกว่าให้เดาว่าต้องปัดหา */}
        {/* ── มือถือ: ปุ่มเดียวบอกหน้าปัจจุบัน กดแล้วกางรายการเต็มแนวตั้ง ──────────
            เดิมปล่อยให้ pill 8 อัน flex-wrap เองทุกขนาดจอ บนจอ 360px กลายเป็น 3 แถว
            สูงเกือบ 120px กินพื้นที่เหนือเนื้อหาจริงไปมาก และความยาวป้ายไทยไม่เท่ากัน
            ทำให้แต่ละแถวจบไม่ตรงกัน ดูรกกว่าเป็นระเบียบ

            ยังเห็นครบทั้ง 8 หน้าเหมือนเดิมตอนกางออก — ต่างจากการเลื่อนแนวนอน
            ที่ซ่อนแท็บไว้นอกจอโดยผู้ใช้ไม่รู้ว่ามีอยู่ */}
        <div className="order-3 w-full md:hidden">
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            aria-expanded={menuOpen}
            className="flex w-full items-center justify-between gap-2 rounded-control border border-line bg-surface px-3.5 py-2 text-caption font-semibold text-ink transition-colors"
          >
            <span className="flex min-w-0 items-center gap-2">
              <span className="font-mono text-micro text-ink-2">
                {String(tabs.indexOf(current) + 1).padStart(2, '0')}
              </span>
              <span className="truncate">{current.label}</span>
            </span>
            <ChevronDown
              size={16}
              className={cn('shrink-0 text-ink-2 transition-transform', menuOpen && 'rotate-180')}
            />
          </button>

          {menuOpen ? (
            <div className="animate-fade-up mt-1 flex flex-col overflow-hidden rounded-control border border-line bg-surface">
              {tabs.map((tab, i) => (
                <NavLink
                  key={tab.path}
                  to={tab.path}
                  className={({ isActive }) =>
                    cn(
                      'flex items-center gap-2.5 border-b border-line-2 px-3.5 py-2.5 text-caption text-ink last:border-b-0',
                      isActive ? 'bg-brand-soft font-semibold' : 'font-medium',
                    )
                  }
                >
                  <span className="font-mono text-micro text-ink-2">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  {tab.label}
                </NavLink>
              ))}
            </div>
          ) : null}
        </div>

        {/* ── จอกว้าง: pill เรียงเหมือนเดิมตามภาพ mockup ────────────────────── */}
        <nav className="order-3 hidden w-full flex-wrap gap-1 md:flex">
          {tabs.map((tab) => (
            <NavLink
              key={tab.path}
              to={tab.path}
              className={({ isActive }) =>
                cn(
                  // ตัวอักษรเป็น text-ink (ดำ) ทั้งสองสถานะ — บอก active ด้วยกรอบ+พื้น+น้ำหนักตัวอักษร
                  // ไม่ใช้สีตัวอักษรเป็นตัวบอก เพราะอ่านง่ายกว่าและไม่พึ่งการแยกสีอย่างเดียว
                  'rounded-full border px-3.5 py-1.5 text-caption whitespace-nowrap transition-colors',
                  isActive
                    ? 'border-brand bg-brand-soft font-semibold text-ink'
                    : 'border-line bg-surface font-medium text-ink hover:border-brand',
                )
              }
            >
              {tab.label}
            </NavLink>
          ))}
        </nav>

        {/* ป้ายทั้งชุดใช้คำสั้นตาม handoff (โมดูลพร้อม / โหมดมืด / ออก)
            ของเดิมผมใช้คำยาว ("GSM module ยังไม่เชื่อมต่อ", "ออกจากระบบ") ซึ่งดันกันจนตกบรรทัด */}
        {/* flex-wrap ที่ชุดปุ่มด้วย — จอ 360px ปุ่ม 4 อันไม่พอในแถวเดียว ให้ตกบรรทัดเองแทนล้นขอบ */}
        <div className="flex flex-wrap items-center gap-2">
          {/* เดิมซ่อนป้ายนี้ต่ำกว่า 640px (hidden sm:flex) แต่ภาพจอ 530px ยังแสดงอยู่
              และนี่คือป้ายที่บอกว่าระบบพร้อมโทรหรือไม่ — ไม่ควรเป็นอย่างแรกที่หายไปบนมือถือ */}
          {/* ป้ายนี้บอกว่าระบบพร้อมโทรหรือไม่ — ทำเป็นลิงก์ไปหน้าระบบ เพราะพอเห็นว่า "ไม่พร้อม"
              คำถามถัดไปคือ "แล้วเพราะอะไร" ซึ่งคำตอบ (สัญญาณ/ผู้ให้บริการ/พอร์ต) อยู่หน้านั้นพอดี */}
          {/* เหลือแค่จุดสี — กว้างคงที่ 30px เท่ากับปุ่มไอคอนอื่น ไม่ขยับตอนสลับภาษา
              ข้อความเต็ม ("ออนไลน์"/"ออฟไลน์") ยังอยู่ใน title + aria-label ให้ทั้ง tooltip
              ตอนชี้เมาส์และ screen reader — คนที่มองไม่เห็นสีจึงยังรู้สถานะได้
              ตอนออฟไลน์ขอบเป็นสีแดงด้วย ไม่ได้พึ่งจุดสีอย่างเดียวในการเตือน */}
          <NavLink
            to="/system"
            title={info?.gsm_connected ? T.module_ready : T.module_not_ready}
            aria-label={info?.gsm_connected ? T.module_ready : T.module_not_ready}
            className={cn(
              chipCls,
              'grid size-[30px] place-items-center px-0',
              !info?.gsm_connected && 'border-bad hover:border-bad',
            )}
          >
            <Dot tone={info?.gsm_connected ? 'ok' : 'bad'} pulse={info?.gsm_connected} />
          </NavLink>

          {/* ธงอย่างเดียว ขนาด 30px เท่ากับปุ่มไอคอนอื่นในแถว — แสดงธงของ "ภาษาที่จะสลับไป"
              ความหมายอยู่ใน title/aria-label ให้ทั้ง tooltip ตอนชี้เมาส์และ screen reader
              (วาดเป็น SVG ไม่ใช้ emoji ธง เพราะ Windows ไม่มีฟอนต์ธงชาติ 🇹🇭 จะกลายเป็น
              ตัวอักษร "TH" ในกล่องแทนที่จะเป็นรูปธง) */}
          <button
            type="button"
            onClick={toggleLang}
            className={cn(chipCls, 'grid size-[30px] place-items-center px-0')}
            aria-label={lang === 'th' ? 'Switch to English' : 'เปลี่ยนเป็นภาษาไทย'}
            title={lang === 'th' ? 'Switch to English' : 'เปลี่ยนเป็นภาษาไทย'}
          >
            {lang === 'th' ? <FlagUK /> : <FlagTH />}
          </button>

          {/* ไอคอนแทนข้อความ — ข้อความไทย "สลับเป็นสว่าง/มืด" ยาวจนเบียดปุ่มอื่นตกบรรทัดบนจอแคบ
              aria-label + title ยังคงข้อความเต็มไว้ให้ทั้ง screen reader และ tooltip ตอนชี้เมาส์ */}
          <button
            type="button"
            onClick={toggleDark}
            className={cn(chipCls, 'grid size-[30px] place-items-center px-0')}
            aria-label={dark ? T.sys_theme_to_light : T.sys_theme_to_dark}
            title={dark ? T.sys_theme_to_light : T.sys_theme_to_dark}
          >
            {dark ? <Sun size={14} /> : <Moon size={14} />}
          </button>

          {/* ไอคอนแทนข้อความด้วยเหตุผลเดียวกับปุ่มธีม — "ออก" กับ "Sign out" ยาวไม่เท่ากัน
              พอสลับภาษาปุ่มจะหดขยายแล้วดันปุ่มอื่นขยับตามทั้งแถว */}
          <button
            type="button"
            onClick={logout}
            className={cn(chipCls, 'grid size-[30px] place-items-center px-0 hover:border-bad hover:text-bad')}
            aria-label={T.nav_logout}
            title={T.nav_logout}
          >
            <LogOut size={14} />
          </button>
        </div>
      </div>
    </header>
  );
}

/* ── ธงชาติ ───────────────────────────────────────────────────────────────
   วาดเป็น SVG เอง ไม่ใช้ emoji — Windows ไม่มีฟอนต์ธงชาติ emoji ธงจะกลายเป็น
   ตัวอักษรสองตัวในกล่อง (🇹🇭 → "TH") ซึ่งซ้ำกับรหัสที่มีอยู่แล้วข้างๆ พอดี
   ขนาด 18×12 (อัตราส่วน 3:2) ขอบมนนิดหน่อยให้เข้ากับปุ่มทรงกลม */

const flagCls = 'shrink-0 rounded-[2px]';

/** ธงไตรรงค์ — แดง/ขาว/น้ำเงิน/ขาว/แดง สัดส่วนแถบ 1:1:2:1:1 */
function FlagTH() {
  return (
    <svg viewBox="0 0 18 12" width={18} height={12} className={flagCls} aria-hidden>
      <rect width="18" height="12" fill="#A51931" />
      <rect y="2" width="18" height="8" fill="#F4F5F8" />
      <rect y="4" width="18" height="4" fill="#2D2A4A" />
    </svg>
  );
}

/** Union Jack แบบย่อ — ที่ 18px กว้าง รายละเอียดเต็มจะเละ เหลือแค่กากบาททแยงกับกากบาทตรง */
function FlagUK() {
  return (
    <svg viewBox="0 0 60 40" width={18} height={12} className={flagCls} aria-hidden>
      <rect width="60" height="40" fill="#012169" />
      <path d="M0 0 60 40M60 0 0 40" stroke="#FFF" strokeWidth="8" />
      <path d="M0 0 60 40M60 0 0 40" stroke="#C8102E" strokeWidth="4" />
      <path d="M30 0V40M0 20H60" stroke="#FFF" strokeWidth="13" />
      <path d="M30 0V40M0 20H60" stroke="#C8102E" strokeWidth="7" />
    </svg>
  );
}
