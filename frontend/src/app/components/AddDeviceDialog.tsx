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
 * ตัวอย่าง payload ใช้ POST /notify + header X-API-Key ตาม backend จริง
 * (ต้นฉบับเขียน POST /api/v1/event พร้อม key ใน body ซึ่งไม่ตรงกับของเรา)
 */
import { useState } from 'react';
import { toast } from 'sonner';

import { cn } from '@/app/components/ui/utils';
import { createApiKey } from '../api/apiKeys';
import { useApp } from '../context/AppContext';
import type { ApiKeyCreateResponse, EventType } from '../types';
import { Btn, Field, inputCls } from './primitives';

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
    } finally {
      setSaving(false);
    }
  };

  const copy = () => {
    if (!created) return;
    void navigator.clipboard?.writeText(created.plaintext_key);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
    toast.success(T.copy);
  };

  return (
    <div className="fixed inset-0 z-50 overflow-auto bg-black/50 px-4 py-6 backdrop-blur-sm">
      <div className="mx-auto flex w-full max-w-[460px] flex-col gap-3.5 rounded-card border border-line bg-surface p-5 shadow-card">
        <div className="flex flex-wrap items-center gap-2.5">
          <h2 className="text-lead font-bold">{T.add_device}</h2>
          <div className="ms-auto flex items-center gap-1.5 font-mono text-micro text-ink-2">
            <Step n={1} done={!created} active={!created} />›
            <Step n={2} done={!!created} active={!!created} />
          </div>
        </div>

        {created ? (
          <>
            <div className="flex flex-col gap-2.5 rounded-card border border-brand bg-brand-soft p-3.5">
              <p className="text-caption font-semibold">{T.key_once_title}</p>
              <p className="text-caption leading-[1.8] text-ink-2">{T.key_once_body}</p>
              <div className="flex items-center gap-2 rounded-control border border-line bg-surface p-2.5">
                <span className="min-w-0 flex-1 truncate font-mono text-caption font-bold">
                  {created.plaintext_key}
                </span>
                <button
                  type="button"
                  onClick={copy}
                  className="shrink-0 rounded-md border border-line bg-surface-2 px-2 py-0.5 font-mono text-micro whitespace-nowrap"
                >
                  {copied ? `✓ ${T.copy}` : T.copy}
                </button>
              </div>
              <pre className="overflow-x-auto rounded-control border border-dashed border-line bg-surface p-2.5 font-mono text-micro leading-[1.9] text-ink-2">
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
                <p className="text-caption leading-[1.8] text-warn">{T.allowed_events_empty_hint}</p>
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
                          ? 'border-brand bg-brand-soft font-semibold text-brand'
                          : 'border-line bg-surface text-ink hover:border-brand',
                      )}
                    >
                      {e.display_name}
                    </button>
                  ))}
                </div>
              )}
              {picked.length === 0 && eventTypes.length > 0 ? (
                <p className="text-caption leading-[1.8] text-warn">{T.allowed_events_none}</p>
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
      </div>
    </div>
  );
}

function Step({ n, done, active }: { n: number; done: boolean; active: boolean }) {
  return (
    <span
      className={cn(
        'rounded-full px-2 py-0.5',
        active || done ? 'bg-brand text-brand-ink' : 'border border-line',
      )}
    >
      {n}
    </span>
  );
}
