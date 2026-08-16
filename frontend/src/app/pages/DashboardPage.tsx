/**
 * DashboardPage — หน้าภาพรวม
 *
 * พอร์ตผังจาก figma/Redesign Corporate Web App (PageOverview) บนข้อมูลจริงทั้งหมด
 *
 *   แถว 1  ตัวเลขสรุป 6 ช่อง
 *   แถว 2  Signal Flow | คิวแบบเรียลไทม์
 *   แถว 3  สุขภาพระบบ (เกจวงแหวน) | อุปกรณ์ & key | กราฟ 24 ชม.
 *   แถว 4  กิจกรรมล่าสุด (กางดูรายละเอียดได้)
 *
 * ── ต่างจากไฟล์ดีไซน์ ────────────────────────────────────────────────────────
 * 1. เกจสุขภาพระบบของดีไซน์เป็นค่าสุ่มที่แกว่งไปมาเอง (Math.sin ตาม tick)
 *    ของเราอ่านจาก /system/pi จริง — CPU / RAM / อุณหภูมิ ทั้งสามค่าเป็น null ได้
 *    (อุณหภูมิอ่านไม่ได้ถ้าไม่ใช่ Linux) เกจจึงต้องมีสถานะ "ไม่ทราบ" ที่ดีไซน์ไม่มี
 * 2. ดีไซน์แทนช่องสัญญาณด้วยเกจตัวที่สาม ของเราใช้อุณหภูมิแทน เพราะสัญญาณมี
 *    ช่องของตัวเองอยู่แถวบนแล้ว (พร้อมขีดและชื่อผู้ให้บริการ) ส่วนอุณหภูมิยังไม่มีที่อยู่
 *    บนหน้านี้เลยทั้งที่เป็นค่าที่ทำให้ Pi ดับได้จริง
 * 3. คิวแบบเรียลไทม์ของดีไซน์ใช้ SAMPLE_QUEUE ที่เขียนค่าไว้ตายตัว ของเราดึงจาก
 *    /queue/status — และแสดงป้ายชื่อผู้รับที่งานนั้นตัดสินใจไว้ ไม่ใช่ชื่อคนตายตัว
 * 4. เพิ่มแถว "กิจกรรมล่าสุด" ที่ดีไซน์ตัดออก — กางแถวดูผลการโทรรายครั้งได้
 *    ซึ่งเป็นทางเดียวบนหน้านี้ที่ตอบได้ว่า "สายที่แล้วพลาดเพราะอะไร"
 * 5. ปุ่ม "เพิ่มอุปกรณ์" ของดีไซน์ยังไม่ได้ต่อ ของเราพาไปหน้าตั้งค่าอุปกรณ์จริง
 *
 * ── ข้อจำกัดของข้อมูลที่ยังอยู่ ─────────────────────────────────────────────
 * /history จำกัด page_size 100 กราฟรายชั่วโมงจึงนับจาก 100 รายการล่าสุดของวันนี้
 * ไม่ได้แสร้งว่าครบทุกสาย — กำกับไว้ใต้กราฟตรงๆ
 * ส่วนตัวเลขสรุปนับฝั่ง server ผ่าน total_count จึงถูกต้องแม้วันนั้นจะเกิน 100 สาย
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';

import { cn } from '@/app/components/ui/utils';
import { listApiKeys } from '../api/apiKeys';
import { getHistory } from '../api/history';
import { getQueueStatus } from '../api/queue';
import { getGsmDetail, getPiDetail } from '../api/system';
import { Btn, Card, CardHead, Dot, PageHeader, Pill, StatTile, type Tone } from '../components/primitives';
import { StatusBadge } from '../components/StatusBadge';
import { useApp } from '../context/AppContext';
import { operatorName } from '../lib/operator';
import { SignalFlowMonitor } from '../widgets/SignalFlowMonitor';
import type { ApiKey, CallStatus, GsmDetail, HistoryItem, PiDetail, QueueStatusItem } from '../types';

const REFRESH_MS = 5_000;

/** สถานะที่ถือว่าจบแบบสำเร็จ / แบบล้มเหลว — ใช้ยิงนับแยกฝั่ง server ผ่าน total_count */
const OK_STATUSES = ['connected'] as const;
const BAD_STATUSES = ['failed'] as const;

function statusTone(status: string): Tone {
  if (status === 'connected') return 'ok';
  if (status === 'failed') return 'bad';
  if (status === 'queued' || status === 'in_progress') return 'muted';
  return 'warn';
}

/**
 * RSSI ดิบ 0-31 จาก AT+CSQ → dBm ตามสูตรมาตรฐานของ 3GPP: dBm = -113 + 2 × rssi
 * (0 = -113 dBm, 31 = -51 dBm) — หน่วยที่ช่างอ่านแล้วเทียบได้ทันที ต่างจากเลข 0-31
 */
function rssiToDbm(rssi: number | null): number | null {
  return rssi == null ? null : -113 + 2 * rssi;
}

/** RSSI ดิบ 0-31 → จำนวนขีด 0-4 */
function signalBars(rssi: number | null): number {
  if (rssi == null) return 0;
  if (rssi >= 20) return 4;
  if (rssi >= 15) return 3;
  if (rssi >= 10) return 2;
  if (rssi >= 2) return 1;
  return 0;
}

function midnightIso(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

export function DashboardPage() {
  const { T } = useApp();
  const navigate = useNavigate();

  const [gsm, setGsm] = useState<GsmDetail | null>(null);
  const [pi, setPi] = useState<PiDetail | null>(null);
  const [recent, setRecent] = useState<HistoryItem[]>([]);
  const [todayItems, setTodayItems] = useState<HistoryItem[]>([]);
  const [callsToday, setCallsToday] = useState<number | null>(null);
  const [okToday, setOkToday] = useState<number | null>(null);
  const [badToday, setBadToday] = useState<number | null>(null);
  const [pending, setPending] = useState<number | null>(null);
  const [queueItems, setQueueItems] = useState<QueueStatusItem[]>([]);
  const [devices, setDevices] = useState<ApiKey[]>([]);
  const [open, setOpen] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      const dateFrom = midnightIso();
      const [gsmDetail, piDetail, history, queue, keys, todayAll, ...counts] = await Promise.all([
        getGsmDetail(),
        getPiDetail(),
        getHistory({ page: 1, page_size: 5 }),
        getQueueStatus(),
        listApiKeys(),
        // page_size 100 = เพดานของ backend — ใช้ทั้งนับรวมและทำกราฟรายชั่วโมง
        getHistory({ page: 1, page_size: 100, date_from: dateFrom }),
        // นับแยกตามสถานะฝั่ง server (อ่านจาก total_count) แทนการนับจากรายการที่โหลดมา
        // เพราะถ้าวันไหนโทรเกิน 100 สาย ตัวเลขที่นับเองจะเพี้ยน
        ...[...OK_STATUSES, ...BAD_STATUSES].map((status) =>
          getHistory({ page: 1, page_size: 1, date_from: dateFrom, status }),
        ),
      ]);
      if (cancelled) return;

      setGsm(gsmDetail);
      setPi(piDetail);
      setRecent(history.items);
      setPending(queue.total_pending);
      setQueueItems(queue.items);
      setDevices(keys);
      setCallsToday(todayAll.total_count);
      setTodayItems(todayAll.items);

      const okCount = counts.slice(0, OK_STATUSES.length).reduce((sum, r) => sum + r.total_count, 0);
      const badCount = counts.slice(OK_STATUSES.length).reduce((sum, r) => sum + r.total_count, 0);
      setOkToday(okCount);
      setBadToday(badCount);
    };

    void load();
    const id = setInterval(() => void load(), REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const bars = signalBars(gsm?.signal_quality ?? null);
  const dbm = rssiToDbm(gsm?.signal_quality ?? null);
  const doneToday = (okToday ?? 0) + (badToday ?? 0);

  // แบ่งสายวันนี้เป็นถัง 24 ชั่วโมง จากรายการจริงที่โหลดมาได้
  const hourly = Array.from({ length: 24 }, () => 0);
  todayItems.forEach((it) => {
    hourly[new Date(it.created_at).getHours()] += 1;
  });
  const hourlyMax = Math.max(1, ...hourly);
  const peakHour = hourly.reduce((best, n, i) => (n > hourly[best] ? i : best), 0);

  const onlineDevices = devices.filter(
    (d) => d.is_active && d.last_used_at && Date.now() - new Date(d.last_used_at).getTime() < 15 * 60_000,
  ).length;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={T.overview_title}
        meta={T.dash_auto_refresh}
        action={
          <Btn variant="primary" onClick={() => navigate('/devices')}>
            + {T.add_device}
          </Btn>
        }
      />

      {/* ── แถว 1: ตัวเลขสรุป 6 ช่อง ─────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        {/* เดิมโมดูลหลุดแล้วขึ้นแถบเตือนสีแดงเต็มความกว้างเหนือแถวนี้ ถอดออกแล้ว —
            เรื่องนี้เป็นเรื่องของสัญญาณ 4G ซึ่งมีช่องของตัวเองอยู่ตรงนี้อยู่แล้ว
            การเตือนซ้ำสองที่ทำให้ต้องอ่านสองรอบกว่าจะรู้ว่าเป็นเรื่องเดียวกัน
            และแถบเต็มความกว้างยังดันทั้งหน้าลงทุกครั้งที่โมดูลกะพริบหลุด-ติด */}
        <StatTile
          label={T.dash_signal_4g}
          alert={gsm != null && !gsm.connected}
          // ค่าดิบ x/31 ตรงตามที่ AT+CSQ ตอบ (ชุดเดียวกับหน้าระบบ) ส่วน dBm อยู่บรรทัดล่าง
          // — เทียบ "15/31" ง่ายกว่าเลขติดลบสำหรับคนที่ไม่ได้ดูสเปกวิทยุ
          //
          // โมดูลหลุด ≠ สัญญาณอ่อน จึงไม่โชว์ "ไม่ทราบ" ที่อ่านได้ว่าแค่วัดค่าไม่ได้ชั่วคราว
          // ใช้คำเดียวกับป้ายในหน้าระบบ จะได้รู้ว่าพูดถึงเรื่องเดียวกัน
          value={
            gsm != null && !gsm.connected ? (
              <span className="text-bad-strong">{T.sys_module_offline}</span>
            ) : gsm?.signal_quality != null ? (
              `${gsm.signal_quality}/31`
            ) : (
              T.gsm_signal_unknown
            )
          }
          foot={
            gsm != null && !gsm.connected ? (
              // แถบเตือนเดิมบอกแค่ว่าโมดูลหลุด แล้วปล่อยให้ไปหาเองว่าแก้ที่ไหน
              // ตรงนี้พาไปหน้าระบบเลย เพราะปุ่มรีสตาร์ทโมดูลอยู่ที่นั่น
              <button
                type="button"
                onClick={() => navigate('/system')}
                className="text-bad-strong underline underline-offset-2 hover:no-underline"
              >
                {T.dash_signal_fix} ›
              </button>
            ) : (
              <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
                <span className="flex h-3.5 shrink-0 items-end gap-0.5">
                  {[0, 1, 2, 3].map((i) => (
                    <span
                      key={i}
                      className={cn(
                        'w-1.5 rounded-sm',
                        i < bars ? 'bg-brand' : 'bg-line',
                        i === 0 && 'h-[5px]',
                        i === 1 && 'h-[8px]',
                        i === 2 && 'h-[11px]',
                        i === 3 && 'h-[14px]',
                      )}
                    />
                  ))}
                </span>
                <span className="min-w-0 break-words">
                  {operatorName(gsm?.operator) ?? T.gsm_no_operator}
                  {dbm != null ? ` · ${dbm} dBm` : ''}
                </span>
              </span>
            )
          }
        />
        <StatTile label={T.stat_calls} value={callsToday ?? '—'} foot={T.stat_calls_sub} />
        <StatTile
          label={T.ov_success}
          value={<span className="text-ok-strong">{okToday ?? '—'}</span>}
          foot={T.stat_calls_sub}
        />
        <StatTile
          label={T.ov_failed}
          value={<span className="text-bad-strong">{badToday ?? '—'}</span>}
          foot={T.stat_calls_sub}
        />
        <StatTile label={T.stat_queue} value={pending ?? '—'} foot={T.stat_queue_sub} />
        <StatTile label={T.ov_done_today} value={doneToday} foot={T.stat_calls_sub} />
      </div>

      {/* ── แถว 2: Signal Flow | คิวแบบเรียลไทม์ ──────────────────────────── */}
      {/* items-stretch: การ์ดในแถวเดียวกันสูงเท่ากันตามใบที่สูงสุด เดิมใช้ items-start
          จึงสูงตามเนื้อหาของตัวเอง ได้ขอบล่างไม่ตรงกันเป็นขั้นบันได */}
      <div className="grid items-stretch gap-4 xl:grid-cols-2">
        <SignalFlowMonitor />
        <LiveQueue items={queueItems} />
      </div>

      {/* ── แถว 3: สุขภาพระบบ | อุปกรณ์ | กราฟ 24 ชม. ───────────────────── */}
      <div className="grid items-stretch gap-4 lg:grid-cols-2 xl:grid-cols-3">
        <SystemHealth pi={pi} />

        <Card className="min-w-0 p-4">
          <h3 className="mb-3 text-caption font-bold">{T.devices_title}</h3>
          {devices.length === 0 ? (
            <p className="text-caption text-ink-2">{T.devices_empty_title}</p>
          ) : (
            <ul className="flex flex-col gap-2.5">
              {devices.map((d) => {
                const seen = d.last_used_at;
                const online = d.is_active && !!seen && Date.now() - new Date(seen).getTime() < 15 * 60_000;
                return (
                  <li key={d.id} className={cn('flex items-center gap-2.5', !online && 'opacity-60')}>
                    <Dot tone={online ? 'ok' : 'muted'} />
                    <span className="min-w-0 flex-1 truncate text-caption font-medium">{d.name}</span>
                    <span className="font-mono text-micro whitespace-nowrap text-ink-2">
                      {d.key_prefix}…
                    </span>
                  </li>
                );
              })}
            </ul>
          )}

          <div className="mt-3 flex flex-col gap-1.5 border-t border-line-2 pt-3">
            <StatRow label={T.devices_title} value={String(devices.length)} />
            <StatRow label={T.device_online} value={String(onlineDevices)} tone={onlineDevices > 0 ? 'ok' : undefined} />
          </div>
        </Card>

        <Card className="min-w-0 p-4">
          <h3 className="mb-3 text-caption font-bold">{T.dash_calls_24h}</h3>
          <div className="flex h-[70px] items-end gap-[3px]">
            {hourly.map((count, i) => (
              <span
                key={i}
                title={`${String(i).padStart(2, '0')}:00 — ${count}`}
                className={cn('flex-1 rounded-sm transition-all', count > 0 ? 'bg-brand' : 'bg-line')}
                style={{ height: `${Math.max(6, (count / hourlyMax) * 100)}%` }}
              />
            ))}
          </div>
          <div className="mt-1.5 flex justify-between font-mono text-micro text-ink-2">
            <span>00:00</span>
            <span>12:00</span>
            <span>23:00</span>
          </div>

          <div className="mt-3 flex items-center justify-between rounded-control bg-surface-2 px-3 py-2">
            <span className="text-micro text-ink-2">{T.ov_peak}</span>
            <span className="font-mono text-micro font-bold text-brand-strong">
              {hourly[peakHour] > 0
                ? T.ov_peak_at(`${String(peakHour).padStart(2, '0')}:00`, hourly[peakHour])
                : T.ov_no_peak}
            </span>
          </div>
          <p className="mt-2 text-micro leading-[1.7] text-ink-2">{T.dash_hours_capped}</p>
        </Card>
      </div>

      {/* ── แถว 4: กิจกรรมล่าสุด ─────────────────────────────────────────── */}
      <Card className="min-w-0 overflow-hidden">
        <CardHead
          title={T.recent_title}
          hint={T.dash_tap_row_hint}
          action={
            <button
              type="button"
              onClick={() => navigate('/history')}
              className="text-caption font-medium text-brand-strong"
            >
              {T.dash_view_all} ›
            </button>
          }
        />

        {recent.length === 0 ? <p className="px-4 py-6 text-caption text-ink-2">{T.dash_no_events}</p> : null}

        {recent.map((ev) => (
          <div key={ev.job_id}>
            <button
              type="button"
              onClick={() => setOpen(open === ev.job_id ? null : ev.job_id)}
              className={cn(
                'flex w-full flex-wrap items-center gap-2.5 px-4 py-3 text-start',
                open === ev.job_id ? 'bg-surface-2' : 'border-b border-line-2',
              )}
            >
              <span className="font-mono text-caption font-bold">
                {new Date(ev.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
              <span className="text-caption font-semibold">{ev.source_device ?? ev.group_name}</span>
              <span className="min-w-0 truncate text-caption text-ink-2">
                {ev.event_type_display_name ?? ev.event_type_code ?? '—'}
              </span>
              <span className="ms-auto flex items-center gap-2">
                <StatusBadge status={ev.status as CallStatus} />
                <span className="font-mono text-micro text-ink-2">{open === ev.job_id ? '▾' : '▸'}</span>
              </span>
            </button>

            {open === ev.job_id ? (
              <div className="border-b border-line bg-surface-2 px-4 pt-1 pb-4">
                <div className="flex flex-wrap items-stretch gap-2">
                  <DetailCell label={T.dash_last_attempt} value={ev.last_result ?? '—'} tone={statusTone(ev.status)} />
                  <DetailCell label={T.col_phone} value={ev.last_phone_masked ?? '—'} tone="muted" />
                  <DetailCell label={T.dash_retry_count} value={String(ev.retry_count)} tone="muted" />
                  <DetailCell label={T.dash_contact_index} value={String(ev.contact_index + 1)} tone="muted" />
                </div>

                <div className="mt-2.5 flex flex-wrap gap-2.5">
                  <p className="min-w-0 flex-1 basis-[260px] rounded-control border border-dashed border-line bg-surface px-3 py-2.5 text-caption text-ink-2">
                    {T.dash_spoken}: {ev.message}
                  </p>
                  <Btn variant="ghost" className="py-2.5" onClick={() => navigate('/history')}>
                    {T.dash_view_all}
                  </Btn>
                </div>

                {ev.last_detail ? (
                  <p className="mt-2.5 text-caption leading-[1.8] text-ink-2">{ev.last_detail}</p>
                ) : null}
              </div>
            ) : null}
          </div>
        ))}
      </Card>
    </div>
  );
}

/* ── คิวแบบเรียลไทม์ ─────────────────────────────────────────────────────── */

function LiveQueue({ items }: { items: QueueStatusItem[] }) {
  const { T } = useApp();
  const shown = items.slice(0, 6);

  return (
    <Card className="flex min-w-0 flex-col p-5">
      <div className="mb-3 flex items-center gap-2">
        <Dot tone={items.length > 0 ? 'accent' : 'ok'} pulse />
        <span className="text-caption font-bold">{T.ov_live_queue}</span>
        <span className="ms-auto font-mono text-micro text-ink-2">
          {items.length} {T.ov_jobs}
        </span>
      </div>

      {items.length === 0 ? (
        <p className="flex-1 rounded-control border border-dashed border-line px-4 py-8 text-center text-caption text-ink-2">
          {T.ov_queue_empty}
        </p>
      ) : (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2 px-2.5 font-mono text-micro text-ink-2">
            <span className="w-5 shrink-0">#</span>
            <span className="min-w-0 flex-1">{T.ov_col_name_phone}</span>
            <span className="w-[92px] shrink-0 text-end">{T.col_status}</span>
            <span className="w-[46px] shrink-0 text-end">{T.ov_col_time}</span>
          </div>

          {shown.map((job, i) => (
            <div
              key={job.job_id}
              className="flex items-center gap-2 rounded-control border border-line-2 bg-surface-2 px-2.5 py-2"
            >
              <span className="w-5 shrink-0 font-mono text-micro font-bold text-ink-2">{i + 1}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-caption font-semibold">{job.priority_group}</span>
                <span className="block font-mono text-micro text-ink-2">#{job.job_id}</span>
              </span>
              <span className="flex w-[92px] shrink-0 justify-end">
                <StatusBadge status={job.status as CallStatus} />
              </span>
              <span className="w-[46px] shrink-0 text-end font-mono text-micro text-ink-2">
                {new Date(job.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>
          ))}

          {items.length > shown.length ? (
            <p className="px-2.5 pt-1 font-mono text-micro text-ink-2">+{items.length - shown.length}</p>
          ) : null}
        </div>
      )}
    </Card>
  );
}

/* ── สุขภาพระบบ (เกจวงแหวน) ─────────────────────────────────────────────── */

/** เลือกสีตามระดับ — ค่ายิ่งสูงยิ่งอันตรายสำหรับ CPU/RAM/อุณหภูมิ */
function healthTone(pct: number | null): string {
  if (pct == null) return 'var(--ink-2-solid)';
  if (pct >= 85) return 'var(--bad)';
  if (pct >= 70) return 'var(--warn)';
  return 'var(--ok)';
}

function SystemHealth({ pi }: { pi: PiDetail | null }) {
  const { T } = useApp();

  // อุณหภูมิไม่ใช่เปอร์เซ็นต์ — ตีเป็นสเกล 0-100 โดยให้ 85°C เป็นเพดาน
  // (Pi เริ่ม throttle ที่ 80-85°C จึงเป็นจุดที่ควรเห็นว่า "แดง" พอดี)
  const tempPct = pi?.cpu_temp_c != null ? Math.min(100, (pi.cpu_temp_c / 85) * 100) : null;

  const gauges = [
    { label: 'CPU', pct: pi?.cpu_percent ?? null, text: pi?.cpu_percent?.toFixed(1) ?? '—', unit: '%' },
    { label: 'RAM', pct: pi?.mem_percent ?? null, text: pi?.mem_percent?.toFixed(1) ?? '—', unit: '%' },
    { label: T.ov_temp, pct: tempPct, text: pi?.cpu_temp_c?.toFixed(0) ?? '—', unit: '°C' },
  ];

  return (
    <Card className="min-w-0 p-4">
      <div className="mb-4 flex items-center gap-2">
        <span className="text-caption font-bold">{T.ov_health}</span>
        <span className="ms-auto">
          <Dot tone={pi ? 'ok' : 'muted'} pulse={!!pi} />
        </span>
      </div>

      <div className="flex items-center justify-around gap-2">
        {gauges.map((g) => (
          <div key={g.label} className="flex flex-col items-center gap-2">
            <span className="relative block" style={{ width: 84, height: 84 }}>
              <GaugeRing pct={g.pct} color={healthTone(g.pct)} size={84} />
              <span className="absolute inset-0 flex flex-col items-center justify-center">
                <span
                  className="text-lead leading-none font-bold"
                  style={{ color: g.pct == null ? 'rgb(var(--ink-2))' : healthTone(g.pct) }}
                >
                  {g.text}
                </span>
                <span className="mt-0.5 font-mono text-[9px] text-ink-2">{g.unit}</span>
              </span>
            </span>
            <span className="text-micro font-medium text-ink-2">{g.label}</span>
          </div>
        ))}
      </div>

      <div className="mt-3 flex justify-center gap-4">
        {[
          ['var(--ok)', T.ov_health_ok],
          ['var(--warn)', T.ov_health_high],
          ['var(--bad)', T.ov_health_critical],
        ].map(([color, label]) => (
          <span key={label} className="flex items-center gap-1">
            <span className="block rounded-full" style={{ width: 6, height: 6, background: color }} />
            <span className="text-micro text-ink-2">{label}</span>
          </span>
        ))}
      </div>
    </Card>
  );
}

/** วงแหวนความคืบหน้า — pct = null คือ "อ่านค่าไม่ได้" วาดเป็นรางเปล่า ไม่ใช่ 0% */
function GaugeRing({ pct, color, size = 84, stroke = 9 }: { pct: number | null; color: string; size?: number; stroke?: number }) {
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const dash = ((pct ?? 0) / 100) * circ;
  const c = size / 2;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: 'rotate(-90deg)' }} aria-hidden="true">
      <circle cx={c} cy={c} r={r} fill="none" stroke="rgb(var(--surface-2))" strokeWidth={stroke} />
      {pct != null ? (
        <circle
          cx={c}
          cy={c}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circ}`}
          style={{ transition: 'stroke-dasharray 1.2s cubic-bezier(0.4,0,0.2,1)' }}
        />
      ) : null}
    </svg>
  );
}

/* ── ชิ้นเล็ก ────────────────────────────────────────────────────────────── */

function StatRow({ label, value, tone }: { label: string; value: string; tone?: 'ok' }) {
  return (
    <span className="flex items-center justify-between">
      <span className="text-micro text-ink-2">{label}</span>
      <span className={cn('font-mono text-micro font-semibold', tone === 'ok' ? 'text-ok-strong' : 'text-ink')}>
        {value}
      </span>
    </span>
  );
}

function DetailCell({ label, value, tone }: { label: string; value: string; tone: Tone }) {
  return (
    <div
      className={cn(
        'min-w-0 flex-1 basis-[132px] rounded-control border border-line border-s-[3px] bg-surface px-2.5 py-2',
        tone === 'ok' && 'border-s-ok',
        tone === 'warn' && 'border-s-warn',
        tone === 'bad' && 'border-s-bad',
        tone === 'accent' && 'border-s-brand',
        tone === 'muted' && 'border-s-line',
      )}
    >
      <p className="text-micro font-semibold">{label}</p>
      {/* ค่าที่มาจาก backend เช่น last_result อาจยาวและไม่มีช่องว่างให้ตัดบรรทัด */}
      <p className="font-mono text-micro break-words text-ink-2">{value}</p>
    </div>
  );
}
