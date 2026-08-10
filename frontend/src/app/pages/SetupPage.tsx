/**
 * SetupPage — รวม "อุปกรณ์ & key" กับ "ประเภทเหตุการณ์" ไว้เมนูเดียว
 *
 * ── ทำไมรวม ────────────────────────────────────────────────────────────────
 * สองหน้านี้แยกกันไม่ได้ในทางความหมาย: อุปกรณ์จะยิงอะไรเข้ามาได้ ต้องเลือกจาก
 * ประเภทเหตุการณ์ที่มีอยู่ก่อน ส่วนประเภทเหตุการณ์ที่ไม่มีอุปกรณ์ไหนยิงได้ก็ไม่มีประโยชน์
 * แยกเป็นคนละเมนูทำให้ต้องสลับไปมาระหว่างตั้งค่า และมองไม่เห็นว่าอีกฝั่งมีอะไรอยู่แล้วบ้าง
 *
 * ── แถบลำดับการตั้งค่า ─────────────────────────────────────────────────────
 * จุดที่สับสนที่สุดของระบบนี้คือ "ต้องตั้งอะไรก่อนอะไร" — ต้องมีกลุ่มผู้รับก่อน
 * ถึงจะสร้างประเภทเหตุการณ์ได้ และต้องมีประเภทเหตุการณ์ก่อนถึงจะให้สิทธิ์อุปกรณ์ได้
 * เดิมรู้ได้ทางเดียวคือกดเข้าไปแล้วเจอปุ่มเป็นสีเทากดไม่ได้ โดยไม่บอกว่าเพราะอะไร
 * แถบนี้บอกทั้งลำดับ จำนวนที่มีอยู่แล้ว และขั้นที่ยังขาด พร้อมลิงก์ไปทำต่อ
 */
import { useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router';
import { Check } from 'lucide-react';

import { cn } from '@/app/components/ui/utils';
import { listApiKeys } from '../api/apiKeys';
import { listGroups } from '../api/groups';
import { listEventTypes } from '../api/eventTypes';
import { Card, PageHeader } from '../components/primitives';
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

  const [counts, setCounts] = useState<{ groups: number; events: number; devices: number } | null>(null);

  // นับใหม่ทุกครั้งที่สลับแท็บ — พอเพิ่มของในแท็บหนึ่งแล้วสลับกลับมา ตัวเลขจะตรงเสมอ
  // (ไม่ poll ถี่ เพราะเป็นข้อมูลที่เปลี่ยนเฉพาะตอนผู้ใช้กดเพิ่ม/ลบเอง)
  useEffect(() => {
    let cancelled = false;
    void Promise.all([listGroups(), listEventTypes(), listApiKeys()])
      .then(([g, e, d]) => {
        if (!cancelled) setCounts({ groups: g.length, events: e.length, devices: d.length });
      })
      .catch(() => {
        /* นับไม่ได้ก็แค่ไม่โชว์แถบ ไม่ต้องรบกวนผู้ใช้ด้วย error — เนื้อหาหลักยังใช้งานได้ปกติ */
      });
    return () => {
      cancelled = true;
    };
  }, [tab]);

  const steps = [
    {
      to: '/contacts',
      label: T.setup_step_group,
      hint: T.setup_step_group_hint,
      n: counts?.groups ?? 0,
    },
    {
      to: '/event-types',
      label: T.setup_step_event,
      hint: T.setup_step_event_hint,
      n: counts?.events ?? 0,
    },
    {
      to: '/devices',
      label: T.setup_step_device,
      hint: T.setup_step_device_hint,
      n: counts?.devices ?? 0,
    },
  ];

  // ขั้นแรกที่ยังไม่มีของ = จุดที่ต้องไปทำต่อ (ขั้นถัดไปทำไม่ได้จนกว่าขั้นนี้จะเสร็จ)
  const firstMissing = steps.findIndex((s) => s.n === 0);
  const allReady = counts !== null && firstMissing === -1;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={T.setup_title} meta={T.setup_sub} />

      {counts !== null ? (
        <Card className="flex flex-col gap-3 p-4">
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="font-mono text-micro tracking-[0.12em] text-ink-2 uppercase">
              {T.setup_flow_title}
            </span>
            <span
              className={cn(
                'flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-micro',
                allReady ? 'border-ok bg-ok-soft text-ok' : 'border-warn bg-warn-soft text-warn',
              )}
            >
              {allReady ? <Check size={12} /> : null}
              {allReady ? T.setup_ready : T.setup_blocked(steps[firstMissing].label)}
            </span>
          </div>

          {/* 3 ขั้นเรียงซ้ายไปขวาบนจอกว้าง ซ้อนลงบนจอแคบ — ลำดับคือสาระของแถบนี้
              จึงต้องอ่านจากซ้ายไปขวา/บนลงล่างได้เสมอ ห้ามให้ wrap สลับตำแหน่งกัน */}
          <ol className="grid gap-2 sm:grid-cols-3">
            {steps.map((s, i) => {
              const done = s.n > 0;
              // ขั้นที่ทำไม่ได้เพราะขั้นก่อนหน้ายังไม่เสร็จ — บอกด้วยความจาง ไม่ใช่ซ่อน
              const locked = firstMissing !== -1 && i > firstMissing;
              return (
                <li key={s.to}>
                  <NavLink
                    to={s.to}
                    className={cn(
                      'flex h-full items-start gap-2.5 rounded-control border px-3 py-2.5 transition-colors',
                      done ? 'border-ok/40 bg-ok-soft/25' : 'border-line bg-surface-2',
                      locked && 'opacity-55',
                      'hover:border-brand',
                    )}
                  >
                    <span
                      className={cn(
                        'mt-px grid size-5 shrink-0 place-items-center rounded-full font-mono text-[10px] font-bold',
                        done ? 'bg-ok text-white' : 'border border-line text-ink-2',
                      )}
                    >
                      {done ? <Check size={11} /> : i + 1}
                    </span>
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className="flex flex-wrap items-baseline gap-x-1.5">
                        <span className="text-caption font-semibold">{s.label}</span>
                        <span className={cn('font-mono text-micro', done ? 'text-ok' : 'text-ink-2')}>
                          {done ? T.setup_count(s.n) : T.setup_none}
                        </span>
                      </span>
                      <span className="text-micro leading-[1.5] text-ink-2">{s.hint}</span>
                    </span>
                  </NavLink>
                </li>
              );
            })}
          </ol>
        </Card>
      ) : null}

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
