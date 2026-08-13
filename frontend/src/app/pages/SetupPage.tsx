/**
 * SetupPage — รวม "กลุ่มผู้รับ" "ประเภทเหตุการณ์" และ "อุปกรณ์ & key" ไว้เมนูเดียว
 *
 * ── ทำไมรวม ────────────────────────────────────────────────────────────────
 * สามหน้านี้แยกกันไม่ได้ในทางความหมาย: อุปกรณ์จะยิงอะไรเข้ามาได้ ต้องเลือกจาก
 * ประเภทเหตุการณ์ที่มีอยู่ก่อน และต้องมีเบอร์ในระบบก่อนถึงจะเลือกผู้รับให้อุปกรณ์ได้
 * แยกเป็นคนละเมนูทำให้ต้องสลับไปมาระหว่างตั้งค่า และมองไม่เห็นว่าอีกฝั่งมีอะไรอยู่แล้วบ้าง
 *
 * เดิมมีแถบ "ลำดับการตั้งค่า" อยู่หัวหน้า ถอดออกแล้วตามที่ผู้ใช้ขอ — แท็บทั้งสามอยู่
 * เรียงตามลำดับที่ควรทำอยู่แล้ว และแต่ละหน้าบอกเองได้ว่ายังขาดอะไร
 */
import { NavLink, useLocation } from 'react-router';

import { cn } from '@/app/components/ui/utils';
import { PageHeader } from '../components/primitives';
import { useApp } from '../context/AppContext';
import { ContactsPage } from './ContactsPage';
import { DevicesPage } from './DevicesPage';
import { EventTypesPage } from './EventTypesPage';

type TabId = 'devices' | 'events' | 'contacts';

export function SetupPage() {
  const { T } = useApp();
  const location = useLocation();
  // แท็บมาจาก path ไม่ใช่ state — ลิงก์ตรงเข้า /event-types ยังใช้ได้เหมือนเดิม
  // และปุ่มย้อนกลับของเบราว์เซอร์ทำงานถูกต้องระหว่างสองแท็บ
  const tab: TabId = location.pathname.startsWith('/event-types')
    ? 'events'
    : location.pathname.startsWith('/contacts')
      ? 'contacts'
      : 'devices';

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={T.setup_title} meta={T.setup_sub} />

      {/* แท็บเป็นลิงก์จริง ไม่ใช่ปุ่มที่สลับ state — URL เปลี่ยนตาม จึงแชร์ลิงก์
          และกดปุ่มย้อนกลับได้ตามที่คนคาดหวังจากเมนูหลัก */}
      <div className="flex flex-wrap gap-1.5">
        {(
          [
            { id: 'contacts', to: '/contacts', label: T.setup_tab_contacts },
            { id: 'events', to: '/event-types', label: T.setup_tab_events },
            { id: 'devices', to: '/devices', label: T.setup_tab_devices },
          ] as const
        ).map((t) => (
          <NavLink
            key={t.id}
            to={t.to}
            className={cn(
              'rounded-full border px-3.5 py-1.5 text-caption whitespace-nowrap transition-colors',
              tab === t.id
                ? 'border-brand bg-brand-soft font-semibold text-ink'
                : 'border-line bg-surface font-medium text-ink hover:border-brand',
            )}
          >
            {t.label}
          </NavLink>
        ))}
      </div>

      {/* key={tab} บังคับให้ React สร้าง component ใหม่ตอนสลับแท็บ — state ภายใน
          (ฟอร์มที่กรอกค้างไว้, dialog ที่เปิดอยู่) จึงไม่ค้างข้ามแท็บ */}
      {tab === 'contacts' ? <ContactsPage key="contacts" embedded /> : null}
      {tab === 'events' ? <EventTypesPage key="events" embedded /> : null}
      {tab === 'devices' ? <DevicesPage key="devices" embedded /> : null}
    </div>
  );
}
