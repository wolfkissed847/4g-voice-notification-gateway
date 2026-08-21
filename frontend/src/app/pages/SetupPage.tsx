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
import { useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router';

import { cn } from '@/app/components/ui/utils';
import { listApiKeys } from '../api/apiKeys';
import { listEventTypes } from '../api/eventTypes';
import { listGroups } from '../api/groups';
import { PageHeader } from '../components/primitives';
import { useApp } from '../context/AppContext';
import { SNAP, readSnapshot, writeSnapshot } from '../lib/snapshot';
import { ContactsPage } from './ContactsPage';
import { DevicesPage } from './DevicesPage';
import { EventTypesPage } from './EventTypesPage';

type TabId = 'devices' | 'events' | 'contacts';

export function SetupPage() {
  const { T } = useApp();
  const location = useLocation();

  /* จำนวนของแต่ละแท็บ — เดิมแท็บบอกแค่ชื่อ ต้องกดเข้าไปทีละแท็บถึงจะรู้ว่าตั้งค่าอะไรไปแล้วบ้าง
     ซึ่งเป็นคำถามแรกของคนที่เปิดหน้านี้ ("ยังไม่ได้เพิ่มอุปกรณ์เลยหรือเพิ่มไปแล้ว")
     ตัวเลขบนแท็บตอบให้ตั้งแต่ยังไม่กด และเห็นทันทีว่าแท็บไหนยังว่าง = ยังต้องไปทำ

     ยิงครั้งเดียวตอนเข้าหน้า ไม่ตามการเปลี่ยนแปลงในแท็บ — ตัวเลขอาจล้าไปหนึ่งจังหวะ
     หลังเพิ่ม/ลบ ซึ่งรับได้เพราะแท็บที่กำลังเปิดอยู่แสดงรายการจริงให้เห็นเต็มๆ อยู่แล้ว */
  const [counts, setCounts] = useState<Record<TabId, number | null>>(
    () =>
      readSnapshot<Record<TabId, number | null>>(SNAP.setupCounts) ?? {
        contacts: null,
        events: null,
        devices: null,
      },
  );

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      listGroups().catch(() => []),
      listEventTypes().catch(() => []),
      listApiKeys().catch(() => []),
    ]).then(([g, e, k]) => {
      if (cancelled) return;
      const next = { contacts: g.length, events: e.length, devices: k.length };
      setCounts(next);
      writeSnapshot(SNAP.setupCounts, next);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  // แท็บมาจาก path ไม่ใช่ state — ลิงก์ตรงเข้า /event-types ยังใช้ได้เหมือนเดิม
  // และปุ่มย้อนกลับของเบราว์เซอร์ทำงานถูกต้องระหว่างสองแท็บ
  const tab: TabId = location.pathname.startsWith('/event-types')
    ? 'events'
    : location.pathname.startsWith('/contacts')
      ? 'contacts'
      : 'devices';

  return (
    /* gap-3.5 ให้ตรงกับหน้าคิว/ประวัติ — เดิมเป็น gap-4 อยู่หน้าเดียว
       ต่างกันแค่ 4px แต่พอวางเรียงกับหน้าอื่นแล้วจังหวะไม่ตรงกัน */
    <div className="flex flex-col gap-3.5">
      <PageHeader title={T.setup_title} meta={T.setup_sub} />

      {/* แท็บเป็นลิงก์จริง ไม่ใช่ปุ่มที่สลับ state — URL เปลี่ยนตาม จึงแชร์ลิงก์
          และกดปุ่มย้อนกลับได้ตามที่คนคาดหวังจากเมนูหลัก

          รูปทรงตามไฟล์ดีไซน์ figma/Redesign Notification Settings: ชิปกลมพร้อมตัวเลขกำกับ
          (เคยลองทำเป็นการ์ดสรุปใบใหญ่ตามที่โค้ดในโฟลเดอร์นั้นเขียนไว้ แต่ภาพอ้างอิงจริง
           เป็นชิป — โค้ดกับภาพในโฟลเดอร์เดียวกันเป็นคนละรุ่น ยึดตามภาพ)

          ตัวเลขบนชิปตอบคำถามแรกของคนที่เปิดหน้านี้ตั้งแต่ยังไม่กด — "ยังไม่ได้เพิ่ม
          อุปกรณ์เลยหรือเพิ่มไปแล้ว" และเห็นทันทีว่าแท็บไหนยังเป็น 0 = ยังต้องไปทำ */}
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
              {counts[t.id] === null ? null : (
                <span
                  className={cn(
                    'rounded-full px-1.5 py-0.5 font-mono text-micro leading-none tabular-nums',
                    on ? 'bg-brand-ink/20 text-brand-ink' : 'bg-surface-2 text-ink-2',
                  )}
                >
                  {counts[t.id]}
                </span>
              )}
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
