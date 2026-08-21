/**
 * AddDeviceDialog — พอร์ตจาก figma/handoff/components/AddDeviceDialog.tsx
 *
 * ── ต่างจากดีไซน์ 3 จุด เพราะความปลอดภัยของ key ──────────────────────────
 * 1. ต้นฉบับสุ่ม key ฝั่ง client (`genKey()`) แล้วโชว์ทันที — ทำแบบนั้นไม่ได้
 *    key ต้องมาจาก server (secrets.token_urlsafe) และ server เก็บแค่ hash
 *    จึงแบ่งเป็น 2 เฟส: กรอกฟอร์ม → POST → server คืน plaintext มาโชว์ครั้งเดียว
 * 2. ตัดปุ่ม "สร้างใหม่" (regenerate) ออก — เปลี่ยน key = ต้องแฟลชบอร์ดใหม่
 *    ซึ่งขัดกับเป้าหมายทั้งหมดของการออกแบบนี้ ถ้า key รั่วให้เพิกถอนแล้วสร้างใหม่
 * 3. เพิ่มการเลือก event type ในฟอร์ม (ดีไซน์ไม่มี) — ถ้าไม่เลือกเลย
 *    อุปกรณ์จะยิงอะไรก็ได้ 403 ทุกครั้ง ซึ่งเป็นกับดักที่ผู้ใช้ไม่รู้ตัว
 *
 * ── ทำไมใช้ <Dialog> ของ Radix ไม่ใช่ div ลอยเอง ─────────────────────────
 * ของเดิมเป็น `<div className="fixed inset-0 z-50">` เขียนมือ ซึ่งพังได้หลายทาง
 * เพราะมันอยู่ "ใน" ต้นไม้ของหน้า: element แม่ที่มี transform (เช่น animate-fade-up
 * ที่ AppShell ใส่ตอนเปลี่ยนหน้า) จะกลายเป็น containing block ของ position:fixed
 * ทำให้กล่องไปอิงขอบ <main> แทนขอบจอ = พื้นดำไม่เต็มจอ/กล่องลอยผิดที่
 * Dialog ของ Radix render ผ่าน portal ออกไปที่ <body> จึงไม่โดนผลนี้เลย
 * และได้ล็อกสกรอลล์พื้นหลัง + ปิดด้วย Esc + focus trap มาให้ฟรี เหมือนทุก dialog หน้าอื่น
 *
 * ตัวอย่าง payload ใช้ POST /notify + header X-API-Key ตาม backend จริง
 * (ต้นฉบับเขียน POST /api/v1/event พร้อม key ใน body ซึ่งไม่ตรงกับของเรา)
 *
 * ── รอบล่าสุด: ขยายกล่อง + เลิกใช้ชิปกลม ────────────────────────────────
 * กล่องเดิมกว้าง 460px ตายตัว พอมีเหตุการณ์ 9 อย่างชิปกลมตกลงไป 7 บรรทัด กินความสูง
 * เกือบครึ่งกล่อง แล้วชื่อเหตุการณ์ยังเรียงไม่ตรงกันเพราะชิปกว้างตามตัวอักษร กวาดตาหา
 * อันที่ต้องการไม่เจอ ตอนนี้เป็นกริดช่องติ๊ก 2 คอลัมน์ที่ขอบซ้ายตรงกันทุกแถว มีช่องค้นหา
 * ตอนรายการเยอะ และกล่องกว้างขึ้นเป็น 720px บนจอปกติ (จอแคบยังเต็มความกว้างเหมือนเดิม)
 */
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Check, Copy, Cpu, KeyRound } from 'lucide-react';

import { cn } from '@/app/components/ui/utils';
import { createApiKey } from '../api/apiKeys';
import { ApiError } from '../api/client';
import { useApp } from '../context/AppContext';
import { copyText } from '../lib/clipboard';
import type { ApiKeyCreateResponse, EventType } from '../types';
import { Btn, inputCls } from './primitives';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog';

/** ต่ำกว่านี้ช่องค้นหาเป็นแค่ของรก — กวาดตาหาเองในกริดสองคอลัมน์เร็วกว่าพิมพ์ */
const EVENT_FILTER_THRESHOLD = 6;

export function AddDeviceDialog({
  eventTypes,
  onClose,
  onCreated,
  onConfigure,
}: {
  eventTypes: EventType[];
  onClose: () => void;
  onCreated: () => void;
  onConfigure: (id: number) => void;
}) {
  const { T } = useApp();
  const [name, setName] = useState('');
  const [picked, setPicked] = useState<number[]>([]);
  const [query, setQuery] = useState('');
  const [created, setCreated] = useState<ApiKeyCreateResponse | null>(null);
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);

  const toggle = (id: number) =>
    setPicked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  /* แถวที่ติ๊กไว้แล้วต้องไม่ถูกกรองหาย ไม่ว่าคำค้นจะเป็นอะไร — ไม่งั้นพิมพ์ค้นหาแล้ว
     ของที่เพิ่งเลือกหายไปจากจอ ดูเหมือนการติ๊กถูกยกเลิก */
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return eventTypes;
    return eventTypes.filter(
      (e) =>
        picked.includes(e.id) ||
        e.display_name.toLowerCase().includes(q) ||
        e.code.toLowerCase().includes(q),
    );
  }, [eventTypes, query, picked]);

  const submit = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const result = await createApiKey(name.trim(), picked);
      setCreated(result);
      onCreated();
    } catch (e) {
      // เดิมไม่มี catch — พอ backend ตอบ 400 (เช่นชื่อซ้ำ) กล่องจะค้างเฉยๆ เหมือนกดแล้วไม่มีอะไรเกิดขึ้น
      toast.error(e instanceof ApiError ? e.message : T.error_generic);
    } finally {
      setSaving(false);
    }
  };

  const copy = async () => {
    if (!created) return;
    const ok = await copyText(created.plaintext_key);
    if (!ok) {
      toast.error(T.copy_failed);
      return;
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
    toast.success(T.copy);
  };

  // เฟส 2 = key โชว์ครั้งเดียว: ห้ามปิดด้วย Esc หรือคลิกนอกกล่องโดยไม่ตั้งใจ
  // เพราะปิดแล้วดู key ไม่ได้อีกเลย ต้องกดปุ่มปิดเองเท่านั้น
  const lockClose = created !== null;

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next && !lockClose) onClose();
      }}
    >
      <DialogContent
        className={cn(
          // กว้างขึ้นเป็น 720 บนจอปกติ แต่จอแคบยังยึด max-w-[calc(100%-2rem)] ของ DialogContent เดิม
          // ต้องกำหนด sm:max-w ด้วย ไม่งั้น sm:max-w-lg (512px) ของ DialogContent กลางยังชนะบนจอกว้าง
          //
          // overflow-x-hidden ต้องมีคู่กับ overflow-y-auto เสมอ: CSS บังคับว่าถ้าแกนหนึ่งไม่ใช่
          // visible อีกแกนที่เป็น visible จะกลายเป็น auto เอง — กริดเลือกเหตุการณ์ข้างล่างยืม
          // ที่จาก padding ด้วย -me-4 (ให้คอลัมน์ตรงกับช่องค้นหา) ซึ่งนับเป็นการล้นแนวนอน
          // ถ้าไม่ปิดไว้ กล่องจะมีแถบเลื่อนแนวนอนโผล่มาทั้งที่ไม่มีอะไรให้เลื่อนดูจริงๆ
          'max-h-[90vh] gap-4 overflow-x-hidden overflow-y-auto p-4 sm:max-w-[45rem] sm:p-6',
          // [&>*]:min-w-0 สำคัญมาก: DialogContent เป็น grid ซึ่งลูกทุกตัวมี min-width:auto
          // = ย่อให้เล็กกว่าความกว้างเนื้อหาไม่ได้ พอมี key ยาวๆ ที่ตัดบรรทัดไม่ได้อยู่ข้างใน
          // มันจะดันทั้งกล่องจนล้นขอบ แล้วเกิดแถบเลื่อนแนวนอน
          '[&>*]:min-w-0',
          // ปุ่มกากบาทมุมขวาบนเป็น <button> ตัวสุดท้ายใน DialogContent (ดู ui/dialog.tsx)
          // เฟส 2 ซ่อนไว้ เพื่อให้เหลือทางออกทางเดียวคือปุ่มที่ผู้ใช้ตั้งใจกด
          lockClose && '[&>button:last-of-type]:hidden',
        )}
        onEscapeKeyDown={(e) => {
          if (lockClose) e.preventDefault();
        }}
        onInteractOutside={(e) => {
          if (lockClose) e.preventDefault();
        }}
      >
        <DialogHeader className="gap-3 text-start">
          <div className="flex flex-row items-center gap-3 pe-6">
            <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand-strong">
              {created ? <KeyRound size={20} /> : <Cpu size={20} />}
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <DialogTitle className="text-lead font-bold">{T.add_device}</DialogTitle>
              <DialogDescription className="text-micro leading-[1.6] text-ink-2">
                {T.add_device_sub}
              </DialogDescription>
            </span>
          </div>

          {/* แถบขั้นตอนเต็มความกว้าง แทนตัวเลข "1 › 2" จิ๋วที่มุมขวาบนแบบเดิม —
              ตัวเลขลอยๆ ไม่ได้บอกว่าแต่ละขั้นคืออะไร คนเลยไม่รู้ว่าเหลืออะไรอีก
              ชื่อขั้นซ่อนบนจอแคบ เหลือแค่วงกลมตัวเลขที่ยังอ่านออก */}
          <div className="flex items-center gap-2 sm:gap-3">
            <StepPill n={1} label={T.add_device_step1} state={created ? 'done' : 'current'} />
            <span className="h-px flex-1 bg-line" />
            <StepPill n={2} label={T.add_device_step2} state={created ? 'current' : 'todo'} />
          </div>
        </DialogHeader>

        {created ? (
          <>
            <div className="flex min-w-0 flex-col gap-3 rounded-card border border-brand-strong bg-brand-soft p-3.5 sm:p-4">
              <div className="min-w-0">
                <p className="text-caption font-semibold">{T.key_once_title}</p>
                <p className="mt-1 text-caption leading-[1.8] text-ink-2">{T.key_once_body}</p>
              </div>

              {/* จอแคบวางปุ่มไว้ใต้ key จอกว้างวางข้างกัน — บนมือถือ key ยาวๆ กับปุ่มที่ยืนอยู่
                  บรรทัดเดียวกันจะบีบ key ให้เหลือคอลัมน์แคบมากจนตัดเป็นสิบบรรทัด */}
              <div className="flex min-w-0 flex-col gap-2 rounded-control border border-line bg-surface p-3 sm:flex-row sm:items-start">
                {/* break-all ไม่ใช่ truncate: key ต้องอ่าน/ลากเลือกได้ครบทุกตัวอักษร
                    เพราะถ้าเปิดผ่าน http ปุ่มคัดลอกอาจใช้ไม่ได้ ต้องคัดลอกเองด้วยมือ */}
                <span className="min-w-0 flex-1 font-mono text-caption leading-[1.7] font-bold break-all select-all">
                  {created.plaintext_key}
                </span>
                <Btn
                  onClick={() => void copy()}
                  className={cn(
                    'shrink-0 gap-1.5 px-3 py-1.5 text-micro',
                    copied && 'border-ok text-ok-strong',
                  )}
                >
                  {copied ? <Check size={13} /> : <Copy size={13} />}
                  {copied ? T.copied : T.copy}
                </Btn>
              </div>

              <div className="min-w-0">
                <p className="mb-1.5 text-micro font-medium tracking-[0.04em] text-ink-2 uppercase">
                  {T.key_example_label}
                </p>
                {/* ตัดบรรทัดแทนการเลื่อนแนวนอน — ถ้าให้เลื่อน ผู้ใช้จะไม่เห็นว่ามีข้อความต่ออยู่ */}
                <pre className="min-w-0 rounded-control border border-dashed border-line bg-surface p-3 font-mono text-micro leading-[1.9] break-all whitespace-pre-wrap text-ink-2">
                  {`POST /notify
X-API-Key: ${created.plaintext_key}

{ "event_type_code": "${created.allowed_event_types[0]?.code ?? '<code>'}" }`}
                </pre>
              </div>
            </div>

            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <Btn className="sm:min-w-[7.5rem]" onClick={onClose}>
                {T.done}
              </Btn>
              <Btn variant="primary" className="flex-1" onClick={() => onConfigure(created.id)}>
                {T.save_and_configure}
              </Btn>
            </div>
          </>
        ) : (
          <>
            <label className="flex min-w-0 flex-col gap-1.5">
              <span className="text-caption font-medium">{T.device_name_label}</span>
              <input
                className={cn(inputCls, 'text-body')}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={T.device_name_ph}
                autoFocus
              />
              <span className="text-micro leading-[1.7] text-ink-2">{T.device_name_hint}</span>
            </label>

            <div className="flex min-w-0 flex-col gap-2 border-t border-line-2 pt-4">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <span className="text-caption font-medium">{T.allowed_events_pick}</span>
                {picked.length > 0 ? (
                  <span className="rounded-full bg-brand-soft px-2 py-0.5 font-mono text-micro text-brand-strong">
                    {T.events_selected(picked.length)}
                  </span>
                ) : null}
                {eventTypes.length > 0 ? (
                  <button
                    type="button"
                    onClick={() =>
                      setPicked(picked.length === eventTypes.length ? [] : eventTypes.map((e) => e.id))
                    }
                    className="ms-auto shrink-0 text-micro font-medium text-brand-strong hover:underline"
                  >
                    {picked.length === eventTypes.length ? T.events_clear : T.events_select_all}
                  </button>
                ) : null}
              </div>

              {eventTypes.length > EVENT_FILTER_THRESHOLD ? (
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={T.event_filter}
                  aria-label={T.event_filter}
                  className={inputCls}
                />
              ) : null}

              {eventTypes.length === 0 ? (
                <p className="rounded-control border border-dashed border-warn px-3 py-2.5 text-caption leading-[1.8] text-warn-strong">
                  {T.allowed_events_empty_hint}
                </p>
              ) : (
                /* -me-4 คู่กับ pe-2: แถบเลื่อนแบบปกติกินที่จากกล่องเนื้อหา ไม่ได้ทับบนเนื้อหา
                   ถ้าไม่ยืมที่คืนมา คอลัมน์ขวาจะแคบกว่าคอลัมน์ซ้ายทุกแถวอย่างเห็นได้ชัด */
                <div className="-me-4 grid max-h-[15rem] gap-2 overflow-y-auto overscroll-contain pe-2 sm:grid-cols-2">
                  {shown.map((e) => {
                    const on = picked.includes(e.id);
                    return (
                      <button
                        key={e.id}
                        type="button"
                        role="checkbox"
                        aria-checked={on}
                        onClick={() => toggle(e.id)}
                        className={cn(
                          'flex min-w-0 items-center gap-2.5 rounded-control border px-3 py-2.5 text-start transition-colors',
                          on
                            ? 'border-brand-strong bg-brand-soft'
                            : 'border-line bg-surface hover:border-brand-strong',
                        )}
                      >
                        <span
                          className={cn(
                            'grid size-[18px] shrink-0 place-items-center rounded-[5px] border transition-colors',
                            on ? 'border-brand-strong bg-brand text-brand-ink' : 'border-line',
                          )}
                        >
                          {on ? <Check size={12} strokeWidth={3} /> : null}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-caption font-medium">{e.display_name}</span>
                          {/* รหัสคือค่าที่ firmware ต้องส่งมาจริง ไม่ใช่ชื่อไทย — โชว์ไว้ตรงนี้
                              คนที่กำลังเขียนโค้ดบอร์ดจะได้ไม่ต้องเปิดอีกหน้าไปหา */}
                          <span className="block truncate font-mono text-micro text-ink-2">{e.code}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}

              {picked.length === 0 && eventTypes.length > 0 ? (
                <p className="text-micro leading-[1.7] text-warn-strong">{T.allowed_events_none}</p>
              ) : null}
            </div>

            {/* จอแคบเรียงกลับด้าน (flex-col-reverse) ปุ่มหลักจึงอยู่บน ใกล้นิ้วโป้งกว่า
                และไม่ต้องเลื่อนผ่านปุ่มยกเลิกไปหาปุ่มที่ตั้งใจจะกด */}
            <div className="flex flex-col-reverse gap-2 border-t border-line-2 pt-4 sm:flex-row">
              <Btn variant="dashed" className="text-ink-2 sm:min-w-[7.5rem]" onClick={onClose}>
                {T.cancel}
              </Btn>
              <Btn
                variant="primary"
                className="flex-1"
                onClick={() => void submit()}
                disabled={!name.trim() || saving}
              >
                {saving ? T.saving : T.save_only}
              </Btn>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * หนึ่งขั้นในแถบขั้นตอน
 *
 * done = ผ่านมาแล้ว ยังคงเน้นสีไว้ ไม่ใช่ดับไปตอนขึ้นขั้นถัดไป — คนจะได้เห็นว่า
 * เดินมาถึงไหนแล้ว ไม่ใช่เห็นแค่ว่ากำลังอยู่ตรงไหน
 */
function StepPill({ n, label, state }: { n: number; label: string; state: 'done' | 'current' | 'todo' }) {
  const lit = state !== 'todo';
  return (
    <span className={cn('flex shrink-0 items-center gap-2', lit ? 'text-ink' : 'text-ink-2')}>
      <span
        className={cn(
          'grid size-6 shrink-0 place-items-center rounded-full border font-mono text-micro font-bold',
          state === 'current'
            ? 'border-brand bg-brand text-brand-ink'
            : state === 'done'
              ? 'border-brand-strong bg-brand-soft text-brand-strong'
              : 'border-line text-ink-2',
        )}
      >
        {state === 'done' ? <Check size={13} strokeWidth={3} /> : n}
      </span>
      <span className="hidden text-caption font-medium whitespace-nowrap sm:inline">{label}</span>
    </span>
  );
}
