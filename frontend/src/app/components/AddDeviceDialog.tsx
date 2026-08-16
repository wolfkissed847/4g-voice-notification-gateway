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
 */
import { useState } from 'react';
import { toast } from 'sonner';

import { cn } from '@/app/components/ui/utils';
import { createApiKey } from '../api/apiKeys';
import { ApiError } from '../api/client';
import { useApp } from '../context/AppContext';
import { copyText } from '../lib/clipboard';
import type { ApiKeyCreateResponse, EventType } from '../types';
import { Btn, Field, inputCls } from './primitives';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog';

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
  const [created, setCreated] = useState<ApiKeyCreateResponse | null>(null);
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);

  const toggle = (id: number) =>
    setPicked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

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
          // ต้องกำหนด sm:max-w ด้วย ไม่งั้น sm:max-w-lg (512px) ของ DialogContent กลางยังชนะบนจอกว้าง
          'max-h-[85vh] max-w-[460px] gap-3.5 overflow-y-auto sm:max-w-[460px]',
          // [&>*]:min-w-0 สำคัญมาก: DialogContent เป็น grid ซึ่งลูกทุกตัวมี min-width:auto
          // = ย่อให้เล็กกว่าความกว้างเนื้อหาไม่ได้ พอมี key ยาวๆ ที่ตัดบรรทัดไม่ได้อยู่ข้างใน
          // มันจะดันทั้งกล่องจนล้นขอบ แล้วเกิดแถบเลื่อนแนวนอน (ดูรูปที่ผู้ใช้ส่งมา)
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
        <DialogHeader className="flex-row flex-wrap items-center gap-2.5 pe-6">
          <DialogTitle className="text-lead font-bold">{T.add_device}</DialogTitle>
          <div className="ms-auto flex items-center gap-1.5 font-mono text-micro text-ink-2">
            <Step n={1} active={!created} />›
            <Step n={2} active={!!created} />
          </div>
          <DialogDescription className="sr-only">{T.devices_sub}</DialogDescription>
        </DialogHeader>

        {created ? (
          <>
            <div className="flex min-w-0 flex-col gap-2.5 rounded-card border border-brand-strong bg-brand-soft p-3.5">
              <p className="text-caption font-semibold">{T.key_once_title}</p>
              <p className="text-caption leading-[1.8] text-ink-2">{T.key_once_body}</p>
              {/* items-start ไม่ใช่ items-center — key ตัดหลายบรรทัดได้ ปุ่มต้องอยู่ชิดบนไม่ใช่กลาง */}
              <div className="flex min-w-0 items-start gap-2 rounded-control border border-line bg-surface p-2.5">
                {/* break-all ไม่ใช่ truncate: key ต้องอ่าน/ลากเลือกได้ครบทุกตัวอักษร
                    เพราะถ้าเปิดผ่าน http ปุ่มคัดลอกอาจใช้ไม่ได้ ต้องคัดลอกเองด้วยมือ */}
                <span className="min-w-0 flex-1 font-mono text-caption font-bold break-all select-all">
                  {created.plaintext_key}
                </span>
                <button
                  type="button"
                  onClick={() => void copy()}
                  className="shrink-0 rounded-md border border-line bg-surface-2 px-2 py-0.5 font-mono text-micro whitespace-nowrap"
                >
                  {copied ? `✓ ${T.copy}` : T.copy}
                </button>
              </div>
              {/* ตัดบรรทัดแทนการเลื่อนแนวนอน — กล่องแคบ ถ้าให้เลื่อนผู้ใช้จะไม่เห็นว่ามีข้อความต่ออยู่ */}
              <pre className="min-w-0 rounded-control border border-dashed border-line bg-surface p-2.5 font-mono text-micro leading-[1.9] break-all whitespace-pre-wrap text-ink-2">
                {`POST /notify
X-API-Key: ${created.plaintext_key}

{ "event_type_code": "${created.allowed_event_types[0]?.code ?? '<code>'}" }`}
              </pre>
            </div>

            <div className="flex flex-wrap gap-2">
              <Btn variant="primary" className="min-w-[150px] flex-1" onClick={() => onConfigure(created.id)}>
                {T.save_and_configure}
              </Btn>
              <Btn onClick={onClose}>{T.done}</Btn>
            </div>
          </>
        ) : (
          <>
            <Field label={T.device_name_label}>
              <input
                className={inputCls}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={T.device_name_ph}
                autoFocus
              />
            </Field>
            <p className="-mt-1.5 text-caption leading-[1.8] text-ink-2">{T.device_name_hint}</p>

            <div className="flex min-w-0 flex-col gap-1.5">
              <span className="text-caption text-ink-2">{T.allowed_events_pick}</span>
              {eventTypes.length === 0 ? (
                <p className="text-caption leading-[1.8] text-warn-strong">{T.allowed_events_empty_hint}</p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {eventTypes.map((e) => (
                    <button
                      key={e.id}
                      type="button"
                      onClick={() => toggle(e.id)}
                      className={cn(
                        'rounded-full border px-3.5 py-2 text-caption transition-colors',
                        picked.includes(e.id)
                          ? 'border-brand-strong bg-brand-soft font-semibold text-brand-strong'
                          : 'border-line bg-surface text-ink hover:border-brand-strong',
                      )}
                    >
                      {e.display_name}
                    </button>
                  ))}
                </div>
              )}
              {picked.length === 0 && eventTypes.length > 0 ? (
                <p className="text-caption leading-[1.8] text-warn-strong">{T.allowed_events_none}</p>
              ) : null}
            </div>

            <div className="flex flex-wrap gap-2">
              <Btn
                variant="primary"
                className="min-w-[150px] flex-1"
                onClick={() => void submit()}
                disabled={!name.trim() || saving}
              >
                {T.save_only}
              </Btn>
              <Btn variant="dashed" className="text-ink-2" onClick={onClose}>
                {T.cancel}
              </Btn>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** ตัวเลขบอกขั้นตอน — ขั้นที่ผ่านมาแล้วยังคงเน้นสีไว้ ไม่ใช่ดับไปตอนขึ้นขั้นถัดไป */
function Step({ n, active }: { n: number; active: boolean }) {
  return (
    <span className={cn('rounded-full px-2 py-0.5', active ? 'bg-brand text-brand-ink' : 'border border-line')}>
      {n}
    </span>
  );
}
