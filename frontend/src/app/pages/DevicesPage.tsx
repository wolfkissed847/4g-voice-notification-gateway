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
 * 4. ไม่มีสถานะ online/offline — อุปกรณ์ไม่ได้ ping เข้ามาเรื่อยๆ มันยิงเฉพาะตอนมีเรื่อง
 *    แจ้งเท่านั้น ป้าย "ออนไลน์/เงียบอยู่" จึงโกหก: เครื่องที่ปกติดีทุกอย่างจะขึ้นว่า
 *    "เงียบอยู่" เกือบตลอดเวลา เพราะไม่มีเหตุให้แจ้ง ซึ่งเป็นสิ่งที่ควรเกิด ไม่ใช่ปัญหา
 *    แทนด้วย "ความพร้อม" — ถ้าตอนนี้เกิดเรื่องขึ้น เครื่องนี้จะโทรออกได้จริงหรือเปล่า
 *
 * ── รอบล่าสุด: การ์ดเต็มความกว้าง → กริดการ์ดเล็ก + ป๊อปอัพ ──────────────
 * เดิมแต่ละอุปกรณ์เป็นการ์ดเต็มความกว้างที่กาง key, ชิปเหตุการณ์ครบทุกอัน และปุ่ม 3 ปุ่ม
 * ไว้ตลอดเวลา ตกใบละราว 250px พอมีอุปกรณ์จริง 19 ตัวก็ยาวเกือบ 5,000px ต้องเลื่อนผ่าน
 * ทุกใบเพื่อไปหาใบที่ต้องการ ทั้งที่เกือบทุกครั้งที่เข้าหน้านี้คือ "หาอุปกรณ์ตัวหนึ่ง"
 * ไม่ใช่ "อ่านรายละเอียดของทุกตัวไล่ลงมา"
 *
 * ตอนนี้แต่ละใบเหลือแค่ที่ใช้หา คือ ชื่อ + สถานะ + key + "ยิงอะไรได้/โทรหาใคร" เรียงเป็น
 * กริด 4 คอลัมน์ (เห็นได้ราว 12 ตัวโดยไม่ต้องเลื่อน) รายละเอียดกับปุ่มทั้งหมดย้ายเข้าป๊อปอัพ
 * ที่เปิดตอนกดการ์ด และมีช่องค้นหาสำหรับตอนที่อุปกรณ์เยอะจนกริดก็ยังยาว
 *
 * ── ทำไมสองช่องกลางไม่ใช่ "แบตเตอรี่ / สัญญาณ" ตามภาพอ้างอิง ──────────────
 * อุปกรณ์ไม่เคยส่งสถานะของตัวเองเข้ามาเลย มันยิงแค่ "เกิดเรื่องนี้" ผ่าน API
 * ค่าพวกนั้นจึงไม่มีอยู่จริงในระบบ และหน้านี้คือหน้าที่คนเปิดมาดูว่าระบบพร้อมทำงานมั้ย
 * ตัวเลขที่แต่งขึ้นอันตรายกว่าไม่มีตัวเลข แทนด้วยสองอย่างที่มีจริงและตอบคำถามที่คนถาม
 * จริงเกี่ยวกับอุปกรณ์: มันยิงเรื่องอะไรได้ และยิงแล้วใครได้รับสาย
 * ("โทรหา: ยังไม่ได้ตั้ง" = ยิงเข้ามาแล้วไม่มีใครรับสาย ซึ่งเดิมต้องกดเข้าไปดูทีละตัว)
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';

import { ArrowRight, Bell, Cpu, Eye, Pencil, PhoneOutgoing, Trash2, Users } from 'lucide-react';

import { cn } from '@/app/components/ui/utils';
import { listApiKeys, deleteApiKey, updateApiKey } from '../api/apiKeys';
import { ApiError } from '../api/client';
import { listEventTypes, sendTestNotify } from '../api/eventTypes';
import { AddDeviceDialog } from '../components/AddDeviceDialog';
import { Toggle } from '../components/Toggle';
import { Btn, Card, PageHeader, Pill, control, inputCls } from '../components/primitives';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../components/ui/alert-dialog';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { useApp } from '../context/AppContext';
import { TONE_RGB, readiness } from '../lib/deviceReadiness';
import { SNAP, readSnapshot, writeSnapshot } from '../lib/snapshot';
import type { ApiKey, EventType } from '../types';

/** ต่ำกว่านี้ช่องค้นหาเป็นแค่ของรกที่ไม่มีวันได้ใช้ — กวาดตาหาเองเร็วกว่าพิมพ์ */
const SEARCH_THRESHOLD = 6;


/** วันที่แบบเต็ม ("18 สิงหาคม 2569") — ไทยได้ปี พ.ศ. จาก locale เอง ไม่ต้องบวก 543 เอง */
function longDate(iso: string, lang: string): string {
  return new Date(iso).toLocaleDateString(lang === 'th' ? 'th-TH' : 'en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

/**
 * "โทรหาใคร" สรุปเป็นบรรทัดเดียว
 *
 * ผู้รับสายไม่ได้ผูกกับอุปกรณ์ตรงๆ แต่ผูกกับคู่ (อุปกรณ์ + เหตุการณ์) แต่ละเหตุการณ์
 * เลือกได้ว่าจะใช้ทั้งกลุ่มหรือเจาะเป็นรายเบอร์ การ์ดจึงต้องยุบให้เหลือตัวเลขที่อ่านจบ
 * ในครึ่งวินาที — นับกลุ่มที่ไม่ซ้ำกับเบอร์ที่ไม่ซ้ำ แล้วบอกเท่าที่มีจริง
 */
function recipientLabel(device: ApiKey, T: ReturnType<typeof useApp>['T']): string {
  const groups = new Set<string>();
  const phones = new Set<string>();
  device.allowed_event_types.forEach((e) => {
    // เจาะเบอร์เองมาก่อนเสมอ — ถ้ามี contacts backend จะไม่สนใจ group_id ของคู่นั้น
    if (e.contacts.length > 0) e.contacts.forEach((c) => phones.add(c.phone_number));
    else if (e.group_name) groups.add(e.group_name);
  });
  if (groups.size > 0 && phones.size > 0) return T.device_recipients_mixed(groups.size, phones.size);
  if (groups.size > 0) return T.device_recipients_groups(groups.size);
  if (phones.size > 0) return T.device_recipients_phones(phones.size);
  return T.device_recipients_none;
}


/** ข้อมูลที่ฝากไว้ให้รอบหน้าหยิบไปวาดทันที (ดู lib/snapshot.ts) */
type DevicesSnap = { keys: ApiKey[]; eventTypes: EventType[] };

/** embedded = ถูกฝังอยู่ในหน้า SetupPage ที่มีหัวข้อของตัวเองแล้ว จึงไม่ต้องขึ้นหัวข้อซ้ำ */
export function DevicesPage({ embedded = false }: { embedded?: boolean } = {}) {
  const { T, lang } = useApp();
  const navigate = useNavigate();
  const cached = readSnapshot<DevicesSnap>(SNAP.devices);
  const [keys, setKeys] = useState<ApiKey[]>(cached?.keys ?? []);
  const [eventTypes, setEventTypes] = useState<EventType[]>(cached?.eventTypes ?? []);
  // เก็บทั้งตัวอุปกรณ์ ไม่ใช่แค่ id — ป๊อปอัพยืนยันต้องเอาชื่อไปแสดง และถ้าเก็บแค่ id
  // แล้วรายการโหลดใหม่พอดีระหว่างที่ป๊อปอัพเปิดอยู่ ชื่อจะหายไปกลางคัน
  const [deleteTarget, setDeleteTarget] = useState<ApiKey | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [openId, setOpenId] = useState<number | null>(null);
  const [query, setQuery] = useState('');
  // มีของเก่าอยู่แล้ว = ไม่ต้องขึ้นกล่อง "ยังไม่มีอุปกรณ์" หรือหัวข้อแบบไม่มีตัวเลข
  // ให้วาดของเก่าไปก่อนแล้วโหลดทับเงียบๆ
  const [loading, setLoading] = useState(!cached);

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

  // ฝากของชุดล่าสุดไว้ทุกครั้งที่มันเปลี่ยน ไม่ใช่แค่ตอนโหลดเสร็จ
  useEffect(() => {
    if (!loading) writeSnapshot<DevicesSnap>(SNAP.devices, { keys, eventTypes });
  }, [loading, keys, eventTypes]);

  const remove = async (id: number) => {
    try {
      await deleteApiKey(id);
      toast.success(T.toast_deleted);
      setOpenId(null);
      await reload();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : T.error_generic);
    } finally {
      setDeleteTarget(null);
    }
  };

  /**
   * เปิด/ปิดอุปกรณ์ — สลับใน UI ทันทีแล้วค่อยยิง API ถ้าพลาดค่อยย้อนกลับ
   *
   * สลับทันทีเพราะสวิตช์ที่ต้องรอ API ก่อนถึงจะขยับ ให้ความรู้สึกว่ากดไม่ติด
   * แล้วคนจะกดซ้ำ — ซึ่งกลายเป็นสลับสองครั้ง = กลับที่เดิม
   */
  const toggleActive = async (device: ApiKey, next: boolean) => {
    const apply = (v: boolean) => setKeys((ks) => ks.map((k) => (k.id === device.id ? { ...k, is_active: v } : k)));
    apply(next);
    try {
      await updateApiKey(device.id, { is_active: next });
      toast.success(T.toast_updated);
    } catch (e) {
      apply(!next);
      toast.error(e instanceof ApiError ? e.message : T.error_generic);
    }
  };

  const testCall = async (device: ApiKey) => {
    const first = device.allowed_event_types[0];
    if (!first) {
      toast.error(T.allowed_events_none);
      return;
    }
    try {
      await sendTestNotify({ event_type_code: first.code, device_id: device.id });
      toast.success(T.toast_created);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : T.error_generic);
    }
  };

  const active = keys.filter((k) => k.is_active).length;

  /* ค้นหาจากชื่อเป็นหลัก แต่รวม key_prefix ด้วย — เวลาไล่ปัญหาจริง สิ่งที่อยู่ในมือ
     มักเป็น key ที่ก๊อปมาจาก log ของอุปกรณ์ ไม่ใช่ชื่อที่ตั้งไว้ในเว็บ */
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return keys;
    return keys.filter((d) => d.name.toLowerCase().includes(q) || d.key_prefix.toLowerCase().includes(q));
  }, [keys, query]);

  const opened = keys.find((d) => d.id === openId) ?? null;

  return (
    <div className="flex flex-col gap-4">
      {/* ช่องค้นหา · ตัวเลขสรุป · ปุ่มเพิ่ม อยู่บรรทัดเดียวกัน
          เดิมแยกเป็นสองแถว (สรุป+ปุ่มข้างบน ช่องค้นหาข้างล่าง) ซึ่งกินความสูงสองเท่า
          ทั้งที่ทั้งสามอย่างเป็นแถบเครื่องมือของรายการเดียวกัน
          ช่องค้นหาเป็นตัวที่ยืด (flex-1) จึงดันสรุปกับปุ่มไปชิดขวาเองโดยไม่ต้องใช้ ms-auto
          บนจอแคบทั้งสามยังตกบรรทัดเองได้ตามปกติด้วย flex-wrap */}
      {embedded ? (
        <div className="flex flex-wrap items-center gap-3">
          {keys.length > SEARCH_THRESHOLD ? (
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={T.device_search}
              aria-label={T.device_search}
              className={cn(inputCls, 'w-full sm:w-[20rem]')}
            />
          ) : null}
          {/* ms-auto ที่ตัวเลขสรุป = สรุปกับปุ่มเกาะขวาสุดเสมอ ส่วนช่องค้นหาเกาะซ้าย
              ตรงกับแถบเครื่องมือของหน้าอื่น (ปุ่มหลักอยู่มุมขวาบนของพื้นที่เนื้อหา) */}
          <p className="ms-auto font-mono text-caption text-ink-2">
            {loading ? T.devices_sub : T.devices_summary(keys.length, active)}
          </p>
          <span>
            <Btn variant="primary" onClick={() => setShowAdd(true)}>
              + {T.add_device}
            </Btn>
          </span>
        </div>
      ) : (
        <PageHeader
          title={T.devices_title}
          meta={loading ? T.devices_sub : T.devices_summary(keys.length, active)}
          action={
            <Btn variant="primary" onClick={() => setShowAdd(true)}>
              + {T.add_device}
            </Btn>
          }
        />
      )}

      {/* หน้าแบบเต็ม (เปิด /devices ตรงๆ ไม่ผ่านแท็บ) หัวเรื่องเป็น PageHeader
          ซึ่งมีปุ่มอยู่ในตัวแล้ว ช่องค้นหาจึงอยู่แถวของมันเอง */}
      {!embedded && keys.length > SEARCH_THRESHOLD ? (
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={T.device_search}
          aria-label={T.device_search}
          className={cn(inputCls, 'max-w-[20rem]')}
        />
      ) : null}

      {/* กริดการ์ด: แต่ละใบตอบสามคำถามที่คนถามถึงอุปกรณ์ตัวหนึ่ง — มันคือเครื่องไหน
          ตอนนี้ยังส่งข้อมูลอยู่มั้ย และมันยิงอะไรได้แล้วโทรหาใคร
          รายละเอียดเต็ม (key, รายชื่อเหตุการณ์, ทดสอบโทร) อยู่ในป๊อปอัพที่เปิดตอนกด */}
      <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {shown.map((d) => {
          const ready = readiness(d, T);
          const openDetail = () => setOpenId(d.id);
          // min-w-0 บนตัว Card เอง: การ์ดเป็น grid item ซึ่ง min-width เริ่มต้นเป็น auto
          // = ย่อเล็กกว่าเนื้อหาไม่ได้ ชื่ออุปกรณ์ยาวๆ หรือ key เลยดันการ์ดล้นออกนอกคอลัมน์
          // (truncate ที่ลูกจะไม่ทำงานเลยถ้าสายแม่ยังย่อไม่ได้)
          return (
            <Card
              key={d.id}
              className={cn('flex min-w-0 flex-col overflow-hidden p-0', !d.is_active && 'opacity-60')}
            >
              {/* ส่วนบนกดได้ทั้งแผง = เปิดรายละเอียด ทำอย่างเดียวกับปุ่ม "ดู" ข้างล่าง
                  เก็บไว้ทั้งคู่เพราะคนละความคาดหวัง — บางคนกดที่การ์ด บางคนมองหาปุ่ม */}
              <button
                type="button"
                onClick={openDetail}
                className="flex min-w-0 flex-1 flex-col gap-2.5 p-3 text-start transition-colors hover:bg-surface-2"
              >
                <span className="flex w-full min-w-0 items-center gap-2">
                  {/* วงแสงเต้นเป็นจังหวะ สีตามความพร้อม — เหลื่อมเวลารายใบด้วย id
                      ไม่งั้นการ์ดทั้งกริดจะเต้นพร้อมกันเป็นบล็อกเดียว */}
                  <span className="relative grid size-9 shrink-0 place-items-center rounded-[10px] bg-surface-2 text-ink-2">
                    <span
                      aria-hidden
                      className="animate-device-halo pointer-events-none absolute inset-0 rounded-[10px] border"
                      style={{
                        borderColor: `rgb(${TONE_RGB[ready.tone]})`,
                        animationDelay: `${(d.id % 5) * 0.55}s`,
                      }}
                    />
                    <Cpu size={16} />
                  </span>
                  <span className="ms-auto shrink-0">
                    <Pill tone={ready.tone} className="inline-flex items-center gap-1 px-2">
                      <ready.Icon size={11} />
                      {ready.label}
                    </Pill>
                  </span>
                </span>

                {/* รหัส key ตัวเล็กอยู่บน ชื่ออยู่ล่างและใหญ่กว่า — ชื่อคือสิ่งที่ตากวาดหา
                    ส่วนรหัสมีไว้ยืนยันตอนเทียบกับ log ของบอร์ด ไม่ใช่ตัวที่ใช้หา
                    (ไม่มีปุ่มคัดลอก — backend เก็บแค่ hash ไม่มี key เต็มให้คัดลอก) */}
                <span className="block w-full min-w-0">
                  <span className="block truncate font-mono text-micro text-ink-2">{d.key_prefix}•••••</span>
                  <span className="mt-0.5 block truncate text-body font-bold">{d.name}</span>
                </span>

                <span className="grid w-full grid-cols-2 gap-2 border-t border-line-2 pt-2.5">
                  <span className="min-w-0">
                    <span className="flex items-center gap-1.5 text-micro text-ink-2">
                      <Bell size={11} className="shrink-0" />
                      <span className="truncate">{T.device_stat_events}</span>
                    </span>
                    <span className="mt-0.5 block truncate text-caption font-semibold">
                      {T.device_events_value(d.allowed_event_types.length)}
                    </span>
                  </span>
                  <span className="min-w-0">
                    <span className="flex items-center gap-1.5 text-micro text-ink-2">
                      <Users size={11} className="shrink-0" />
                      <span className="truncate">{T.device_stat_recipients}</span>
                    </span>
                    <span className="mt-0.5 block truncate text-caption font-semibold">{recipientLabel(d, T)}</span>
                  </span>
                </span>

                <span className="mt-auto block w-full truncate text-micro text-ink-2">
                  {d.last_used_at ? T.device_last_alert(longDate(d.last_used_at, lang)) : T.device_never_alerted}
                </span>
              </button>

              {/* ปุ่มอยู่นอกปุ่มใหญ่ (พี่น้องกัน ไม่ใช่ซ้อนกัน) — ปุ่มซ้อนปุ่มเป็น HTML ที่ผิด
                  และเบราว์เซอร์จะเดาเองว่าการกดเป็นของใคร */}
              <div className="flex items-center gap-1.5 border-t border-line-2 p-2.5">
                <Btn className="min-w-0 flex-1 gap-1.5 px-2 py-1.5 text-micro" onClick={openDetail}>
                  <Eye size={13} className="shrink-0" />
                  <span className="truncate">{T.device_view}</span>
                </Btn>
                <Btn
                  className="min-w-0 flex-1 gap-1.5 px-2 py-1.5 text-micro"
                  onClick={() => navigate(`/devices/${d.id}`)}
                >
                  <Pencil size={13} className="shrink-0" />
                  <span className="truncate">{T.edit}</span>
                </Btn>
                {/* กดแล้วเปิดป๊อปอัพยืนยัน ไม่ลบทันที — ปุ่มนี้เล็กและอยู่ติดปุ่ม "แก้ไข"
                    การกดพลาดจึงเป็นเรื่องที่เกิดได้จริง และการลบเอากลับไม่ได้ */}
                <button
                  type="button"
                  onClick={() => setDeleteTarget(d)}
                  title={T.device_remove}
                  aria-label={`${T.device_remove}: ${d.name}`}
                  className="grid size-[30px] shrink-0 place-items-center rounded-control border border-line bg-bad-soft text-bad-strong transition-colors hover:border-bad"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </Card>
          );
        })}
      </div>

      {/* หาไม่เจอ ≠ ยังไม่มีอุปกรณ์ — ถ้าใช้กล่องเดียวกันจะชวนให้กด "เพิ่มอุปกรณ์"
          ทั้งที่อุปกรณ์ตัวนั้นมีอยู่แล้ว แค่พิมพ์ผิด */}
      {!loading && keys.length > 0 && shown.length === 0 ? (
        <p className="rounded-card border border-dashed border-line px-4 py-7 text-center text-caption text-ink-2">
          {T.device_search_none}
        </p>
      ) : null}

      {!loading && keys.length === 0 ? (
        <div className="flex flex-col items-center gap-2.5 rounded-card border border-dashed border-line px-4 py-7 text-center">
          <p className="text-lead font-semibold">{T.devices_empty_title}</p>
          <p className="text-caption text-ink-2">{T.devices_empty_body}</p>
          {eventTypes.length === 0 ? (
            <p className="text-caption text-warn-strong">{T.allowed_events_empty_hint}</p>
          ) : null}
          <Btn variant="primary" className="mt-0.5" onClick={() => setShowAdd(true)}>
            + {T.add_device}
          </Btn>
        </div>
      ) : null}

      {opened ? (
        <DeviceDialog
          device={opened}
          onClose={() => setOpenId(null)}
          onConfigure={() => navigate(`/devices/${opened.id}`)}
          onTestCall={() => void testCall(opened)}
          onDelete={() => setDeleteTarget(opened)}
          onToggleActive={(next) => void toggleActive(opened, next)}
        />
      ) : null}

      {showAdd ? (
        <AddDeviceDialog
          eventTypes={eventTypes}
          onClose={() => setShowAdd(false)}
          onCreated={() => void reload()}
          onConfigure={(id) => navigate(`/devices/${id}`)}
        />
      ) : null}

      {/* ── ป๊อปอัพยืนยันการลบ ──
          อยู่ระดับหน้า ไม่ได้ซ้อนอยู่ในป๊อปอัพรายละเอียด จึงเปิดทับกันได้โดยไม่ตีกัน
          และตั้งใจไม่ปิดป๊อปอัพรายละเอียดตอนเปิดตัวนี้ — กดยกเลิกแล้วได้กลับไปที่เดิม
          ไม่ใช่โดนเด้งออกมาหน้ารายการ

          ชื่ออุปกรณ์ต้องอยู่ในนี้ด้วย ไม่ใช่แค่ถามว่า "ลบมั้ย" — การ์ดเรียงกันสี่ใบต่อแถว
          และปุ่มถังขยะเล็ก คนที่กดพลาดใบข้างๆ จะรู้ตัวก็ตรงบรรทัดนี้แหละ */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{T.revoke_confirm_title}</AlertDialogTitle>
            <AlertDialogDescription>
              <span className="block text-lead font-semibold text-ink">{deleteTarget?.name}</span>
              <span className="mt-1.5 block">{T.revoke_confirm_body}</span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{T.cancel}</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleteTarget && void remove(deleteTarget.id)}>
              {T.yes_delete}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/* ── ป๊อปอัพรายละเอียดอุปกรณ์ ─────────────────────────────────────────────
 *
 * ใช้ <Dialog> ของ Radix ด้วยเหตุผลเดียวกับ AddDeviceDialog: AppShell ห่อทุกหน้าไว้ด้วย
 * div ที่มี transform (animate-fade-up) ซึ่งกลายเป็น containing block ของ position:fixed
 * กล่องที่เขียน fixed เองจึงไปอิงขอบ <main> แทนขอบจอ — Radix render ผ่าน portal ออกไป
 * ที่ <body> จึงไม่โดนผลนี้ และได้ล็อกสกรอลล์พื้นหลัง + ปิดด้วย Esc + focus trap มาด้วย
 */
function DeviceDialog({
  device,
  onClose,
  onConfigure,
  onTestCall,
  onDelete,
  onToggleActive,
}: {
  device: ApiKey;
  onClose: () => void;
  onConfigure: () => void;
  onTestCall: () => void;
  onDelete: () => void;
  onToggleActive: (next: boolean) => void;
}) {
  const { T, lang } = useApp();
  const ready = readiness(device, T);

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent
        className={cn(
          // ต้องกำหนด sm:max-w ด้วย ไม่งั้น sm:max-w-lg (512px) ของ DialogContent กลางยังชนะบนจอกว้าง
          'max-h-[85vh] max-w-[30rem] gap-4 overflow-y-auto sm:max-w-[30rem]',
          // [&>*]:min-w-0: DialogContent เป็น grid ซึ่งลูกทุกตัวมี min-width:auto = ย่อเล็กกว่า
          // เนื้อหาไม่ได้ พอมี key ยาวๆ ที่ตัดบรรทัดไม่ได้อยู่ข้างใน มันจะดันทั้งกล่องจนล้นขอบ
          '[&>*]:min-w-0',
        )}
      >
        {/* ── หัว: แผ่นไอคอน + ชื่อ + รหัส key ──
            รหัส key ย้ายมาซ้อนใต้ชื่อ เดิมเป็นแถบแยกเต็มความกว้างซึ่งกินที่เท่าหัวเรื่อง
            ทั้งที่แทบไม่มีใครอ่าน (ใช้ตอนเทียบกับ log ของบอร์ดเท่านั้น) */}
        <DialogHeader className="flex-row items-center gap-3 pe-6 text-start">
          <span className="relative grid size-11 shrink-0 place-items-center rounded-xl bg-surface-2 text-ink-2">
            <span
              aria-hidden
              className="animate-device-halo pointer-events-none absolute inset-0 rounded-xl border"
              style={{ borderColor: `rgb(${TONE_RGB[ready.tone]})` }}
            />
            <Cpu size={20} />
          </span>
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <DialogTitle className="min-w-0 truncate text-lead font-bold">{device.name}</DialogTitle>
            <span className="truncate font-mono text-micro text-ink-2">{device.key_prefix}•••••</span>
          </span>
          <Pill tone={ready.tone} className="inline-flex shrink-0 items-center gap-1.5">
            <ready.Icon size={12} />
            {ready.label}
          </Pill>
          <DialogDescription className="sr-only">{T.devices_sub}</DialogDescription>
        </DialogHeader>

        {/* ── สวิตช์เปิด/ปิด ──
            อยู่บนสุดของเนื้อหาเพราะเป็นสิ่งเดียวในกล่องนี้ที่เปลี่ยนพฤติกรรมของระบบทันที
            ที่เหลือเป็นข้อมูลอ่านอย่างเดียว หรือปุ่มที่พาไปหน้าอื่น */}
        <div className={cn(control, 'flex items-center gap-3 px-3 py-2.5')}>
          <span className="min-w-0 flex-1">
            <span className="block text-caption font-semibold">{T.device_toggle_label}</span>
            <span className="mt-0.5 block text-micro leading-[1.6] text-ink-2">
              {device.is_active ? T.device_toggle_on_hint : T.device_toggle_off_hint}
            </span>
          </span>
          <Toggle on={device.is_active} onChange={onToggleActive} />
        </div>

        <div className="grid grid-cols-3 gap-2">
          {[
            { label: T.device_stat_events, value: T.device_events_value(device.allowed_event_types.length) },
            { label: T.device_stat_recipients, value: recipientLabel(device, T) },
            {
              label: T.device_last_alert_label,
              value: device.last_used_at ? longDate(device.last_used_at, lang) : '—',
            },
          ].map((c) => (
            <div key={c.label} className={cn(control, 'min-w-0 px-2.5 py-2')}>
              <p className="truncate text-micro text-ink-2">{c.label}</p>
              <p className="mt-0.5 truncate text-caption font-semibold">{c.value}</p>
            </div>
          ))}
        </div>

        {/* ── ยิงเรื่องนี้ได้ → โทรหาใคร ──
            เดิมเป็นชิปชื่อเหตุการณ์เรียงกันเฉยๆ ซึ่งบอกได้แค่ครึ่งเดียวของเรื่อง
            คำถามจริงคือ "ไฟฟ้าดับแล้วโทรหาใคร" และผู้รับสายผูกอยู่กับคู่ (อุปกรณ์+เหตุการณ์)
            ไม่ได้ผูกกับอุปกรณ์ — เอามาวางคู่กันรายบรรทัดจึงตอบได้ในบรรทัดเดียว
            แถวไหนไม่มีผู้รับจะเป็นสีเตือน เพราะนั่นคือเหตุการณ์ที่แจ้งแล้วเงียบหาย */}
        <div className="flex min-w-0 flex-col gap-1.5">
          <p className="text-micro font-medium tracking-[0.04em] text-ink-2 uppercase">{T.device_events_section}</p>
          {device.allowed_event_types.length === 0 ? (
            <p className="rounded-control border border-dashed border-warn px-3 py-2.5 text-caption leading-[1.7] text-warn-strong">
              {T.allowed_events_none}
            </p>
          ) : (
            <ul className="overflow-hidden rounded-control border border-line">
              {device.allowed_event_types.map((e) => {
                const orphan = e.contacts.length === 0 && !e.group_name;
                const who =
                  e.contacts.length > 0
                    ? T.device_recipients_phones(e.contacts.length)
                    : (e.group_name ?? T.device_recipients_none);
                return (
                  <li
                    key={e.id}
                    className="flex min-w-0 items-center gap-2 border-b border-line-2 px-3 py-2 last:border-b-0"
                  >
                    <span className="min-w-0 flex-1 truncate text-caption font-medium">{e.display_name}</span>
                    <ArrowRight size={13} className="shrink-0 text-ink-2" />
                    <span
                      className={cn(
                        'min-w-0 max-w-[45%] truncate text-caption',
                        orphan ? 'text-warn-strong' : 'text-ink-2',
                      )}
                    >
                      {who}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* flex-wrap: ปุ่มตกบรรทัดเองเมื่อ label ไทยยาวขึ้น */}
        <div className="flex flex-wrap gap-2 border-t border-line-2 pt-3.5">
          <Btn variant="primary" onClick={onConfigure}>
            <Pencil size={14} />
            {T.device_configure}
          </Btn>
          {/* ปิดอยู่แล้วทดสอบโทรไม่ได้ — backend ปฏิเสธ key ที่ปิดตั้งแต่ประตู ปุ่มจึงต้องบอกล่วงหน้า */}
          <Btn onClick={onTestCall} disabled={!device.is_active}>
            <PhoneOutgoing size={14} />
            {T.device_test_call}
          </Btn>
          {/* ปุ่มลบต้องขึ้นเสมอ ไม่ผูกกับ is_active — เดิมซ่อนเมื่อ key ถูกเพิกถอน
              ซึ่งพอเปลี่ยนมาเป็น "ลบจริง" แล้วกลายเป็นกับดัก: แถวที่เพิกถอนไว้ตั้งแต่ระบบเก่า
              จะค้างอยู่ในรายการตลอดไปโดยไม่มีทางลบออกจากหน้าเว็บได้เลย */}
          <Btn className="ms-auto border-bad text-bad-strong hover:border-bad-strong" onClick={onDelete}>
            <Trash2 size={14} />
            {T.device_remove}
          </Btn>
        </div>
      </DialogContent>
    </Dialog>
  );
}
