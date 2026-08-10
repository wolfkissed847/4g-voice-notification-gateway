/**
 * PipelineNow — การ์ด "การทำงานตอนนี้" นับงานแยกตามช่วงของ pipeline
 *
 * ── ที่มา ──────────────────────────────────────────────────────────────────
 * การ์ดนี้อยู่ใน mockup ที่ผู้ใช้ส่งมา แต่ **ไม่มีใน figma/handoff/components/**
 * DashboardPage.tsx ของ handoff ประกาศ prop `pipeline` ไว้ (บรรทัด 22 และ 31)
 * แล้วไม่เคย render เลย จึงสร้างขึ้นใหม่จากภาพ + ข้อมูลจริงของเรา
 *
 * ── ต่างจากภาพ 1 ช่อง ──────────────────────────────────────────────────────
 * ภาพมี 5 ช่อง: เข้าคิว / ตรวจ key+เงื่อนไข / กำลังโทร / รอโทรซ้ำ / จบแล้ววันนี้
 * ของเราเหลือ 4 — ตัด "ตรวจ key / เงื่อนไข" ออก เพราะ backend ตรวจ key แบบ
 * synchronous อยู่ใน POST /notify (ผ่านก็เข้าคิว ไม่ผ่านตอบ 403 ทันที)
 * มันไม่เคยเป็นสถานะที่ค้างอยู่ในคิว ช่องนี้จึงเป็น 0 ตลอดกาล
 * (ในภาพก็เป็น 0) — โชว์เลข 0 ที่ขยับไม่ได้ทำให้คนเข้าใจผิดว่าระบบค้างตรงนั้น
 */
import { useEffect, useState } from 'react';

import { cn } from '@/app/components/ui/utils';
import { getHistory } from '../api/history';
import { getQueueStatus } from '../api/queue';
import { Card, CardHead } from '../components/primitives';
import { useApp } from '../context/AppContext';
import type { QueueStatusItem } from '../types';

const REFRESH_MS = 5000;

/** สถานะที่ถือว่า "จบแล้ว" ใช้นับยอดของวันนี้ */
const DONE_STATUSES = ['connected', 'failed'] as const;

type Tile = { label: string; sub: string; count: number; tone: 'muted' | 'accent' | 'warn' };

function midnightIso(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

export function PipelineNow() {
  const { T } = useApp();
  const [pending, setPending] = useState<QueueStatusItem[]>([]);
  const [doneToday, setDoneToday] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const dateFrom = midnightIso();
      const [queue, ...done] = await Promise.all([
        getQueueStatus(),
        // นับฝั่ง server ผ่าน total_count — ถ้านับจากรายการที่โหลดมาจะเพี้ยนเมื่อเกิน page_size
        ...DONE_STATUSES.map((status) => getHistory({ page: 1, page_size: 1, date_from: dateFrom, status })),
      ]);
      if (cancelled) return;
      setPending(queue.items);
      setDoneToday(done.reduce((sum, r) => sum + r.total_count, 0));
    };
    void load();
    const id = setInterval(() => void load(), REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const countOf = (...statuses: string[]) => pending.filter((j) => statuses.includes(j.status)).length;

  const tiles: Tile[] = [
    { label: T.pipe_queued, sub: T.pipe_queued_sub, count: countOf('queued'), tone: 'muted' },
    { label: T.pipe_calling, sub: T.pipe_calling_sub, count: countOf('in_progress'), tone: 'accent' },
    { label: T.pipe_retry, sub: T.pipe_retry_sub, count: countOf('retrying', 'escalated'), tone: 'warn' },
    { label: T.pipe_done, sub: T.pipe_done_sub, count: doneToday, tone: 'muted' },
  ];

  return (
    <Card className="overflow-hidden">
      <CardHead title={T.pipe_title} hint={T.pipe_flow} />
      <div className="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-3 p-4">
        {tiles.map((t) => (
          <div
            key={t.label}
            className={cn(
              'rounded-card border p-4 transition-colors',
              // ระบายสีเฉพาะช่องที่มีงานค้างอยู่จริง ช่องว่างคงเป็นกลางไว้ ไม่แย่งสายตา
              t.count > 0 && t.tone === 'accent'
                ? 'border-brand bg-brand-soft'
                : t.count > 0 && t.tone === 'warn'
                  ? 'border-warn bg-warn-soft'
                  : 'border-line bg-surface-2',
            )}
          >
            <p
              className={cn(
                'text-caption',
                t.count > 0 && t.tone === 'accent' ? 'text-brand' : t.count > 0 && t.tone === 'warn' ? 'text-warn' : 'text-ink-2',
              )}
            >
              {t.label}
            </p>
            <p className="mt-1 font-mono text-h2 leading-none font-bold">{t.count}</p>
            <p className="mt-2 font-mono text-micro text-ink-2">{t.count > 0 ? t.sub : T.pipe_none}</p>
          </div>
        ))}
      </div>
    </Card>
  );
}
