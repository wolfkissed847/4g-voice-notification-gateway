/**
 * DevicesPage — "อุปกรณ์ & key" แบบรายการซ้าย + ตั้งค่าขวา อยู่จอเดียว
 *
 * ── ทำไมรื้อจากของเดิม ────────────────────────────────────────────────────
 * ของเดิมเป็นกริดการ์ด → กดการ์ดเปิดป๊อปอัพ → กดปุ่มในป๊อปอัพเด้งไปหน้า /devices/:id
 * สามชั้นกว่าจะได้แก้ค่า และกดกลับมาก็หลงทางว่าเมื่อกี้อยู่ตัวไหน ทั้งที่งานที่คนเข้าหน้านี้
 * มาทำจริงๆ คือ "ตั้งว่าอุปกรณ์ตัวนี้ยิงอะไรได้ แล้วโทรหาใคร" ซึ่งเป็นงานเดียว
 *
 * สี่ปัญหาที่ตั้งใจแก้ (ผู้ใช้ระบุมาเองครบทั้งสี่ข้อ):
 *   1. กดลึก 3 ชั้น        → รายการกับแผงตั้งค่าอยู่จอเดียวกัน กดชื่อแล้วแก้ได้เลย
 *   2. ตั้งทีละเหตุการณ์   → แถบ "ใช้กับทั้ง N เหตุการณ์" เปิดครบแล้วใส่กลุ่มให้ทีเดียว
 *   3. ไม่รู้ลำดับก่อนหลัง → แถบเตือนบนสุดที่นับของจริง โผล่เฉพาะตอนยังไม่ครบ
 *   4. มองไม่เห็นภาพรวม    → มุมมอง "ตารางรวม" อุปกรณ์ × เหตุการณ์ ในตารางเดียว
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

import { ChevronDown, Code2, Cpu, ListChecks, PhoneOutgoing, Plus, Power, Search, Trash2 } from 'lucide-react';

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
  const [bulk, setBulk] = useState('');
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

  /** เปิดทุกเหตุการณ์แล้วใส่กลุ่มเดียวกันให้ทั้งหมด
   *  จงใจให้ครอบคลุมเหตุการณ์ที่ "ยังไม่ได้เปิด" ด้วย — ของเดิมแตะเฉพาะที่เปิดไว้แล้ว
   *  ทำให้กดบนอุปกรณ์ที่ยังไม่ได้ผูกอะไรเลยแล้วเงียบสนิท ซึ่งคือกรณีที่ต้องใช้ที่สุด */
  const applyBulk = (d: ApiKey) => {
    const gid = Number(bulk);
    if (!gid) return;
    mutate(d, () => eventTypes.map((et) => ({ event_type_id: et.id, group_id: gid, contact_ids: null })));
    setBulk('');
  };

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
                    onClick={() => { setSelId(d.id); setBulk(''); }}
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

                {/* ตั้งผู้รับพร้อมกันทุกเหตุการณ์ */}
                <div className="flex flex-wrap items-center gap-3 border-b border-line-2 bg-brand-soft px-5 py-3">
                  <ListChecks className="size-4 shrink-0 text-brand-strong" />
                  <span className="text-caption">{T.dv_bulk_label}</span>
                  <select
                    value={bulk}
                    onChange={(e) => setBulk(e.target.value)}
                    className="rounded-control border border-line bg-surface px-3 py-1.5 text-caption"
                  >
                    <option value="">{T.dev_call_group_none}</option>
                    {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                  </select>
                  <button
                    type="button"
                    onClick={() => applyBulk(sel)}
                    disabled={!bulk}
                    className="rounded-control bg-brand px-4 py-2 text-caption font-semibold text-brand-ink disabled:opacity-40"
                  >
                    {fill(T.dv_bulk_apply, { n: eventTypes.length })}
                  </button>
                  <span className="ms-auto text-micro text-ink-2">
                    {bulk ? T.dv_bulk_hint_ready : T.dv_bulk_hint_idle}
                  </span>
                </div>

                {/* เหตุการณ์ + ผู้รับ อยู่แถวเดียวกัน */}
                <div className="grid grid-cols-[40px_minmax(0,1fr)_minmax(0,1.5fr)_136px] border-b border-line px-5 py-2.5 text-micro text-ink-2">
                  <span>{T.dv_col_on}</span>
                  <span>{T.dv_col_event}</span>
                  <span>{T.dv_col_target}</span>
                  <span>{T.dv_col_status}</span>
                </div>
                {eventTypes.map((et) => {
                  const ref = sel.allowed_event_types.find((e) => e.id === et.id);
                  const on = !!ref;
                  const picked = ref?.contacts ?? [];
                  const isPick = on && (picked.length > 0 || pickMode[pickKey(sel.id, et.id)] === true);
                  const ready = ref ? linkReady(ref) : false;
                  return (
                    <div
                      key={et.id}
                      className={cn(
                        'grid grid-cols-[40px_minmax(0,1fr)_minmax(0,1.5fr)_136px] items-start border-b border-line-2 px-5 py-3',
                        on ? 'bg-surface' : 'bg-ink/[0.02]',
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => toggleEvent(sel, et.id)}
                        className={cn(
                          'mt-0.5 grid size-5.5 place-items-center rounded-[6px] border-[1.5px]',
                          on ? 'border-brand-strong bg-brand text-brand-ink' : 'border-line bg-surface',
                        )}
                        aria-pressed={on}
                      >
                        {on ? <span className="text-micro leading-none">✓</span> : null}
                      </button>
                      <div className="min-w-0 pe-3">
                        <p className={cn('text-body', on ? 'text-ink' : 'text-ink-2')}>{et.display_name}</p>
                        <p className="font-mono text-micro text-ink-2">{et.code}</p>
                      </div>
                      <div className="min-w-0 pe-3">
                        {on ? (
                          <div className="flex flex-col gap-2">
                            <div className="flex flex-wrap items-center gap-2">
                              <div className="flex gap-0.5 rounded-[8px] border border-line bg-surface-2 p-0.5">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setPickMode((m) => ({ ...m, [pickKey(sel.id, et.id)]: false }));
                                    setTarget(sel, et.id, { contact_ids: null, group_id: ref?.group_id ?? null });
                                  }}
                                  className={cn('rounded-[6px] px-2.5 py-1 text-micro', !isPick ? 'bg-surface text-ink' : 'text-ink-2')}
                                >
                                  {T.dev_target_group}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setPickMode((m) => ({ ...m, [pickKey(sel.id, et.id)]: true }));
                                    setTarget(sel, et.id, { group_id: null, contact_ids: picked.map((c) => c.id) });
                                  }}
                                  className={cn('rounded-[6px] px-2.5 py-1 text-micro', isPick ? 'bg-surface text-ink' : 'text-ink-2')}
                                >
                                  {T.dev_target_contacts}
                                </button>
                              </div>
                              {!isPick ? (
                                <select
                                  value={ref?.group_id ?? ''}
                                  onChange={(e) => setTarget(sel, et.id, {
                                    group_id: e.target.value ? Number(e.target.value) : null,
                                    contact_ids: null,
                                  })}
                                  className={cn(
                                    'min-w-0 flex-1 rounded-[8px] border bg-surface px-2.5 py-1.5 text-caption',
                                    ready ? 'border-line' : 'border-warn',
                                  )}
                                >
                                  <option value="">{T.dv_group_none}</option>
                                  {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                                </select>
                              ) : null}
                            </div>
                            {isPick ? (
                              <div className="max-h-44 space-y-2 overflow-y-auto rounded-control border border-line-2 bg-surface-2 p-2.5">
                                {groups.map((g) => {
                                  const mine = contacts.filter((c) => c.group_id === g.id);
                                  if (mine.length === 0) return null;
                                  return (
                                    <div key={g.id}>
                                      <p className="mb-1 text-micro text-ink-2">{g.name}</p>
                                      <div className="flex flex-wrap gap-1.5">
                                        {mine.map((c) => {
                                          const has = picked.some((p) => p.id === c.id);
                                          return (
                                            <button
                                              key={c.id}
                                              type="button"
                                              onClick={() => setTarget(sel, et.id, {
                                                group_id: null,
                                                contact_ids: has
                                                  ? picked.filter((p) => p.id !== c.id).map((p) => p.id)
                                                  : picked.map((p) => p.id).concat([c.id]),
                                              })}
                                              className={cn(
                                                'rounded-full border px-2.5 py-1 text-micro',
                                                has ? 'border-brand-strong bg-brand-soft text-brand-strong' : 'border-line bg-surface text-ink-2',
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
                            ) : null}
                          </div>
                        ) : (
                          <p className="text-caption text-ink-2">{T.dv_row_off}</p>
                        )}
                      </div>
                      <div>
                        <Pill tone={!on ? 'muted' : ready ? 'ok' : 'warn'}>
                          {!on ? T.dv_st_off : ready ? T.dv_st_ready : T.dv_st_notarget}
                        </Pill>
                      </div>
                    </div>
                  );
                })}
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
                    const jump = () => { setView('device'); setSelId(d.id); setBulk(''); };
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
