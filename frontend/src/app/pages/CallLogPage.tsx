/**
 * CallLogPage — พอร์ตจาก figma/handoff/components/CallLogPage.tsx
 * แทน HistoryPage เดิม
 *
 * ── ต่างจากดีไซน์ ──────────────────────────────────────────────────────────
 * 1. ชิปกรอง "งดตามเวลา" (suppressed) ตัดออก — ยังไม่มีสถานะนี้ใน backend
 *    ต้องมีช่วงห้ามโทรก่อน (DEPLOYMENT_MODELS.md ข้อ 5, 19) ใส่ "ส่ง SMS แทน" ที่มีจริงแทน
 * 2. คอลัมน์ "ค่าที่อ่านได้" (reading/value) เปลี่ยนเป็นชื่อเหตุการณ์
 *    เพราะ backend ไม่รับค่าตัวเลขจากอุปกรณ์ — อุปกรณ์ส่งแค่ event_type_code
 * 3. meta "90 days" ตัดออก — ยังไม่มี retention policy จริง (P2-DB ข้อ 12)
 *    แสดงจำนวนรายการทั้งหมดตามที่ /history คืนมาแทน
 * 4. CSV ออกเฉพาะหน้าที่กำลังดู เพราะไม่มี endpoint export ทั้งชุด — กำกับไว้ในหน้า
 * 5. ปุ่มเปลี่ยนหน้าในดีไซน์เป็นปุ่มเปล่า ต่อ page/page_size ของ /history ให้ทำงานจริง
 */
import { useEffect, useState } from 'react';

import { cn } from '@/app/components/ui/utils';
import { getHistory } from '../api/history';
import { Chip, ChipRow, PageHeader, logGridCls } from '../components/primitives';
import { useApp } from '../context/AppContext';
import type { HistoryItem } from '../types';

const PAGE_SIZE = 20;

/** ชิปกรอง → ค่า status ที่ /history รับ (undefined = ไม่กรอง) */
const FILTERS = [
  { id: 'all', status: undefined },
  { id: 'ok', status: 'connected' },
  { id: 'sms', status: 'sms_fallback_sent' },
  { id: 'no_answer', status: 'no_answer' },
  { id: 'failed', status: 'failed' },
] as const;

type FilterId = (typeof FILTERS)[number]['id'];

function resultTone(status: string): string {
  if (status === 'connected') return 'text-ok';
  if (status === 'sms_fallback_sent') return 'text-brand';
  if (status === 'failed') return 'text-bad';
  if (status === 'queued' || status === 'in_progress' || status === 'cancelled') return 'text-ink-2';
  return 'text-warn';
}

export function CallLogPage() {
  const { T } = useApp();
  const [filter, setFilter] = useState<FilterId>('all');
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<HistoryItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const status = FILTERS.find((f) => f.id === filter)?.status;
    getHistory({ page, page_size: PAGE_SIZE, status })
      .then((res) => {
        if (cancelled) return;
        setRows(res.items);
        setTotal(res.total_count);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [filter, page]);

  const pick = (id: FilterId) => {
    setFilter(id);
    setPage(1); // กรองใหม่ต้องกลับหน้า 1 ไม่งั้นอาจค้างที่หน้าที่ไม่มีข้อมูล
  };

  const exportCsv = () => {
    const header = ['job_id', 'created_at', 'device', 'event', 'phone_masked', 'status', 'retry_count'];
    const lines = rows.map((r) =>
      [
        r.job_id,
        r.created_at,
        r.source_device ?? '',
        r.event_type_code ?? '',
        r.last_phone_masked ?? '',
        r.status,
        r.retry_count,
      ]
        // ครอบ quote + escape กัน , และ " ในข้อความไทยทำให้คอลัมน์เพี้ยน
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(','),
    );
    // BOM ข้างหน้า ไม่งั้น Excel บน Windows อ่านภาษาไทยเป็นตัวยึกยือ
    const blob = new Blob(['﻿' + [header.join(','), ...lines].join('\n')], {
      type: 'text/csv;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `call-log-p${page}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const from = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const to = Math.min(page * PAGE_SIZE, total);
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="flex flex-col gap-3.5">
      <PageHeader title={T.history_title} meta={T.history_records(total)} />

      <ChipRow>
        <Chip active={filter === 'all'} onClick={() => pick('all')}>
          {T.log_filter_all}
        </Chip>
        <Chip active={filter === 'ok'} onClick={() => pick('ok')}>
          {T.log_filter_ok}
        </Chip>
        <Chip active={filter === 'sms'} onClick={() => pick('sms')}>
          {T.log_filter_sms}
        </Chip>
        <Chip active={filter === 'no_answer'} onClick={() => pick('no_answer')}>
          {T.log_filter_no_answer}
        </Chip>
        <Chip active={filter === 'failed'} onClick={() => pick('failed')}>
          {T.log_filter_failed}
        </Chip>
        <span className="ms-auto">
          <Chip onClick={exportCsv} disabled={rows.length === 0}>
            ↓ {T.log_export_csv}
          </Chip>
        </span>
      </ChipRow>

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
          <div
            key={r.job_id}
            className={cn(
              logGridCls,
              'items-center border-b border-line-2 px-4 py-3 font-mono text-caption last:border-b-0',
            )}
          >
            <div className="text-ink-2">{new Date(r.created_at).toLocaleString()}</div>
            <div className="min-w-0 truncate font-sans font-medium">{r.source_device ?? '—'}</div>
            <div className="min-w-0 truncate text-ink-2">{r.event_type_display_name ?? r.event_type_code ?? '—'}</div>
            <div>{r.last_phone_masked ?? '—'}</div>
            <div className={resultTone(r.status)}>{r.status}</div>
          </div>
        ))}

        {!loading && rows.length === 0 ? (
          <p className="px-4 py-6 text-caption text-ink-2">{T.log_empty}</p>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-2.5 font-mono text-caption text-ink-2">
        <span>{T.log_range(from, to, total)}</span>
        <span className="text-micro">{T.log_export_note}</span>
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
