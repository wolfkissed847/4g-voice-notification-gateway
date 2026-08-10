/**
 * ApiGuidePage — คู่มือ API ในตัวเว็บ
 * ปรับสไตล์ตาม figma/handoff/components/ApiGuidePage.tsx (ตาราง + code block + status codes)
 *
 * ── ที่แก้จากเวอร์ชันเดิม ──────────────────────────────────────────────────
 * 1. hardcode hex 99 จุด → token ทั้งหมด (การ์ด/ตาราง/badge สถานะ)
 * 2. ลิงก์ quickstart ชี้ /api-keys → /devices (route เปลี่ยนตามดีไซน์ใหม่)
 * 3. เพิ่ม 403 เข้าตาราง status — ของใหม่จริงที่ backend ตอบเมื่ออุปกรณ์ยิง event type
 *    ที่ไม่ได้รับอนุญาต ซึ่งเป็นกรณีที่ผู้ใช้จะเจอบ่อยตอน setup อุปกรณ์ใหม่
 * 4. ใช้ CodePanel จาก primitives (พื้นเข้มคงที่ทั้ง light/dark โดยเจตนา — โค้ดอ่านง่ายกว่า)
 * 5. ตัวอย่างโค้ดตัด variables ออกจากตัวอย่างหลัก เพราะ {device} ถูกเติมจากชื่ออุปกรณ์
 *    ให้อัตโนมัติแล้ว อุปกรณ์ส่งแค่ event_type_code ก็พอ (ดู render_message ใน backend)
 *    — นี่คือหัวใจของการที่ firmware ไม่ต้องแก้เวลาย้าย/เปลี่ยนชื่อโหนด
 */
import { useState } from 'react';
import { Link } from 'react-router';

import { cn } from '@/app/components/ui/utils';
import { API_BASE_URL } from '../api/client';
import { Card, CardHead, CodePanel, PageHeader, Pill, apiGridCls, type Tone } from '../components/primitives';
import { useApp } from '../context/AppContext';
import { copyText } from '../lib/clipboard';

const CURL_CODE = `curl -X POST http://your-pi.local:8000/notify \\
  -H "Content-Type: application/json" \\
  -H "X-API-Key: gw_live_YOUR_DEVICE_KEY" \\
  -d '{ "event_type_code": "node_down" }'`;

const PYTHON_CODE = `import requests

resp = requests.post(
    "http://your-pi.local:8000/notify",
    headers={"X-API-Key": "gw_live_YOUR_DEVICE_KEY"},
    json={"event_type_code": "node_down"},
    timeout=10,
)
print(resp.status_code, resp.json())`;

const ESP32_CODE = `HTTPClient http;
http.begin("http://your-pi.local:8000/notify");
http.addHeader("Content-Type", "application/json");
http.addHeader("X-API-Key", "gw_live_YOUR_DEVICE_KEY");
int code = http.POST("{\\"event_type_code\\":\\"node_down\\"}");
http.end();`;

const RESP_OK = `{
  "job_id": 43,
  "status": "queued",
  "message": "เข้าคิวเรียบร้อยแล้ว"
}`;

const RESP_ERR = `{
  "detail": "อุปกรณ์ 'โหนดตึก A ชั้น 3' ไม่ได้รับอนุญาตให้ยิง
             event type 'power_outage'"
}`;

type CodeLang = 'curl' | 'python' | 'esp32';

export function ApiGuidePage() {
  const { T, lang } = useApp();
  const [codeLang, setCodeLang] = useState<CodeLang>('curl');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const th = lang === 'th';

  const headerFields = [
    {
      field: 'X-API-Key',
      req: true,
      desc: th ? 'key ประจำอุปกรณ์ที่สร้างจากหน้าอุปกรณ์' : 'The device key created on the Devices page',
    },
    { field: 'Content-Type', req: true, desc: 'application/json' },
  ];

  const bodyFields = [
    {
      field: 'event_type_code',
      req: true,
      desc: th
        ? 'รหัสประเภทเหตุการณ์ — ต้องเป็นรหัสที่อุปกรณ์นี้ได้รับอนุญาต'
        : 'Event type code — must be one this device is allowed to trigger',
    },
    {
      field: 'message',
      req: false,
      desc: th
        ? 'ข้อความที่จะอ่านออกเสียง — ถ้าไม่ส่ง ระบบสร้างจาก template ของ event type'
        : 'Text to read aloud — generated from the event type template if omitted',
    },
    {
      field: 'variables',
      req: false,
      desc: th
        ? 'ค่าแทน {key} ใน template — {device} ถูกเติมจากชื่ออุปกรณ์ให้อยู่แล้ว ไม่ต้องส่ง'
        : 'Values for {key} placeholders — {device} is filled from the device name automatically',
    },
  ];

  const statusRows: { code: number; name: string; tone: Tone; desc: string }[] = [
    {
      code: 200,
      name: 'OK',
      tone: 'ok',
      desc: th ? 'เข้าคิวเรียบร้อย รอ worker หยิบไปโทร' : 'Queued — the worker will pick it up',
    },
    {
      code: 400,
      name: 'Bad Request',
      tone: 'warn',
      desc: th
        ? 'event type ถูกปิดใช้งาน หรือ template ต้องการตัวแปรที่ไม่ได้ส่งมา'
        : 'Event type disabled, or the template needs a variable you did not send',
    },
    {
      code: 401,
      name: 'Unauthorized',
      tone: 'bad',
      desc: th ? 'API key ไม่ถูกต้องหรือถูกเพิกถอนแล้ว' : 'API key is wrong or has been revoked',
    },
    {
      code: 403,
      name: 'Forbidden',
      tone: 'bad',
      desc: th
        ? 'key ถูกต้อง แต่อุปกรณ์นี้ไม่ได้รับสิทธิ์ยิง event type นั้น — เพิ่มสิทธิ์ที่หน้าอุปกรณ์'
        : 'Key is valid but this device may not trigger that event type — grant it on the Devices page',
    },
    {
      code: 404,
      name: 'Not Found',
      tone: 'warn',
      desc: th ? 'ไม่พบ event_type_code ที่ส่งมา' : 'The event_type_code does not exist',
    },
    {
      code: 422,
      name: 'Unprocessable',
      tone: 'muted',
      desc: th ? 'รูปแบบ JSON ไม่ถูกต้อง หรือขาด field ที่จำเป็น' : 'Malformed JSON or a missing required field',
    },
  ];

  const codeByLang: Record<CodeLang, { code: string; label: string }> = {
    curl: { code: CURL_CODE, label: 'curl' },
    python: { code: PYTHON_CODE, label: 'python' },
    esp32: { code: ESP32_CODE, label: 'esp32 / arduino' },
  };

  // navigator.clipboard ใช้ไม่ได้ตอนเปิดผ่าน http://<ip ของ Pi>:8000 (ไม่ใช่ secure context)
  // copyText มี fallback ให้ และคืน false ถ้าคัดลอกไม่ได้จริง — จะได้ไม่ขึ้น "คัดลอกแล้ว" หลอกตา
  const copy = async (key: string, text: string) => {
    if (!(await copyText(text))) return;
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1500);
  };

  const steps = [
    {
      n: 1,
      text: th ? 'สร้างกลุ่มผู้รับและใส่เบอร์ตามลำดับการโทร' : 'Create a recipient group and add numbers in call order',
      to: '/contacts',
    },
    {
      n: 2,
      text: th ? 'สร้างประเภทเหตุการณ์ พร้อมข้อความที่จะพูด' : 'Create an event type with the message to speak',
      to: '/event-types',
    },
    {
      n: 3,
      text: th
        ? 'สร้างอุปกรณ์ เลือกสิทธิ์ แล้วคัดลอก key ไปฝังใน firmware'
        : 'Create a device, pick its permissions, copy the key into the firmware',
      to: '/devices',
    },
    {
      n: 4,
      text: th ? 'ให้อุปกรณ์ยิง POST /notify ตามตัวอย่างด้านล่าง' : 'Have the device POST /notify as shown below',
      to: null,
    },
  ];

  return (
    <div className="flex flex-col gap-3.5">
      <PageHeader title={T.api_title} meta={T.api_sub} />

      {/* แถบ endpoint เต็มความกว้าง ตามภาพ — base URL ดึงจาก VITE_API_BASE_URL จริง
          ไม่ hardcode ให้คนเข้าใจผิดว่าต้องยิงไปที่ IP ในเอกสาร */}
      <Card className="flex flex-wrap items-center gap-3 px-4 py-3.5">
        <span className="rounded-control bg-ok px-2.5 py-1 font-mono text-micro font-bold text-white">POST</span>
        <span className="font-mono text-lead font-bold">/notify</span>
        <span className="ms-auto min-w-0 truncate font-mono text-caption text-ink-2">
          {T.api_base_label}: {API_BASE_URL}
        </span>
      </Card>

      {/* 2 คอลัมน์ตามภาพ: เอกสาร/ตารางอยู่ซ้าย ตัวอย่างโค้ดอยู่ขวา
          เดิมผมเรียงเป็นชั้นลงมาทั้งหมด ทำให้ต้องเลื่อนไปกลับระหว่างตารางกับโค้ดตอนอ่านเทียบ */}
      <div className="grid items-start gap-3.5 lg:grid-cols-2">
        {/* ── คอลัมน์ซ้าย: เอกสาร ── */}
        <div className="flex min-w-0 flex-col gap-3.5">
          <Card className="flex flex-col gap-2.5 p-4">
            <h2 className="text-lead font-bold">{T.api_quickstart_title}</h2>
            <ol className="flex flex-col gap-2">
              {steps.map((s) => (
                <li key={s.n} className="flex flex-wrap items-center gap-2.5">
                  <span className="grid size-6 shrink-0 place-items-center rounded-full bg-brand font-mono text-micro font-bold text-brand-ink">
                    {s.n}
                  </span>
                  <span className="min-w-0 flex-1 basis-[180px] text-caption leading-[1.8]">{s.text}</span>
                  {s.to ? (
                    <Link to={s.to} className="text-caption font-medium whitespace-nowrap text-brand">
                      {T.dash_view_all} ›
                    </Link>
                  ) : null}
                </li>
              ))}
            </ol>
          </Card>

          <Card className="min-w-0 overflow-hidden">
            <CardHead title="Headers" />
            <FieldTable rows={headerFields} T={T} />
          </Card>

          <Card className="min-w-0 overflow-hidden">
            <CardHead title={T.request_body_json_label} />
            <FieldTable rows={bodyFields} T={T} />
          </Card>

          {/* status code เป็นการ์ดแยกใบใต้หัวข้อ ตามภาพ (เดิมเป็นแถวในการ์ดเดียว) */}
          <p className="mt-0.5 font-mono text-micro tracking-[0.12em] text-ink-2 uppercase">{T.status_codes_title}</p>
          <div className="flex flex-col gap-2">
            {statusRows.map((r) => (
              <div key={r.code} className="flex flex-wrap items-start gap-2.5 rounded-card border border-line bg-surface px-3.5 py-3">
                <Pill tone={r.tone}>{r.code}</Pill>
                <span className="flex min-w-0 flex-1 basis-[200px] flex-col gap-0.5">
                  <span className="text-caption font-bold">{r.name}</span>
                  <span className="text-caption leading-[1.8] text-ink-2">{r.desc}</span>
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* ── คอลัมน์ขวา: โค้ด ── */}
        <div className="flex min-w-0 flex-col gap-3.5">
          <div className="flex flex-wrap gap-1.5">
            {(Object.keys(codeByLang) as CodeLang[]).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setCodeLang(k)}
                className={cn(
                  'rounded-full border px-3.5 py-2 text-caption transition-colors',
                  codeLang === k
                    ? 'border-brand bg-brand-soft font-semibold text-brand'
                    : 'border-line bg-surface text-ink hover:border-brand',
                )}
              >
                {codeByLang[k].label}
              </button>
            ))}
          </div>

          <CodePanel
            lang={codeByLang[codeLang].label}
            copied={copiedKey === 'code'}
            onCopy={() => copy('code', codeByLang[codeLang].code)}
            copyLabel={T.copy}
            copiedLabel={T.copy}
          >
            {codeByLang[codeLang].code}
          </CodePanel>

          <CodePanel
            lang="json"
            status={{ code: '200', tone: 'ok' }}
            copied={copiedKey === 'ok'}
            onCopy={() => copy('ok', RESP_OK)}
            copyLabel={T.copy}
            copiedLabel={T.copy}
          >
            {RESP_OK}
          </CodePanel>

          <CodePanel
            lang="json"
            status={{ code: '403', tone: 'bad' }}
            copied={copiedKey === 'err'}
            onCopy={() => copy('err', RESP_ERR)}
            copyLabel={T.copy}
            copiedLabel={T.copy}
          >
            {RESP_ERR}
          </CodePanel>

          <p className="rounded-card border border-warn bg-warn-soft px-3.5 py-3 text-caption leading-[1.8]">
            {T.api_key_warn}
          </p>

          {/* กล่อง "ข้อควรรู้" ตามภาพ — เขียนตามพฤติกรรมจริงของ backend เรา */}
          <Card className="flex flex-col gap-2 p-4">
            <h3 className="text-caption font-bold">{T.api_notes_title}</h3>
            <ul className="flex flex-col gap-1.5">
              {[T.api_note_1, T.api_note_2, T.api_note_3, T.api_note_4].map((n) => (
                <li key={n} className="flex gap-2 text-caption leading-[1.8] text-ink-2">
                  <span className="text-brand">▪</span>
                  <span className="min-w-0">{n}</span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}

/** ตาราง field 3 คอลัมน์ — ใช้กริดชุดเดียวกันทั้งหัวตารางและแถว เปลี่ยนคอลัมน์ที่เดียว */
function FieldTable({
  rows,
  T,
}: {
  rows: { field: string; req: boolean; desc: string }[];
  T: ReturnType<typeof useApp>['T'];
}) {
  return (
    <div className="overflow-x-auto">
      <div
        className={cn(
          apiGridCls,
          'border-b border-line bg-surface-2 px-4 py-2.5 font-mono text-micro font-bold text-ink-2',
        )}
      >
        <div>{T.col_parameter}</div>
        <div>{T.col_required}</div>
        <div>{T.col_description}</div>
      </div>
      {rows.map((r) => (
        <div key={r.field} className={cn(apiGridCls, 'items-start border-b border-line-2 px-4 py-3 last:border-b-0')}>
          <div className="min-w-0 font-mono text-caption break-all">{r.field}</div>
          <div className="font-mono text-micro text-ink-2">{r.req ? T.required : T.optional}</div>
          <div className="text-caption leading-[1.8] text-ink-2">{r.desc}</div>
        </div>
      ))}
    </div>
  );
}
