/**
 * DashboardPage — พอร์ตจาก figma/handoff/components/DashboardPage.tsx
 * แทน OverviewPage เดิม
 *
 * ── ต่างจากดีไซน์ เพราะยึดข้อมูลจริงเท่านั้น ────────────────────────────────
 * 1. tile "เครดิตซิม" ตัดออก — ไม่มีแหล่งข้อมูล ต้องเช็คผ่าน USSD ซึ่ง backend
 *    ยังไม่ทำ (DEPLOYMENT_MODELS.md ข้อ 6) ใส่ "รอในคิว" จาก /queue/status แทน
 *    ซึ่งเป็นตัวเลขจริงและมีประโยชน์กว่าช่องว่างเปล่า
 * 2. แถวเหตุการณ์กางออกแล้ว ดีไซน์โชว์ 6 ขั้นพร้อม timestamp ต่อขั้น
 *    /history คืนแค่ last_result + last_phone_masked (1 แถวล่าสุด) ไม่ได้คืน call_logs ทั้งชุด
 *    จึงแสดงเท่าที่มีจริง + บอกตรงๆ ว่าต้องมี GET /history/{job_id} ก่อนจะครบตามดีไซน์
 *    — ไม่สร้างขั้นตอนปลอมขึ้นมาเติม
 * 3. prop `pipeline` ในต้นฉบับประกาศไว้แต่ไม่เคยถูก render (ดูไฟล์ต้นฉบับบรรทัด 31)
 *    จึงไม่ได้ทำตาม — pipeline counters อยู่ในรายการของใหม่ที่ต้องรอ backend
 * 4. กราฟ 24 ชม. นับจากรายการจริง แต่ /history จำกัด page_size 100
 *    จึงกำกับไว้ในหน้าว่านับจาก 100 รายการล่าสุดของวันนี้ ไม่ได้แสร้งว่าครบทุกสาย
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';

import { cn } from '@/app/components/ui/utils';
import { listApiKeys } from '../api/apiKeys';
import { getHistory } from '../api/history';
import { getQueueStatus } from '../api/queue';
import { getGsmDetail } from '../api/system';
import { Alert } from '../components/Alert';
import { Btn, Card, CardHead, Divider, Dot, PageHeader, Pill, StatTile, type Tone } from '../components/primitives';
import { useApp } from '../context/AppContext';
import { operatorName } from '../lib/operator';
import { PipelineNow } from '../widgets/PipelineNow';
import { SignalFlowMonitor } from '../widgets/SignalFlowMonitor';
import type { ApiKey, GsmDetail, HistoryItem } from '../types';

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
 * (0 = -113 dBm, 31 = -51 dBm) mockup แสดงเป็น dBm เพราะเป็นหน่วยที่ช่างอ่านแล้วเทียบได้ทันที
 * ต่างจากเลข 0-31 ที่ต้องแปลงในหัวก่อน
 */
function rssiToDbm(rssi: number | null): number | null {
  if (rssi == null) return null;
  return -113 + 2 * rssi;
}

/** RSSI ดิบ 0-31 จาก AT+CSQ → จำนวนขีด 0-4 */
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
  const [recent, setRecent] = useState<HistoryItem[]>([]);
  const [todayItems, setTodayItems] = useState<HistoryItem[]>([]);
  const [callsToday, setCallsToday] = useState<number | null>(null);
  const [okToday, setOkToday] = useState<number | null>(null);
  const [badToday, setBadToday] = useState<number | null>(null);
  const [pending, setPending] = useState<number | null>(null);
  const [devices, setDevices] = useState<ApiKey[]>([]);
  const [open, setOpen] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      const dateFrom = midnightIso();
      const [gsmDetail, history, queue, keys, todayAll, ...counts] = await Promise.all([
        getGsmDetail(),
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
      setRecent(history.items);
      setPending(queue.total_pending);
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
  const total = (okToday ?? 0) + (badToday ?? 0);
  const okPct = total > 0 ? Math.round(((okToday ?? 0) / total) * 100) : 0;

  // แบ่งสายวันนี้เป็นถัง 24 ชั่วโมง จากรายการจริงที่โหลดมาได้
  const hourly = Array.from({ length: 24 }, () => 0);
  todayItems.forEach((it) => {
    const h = new Date(it.created_at).getHours();
    hourly[h] += 1;
  });
  const hourlyMax = Math.max(1, ...hourly);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={T.overview_title}
        meta={T.dash_auto_refresh}
        action={
          <Btn variant="primary" onClick={() => navigate('/devices')}>
            + {T.add_device}
          </Btn>
        }
      />

      {gsm && !gsm.connected ? <Alert tone="bad" title={T.gsm_offline_note} /> : null}

      <div className="grid grid-cols-[repeat(auto-fit,minmax(168px,1fr))] gap-3">
        <StatTile
          label={T.dash_signal_4g}
          // แสดงค่าดิบ x/31 ตรงตามที่ AT+CSQ ตอบมา (ชุดเดียวกับหน้าระบบ) ส่วน dBm ที่คำนวณต่อ
          // ย้ายไปอยู่บรรทัดล่างแทน — เทียบ "15/31" ง่ายกว่าเลขติดลบสำหรับคนที่ไม่ได้ดูสเปกวิทยุ
          value={gsm?.signal_quality != null ? `${gsm.signal_quality}/31` : T.gsm_signal_unknown}
          foot={
            /* ขีดสัญญาณกับชื่อผู้ให้บริการแยกเป็นคนละก้อน + flex-wrap
               เดิมอยู่ก้อนเดียวกันแบบไม่ตัดบรรทัด ชื่อผู้ให้บริการยาวๆ เลยดันการ์ดกว้างเกิน */
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
                {gsm?.network_mode ? ` · ${gsm.network_mode}` : ''}
                {dbm != null ? ` · ${dbm} dBm` : ''}
              </span>
            </span>
          }
        />
        <StatTile label={T.stat_calls} value={callsToday ?? '—'} foot={T.stat_calls_sub} />
        <StatTile
          label={T.dash_success_fail}
          value={
            <>
              <span className="text-ok">{okToday ?? '—'}</span> / <span className="text-warn">{badToday ?? '—'}</span>
            </>
          }
          foot={
            <span className="block h-1.5 overflow-hidden rounded-full bg-warn-soft">
              <span className="block h-full bg-ok" style={{ width: `${okPct}%` }} />
            </span>
          }
        />
        <StatTile label={T.stat_queue} value={pending ?? '—'} foot={T.stat_queue_sub} />
      </div>

      <SignalFlowMonitor />

      <PipelineNow />

      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(300px,100%),1fr))] items-start gap-3.5">
        <Card className="col-span-full min-w-0 overflow-hidden xl:col-span-2">
          <CardHead
            title={T.recent_title}
            hint={T.dash_tap_row_hint}
            action={
              <button
                type="button"
                onClick={() => navigate('/history')}
                className="text-caption font-medium text-brand"
              >
                {T.dash_view_all} ›
              </button>
            }
          />

          {recent.length === 0 ? (
            <p className="px-4 py-6 text-caption text-ink-2">{T.dash_no_events}</p>
          ) : null}

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
                <span className="min-w-0 truncate font-mono text-caption text-ink-2">
                  {ev.event_type_display_name ?? ev.event_type_code ?? '—'}
                </span>
                <span className="ms-auto flex items-center gap-2">
                  <Pill tone={statusTone(ev.status)}>{ev.status}</Pill>
                  <span className="text-micro text-ink-2">{open === ev.job_id ? '▾' : '▸'}</span>
                </span>
              </button>

              {open === ev.job_id ? (
                <div className="border-b border-line bg-surface-2 px-4 pt-1 pb-4">
                  {/* flex-wrap + flex-1 basis: การ์ดตกบรรทัดใหม่เองบนจอแคบ */}
                  <div className="flex flex-wrap items-stretch gap-2">
                    <DetailCell label={T.dash_last_attempt} value={ev.last_result ?? '—'} tone={statusTone(ev.status)} />
                    <DetailCell label={T.key_prefix_label} value={ev.last_phone_masked ?? '—'} tone="muted" />
                    <DetailCell label={T.dash_retry_count} value={String(ev.retry_count)} tone="muted" />
                    <DetailCell label={T.dash_contact_index} value={String(ev.contact_index + 1)} tone="muted" />
                  </div>

                  <div className="mt-2.5 flex flex-wrap gap-2.5">
                    <p className="min-w-0 flex-1 basis-[260px] rounded-xl border border-dashed border-line bg-surface px-3 py-2.5 font-mono text-caption text-ink-2">
                      {T.dash_spoken}: {ev.message}
                    </p>
                    <div className="flex flex-wrap items-center gap-2">
                      <Btn variant="ghost" className="py-2.5" onClick={() => navigate('/history')}>
                        {T.dash_view_all}
                      </Btn>
                    </div>
                  </div>

                  <p className="mt-2.5 text-micro leading-[1.8] text-ink-2">{T.dash_detail_note}</p>
                </div>
              ) : null}
            </div>
          ))}
        </Card>

        <Card className="min-w-0 p-4">
          <h3 className="mb-3 text-lead font-bold">{T.devices_title}</h3>
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
                      {seen ? new Date(seen).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : T.never}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}

          <div className="my-4">
            <Divider />
          </div>

          <h3 className="mb-2.5 text-caption font-bold">{T.dash_calls_24h}</h3>
          <div className="flex h-[70px] items-end gap-[3px]">
            {hourly.map((count, i) => (
              <span
                key={i}
                title={`${String(i).padStart(2, '0')}:00 — ${count}`}
                className={cn('flex-1 rounded-sm', count > 0 ? 'bg-brand' : 'bg-line')}
                style={{ height: `${Math.max(6, (count / hourlyMax) * 100)}%` }}
              />
            ))}
          </div>
          <div className="mt-1.5 flex justify-between font-mono text-micro text-ink-2">
            <span>00:00</span>
            <span>12:00</span>
            <span>23:00</span>
          </div>
          <p className="mt-1.5 text-micro leading-[1.7] text-ink-2">{T.dash_hours_capped}</p>
        </Card>
      </div>
    </div>
  );
}

function DetailCell({ label, value, tone }: { label: string; value: string; tone: Tone }) {
  return (
    <div
      className={cn(
        'min-w-0 flex-1 basis-[132px] rounded-xl border border-line border-s-[3px] bg-surface px-2.5 py-2',
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
