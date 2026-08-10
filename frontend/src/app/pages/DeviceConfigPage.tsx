/**
 * DeviceConfigPage — พอร์ตจาก figma/handoff/components/DeviceConfigPage.tsx
 *
 * ── นี่คือหน้าที่ปรับ IA มากที่สุดในชุด ────────────────────────────────────
 * ดีไซน์ตั้งสมมติฐานว่า config ทุกอย่างอยู่ "ที่ตัวอุปกรณ์" — 3 แท็บคือ
 * เงื่อนไข (value > 80 ค้าง 10 วิ) / เบอร์+เสียง / retry+ช่วงห้ามโทร
 *
 * backend เราวาง config ไว้ที่ event type + กลุ่มผู้รับ ซึ่งแชร์กันได้ (ตัดสินใจไว้ใน
 * DEPLOYMENT_MODELS.md): อุปกรณ์ 20 ตัวใช้กลุ่ม "ทีมช่าง" ร่วมกัน เบอร์เปลี่ยนแก้ที่เดียว
 * ถ้าย้ายมาเก็บต่ออุปกรณ์จะต้องแก้ 20 ที่ จึงเก็บโครงเดิมไว้แล้วเปลี่ยนหน้านี้เป็น:
 *
 *   - แก้ชื่ออุปกรณ์ (ชื่อนี้ถูกพูดในสายแทน {device})
 *   - ติ๊กว่าอุปกรณ์นี้ยิง event type ไหนได้ (สิทธิ์ — ของจริงใน backend)
 *   - กล่องสรุปภาษาคน สร้างจากข้อมูลจริง (กลุ่ม + เบอร์เรียงลำดับ + retry จาก /config)
 *   - payload จริงที่บอร์ดต้องส่ง
 *
 * ส่วนที่ดีไซน์มีแต่ backend ยังไม่มี (เงื่อนไข rule engine, quiet hours, cooldown,
 * เสียงชาย/หญิง, จำนวนรอบพูด) ไม่ได้ทำเป็นช่องหลอกไว้ — ดู DEPLOYMENT_MODELS.md ข้อ 16-21
 */
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';

import { cn } from '@/app/components/ui/utils';
import { copyText } from '../lib/clipboard';
import { API_BASE_URL } from '../api/client';
import { listApiKeys, deleteApiKey, updateApiKey } from '../api/apiKeys';
import { getConfig } from '../api/config';
import { listEventTypes, sendTestNotify } from '../api/eventTypes';
import { listContacts, listGroups } from '../api/groups';
import { Btn, Card, Field, inputCls } from '../components/primitives';
import { useApp } from '../context/AppContext';
import type { ApiKey, AppConfig, Contact, EventType, Group } from '../types';

export function DeviceConfigPage() {
  const { T } = useApp();
  const navigate = useNavigate();
  const { id } = useParams();
  const deviceId = Number(id);

  const [device, setDevice] = useState<ApiKey | null>(null);
  const [eventTypes, setEventTypes] = useState<EventType[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [contactsByGroup, setContactsByGroup] = useState<Record<number, Contact[]>>({});
  const [config, setConfig] = useState<AppConfig | null>(null);

  const [name, setName] = useState('');
  const [picked, setPicked] = useState<number[]>([]);
  const [pendingDelete, setPendingDelete] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void (async () => {
      const [keys, types, grps, cfg] = await Promise.all([
        listApiKeys(),
        listEventTypes(),
        listGroups(),
        getConfig(),
      ]);
      const found = keys.find((k) => k.id === deviceId) ?? null;
      setDevice(found);
      setEventTypes(types);
      setGroups(grps);
      setConfig(cfg);
      if (found) {
        setName(found.name);
        setPicked(found.allowed_event_types.map((e) => e.id));
      }
      // ดึงเบอร์ของทุกกลุ่มไว้ประกอบกล่องสรุป — จำนวนกลุ่มน้อย เรียกพร้อมกันได้
      const lists = await Promise.all(grps.map(async (g) => [g.id, await listContacts(g.id)] as const));
      setContactsByGroup(Object.fromEntries(lists));
    })();
  }, [deviceId]);

  const toggle = (etId: number) =>
    setPicked((prev) => (prev.includes(etId) ? prev.filter((x) => x !== etId) : [...prev, etId]));

  const save = async () => {
    setSaving(true);
    try {
      const updated = await updateApiKey(deviceId, { name: name.trim(), event_type_ids: picked });
      setDevice(updated);
      toast.success(T.toast_updated);
    } finally {
      setSaving(false);
    }
  };

  const testCall = async () => {
    const first = eventTypes.find((e) => picked.includes(e.id));
    if (!first) {
      toast.error(T.allowed_events_none);
      return;
    }
    await sendTestNotify({ event_type_code: first.code });
    toast.success(T.toast_created);
  };

  const remove = async () => {
    await deleteApiKey(deviceId);
    toast.success(T.toast_deleted);
    navigate('/devices', { replace: true });
  };

  if (!device) {
    return <p className="text-caption text-ink-2">…</p>;
  }

  const pickedTypes = eventTypes.filter((e) => picked.includes(e.id));

  // navigator.clipboard ใช้ไม่ได้ตอนเปิดผ่าน http:// ที่ไม่ใช่ localhost (ไม่ใช่ secure context)
  // copyText มี fallback ให้ และคืน false ถ้าคัดลอกไม่ได้จริง — จะได้ไม่ขึ้น "คัดลอกแล้ว" หลอกตา
  const copy = async (key: string, text: string) => {
    if (!(await copyText(text))) return;
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1500);
  };

  // ตัวอย่างทั้งหมดผูกกับค่าจริงของอุปกรณ์นี้ ไม่ใช่ placeholder ให้ไปแทนค่าเอง
  const sampleCode = pickedTypes[0]?.code ?? '<event_type_code>';
  const curlCode = `curl -X POST ${API_BASE_URL}/notify \
  -H "X-API-Key: ${device.key_prefix}••••••" \
  -H "Content-Type: application/json" \
  -d '{"event_type_code": "${sampleCode}"}'`;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Link to="/devices" className="text-caption font-medium text-brand">
          ‹ {T.devices_title}
        </Link>
        {/* mt-2 กันวรรณยุกต์ของหัวข้อไทยชนลิงก์ย้อนกลับ */}
        <h1 className="mt-2 text-page font-bold">
          {T.device_config_title} · {device.name}
        </h1>
        <p className="mt-1 font-mono text-caption text-ink-2">
          key {device.key_prefix}•••••
        </p>
        <p className="mt-1 text-caption leading-[1.8] text-ink-2">{T.key_no_copy_hint}</p>
      </div>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(290px,100%),1fr))] items-start gap-3.5">
        <Card className="col-span-full flex min-w-0 flex-col gap-4 p-4 xl:col-span-2">
          <section className="flex flex-col gap-3">
            <Field label={T.device_name_label}>
              <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <p className="-mt-1 text-caption leading-[1.8] text-ink-2">{T.device_name_hint}</p>
          </section>

          <section className="flex flex-col gap-3">
            <h2 className="text-lead font-bold">{T.allowed_events_pick}</h2>
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
                    <span className="ms-1.5 font-mono text-micro opacity-70">{e.code}</span>
                  </button>
                ))}
              </div>
            )}
            {picked.length === 0 ? (
              <p className="text-caption leading-[1.8] text-warn">{T.allowed_events_none}</p>
            ) : null}
            <p className="rounded-card border border-dashed border-line bg-surface-2 px-3 py-3 text-caption leading-[1.8] text-ink-2">
              {T.shared_config_note}
            </p>
          </section>

          <div className="flex flex-wrap gap-2 pt-1">
            <Btn variant="primary" onClick={() => void save()} disabled={saving || !name.trim()}>
              {T.save}
            </Btn>
            <Btn onClick={() => void testCall()}>{T.device_test_call}</Btn>
            <Btn
              variant={pendingDelete ? 'danger' : 'dashed'}
              className={pendingDelete ? '' : 'ms-auto text-warn'}
              onClick={() => (pendingDelete ? void remove() : setPendingDelete(true))}
            >
              {pendingDelete ? `${T.device_remove_confirm} “${device.name}”` : T.device_remove}
            </Btn>
          </div>
        </Card>

        <div className="flex min-w-0 flex-col gap-3.5">
          <Card className="p-4">
            <h3 className="mb-2.5 text-caption font-bold">{T.what_will_happen}</h3>
            {pickedTypes.length === 0 ? (
              <p className="text-caption text-ink-2">{T.what_will_happen_empty}</p>
            ) : (
              <div className="flex flex-col gap-3.5">
                {pickedTypes.map((et) => {
                  const group = groups.find((g) => g.id === et.group_id);
                  const contacts = contactsByGroup[et.group_id] ?? [];
                  return (
                    <div key={et.id} className="flex min-w-0 flex-col gap-1">
                      {/* leading สูงเพราะเป็นประโยคไทยหลายบรรทัด */}
                      <p className="text-caption leading-[2] text-ink-2">
                        ถ้ายิง <b className="font-mono text-ink">{et.code}</b>
                        <br />→ โทรกลุ่ม <b className="text-ink">{group?.name ?? '—'}</b>
                        {contacts.map((c) => (
                          <span key={c.id}>
                            <br />
                            &nbsp;&nbsp;{c.order_index + 1}. <b className="font-mono text-ink">{c.phone_number}</b>
                            {c.name ? ` (${c.name})` : ''}
                          </span>
                        ))}
                        {contacts.length === 0 ? (
                          <>
                            <br />
                            <span className="text-warn">— ยังไม่มีเบอร์ในกลุ่มนี้</span>
                          </>
                        ) : null}
                        {config ? (
                          <>
                            <br />→ {T.retry_summary(config.call_retry_count, config.call_retry_delay_seconds)}
                            <br />→ {T.escalate_summary}
                          </>
                        ) : null}
                      </p>
                      <p className="mt-0.5 font-mono text-micro leading-[1.9] text-ink-2">
                        ข้อความ: {et.message_template}
                      </p>
                    </div>
                  );
                })}
                <div className="flex flex-wrap gap-2">
                  <Link to="/event-types" className="text-caption font-medium text-brand">
                    {T.goto_event_types} ›
                  </Link>
                  <Link to="/contacts" className="text-caption font-medium text-brand">
                    {T.goto_contacts} ›
                  </Link>
                </div>
              </div>
            )}
          </Card>

          {/* ── วิธียิง API ของอุปกรณ์ตัวนี้ ────────────────────────────────
              ยกมาจากหน้า API guide แต่เติมค่าจริงของอุปกรณ์นี้ให้แล้ว (key prefix,
              รหัสเหตุการณ์ที่ติ๊กไว้, base URL ที่กำลังเปิดอยู่)
              หน้า API guide เป็นเอกสารกลางที่ต้องมาแทนค่าเอง ซึ่งเป็นจังหวะที่พลาดกันบ่อย
              — พิมพ์รหัสเหตุการณ์ผิดตัวเดียวก็ได้ 404 โดยไม่รู้ว่าพิมพ์ผิดตรงไหน */}
          <Card className="flex flex-col gap-3 p-4">
            <div>
              <h3 className="text-caption font-bold">{T.dev_api_title}</h3>
              <p className="mt-1 text-micro leading-[1.7] text-ink-2">{T.dev_api_sub}</p>
            </div>

            {pickedTypes.length === 0 ? (
              <p className="text-caption leading-[1.8] text-warn">{T.dev_api_no_event}</p>
            ) : null}

            <CodeBlock label={T.payload_title} code={curlCode} onCopy={copy} copied={copiedKey === 'curl'} ck="curl" />
            <CodeBlock label={T.dev_api_ok} code={OK_RESPONSE} onCopy={copy} copied={copiedKey === 'ok'} ck="ok" />
            <CodeBlock label={T.dev_api_err} code={ERR_RESPONSE} onCopy={copy} copied={copiedKey === 'err'} ck="err" />

            <p className="text-micro leading-[1.7] text-warn">{T.dev_api_key_note}</p>

            <div className="flex flex-col gap-1 border-t border-line-2 pt-2.5">
              <span className="font-mono text-micro tracking-[0.1em] text-ink-2 uppercase">{T.dev_api_status}</span>
              {[
                ['401', T.dev_api_status_401],
                ['403', T.dev_api_status_403],
                ['404', T.dev_api_status_404],
                ['422', T.dev_api_status_422],
              ].map(([code, desc]) => (
                <p key={code} className="flex gap-2 text-micro leading-[1.7]">
                  <b className="shrink-0 font-mono text-bad">{code}</b>
                  <span className="text-ink-2">{desc}</span>
                </p>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

const OK_RESPONSE = `{
  "job_id": 42,
  "status": "queued",
  "message": "เข้าคิวเรียบร้อยแล้ว"
}`;

const ERR_RESPONSE = `{
  "detail": "อุปกรณ์ 'ปั๊มน้ำอาคาร A' ไม่ได้รับอนุญาตให้ยิง event type 'pump_fail'"
}`;

/** โค้ดบล็อกพร้อมปุ่มคัดลอก — ปุ่มลอยมุมขวาบนเพื่อไม่กินความกว้างของโค้ด */
function CodeBlock({
  label,
  code,
  ck,
  copied,
  onCopy,
}: {
  label: string;
  code: string;
  ck: string;
  copied: boolean;
  onCopy: (key: string, text: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="font-mono text-micro tracking-[0.1em] text-ink-2 uppercase">{label}</span>
      <div className="relative">
        <pre className="overflow-x-auto rounded-control border border-dashed border-line bg-surface-2 p-2.5 pe-16 font-mono text-micro leading-[1.9] text-ink-2">
          {code}
        </pre>
        <button
          type="button"
          onClick={() => onCopy(ck, code)}
          className={cn(
            'absolute end-1.5 top-1.5 rounded-control border px-2 py-1 font-mono text-micro transition-colors',
            copied ? 'border-ok bg-ok-soft text-ok' : 'border-line bg-surface text-ink-2 hover:border-brand',
          )}
        >
          {copied ? '✓' : '⧉'}
        </button>
      </div>
    </div>
  );
}
