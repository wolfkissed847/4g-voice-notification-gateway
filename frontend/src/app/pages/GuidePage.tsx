/**
 * GuidePage — คู่มือของระบบ รวม "วิธีใช้งาน" กับ "เอกสาร API" ไว้เมนูเดียว
 *
 * ── ทำไมรวม ────────────────────────────────────────────────────────────────
 * เดิมเมนูนี้ชื่อ "API guide" และมีแต่เอกสารสำหรับคนเขียนโค้ดยิงเข้ามา ซึ่งตอบได้
 * แค่ครึ่งเดียวของคำถามที่คนใช้จริงมี — อีกครึ่งคือ "ตั้งค่าอะไรก่อนอะไร",
 * "สถานะนี้แปลว่าอะไร", "โทรไม่ออกต้องดูตรงไหน" ซึ่งเดิมไม่มีที่อยู่ในเว็บเลย
 * ต้องไปเปิดไฟล์ docs/ ในเครื่องหรือถามคนทำ
 *
 * แท็บ "วิธีใช้งาน" จึงเขียนจากพฤติกรรมจริงของ backend ตัวนี้ ไม่ใช่คู่มือทั่วไป
 * ทุกตัวเลขในนั้น (เพดานสาย/ชม., สูตรงบเวลา, รหัสสถานะ) ตรงกับที่โค้ดทำจริง
 *
 * แท็บ "API" คือหน้าเดิมทั้งดุ้น ไม่ได้ตัดอะไรออก — ส่งผ่าน embedded ให้มันไม่
 * ขึ้นหัวข้อซ้ำกับหัวข้อของหน้านี้
 */
import { useState } from 'react';
import { Link } from 'react-router';

import { cn } from '@/app/components/ui/utils';
import { Card, PageHeader } from '../components/primitives';
import { StatusBadge } from '../components/StatusBadge';
import { useApp } from '../context/AppContext';
import { statusMeanings } from '../lib/callStatus';
import type { CallStatus } from '../types';
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
   เนื้อหาเขียนสองภาษาแบบ inline (th ? ... : ...) ไม่ผ่าน TR เหมือนหน้าอื่น
   เพราะเป็นย่อหน้ายาวหลายสิบชิ้น ถ้าแตกเป็น key จะได้ TR ที่บวมขึ้นเท่าตัว
   และเวลาแก้ถ้อยคำต้องกระโดดไปมาระหว่างสองไฟล์ทุกครั้ง
   ═══════════════════════════════════════════════════════════════════════════ */

function UsageGuide() {
  const { lang } = useApp();
  const th = lang === 'th';

  const setupSteps = [
    {
      n: 1,
      to: '/contacts',
      title: th ? 'สร้างกลุ่มผู้รับ แล้วใส่เบอร์' : 'Create a recipient group and add numbers',
      body: th
        ? 'ลำดับของเบอร์ในกลุ่มคือลำดับที่ระบบจะไล่โทรจริง ใส่ชื่อกำกับไว้ด้วยได้ (ไม่บังคับ) ปรับลำดับด้วยลูกศรขึ้น-ลง'
        : 'The order of numbers is the order the system dials. Names are optional. Reorder with the up/down arrows.',
    },
    {
      n: 2,
      to: '/event-types',
      title: th ? 'สร้างประเภทเหตุการณ์' : 'Create an event type',
      body: th
        ? 'เก็บแค่ "คำพูด" — รหัสที่อุปกรณ์จะส่งมา ชื่อที่แสดงในเว็บ และข้อความที่จะพูดในสาย ไม่ต้องเลือกกลุ่มหรือเบอร์ที่หน้านี้'
        : 'This holds the wording only — the code devices send, a display name, and what gets said on the call. No recipients here.',
    },
    {
      n: 3,
      to: '/devices',
      title: th ? 'สร้างอุปกรณ์ เลือกผู้รับ แล้วคัดลอก key' : 'Create a device, pick recipients, copy the key',
      body: th
        ? 'ติ๊กว่าอุปกรณ์นี้ยิงเหตุการณ์ไหนได้ แล้วเลือกว่าแต่ละเหตุการณ์จะโทรหาใคร จากนั้นคัดลอก API key ไปฝังในบอร์ด'
        : 'Tick which events this device may send, choose who each one calls, then copy the API key into the board.',
    },
  ];

  const statusRows = statusMeanings(th);

  const troubles = [
    {
      sym: th ? 'ยิงเข้ามาแล้วได้ 403' : 'Requests return 403',
      why: th ? 'อุปกรณ์ตัวนั้นยังไม่ได้ติ๊กสิทธิ์ให้ยิงเหตุการณ์นี้' : 'The device is not allowed to send this event',
      fix: th ? 'หน้าอุปกรณ์ → ติ๊กเหตุการณ์นั้นให้อุปกรณ์' : 'Devices → tick that event for the device',
    },
    {
      sym: th ? 'ได้ 400 บอกว่ายังไม่ได้เลือกผู้รับ' : 'A 400 about missing recipients',
      why: th ? 'คู่ (อุปกรณ์ + เหตุการณ์) นั้นยังไม่ได้เลือกว่าโทรหาใคร หรือกลุ่มที่เลือกไว้ไม่มีเบอร์เลย'
        : 'That device+event pair has no recipients, or the chosen group is empty',
      fix: th ? 'หน้าอุปกรณ์ → เลือกทั้งกลุ่มหรือเลือกเบอร์เอง' : 'Devices → pick a whole group or individual numbers',
    },
    {
      sym: th ? 'งานค้างในคิว ไม่โทรออกสักที' : 'Jobs stay queued and never dial',
      why: th ? 'โมดูล 4G ไม่ได้เสียบ หรือหลุดไป' : 'The 4G module is unplugged or disconnected',
      fix: th ? 'ดูการ์ด "โมดูล 4G" ในหน้าระบบ — เสียบกลับแล้วต่อเองภายในไม่กี่วินาที ไม่ต้องรีสตาร์ต'
        : 'Check the 4G module card on the System page. Re-plug and it reconnects on its own within seconds.',
    },
    {
      sym: th ? 'โทรติดแต่ไม่ได้ยินเสียงพูด' : 'Call connects but nothing is spoken',
      why: th ? 'ระบบต้องต่ออินเทอร์เน็ตเพื่อแปลงข้อความเป็นเสียงทุกครั้งที่โทร'
        : 'Text-to-speech needs internet on every call',
      fix: th ? 'เช็คว่า Pi ยังต่อเน็ตอยู่ แล้วดูรายละเอียดข้อผิดพลาดในหน้าประวัติ'
        : 'Check the Pi has internet, then open the failure detail in Call history',
    },
    {
      sym: th ? 'ไม่มีใครรับสายเลยทั้งที่เบอร์ถูก' : 'Nobody answers even though numbers are right',
      why: th ? 'เครือข่ายอาจตัดเข้าฝากข้อความก่อนหมดเวลาที่ตั้งไว้ และระบบจะนับว่า "รับสายแล้ว"'
        : 'The carrier may divert to voicemail, which the system counts as answered',
      fix: th ? 'ลดเวลารอรับสายลงเหลือราว 30 วินาที แล้วเพิ่มเบอร์สำรองไว้อีกเบอร์'
        : 'Lower the ring timeout to about 30s and add a backup contact',
    },
  ];

  return (
    <div className="grid items-start gap-3.5 lg:grid-cols-2">
      {/* ── คอลัมน์ซ้าย ── */}
      <div className="flex min-w-0 flex-col gap-3.5">
        <Card className="flex flex-col gap-2.5 p-4">
          <h2 className="text-lead font-bold">{th ? 'ระบบนี้ทำอะไร' : 'What this system does'}</h2>
          <p className="text-caption leading-[1.9] text-ink-2">
            {th
              ? 'รับสัญญาณแจ้งเตือนจากอุปกรณ์ผ่าน HTTP แล้ว "โทรศัพท์" ไปอ่านข้อความให้คนฟังผ่านเครือข่าย 4G — ใช้ตอนที่อีเมลหรือแอปแจ้งเตือนไม่ทันการณ์ เพราะโทรศัพท์ดังแม้ปิดเสียงแจ้งเตือนไว้'
              : 'It takes an HTTP alert from a device and places a real phone call over 4G that reads the message aloud — for cases where email or app notifications are too easy to miss.'}
          </p>
          <div className="mt-1 rounded-card border border-dashed border-line bg-surface-2 px-3.5 py-3">
            <p className="font-mono text-micro leading-[2] text-ink-2">
              {th ? 'อุปกรณ์ยิง POST /notify' : 'device POSTs /notify'}
              <br />↓ {th ? 'เข้าคิว (ตอบกลับทันที ไม่ต้องรอสาย)' : 'queued (responds immediately)'}
              <br />↓ {th ? 'แปลงข้อความเป็นเสียง' : 'text to speech'}
              <br />↓ {th ? 'อัปโหลดเสียงเข้าโมดูล แล้วโทรออก' : 'upload audio to modem, then dial'}
              <br />↓ {th ? 'ปลายสายรับ → อ่านข้อความ → วางสาย' : 'answered → play message → hang up'}
              <br />↓ {th ? 'ไม่รับ → โทรซ้ำ → ไล่เบอร์ถัดไป' : 'no answer → retry → next contact'}
            </p>
          </div>
        </Card>

        <Card className="flex flex-col gap-3 p-4">
          <h2 className="text-lead font-bold">{th ? 'ตั้งค่าครั้งแรก 3 ขั้น' : 'First-time setup in 3 steps'}</h2>
          <ol className="flex flex-col gap-3">
            {setupSteps.map((s) => (
              <li key={s.n} className="flex gap-2.5">
                <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-brand font-mono text-micro font-bold text-brand-ink">
                  {s.n}
                </span>
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-caption font-semibold">{s.title}</span>
                  <span className="text-caption leading-[1.8] text-ink-2">{s.body}</span>
                  <Link to={s.to} className="mt-0.5 text-caption font-medium text-brand-strong">
                    {th ? 'ไปหน้านี้' : 'Go there'} ›
                  </Link>
                </span>
              </li>
            ))}
          </ol>
          <p className="rounded-control border border-line bg-surface-2 px-3.5 py-2.5 text-caption leading-[1.8] text-ink-2">
            {th
              ? 'ต้องทำตามลำดับนี้ — เลือกผู้รับให้อุปกรณ์ไม่ได้ถ้ายังไม่มีเบอร์ในระบบ และติ๊กสิทธิ์ไม่ได้ถ้ายังไม่มีประเภทเหตุการณ์'
              : 'Order matters — you cannot pick recipients before numbers exist, nor grant permissions before events exist.'}
          </p>
        </Card>

        <Card className="flex flex-col gap-3 p-4">
          <h2 className="text-lead font-bold">{th ? 'เลือกผู้รับได้ 2 แบบ' : 'Two ways to choose recipients'}</h2>
          <div className="flex flex-col gap-2.5">
            <div className="rounded-control border border-line px-3.5 py-3">
              <p className="text-caption font-semibold">{th ? 'ทั้งกลุ่ม' : 'Whole group'}</p>
              <p className="mt-1 text-caption leading-[1.8] text-ink-2">
                {th
                  ? 'โทรทุกคนในกลุ่มตามลำดับของกลุ่ม เหมาะกับทีมที่รับเรื่องเหมือนกันทุกครั้ง แก้เบอร์ที่กลุ่มครั้งเดียวมีผลกับทุกอุปกรณ์ที่ชี้มาที่กลุ่มนี้'
                  : 'Calls everyone in the group in its own order. Editing the group once affects every device pointing at it.'}
              </p>
            </div>
            <div className="rounded-control border border-line px-3.5 py-3">
              <p className="text-caption font-semibold">{th ? 'เลือกเบอร์เอง' : 'Pick individual numbers'}</p>
              <p className="mt-1 text-caption leading-[1.8] text-ink-2">
                {th
                  ? 'ติ๊กเฉพาะคนที่เกี่ยวกับเรื่องนั้น ข้ามกลุ่มได้ และจัดลำดับไล่สายของคู่นี้เองโดยไม่กระทบกลุ่มต้นทาง เหมาะกับเหตุการณ์ที่ควรถึงแค่บางคน'
                  : 'Tick only the people involved, across any group, and set the escalation order for this pair without touching the source group.'}
              </p>
            </div>
          </div>
        </Card>
      </div>

      {/* ── คอลัมน์ขวา ── */}
      <div className="flex min-w-0 flex-col gap-3.5">
        <Card className="flex flex-col gap-3 p-4">
          <h2 className="text-lead font-bold">{th ? 'ค่าการโทรและงบเวลา' : 'Call settings and time budget'}</h2>
          <p className="text-caption leading-[1.8] text-ink-2">
            {th
              ? 'ตั้งได้ที่หน้าระบบ 3 ค่า — เวลารอให้รับสาย, จำนวนครั้งที่โทรซ้ำ, เวลารอก่อนโทรซ้ำ ทั้งสามคูณกันเป็นเวลาที่ใช้ต่อ 1 เบอร์'
              : 'Three settings on the System page — ring timeout, retry count, delay before retry. Together they define the time spent per contact.'}
          </p>
          <div className="rounded-card border border-dashed border-line bg-surface-2 px-3.5 py-3 font-mono text-micro leading-[2] text-ink-2">
            ({th ? 'โทรซ้ำ' : 'retries'} + 1) × {th ? 'เวลารอรับสาย' : 'ring'} + {th ? 'โทรซ้ำ' : 'retries'} ×{' '}
            {th ? 'เวลารอ' : 'delay'}
            <br />
            <span className="text-ink">
              {th ? 'เช่น โทรซ้ำ 1 · ดัง 60 วิ · รอ 120 วิ = 4 นาที/เบอร์' : 'e.g. 1 retry · 60s ring · 120s delay = 4 min per contact'}
            </span>
          </div>
          <p className="text-caption leading-[1.8] text-ink-2">
            {th
              ? 'มี 2 เบอร์ก็คูณสอง — ตั้งนานเกินไปคนสุดท้ายอาจได้รับสายช้ากว่าที่ควร หน้าตั้งค่าคำนวณตัวเลขนี้ให้ดูสดๆ ตอนปรับ'
              : 'With 2 contacts it doubles. The settings page shows this number live as you adjust.'}
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
                className="flex flex-wrap items-start gap-2.5 border-b border-line-2 px-4 py-2.5 last:border-b-0"
              >
                <span className="shrink-0">
                  <StatusBadge status={r.status} />
                </span>
                <span className="min-w-0 flex-1 basis-[11.875rem] text-caption leading-[1.8] text-ink-2">{r.meaning}</span>
              </div>
            ))}
          </div>
        </Card>

        <Card className="min-w-0 overflow-hidden">
          <div className="border-b border-line bg-surface-2 px-4 py-2.5">
            <h2 className="text-caption font-bold">{th ? 'ปัญหาที่เจอบ่อย' : 'Common problems'}</h2>
          </div>
          <div className="flex flex-col">
            {troubles.map((t) => (
              <div key={t.sym} className="flex flex-col gap-1 border-b border-line-2 px-4 py-3 last:border-b-0">
                <p className="text-caption font-semibold">{t.sym}</p>
                <p className="text-caption leading-[1.8] text-ink-2">{t.why}</p>
                <p className="text-caption leading-[1.8] text-brand-strong">→ {t.fix}</p>
              </div>
            ))}
          </div>
        </Card>

        <Card className="flex flex-col gap-2 p-4">
          <h2 className="text-caption font-bold">{th ? 'ข้อจำกัดที่ควรรู้ก่อนใช้งานจริง' : 'Limits worth knowing'}</h2>
          <ul className="flex flex-col gap-1.5">
            {(th
              ? [
                  'ซิมใบเดียว โทรได้ทีละสาย — เพดานจริงราว 80 สาย/ชั่วโมง ถึงแม้จะรับคำขอเข้าคิวได้เร็วกว่านั้นมาก',
                  'ต้องมีอินเทอร์เน็ตทุกครั้งที่โทร เพราะเสียงถูกสร้างสดจากบริการแปลงข้อความเป็นเสียง',
                  'ไม่มีไฟสำรอง — ไฟดับคือระบบดับ ไฟมาแล้วระบบขึ้นเองและงานที่ค้างจะถูกดึงกลับเข้าคิว',
                  'ข้อความยาวได้ไม่เกิน 500 ตัวอักษรต่อ 1 สาย',
                ]
              : [
                  'One SIM means one call at a time — about 80 calls per hour in practice',
                  'Internet is required on every call because speech is generated on demand',
                  'No battery backup — a power cut stops everything; queued jobs resume on boot',
                  'Messages are capped at 500 characters per call',
                ]
            ).map((n) => (
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
