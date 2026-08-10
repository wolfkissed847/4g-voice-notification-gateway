/**
 * CallLogPage — พอร์ตจาก figma/handoff/components/CallLogPage.tsx
 * แทน HistoryPage เดิม
 *
 * ── ต่างจากดีไซน์ ──────────────────────────────────────────────────────────
 * 1. ชิปกรอง "งดตามเวลา" (suppressed) ตัดออก — ยังไม่มีสถานะนี้ใน backend
 *    ต้องมีช่วงห้ามโทรก่อน (DEPLOYMENT_MODELS.md ข้อ 5, 19)
 *    ชิป "ส่ง SMS แทน" ก็ตัดออกแล้วเช่นกัน (6 ส.ค. 2569 เอาแค่โทร ไม่มี SMS fallback — ดู LIMITATIONS.md)
 * 2. คอลัมน์ "ค่าที่อ่านได้" (reading/value) เปลี่ยนเป็นชื่อเหตุการณ์
 *    เพราะ backend ไม่รับค่าตัวเลขจากอุปกรณ์ — อุปกรณ์ส่งแค่ event_type_code
 * 3. meta "90 days" ตัดออก — ยังไม่มี retention policy จริง (P2-DB ข้อ 12)
 *    แสดงจำนวนรายการทั้งหมดตามที่ /history คืนมาแทน
 * 4. ปุ่มเปลี่ยนหน้าในดีไซน์เป็นปุ่มเปล่า ต่อ page/page_size ของ /history ให้ทำงานจริง
 * 5. เพิ่มตัวเลือกช่วงวันที่ (ดีไซน์ไม่มี) ต่อกับ date_from/date_to ที่ /history รองรับอยู่แล้ว
 */
import { useEffect, useState } from 'react';
import { ChevronDown } from 'lucide-react';

import { cn } from '@/app/components/ui/utils';
import { getHistory } from '../api/history';
import { PageHeader, logGridCls } from '../components/primitives';
import { useApp } from '../context/AppContext';
import type { HistoryItem } from '../types';

const PAGE_SIZE = 20;

/** ชิปกรอง → ค่า status ที่ /history รับ (undefined = ไม่กรอง) */
const FILTERS = [
  { id: 'all', status: undefined },
  { id: 'ok', status: 'connected' },
  { id: 'no_answer', status: 'no_answer' },
  { id: 'failed', status: 'failed' },
] as const;

type FilterId = (typeof FILTERS)[number]['id'];
type Preset = 'all' | 'today' | '7d' | '30d' | 'custom';

function resultTone(status: string): string {
  if (status === 'connected') return 'text-ok';
  if (status === 'failed') return 'text-bad';
  if (status === 'queued' || status === 'in_progress' || status === 'cancelled') return 'text-ink-2';
  return 'text-warn';
}

/** Date → "YYYY-MM-DD" ตามเวลาเครื่องผู้ใช้ (ไม่ใช่ toISOString ที่เป็น UTC แล้ววันเพี้ยน) */
function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return ymd(d);
}

/**
 * "YYYY-MM-DD" ที่ผู้ใช้เลือก → ISO UTC ที่ backend ต้องการ
 *
 * ต้องแปลงเพราะ created_at ฝั่ง backend เก็บเป็น UTC (datetime.utcnow) แต่ผู้ใช้คิดเป็น
 * เวลาไทย — เลือก "9 ส.ค." แล้วต้องได้ทั้งวันตามเวลาไทย ไม่ใช่ 07:00 ของวันนั้นถึง 07:00 ของวันถัดไป
 *
 * `new Date('2026-08-09T00:00:00')` (ไม่มี Z) ถูกตีความเป็นเวลาท้องถิ่นตามสเปก
 * .toISOString() จึงถอยกลับไป 7 ชั่วโมงให้เองอัตโนมัติ ไม่ต้องบวกลบเอง
 */
function startOfDayUtc(day: string): string {
  return new Date(`${day}T00:00:00`).toISOString();
}

function endOfDayUtc(day: string): string {
  return new Date(`${day}T23:59:59.999`).toISOString();
}

// native date/select วาดปฏิทินกับรายการตัวเลือกตามค่า color-scheme
// ถ้าไม่บอก จะได้พื้นขาวเสมอแม้อยู่ธีมมืด (ตัวอักษรดำบนพื้นดำ อ่านไม่ออกว่ากดตรงไหน)
const nativeCtl = 'rounded-control border border-line bg-surface py-2 text-caption text-ink transition-colors hover:border-brand focus:border-brand focus:outline-none [color-scheme:light] dark:[color-scheme:dark]';
const dateInputCls = cn(nativeCtl, 'px-2.5 font-mono');

/**
 * dropdown ที่ใช้ <select> ของเบราว์เซอร์จริง ไม่ใช่เมนูที่วาดเอง
 *
 * บนมือถือระบบจะเด้ง picker ของ OS ขึ้นมาให้เอง (วงล้อ/รายการเต็มจอ) ซึ่งกดง่ายกว่า
 * dropdown ที่วาดเองมาก และรองรับคีย์บอร์ด/screen reader ครบโดยไม่ต้องเขียนเพิ่ม
 * — ที่ต้องทำเองมีแค่ซ่อนลูกศรของระบบ (appearance-none) แล้ววาดลูกศรให้เข้ากับธีม
 */
function SelectBox<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <label className="flex items-center gap-2">
      <span className="text-micro whitespace-nowrap text-ink-2">{label}</span>
      <span className="relative">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value as T)}
          className={cn(nativeCtl, 'appearance-none ps-3 pe-8 font-medium')}
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <ChevronDown
          size={14}
          className="pointer-events-none absolute end-2.5 top-1/2 -translate-y-1/2 text-ink-2"
        />
      </span>
    </label>
  );
}

export function CallLogPage() {
  const { T } = useApp();
  const [filter, setFilter] = useState<FilterId>('all');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<number | null>(null);
  const [rows, setRows] = useState<HistoryItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  // ค่าว่าง = ไม่จำกัดช่วงเวลา (ดูทั้งหมด) — เก็บเป็น "YYYY-MM-DD" ตรงกับที่ <input type="date"> ใช้
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [preset, setPreset] = useState<Preset>('all');

  // poll ทุก 5 วิ (เดิมดึงครั้งเดียวต่อการเปลี่ยน filter/page — หน้านี้เลย "ค้าง" ไม่เห็นงานใหม่
  // จนกว่าจะกดเปลี่ยนตัวกรองเอง)
  useEffect(() => {
    let cancelled = false;
    const status = FILTERS.find((f) => f.id === filter)?.status;
    const load = () => {
      setLoading(true);
      getHistory({
        page,
        page_size: PAGE_SIZE,
        status,
        date_from: dateFrom ? startOfDayUtc(dateFrom) : undefined,
        date_to: dateTo ? endOfDayUtc(dateTo) : undefined,
      })
        .then((res) => {
          if (cancelled) return;
          setRows(res.items);
          setTotal(res.total_count);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    };
    load();
    const id = setInterval(load, 5000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [filter, page, dateFrom, dateTo]);

  const pick = (id: FilterId) => {
    setFilter(id);
    setPage(1); // กรองใหม่ต้องกลับหน้า 1 ไม่งั้นอาจค้างที่หน้าที่ไม่มีข้อมูล
  };

  // เปลี่ยนช่วงวันที่ต้องกลับหน้า 1 ด้วยเหตุผลเดียวกับ pick()
  const setRange = (from: string, to: string) => {
    setDateFrom(from);
    setDateTo(to);
    setPage(1);
  };

  const today = ymd(new Date());

  /** ช่วงสำเร็จรูปที่เลือกอยู่ — 'custom' คือกางช่องวันที่ให้เลือกเองเป็นวันๆ */
  const applyPreset = (p: Preset) => {
    setPreset(p);
    if (p === 'all') setRange('', '');
    else if (p === 'today') setRange(today, today);
    else if (p === '7d') setRange(daysAgo(6), today);
    else if (p === '30d') setRange(daysAgo(29), today);
    // custom: ถ้ายังไม่เคยเลือกช่วงไหนไว้ ตั้งเป็นวันนี้ก่อน จะได้ไม่ค้างที่ช่องว่าง
    // แล้วผู้ใช้งงว่ากดแล้วไม่มีอะไรเกิดขึ้น
    else if (!dateFrom && !dateTo) setRange(today, today);
  };

  const from = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const to = Math.min(page * PAGE_SIZE, total);
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="flex flex-col gap-3.5">
      <PageHeader title={T.history_title} meta={T.history_records(total)} />

      {/* ── แถบตัวกรองแถบเดียว ─────────────────────────────────────────────
          เดิมแยกเป็น 2 ก้อนคนละสไตล์ (ชิปลอยๆ กับการ์ดมีกรอบ) ดูเหมือนคนละส่วนของหน้า
          ทั้งที่ทำหน้าที่เดียวกันคือกรองตารางข้างล่าง — รวมเป็นกรอบเดียว แบ่งกลุ่มด้วย
          ป้ายกำกับกับเส้นคั่น

          xl:flex-row = จอ ≥1280px อยู่บรรทัดเดียว ต่ำกว่านั้นแยกเป็น 2 แถวซ้อนกัน
          (ไม่ปล่อยให้ wrap เอง เพราะชิปจะไหลข้ามกลุ่มจนดูไม่ออกว่าอันไหนอยู่กลุ่มไหน) */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2.5 rounded-card border border-line bg-surface px-3.5 py-3">
        <SelectBox
          label={T.log_group_status}
          value={filter}
          onChange={pick}
          options={[
            { value: 'all', label: T.log_filter_all },
            { value: 'ok', label: T.log_filter_ok },
            { value: 'no_answer', label: T.log_filter_no_answer },
            { value: 'failed', label: T.log_filter_failed },
          ]}
        />

        <span className="hidden h-6 w-px shrink-0 bg-line sm:block" />

        <SelectBox
          label={T.log_group_range}
          value={preset}
          onChange={applyPreset}
          options={[
            { value: 'all', label: T.log_date_all },
            { value: 'today', label: T.log_date_today },
            { value: '7d', label: T.log_date_7d },
            { value: '30d', label: T.log_date_30d },
            { value: 'custom', label: T.log_date_custom },
          ]}
        />

        {/* ช่องวันที่โผล่เฉพาะโหมด "กำหนดเอง" — 4 ช่วงสำเร็จรูปครอบคลุมเกือบทุกครั้งที่คนเข้ามาดู
            ถ้ากางช่องวันที่ทิ้งไว้ตลอดจะกินที่ ~300px โดยแทบไม่ได้ใช้ และเป็นสาเหตุที่แถบตกบรรทัด
            (ป้าย "ตั้งแต่/ถึง" อยู่ใน aria-label ให้ screen reader — บนจอใช้ขีดคั่นแทน สั้นกว่าครึ่ง) */}
        {preset === 'custom' ? (
          <span className="flex items-center gap-1.5">
            <input
              type="date"
              aria-label={T.log_date_from}
              value={dateFrom}
              max={dateTo || today}
              onChange={(e) => setRange(e.target.value, dateTo)}
              className={dateInputCls}
            />
            <span className="text-caption text-ink-2">–</span>
            <input
              type="date"
              aria-label={T.log_date_to}
              value={dateTo}
              min={dateFrom || undefined}
              max={today}
              onChange={(e) => setRange(dateFrom, e.target.value)}
              className={dateInputCls}
            />
          </span>
        ) : null}
      </div>

      {/* คอลัมน์แน่นเกินจอมือถือ — ปล่อยให้เลื่อนแนวนอนดีกว่าบีบตัวอักษรไทยจนอ่านไม่ออก */}
      <div className="overflow-x-auto overscroll-x-contain rounded-card border border-line bg-surface shadow-card">
        <div
          className={cn(
            logGridCls,
            'border-b border-line bg-surface-2 px-4 py-2.5 font-mono text-micro font-bold text-ink-2',
          )}
        >
          <div>{T.col_datetime}</div>
          <div>{T.log_col_device}</div>
          <div>{T.log_col_event}</div>
          <div>{T.col_phone}</div>
          <div>{T.col_status}</div>
        </div>

        {rows.map((r) => (
          <div key={r.job_id}>
            <button
              type="button"
              disabled={!r.last_detail}
              onClick={() => setOpen((cur) => (cur === r.job_id ? null : r.job_id))}
              className={cn(
                logGridCls,
                'w-full items-center border-b border-line-2 px-4 py-3 text-start font-mono text-caption last:border-b-0',
                r.last_detail ? 'cursor-pointer hover:bg-surface-2' : 'cursor-default',
                open === r.job_id && 'bg-surface-2',
              )}
            >
              <div className="text-ink-2">{new Date(r.created_at).toLocaleString()}</div>
              <div className="min-w-0 truncate font-sans font-medium">{r.source_device ?? '—'}</div>
              <div className="min-w-0 truncate text-ink-2">{r.event_type_display_name ?? r.event_type_code ?? '—'}</div>
              <div>{r.last_phone_masked ?? '—'}</div>
              <div className={cn('flex items-center gap-1.5', resultTone(r.status))}>
                {r.status}
                {r.last_detail ? <span className="text-micro text-ink-2">{open === r.job_id ? '▾' : '▸'}</span> : null}
              </div>
            </button>
            {open === r.job_id && r.last_detail ? (
              <p className="min-w-[560px] border-b border-line-2 bg-surface-2 px-4 py-2.5 font-mono text-micro leading-[1.7] text-ink-2">
                {r.last_detail}
              </p>
            ) : null}
          </div>
        ))}

        {!loading && rows.length === 0 ? (
          <p className="px-4 py-6 text-caption text-ink-2">{T.log_empty}</p>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-2.5 font-mono text-caption text-ink-2">
        <span>{T.log_range(from, to, total)}</span>
        <span className="ms-auto flex gap-1.5">
          <button
            type="button"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="rounded-control border border-line bg-surface px-2.5 py-1.5 disabled:opacity-40"
          >
            ‹
          </button>
          <button
            type="button"
            onClick={() => setPage((p) => Math.min(lastPage, p + 1))}
            disabled={page >= lastPage}
            className="rounded-control border border-line bg-surface px-2.5 py-1.5 disabled:opacity-40"
          >
            ›
          </button>
        </span>
      </div>
    </div>
  );
}
