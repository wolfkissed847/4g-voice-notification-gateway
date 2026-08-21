/**
 * DashboardPage — หน้าภาพรวม
 *
 * พอร์ตผังจาก figma/Redesign Corporate Web App (PageOverview) บนข้อมูลจริงทั้งหมด
 *
 *   แถว 1  ตัวเลขสรุป 6 ช่อง
 *   แถว 2  Signal Flow | คิวแบบเรียลไทม์
 *   แถว 3  สุขภาพระบบ (เกจวงแหวน) | อุปกรณ์ & key | กราฟ 24 ชม.
 *
 * ทั้งหน้าต้องพอดีจอเดียวโดยไม่ต้องเลื่อน — เป็นหน้าที่เปิดค้างไว้ดู ถ้าต้องเลื่อน
 * จะมีของบางส่วนที่ไม่มีวันถูกเห็นเลยตอนเกิดเหตุ ซึ่งขัดกับเหตุผลที่หน้านี้มีอยู่
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
 * 4. ปุ่ม "เพิ่มอุปกรณ์" ของดีไซน์ยังไม่ได้ต่อ ของเราพาไปหน้าตั้งค่าอุปกรณ์จริง
 *
 * เคยมีแถว "กิจกรรมล่าสุด" ที่กางดูผลการโทรรายครั้งได้ ถอดออกแล้ว — กินความสูงจนหน้า
 * ต้องเลื่อน และข้อมูลชุดเดียวกันดูได้ครบกว่าที่หน้าประวัติการโทรอยู่แล้ว
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
import { Btn, Card, Dot, PageHeader, Pill, StatTile } from '../components/primitives';
import { StatusBadge } from '../components/StatusBadge';
import { useApp } from '../context/AppContext';
import { countReady, readiness } from '../lib/deviceReadiness';
import { operatorName } from '../lib/operator';
import { SignalFlowMonitor } from '../widgets/SignalFlowMonitor';
import type { ApiKey, CallStatus, GsmDetail, HistoryItem, PiDetail, QueueStatusItem } from '../types';

const REFRESH_MS = 5_000;

/** สถานะที่ถือว่าจบแบบสำเร็จ / แบบล้มเหลว — ใช้ยิงนับแยกฝั่ง server ผ่าน total_count */
const OK_STATUSES = ['connected'] as const;
const BAD_STATUSES = ['failed'] as const;

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
  const [todayItems, setTodayItems] = useState<HistoryItem[]>([]);
  const [callsToday, setCallsToday] = useState<number | null>(null);
  const [okToday, setOkToday] = useState<number | null>(null);
  const [badToday, setBadToday] = useState<number | null>(null);
  const [pending, setPending] = useState<number | null>(null);
  const [queueItems, setQueueItems] = useState<QueueStatusItem[]>([]);
  const [devices, setDevices] = useState<ApiKey[]>([]);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      const dateFrom = midnightIso();
      const [gsmDetail, piDetail, queue, keys, todayAll, ...counts] = await Promise.all([
        getGsmDetail(),
        getPiDetail(),
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

  const readyDevices = countReady(devices, T);

  return (
    /* min-h-full ไม่ใช่ h-full — ตั้งใจให้ "พอดีจอเดียวถ้าพอดีได้ ถ้าไม่พอก็ยืดแล้วเลื่อนตามปกติ"
       h-full ตรึงกล่องไว้เท่าความสูงจอเป๊ะ แต่แถวการ์ดข้างในเป็น shrink-0 (ห้ามบีบ) พอรวมกัน
       สูงเกินจอ มันจึงล้นออกนอกกล่องที่ตรึงไว้ — แล้วพื้นที่ที่เลื่อนได้ถูกคิดจากของที่ล้น
       ไม่ใช่จากตัวกล่อง ทำให้ padding ล่างของ <main> ไม่มีผล การ์ดแถวสุดท้ายเลยไปแปะ
       ติดขอบหน้าต่างพอดีเหมือนถูกตัด
       min-h-full กล่องจะโตตามเนื้อหาจริง padding ล่างจึงกลับมาทำงาน */
    <div className="flex min-h-full flex-col gap-3">
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
          จึงสูงตามเนื้อหาของตัวเอง ได้ขอบล่างไม่ตรงกันเป็นขั้นบันได

          flex-1: แถวนี้เป็นแถวเดียวที่ "ยืดได้" — กินความสูงที่เหลือจากแถวอื่น
          ไม่ใช่สูงตามเนื้อหาข้างใน นี่คือจุดที่ตรึงความสูงของการ์ดคิวไว้จริงๆ
          (ใส่ overflow ในการ์ดอย่างเดียวไม่พอ ถ้าแถวยังโตตามเนื้อหาได้อยู่
           การ์ดก็โตตามแถว แล้วไม่มีอะไรล้นให้ต้องเลื่อนตั้งแต่แรก)

          shrink-0 ไม่ใช่ flex-1: เคยให้แถวนี้กินที่ว่างที่เหลือทั้งหมด ซึ่งตรึงความสูง
          ได้จริงแต่บนจอสูงๆ กลายเป็นการ์ดยาวเกินจำเป็น รายการไม่กี่บรรทัดลอยอยู่ในกล่องสูงๆ
          ตอนนี้ให้สูงเท่าที่เนื้อหาต้องการ แล้วคุมความยาวที่ตัวรายการแทน (ดู max-h) */}
      <div className="grid shrink-0 items-stretch gap-4 xl:grid-cols-2">
        <SignalFlowMonitor />
        <LiveQueue items={queueItems} />
      </div>

      {/* ── แถว 3: สุขภาพระบบ | อุปกรณ์ | กราฟ 24 ชม. ───────────────────── */}
      {/* shrink-0: เกจกับกราฟมีความสูงที่พอดีของมันอยู่แล้ว บีบแล้วอ่านไม่ออก
          จึงให้แถวนี้ได้ความสูงตามเนื้อหา แล้วปล่อยที่เหลือทั้งหมดให้แถว 2 */}
      <div className="grid shrink-0 items-stretch gap-4 lg:grid-cols-2 xl:grid-cols-3">
        <SystemHealth pi={pi} />

        {/* min-h-0 + overflow ในตัวรายการ = การ์ดสูงเท่าเดิมไม่ว่าจะมีกี่อุปกรณ์
            ถ้าปล่อยให้ยาวตามจำนวน การ์ดใบนี้จะกลายเป็นใบที่สูงที่สุดในแถว
            แล้วลากอีกสองใบให้สูงตาม (items-stretch) ทั้งหน้าก็เลื่อนขึ้นลง */}
        <Card className="flex min-h-0 min-w-0 flex-col p-4">
          <h3 className="mb-3 shrink-0 text-caption font-bold">{T.devices_title}</h3>
          {/* ความสูงตายตัว = 4 บรรทัดพอดี เหตุผลเดียวกับกล่องคิว: หน้าภาพรวมตอบแค่ว่า
              "มีเครื่องไหนตั้งค่าไม่ครบจนโทรไม่ออกมั้ย" การไล่ดูครบ 19 ตัวเป็นงานของหน้าตั้งค่าอุปกรณ์ */}
          {devices.length === 0 ? (
            <p className="flex-1 text-caption text-ink-2">{T.devices_empty_title}</p>
          ) : (
            <ul className="h-[7.25rem] space-y-2.5 overflow-y-auto overscroll-contain">
              {/* จุดสีบอก "ความพร้อม" ไม่ใช่ online/offline — อุปกรณ์ไม่ได้ ping เข้ามาเรื่อยๆ
                  จึงวัดจากเวลาที่ยิงล่าสุดไม่ได้ (ดูเหตุผลเต็มที่ lib/deviceReadiness.ts)
                  ใช้ตัวเดียวกับหน้าอุปกรณ์ เครื่องเดียวกันจะได้ไม่เป็นคนละสถานะในสองหน้า */}
              {devices.map((d) => {
                const ready = readiness(d, T);
                return (
                  <li key={d.id} className={cn('flex items-center gap-2.5', ready.tone === 'muted' && 'opacity-60')}>
                    <Dot tone={ready.tone} />
                    <span className="min-w-0 flex-1 truncate text-caption font-medium">{d.name}</span>
                    <span className="font-mono text-micro whitespace-nowrap text-ink-2">{d.key_prefix}…</span>
                  </li>
                );
              })}
            </ul>
          )}

          <div className="mt-3 flex shrink-0 flex-col gap-1.5 border-t border-line-2 pt-3">
            <StatRow label={T.devices_title} value={String(devices.length)} />
            {/* "พร้อมใช้งาน" แทน "เพิ่งส่งข้อมูล" — ตัวเลขเดิมขึ้น 0 เกือบตลอดเวลาเพราะนับ
                เครื่องที่ยิงเข้ามาใน 15 นาทีล่าสุด ซึ่งปกติแล้วไม่มีเลย (ไม่มีเหตุให้แจ้ง)
                เตือนสีเมื่อมีเครื่องที่ยังไม่พร้อม เพราะนั่นคือเรื่องที่ต้องไปทำอะไรสักอย่าง */}
            <StatRow
              label={T.device_ready}
              value={`${readyDevices} / ${devices.length}`}
              tone={devices.length > 0 && readyDevices < devices.length ? 'warn' : 'ok'}
            />
          </div>
        </Card>

        {/* flex-col + flex-1 ที่แท่งกราฟ = กราฟสูงเท่าที่การ์ดเหลือให้จริง
            เดิมตรึงไว้ที่ 70px แล้วปล่อยที่ว่างใต้กล่องสรุปทิ้งไปเฉยๆ ทั้งที่กราฟ
            เป็นของชิ้นเดียวในการ์ดนี้ที่ "ยิ่งสูงยิ่งอ่านง่าย" */}
        <Card className="flex min-w-0 flex-col p-4">
          <div className="mb-3 flex shrink-0 items-baseline gap-2">
            <h3 className="text-caption font-bold">{T.dash_calls_24h}</h3>
            {/* ค่าสูงสุดของแกน — ถ้าไม่มี ความสูงของแท่งบอกได้แค่ "อันไหนมากกว่า"
                ไม่ได้บอกว่ากี่สาย แล้วตัวเลขจริงจะถูกขังไว้หลัง tooltip อย่างเดียว */}
            <span className="ms-auto font-mono text-micro tabular-nums text-ink-2">
              {T.ov_axis_max(hourlyMax)}
            </span>
          </div>

          {/* แท่งกราฟ: มนเฉพาะปลายบน ตีนแท่งตัดตรงติดเส้นฐาน — ปลายมนทั้งสองด้าน
              ทำให้แท่งเตี้ยๆ ดูลอยไม่ติดฐาน อ่านความยาวผิด
              ชั่วโมงที่ไม่มีสายไม่วาดแท่ง เหลือแค่ขีดจางที่เส้นฐาน — ของเดิมบังคับ
              ความสูงขั้นต่ำ 6px ให้ทุกแท่ง ซึ่งแปลว่า "0 สาย" กับ "1 สาย" หน้าตาเหมือนกัน */}
          <div className="flex min-h-[4.375rem] flex-1 items-end gap-[2px] border-b border-line pb-px">
            {/* ทุกแท่งใช้สีเต็มเท่ากันหมด ไม่ได้จางแท่งที่ไม่ใช่พีคลง
                เคยลองจางไว้ที่ 45% เพื่อเน้นชั่วโมงพีค แต่วัดแล้วคอนทราสต์กับพื้นการ์ด
                เหลือ 2.59:1 บนพื้นมืด และ 1.93:1 บนพื้นสว่าง (เกณฑ์มาร์คของกราฟคือ 3:1)
                = แท่งเตี้ยๆ แทบมองไม่เห็น ซึ่งแย่กว่าการไม่เน้นพีคเลย
                ชั่วโมงพีคมีบรรทัดสรุปข้างล่างบอกอยู่แล้วว่ากี่โมงกี่สาย */}
            {hourly.map((count, i) => (
              <span
                key={i}
                title={T.ov_hour_calls(`${String(i).padStart(2, '0')}:00`, count)}
                className={cn('min-w-0 flex-1 rounded-t transition-all', count === 0 ? 'bg-line' : 'bg-brand')}
                style={{ height: count === 0 ? 2 : `${Math.max(4, (count / hourlyMax) * 100)}%` }}
              />
            ))}
          </div>
          <div className="mt-1.5 flex shrink-0 justify-between font-mono text-micro text-ink-2">
            <span>00:00</span>
            <span>12:00</span>
            <span>23:00</span>
          </div>

          <div className="mt-3 flex shrink-0 items-center justify-between rounded-control bg-surface-2 px-3 py-2">
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
    </div>
  );
}

/* ── คิวแบบเรียลไทม์ ─────────────────────────────────────────────────────── */

function LiveQueue({ items }: { items: QueueStatusItem[] }) {
  const { T } = useApp();

  return (
    /* การ์ดนี้ต้องสูงเท่าเดิมเสมอ ไม่ว่าคิวจะมีกี่งาน — คิวยาวให้เลื่อนในกล่องเอา
       เดิมตัดเหลือ 6 งานแล้วเขียน "+N" ต่อท้าย ซึ่งงานที่เกินมาก็หายไปเฉยๆ ดูไม่ได้เลย
       ตอนนี้ใส่ครบทุกงานแล้วให้เลื่อนดู กล่องยังสูงเท่าเดิมและเห็นของครบ */
    <Card className="flex min-h-0 min-w-0 flex-col p-5">
      <div className="mb-3 flex shrink-0 items-center gap-2">
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
        <div className="flex min-h-0 flex-1 flex-col gap-1.5">
          <div className="flex shrink-0 items-center gap-2 px-2.5 font-mono text-micro text-ink-2">
            <span className="w-5 shrink-0">#</span>
            <span className="min-w-0 flex-1">{T.ov_col_name_phone}</span>
            <span className="w-[5.375rem] shrink-0 text-end">{T.col_status}</span>
            <span className="w-[2.875rem] shrink-0 text-end">{T.ov_col_time}</span>
          </div>

          {/* h-0 ด้วยเหตุผลเดียวกับรายการอุปกรณ์ในแถว 3

              แต่ละงานเป็นบรรทัดเดียว ไม่ใช่การ์ดย่อยที่มีกรอบ+พื้นของตัวเองแบบเดิม
              ของเดิมกินใบละ ~54px เพราะซ้อนชื่อกลุ่มกับเลขงานเป็นสองบรรทัด
              ทั้งที่เลขงานเป็นตัวเล็กๆ ที่ต่อท้ายชื่อในบรรทัดเดียวกันได้สบาย
              เหลือ ~30px = เห็นงานได้เท่าตัวในกล่องขนาดเท่าเดิม

              ความสูงตายตัว = 5 บรรทัดพอดี ที่เหลือเลื่อนดู (แถวละ 2.25rem)
              เป็นความสูงตายตัวไม่ใช่ max-h เพราะ max-h อย่างเดียวยังปล่อยให้การ์ดเตี้ยกว่า
              5 บรรทัดได้ถ้าการ์ดข้างๆ เตี้ยกว่า (แถวนี้ items-stretch สูงตามใบที่สูงสุด)
              — ผลคือบางจอเห็น 3 บรรทัดครึ่ง ทั้งที่ตั้งใจให้เห็น 5

              หน่วยเป็น rem ไม่ใช่ px: แถวสูงตามตัวอักษรซึ่งโตตามจอ (ดู html font-size
              ใน theme.css) ถ้าตรึงความสูงกล่องเป็น px ไว้ พอจอใหญ่แถวจะสูงขึ้นแต่กล่องเท่าเดิม
              = เห็น 4 บรรทัดครึ่งบนจอ 24" ทั้งที่จอ 14" เห็น 5 พอดี

              คิวยาวได้ไม่จำกัด แต่หน้าภาพรวมต้องการแค่ "ตอนนี้มีอะไรค้างอยู่บ้าง"
              การไล่ดูทั้งคิวเป็นงานของหน้าคิวการโทรซึ่งมีตารางเต็มอยู่แล้ว */}
          <div className="h-[11.25rem] overflow-y-auto overscroll-contain">
            {items.map((job, i) => (
              <div
                key={job.job_id}
                className="flex items-center gap-2 border-b border-line-2 px-2.5 py-1.5 last:border-b-0"
              >
                <span className="w-5 shrink-0 font-mono text-micro text-ink-2">{i + 1}</span>
                <span className="min-w-0 flex-1 truncate text-caption font-medium">
                  {job.priority_group}
                  <span className="ms-1.5 font-mono text-micro text-ink-2">#{job.job_id}</span>
                </span>
                {/* ย่อป้ายลงเฉพาะในการ์ดนี้ (ไม่แตะ StatusBadge ตัวจริง เพราะตารางคิว
                    กับหน้าประวัติใช้ตัวเดียวกัน ที่นั่นป้ายคือข้อมูลหลักของแถว ต้องอ่านง่ายไว้ก่อน)
                    — ที่นี่แต่ละงานเป็นบรรทัดเดียว ป้ายขนาดเต็มสูงเกือบเท่าแถว
                    เลยกลายเป็นของที่ดังที่สุดในการ์ดทั้งที่ชื่อกลุ่มควรมาก่อน */}
                <span className="flex w-[5.375rem] shrink-0 justify-end [&>span]:px-2 [&>span]:py-0 [&>span]:text-[0.6875rem]">
                  <StatusBadge status={job.status as CallStatus} />
                </span>
                {/* hour12: false — ปล่อยตาม locale เครื่องจะได้ "08:49 AM" ซึ่งยาวเกินช่อง 2.875rem
                    แล้วตกบรรทัดเป็นสองแถว ดันความสูงของทุกแถวจาก 35px เป็น 51px
                    (ทั้งกล่องเลยเห็นน้อยลงจาก 6 งานเหลือ 4) แบบ 24 ชั่วโมงพอดีบรรทัดเดียว
                    และตรงกับที่คนไทยอ่านเวลาอยู่แล้ว */}
                <span className="w-[2.875rem] shrink-0 text-end font-mono text-micro text-ink-2">
                  {new Date(job.created_at).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                    hour12: false,
                  })}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

/* ── สุขภาพระบบ (เกจวงแหวน) ─────────────────────────────────────────────── */

/**
 * ระดับสุขภาพ → สีและชื่อสถานะ (ค่ายิ่งสูงยิ่งอันตรายสำหรับ CPU/RAM/อุณหภูมิ)
 *
 * ต้องคืน "ชื่อ" มาด้วยเสมอ ไม่ใช่แค่สี — สีเตือน (ส้ม) กับสีวิกฤต (แดง) ของธีมนี้
 * ห่างกันแค่ ΔE 13 สำหรับคนสายตาปกติ และเหลือ 3.4 สำหรับคนตาบอดสีเขียว-แดง
 * (วัดด้วยตัวตรวจของ dataviz skill) = แยกไม่ออกด้วยสีอย่างเดียว
 * กฎของสีบอกสถานะคือต้องมีข้อความหรือไอคอนกำกับเสมอ ห้ามใช้สีลอยๆ
 */
type HealthLevel = { color: string; key: 'ok' | 'high' | 'critical' | 'unknown' };

/** จุดตัดของแต่ละระดับ — ประกาศไว้ที่เดียวเพราะคำอธิบายท้ายการ์ดอ้างตัวเลขชุดนี้ด้วย
 *  ถ้าแยกกันเขียน วันหนึ่งจะมีเกจที่เป็นสีส้มทั้งที่คำอธิบายบอกว่ายังไม่ถึงเกณฑ์ */
const HEALTH_HIGH = 70;
const HEALTH_CRITICAL = 85;

function healthLevel(pct: number | null): HealthLevel {
  if (pct == null) return { color: 'var(--ink-2-solid)', key: 'unknown' };
  if (pct >= HEALTH_CRITICAL) return { color: 'var(--bad)', key: 'critical' };
  if (pct >= HEALTH_HIGH) return { color: 'var(--warn)', key: 'high' };
  return { color: 'var(--ok)', key: 'ok' };
}

function SystemHealth({ pi }: { pi: PiDetail | null }) {
  const { T } = useApp();

  // อุณหภูมิไม่ใช่เปอร์เซ็นต์ — ตีเป็นสเกล 0-100 โดยให้ 85°C เป็นเพดาน
  // (Pi เริ่ม throttle ที่ 80-85°C จึงเป็นจุดที่ควรเห็นว่า "แดง" พอดี)
  const tempPct = pi?.cpu_temp_c != null ? Math.min(100, (pi.cpu_temp_c / 85) * 100) : null;

  /* คำอธิบายท้ายการ์ด วางแบบเดียวกับแถบคำอธิบายสีของการ์ดติดตามสัญญาณ (จุด + ข้อความ
     เรียงแนวนอน) สองใบนี้อยู่หน้าเดียวกัน ใช้วิธีอธิบายสีเหมือนกันจะได้ไม่ต้องเรียนสองแบบ

     บอกช่วงตัวเลขด้วย ไม่ใช่แค่ชื่อสี — ชื่อระดับมีกำกับที่เกจแต่ละอันอยู่แล้ว
     สิ่งที่ยังไม่มีใครบอกคือ "ทำไมอันนี้ถึงเป็นสีส้ม" ซึ่งตอบด้วยเกณฑ์เท่านั้น */
  const scale = [
    { color: 'var(--ok)', label: T.ov_health_scale_ok(HEALTH_HIGH) },
    { color: 'var(--warn)', label: T.ov_health_scale_high(HEALTH_HIGH, HEALTH_CRITICAL - 1) },
    { color: 'var(--bad)', label: T.ov_health_scale_critical(HEALTH_CRITICAL) },
  ];

  const levelText: Record<HealthLevel['key'], string> = {
    ok: T.ov_health_ok,
    high: T.ov_health_high,
    critical: T.ov_health_critical,
    unknown: '—',
  };

  const gauges = [
    {
      label: 'CPU',
      pct: pi?.cpu_percent ?? null,
      text: pi?.cpu_percent?.toFixed(1) ?? '—',
      unit: '%',
    },
    {
      label: 'RAM',
      pct: pi?.mem_percent ?? null,
      text: pi?.mem_percent?.toFixed(1) ?? '—',
      unit: '%',
    },
    {
      label: T.ov_temp,
      pct: tempPct,
      text: pi?.cpu_temp_c?.toFixed(0) ?? '—',
      unit: '°C',
    },
  ];

  return (
    <Card className="flex min-w-0 flex-col p-4">
      <div className="mb-4 flex shrink-0 items-center gap-2">
        <span className="text-caption font-bold">{T.ov_health}</span>
        <span className="ms-auto">
          <Dot tone={pi ? 'ok' : 'muted'} pulse={!!pi} />
        </span>
      </div>

      {/* วงแหวนสามวงเรียงกัน — ตอนที่การ์ดยังสูงเต็มคอลัมน์ รูปทรงกลมเว้นที่ว่างบน-ล่าง
          ค้างไว้เสมอ แต่ตอนนี้แถวสูงตามเนื้อหาแล้ว ความสูงของการ์ดพอดีกับวงแหวนอยู่แล้ว */}
      <div className="flex flex-1 items-center justify-around gap-2">
        {gauges.map((g) => {
          const level = healthLevel(g.pct);
          return (
            <div key={g.label} className="flex flex-col items-center gap-1.5">
              <span className="relative block" style={{ width: 84, height: 84 }}>
                <GaugeRing pct={g.pct} color={level.color} size={84} />
                {/* ตัวเลขเยื้องขึ้นเล็กน้อย ไม่ใช่กึ่งกลางเป๊ะ — ส่วนโค้งเปิดด้านล่าง
                    จุดที่ "ดูเหมือนกลาง" ของรูปทรงจึงอยู่สูงกว่ากลางกล่องจริง

                    ตัวเลขใช้สีตัวอักษรปกติ ไม่ใช่สีตามระดับ — สีเป็นหน้าที่ของวงแหวน
                    ย้อมตัวเลขด้วยคือบอกเรื่องเดียวกันสองรอบ แล้วเลขสีอ่อนก็อ่านยากกว่า */}
                <span className="absolute inset-0 flex flex-col items-center justify-center pb-1.5">
                  <span className="text-lead leading-none font-semibold">{g.text}</span>
                  {g.pct == null ? null : (
                    <span className="mt-1 font-mono text-[9px] text-ink-2">{g.unit}</span>
                  )}
                </span>
              </span>
              <span className="text-micro font-medium text-ink-2">{g.label}</span>
              {/* ชื่อระดับใต้เกจ = ช่องทางที่สองนอกจากสี (ดูเหตุผลที่ healthLevel)
                  ค่าที่อ่านไม่ได้ไม่ต้องมีบรรทัดนี้ — ตัวเลขข้างบนขึ้น "—" อยู่แล้ว */}
              {level.key === 'unknown' ? null : (
                <span className="flex items-center gap-1">
                  <span
                    className="block size-1.5 shrink-0 rounded-full"
                    style={{ background: level.color }}
                    aria-hidden="true"
                  />
                  <span className="text-[10px] leading-none text-ink-2">{levelText[level.key]}</span>
                </span>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-3 flex shrink-0 flex-wrap gap-x-4 gap-y-1 border-t border-line-2 pt-2.5">
        {scale.map((sc) => (
          <span key={sc.label} className="flex items-center gap-1.5">
            <span
              className="block shrink-0 rounded-full"
              style={{ width: 7, height: 7, background: sc.color }}
              aria-hidden="true"
            />
            <span className="text-micro text-ink-2">{sc.label}</span>
          </span>
        ))}
      </div>
    </Card>
  );
}

/** วงแหวนความคืบหน้า — pct = null คือ "อ่านค่าไม่ได้" วาดเป็นรางเปล่า ไม่ใช่ 0% */
/**
 * เกจวงแหวน — เปิดเป็นส่วนโค้ง 270° ไม่ใช่วงกลมปิด
 *
 * วงกลมปิดอ่านยากตรงที่ "เต็มวง" กับ "ว่างทั้งวง" หน้าตาต่างกันแค่สี ไม่มีจุดเริ่ม-จุดจบ
 * ให้สายตาเกาะ พอเป็นส่วนโค้งที่มีช่องว่างด้านล่าง จะเห็นทันทีว่าเข็มเดินมาถึงไหนแล้ว
 * ในสเกลที่มีปลายทั้งสองข้าง — เป็นวิธีอ่านแบบเดียวกับหน้าปัดวัดที่คนคุ้นอยู่แล้ว
 *
 * pathLength={100} คือหัวใจ: บังคับให้เส้นรอบวงถูกนับเป็น 100 หน่วยเสมอ ไม่ว่ารัศมีจริง
 * เท่าไหร่ dasharray จึงเขียนเป็นเปอร์เซ็นต์ตรงๆ ได้ ไม่ต้องคูณ 2πr เอง
 * (270° = 75 หน่วยจาก 100 — ค่าที่โชว์จึงคูณ 0.75)
 */
const GAUGE_SWEEP = 75; // 270° จาก 360°

function GaugeRing({
  pct,
  color,
  size = 84,
  stroke = 7,
}: {
  pct: number | null;
  color: string;
  size?: number;
  stroke?: number;
}) {
  const r = (size - stroke) / 2;
  const c = size / 2;
  const value = ((pct ?? 0) / 100) * GAUGE_SWEEP;

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      /* หมุน 135° = ช่องว่างของส่วนโค้งไปอยู่ด้านล่างพอดี (เริ่ม 7 นาฬิกา จบ 5 นาฬิกา) */
      style={{ transform: 'rotate(135deg)' }}
      aria-hidden="true"
    >
      {/* รางเป็นสีเดียวกับค่าแต่จางลง ไม่ใช่เทากลางๆ — ระดับความอันตรายจึงอ่านได้
          จากทั้งวงในแวบเดียว ไม่ใช่เฉพาะส่วนที่เติมแล้ว */}
      <circle
        cx={c}
        cy={c}
        r={r}
        fill="none"
        stroke={
          pct == null ? 'rgb(var(--line))' : `color-mix(in oklab, ${color} 18%, rgb(var(--surface-2)))`
        }
        strokeWidth={stroke}
        strokeLinecap="round"
        pathLength={100}
        strokeDasharray={`${GAUGE_SWEEP} ${100 - GAUGE_SWEEP}`}
      />
      {/* > 0 ไม่ใช่แค่ != null: ปลายเส้นเป็นแบบมน ค่า 0 จึงยังวาดเป็นจุดกลมเล็กๆ ค้างไว้
          ที่หัวราง ดูเหมือนจุดสกปรกบนหน้าจอมากกว่าจะสื่อว่า "ศูนย์" (เห็นชัดตอน CPU 0.0%) */}
      {pct != null && pct > 0 ? (
        <circle
          cx={c}
          cy={c}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          pathLength={100}
          strokeDasharray={`${value} 100`}
          style={{
            transition: 'stroke-dasharray 1.2s cubic-bezier(0.4,0,0.2,1), stroke 300ms ease',
            /* เรืองอ่อนๆ ให้เส้นค่าลอยขึ้นมาจากราง — ช่วยมากในโหมดมืดที่รางกับพื้นใกล้กัน
               ใช้ค่าน้อยไว้ ไม่งั้นในโหมดสว่างจะดูเบลอเหมือนภาพหลุดโฟกัส */
            filter: `drop-shadow(0 0 3px color-mix(in oklab, ${color} 45%, transparent))`,
          }}
        />
      ) : null}
    </svg>
  );
}

/* ── ชิ้นเล็ก ────────────────────────────────────────────────────────────── */

/** tone: warn = ตัวเลขนี้กำลังบอกว่ามีอะไรต้องไปจัดการ ไม่ใช่แค่รายงานจำนวน */
function StatRow({ label, value, tone }: { label: string; value: string; tone?: 'ok' | 'warn' }) {
  return (
    <span className="flex items-center justify-between">
      <span className="text-micro text-ink-2">{label}</span>
      <span
        className={cn(
          'font-mono text-micro font-semibold',
          tone === 'ok' ? 'text-ok-strong' : tone === 'warn' ? 'text-warn-strong' : 'text-ink',
        )}
      >
        {value}
      </span>
    </span>
  );
}
