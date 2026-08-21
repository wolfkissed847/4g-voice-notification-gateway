/**
 * AppShell — เชลล์ที่ทุกหน้าใช้ร่วมกัน (nav + ธีม + ภาษา + สถานะโมดูล)
 *
 * พอร์ตโครงจาก figma/Redesign Corporate Web App — เปลี่ยนจากแท็บแนวนอนด้านบน
 * เป็นแถบเมนูข้างซ้าย 240px และเนื้อหากินเต็มความกว้างจอ
 *
 * ── ทำไมเปลี่ยนเป็นแถบข้าง ──────────────────────────────────────────────────
 * แท็บแนวนอนเดิมมี 6 อัน ป้ายภาษาไทยยาว พอจอแคบกว่า ~1100px จะตกบรรทัดเป็น 2 แถว
 * กินความสูงเหนือเนื้อหาจริงไปเกือบ 100px ทุกหน้า และต้องมีเมนูแบบกดกางแยกอีกชุด
 * สำหรับมือถือ แถบข้างแก้ทั้งสองอย่าง: ป้ายยาวแค่ไหนก็เรียงลงล่างได้ไม่จำกัด
 * และบนมือถือกลายเป็นลิ้นชักที่เลื่อนเข้ามาทับ ไม่แย่งพื้นที่แนวตั้งเลย
 *
 * เนื้อหาเดิมถูกจำกัดที่ 1180px ทำให้ตารางประวัติ/คิวบนจอกว้างเหลือขอบว่างสองข้าง
 * เยอะมากทั้งที่ข้อมูลเป็นตารางที่ยิ่งกว้างยิ่งอ่านง่าย — เอาเพดานออก
 *
 * ── ที่ต่างจากไฟล์ดีไซน์ ────────────────────────────────────────────────────
 * 1. ดีไซน์สลับหน้าด้วย useState ของเราใช้ react-router — NavLink + <Outlet />
 * 2. ดีไซน์ถือ state ธีม/ภาษาไว้เอง ของเราใช้ AppContext (เก็บ localStorage +
 *    สลับคลาสบน <html>) และปุ่มออกจากระบบของดีไซน์ยังไม่ได้ต่อ ของเราเคลียร์ token จริง
 * 3. จุดสถานะโมดูลของดีไซน์เป็นจุดแดงคงที่ ของเราดึงจาก /system/info ทุก 30 วิ
 *    และกดแล้วพาไปหน้าระบบ เพราะพอเห็นว่า "ไม่พร้อม" คำถามถัดไปคือ "เพราะอะไร"
 * 4. ดีไซน์มีปุ่มลอย "ทดลองดูแอนิเมชัน" ไม่เอามา — ของจริงมีงานโทรจริงให้ดูอยู่แล้ว
 *    ปุ่มที่เล่นภาพจำลองบนหน้าจอเฝ้าระวังทำให้แยกไม่ออกว่าอันไหนของจริง
 */
import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { BookOpen, Clock, Cpu, LayoutGrid, Layers, LogOut, Menu, Moon, Settings, Sun, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import { cn } from '@/app/components/ui/utils';
import { clearToken } from '../api/client';
import { BrandMark } from '../components/BrandMark';
import { getSystemInfo } from '../api/system';
import { useApp } from '../context/AppContext';
import { usePolling } from '../lib/usePolling';
import { Dot } from '../components/primitives';

const SIDEBAR_W = 240;

/** สาม path ที่ชี้ไปหน้าตั้งค่าเดียวกัน ต่างกันแค่แท็บ (ดู App.tsx) */
const SETUP_TAB_PATHS = ['/contacts', '/event-types', '/devices'];

type NavItem = {
  path: string;
  label: string;
  icon: LucideIcon;
  /** path อื่นที่ถือว่าอยู่เมนูเดียวกัน (หน้าเดียวกันแต่คนละแท็บ) */
  alsoMatch?: string[];
};

export function AppShell() {
  const location = useLocation();
  const [drawerOpen, setDrawerOpen] = useState(false);

  /* คีย์ของ "หน้า" ที่ใช้สั่งแอนิเมชันตอนเปลี่ยนหน้า — ไม่ใช่ pathname ดิบๆ
     สาม path นี้เป็นหน้าเดียวกัน (SetupPage) ต่างกันแค่แท็บที่เปิดอยู่ ถ้าใช้ pathname
     ตรงๆ การกดสลับแท็บจะถูกนับเป็น "เปลี่ยนหน้า" แล้วเล่นแอนิเมชันจางเข้าใหม่ทั้งหน้า
     ทั้งที่หัวข้อกับแถบแท็บอยู่ที่เดิมไม่ได้เปลี่ยนอะไรเลย — ตาเห็นเป็นการกระพริบ
     เทียบเท่าเป๊ะ ไม่ใช่ startsWith เพราะ /devices/:id เป็นคนละหน้าจริงๆ (ตั้งค่าอุปกรณ์) */
  const pageKey = SETUP_TAB_PATHS.includes(location.pathname) ? 'setup' : location.pathname;

  // ปิดลิ้นชักทันทีที่เปลี่ยนหน้า ไม่งั้นมันจะค้างทับเนื้อหาที่เพิ่งกดเข้าไปดู
  useEffect(() => setDrawerOpen(false), [location.pathname]);

  return (
    /* h-dvh + overflow-hidden = หน้าต่างเว็บไม่เลื่อนเอง ให้เนื้อหาข้างในเลื่อนแทน
       dvh ไม่ใช่ vh เพราะบนมือถือ vh นับรวมแถบ URL ที่ยุบได้ ทำให้เนื้อหาล้นออกไปใต้แถบ

       ทำแบบนี้เพื่อให้หน้าที่ "ควรพอดีจอ" (คิว / ระบบ) สั่ง h-full แล้วได้ความสูงจริง
       แล้วดันส่วนที่ยาว (ตารางคิว) ให้เลื่อนอยู่ในกล่องของตัวเองแทนที่จะดันทั้งหน้ายาวลงไป
       ส่วนหน้าที่ยาวจริงๆ อย่างคู่มือ ยังเลื่อนได้ตามปกติเพราะ <main> เป็น overflow-y-auto */
    <div className="flex h-dvh overflow-hidden bg-bg text-ink">
      {/* ── แถบข้างถาวรบนจอกว้าง ─────────────────────────────────────────── */}
      <div className="hidden shrink-0 lg:block" style={{ width: SIDEBAR_W }}>
        <SideNav />
      </div>

      {/* ── ลิ้นชักบนจอแคบ ───────────────────────────────────────────────── */}
      {drawerOpen ? (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <button
            type="button"
            aria-label="close menu"
            onClick={() => setDrawerOpen(false)}
            className="absolute inset-0 bg-black/50"
          />
          <div className="animate-fade-up relative" style={{ width: SIDEBAR_W }}>
            <SideNav onClose={() => setDrawerOpen(false)} />
          </div>
        </div>
      ) : null}

      {/* min-h-0 จำเป็นกับ flex item ที่ต้องยอมให้ลูกเลื่อนได้ — ค่าเริ่มต้นของ
          min-height ใน flex คือ auto ซึ่งแปลว่า "ห้ามเตี้ยกว่าเนื้อหา" กล่องลูกจึงยืดยาว
          ออกไปแทนที่จะเกิด scrollbar */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <MobileBar onOpen={() => setDrawerOpen(true)} />

        {/* เนื้อหากินเต็มความกว้าง ไม่มีเพดาน — ตารางประวัติ/คิวยิ่งกว้างยิ่งอ่านง่าย */}
        {/* pb มากกว่า pt เล็กน้อยโดยตั้งใจ — หน้าที่ยาวเกินจอจะได้มีที่ว่างคั่นก่อนถึงขอบล่าง
            ไม่ใช่การ์ดใบสุดท้ายไปแปะติดขอบหน้าต่างพอดีจนดูเหมือนถูกตัด */}
        <main className="min-h-0 flex-1 overflow-y-auto px-4 pt-5 pb-6 md:px-7 md:pb-7">
          {/* key ที่เปลี่ยนบังคับให้ React มองเป็น element ใหม่ animate-fade-up จึงเล่นซ้ำ
              ตอนสลับเมนู — แต่ใช้ pageKey ไม่ใช่ pathname เพื่อไม่ให้สลับแท็บในหน้าตั้งค่า
              ไปเข้าเงื่อนไขด้วย (ดูหมายเหตุตรงที่ประกาศ pageKey)
              h-full ส่งความสูงต่อให้หน้าที่อยากพอดีจอใช้ได้ (หน้าที่ยาวกว่านั้นก็ล้นแล้วเลื่อนตามปกติ) */}
          <div key={pageKey} className="animate-fade-up h-full">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}

/* ── แถบเมนู ─────────────────────────────────────────────────────────────── */

function useNavItems(): NavItem[] {
  const { T } = useApp();
  return [
    { path: '/overview', label: T.nav_overview, icon: LayoutGrid },
    { path: '/queue', label: T.nav_queue, icon: Layers },
    { path: '/history', label: T.nav_history, icon: Clock },
    // อุปกรณ์ / ประเภทเหตุการณ์ / กลุ่มผู้รับ เป็นหน้าเดียวกัน (SetupPage) คนละแท็บ
    { path: '/devices', label: T.setup_title, icon: Settings, alsoMatch: ['/event-types', '/contacts'] },
    { path: '/system', label: T.sys_title, icon: Cpu },
    { path: '/api-guide', label: T.nav_api, icon: BookOpen },
  ];
}

function SideNav({ onClose }: { onClose?: () => void }) {
  const { T, dark, toggleDark, lang, toggleLang } = useApp();
  const location = useLocation();
  const navigate = useNavigate();
  const items = useNavItems();

  // 30 วิพอสำหรับป้ายสถานะ — ถี่กว่านี้เปลือง log ของ container บน Pi เปล่าๆ
  const { data: info } = usePolling(getSystemInfo, 30_000);

  const logout = () => {
    clearToken();
    navigate('/login', { replace: true });
  };

  const isActive = (item: NavItem) =>
    location.pathname.startsWith(item.path) ||
    (item.alsoMatch ?? []).some((p) => location.pathname.startsWith(p));

  return (
    <nav
      className="sticky top-0 flex h-screen flex-col overflow-y-auto border-e border-line bg-surface"
      aria-label={T.app_name}
    >
      {/* ── หัวแถบ ─────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2.5 border-b border-line px-4 py-4">
        <span className="grid size-7 shrink-0 place-items-center rounded-control bg-brand text-brand-ink">
          <BrandMark size={17} />
        </span>
        <span className="min-w-0 flex-1 truncate text-caption font-bold">{T.app_name}</span>

        {/* จุดสถานะโมดูล — กดแล้วไปหน้าระบบ เพราะคำถามถัดจาก "ไม่พร้อม" คือ "เพราะอะไร"
            ระหว่างรอผลรอบแรก (info == null) ต้องเป็นสีกลาง ไม่ใช่แดง ไม่งั้นจะเห็น
            สัญญาณเตือนที่ไม่จริงแวบหนึ่งทุกครั้งที่โหลดหน้า */}
        <NavLink
          to="/system"
          title={info == null ? T.loading : info.gsm_connected ? T.module_ready : T.module_not_ready}
          aria-label={info == null ? T.loading : info.gsm_connected ? T.module_ready : T.module_not_ready}
          className="grid size-6 shrink-0 place-items-center rounded-full transition-colors hover:bg-surface-2"
        >
          <Dot
            tone={info == null ? 'muted' : info.gsm_connected ? 'ok' : 'bad'}
            pulse={info?.gsm_connected === true}
          />
        </NavLink>

        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            aria-label={T.cancel}
            className="grid size-6 shrink-0 place-items-center rounded-control text-ink-2 transition-colors hover:text-ink"
          >
            <X size={16} />
          </button>
        ) : null}
      </div>

      {/* ── รายการเมนู ─────────────────────────────────────────────────── */}
      <div className="flex flex-1 flex-col gap-0.5 px-3 py-3">
        {items.map((item) => {
          const on = isActive(item);
          const Icon = item.icon;
          return (
            <NavLink
              key={item.path}
              to={item.path}
              className={cn(
                'flex items-center gap-2.5 rounded-control px-3 py-2.5 text-caption transition-colors',
                on
                  ? 'bg-brand-soft font-semibold text-brand-strong'
                  : 'font-medium text-ink-2 hover:bg-surface-2 hover:text-ink',
              )}
            >
              <Icon size={15} className="shrink-0" />
              <span className="min-w-0 truncate">{item.label}</span>
            </NavLink>
          );
        })}
      </div>

      {/* ── ปุ่มท้ายแถบ: ภาษา / ธีม / ออก ──────────────────────────────────
          สามปุ่มกว้างเท่ากันเป๊ะ ป้ายใต้ไอคอนจึงไม่ทำให้ปุ่มขยับตอนสลับภาษา */}
      <div className="border-t border-line px-3 py-3">
        <div className="flex items-stretch gap-1">
          <FootBtn
            onClick={toggleLang}
            label={lang === 'th' ? 'EN' : 'TH'}
            title={lang === 'th' ? 'Switch to English' : 'เปลี่ยนเป็นภาษาไทย'}
            highlight
          >
            <GlobeIcon />
          </FootBtn>

          <FootBtn
            onClick={toggleDark}
            label={dark ? T.sys_theme_light : T.sys_theme_dark}
            title={dark ? T.sys_theme_to_light : T.sys_theme_to_dark}
          >
            {dark ? <Sun size={16} /> : <Moon size={16} />}
          </FootBtn>

          <FootBtn onClick={logout} label={T.nav_logout} title={T.nav_logout} danger>
            <LogOut size={16} />
          </FootBtn>
        </div>
      </div>
    </nav>
  );
}

function FootBtn({
  onClick,
  label,
  title,
  highlight,
  danger,
  children,
}: {
  onClick: () => void;
  label: string;
  title: string;
  highlight?: boolean;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className={cn(
        'flex flex-1 flex-col items-center gap-1 rounded-control bg-surface-2 py-2 transition-colors',
        danger ? 'text-ink-2 hover:text-bad-strong' : 'text-ink-2 hover:text-ink',
      )}
    >
      {children}
      <span
        className={cn(
          'max-w-full truncate px-1 text-[9px] leading-none font-semibold',
          highlight ? 'rounded bg-brand-soft px-1.5 py-0.5 font-mono text-brand-strong' : 'text-ink-2',
        )}
      >
        {label}
      </span>
    </button>
  );
}

/* ── แถบบนสำหรับจอแคบ ───────────────────────────────────────────────────── */

function MobileBar({ onOpen }: { onOpen: () => void }) {
  const { T } = useApp();
  const { data: info } = usePolling(getSystemInfo, 30_000);

  return (
    <div className="sticky top-0 z-30 flex items-center gap-3 border-b border-line bg-surface px-4 py-3 lg:hidden">
      <button
        type="button"
        onClick={onOpen}
        aria-label={T.nav_overview}
        className="grid size-7 place-items-center rounded-control text-ink-2 transition-colors hover:text-ink"
      >
        <Menu size={18} />
      </button>
      <span className="grid size-6 shrink-0 place-items-center rounded-control bg-brand text-brand-ink">
        <BrandMark size={15} />
      </span>
      <span className="min-w-0 truncate text-caption font-bold">{T.app_name}</span>
      <NavLink
        to="/system"
        title={info == null ? T.loading : info.gsm_connected ? T.module_ready : T.module_not_ready}
        aria-label={info == null ? T.loading : info.gsm_connected ? T.module_ready : T.module_not_ready}
        className="ms-auto grid size-6 place-items-center rounded-full"
      >
        <Dot
          tone={info == null ? 'muted' : info.gsm_connected ? 'ok' : 'bad'}
          pulse={info?.gsm_connected === true}
        />
      </NavLink>
    </div>
  );
}

/** ลูกโลก — lucide มี Globe แต่เส้นเยอะกว่าไอคอนอื่นในแถวนี้ วาดเองให้น้ำหนักเท่ากัน */
function GlobeIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  );
}
