/**
 * DevicesPage — พอร์ตจาก figma/handoff/components/DeviceListPage.tsx
 * แทนหน้า ApiKeysPage เดิม (1 key = 1 อุปกรณ์)
 *
 * ── ต่างจากดีไซน์ เพราะ backend เป็นแบบนี้จริง ──────────────────────────
 * 1. ดีไซน์โชว์ key เต็มแล้วมีปุ่มคัดลอก — ทำไม่ได้ backend เก็บแค่ sha256 hash
 *    ดูได้แค่ key_prefix (14 ตัวแรก) จึงตัดปุ่มคัดลอกออก ไม่แสร้งว่าคัดลอกได้
 * 2. ดีไซน์มีปุ่ม เปิด/ปิด สลับได้ — backend ไม่มี endpoint ปิดชั่วคราว มีแต่ลบถาวร
 *    จึงเหลือปุ่มเดียวคือลบ แบบยืนยัน 2 จังหวะตามดีไซน์
 *    (6 ส.ค. 2569 เปลี่ยนจาก "เพิกถอน" = ปิดใช้งานแต่แถวยังอยู่ เป็น "ลบ" = ลบออกจาก DB จริง
 *     ประวัติการโทรไม่หายเพราะ call_jobs เก็บชื่ออุปกรณ์เป็น snapshot ไว้แล้ว)
 * 3. ดีไซน์มี type (sensor/switch/gps), place, rule, phones, retry, quiet ต่ออุปกรณ์
 *    ของเราไม่มี field พวกนั้น — แทนด้วยรายการ event type ที่อุปกรณ์นี้ยิงได้ (ของจริง)
 * 4. สถานะ online มาจาก last_used_at (heartbeat) ไม่ใช่ field แยก
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';

import { cn } from '@/app/components/ui/utils';
import { listApiKeys, deleteApiKey } from '../api/apiKeys';
import { ApiError } from '../api/client';
import { listEventTypes, sendTestNotify } from '../api/eventTypes';
import { AddDeviceDialog } from '../components/AddDeviceDialog';
import { Btn, Card, PageHeader, Pill, control } from '../components/primitives';
import { useApp } from '../context/AppContext';
import type { ApiKey, EventType } from '../types';

/** ถือว่า "เพิ่งส่งข้อมูล" ถ้าใช้ key ภายใน 15 นาที — ใช้ last_used_at เป็น heartbeat */
const ONLINE_WINDOW_MS = 15 * 60 * 1000;

function isRecentlyActive(lastUsedAt: string | null): boolean {
  if (!lastUsedAt) return false;
  return Date.now() - new Date(lastUsedAt).getTime() < ONLINE_WINDOW_MS;
}

export function DevicesPage() {
  const { T } = useApp();
  const navigate = useNavigate();
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [eventTypes, setEventTypes] = useState<EventType[]>([]);
  const [pendingDelete, setPendingDelete] = useState<number | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [loading, setLoading] = useState(true);

  // ทุก action ที่ยิง API ต้องมี catch ของตัวเอง — ไม่งั้นตอน backend ตอบ error
  // (เช่น key ถูกลบไปแล้วจากอีกแท็บ, event type ถูกปิด) หน้าเว็บจะเงียบสนิท
  // ดูเหมือน "กดแล้วไม่มีอะไรเกิดขึ้น" ทั้งที่จริงมี error อยู่ใน console
  const reload = async () => {
    try {
      const [k, e] = await Promise.all([listApiKeys(), listEventTypes()]);
      setKeys(k);
      setEventTypes(e);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : T.error_generic);
    } finally {
      // ต้องอยู่ใน finally — เดิมอยู่นอก try พอโหลดพลาดค่า loading ค้างเป็น true ตลอด
      // ทำให้ทั้งกล่อง "ยังไม่มีอุปกรณ์" และตัวเลขสรุปบนหัวหน้าไม่ขึ้นเลย
      setLoading(false);
    }
  };

  useEffect(() => {
    void reload();
  }, []);

  const remove = async (id: number) => {
    try {
      await deleteApiKey(id);
      toast.success(T.toast_deleted);
      await reload();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : T.error_generic);
    } finally {
      setPendingDelete(null);
    }
  };

  const testCall = async (device: ApiKey) => {
    const first = device.allowed_event_types[0];
    if (!first) {
      toast.error(T.allowed_events_none);
      return;
    }
    try {
      await sendTestNotify({ event_type_code: first.code });
      toast.success(T.toast_created);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : T.error_generic);
    }
  };

  const active = keys.filter((k) => k.is_active).length;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={T.devices_title}
        meta={loading ? T.devices_sub : T.devices_summary(keys.length, active)}
        action={
          <Btn variant="primary" onClick={() => setShowAdd(true)}>
            + {T.add_device}
          </Btn>
        }
      />

      <div className="grid grid-cols-[repeat(auto-fill,minmax(min(290px,100%),1fr))] gap-3">
        {keys.map((d) => {
          const pending = pendingDelete === d.id;
          const online = d.is_active && isRecentlyActive(d.last_used_at);
          // min-w-0 บนตัว Card เอง: การ์ดเป็น grid item ซึ่ง min-width เริ่มต้นเป็น auto
          // = ย่อเล็กกว่าเนื้อหาไม่ได้ ชื่ออุปกรณ์ยาวๆ หรือ key เลยดันการ์ดล้นออกนอกคอลัมน์
          // (truncate ที่ลูกจะไม่ทำงานเลยถ้าสายแม่ยังย่อไม่ได้)
          return (
            <Card key={d.id} className={cn('flex min-w-0 flex-col gap-2.5 p-4', !d.is_active && 'opacity-60')}>
              <div className="flex min-w-0 items-center gap-2">
                <span className={cn('size-2 shrink-0 rounded-full', online ? 'bg-ok' : 'bg-ink-2')} />
                {/* min-w-0 + truncate: ชื่ออุปกรณ์ไทยยาวไม่ดันชิปตกบรรทัด */}
                <span className="min-w-0 flex-1 truncate text-lead font-semibold">{d.name}</span>
                {d.is_active ? null : <Pill tone="muted">{T.status_revoked}</Pill>}
              </div>

              {/* ไม่มีปุ่มคัดลอก — backend ไม่เก็บ key เต็ม มีแต่ hash */}
              <div className={cn(control, 'flex min-w-0 items-center gap-2 px-2.5 py-2')}>
                <span className="min-w-0 flex-1 truncate font-mono text-caption">{d.key_prefix}•••••</span>
                <span className="shrink-0 font-mono text-micro text-ink-2 whitespace-nowrap">
                  {isRecentlyActive(d.last_used_at)
                    ? T.device_online
                    : d.last_used_at
                      ? new Date(d.last_used_at).toLocaleDateString()
                      : T.device_never_used}
                </span>
              </div>

              <div className="flex min-w-0 flex-col gap-1.5">
                <p className="text-caption text-ink-2">{T.allowed_events_label}</p>
                {d.allowed_event_types.length === 0 ? (
                  <p className="text-caption leading-[1.8] text-warn">{T.allowed_events_none}</p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {d.allowed_event_types.map((e) => (
                      <Pill key={e.id} tone="accent">
                        {e.display_name}
                      </Pill>
                    ))}
                  </div>
                )}
              </div>

              {/* flex-wrap: ปุ่มตกบรรทัดเองเมื่อ label ไทยยาวขึ้น */}
              <div className="mt-0.5 flex flex-wrap gap-2">
                <Btn className="min-w-[70px] flex-1" onClick={() => navigate(`/devices/${d.id}`)}>
                  {T.device_configure}
                </Btn>
                <Btn onClick={() => void testCall(d)} disabled={!d.is_active}>
                  {T.device_test_call}
                </Btn>
                {/* ปุ่มลบต้องขึ้นเสมอ ไม่ผูกกับ is_active — เดิมซ่อนเมื่อ key ถูกเพิกถอน
                    ซึ่งพอเปลี่ยนมาเป็น "ลบจริง" แล้วกลายเป็นกับดัก: แถวที่เพิกถอนไว้ตั้งแต่ระบบเก่า
                    จะค้างอยู่ในรายการตลอดไปโดยไม่มีทางลบออกจากหน้าเว็บได้เลย */}
                <Btn
                  variant={pending ? 'danger' : 'ghost'}
                  onClick={() => (pending ? void remove(d.id) : setPendingDelete(d.id))}
                >
                  {pending ? T.device_remove_confirm : T.device_remove}
                </Btn>
              </div>
            </Card>
          );
        })}

        {!loading && keys.length === 0 ? (
          <div className="flex flex-col items-center gap-2.5 rounded-card border border-dashed border-line px-4 py-7 text-center">
            <p className="text-lead font-semibold">{T.devices_empty_title}</p>
            <p className="text-caption text-ink-2">{T.devices_empty_body}</p>
            {eventTypes.length === 0 ? (
              <p className="text-caption text-warn">{T.allowed_events_empty_hint}</p>
            ) : null}
            <Btn variant="primary" className="mt-0.5" onClick={() => setShowAdd(true)}>
              + {T.add_device}
            </Btn>
          </div>
        ) : null}
      </div>

      {showAdd ? (
        <AddDeviceDialog
          eventTypes={eventTypes}
          onClose={() => setShowAdd(false)}
          onCreated={() => void reload()}
          onConfigure={(id) => navigate(`/devices/${id}`)}
        />
      ) : null}
    </div>
  );
}
