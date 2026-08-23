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
    /* gap-3.5 ให้ตรงกับหน้าคิว/ประวัติ — เดิมเป็น gap-4 อยู่หน้าเดียว
       ต่างกันแค่ 4px แต่พอวางเรียงกับหน้าอื่นแล้วจังหวะไม่ตรงกัน

       ความสูงต่างกันตามแท็บโดยตั้งใจ:
       - กลุ่มผู้รับ กับ ประเภทเหตุการณ์ ใช้ h-full เพราะข้างในมีตารางที่ขอ "ที่ที่เหลือ"
         (flex-1) ไปเลื่อนในตัวเอง ซึ่งต้องการความสูงที่แน่นอนถึงจะคำนวณได้
         min-h-full ใช้แทนไม่ได้ — min-height ไม่นับเป็นความสูงที่แน่นอนในการแบ่งพื้นที่
         ของ flex ตารางจะยืดตามเนื้อหาแล้วดันทั้งหน้าให้เลื่อนแทนที่จะเลื่อนอยู่ในตาราง
         (วัดจริงแล้ว: กล่องสูง 1011px แทนที่จะพอดีจอ)
       - แท็บอุปกรณ์เป็นกริดการ์ดที่ยาวเกินจอได้ตามปกติ จึงใช้ min-h-full
         ถ้าตรึงเป็น h-full ส่วนที่เกินจะล้นออกไปโดยที่ padding ล่างของ main ไม่ทำงาน */
    <div className={cn('flex flex-col gap-3.5', tab === 'devices' ? 'min-h-full' : 'h-full min-h-0')}>
      <PageHeader title={T.setup_title} meta={T.setup_sub} />

      {/* แท็บเป็นลิงก์จริง ไม่ใช่ปุ่มที่สลับ state — URL เปลี่ยนตาม จึงแชร์ลิงก์
          และกดปุ่มย้อนกลับได้ตามที่คนคาดหวังจากเมนูหลัก

          รูปทรงตามไฟล์ดีไซน์ figma/Redesign Notification Settings: ชิปกลม
          (เคยลองทำเป็นการ์ดสรุปใบใหญ่ตามที่โค้ดในโฟลเดอร์นั้นเขียนไว้ แต่ภาพอ้างอิงจริง
           เป็นชิป — โค้ดกับภาพในโฟลเดอร์เดียวกันเป็นคนละรุ่น ยึดตามภาพ)

          เคยมีตัวเลขจำนวนกำกับอยู่บนชิป เอาออกตามที่ผู้ใช้ขอ — และเมื่อไม่ต้องโชว์ตัวเลข
          ก็ไม่ต้องยิงขอรายการทั้งสามชุดตอนเข้าหน้าอีก เหลือแค่ชุดของแท็บที่เปิดอยู่จริง */}
      <div className="flex flex-wrap gap-2">
        {(
          [
            { id: 'contacts', to: '/contacts', label: T.setup_tab_contacts },
            { id: 'events', to: '/event-types', label: T.setup_tab_events },
            { id: 'devices', to: '/devices', label: T.setup_tab_devices },
          ] as const
        ).map((t) => {
          const on = tab === t.id;
          return (
            <NavLink
              key={t.id}
              to={t.to}
              className={cn(
                'flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-caption whitespace-nowrap transition-colors',
                on
                  ? 'border-brand bg-brand font-semibold text-brand-ink'
                  : 'border-line bg-surface font-medium text-ink shadow-card hover:border-brand-strong',
              )}
            >
              {t.label}
            </NavLink>
          );
        })}
      </div>

      {/* key={tab} บังคับให้ React สร้าง component ใหม่ตอนสลับแท็บ — state ภายใน
          (ฟอร์มที่กรอกค้างไว้, dialog ที่เปิดอยู่) จึงไม่ค้างข้ามแท็บ */}
      {tab === 'contacts' ? <ContactsPage key="contacts" embedded /> : null}
      {tab === 'events' ? <EventTypesPage key="events" embedded /> : null}
      {tab === 'devices' ? <DevicesPage key="devices" embedded /> : null}
    </div>
  );
}
