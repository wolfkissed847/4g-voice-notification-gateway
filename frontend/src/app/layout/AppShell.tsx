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
import { NavLink, Outlet, useNavigate } from 'react-router';

import { cn } from '@/app/components/ui/utils';
import { clearToken } from '../api/client';
import { getSystemInfo } from '../api/system';
import { useApp } from '../context/AppContext';
import { usePolling } from '../lib/usePolling';
import { Dot } from '../components/primitives';

export function AppShell() {
  return (
    <div className="flex min-h-screen flex-col bg-bg text-ink">
      <Header />
      <main className="mx-auto w-full max-w-[1180px] flex-1 px-4 pt-6 pb-16 md:px-5">
        <Outlet />
      </main>
    </div>
  );
}

const chipCls =
  'rounded-full border border-line bg-surface px-2.5 py-1 font-mono text-micro text-ink-2 transition-colors hover:border-brand';

function Header() {
  const { T, dark, toggleDark, lang, toggleLang } = useApp();
  const navigate = useNavigate();

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
        <nav className="order-3 flex w-full flex-wrap gap-1">
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
          <span className="flex items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 py-1 font-mono text-micro whitespace-nowrap text-ink-2">
            <Dot tone={info?.gsm_connected ? 'ok' : 'bad'} pulse={info?.gsm_connected} />
            {info?.gsm_connected ? T.module_ready : T.module_not_ready}
          </span>

          <button type="button" onClick={toggleLang} className={chipCls}>
            {lang === 'th' ? 'EN' : 'ไทย'}
          </button>

          <button type="button" onClick={toggleDark} className={chipCls}>
            {dark ? T.sys_theme_to_light : T.sys_theme_to_dark}
          </button>

          <button type="button" onClick={logout} className={chipCls}>
            {T.sign_out_short}
          </button>
        </div>
      </div>
    </header>
  );
}
