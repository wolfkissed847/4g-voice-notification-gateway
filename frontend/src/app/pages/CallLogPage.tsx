/**
 * CallLogPage — ประวัติการโทร
 *
 * ── ที่ออกแบบใหม่รอบนี้ และเหตุผล ──────────────────────────────────────────
 * 1. ตัวเลือกช่วงเวลาเคยซ่อนอยู่หลัง dropdown "กำหนดเอง" — ต้องกด 2 ชั้นกว่าจะเจอ
 *    ช่องวันที่ ตอนนี้ทั้งปุ่มลัดและช่องวันที่โผล่พร้อมกันตลอด ไม่ต้องเปิดหา
 *    และเพิ่มช่อง "เลือกทั้งเดือน" (<input type="month">) เพราะการดูย้อนหลังส่วนใหญ่
 *    คิดเป็นเดือน ไม่ใช่ช่วงวันที่คร่อมเดือน — เลือกทีเดียวได้ทั้งเดือนโดยไม่ต้องกด 2 ช่อง
 *
 * 2. เดิมทุกแถวโชว์วันที่-เวลาเต็มซ้ำกันทุกบรรทัด กินความกว้างและอ่านยากเวลามีหลายสิบแถว
 *    เปลี่ยนเป็นจัดกลุ่มตามวัน มีหัววันคั่น (พร้อมจำนวนสายของวันนั้น) แถวเหลือแค่เวลา
 *    การกวาดตาหาว่า "วันนั้นเกิดอะไรบ้าง" จึงทำได้โดยไม่ต้องอ่านวันที่ซ้ำทุกบรรทัด
 *
 * 3. สถานะเคยเป็นข้อความดิบภาษาอังกฤษ (connected/failed) ไม่ตรงกับหน้าอื่นที่ใช้ badge
 *    เปลี่ยนมาใช้ StatusBadge ตัวเดียวกับทั้งระบบ — สีและคำแปลมาจากที่เดียว
 *
 * 4. เดิมตารางกว้างเกินจอมือถือแล้วต้องเลื่อนแนวนอน เปลี่ยนเป็นแถวแบบ flex-wrap
 *    จอแคบข้อมูลจะไหลลงบรรทัดถัดไปเองแทนที่จะหลุดออกนอกจอ
 *
 * ── ต่างจากดีไซน์เดิมของ figma ────────────────────────────────────────────
 * - ชิป "งดตามเวลา"/"ส่ง SMS แทน" ไม่มี เพราะ backend ไม่มีสถานะพวกนั้น (ดู LIMITATIONS.md)
 * - คอลัมน์ "ค่าที่อ่านได้" เปลี่ยนเป็นชื่อเหตุการณ์ — อุปกรณ์ส่งมาแค่ event_type_code
 */
import { useEffect, useMemo, useState } from 'react';

import { cn } from '@/app/components/ui/utils';
import { getHistory } from '../api/history';
import { PageHeader } from '../components/primitives';
import { StatusBadge } from '../components/StatusBadge';
import { useApp } from '../context/AppContext';
import type { CallStatus, HistoryItem, Lang } from '../types';

const PAGE_SIZE = 20;

/** ชิปกรอง → ค่า status ที่ /history รับ (undefined = ไม่กรอง) */
const FILTERS = [
  { id: 'all', status: undefined },
  { id: 'ok', status: 'connected' },
  { id: 'no_answer', status: 'no_answer' },
  { id: 'failed', status: 'failed' },
] as const;

type FilterId = (typeof FILTERS)[number]['id'];

/* ── วันที่: ทำงานบนสตริง "YYYY-MM-DD" ตลอด ─────────────────────────────────
   ใช้รูปแบบเดียวกับที่ <input type="date"> รับ/คืน จึงไม่ต้องแปลงไปกลับ
   และไม่มีจังหวะที่ Date object ถูกตีความเป็น UTC จนวันเพี้ยนไปหนึ่งวัน */

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
 * created_at ฝั่ง backend เก็บเป็น UTC แต่ผู้ใช้คิดเป็นเวลาไทย — เลือก "9 ส.ค."
 * ต้องได้ทั้งวันตามเวลาไทย ไม่ใช่ 07:00 ของวันนั้นถึง 07:00 ของวันถัดไป
 * `new Date('2026-08-09T00:00:00')` (ไม่มี Z) ถูกตีความเป็นเวลาท้องถิ่นตามสเปก
 * .toISOString() จึงถอยกลับ 7 ชั่วโมงให้เองอัตโนมัติ ไม่ต้องบวกลบเอง
 */
const startOfDayUtc = (day: string) => new Date(`${day}T00:00:00`).toISOString();
const endOfDayUtc = (day: string) => new Date(`${day}T23:59:59.999`).toISOString();

const locale = (lang: Lang) => (lang === 'th' ? 'th-TH' : 'en-GB');

/** "15 สิงหาคม 2569" — th-TH ให้ปี พ.ศ. มาเองโดยไม่ต้องบวก 543 */
function fmtDay(day: string, lang: Lang, withWeekday = false): string {
  const d = new Date(`${day}T00:00:00`);
  return d.toLocaleDateString(locale(lang), {
    weekday: withWeekday ? 'long' : undefined,
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

/** ย่อช่วงวันที่ให้อ่านง่าย — เดือน/ปีเดียวกันไม่ต้องเขียนซ้ำสองรอบ */
function fmtRange(from: string, to: string, lang: Lang, allLabel: string): string {
  if (!from && !to) return allLabel;
  if (from && to && from === to) return fmtDay(from, lang, true);
  if (!to) return `${fmtDay(from, lang)} –`;
  if (!from) return `– ${fmtDay(to, lang)}`;
  const a = new Date(`${from}T00:00:00`);
  const b = new Date(`${to}T00:00:00`);
  if (a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth()) {
    return `${a.getDate()} – ${fmtDay(to, lang)}`;
  }
  return `${fmtDay(from, lang)} – ${fmtDay(to, lang)}`;
}

const ctlCls =
  'rounded-control border border-line bg-surface px-2.5 py-1.5 text-caption text-ink transition-colors ' +
  'hover:border-brand-strong focus:border-brand-strong focus:outline-none [color-scheme:light] dark:[color-scheme:dark]';

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-full border px-3 py-1.5 text-caption whitespace-nowrap transition-colors',
        on
          ? 'border-brand bg-brand font-semibold text-brand-ink'
          : 'border-line bg-surface font-medium text-ink-2 hover:border-brand-strong hover:text-ink',
      )}
    >
      {children}
    </button>
  );
}

export function CallLogPage() {
  const { T, lang } = useApp();
  const [filter, setFilter] = useState<FilterId>('all');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<number | null>(null);
  const [rows, setRows] = useState<HistoryItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  // ค่าว่าง = ไม่จำกัดช่วงเวลา (ดูทั้งหมด)
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const today = ymd(new Date());

  // poll ทุก 5 วิ — หน้านี้คนเปิดค้างไว้ดู ถ้าดึงครั้งเดียวจะไม่เห็นสายที่เพิ่งเกิด
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

  /** เปลี่ยนตัวกรองใดๆ ต้องกลับหน้า 1 ไม่งั้นอาจค้างที่หน้าที่ไม่มีข้อมูลแล้ว */
  const setRange = (from: string, to: string) => {
    setDateFrom(from);
    setDateTo(to);
    setPage(1);
  };
  const pick = (id: FilterId) => {
    setFilter(id);
    setPage(1);
  };

  /** เลือกทั้งเดือนจาก <input type="month"> ("YYYY-MM") → วันแรกถึงวันสุดท้ายของเดือนนั้น */
  const pickMonth = (m: string) => {
    if (!m) return setRange('', '');
    const [y, mo] = m.split('-').map(Number);
    setRange(`${m}-01`, ymd(new Date(y, mo, 0)));
  };

  const monthValue = dateFrom && dateTo && dateFrom.slice(8) === '01' && dateFrom.slice(0, 7) === dateTo.slice(0, 7)
    ? dateFrom.slice(0, 7)
    : '';

  const startOfMonth = `${today.slice(0, 7)}-01`;
  const presets = [
    { id: 'all', label: T.log_date_all, from: '', to: '' },
    { id: 'today', label: T.log_date_today, from: today, to: today },
    { id: 'yst', label: T.log_date_yesterday, from: daysAgo(1), to: daysAgo(1) },
    { id: '7d', label: T.log_date_7d, from: daysAgo(6), to: today },
    { id: '30d', label: T.log_date_30d, from: daysAgo(29), to: today },
    { id: 'month', label: T.log_date_this_month, from: startOfMonth, to: today },
  ];

  /** จัดกลุ่มแถวตาม "วัน" ตามเวลาเครื่องผู้ใช้ — rows เรียงใหม่→เก่ามาแล้วจากฝั่ง backend */
  const groups = useMemo(() => {
    const out: { day: string; items: HistoryItem[] }[] = [];
    for (const r of rows) {
      const day = ymd(new Date(r.created_at));
      const last = out[out.length - 1];
      if (last && last.day === day) last.items.push(r);
      else out.push({ day, items: [r] });
    }
    return out;
  }, [rows]);

  const from = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const to = Math.min(page * PAGE_SIZE, total);
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="flex flex-col gap-3.5">
      <PageHeader title={T.history_title} meta={T.history_records(total)} />

      {/* ── ตัวกรอง ────────────────────────────────────────────────────────
          ทุกตัวเลือกอยู่ในระดับเดียวกันหมด ไม่มีอะไรซ่อนหลังการกดอีกชั้น */}
      <div className="flex flex-col gap-3 rounded-card border border-line bg-surface px-3.5 py-3">
        <div className="flex flex-col gap-2">
          <span className="font-mono text-micro tracking-[0.1em] text-ink-2 uppercase">{T.log_group_range}</span>
          <div className="flex flex-wrap gap-1.5">
            {presets.map((p) => (
              <Chip key={p.id} on={dateFrom === p.from && dateTo === p.to} onClick={() => setRange(p.from, p.to)}>
                {p.label}
              </Chip>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
            <label className="flex items-center gap-1.5">
              <span className="text-micro whitespace-nowrap text-ink-2">{T.log_date_from}</span>
              <input
                type="date"
                lang={lang === 'th' ? 'th-TH' : 'en-GB'}
                value={dateFrom}
                max={dateTo || today}
                onChange={(e) => setRange(e.target.value, dateTo)}
                className={cn(ctlCls, 'font-mono')}
              />
            </label>
            <label className="flex items-center gap-1.5">
              <span className="text-micro whitespace-nowrap text-ink-2">{T.log_date_to}</span>
              <input
                type="date"
                lang={lang === 'th' ? 'th-TH' : 'en-GB'}
                value={dateTo}
                min={dateFrom || undefined}
                max={today}
                onChange={(e) => setRange(dateFrom, e.target.value)}
                className={cn(ctlCls, 'font-mono')}
              />
            </label>

            {/* เลือกทั้งเดือนทีเดียว — การดูย้อนหลังส่วนใหญ่คิดเป็นเดือน ไม่ใช่ช่วงวัน */}
            <label className="flex items-center gap-1.5">
              <span className="text-micro whitespace-nowrap text-ink-2">{T.log_pick_month}</span>
              <input
                type="month"
                lang={lang === 'th' ? 'th-TH' : 'en-GB'}
                value={monthValue}
                max={today.slice(0, 7)}
                onChange={(e) => pickMonth(e.target.value)}
                className={cn(ctlCls, 'font-mono')}
              />
            </label>

            {dateFrom || dateTo ? (
              <button
                type="button"
                onClick={() => setRange('', '')}
                className="text-caption font-medium text-brand-strong"
              >
                {T.log_clear_range}
              </button>
            ) : null}
          </div>

          {/* สรุปเป็นภาษาคนว่ากำลังดูช่วงไหนอยู่ — ช่องวันที่เป็นตัวเลขล้วน อ่านแล้วไม่เห็นภาพ */}
          <p className="text-caption text-ink-2">
            {T.log_viewing(fmtRange(dateFrom, dateTo, lang, T.log_date_all))}
          </p>
        </div>

        <div className="h-px bg-line-2" />

        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="font-mono text-micro tracking-[0.1em] text-ink-2 uppercase">{T.log_group_status}</span>
          <div className="flex flex-wrap gap-1.5">
            {(
              [
                { id: 'all', label: T.log_filter_all },
                { id: 'ok', label: T.log_filter_ok },
                { id: 'no_answer', label: T.log_filter_no_answer },
                { id: 'failed', label: T.log_filter_failed },
              ] as const
            ).map((f) => (
              <Chip key={f.id} on={filter === f.id} onClick={() => pick(f.id)}>
                {f.label}
              </Chip>
            ))}
          </div>
        </div>
      </div>

      {/* ── รายการทั้งหมดอยู่ในกล่องเดียว ────────────────────────────────────
          หัวคอลัมน์ หัววัน และแถวข้อมูล อยู่ในกรอบเดียวกัน แยกกันด้วยเส้นคั่น
          เดิมแยกเป็นกล่องย่อยต่อวัน ทำให้หน้ายาวๆ ดูเป็นแผ่นๆ ไม่ต่อเนื่อง

          ความกว้างของคอลัมน์ขวา (เบอร์/สถานะ/ลูกศร) ถูกตรึงเป็นตัวเลขตายตัว
          และ "จองที่ลูกศรไว้เสมอ" แม้แถวนั้นจะไม่มีรายละเอียดให้กาง — ไม่งั้น
          แถวที่มีลูกศรจะดัน badge เบียดซ้ายไปหนึ่งช่อง แล้วสำเร็จ/ล้มเหลว
          ของแต่ละแถวจะไม่ตรงกันเป็นแนวเดียว */}
      {groups.length > 0 ? (
        <div className="overflow-hidden rounded-card border border-line bg-surface shadow-card">
          {/* ซ่อนหัวคอลัมน์บนจอแคบ — ที่นั่นแถวไหลลงบรรทัดใหม่จนป้ายไม่ตรงกับข้อมูลแล้ว */}
          <div className="hidden flex-wrap items-center gap-x-3 border-b border-line bg-surface-2 px-3.5 py-2 font-mono text-micro font-bold text-ink-2 sm:flex">
            <span className="w-[46px] shrink-0">{T.col_datetime}</span>
            <span className="min-w-0 basis-[150px]">{T.log_col_device}</span>
            <span className="min-w-0 flex-1 basis-[140px]">{T.log_col_event}</span>
            <span className="w-[96px] shrink-0 text-end">{T.col_phone}</span>
            <span className="w-[92px] shrink-0 text-end">{T.col_status}</span>
            <span className="w-3 shrink-0" />
          </div>

          {groups.map((g) => (
            <div key={g.day}>
              <div className="flex flex-wrap items-baseline gap-x-2.5 border-b border-line-2 bg-surface-2/60 px-3.5 py-2">
                <h2 className="text-caption font-bold">{fmtDay(g.day, lang, true)}</h2>
                <span className="font-mono text-micro text-ink-2">{T.log_day_calls(g.items.length)}</span>
              </div>

              {g.items.map((r) => (
                <div key={r.job_id}>
                  <button
                    type="button"
                    disabled={!r.last_detail}
                    onClick={() => setOpen((cur) => (cur === r.job_id ? null : r.job_id))}
                    className={cn(
                      'flex w-full flex-wrap items-center gap-x-3 gap-y-1 border-b border-line-2 px-3.5 py-3 text-start last:border-b-0',
                      r.last_detail ? 'cursor-pointer hover:bg-surface-2' : 'cursor-default',
                      open === r.job_id && 'bg-surface-2',
                    )}
                  >
                    {/* เวลาอย่างเดียว — วันที่อยู่ที่หัวกลุ่มแล้ว ไม่ต้องซ้ำทุกบรรทัด */}
                    <span className="w-[46px] shrink-0 font-mono text-caption font-bold">
                      {new Date(r.created_at).toLocaleTimeString(locale(lang), {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                    <span className="min-w-0 basis-[120px] truncate text-caption font-medium sm:basis-[150px]">
                      {r.source_device ?? '—'}
                    </span>
                    <span className="min-w-0 flex-1 basis-[140px] truncate text-caption text-ink-2">
                      {r.event_type_display_name ?? r.event_type_code ?? '—'}
                    </span>
                    <span className="w-[96px] shrink-0 text-end font-mono text-caption text-ink-2">
                      {r.last_phone_masked ?? '—'}
                    </span>
                    <span className="flex w-[92px] shrink-0 justify-end">
                      <StatusBadge status={r.status as CallStatus} />
                    </span>
                    {/* ช่องลูกศรมีอยู่ทุกแถว ว่างไว้ถ้าไม่มีรายละเอียด — เพื่อให้ badge ตรงแนวกัน */}
                    <span className="w-3 shrink-0 text-center font-mono text-micro text-ink-2">
                      {r.last_detail ? (open === r.job_id ? '▾' : '▸') : ''}
                    </span>
                  </button>
                  {open === r.job_id && r.last_detail ? (
                    <p className="border-b border-line-2 bg-surface-2 px-3.5 py-2.5 ps-[62px] text-caption leading-[1.8] text-ink-2">
                      {r.last_detail}
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
          ))}
        </div>
      ) : null}

      {!loading && rows.length === 0 ? (
        <p className="rounded-card border border-dashed border-line px-4 py-8 text-center text-caption text-ink-2">
          {T.log_empty}
        </p>
      ) : null}

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
