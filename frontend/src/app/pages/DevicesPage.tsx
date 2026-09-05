/**
 * DevicesPage — "อุปกรณ์ & key"
 *
 * ── รูปทรงมาจากไฟล์ดีไซน์ ─────────────────────────────────────────────────
 * figma/Redesign Notification Settings Page/src/pages/DevicesPage.tsx
 * (แผน: plans/misty-forging-whistle.md) แต่ใช้ token ของธีมเราทั้งหมด
 * ไม่ใช่ slate/blue ของไฟล์นั้น
 *
 * สาระของดีไซน์นี้ ตามที่แผนเขียนไว้เอง: การจับคู่ (อุปกรณ์ × เหตุการณ์) → ผู้รับสาย
 * เป็นความสัมพันธ์สองมิติ ถ้าเอาไปทำเป็นขั้นตอนให้เดินทีละขั้น จะเสียบริบทว่า
 * "ตอนนี้ตั้งอะไรไว้แล้วบ้าง" ทุกครั้งที่เดินไปอีกขั้น
 *
 * ทางแก้คือการ์ดใบละอุปกรณ์ที่กางค้างไว้เสมอ ข้างในเป็นรายการเหตุการณ์ที่เปิดใช้
 * บรรทัดละเหตุการณ์ พร้อมสรุปผู้รับสายในบรรทัดเดียวกัน — เปิดหน้ามาก็เห็นครบทุกคู่
 * ของทุกอุปกรณ์โดยไม่ต้องกดอะไรเลย ส่วนการ "แก้" ไปอยู่ในป๊อปอัพที่มีที่พอให้เลือกกลุ่ม
 * หรือไล่ติ๊กเบอร์ได้เต็มที่ (ไฟล์ดีไซน์ใช้ลิ้นชักเลื่อนจากขวา ผู้ใช้สั่งเปลี่ยนเป็นป๊อปอัพ
 * ให้เหมือนที่อื่นทั้งเว็บ)
 *
 * ผ่านมาสามแบบก่อนหน้านี้ ผู้ใช้ตีกลับทั้งหมด: กริดการ์ด → ป๊อปอัพ → หน้าแยก (กดลึก 3 ชั้น),
 * ตาราง 4 คอลัมน์ (ของที่ต้องกดถูกบีบจนเล็ก), และ select ทีละอัน (ต้องเปิด dropdown
 * ก่อนถึงจะรู้ว่ามีอะไรให้เลือก)
 *
 * ── ที่ต่างจากไฟล์ดีไซน์โดยตั้งใจ ──────────────────────────────────────────
 * 1. เก็บช่องค้นหาไว้ (ต้นฉบับไม่มี) — ของจริงมีอุปกรณ์เกือบ 20 ตัว การ์ดกางค้างทุกใบ
 *    แปลว่าเลื่อนหาอย่างเดียวไม่ไหว
 * 2. เก็บมุมมอง "ตารางรวม" ไว้ — เป็นของที่มีอยู่ก่อนและตอบคำถามข้ามอุปกรณ์
 *    ("เหตุการณ์นี้อุปกรณ์ไหนตั้งไว้บ้าง") ซึ่งการ์ดเรียงกันตอบไม่ได้
 * 3. เก็บสวิตช์เปิด/ปิดอุปกรณ์ กับปุ่มทดสอบโทรไว้ในหัวการ์ด — เป็นฟังก์ชันจริงของระบบ
 *    ที่ต้นฉบับ (mock) ไม่มี
 * 4. ปุ่มแก้/ลบในแถวเหตุการณ์ไม่ซ่อนจนกว่าจะ hover แบบต้นฉบับ — ปุ่มที่มองไม่เห็น
 *    จนกว่าจะเอาเมาส์ไปวางคือปุ่มที่คนหาไม่เจอ
 * 5. เพิ่มป๊อปอัพยืนยันตอนเอาเหตุการณ์ออก — เอาออกแล้วผู้รับสายที่ตั้งไว้ของคู่นั้นหายด้วย
 *
 * ── บันทึก ────────────────────────────────────────────────────────────────
 * ติ๊ก/เอาออก/เปิด-ปิดอุปกรณ์ = ยิงทันทีแบบ optimistic (ถอยกลับถ้าเซิร์ฟเวอร์ปฏิเสธ)
 * ส่วนการเลือกผู้รับสายอยู่ในป๊อปอัพที่มีปุ่มบันทึก/ยกเลิกของตัวเองตามไฟล์ดีไซน์ —
 * ป๊อปอัพปิดตัวเองไม่ได้ จึงไม่มีจังหวะ "ลืมกดบันทึกแล้วเดินจากไป" แบบฟอร์มที่ฝังอยู่ในหน้า
 *
 * ── เกณฑ์ "พร้อม" ใช้ตัวเดียวกับหน้าภาพรวม ────────────────────────────────
 * อยู่ที่ lib/deviceReadiness.ts จุดเดียว ห้ามเขียนเงื่อนไขซ้ำที่นี่
 */
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { Cpu, PhoneOutgoing, Plus, Power, Search, Trash2 } from 'lucide-react';

import { cn } from '@/app/components/ui/utils';
import { listApiKeys, deleteApiKey, revealApiKey, updateApiKey } from '../api/apiKeys';
import { ApiError } from '../api/client';
import { listEventTypes, sendTestNotify } from '../api/eventTypes';
import { listContacts, listGroups } from '../api/groups';
import { AddDeviceDialog } from '../components/AddDeviceDialog';
import { Btn, Dot, Pill } from '../components/primitives';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '../components/ui/alert-dialog';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '../components/ui/dialog';
import { useApp } from '../context/AppContext';
import { readiness } from '../lib/deviceReadiness';
import { SNAP, readSnapshot, writeSnapshot } from '../lib/snapshot';
import type { ApiKey, ApiKeyEventLink, ApiKeyEventTypeRef, Contact, EventType, Group } from '../types';

/** เติมค่าลงข้อความแปล — คีย์ที่มี {n} / {all} ใช้ตัวนี้แทนการต่อสตริงเอง
 *  (ต่อสตริงเองแล้วภาษาอังกฤษจะเรียงคำผิด เพราะตัวเลขอยู่คนละตำแหน่งกับไทย) */
function fill(tpl: string, vars: Record<string, string | number>): string {
  return Object.entries(vars).reduce((s, [k, v]) => s.split('{' + k + '}').join(String(v)), tpl);
}

/** ผู้รับของคู่ (อุปกรณ์ + เหตุการณ์) ครบจริงไหม
 *  โหมดเลือกเบอร์เองต้องมีอย่างน้อย 1 คน — เดิมนับว่าครบทันทีที่สลับโหมด
 *  ทำให้ขึ้นป้ายเขียว "พร้อมโทร" ทั้งที่ยังไม่ได้เลือกใครเลย */
function linkReady(ref: { group_id: number | null; contacts: unknown[] }): boolean {
  return ref.contacts.length > 0 || ref.group_id !== null;
}

/** ค่าที่กำลังแก้อยู่ในลิ้นชัก — เป็นสำเนา ยังไม่ถูกส่งจนกว่าจะกดบันทึก */
type DrawerState = {
  deviceId: number;
  eventTypeId: number;
  mode: 'group' | 'custom';
  groupId: number | null;
  contactIds: number[];
};

export function DevicesPage({ embedded = false }: { embedded?: boolean } = {}) {
  const { T } = useApp();

  const [devices, setDevices] = useState<ApiKey[]>(() => readSnapshot<ApiKey[]>(SNAP.devices) ?? []);
  const [eventTypes, setEventTypes] = useState<EventType[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);

  const [view, setView] = useState<'device' | 'matrix'>('device');
  const [query, setQuery] = useState('');
  const [saving, setSaving] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<ApiKey | null>(null);

  /* เพิ่มเหตุการณ์ให้อุปกรณ์ — เก็บ id อุปกรณ์ที่กดมา + ตัวที่เลือกในช่อง */
  const [addEventFor, setAddEventFor] = useState<ApiKey | null>(null);
  const [addEventId, setAddEventId] = useState('');

  /* เอาเหตุการณ์ออกจากอุปกรณ์ — ต้องถามก่อน เพราะผู้รับสายของคู่นี้หายไปด้วย */
  const [removeTarget, setRemoveTarget] = useState<{ device: ApiKey; ref: ApiKeyEventTypeRef } | null>(null);

  const [drawer, setDrawer] = useState<DrawerState | null>(null);
  /* คำค้นของตารางฝั่งขวาในป๊อปอัพ — แยกจากช่องค้นอุปกรณ์ด้านบนหน้า
     ล้างทุกครั้งที่เปิดป๊อปอัพใหม่ ไม่งั้นเปิดมาแล้วเจอรายการที่ถูกกรองไว้จากรอบก่อน
     โดยที่ตัวเองไม่ได้พิมพ์อะไร ซึ่งอ่านได้ว่า "กลุ่มหายไปไหน" */
  const [drawerQuery, setDrawerQuery] = useState('');

  useEffect(() => {
    let alive = true;
    Promise.all([listApiKeys(), listEventTypes(), listGroups()])
      .then(async ([ks, es, gs]) => {
        if (!alive) return;
        setDevices(ks);
        writeSnapshot(SNAP.devices, ks);
        setEventTypes(es);
        setGroups(gs);
        // เบอร์ทั้งหมดในระบบ — ต้องมีไว้ให้ติ๊กตอนเลือกผู้รับรายคน
        const per = await Promise.all(gs.map((g) => listContacts(g.id).catch(() => [] as Contact[])));
        if (alive) setContacts(per.flat());
      })
      .catch((e) => toast.error(e instanceof ApiError ? e.message : T.error_generic));
    return () => { alive = false; };
  }, [T]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return devices;
    return devices.filter((d) =>
      d.name.toLowerCase().includes(q) || d.key_prefix.toLowerCase().includes(q));
  }, [devices, query]);

  /** ชื่อคนที่จะถูกโทรจริงของคู่นี้ เรียงตามลำดับไล่สาย
   *  โหมดกลุ่มต้องไปหยิบจากรายชื่อทั้งระบบเอง เพราะ backend ส่งมาแค่ id กับชื่อกลุ่ม */
  const recipientsOf = (ref: { group_id: number | null; contacts: { name: string | null; phone_number: string }[] }) => {
    const list = ref.contacts.length > 0
      ? ref.contacts
      : ref.group_id !== null
        ? contacts.filter((c) => c.group_id === ref.group_id)
        : [];
    return list.map((c) => c.name || c.phone_number);
  };

  /* ── บันทึก ─────────────────────────────────────────────────────────────
     ส่ง event_links ทั้งชุดเสมอ (ไม่ใช่ส่งเฉพาะตัวที่แก้) เพราะ backend ถือว่า
     รายการที่ส่งมาคือความจริงทั้งหมดของอุปกรณ์นั้น — ตัวที่ไม่ส่งเท่ากับสั่งให้ลบทิ้ง */
  const saveLinks = async (device: ApiKey, links: ApiKeyEventLink[], optimistic: ApiKey) => {
    const before = devices;
    setDevices((ds) => ds.map((d) => (d.id === optimistic.id ? optimistic : d)));
    setSaving(true);
    try {
      const updated = await updateApiKey(device.id, { event_links: links });
      setDevices((ds) => {
        const next = ds.map((d) => (d.id === updated.id ? updated : d));
        writeSnapshot(SNAP.devices, next);
        return next;
      });
    } catch (e) {
      setDevices(before); // ถอยกลับให้ครบ ไม่ปล่อยให้หน้าจอโชว์ค่าที่เซิร์ฟเวอร์ไม่ได้รับ
      toast.error(e instanceof ApiError ? e.message : T.error_generic);
    } finally {
      setSaving(false);
    }
  };

  /** แปลง allowed_event_types ปัจจุบันเป็น payload แล้วให้ผู้เรียกแก้เฉพาะที่ต้องการ */
  const linksOf = (d: ApiKey): ApiKeyEventLink[] =>
    d.allowed_event_types.map((e) => ({
      event_type_id: e.id,
      group_id: e.group_id,
      contact_ids: e.contacts.length > 0 ? e.contacts.map((c) => c.id) : null,
    }));

  /** สร้าง ApiKey เวอร์ชันที่หน้าจอควรเห็นทันที ก่อนเซิร์ฟเวอร์ตอบ */
  const optimisticOf = (d: ApiKey, links: ApiKeyEventLink[]): ApiKey => ({
    ...d,
    allowed_event_types: links.map((l) => {
      const et = eventTypes.find((e) => e.id === l.event_type_id);
      const g = groups.find((x) => x.id === l.group_id);
      const picked = (l.contact_ids ?? []).map((id) => contacts.find((c) => c.id === id)).filter(Boolean) as Contact[];
      return {
        id: l.event_type_id,
        code: et?.code ?? '',
        display_name: et?.display_name ?? '',
        group_id: l.group_id,
        group_name: g?.name ?? null,
        contacts: picked.map((c) => ({
          id: c.id, name: c.name, phone_number: c.phone_number,
          group_id: c.group_id, group_name: groups.find((x) => x.id === c.group_id)?.name ?? '',
        })),
      };
    }),
  });

  const mutate = (d: ApiKey, fn: (links: ApiKeyEventLink[]) => ApiKeyEventLink[]) => {
    const links = fn(linksOf(d));
    void saveLinks(d, links, optimisticOf(d, links));
  };

  const addEvent = (d: ApiKey, etId: number) =>
    mutate(d, (ls) => ls.concat([{ event_type_id: etId, group_id: null, contact_ids: null }]));

  const removeEvent = (d: ApiKey, etId: number) =>
    mutate(d, (ls) => ls.filter((l) => l.event_type_id !== etId));

  const toggleActive = async (d: ApiKey) => {
    const before = devices;
    setDevices((ds) => ds.map((x) => (x.id === d.id ? { ...x, is_active: !x.is_active } : x)));
    try {
      const updated = await updateApiKey(d.id, { is_active: !d.is_active });
      setDevices((ds) => ds.map((x) => (x.id === updated.id ? updated : x)));
    } catch (e) {
      setDevices(before);
      toast.error(e instanceof ApiError ? e.message : T.error_generic);
    }
  };

  const doDelete = async (d: ApiKey) => {
    try {
      await deleteApiKey(d.id);
      setDevices((ds) => ds.filter((x) => x.id !== d.id));
      setPendingDelete(null);
      toast.success(T.toast_deleted);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : T.error_generic);
    }
  };

  const doTest = async (d: ApiKey) => {
    const first = d.allowed_event_types[0];
    if (!first) return;
    try {
      await sendTestNotify({ device_id: d.id, event_type_code: first.code });
      toast.success(T.toast_created);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : T.error_generic);
    }
  };

  const pillFor = (d: ApiKey) => {
    const r = readiness(d, T);
    if (!d.is_active) return { tone: 'muted' as const, text: T.dv_pill_off };
    if (d.allowed_event_types.length === 0) return { tone: 'warn' as const, text: T.dv_pill_noevent };
    return r.tone === 'ok'
      ? { tone: 'ok' as const, text: T.dv_pill_ready }
      : { tone: 'warn' as const, text: T.dv_pill_notarget };
  };

  /* ── ลิ้นชักผู้รับสาย ─────────────────────────────────────────────────── */
  const openDrawer = (d: ApiKey, ref: ApiKeyEventTypeRef) => {
    setDrawerQuery('');
    setDrawer({
      deviceId: d.id,
      eventTypeId: ref.id,
      // เดาโหมดจากข้อมูล: มีเบอร์ที่เจาะไว้ = โหมดเลือกเอง ไม่งั้นถือเป็นโหมดกลุ่ม
      // ที่นี่เดาได้ปลอดภัย เพราะลิ้นชักเป็นสำเนา สลับโหมดเล่นแล้วกดยกเลิกก็ไม่กระทบของจริง
      mode: ref.contacts.length > 0 ? 'custom' : 'group',
      groupId: ref.group_id,
      contactIds: ref.contacts.map((c) => c.id),
    });
  };

  const saveDrawer = () => {
    if (!drawer) return;
    const d = devices.find((x) => x.id === drawer.deviceId);
    if (!d) return;
    mutate(d, (ls) => ls.map((l) => (l.event_type_id === drawer.eventTypeId
      ? drawer.mode === 'group'
        ? { ...l, group_id: drawer.groupId, contact_ids: null }
        : { ...l, group_id: null, contact_ids: drawer.contactIds }
      : l)));
    setDrawer(null);
  };

  const drawerDevice = drawer ? devices.find((d) => d.id === drawer.deviceId) ?? null : null;
  const drawerEvent = drawer ? eventTypes.find((e) => e.id === drawer.eventTypeId) ?? null : null;
  const drawerInvalid = drawer
    ? drawer.mode === 'group' ? drawer.groupId === null : drawer.contactIds.length === 0
    : true;

  /* ── ตัวกรองของตารางฝั่งขวา ─────────────────────────────────────────────
     คำค้นเดียวหาได้ทั้งชื่อกลุ่ม ชื่อคน และเบอร์ เพราะคนที่เปิดป๊อปอัพนี้รู้อยู่แค่
     อย่างเดียวในสามอย่างนั้น ("เบอร์นี้ต้องได้รับสาย" / "ให้ทีมช่างรับ")
     ตัวเลขเทียบเฉพาะตอนคำค้นมีตัวเลขจริง ไม่งั้นค้นคำว่า "ช่าง" (digits = "")
     จะกลายเป็น "".includes("") = true คือตรงกับทุกเบอร์ */
  const dq = drawerQuery.trim().toLowerCase();
  const dqDigits = dq.replace(/\D/g, '');
  const contactHit = (c: Contact) =>
    (c.name ?? '').toLowerCase().includes(dq) ||
    (dqDigits.length > 0 && c.phone_number.replace(/\D/g, '').includes(dqDigits));

  // โหมดกลุ่มก็ค้นด้วยเบอร์ได้ — กลุ่มที่มีคนตรงคำค้นถือว่าตรงด้วย
  const drawerGroups = dq
    ? groups.filter((g) => g.name.toLowerCase().includes(dq) || contacts.some((c) => c.group_id === g.id && contactHit(c)))
    : groups;
  const drawerContacts = dq ? contacts.filter(contactHit) : contacts;

  /** ชื่อคนที่จะถูกโทรตามที่เลือกไว้ในป๊อปอัพตอนนี้ (ยังไม่ได้บันทึก) */
  const drawerPicked: string[] = !drawer
    ? []
    : drawer.mode === 'group'
      ? (drawer.groupId === null
          ? []
          : contacts.filter((c) => c.group_id === drawer.groupId).map((c) => c.name || c.phone_number))
      : drawer.contactIds
          .map((id) => contacts.find((c) => c.id === id))
          .filter((c): c is Contact => c !== undefined)
          .map((c) => c.name || c.phone_number);

  const availableFor = (d: ApiKey) =>
    eventTypes.filter((et) => !d.allowed_event_types.some((e) => e.id === et.id));

  return (
    <div className={cn('flex min-h-0 flex-1 flex-col gap-4', embedded ? '' : 'p-4')}>
      {/* แถบเครื่องมือ */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-0.5 rounded-control border border-line bg-surface-2 p-0.5">
          {(['device', 'matrix'] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              className={cn(
                'rounded-[7px] px-4 py-1.5 text-caption',
                view === v ? 'bg-surface font-semibold text-ink' : 'text-ink-2',
              )}
            >
              {v === 'device' ? T.dv_view_device : T.dv_view_matrix}
            </button>
          ))}
        </div>
        <div className="flex min-w-0 flex-1 items-center gap-2 rounded-control border border-line bg-surface-2 px-3 py-2 sm:max-w-[340px]">
          <Search className="size-4 shrink-0 text-ink-2" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={T.dv_search_ph}
            className="min-w-0 flex-1 bg-transparent text-caption outline-none"
          />
        </div>
        {saving ? <span className="text-micro text-ink-2">{T.dv_saving}</span> : null}
        <button
          type="button"
          onClick={() => setAddOpen(true)}
          className="ms-auto flex items-center gap-2 rounded-control bg-brand px-4 py-2.5 text-body font-semibold text-brand-ink"
        >
          <Plus className="size-4" />
          {T.add_device}
        </button>
      </div>

      {view === 'device' ? (
        /* การ์ดเรียงลงมา ลอยบนพื้นหน้า ไม่มีกล่องนอกครอบ (ตามไฟล์ดีไซน์)
           แต่เลื่อนอยู่ในตัวเอง ไม่ปล่อยให้ทั้งหน้าเลื่อนตามจำนวนอุปกรณ์ */
        <div className="flex min-h-[10rem] min-w-0 flex-1 flex-col gap-4 overflow-auto overscroll-contain">
          <p className="shrink-0 font-mono text-micro text-ink-2">
            {query.trim()
              ? fill(T.dv_count_found, { n: shown.length, all: devices.length })
              : fill(T.dv_count_all, { n: devices.length })}
          </p>

          {shown.length === 0 ? (
            <div className="flex flex-col items-center gap-2.5 rounded-card border border-dashed border-line px-4 py-10 text-center">
              <span className="grid size-14 place-items-center rounded-card bg-surface-2">
                <Cpu size={26} className="text-ink-2" strokeWidth={1.5} />
              </span>
              <p className="text-lead font-semibold">{T.devices_empty_title}</p>
              <p className="text-caption text-ink-2">{T.devices_empty_body}</p>
            </div>
          ) : null}

          {shown.map((d) => {
            const p = pillFor(d);
            const avail = availableFor(d);
            return (
              <DeviceCard
                key={d.id}
                device={d}
                pill={p}
                canAddEvent={avail.length > 0}
                recipientsOf={recipientsOf}
                onAddEvent={() => { setAddEventFor(d); setAddEventId(''); }}
                onEditEvent={(ref) => openDrawer(d, ref)}
                onRemoveEvent={(ref) => setRemoveTarget({ device: d, ref })}
                onToggleActive={() => void toggleActive(d)}
                onTest={() => void doTest(d)}
                onDelete={() => setPendingDelete(d)}
              />
            );
          })}
        </div>
      ) : (
        /* ── ตารางรวม — คลิกช่องแล้วกระโดดไปแก้ ───────────────────────────── */
        <div className="min-h-[10rem] min-w-0 overflow-auto overscroll-contain rounded-card border border-line bg-surface shadow-card">
          <div className="sticky top-0 z-10 border-b border-line bg-surface px-5 py-3.5">
            <p className="text-lead font-bold">{T.dv_matrix_title}</p>
            <p className="mt-0.5 text-caption text-ink-2">{T.dv_matrix_sub}</p>
          </div>
          <div className="overflow-x-auto">
            <div className="min-w-[880px]">
              <div
                className="grid border-b border-line bg-surface-2"
                style={{ gridTemplateColumns: `240px repeat(${Math.max(eventTypes.length, 1)}, minmax(0, 1fr))` }}
              >
                <div className="px-4 py-2.5 text-micro text-ink-2">{T.dv_matrix_device}</div>
                {eventTypes.map((et) => (
                  <div key={et.id} className="border-s border-line-2 px-3 py-2.5 text-micro text-ink-2">
                    {et.display_name}
                  </div>
                ))}
              </div>
              {devices.map((d) => (
                <div
                  key={d.id}
                  className={cn('grid border-b border-line-2', d.is_active ? '' : 'opacity-50')}
                  style={{ gridTemplateColumns: `240px repeat(${Math.max(eventTypes.length, 1)}, minmax(0, 1fr))` }}
                >
                  <div className="min-w-0 px-4 py-3">
                    <p className="truncate text-caption font-semibold">{d.name}</p>
                    <p className="font-mono text-micro text-ink-2">
                      {d.key_prefix}{d.is_active ? '' : ` · ${T.dv_active_off}`}
                    </p>
                  </div>
                  {eventTypes.map((et) => {
                    const ref = d.allowed_event_types.find((e) => e.id === et.id);
                    const jump = () => { setView('device'); setQuery(d.name); };
                    let text: string = T.dv_matrix_notset;
                    let cls: string = 'bg-ink/[0.02] text-ink-2/70';
                    if (ref) {
                      if (!linkReady(ref)) { text = T.dv_recip_none; cls = 'bg-warn-soft text-warn-strong'; }
                      else if (ref.contacts.length > 0) { text = fill(T.dv_matrix_picked, { n: ref.contacts.length }); cls = 'text-ink'; }
                      else { text = ref.group_name ?? ''; cls = 'text-ink'; }
                    }
                    return (
                      <button
                        key={et.id}
                        type="button"
                        onClick={jump}
                        className={cn('border-s border-line-2 px-3 py-3 text-start text-caption', cls)}
                      >
                        {text}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── ป๊อปอัพเลือกผู้รับสาย ─────────────────────────────────────────────
          เคยเป็นลิ้นชักเลื่อนออกมาจากขวาตามไฟล์ดีไซน์ ผู้ใช้สั่งเปลี่ยนเป็นป๊อปอัพกลางจอ
          — ป๊อปอัพชุดเดียวกับที่ใช้ทุกจุดในเว็บนี้ (เพิ่มอุปกรณ์ แก้กลุ่ม ยืนยันลบ)
          ของที่เลื่อนออกมาจากขอบจอเป็นทรงที่โผล่มาที่เดียวทั้งเว็บ

          flex ทับ grid ของ DialogContent เพื่อให้หัวกับปุ่มท้ายอยู่กับที่
          แล้วเลื่อนเฉพาะรายการตรงกลาง — รายการเบอร์ยาวเกินจอได้ ถ้าปล่อยให้ทั้งกล่อง
          เลื่อน ปุ่มบันทึกจะไปอยู่ใต้สุดที่ต้องเลื่อนลงไปหา */}
      <Dialog open={drawer !== null} onOpenChange={(o) => { if (!o) setDrawer(null); }}>
        <DialogContent className="flex max-h-[85vh] max-w-[calc(100%-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[min(52rem,calc(100%-2rem))] [&>button]:top-4 [&>button]:right-4">
          {drawer && drawerEvent ? (
            <>
              <DialogHeader className="shrink-0 gap-0 border-b border-line px-5 py-4 pe-12 text-start">
                <p className="truncate text-micro text-ink-2">{drawerDevice?.name}</p>
                <DialogTitle className="truncate text-lead font-bold">{drawerEvent.display_name}</DialogTitle>
                <p className="truncate font-mono text-micro text-ink-2">{drawerEvent.code}</p>
              </DialogHeader>

              {/* ── สองฝั่ง: เลือกโหมดซ้าย เลือกตัวจริงขวา ──────────────────
                  ฝั่งซ้ายมีแค่สองตัวเลือกและไม่โตตามข้อมูล ฝั่งขวาโตไม่จำกัด
                  (กลุ่มกี่กลุ่มก็ได้ เบอร์กี่เบอร์ก็ได้) แยกกันแล้วโหมดที่เลือกอยู่
                  ไม่ถูกเลื่อนหายไปตอนไล่หาในรายการยาวๆ และคำตอบสุดท้าย
                  ("จะโทรหาใครบ้าง") อยู่ค้างให้เห็นตลอดที่ฝั่งซ้าย

                  จอแคบกว่า sm ยุบเป็นคอลัมน์เดียว เส้นคั่นแนวตั้งเป็นแนวนอนแทน */}
              <div className="grid min-h-0 flex-1 sm:grid-cols-[15.5rem_minmax(0,1fr)]">
                {/* ฝั่งซ้าย — ผู้รับสาย */}
                <div className="flex min-h-0 flex-col gap-3 overflow-y-auto overscroll-contain border-b border-line px-5 py-4 sm:border-b-0 sm:border-e">
                  <p className="font-mono text-micro tracking-wider text-ink-2 uppercase">{T.dev_target_mode}</p>

                  {/* สองตัวเลือกเป็นการ์ดที่มีคำอธิบายใต้ชื่อ ไม่ใช่แค่ radio เปล่าๆ
                      "ทั้งกลุ่ม" กับ "เลือกเบอร์เอง" ต่างกันตรงพฤติกรรมตอนโทร ไม่ใช่ตรงชื่อ */}
                  <div className="flex flex-col gap-2">
                    {([
                      { v: 'group' as const, label: T.dev_target_group, desc: T.dv_mode_group_desc },
                      { v: 'custom' as const, label: T.dev_target_contacts, desc: T.dv_mode_custom_desc },
                    ]).map((o) => {
                      const on = drawer.mode === o.v;
                      return (
                        <button
                          key={o.v}
                          type="button"
                          onClick={() => setDrawer({ ...drawer, mode: o.v })}
                          className={cn(
                            'flex items-start gap-2.5 rounded-control border px-3 py-2.5 text-start transition-colors',
                            on ? 'border-brand-strong bg-brand-soft' : 'border-line bg-surface hover:border-brand-strong',
                          )}
                        >
                          <span
                            className={cn(
                              'mt-0.5 grid size-4 shrink-0 place-items-center rounded-full border-[1.5px]',
                              on ? 'border-brand-strong' : 'border-line',
                            )}
                          >
                            {on ? <span className="size-2 rounded-full bg-brand-strong" /> : null}
                          </span>
                          <span className="min-w-0">
                            <span className="block text-caption font-semibold">{o.label}</span>
                            <span className="block text-micro leading-[1.6] text-ink-2">{o.desc}</span>
                          </span>
                        </button>
                      );
                    })}
                  </div>

                  {/* สรุปว่าที่เลือกไว้ตอนนี้แปลว่าจะโทรหาใครก่อนหลัง — อยู่ฝั่งซ้าย
                      เพราะเป็นคำตอบของทั้งป๊อปอัพ ไม่ใช่ของแถวใดแถวหนึ่งทางขวา */}
                  <div className="mt-auto border-t border-line-2 pt-3">
                    {drawerPicked.length === 0 ? (
                      <p className="text-micro leading-[1.7] text-warn-strong">{T.dev_target_missing}</p>
                    ) : (
                      <p className="text-micro leading-[1.8] text-ink-2">
                        <span className="font-semibold text-ink">{T.dev_will_call}</span>{' '}
                        {drawerPicked.map((n, i) => `${i + 1}. ${n}`).join('  ·  ')}
                      </p>
                    )}
                  </div>
                </div>

                {/* ฝั่งขวา — ตารางที่ค้นได้ */}
                <div className="flex min-h-0 min-w-0 flex-col">
                  <div className="flex shrink-0 flex-wrap items-center gap-2.5 border-b border-line px-5 py-3">
                    <p className="text-caption text-ink-2">
                      {drawer.mode === 'group' ? T.dv_pick_group : T.dv_pick_contacts}
                    </p>
                    <span className="relative ms-auto min-w-0 flex-1 basis-[11rem]">
                      <Search
                        size={14}
                        aria-hidden
                        className="pointer-events-none absolute start-2.5 top-1/2 -translate-y-1/2 text-ink-2"
                      />
                      {/* ค้นได้ทั้งชื่อกลุ่ม ชื่อคน และเบอร์ ในช่องเดียว — โหมดกลุ่มก็ยัง
                          ค้นด้วยเบอร์ได้ เพราะคนที่ถือเบอร์อยู่ในมือมักไม่รู้ว่ามันอยู่กลุ่มไหน */}
                      <input
                        type="search"
                        value={drawerQuery}
                        onChange={(e) => setDrawerQuery(e.target.value)}
                        placeholder={T.dv_search_recip_ph}
                        aria-label={T.dv_search_recip_ph}
                        className="w-full rounded-control border border-line bg-surface-2 py-1.5 ps-8 pe-2.5 text-caption outline-none focus:border-brand-strong"
                      />
                    </span>
                  </div>

                  {drawer.mode === 'group' ? (
                    groups.length === 0 ? (
                      <p className="m-5 rounded-control border border-warn bg-warn-soft px-3.5 py-2.5 text-micro leading-[1.7] text-warn-strong">
                        {T.dv_no_groups}
                      </p>
                    ) : (
                      <div className="min-h-0 flex-1 overflow-auto overscroll-contain">
                        {/* หัวคอลัมน์ sticky ชุดเดียวกับตารางอื่นในเว็บ */}
                        <div className="sticky top-0 z-10 flex items-center gap-3 border-b border-line bg-surface-2 px-4 py-1.5 font-mono text-micro text-ink-2">
                          <span className="w-4 shrink-0" />
                          <span className="min-w-0 flex-1 basis-[8rem]">{T.col_group}</span>
                          <span className="w-[4.5rem] shrink-0 text-end">{T.dv_col_people}</span>
                        </div>
                        {drawerGroups.length === 0 ? (
                          <p className="px-4 py-8 text-center text-caption text-ink-2">{T.dv_search_none}</p>
                        ) : (
                          drawerGroups.map((g) => {
                            const on = drawer.groupId === g.id;
                            const mine = contacts.filter((c) => c.group_id === g.id);
                            return (
                              <button
                                key={g.id}
                                type="button"
                                onClick={() => setDrawer({ ...drawer, groupId: g.id })}
                                className={cn(
                                  'flex w-full items-center gap-3 border-b border-line-2 px-4 py-2.5 text-start transition-colors last:border-b-0',
                                  on ? 'bg-brand-soft' : 'bg-surface hover:bg-surface-2',
                                )}
                              >
                                <span
                                  className={cn(
                                    'grid size-4 shrink-0 place-items-center rounded-full border-[1.5px]',
                                    on ? 'border-brand-strong' : 'border-line',
                                  )}
                                >
                                  {on ? <span className="size-2 rounded-full bg-brand-strong" /> : null}
                                </span>
                                <span className="min-w-0 flex-1 basis-[8rem]">
                                  <span className={cn('block truncate text-caption', on ? 'font-semibold' : 'font-medium')}>
                                    {g.name}
                                  </span>
                                  {/* บอกด้วยว่าในกลุ่มมีใคร — เลือกกลุ่มโดยไม่รู้ว่ามีใครอยู่
                                      คือการเดา และเป็นจุดที่พลาดแล้วสายไปหาคนผิด */}
                                  <span className="block truncate text-micro text-ink-2">
                                    {mine.length === 0
                                      ? T.dev_group_empty
                                      : mine.map((c) => c.name || c.phone_number).join(', ')}
                                  </span>
                                </span>
                                <span className="w-[4.5rem] shrink-0 text-end font-mono text-micro text-ink-2">
                                  {T.ct_people_count(mine.length)}
                                </span>
                              </button>
                            );
                          })
                        )}
                      </div>
                    )
                  ) : contacts.length === 0 ? (
                    <p className="m-5 rounded-control border border-warn bg-warn-soft px-3.5 py-2.5 text-micro leading-[1.7] text-warn-strong">
                      {T.dev_no_contacts_at_all}
                    </p>
                  ) : (
                    <div className="min-h-0 flex-1 overflow-auto overscroll-contain">
                      <div className="sticky top-0 z-10 flex items-center gap-3 border-b border-line bg-surface-2 px-4 py-1.5 font-mono text-micro text-ink-2">
                        <span className="w-4 shrink-0" />
                        <span className="min-w-0 flex-1 basis-[7rem]">{T.dv_col_person}</span>
                        <span className="min-w-0 flex-1 basis-[6rem]">{T.col_phone}</span>
                        <span className="min-w-0 flex-1 basis-[6rem]">{T.dv_col_in_group}</span>
                      </div>
                      {drawerContacts.length === 0 ? (
                        <p className="px-4 py-8 text-center text-caption text-ink-2">{T.dv_search_none}</p>
                      ) : (
                        drawerContacts.map((c) => {
                          const on = drawer.contactIds.includes(c.id);
                          return (
                            <button
                              key={c.id}
                              type="button"
                              onClick={() => setDrawer({
                                ...drawer,
                                contactIds: on
                                  ? drawer.contactIds.filter((x) => x !== c.id)
                                  : drawer.contactIds.concat([c.id]),
                              })}
                              className={cn(
                                'flex w-full items-center gap-3 border-b border-line-2 px-4 py-2.5 text-start transition-colors last:border-b-0',
                                on ? 'bg-brand-soft' : 'bg-surface hover:bg-surface-2',
                              )}
                            >
                              <span
                                className={cn(
                                  'grid size-4 shrink-0 place-items-center rounded-[5px] border-[1.5px]',
                                  on ? 'border-brand-strong bg-brand text-brand-ink' : 'border-line',
                                )}
                              >
                                {on ? <span className="text-[0.55rem] leading-none">✓</span> : null}
                              </span>
                              <span className={cn('min-w-0 flex-1 basis-[7rem] truncate text-caption', on ? 'font-semibold' : 'font-medium')}>
                                {c.name?.trim() || '—'}
                              </span>
                              <span className="min-w-0 flex-1 basis-[6rem] truncate font-mono text-caption text-ink-2">
                                {c.phone_number}
                              </span>
                              <span className="min-w-0 flex-1 basis-[6rem] truncate text-micro text-ink-2">
                                {groups.find((g) => g.id === c.group_id)?.name ?? ''}
                              </span>
                            </button>
                          );
                        })
                      )}
                    </div>
                  )}
                </div>
              </div>

              <div className="flex shrink-0 gap-2 border-t border-line px-5 py-3.5">
                <Btn className="flex-1 justify-center" onClick={() => setDrawer(null)}>{T.cancel}</Btn>
                <Btn variant="primary" className="flex-1 justify-center" onClick={saveDrawer} disabled={drawerInvalid}>
                  {T.save}
                </Btn>
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>

      {/* ── เพิ่มเหตุการณ์ให้อุปกรณ์ ─────────────────────────────────────────
          ช่องนี้โชว์เฉพาะเหตุการณ์ที่อุปกรณ์นี้ "ยังไม่มี" — เลือกตัวที่มีอยู่แล้วซ้ำ
          ไม่มีความหมายอะไรเลย และเป็นทางเดียวที่จะสร้างแถวซ้ำในตารางได้ */}
      <Dialog open={addEventFor !== null} onOpenChange={(o) => { if (!o) setAddEventFor(null); }}>
        <DialogContent className="max-w-[calc(100%-2rem)] sm:max-w-[28rem]">
          <DialogHeader className="text-start">
            <DialogTitle className="text-lead font-bold">{T.dv_add_event_title}</DialogTitle>
          </DialogHeader>
          {addEventFor ? (
            availableFor(addEventFor).length === 0 ? (
              <p className="text-caption leading-[1.8] text-ink-2">{T.dv_add_event_none}</p>
            ) : (
              <div>
                <label className="mb-1.5 block text-caption text-ink-2" htmlFor="add-event-select">
                  {T.setup_tab_events}
                </label>
                <select
                  id="add-event-select"
                  autoFocus
                  value={addEventId}
                  onChange={(e) => setAddEventId(e.target.value)}
                  className="w-full rounded-control border border-line bg-surface px-3 py-2.5 text-body"
                >
                  <option value="">{T.dv_add_event_ph}</option>
                  {availableFor(addEventFor).map((et) => (
                    <option key={et.id} value={et.id}>{et.display_name} ({et.code})</option>
                  ))}
                </select>
                <p className="mt-2 text-micro leading-[1.7] text-ink-2">{T.dv_add_event_hint}</p>
              </div>
            )
          ) : null}
          <DialogFooter>
            <Btn onClick={() => setAddEventFor(null)}>{T.cancel}</Btn>
            <Btn
              variant="primary"
              disabled={!addEventId}
              onClick={() => {
                if (addEventFor && addEventId) addEvent(addEventFor, Number(addEventId));
                setAddEventFor(null);
              }}
            >
              <Plus size={15} />
              {T.dv_add_event}
            </Btn>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {addOpen ? (
        <AddDeviceDialog
          eventTypes={eventTypes}
          onClose={() => setAddOpen(false)}
          onCreated={() => {
            setAddOpen(false);
            void listApiKeys().then((ks) => { setDevices(ks); writeSnapshot(SNAP.devices, ks); });
          }}
          onConfigure={(id) => {
            setAddOpen(false);
            setView('device');
            setQuery(devices.find((d) => d.id === id)?.name ?? '');
          }}
        />
      ) : null}

      {/* ── ยืนยันเอาเหตุการณ์ออกจากอุปกรณ์ ───────────────────────────────── */}
      <AlertDialog open={removeTarget !== null} onOpenChange={(o) => { if (!o) setRemoveTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{T.delete_confirm_title}</AlertDialogTitle>
            <AlertDialogDescription>
              {removeTarget
                ? `${removeTarget.ref.display_name} · ${removeTarget.device.name} — ${T.dv_remove_event_confirm}`
                : T.dv_remove_event_confirm}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{T.cancel}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (removeTarget) removeEvent(removeTarget.device, removeTarget.ref.id);
                setRemoveTarget(null);
              }}
            >
              {T.yes_delete}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={pendingDelete !== null} onOpenChange={(o) => { if (!o) setPendingDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{T.delete_confirm_title}</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete ? `${pendingDelete.name} — ${T.dv_delete_device_confirm}` : T.dv_delete_device_confirm}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{T.cancel}</AlertDialogCancel>
            <AlertDialogAction onClick={() => pendingDelete && void doDelete(pendingDelete)}>
              {T.yes_delete}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/* ── การ์ดอุปกรณ์หนึ่งใบ ─────────────────────────────────────────────────
   แยกเป็น component เพราะ "แสดง/ซ่อน key เต็ม" เป็น state ของการ์ดใบนั้นใบเดียว
   ถ้าเก็บไว้ที่หน้าแม่ต้องทำเป็น Record<deviceId, boolean> โดยไม่ได้อะไรกลับมา */
function DeviceCard({
  device, pill, canAddEvent, recipientsOf,
  onAddEvent, onEditEvent, onRemoveEvent, onToggleActive, onTest, onDelete,
}: {
  device: ApiKey;
  pill: { tone: 'ok' | 'warn' | 'muted'; text: string };
  canAddEvent: boolean;
  recipientsOf: (ref: { group_id: number | null; contacts: { name: string | null; phone_number: string }[] }) => string[];
  onAddEvent: () => void;
  onEditEvent: (ref: ApiKeyEventTypeRef) => void;
  onRemoveEvent: (ref: ApiKeyEventTypeRef) => void;
  onToggleActive: () => void;
  onTest: () => void;
  onDelete: () => void;
}) {
  const { T } = useApp();
  const [fullKey, setFullKey] = useState<string | null>(null);
  const [shown, setShown] = useState(false);
  const [copied, setCopied] = useState(false);

  /* key เต็มไม่ได้มากับรายการอุปกรณ์ ต้องขอแยกตอนกด "แสดง" — ถ้าแนบมาทุกครั้ง
     มันจะไปโผล่ใน log/cache ของทุกคำขอโดยไม่จำเป็น (ดู api/apiKeys.ts) */
  const reveal = async () => {
    if (shown) { setShown(false); return; }
    if (fullKey) { setShown(true); return; }
    try {
      const r = await revealApiKey(device.id);
      if (r.key) { setFullKey(r.key); setShown(true); }
      else toast.error(T.dev_key_locked); // อุปกรณ์ที่สร้างก่อนระบบเก็บ key ไว้ถอดกลับได้
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : T.error_generic);
    }
  };

  const copy = async () => {
    const text = fullKey ?? device.key_prefix;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      toast.error(T.copy_failed);
    }
  };

  return (
    <div
      className={cn(
        'min-w-0 shrink-0 overflow-hidden rounded-card border border-line bg-surface shadow-card',
        device.is_active ? '' : 'opacity-70',
      )}
    >
      {/* หัวการ์ด: ชื่อ + สถานะ + key แถวบน / ปุ่มจัดการชิดขวา */}
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2.5 border-b border-line bg-surface-2 px-5 py-3.5">
        <span className="grid size-9 shrink-0 place-items-center rounded-control bg-brand-soft">
          <Cpu className="size-4.5 text-brand-strong" />
        </span>
        <span className="min-w-0 flex-1 basis-[12rem]">
          <span className="flex flex-wrap items-center gap-2">
            <span className="min-w-0 truncate text-body font-bold">{device.name}</span>
            <Pill tone={pill.tone}>{pill.text}</Pill>
          </span>
          <span className="mt-1 flex flex-wrap items-center gap-2">
            <code className="min-w-0 truncate font-mono text-micro text-ink-2">
              {shown && fullKey ? fullKey : `${device.key_prefix}••••••••`}
            </code>
            <button type="button" onClick={() => void reveal()} className="text-micro text-ink-2 hover:text-ink">
              {shown ? T.dv_key_hide : T.dv_key_show}
            </button>
            <button type="button" onClick={() => void copy()} className="text-micro text-brand-strong hover:brightness-110">
              {copied ? T.copied : T.copy}
            </button>
          </span>
        </span>
        <span className="ms-auto flex shrink-0 flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onToggleActive}
            className="flex items-center gap-2 rounded-control border border-line bg-surface px-3 py-1.5 text-caption"
          >
            <Power className={cn('size-4', device.is_active ? 'text-ok' : 'text-ink-2')} />
            {device.is_active ? T.dv_active_on : T.dv_active_off}
          </button>
          <button
            type="button"
            onClick={onTest}
            disabled={device.allowed_event_types.length === 0}
            className="flex items-center gap-2 rounded-control border border-line bg-surface px-3 py-1.5 text-caption disabled:opacity-45"
          >
            <PhoneOutgoing className="size-4" />
            {T.device_test_call}
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="grid size-8 place-items-center rounded-control border border-bad bg-bad-soft text-bad-strong"
            aria-label={T.delete}
            title={T.delete}
          >
            <Trash2 className="size-4" />
          </button>
        </span>
      </div>

      {!device.is_active ? (
        <p className="flex items-center gap-2.5 border-b border-line-2 bg-ink/5 px-5 py-2 text-micro text-ink-2">
          <Power className="size-3.5 shrink-0" />
          {T.dv_off_banner}
        </p>
      ) : null}

      <div className="flex items-center justify-between gap-3 border-b border-line-2 px-5 py-2">
        <span className="font-mono text-micro tracking-wider text-ink-2 uppercase">{T.dv_events_on}</span>
        <button
          type="button"
          onClick={onAddEvent}
          disabled={!canAddEvent}
          className="flex items-center gap-1.5 text-caption font-medium text-brand-strong disabled:text-ink-2/50"
        >
          <Plus size={14} />
          {T.dv_add_event}
        </button>
      </div>

      {device.allowed_event_types.length === 0 ? (
        <p className="px-5 py-5 text-center text-caption text-ink-2">{T.dv_no_events_yet}</p>
      ) : (
        device.allowed_event_types.map((ref) => {
          const ready = linkReady(ref);
          const names = recipientsOf(ref);
          return (
            <div
              key={ref.id}
              className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-line-2 px-5 py-2.5 transition-colors last:border-b-0 hover:bg-surface-2"
            >
              <span className="shrink-0 rounded-control bg-surface-2 px-2 py-0.5 font-mono text-micro text-ink-2">
                {ref.code}
              </span>
              <span className="min-w-0 flex-1 basis-[8rem] truncate text-caption">{ref.display_name}</span>

              {/* สรุปผู้รับในบรรทัดเดียวกับชื่อเหตุการณ์ — นี่คือทั้งหมดที่การ์ดนี้มีไว้ตอบ
                  จุดสีคือคำตอบระดับกวาดตา ส่วนข้อความคือคำตอบระดับอ่าน */}
              <span className="flex min-w-0 shrink-0 items-center gap-1.5">
                <Dot tone={ready ? 'ok' : 'warn'} />
                {ready ? (
                  <span className="min-w-0 truncate text-micro text-ink-2">
                    {ref.contacts.length > 0
                      ? fill(T.dv_recip_custom, { n: ref.contacts.length })
                      : `${T.dv_recip_group} ${ref.group_name ?? ''}`}
                    {names.length ? ` · ${names.join(', ')}` : ''}
                  </span>
                ) : (
                  <span className="text-micro font-medium text-warn-strong">{T.dv_recip_none}</span>
                )}
              </span>

              <span className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={() => onEditEvent(ref)}
                  className="rounded-control px-2.5 py-1 text-micro font-medium text-brand-strong transition-colors hover:bg-brand-soft"
                >
                  {ready ? T.edit : T.dv_configure}
                </button>
                <button
                  type="button"
                  onClick={() => onRemoveEvent(ref)}
                  className="rounded-control px-2.5 py-1 text-micro text-ink-2 transition-colors hover:bg-bad-soft hover:text-bad-strong"
                >
                  {T.delete}
                </button>
              </span>
            </div>
          );
        })
      )}
    </div>
  );
}
