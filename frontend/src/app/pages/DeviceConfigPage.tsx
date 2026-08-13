/**
 * DeviceConfigPage — จุดเดียวในระบบที่ตอบว่า "อุปกรณ์ตัวนี้ยิงอะไรได้ แล้วใครได้รับสาย"
 *
 * ── ทำไมผู้รับมาอยู่ตรงนี้ ──────────────────────────────────────────────────
 * เดิมผู้รับถูกตั้งได้จากสองที่: กลุ่มเริ่มต้นที่ตัวประเภทเหตุการณ์ กับกลุ่มรายอุปกรณ์ที่นี่
 * คำตอบว่าใครจะได้รับสายจึงขึ้นกับว่าที่ไหนถูกตั้งไว้ก่อน ต้องไล่ดูสองจุดถึงจะรู้
 * ตอนนี้ประเภทเหตุการณ์เป็นแค่ "คำพูด" และผู้รับถูกตัดสินที่คู่ (อุปกรณ์ + เหตุการณ์) ที่นี่ที่เดียว
 *
 * ── เลือกได้สองแบบ ─────────────────────────────────────────────────────────
 *   ทั้งกลุ่ม     — โทรทุกคนในกลุ่มตามลำดับของกลุ่ม เปลี่ยนสมาชิกกลุ่มแล้วมีผลกับทุกอุปกรณ์
 *                   ที่ชี้มาที่กลุ่มนี้ทันที (เบอร์เปลี่ยนแก้ที่เดียว ไม่ต้องไล่แก้ทุกอุปกรณ์)
 *   เลือกเบอร์เอง — เจาะเฉพาะคนที่เกี่ยว พร้อมจัดลำดับไล่สายของคู่นี้เอง
 *                   มีไว้เพราะ 'ทีมช่าง' มี 5 คน แต่ 'ปั๊มตึก A ดับ' ควรโทรหาแค่ 2 คนที่ดูแลตึกนั้น
 *                   ทางออกเดิมคือแตกกลุ่มใหม่ทุกครั้ง จนได้กลุ่มซ้ำซ้อนที่สมาชิกเหลื่อมกัน
 *
 * ส่วนที่ดีไซน์มีแต่ backend ยังไม่มี (เงื่อนไข rule engine, quiet hours, cooldown,
 * เสียงชาย/หญิง, จำนวนรอบพูด) ไม่ได้ทำเป็นช่องหลอกไว้ — ดู DEPLOYMENT_MODELS.md ข้อ 16-21
 */
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';

import { cn } from '@/app/components/ui/utils';
import { copyText } from '../lib/clipboard';
import { API_BASE_URL, ApiError } from '../api/client';
import { listApiKeys, deleteApiKey, revealApiKey, updateApiKey } from '../api/apiKeys';
import { getConfig } from '../api/config';
import { listEventTypes, sendTestNotify } from '../api/eventTypes';
import { listContacts, listGroups } from '../api/groups';
import { Btn, Card, Field, inputCls } from '../components/primitives';
import { useApp } from '../context/AppContext';
import type { ApiKey, AppConfig, Contact, EventType, Group } from '../types';

/**
 * ผู้รับของคู่ (อุปกรณ์ + เหตุการณ์) — เป็น union ไม่ใช่สองฟิลด์ที่อยู่ด้วยกันได้
 * ตั้งใจให้ "มีสองค่าพร้อมกัน" เป็นสถานะที่เขียนออกมาไม่ได้ตั้งแต่ระดับ type
 * เพราะนั่นคือความกำกวมที่การรื้อรอบนี้ตั้งใจกำจัด (backend ก็บังคับซ้ำอีกชั้น)
 */
type LinkTarget =
  | { mode: 'group'; groupId: number | null }
  | { mode: 'contacts'; contactIds: number[] };

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
  const [links, setLinks] = useState<Record<number, LinkTarget>>({});
  const [fullKey, setFullKey] = useState<string | null>(null);
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
        setLinks(Object.fromEntries(found.allowed_event_types.map((e): [number, LinkTarget] => [
          e.id,
          e.contacts.length > 0
            ? { mode: 'contacts', contactIds: e.contacts.map((c) => c.id) }
            : { mode: 'group', groupId: e.group_id },
        ])));
        // key เต็มดึงแยกจาก list — ดู revealApiKey ว่าทำไมไม่แนบมากับ list
        void revealApiKey(found.id).then((r) => setFullKey(r.key)).catch(() => setFullKey(null));
      }
      // ดึงเบอร์ของทุกกลุ่มไว้ประกอบตัวเลือกและกล่องสรุป — จำนวนกลุ่มน้อย เรียกพร้อมกันได้
      const lists = await Promise.all(grps.map(async (g) => [g.id, await listContacts(g.id)] as const));
      setContactsByGroup(Object.fromEntries(lists));
    })();
  }, [deviceId]);

  const picked = Object.keys(links).map(Number);
  const allContacts: Contact[] = Object.values(contactsByGroup).flat();
  const contactById = (cid: number) => allContacts.find((c) => c.id === cid);
  const groupName = (gid: number) => groups.find((g) => g.id === gid)?.name ?? '';

  const toggleEvent = (etId: number) =>
    setLinks((prev) => {
      const next = { ...prev };
      if (etId in next) delete next[etId];
      // ติ๊กใหม่ = ยังไม่เลือกผู้รับ ผู้ใช้ต้องเลือกเอง ไม่เดาให้ว่าควรโทรหาใคร
      else next[etId] = { mode: 'group', groupId: null };
      return next;
    });

  const setTarget = (etId: number, target: LinkTarget) =>
    setLinks((prev) => ({ ...prev, [etId]: target }));

  const toggleContact = (etId: number, contactId: number) =>
    setLinks((prev) => {
      const cur = prev[etId];
      const ids = cur?.mode === 'contacts' ? cur.contactIds : [];
      return {
        ...prev,
        [etId]: {
          mode: 'contacts',
          // ติ๊กใหม่ต่อท้ายเสมอ — ลำดับที่ติ๊กคือลำดับไล่สาย ซึ่งเดาง่ายกว่าการแทรกตรงกลาง
          contactIds: ids.includes(contactId) ? ids.filter((i) => i !== contactId) : [...ids, contactId],
        },
      };
    });

  const moveContact = (etId: number, index: number, delta: number) =>
    setLinks((prev) => {
      const cur = prev[etId];
      if (cur?.mode !== 'contacts') return prev;
      const to = index + delta;
      if (to < 0 || to >= cur.contactIds.length) return prev;
      const ids = [...cur.contactIds];
      [ids[index], ids[to]] = [ids[to], ids[index]];
      return { ...prev, [etId]: { mode: 'contacts', contactIds: ids } };
    });

  const save = async () => {
    setSaving(true);
    try {
      const updated = await updateApiKey(deviceId, {
        name: name.trim(),
        event_links: Object.entries(links).map(([etId, t]) => ({
          event_type_id: Number(etId),
          group_id: t.mode === 'group' ? t.groupId : null,
          contact_ids: t.mode === 'contacts' ? t.contactIds : null,
        })),
      });
      setDevice(updated);
      toast.success(T.toast_updated);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : T.error_generic);
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
    try {
      const res = await sendTestNotify({ event_type_code: first.code, device_id: deviceId });
      toast.success(T.test_sent_ok(res.job_id));
    } catch (e) {
      // ตั้งค่าไม่ครบจะได้ 400 พร้อมข้อความบอกว่าต้องไปตั้งตรงไหน — ต้องเอามาโชว์
      // ไม่ใช่ปล่อยเงียบแล้วผู้ใช้นั่งรอสายที่ไม่มีวันมา
      toast.error(e instanceof ApiError ? e.message : T.error_generic);
    }
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

  /** เบอร์ที่จะถูกโทรจริงของเหตุการณ์นี้ ตามลำดับ — ใช้ทั้งกล่องสรุปและการเตือนว่าตั้งค่าไม่ครบ */
  const resolveRecipients = (etId: number): { label: string; rows: Contact[] } => {
    const t = links[etId];
    if (t?.mode === 'contacts') {
      const rows = t.contactIds.map(contactById).filter((c): c is Contact => !!c);
      return { label: T.dev_target_contacts, rows };
    }
    if (t?.mode === 'group' && t.groupId != null) {
      return { label: groupName(t.groupId), rows: contactsByGroup[t.groupId] ?? [] };
    }
    return { label: '', rows: [] };
  };

  // navigator.clipboard ใช้ไม่ได้ตอนเปิดผ่าน http:// ที่ไม่ใช่ localhost (ไม่ใช่ secure context)
  // copyText มี fallback ให้ และคืน false ถ้าคัดลอกไม่ได้จริง — จะได้ไม่ขึ้น "คัดลอกแล้ว" หลอกตา
  const copy = async (key: string, text: string) => {
    if (!(await copyText(text))) return;
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1500);
  };

  // ตัวอย่างทั้งหมดผูกกับค่าจริงของอุปกรณ์นี้ ไม่ใช่ placeholder ให้ไปแทนค่าเอง
  const sampleCode = pickedTypes[0]?.code ?? '<event_type_code>';
  // ใช้ key เต็มจริงถ้าถอดรหัสได้ — ก็อปไปวางใน firmware ได้ทันทีโดยไม่ต้องแทนค่าเอง
  // ถ้าเป็นอุปกรณ์ที่สร้างก่อนระบบเก็บ key ไว้ได้ ถอยไปแสดงแบบปิดบังตามเดิม
  const keyForCode = fullKey ?? `${device.key_prefix}••••••`;

  // ⚠️ ต้องเป็น \\ ไม่ใช่ \ — ใน template literal ของ JS เครื่องหมาย \ ท้ายบรรทัดคือ
  // "ต่อบรรทัด" (กลืน newline ทิ้ง) ผลคือคำสั่งทั้งหมดถูกยุบเหลือบรรทัดเดียวยาวเหยียด
  // เราต้องการ backslash จริงๆ ในผลลัพธ์ (เป็นตัวต่อบรรทัดของ shell) จึงต้อง escape เป็น \\
  const curlCode = `curl -X POST ${API_BASE_URL}/notify \\
  -H "X-API-Key: ${keyForCode}" \\
  -H "Content-Type: application/json" \\
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
        {fullKey ? (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="text-caption text-ink-2">{T.dev_key_full}</span>
            <code className="min-w-0 flex-1 overflow-x-auto rounded-control border border-line bg-surface-2 px-2.5 py-1.5 font-mono text-caption whitespace-nowrap">
              {fullKey}
            </code>
            <button
              type="button"
              onClick={() => void copy('key', fullKey)}
              className={cn(
                'shrink-0 rounded-control border px-2.5 py-1.5 font-mono text-micro transition-colors',
                copiedKey === 'key'
                  ? 'border-ok bg-ok-soft text-ok'
                  : 'border-line bg-surface text-ink-2 hover:border-brand',
              )}
            >
              {copiedKey === 'key' ? `✓ ${T.copied}` : `⧉ ${T.copy}`}
            </button>
          </div>
        ) : (
          <>
            <p className="mt-1 font-mono text-caption text-ink-2">key {device.key_prefix}•••••</p>
            <p className="mt-1 text-caption leading-[1.8] text-warn">{T.dev_key_locked}</p>
          </>
        )}
      </div>

      {/* 2 คอลัมน์ตายตัวบนจอกว้าง ไม่ใช่ auto-fit — auto-fit ตัดสินจำนวนคอลัมน์จากความกว้าง
          ที่เหลือ ทำให้การ์ดฝั่งขวาบางจอได้ 1 คอลัมน์บางจอได้ 2 แล้วความสูงไม่สัมพันธ์กัน */}
      <div className="grid grid-cols-1 items-start gap-3.5 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <Card className="flex min-w-0 flex-col gap-4 p-4">
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
              <div className="flex flex-col gap-2">
                {eventTypes.map((e) => (
                  <EventTargetRow
                    key={e.id}
                    eventType={e}
                    target={links[e.id]}
                    groups={groups}
                    contactsByGroup={contactsByGroup}
                    onToggleEvent={() => toggleEvent(e.id)}
                    onSetTarget={(t) => setTarget(e.id, t)}
                    onToggleContact={(cid) => toggleContact(e.id, cid)}
                    onMoveContact={(index, delta) => moveContact(e.id, index, delta)}
                    contactById={contactById}
                  />
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
                  const { label, rows } = resolveRecipients(et.id);
                  return (
                    <div key={et.id} className="flex min-w-0 flex-col gap-1">
                      {/* leading สูงเพราะเป็นประโยคไทยหลายบรรทัด */}
                      <p className="text-caption leading-[2] text-ink-2">
                        ถ้ายิง <b className="font-mono text-ink">{et.code}</b>
                        <br />→{' '}
                        {label ? (
                          <>
                            {T.dev_will_call} <b className="text-ink">{label}</b>
                          </>
                        ) : (
                          <b className="text-warn">{T.dev_target_missing}</b>
                        )}
                        {rows.map((c, i) => (
                          <span key={c.id}>
                            <br />
                            &nbsp;&nbsp;{i + 1}. <b className="font-mono text-ink">{c.phone_number}</b>
                            {c.name ? ` (${c.name})` : ''}
                          </span>
                        ))}
                        {label && rows.length === 0 ? (
                          <>
                            <br />
                            <span className="text-warn">— {T.dev_group_empty}</span>
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
              รหัสเหตุการณ์ที่ติ๊กไว้, base URL ที่กำลังเปิดอยู่) */}
          <Card className="flex min-w-0 flex-col gap-3 p-4">
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
                ['400', T.dev_api_status_400],
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

/**
 * หนึ่งแถว = หนึ่งประเภทเหตุการณ์ + ผู้รับของคู่นี้
 *
 * ติ๊กแล้วส่วนเลือกผู้รับถึงจะกางออก — เหตุการณ์ที่อุปกรณ์นี้ยิงไม่ได้ ไม่ต้องมีผู้รับ
 * และการโชว์ช่องเลือกไว้ทั้งที่ยังไม่ติ๊กจะทำให้หน้ายาวจนหาแถวที่เปิดอยู่ไม่เจอ
 */
function EventTargetRow({
  eventType,
  target,
  groups,
  contactsByGroup,
  onToggleEvent,
  onSetTarget,
  onToggleContact,
  onMoveContact,
  contactById,
}: {
  eventType: EventType;
  target: LinkTarget | undefined;
  groups: Group[];
  contactsByGroup: Record<number, Contact[]>;
  onToggleEvent: () => void;
  onSetTarget: (t: LinkTarget) => void;
  onToggleContact: (contactId: number) => void;
  onMoveContact: (index: number, delta: number) => void;
  contactById: (id: number) => Contact | undefined;
}) {
  const { T } = useApp();
  const on = target !== undefined;
  const mode = target?.mode ?? 'group';
  const pickedIds = target?.mode === 'contacts' ? target.contactIds : [];
  const groupId = target?.mode === 'group' ? target.groupId : null;
  const totalContacts = Object.values(contactsByGroup).flat().length;
  const incomplete = on && (mode === 'group' ? groupId == null : pickedIds.length === 0);

  return (
    <div
      className={cn(
        'flex flex-col gap-2.5 rounded-control border px-3 py-2.5 transition-colors',
        on ? 'border-brand bg-brand-soft/40' : 'border-line bg-surface',
      )}
    >
      <button type="button" onClick={onToggleEvent} className="flex min-w-0 items-center gap-2.5 text-start">
        <span
          className={cn(
            'grid size-4 shrink-0 place-items-center rounded-[4px] border text-[10px] font-bold',
            on ? 'border-brand bg-brand text-brand-ink' : 'border-line',
          )}
        >
          {on ? '✓' : ''}
        </span>
        <span className="min-w-0">
          <span className={cn('text-caption', on && 'font-semibold')}>{eventType.display_name}</span>
          <span className="ms-1.5 font-mono text-micro text-ink-2">{eventType.code}</span>
        </span>
      </button>

      {on ? (
        <div className="flex flex-col gap-2.5 border-t border-line-2 pt-2.5">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
            <span className="text-micro font-semibold text-ink-2">{T.dev_target_mode}</span>
            {(['group', 'contacts'] as const).map((m) => (
              <label key={m} className="flex cursor-pointer items-center gap-1.5">
                <input
                  type="radio"
                  name={`target-${eventType.id}`}
                  checked={mode === m}
                  onChange={() =>
                    onSetTarget(m === 'group' ? { mode: 'group', groupId: null } : { mode: 'contacts', contactIds: [] })
                  }
                  className="accent-brand"
                />
                <span className="text-caption">{m === 'group' ? T.dev_target_group : T.dev_target_contacts}</span>
              </label>
            ))}
          </div>

          {mode === 'group' ? (
            <select
              value={groupId ?? ''}
              onChange={(ev) => onSetTarget({ mode: 'group', groupId: ev.target.value ? Number(ev.target.value) : null })}
              className={cn(
                inputCls,
                'w-auto min-w-[180px] py-1.5 text-caption [color-scheme:light] dark:[color-scheme:dark]',
                groupId == null && 'border-warn',
              )}
            >
              <option value="">{T.dev_call_group_none}</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name} ({(contactsByGroup[g.id] ?? []).length})
                </option>
              ))}
            </select>
          ) : (
            <div className="flex flex-col gap-2">
              <p className="text-micro leading-[1.7] text-ink-2">{T.dev_pick_contacts_hint}</p>
              {totalContacts === 0 ? (
                <p className="text-caption leading-[1.8] text-warn">{T.dev_no_contacts_at_all}</p>
              ) : (
                <div className="flex max-h-[260px] flex-col gap-2 overflow-y-auto rounded-control border border-line bg-surface p-2.5">
                  {groups.map((g) => {
                    const rows = contactsByGroup[g.id] ?? [];
                    if (rows.length === 0) return null;
                    return (
                      <div key={g.id} className="flex flex-col gap-1">
                        <span className="font-mono text-micro tracking-[0.08em] text-ink-2 uppercase">{g.name}</span>
                        {rows.map((c) => {
                          const order = pickedIds.indexOf(c.id);
                          return (
                            <label
                              key={c.id}
                              className="flex cursor-pointer items-center gap-2 rounded-control px-1.5 py-1 hover:bg-surface-2"
                            >
                              <input
                                type="checkbox"
                                checked={order >= 0}
                                onChange={() => onToggleContact(c.id)}
                                className="accent-brand"
                              />
                              {/* เลขลำดับติดอยู่กับตัวเบอร์เลย จะได้เห็นทันทีว่าติ๊กแล้วโทรเป็นคนที่เท่าไหร่
                                  โดยไม่ต้องเลื่อนไปดูรายการลำดับด้านล่าง */}
                              <span
                                className={cn(
                                  'grid size-5 shrink-0 place-items-center rounded-full font-mono text-micro',
                                  order >= 0 ? 'bg-brand text-brand-ink' : 'text-ink-2',
                                )}
                              >
                                {order >= 0 ? order + 1 : '–'}
                              </span>
                              <span className="min-w-0 text-caption">
                                <b className="font-mono">{c.phone_number}</b>
                                {c.name ? <span className="ms-1.5 text-ink-2">{c.name}</span> : null}
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              )}

              {pickedIds.length > 0 ? (
                <div className="flex flex-col gap-1">
                  <span className="font-mono text-micro tracking-[0.08em] text-ink-2 uppercase">
                    {T.dev_call_order}
                  </span>
                  {pickedIds.map((cid, index) => {
                    const c = contactById(cid);
                    return (
                      <div key={cid} className="flex items-center gap-2 text-caption">
                        <span className="font-mono text-ink-2">{index + 1}.</span>
                        <span className="min-w-0 flex-1 truncate">
                          <b className="font-mono">{c?.phone_number ?? cid}</b>
                          {c?.name ? <span className="ms-1.5 text-ink-2">{c.name}</span> : null}
                        </span>
                        <button
                          type="button"
                          title={T.move_up}
                          disabled={index === 0}
                          onClick={() => onMoveContact(index, -1)}
                          className="rounded-control border border-line px-1.5 py-0.5 text-micro text-ink-2 disabled:opacity-40"
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          title={T.move_down}
                          disabled={index === pickedIds.length - 1}
                          onClick={() => onMoveContact(index, 1)}
                          className="rounded-control border border-line px-1.5 py-0.5 text-micro text-ink-2 disabled:opacity-40"
                        >
                          ↓
                        </button>
                      </div>
                    );
                  })}
                </div>
              ) : null}
            </div>
          )}

          {incomplete ? <p className="text-micro leading-[1.7] text-warn">{T.dev_target_missing}</p> : null}
        </div>
      ) : null}
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
