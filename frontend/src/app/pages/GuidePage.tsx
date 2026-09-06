/**
 * GuidePage — คู่มือของระบบ รวม "วิธีใช้งาน" กับ "เอกสาร API" ไว้เมนูเดียว
 *
 * ── ทำไมรวม ────────────────────────────────────────────────────────────────
 * เดิมเมนูนี้ชื่อ "API guide" และมีแต่เอกสารสำหรับคนเขียนโค้ดยิงเข้ามา ซึ่งตอบได้
 * แค่ครึ่งเดียวของคำถามที่คนใช้จริงมี — อีกครึ่งคือ "ตั้งค่าอะไรก่อนอะไร",
 * "สถานะนี้แปลว่าอะไร", "โทรไม่ออกต้องดูตรงไหน" ซึ่งเดิมไม่มีที่อยู่ในเว็บเลย
 *
 * แท็บ "วิธีใช้งาน" เขียนจากพฤติกรรมจริงของ backend ตัวนี้ ไม่ใช่คู่มือทั่วไป
 * ทุกตัวเลขในนั้น (เพดานสาย/ชม., สูตรงบเวลา, รหัสสถานะ) ตรงกับที่โค้ดทำจริง
 *
 * ── กฎการเขียนเนื้อหาในหน้านี้ ─────────────────────────────────────────────
 * 1. ทุกปุ่ม/ชื่อหน้าที่อ้างถึง ต้องเป็นคำที่มีอยู่จริงบนจอตอนนี้ ไม่ใช่คำที่เคยมี
 *    (หน้าอุปกรณ์ถูกรื้อมาแล้วสี่รอบ คู่มือที่บอกให้ "ติ๊กช่อง" ทั้งที่ตอนนี้เป็น
 *     ปุ่ม "เพิ่มเหตุการณ์" ทำให้คนหาไม่เจอแล้วเชื่อว่าตัวเองทำผิด)
 * 2. ประโยคเดียวจบถ้าจบได้ — คู่มือถูกอ่านตอนติดปัญหา ไม่ใช่ตอนว่าง
 *    ย่อหน้าที่ต้องอ่านสามรอบถึงจะเจอคำตอบ มีค่าเท่ากับไม่ได้เขียน
 *
 * เนื้อหาเขียนสองภาษาแบบ inline (th ? ... : ...) ไม่ผ่าน TR เหมือนหน้าอื่น
 * เพราะเป็นย่อหน้ายาวหลายสิบชิ้น ถ้าแตกเป็น key จะได้ TR ที่บวมขึ้นเท่าตัว
 * และเวลาแก้ถ้อยคำต้องกระโดดไปมาระหว่างสองไฟล์ทุกครั้ง
 */
import { useState } from 'react';
import { Link } from 'react-router';

import { cn } from '@/app/components/ui/utils';
import { Card, PageHeader } from '../components/primitives';
import { StatusBadge } from '../components/StatusBadge';
import { useApp } from '../context/AppContext';
import { statusMeanings } from '../lib/callStatus';
import { ApiGuidePage } from './ApiGuidePage';

type TabId = 'usage' | 'api';

export function GuidePage() {
  const { T } = useApp();
  const [tab, setTab] = useState<TabId>('usage');

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={T.guide_title} meta={T.guide_sub} />

      <div className="flex flex-wrap gap-1.5">
        {(
          [
            { id: 'usage', label: T.guide_tab_usage },
            { id: 'api', label: T.guide_tab_api },
          ] as const
        ).map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={cn(
              'rounded-full border px-3.5 py-1.5 text-caption whitespace-nowrap transition-colors',
              tab === t.id
                ? 'border-brand-strong bg-brand-soft font-semibold text-ink'
                : 'border-line bg-surface font-medium text-ink hover:border-brand-strong',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'usage' ? <UsageGuide /> : <ApiGuidePage embedded />}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   แท็บ "วิธีใช้งาน"
   ═══════════════════════════════════════════════════════════════════════════ */

function UsageGuide() {
  const { lang } = useApp();
  const th = lang === 'th';

  /* ขั้นตอนตั้งค่า — ชื่อปุ่มในนี้ต้องตรงกับที่อยู่บนจอจริงทุกคำ */
  const setupSteps = [
    {
      n: 1,
      to: '/contacts',
      title: th ? 'กลุ่มผู้รับ' : 'Contact groups',
      body: th
        ? 'สร้างกลุ่ม ใส่ชื่อกับเบอร์ ลำดับในกลุ่ม = ลำดับที่ระบบไล่โทร (สลับลำดับได้ในป๊อปอัพ "แก้ไข")'
        : 'Create a group and add names + numbers. Their order is the dial order — reorder inside the Edit popup.',
    },
    {
      n: 2,
      to: '/event-types',
      title: th ? 'ประเภทเหตุการณ์' : 'Event types',
      body: th
        ? 'เก็บแค่ "คำพูด" — รหัสที่อุปกรณ์ส่งมา ชื่อที่แสดง และข้อความที่จะพูด ไม่มีผู้รับสายที่หน้านี้'
        : 'Wording only — the code devices send, a display name, and what gets said. No recipients here.',
    },
    {
      n: 3,
      to: '/devices',
      title: th ? 'อุปกรณ์ & key' : 'Devices & keys',
      body: th
        ? 'เพิ่มอุปกรณ์ → "เพิ่มเหตุการณ์" → "ตั้งค่า" เลือกผู้รับ → คัดลอก key ไปฝังในบอร์ด'
        : 'Add a device → "Add event" → "Set up" to pick recipients → copy the key into the board.',
    },
  ];

  const statusRows = statusMeanings(th);

  const troubles = [
    {
      sym: th ? 'ยิงเข้ามาแล้วได้ 403' : 'Requests return 403',
      fix: th
        ? 'อุปกรณ์ยังไม่มีเหตุการณ์นี้ → หน้าอุปกรณ์ กด "เพิ่มเหตุการณ์"'
        : 'The device does not have this event → Devices, press "Add event"',
    },
    {
      sym: th ? 'ได้ 400 บอกว่ายังไม่มีผู้รับ' : 'A 400 about missing recipients',
      fix: th
        ? 'แถวเหตุการณ์นั้นขึ้นจุดส้ม → กด "ตั้งค่า" เลือกกลุ่มหรือเลือกเบอร์เอง'
        : 'That row shows an amber dot → press "Set up" and pick a group or individual numbers',
    },
    {
      sym: th ? 'งานค้างในคิว ไม่โทรออกสักที' : 'Jobs stay queued and never dial',
      fix: th
        ? 'โมดูล 4G หลุด → ดูการ์ด "โมดูล 4G" หน้าระบบ เสียบกลับแล้วต่อเองใน 2-3 วินาที'
        : '4G module disconnected → check its card on System; re-plug and it reconnects on its own',
    },
    {
      sym: th ? 'โทรติดแต่ไม่ได้ยินเสียงพูด' : 'Call connects but nothing is spoken',
      fix: th
        ? 'Pi เน็ตหลุด → เสียงถูกสร้างสดทุกสาย ดูรายละเอียดที่หน้าประวัติการโทร'
        : 'The Pi lost internet → speech is generated per call; see Call history for the detail',
    },
    {
      sym: th ? 'ไม่มีใครรับสายทั้งที่เบอร์ถูก' : 'Nobody answers even though numbers are right',
      fix: th
        ? 'เครือข่ายตัดเข้าฝากข้อความ ระบบนับเป็น "รับสายแล้ว" → ลดเวลารอรับสายเหลือ ~30 วิ'
        : 'The carrier diverts to voicemail, counted as answered → lower ring timeout to ~30s',
    },
  ];

  const limits = th
    ? [
        'ซิมใบเดียว โทรได้ทีละสาย — เพดานจริงราว 80 สาย/ชั่วโมง',
        'ต้องมีเน็ตทุกครั้งที่โทร เพราะเสียงถูกสร้างสด',
        'ไม่มีไฟสำรอง — ไฟดับคือดับ ไฟมาแล้วงานที่ค้างถูกดึงกลับเข้าคิวเอง',
        'ข้อความยาวได้ไม่เกิน 500 ตัวอักษรต่อสาย',
      ]
    : [
        'One SIM, one call at a time — about 80 calls per hour in practice',
        'Internet is required on every call because speech is generated on demand',
        'No battery backup — a power cut stops everything; queued jobs resume on boot',
        'Messages are capped at 500 characters per call',
      ];

  return (
    <div className="grid items-start gap-3.5 lg:grid-cols-2">
      {/* ── คอลัมน์ซ้าย: ทำอะไร แล้วต้องทำอะไรบ้าง ── */}
      <div className="flex min-w-0 flex-col gap-3.5">
        <Card className="flex flex-col gap-2.5 p-4">
          <h2 className="text-lead font-bold">{th ? 'ระบบนี้ทำอะไร' : 'What this system does'}</h2>
          <p className="text-caption leading-[1.9] text-ink-2">
            {th
              ? 'อุปกรณ์ยิง HTTP เข้ามา ระบบโทรออกด้วย 4G แล้วอ่านข้อความให้ฟัง — ใช้ตอนที่อีเมลหรือแอปแจ้งเตือนไม่ทันการณ์'
              : 'A device sends an HTTP alert; the system places a real 4G call and reads the message aloud — for when email or app notifications are too easy to miss.'}
          </p>
          <div className="rounded-card border border-dashed border-line bg-surface-2 px-3.5 py-3">
            <p className="font-mono text-micro leading-[2] text-ink-2">
              {th ? 'อุปกรณ์ยิง POST /notify' : 'device POSTs /notify'}
              <br />↓ {th ? 'เข้าคิว ตอบกลับทันที' : 'queued, responds immediately'}
              <br />↓ {th ? 'แปลงข้อความเป็นเสียง' : 'text to speech'}
              <br />↓ {th ? 'โทรออก อ่านข้อความ วางสาย' : 'dial, read the message, hang up'}
              <br />↓ {th ? 'ไม่รับ → โทรซ้ำ → เบอร์ถัดไป' : 'no answer → retry → next contact'}
            </p>
          </div>
        </Card>

        <Card className="flex flex-col gap-3 p-4">
          <h2 className="text-lead font-bold">{th ? 'ตั้งค่าครั้งแรก 3 ขั้น' : 'First-time setup in 3 steps'}</h2>
          <ol className="flex flex-col gap-2.5">
            {setupSteps.map((s) => (
              <li key={s.n} className="flex gap-2.5">
                <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-brand font-mono text-micro font-bold text-brand-ink">
                  {s.n}
                </span>
                <span className="flex min-w-0 flex-col gap-0.5">
                  <Link to={s.to} className="text-caption font-semibold text-brand-strong">
                    {s.title} ›
                  </Link>
                  <span className="text-caption leading-[1.8] text-ink-2">{s.body}</span>
                </span>
              </li>
            ))}
          </ol>
          <p className="rounded-control border border-line bg-surface-2 px-3.5 py-2.5 text-caption leading-[1.8] text-ink-2">
            {th
              ? 'ต้องเรียงแบบนี้ — เลือกผู้รับไม่ได้ถ้ายังไม่มีเบอร์ และเพิ่มเหตุการณ์ให้อุปกรณ์ไม่ได้ถ้ายังไม่มีประเภทเหตุการณ์'
              : 'Order matters — no recipients before numbers exist, no events on a device before event types exist.'}
          </p>
        </Card>

        <Card className="flex flex-col gap-2.5 p-4">
          <h2 className="text-lead font-bold">{th ? 'เลือกผู้รับได้ 2 แบบ' : 'Two ways to choose recipients'}</h2>
          <div className="rounded-control border border-line px-3.5 py-2.5">
            <p className="text-caption font-semibold">{th ? 'ทั้งกลุ่ม' : 'Whole group'}</p>
            <p className="mt-0.5 text-caption leading-[1.8] text-ink-2">
              {th
                ? 'โทรตามลำดับของกลุ่ม แก้กลุ่มครั้งเดียวมีผลกับทุกอุปกรณ์ที่ชี้มาที่กลุ่มนี้'
                : 'Dials in the group order. Editing the group once affects every device pointing at it.'}
            </p>
          </div>
          <div className="rounded-control border border-line px-3.5 py-2.5">
            <p className="text-caption font-semibold">{th ? 'เลือกเบอร์เอง' : 'Pick individual numbers'}</p>
            <p className="mt-0.5 text-caption leading-[1.8] text-ink-2">
              {th
                ? 'เจาะรายคน ข้ามกลุ่มได้ เลขที่ขึ้นตอนกดคือลำดับไล่สายของคู่นี้ ไม่กระทบกลุ่มต้นทาง'
                : 'Pick people across any group. The number shown as you click is this pair’s dial order, leaving the source group untouched.'}
            </p>
          </div>
        </Card>
      </div>

      {/* ── คอลัมน์ขวา: ของที่ต้องเปิดมาหาตอนติดปัญหา ── */}
      <div className="flex min-w-0 flex-col gap-3.5">
        {/* คำถามที่ถูกถามบ่อยที่สุดหลังตั้งค่าเสร็จคือ "แล้วถ้าอยากให้บอกอุณหภูมิด้วยล่ะ"
            ซึ่งระบบทำได้อยู่แล้วแต่ไม่เคยเขียนไว้ที่ไหนในเว็บเลย */}
        <Card className="flex flex-col gap-2.5 p-4">
          <h2 className="text-lead font-bold">
            {th ? 'ให้ข้อความบอกค่าที่วัดได้ด้วย' : 'Put live readings in the message'}
          </h2>
          <p className="text-caption leading-[1.8] text-ink-2">
            {th
              ? 'เขียน {ชื่อตัวแปร} ไว้ในข้อความ แล้วให้อุปกรณ์ส่งค่ามาตอนยิง'
              : 'Write {name} in the message and have the device send the value.'}
          </p>

          <div className="flex flex-col gap-1">
            <p className="text-micro font-medium text-ink-2">{th ? 'ข้อความ' : 'Message'}</p>
            <code className="rounded-control border border-line bg-surface-2 px-3 py-2 text-caption leading-[1.8] break-all">
              {th
                ? 'แจ้งเตือนจาก {device} อุณหภูมิ {temp} องศา'
                : 'Alert from {device}: temperature {temp} degrees'}
            </code>
          </div>

          <div className="flex flex-col gap-1">
            <p className="text-micro font-medium text-ink-2">{th ? 'อุปกรณ์ส่ง' : 'Device sends'}</p>
            <pre className="rounded-control border border-line bg-surface-2 px-3 py-2 font-mono text-micro leading-[1.9] break-all whitespace-pre-wrap text-ink-2">
              {`{ "event_type_code": "temp_high",
  "variables": { "device": "ตู้ควบคุม A", "temp": "78" } }`}
            </pre>
          </div>

          <p className="text-caption leading-[1.8] text-warn-strong">
            {th
              ? 'ทุกตัวแปรต้องส่งมาจากอุปกรณ์ รวมทั้ง {device} — ขาดตัวใดตัวหนึ่งถูกปฏิเสธทันที (400) ไม่เข้าคิว'
              : 'Every placeholder must come from the device, {device} included — a missing one is rejected right away (400).'}
          </p>
          <p className="font-mono text-micro leading-[1.9] text-ink-2">
            {th
              ? 'เพดาน: ข้อความ 500 ตัว · ตัวแปร 20 ตัว · ค่าละ 200 ตัว'
              : 'Limits: 500 chars · 20 variables · 200 chars each'}
          </p>
        </Card>

        <Card className="flex flex-col gap-2.5 p-4">
          <h2 className="text-lead font-bold">{th ? 'งบเวลาต่อ 1 เบอร์' : 'Time budget per contact'}</h2>
          <p className="text-caption leading-[1.8] text-ink-2">
            {th
              ? 'ตั้งได้ที่หน้าระบบ 3 ค่า — เวลารอรับสาย, จำนวนครั้งที่โทรซ้ำ, เวลารอก่อนโทรซ้ำ'
              : 'Three settings on the System page — ring timeout, retry count, delay before retry.'}
          </p>
          <div className="rounded-card border border-dashed border-line bg-surface-2 px-3.5 py-3 font-mono text-micro leading-[2] text-ink-2">
            ({th ? 'โทรซ้ำ' : 'retries'} + 1) × {th ? 'เวลารอรับสาย' : 'ring'} + {th ? 'โทรซ้ำ' : 'retries'} ×{' '}
            {th ? 'เวลารอ' : 'delay'}
            <br />
            <span className="text-ink">
              {th ? 'เช่น 1 · 60 วิ · 120 วิ = 4 นาที/เบอร์' : 'e.g. 1 · 60s · 120s = 4 min per contact'}
            </span>
          </div>
          <p className="text-caption leading-[1.8] text-ink-2">
            {th
              ? 'มี 2 เบอร์ก็คูณสอง — หน้าระบบคำนวณให้ดูสดๆ ตอนปรับ'
              : 'With two contacts it doubles. The System page shows this live as you adjust.'}
          </p>
        </Card>

        <Card className="min-w-0 overflow-hidden">
          <div className="border-b border-line bg-surface-2 px-4 py-2.5">
            <h2 className="text-caption font-bold">{th ? 'ความหมายของสถานะ' : 'What each status means'}</h2>
          </div>
          <div className="flex flex-col">
            {statusRows.map((r) => (
              <div
                key={r.status}
                className="flex flex-wrap items-start gap-2.5 border-b border-line-2 px-4 py-2 last:border-b-0"
              >
                <span className="shrink-0">
                  <StatusBadge status={r.status} />
                </span>
                <span className="min-w-0 flex-1 basis-[11.875rem] text-caption leading-[1.8] text-ink-2">
                  {r.meaning}
                </span>
              </div>
            ))}
          </div>
        </Card>

        {/* อาการ → ทางแก้ บรรทัดเดียวจบ ตัด "ทำไมถึงเกิด" ออก — คนเปิดหน้านี้ตอน
            ระบบไม่ทำงานอยากได้ขั้นตอนถัดไป ไม่ใช่คำอธิบายสาเหตุ (สาเหตุย่อไว้ใน
            ครึ่งแรกของบรรทัดแล้ว) */}
        <Card className="min-w-0 overflow-hidden">
          <div className="border-b border-line bg-surface-2 px-4 py-2.5">
            <h2 className="text-caption font-bold">{th ? 'ปัญหาที่เจอบ่อย' : 'Common problems'}</h2>
          </div>
          <div className="flex flex-col">
            {troubles.map((t) => (
              <div key={t.sym} className="flex flex-col gap-0.5 border-b border-line-2 px-4 py-2.5 last:border-b-0">
                <p className="text-caption font-semibold">{t.sym}</p>
                <p className="text-caption leading-[1.8] text-ink-2">→ {t.fix}</p>
              </div>
            ))}
          </div>
        </Card>

        <Card className="flex flex-col gap-2 p-4">
          <h2 className="text-caption font-bold">{th ? 'ข้อจำกัดที่ควรรู้' : 'Limits worth knowing'}</h2>
          <ul className="flex flex-col gap-1.5">
            {limits.map((n) => (
              <li key={n} className="flex gap-2 text-caption leading-[1.8] text-ink-2">
                <span className="text-warn">▪</span>
                <span className="min-w-0">{n}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}
