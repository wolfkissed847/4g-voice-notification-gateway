/**
 * DevicesPage — "อุปกรณ์ & key" แบบรายการซ้าย + ตั้งค่าขวา อยู่จอเดียว
 *
 * ── ทำไมรื้อจากของเดิม ────────────────────────────────────────────────────
 * ของเดิมเป็นกริดการ์ด → กดการ์ดเปิดป๊อปอัพ → กดปุ่มในป๊อปอัพเด้งไปหน้า /devices/:id
 * สามชั้นกว่าจะได้แก้ค่า และกดกลับมาก็หลงทางว่าเมื่อกี้อยู่ตัวไหน ทั้งที่งานที่คนเข้าหน้านี้
 * มาทำจริงๆ คือ "ตั้งว่าอุปกรณ์ตัวนี้ยิงอะไรได้ แล้วโทรหาใคร" ซึ่งเป็นงานเดียว
 *
 * ปัญหาที่ตั้งใจแก้:
 *   1. กดลึก 3 ชั้น        → รายการกับแผงตั้งค่าอยู่จอเดียวกัน กดชื่อแล้วแก้ได้เลย
 *   2. ตั้งค่ายาก           → แผงขวาเป็นสองขั้น: เลือกเหตุการณ์ก่อน แล้วค่อยเลือกผู้รับสาย
 *                            ทั้งแผงเป็นของเหตุการณ์ที่เลือกตัวเดียว ช่องเลือกกลุ่มกับ
 *                            กล่องติ๊กเบอร์จึงกว้างเต็มแผง (เคยเป็นตารางที่เอาทุกเหตุการณ์
 *                            มาเรียงพร้อมกัน ผู้ใช้บอกว่าใช้งานลำบาก จึงรื้อเป็นทีละอัน)
 *   3. มองไม่เห็นภาพรวม    → รายการ "ตั้งไว้แล้ว" ท้ายแผง + มุมมอง "ตารางรวม" อุปกรณ์ × เหตุการณ์
 *
 * เคยมีแถบ "เปิดทุกเหตุการณ์แล้วให้โทรหา" (ตั้งกลุ่มเดียวให้ทุกเหตุการณ์รวดเดียว)
 * และแถบบอกลำดับการตั้งค่าอยู่บนสุด — ผู้ใช้สั่งเอาออกทั้งคู่หลังลองใช้จริง
 *
 * ── บันทึกทันทีทุกครั้งที่แตะ ไม่มีปุ่ม "บันทึก" ──────────────────────────
 * หน้าเดิมสะสมการแก้ไว้แล้วให้กดบันทึกทีเดียว ซึ่งเป็นอีกจังหวะที่ลืมกดแล้วค่าหาย
 * ที่นี่ทุกการแตะยิง PUT ทันทีแบบ optimistic (เปลี่ยนหน้าจอก่อน แล้วค่อยรอผล)
 * ถ้าเซิร์ฟเวอร์ปฏิเสธจะถอยกลับค่าเดิมพร้อมบอกเหตุผล — ผู้ใช้ไม่ต้องจำว่าแก้อะไรค้างไว้
 *
 * ── เกณฑ์ "พร้อม" ใช้ตัวเดียวกับหน้าภาพรวม ────────────────────────────────
 * อยู่ที่ lib/deviceReadiness.ts จุดเดียว ห้ามเขียนเงื่อนไขซ้ำที่นี่
 * (เคยเพี้ยนกันมาแล้วตอนแก้ online/offline ที่หน้าอุปกรณ์แต่ลืมหน้าภาพรวม)
 */
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { ChevronDown, Code2, Cpu, PhoneOutgoing, Plus, Power, Search, Trash2 } from 'lucide-react';

import { cn } from '@/app/components/ui/utils';
import { listApiKeys, deleteApiKey, updateApiKey } from '../api/apiKeys';
import { API_BASE_URL, ApiError } from '../api/client';
import { listEventTypes, sendTestNotify } from '../api/eventTypes';
import { listContacts, listGroups } from '../api/groups';
import { AddDeviceDialog } from '../components/AddDeviceDialog';
import { Pill } from '../components/primitives';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '../components/ui/alert-dialog';
import { useApp } from '../context/AppContext';
import { readiness } from '../lib/deviceReadiness';
import { SNAP, readSnapshot, writeSnapshot } from '../lib/snapshot';
import type { ApiKey, ApiKeyEventLink, Contact, EventType, Group } from '../types';

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

export function DevicesPage({ embedded = false }: { embedded?: boolean } = {}) {
  const { T } = useApp();

  const [devices, setDevices] = useState<ApiKey[]>(() => readSnapshot<ApiKey[]>(SNAP.devices) ?? []);
  const [eventTypes, setEventTypes] = useState<EventType[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);

  const [view, setView] = useState<'device' | 'matrix'>('device');
  const [selId, setSelId] = useState<number | null>(null);
  const [query, setQuery] = useState('');
  const [apiOpen, setApiOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<ApiKey | null>(null);

  /* แถวไหนที่ผู้ใช้กด "เลือกเบอร์เอง" ไว้ — คีย์เป็น "อุปกรณ์:เหตุการณ์"
     ต้องจำแยกจากข้อมูล เพราะ backend ไม่มีฟิลด์บอกโหมด มีแต่ผลลัพธ์ (กลุ่ม หรือ รายชื่อ)
     ถ้าเดาจากข้อมูลอย่างเดียว (มีคนถูกเลือก = โหมดเลือกเอง) คนที่เพิ่งกดปุ่มแต่ยังไม่ได้
     ติ๊กใคร จะไม่เห็นรายชื่อให้ติ๊กเลย = กดแล้วไม่มีอะไรเกิดขึ้น */
  const [pickMode, setPickMode] = useState<Record<string, boolean>>({});
  const pickKey = (deviceId: number, etId: number) => `${deviceId}:${etId}`;

  /* เหตุการณ์ที่กำลังตั้งค่าอยู่ในแผงขวา — ทีละอัน ไม่ใช่ทั้งตารางพร้อมกัน
     เก็บเป็น id ของ event type ไม่ผูกกับอุปกรณ์ จึงยังค้างอยู่ตัวเดิมตอนสลับอุปกรณ์
     ซึ่งเป็นสิ่งที่ต้องการเวลาไล่ตั้งเหตุการณ์เดียวกันให้อุปกรณ์หลายตัวติดกัน */
  const [etId, setEtId] = useState<number | null>(null);

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

  /* เลือกตัวแรกให้อัตโนมัติ — หน้านี้ไม่มีสถานะ "ยังไม่ได้เลือกอะไร" ที่มีประโยชน์ */
  useEffect(() => {
    if (selId === null && devices.length > 0) setSelId(devices[0].id);
    if (selId !== null && !devices.some((d) => d.id === selId)) setSelId(devices[0]?.id ?? null);
  }, [devices, selId]);

  const sel = devices.find((d) => d.id === selId) ?? null;

  /* ตั้งต้นที่เหตุการณ์แรกที่อุปกรณ์นี้เปิดไว้ ถ้ายังไม่เปิดอะไรเลยก็เอาตัวแรกในระบบ
     แตะเฉพาะตอนตัวที่เลือกอยู่หายไปจริงๆ (ถูกลบ หรือยังไม่เคยเลือก) — ไม่งั้นการสลับ
     อุปกรณ์จะดีดกลับไปเหตุการณ์แรกทุกครั้ง ทั้งที่คนกำลังไล่ตั้งเหตุการณ์เดิมอยู่ */
  useEffect(() => {
    if (eventTypes.length === 0) return;
    if (etId !== null && eventTypes.some((e) => e.id === etId)) return;
    setEtId(sel?.allowed_event_types[0]?.id ?? eventTypes[0].id);
  }, [sel, eventTypes, etId]);

  const curEt = eventTypes.find((e) => e.id === etId) ?? null;
  const curRef = sel && curEt ? (sel.allowed_event_types.find((e) => e.id === curEt.id) ?? null) : null;
  const curOn = curRef !== null;
  const curPicked = curRef?.contacts ?? [];
  const curIsPick =
    curOn && sel !== null && curEt !== null
      ? curPicked.length > 0 || pickMode[pickKey(sel.id, curEt.id)] === true
      : false;

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

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return devices;
    return devices.filter((d) =>
      d.name.toLowerCase().includes(q) || d.key_prefix.toLowerCase().includes(q));
  }, [devices, query]);

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

  const toggleEvent = (d: ApiKey, etId: number) =>
    mutate(d, (ls) => (ls.some((l) => l.event_type_id === etId)
      ? ls.filter((l) => l.event_type_id !== etId)
      : ls.concat([{ event_type_id: etId, group_id: null, contact_ids: null }])));

  const setTarget = (d: ApiKey, etId: number, patch: Partial<ApiKeyEventLink>) =>
    mutate(d, (ls) => ls.map((l) => (l.event_type_id === etId ? { ...l, ...patch } : l)));

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
        <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[316px_minmax(0,1fr)]">
          {/* รายการอุปกรณ์ */}
          <div className="min-h-[10rem] min-w-0 overflow-auto overscroll-contain rounded-card border border-line bg-surface shadow-card">
            <div className="sticky top-0 z-10 border-b border-line bg-surface px-4 py-3 font-mono text-micro tracking-wider text-ink-2 uppercase">
              {query.trim()
                ? fill(T.dv_count_found, { n: shown.length, all: devices.length })
                : fill(T.dv_count_all, { n: devices.length })}
            </div>
            <div>
              {shown.map((d) => {
                const p = pillFor(d);
                const on = d.id === selId;
                return (
                  <button
                    key={d.id}
                    type="button"
                    onClick={() => setSelId(d.id)}
                    className={cn(
                      'flex w-full flex-col gap-1 border-b border-line-2 px-4 py-3 text-start',
                      on ? 'bg-brand-soft' : 'bg-surface',
                    )}
                    style={{ borderInlineStartWidth: 3, borderInlineStartColor: on ? 'var(--accent)' : 'transparent' }}
                  >
                    <span className="flex w-full items-center gap-2">
                      <span className={cn('min-w-0 flex-1 truncate text-body', on ? 'font-bold' : 'font-medium')}>
                        {d.name}
                      </span>
                      <Pill tone={p.tone}>{p.text}</Pill>
                    </span>
                    <span className="w-full truncate text-micro text-ink-2">
                      <span className="font-mono">{d.key_prefix}</span>
                      {' · '}
                      {d.allowed_event_types.length === 0
                        ? T.dv_sum_none
                        : fill(T.dv_sum_n, { n: d.allowed_event_types.length })}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* แผงตั้งค่าของตัวที่เลือก */}
          {sel ? (
            <div className="min-h-[10rem] min-w-0 overflow-auto overscroll-contain rounded-card border border-line bg-surface shadow-card">
              <div>
                <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-4">
                  <span className="grid size-10 shrink-0 place-items-center rounded-[10px] bg-brand-soft">
                    <Cpu className="size-5 text-brand-strong" />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-h2 font-bold">{sel.name}</span>
                    <span className="block font-mono text-micro text-ink-2">{sel.key_prefix}</span>
                  </span>
                  <span className="ms-auto flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void toggleActive(sel)}
                      className="flex items-center gap-2 rounded-control border border-line bg-surface-2 px-3 py-2 text-caption"
                    >
                      <Power className={cn('size-4', sel.is_active ? 'text-ok' : 'text-ink-2')} />
                      {sel.is_active ? T.dv_active_on : T.dv_active_off}
                    </button>
                    <button
                      type="button"
                      onClick={() => void doTest(sel)}
                      disabled={sel.allowed_event_types.length === 0}
                      className="flex items-center gap-2 rounded-control border border-line bg-surface px-3 py-2 text-caption disabled:opacity-45"
                    >
                      <PhoneOutgoing className="size-4" />
                      {T.device_test_call}
                    </button>
                    <button
                      type="button"
                      onClick={() => setPendingDelete(sel)}
                      className="rounded-control border border-bad bg-bad-soft px-3 py-2 text-bad-strong"
                      aria-label={T.toast_deleted}
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </span>
                </div>

                {!sel.is_active ? (
                  <p className="flex items-center gap-2.5 border-b border-line-2 bg-ink/5 px-5 py-2.5 text-caption text-ink-2">
                    <Power className="size-4 shrink-0" />
                    {T.dv_off_banner}
                  </p>
                ) : null}

                {/* ── ทีละเหตุการณ์ ไม่ใช่ทั้งตารางพร้อมกัน ────────────────────
                    เดิมเอาทุกเหตุการณ์มาเรียงเป็นตาราง แต่ละแถวมีทั้งสวิตช์เปิด ปุ่มสลับโหมด
                    ช่องเลือกกลุ่ม และกล่องติ๊กเบอร์ ยัดอยู่ในคอลัมน์กว้าง 1.5fr ผลคือ
                    ของที่ต้องกดจริงถูกบีบจนเล็ก ชิปเบอร์ตกบรรทัดกันมั่ว และเกินครึ่งจอ
                    เป็นแถวที่ยังไม่ได้เปิดซึ่งไม่มีอะไรให้ทำเลย ต้องกวาดหาแถวที่สนใจก่อนทุกครั้ง

                    ตอนนี้เลือกเหตุการณ์จากช่องเดียวก่อน แล้วทั้งแผงเป็นของเหตุการณ์นั้นตัวเดียว
                    ช่องเลือกกลุ่มกับกล่องติ๊กเบอร์จึงได้ความกว้างเต็มแผง
                    ส่วนภาพรวมว่าตั้งอะไรไว้แล้วบ้างย้ายไปเป็นรายการสรุปท้ายแผง */}
                {eventTypes.length === 0 ? (
                  <p className="border-b border-line px-5 py-6 text-caption text-ink-2">{T.dv_no_events}</p>
                ) : (
                  <>
                    {/* ── ขั้นที่ 1 ────────────────────────────────────────────── */}
                    <section className="border-b border-line px-5 py-4">
                      <p className="font-mono text-micro tracking-wider text-ink-2 uppercase">{T.dv_step1_title}</p>
                      <div className="mt-2.5 flex flex-wrap items-center gap-2.5">
                        {/* ต่อ "· เปิดอยู่" ท้ายชื่อในตัวเลือก ไม่ใช่แยกเป็นสองกลุ่มใน optgroup
                            เพราะลำดับของเหตุการณ์ต้องคงที่ ไม่งั้นพอเปิด/ปิดตัวไหน
                            รายการทั้งช่องจะสลับที่กันเองใต้เมาส์ที่กำลังจะกดตัวถัดไป */}
                        <select
                          value={curEt?.id ?? ''}
                          onChange={(e) => setEtId(Number(e.target.value))}
                          className="min-w-0 flex-1 basis-[15rem] rounded-control border border-line bg-surface px-3 py-2.5 text-body"
                        >
                          {eventTypes.map((et) => {
                            const enabled = sel.allowed_event_types.some((e) => e.id === et.id);
                            return (
                              <option key={et.id} value={et.id}>
                                {et.display_name}{enabled ? ` · ${T.dv_step1_on}` : ''}
                              </option>
                            );
                          })}
                        </select>

                        {curEt ? (
                          <button
                            type="button"
                            onClick={() => toggleEvent(sel, curEt.id)}
                            aria-pressed={curOn}
                            className={cn(
                              'flex items-center gap-2.5 rounded-control border px-3.5 py-2.5 text-caption',
                              curOn
                                ? 'border-brand-strong bg-brand-soft font-semibold text-brand-strong'
                                : 'border-line bg-surface-2 text-ink-2',
                            )}
                          >
                            <span
                              className={cn(
                                'grid size-5 shrink-0 place-items-center rounded-[6px] border-[1.5px]',
                                curOn ? 'border-brand-strong bg-brand text-brand-ink' : 'border-line bg-surface',
                              )}
                            >
                              {curOn ? <span className="text-micro leading-none">✓</span> : null}
                            </span>
                            {T.dv_enable_event}
                          </button>
                        ) : null}
                      </div>
                      {curEt ? (
                        <p className="mt-2 font-mono text-micro text-ink-2">{curEt.code}</p>
                      ) : null}
                    </section>

                    {/* ── ขั้นที่ 2 ────────────────────────────────────────────── */}
                    <section className="border-b border-line px-5 py-4">
                      <p className="font-mono text-micro tracking-wider text-ink-2 uppercase">{T.dv_step2_title}</p>

                      {!curOn || !curEt ? (
                        /* ปิดอยู่ = ไม่มีอะไรให้เลือก บอกตรงๆ ว่าต้องทำอะไรก่อน
                           ดีกว่าโชว์ตัวเลือกจางๆ ที่กดไม่ได้ ซึ่งอ่านได้ว่าเว็บเสีย */
                        <p className="mt-2.5 rounded-control border border-dashed border-line bg-surface-2 px-3.5 py-3 text-caption text-ink-2">
                          {T.dv_step2_locked}
                        </p>
                      ) : (
                        <div className="mt-2.5 flex flex-col gap-3">
                          <div className="flex w-fit gap-0.5 rounded-control border border-line bg-surface-2 p-0.5">
                            <button
                              type="button"
                              onClick={() => {
                                setPickMode((m) => ({ ...m, [pickKey(sel.id, curEt.id)]: false }));
                                setTarget(sel, curEt.id, { contact_ids: null, group_id: curRef?.group_id ?? null });
                              }}
                              className={cn(
                                'rounded-[7px] px-3.5 py-1.5 text-caption',
                                !curIsPick ? 'bg-surface font-semibold text-ink' : 'text-ink-2',
                              )}
                            >
                              {T.dev_target_group}
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setPickMode((m) => ({ ...m, [pickKey(sel.id, curEt.id)]: true }));
                                setTarget(sel, curEt.id, { group_id: null, contact_ids: curPicked.map((c) => c.id) });
                              }}
                              className={cn(
                                'rounded-[7px] px-3.5 py-1.5 text-caption',
                                curIsPick ? 'bg-surface font-semibold text-ink' : 'text-ink-2',
                              )}
                            >
                              {T.dev_target_contacts}
                            </button>
                          </div>

                          {!curIsPick ? (
                            <select
                              value={curRef?.group_id ?? ''}
                              onChange={(e) => setTarget(sel, curEt.id, {
                                group_id: e.target.value ? Number(e.target.value) : null,
                                contact_ids: null,
                              })}
                              className={cn(
                                'w-full rounded-control border bg-surface px-3 py-2.5 text-body',
                                curRef && linkReady(curRef) ? 'border-line' : 'border-warn',
                              )}
                            >
                              <option value="">{T.dv_group_none}</option>
                              {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                            </select>
                          ) : contacts.length === 0 ? (
                            <p className="rounded-control border border-dashed border-line bg-surface-2 px-3.5 py-3 text-caption text-ink-2">
                              {T.dev_no_contacts_at_all}
                            </p>
                          ) : (
                            /* กล่องติ๊กเบอร์ได้ความกว้างเต็มแผงแล้ว ชิปจึงเรียงได้หลายตัวต่อบรรทัด
                               max-h กันไว้ไม่ให้ดันขั้นตอนถัดไปตกจอตอนมีเบอร์เยอะ */
                            <div className="flex max-h-[16rem] flex-col gap-3 overflow-y-auto overscroll-contain rounded-control border border-line-2 bg-surface-2 p-3">
                              <p className="text-micro leading-[1.7] text-ink-2">{T.dev_pick_contacts_hint}</p>
                              {groups.map((g) => {
                                const mine = contacts.filter((c) => c.group_id === g.id);
                                if (mine.length === 0) return null;
                                return (
                                  <div key={g.id}>
                                    <p className="mb-1.5 text-micro font-semibold text-ink-2">{g.name}</p>
                                    <div className="flex flex-wrap gap-1.5">
                                      {mine.map((c) => {
                                        const has = curPicked.some((x) => x.id === c.id);
                                        return (
                                          <button
                                            key={c.id}
                                            type="button"
                                            onClick={() => setTarget(sel, curEt.id, {
                                              group_id: null,
                                              contact_ids: has
                                                ? curPicked.filter((x) => x.id !== c.id).map((x) => x.id)
                                                : curPicked.map((x) => x.id).concat([c.id]),
                                            })}
                                            className={cn(
                                              'rounded-full border px-3 py-1.5 text-micro',
                                              has
                                                ? 'border-brand-strong bg-brand-soft font-semibold text-brand-strong'
                                                : 'border-line bg-surface text-ink-2',
                                            )}
                                          >
                                            {has ? '✓ ' : ''}{c.name || c.phone_number}
                                          </button>
                                        );
                                      })}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}

                          {/* บรรทัดสรุปว่าจะโทรหาใครก่อนหลังจริง — ทั้งสองโหมดจบที่คำตอบเดียวกัน
                              คนตั้งค่าจึงไม่ต้องแปลเองว่า "กลุ่มทีมช่าง" แปลว่าโทรหาใครบ้าง */}
                          {curRef && linkReady(curRef) ? (
                            <p className="text-caption leading-[1.8] text-ink-2">
                              <span className="font-semibold text-ink">{T.dev_will_call}</span>{' '}
                              {recipientsOf(curRef).length === 0
                                ? T.dev_group_empty
                                : recipientsOf(curRef).map((n, i) => `${i + 1}. ${n}`).join('  ·  ')}
                            </p>
                          ) : (
                            <p className="text-caption leading-[1.8] text-warn-strong">{T.dev_target_missing}</p>
                          )}
                        </div>
                      )}
                    </section>

                    {/* ── ตั้งไว้แล้วอะไรบ้าง ──────────────────────────────────
                        แทนที่ภาพรวมที่ตารางเดิมให้ไว้ แต่เหลือเฉพาะแถวที่เปิดจริง
                        ซึ่งเป็นแถวที่มีข้อมูลให้อ่าน ส่วนตัวที่ยังไม่เปิดอยู่ในช่องเลือกอยู่แล้ว
                        กดแถวไหนก็เด้งขึ้นไปแก้ที่ขั้นที่ 1-2 ของตัวนั้น */}
                    <section>
                      <p className="border-b border-line bg-surface-2 px-5 py-2 font-mono text-micro tracking-wider text-ink-2 uppercase">
                        {fill(T.dv_done_title, { n: sel.allowed_event_types.length })}
                      </p>
                      {sel.allowed_event_types.length === 0 ? (
                        <p className="px-5 py-4 text-caption leading-[1.8] text-ink-2">{T.dv_done_none}</p>
                      ) : (
                        sel.allowed_event_types.map((ref) => {
                          const names = recipientsOf(ref);
                          const ready = linkReady(ref);
                          const on = ref.id === curEt?.id;
                          return (
                            <button
                              key={ref.id}
                              type="button"
                              onClick={() => setEtId(ref.id)}
                              className={cn(
                                'flex w-full flex-wrap items-center gap-x-3 gap-y-1 border-b border-line-2 px-5 py-2.5 text-start last:border-b-0',
                                on ? 'bg-brand-soft' : 'bg-surface',
                              )}
                            >
                              <span className={cn('min-w-0 flex-1 basis-[9rem] truncate text-caption', on ? 'font-semibold' : '')}>
                                {ref.display_name}
                              </span>
                              <span className="min-w-0 flex-[1.4] basis-[10rem] truncate text-caption text-ink-2">
                                {ready
                                  ? (ref.contacts.length > 0
                                      ? fill(T.dv_matrix_picked, { n: ref.contacts.length })
                                      : ref.group_name ?? '') + (names.length ? ` · ${names.join(', ')}` : '')
                                  : '—'}
                              </span>
                              <span className="shrink-0">
                                <Pill tone={ready ? 'ok' : 'warn'}>{ready ? T.dv_st_ready : T.dv_st_notarget}</Pill>
                              </span>
                            </button>
                          );
                        })
                      )}
                    </section>
                  </>
                )}
              </div>

              {/* วิธียิงเข้ามา — พับไว้ กางได้ (อยู่ในการ์ดเดียวกัน ไม่แยกใบ
                  ไม่งั้นคอลัมน์ขวาจะมีสองกล่องซ้อนกันแล้วสูงไม่เท่าคอลัมน์ซ้าย) */}
              <div className="border-t border-line">
                <button
                  type="button"
                  onClick={() => setApiOpen((v) => !v)}
                  className="flex w-full flex-wrap items-center gap-3 px-5 py-3.5 text-start"
                >
                  <Code2 className="size-4 shrink-0 text-ink-2" />
                  <span className="text-body">{T.dev_api_title}</span>
                  <span className="font-mono text-micro text-ink-2">POST /notify · X-API-Key</span>
                  <span className="ms-auto flex items-center gap-1.5 text-micro text-ink-2">
                    {apiOpen ? T.dv_api_hide : T.dv_api_show}
                    <ChevronDown className={cn('size-4 transition-transform', apiOpen ? 'rotate-180' : '')} />
                  </span>
                </button>
                {apiOpen ? (
                  <pre className="mx-5 mb-4 overflow-x-auto rounded-control border border-line-2 bg-surface-2 p-4 font-mono text-micro leading-loose">
{`curl -X POST ${API_BASE_URL}/notify \\
  -H "X-API-Key: ${sel.key_prefix}..." \\
  -H "Content-Type: application/json" \\
  -d '{"event_type_code": "${sel.allowed_event_types[0]?.code ?? eventTypes[0]?.code ?? 'your_event'}"}'`}
                  </pre>
                ) : null}
              </div>
            </div>
          ) : null}
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
                    const jump = () => { setView('device'); setSelId(d.id); };
                    let text: string = T.dv_matrix_notset;
                    let cls: string = 'bg-ink/[0.02] text-ink-2/70';
                    if (ref) {
                      if (!linkReady(ref)) { text = T.dv_st_notarget; cls = 'bg-warn-soft text-warn-strong'; }
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

      {addOpen ? (
        <AddDeviceDialog
          eventTypes={eventTypes}
          onClose={() => setAddOpen(false)}
          onCreated={() => {
            setAddOpen(false);
            void listApiKeys().then((ks) => { setDevices(ks); writeSnapshot(SNAP.devices, ks); });
          }}
          onConfigure={(id) => { setAddOpen(false); setView('device'); setSelId(id); }}
        />
      ) : null}

      <AlertDialog open={pendingDelete !== null} onOpenChange={(o) => { if (!o) setPendingDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{pendingDelete?.name}</AlertDialogTitle>
            <AlertDialogDescription>{T.devices_empty_body}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{T.retry_action}</AlertDialogCancel>
            <AlertDialogAction onClick={() => pendingDelete && void doDelete(pendingDelete)}>
              {T.toast_deleted}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
