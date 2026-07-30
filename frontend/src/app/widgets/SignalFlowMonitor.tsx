/**
 * SignalFlowMonitor — การ์ดแสดงเส้นทาง API → Pi → 4G → ปลายทาง ตามสถานะจริง
 * พอร์ตจาก figma/handoff/components/SignalFlowMonitor.tsx
 *
 * ── ต่างจากต้นฉบับ 3 จุด ────────────────────────────────────────────────────
 * 1. ต้นฉบับขับ animation ด้วย useDemoFlow() ที่นับ tick วนลูปเอง (ข้อมูลปลอม)
 *    ของเราคำนวณ state จริงจาก /queue/status + /system/gsm + /history
 *    และตัด dropdown "เลือก state เอง" ที่ท้ายการ์ดออก — เป็นเครื่องมือ demo ของดีไซน์
 *    ถ้าเหลือไว้ ผู้ใช้กดแล้วจะเข้าใจว่าสั่งระบบได้ ทั้งที่มันแค่เปลี่ยนภาพ
 *
 * 2. ต้นฉบับสลับได้ 6 layout (A Linear · B Circular · C Camera · D Step Flow · E Radar
 *    · F Timeline) — พอร์ต A (Linear) มาก่อนตามที่ README ของ handoff แนะนำเอง
 *    ("เริ่มจาก A อันเดียวก่อนก็ทำงานครบ") อีก 5 ตัวเป็นการนำเสนอข้อมูลชุดเดียวกัน
 *    ในรูปทรงต่างกัน เพิ่มทีหลังได้โดยไม่ต้องแตะ logic ข้อมูลเลย
 *    จึงยังไม่ใส่ปุ่มสลับ layout ไว้ เพราะจะมี 5 ปุ่มที่กดแล้วไม่มีอะไรเกิดขึ้น
 *
 * 3. substep (0-7) ของต้นฉบับคือ 8 ขั้นที่ไล่ทีละจังหวะ — backend เราไม่ได้รายงาน
 *    ว่างานอยู่ขั้นไหน จึง map หยาบๆ จากสถานะของงาน (ดู stateFromData)
 *    ถ้าต้องการไล่ทีละขั้นจริงต้องมี GET /history/{job_id} ที่คืน call_logs ทั้งชุด
 *    — บอกไว้ในการ์ดตรงๆ ไม่ทำ animation ปลอมให้ดูเหมือนมีข้อมูล
 */
import { useEffect, useState } from 'react';

import { cn } from '@/app/components/ui/utils';
import { getHistory } from '../api/history';
import { getQueueStatus } from '../api/queue';
import { getGsmDetail } from '../api/system';
import { useApp } from '../context/AppContext';
import type { HistoryItem, QueueStatusItem } from '../types';

export type FlowState = 'idle' | 'calling' | 'ringing' | 'success' | 'failed';
type NodeId = 'api' | 'pi' | 'antenna' | 'phone';
type Tone = 'muted' | 'accent' | 'warn' | 'ok' | 'bad';
type LayoutId = 'linear' | 'circular' | 'camera' | 'stepflow' | 'radar' | 'timeline';

const LAYOUTS: { id: LayoutId; abbr: string; label: string }[] = [
  { id: 'linear', abbr: 'A', label: 'Linear' },
  { id: 'circular', abbr: 'B', label: 'Circular' },
  { id: 'camera', abbr: 'C', label: 'Camera' },
  { id: 'stepflow', abbr: 'D', label: 'Step Flow' },
  { id: 'radar', abbr: 'E', label: 'Radar' },
  { id: 'timeline', abbr: 'F', label: 'Timeline' },
];

const LAYOUT_STORAGE_KEY = 'gateway_flow_layout';

const NODES: NodeId[] = ['api', 'pi', 'antenna', 'phone'];
/** substep ที่เส้นเชื่อมแต่ละช่วงเริ่มวิ่ง (0-7) */
const LINE_STEP = [1, 3, 5];
const NODE_STEP: Record<NodeId, number> = { api: 0, pi: 2, antenna: 4, phone: 6 };

const stateTone: Record<FlowState, Tone> = {
  idle: 'muted',
  calling: 'accent',
  ringing: 'warn',
  success: 'ok',
  failed: 'bad',
};

// brand แทน accent ตามกติกาใน src/styles/tw-theme.css
const toneText = { muted: 'text-ink-2', accent: 'text-brand', warn: 'text-warn', ok: 'text-ok', bad: 'text-bad' } as const;
const toneBorder = { muted: 'border-line', accent: 'border-brand', warn: 'border-warn', ok: 'border-ok', bad: 'border-bad' } as const;
const toneBg = { muted: 'bg-surface-2', accent: 'bg-brand-soft', warn: 'bg-warn-soft', ok: 'bg-ok-soft', bad: 'bg-bad-soft' } as const;
const toneFill = { muted: 'bg-ink-2', accent: 'bg-brand', warn: 'bg-warn', ok: 'bg-ok', bad: 'bg-bad' } as const;

const REFRESH_MS = 4000;

/**
 * แปลงข้อมูลจริงเป็น state + substep ของภาพ
 *
 * queued      → รับ payload แล้ว รอ worker หยิบ (ขั้นต้น)
 * in_progress → worker กำลังโทร (ไปถึงเสาสัญญาณ)
 * retrying / no_answer / busy / escalated → กำลังเรียกหรือรอ retry
 * งานล่าสุดที่จบแล้ว connected / sms_fallback_sent → สำเร็จ, failed → ล้มเหลว
 */
function stateFromData(
  pending: QueueStatusItem[],
  latest: HistoryItem | null,
  gsmConnected: boolean,
): { state: FlowState; substep: number } {
  const active = pending.find((j) => j.status === 'in_progress');
  if (active) return { state: 'calling', substep: gsmConnected ? 5 : 3 };

  const waiting = pending.find((j) => j.status === 'retrying' || j.status === 'escalated');
  if (waiting) return { state: 'ringing', substep: 7 };

  if (pending.length > 0) return { state: 'calling', substep: 1 };

  if (latest?.status === 'connected' || latest?.status === 'sms_fallback_sent') {
    return { state: 'success', substep: 7 };
  }
  if (latest?.status === 'failed') return { state: 'failed', substep: 7 };

  return { state: 'idle', substep: 0 };
}

export function SignalFlowMonitor() {
  const { T } = useApp();
  const [pending, setPending] = useState<QueueStatusItem[]>([]);
  const [latest, setLatest] = useState<HistoryItem | null>(null);
  const [gsmConnected, setGsmConnected] = useState(false);
  // จำ layout ที่เลือกไว้ — ผู้ใช้ไม่ต้องเลือกใหม่ทุกครั้งที่เปิดหน้า
  const [layout, setLayout] = useState<LayoutId>(() => {
    const saved = localStorage.getItem(LAYOUT_STORAGE_KEY);
    return LAYOUTS.some((l) => l.id === saved) ? (saved as LayoutId) : 'linear';
  });
  const [settingsOpen, setSettingsOpen] = useState(false);
  /**
   * โหมดแสดงผล: 'auto' = ตามสถานะจริง / ค่าอื่น = บังคับให้แสดงสถานะนั้น
   *
   * ตอนแรกผมตัด dropdown นี้ออกเพราะคิดว่าเป็นเครื่องมือ demo ของดีไซเนอร์
   * แต่คิดใหม่แล้วมันมีประโยชน์จริง: บอร์ด A7680C ยังไม่มา ต้องถ่ายภาพหน้าจอ
   * ทุกสถานะไปใส่รายงาน ถ้าไม่มีตัวนี้ต้องรอให้เกิดเหตุจริงถึงจะเห็นภาพ ringing/failed
   * กันเข้าใจผิดด้วยการขึ้นป้าย "สาธิต" ให้เห็นชัดตลอดเวลาที่ไม่ได้อยู่โหมด auto
   */
  const [mode, setMode] = useState<'auto' | FlowState>('auto');
  /** จำนวน request ที่บังคับไว้ตอนสาธิต (null = ใช้จำนวนงานในคิวจริง) */
  const [reqOverride, setReqOverride] = useState<number | null>(null);

  useEffect(() => {
    localStorage.setItem(LAYOUT_STORAGE_KEY, layout);
  }, [layout]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const [queue, history, gsm] = await Promise.all([getQueueStatus(), getHistory({ page: 1, page_size: 1 }), getGsmDetail()]);
      if (cancelled) return;
      setPending(queue.items);
      setLatest(history.items[0] ?? null);
      setGsmConnected(gsm.connected);
    };
    void load();
    const id = setInterval(() => void load(), REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const live = stateFromData(pending, latest, gsmConnected);
  // โหมดสาธิตบังคับสถานะ: calling ให้ไล่กลางทาง (substep 3) สถานะอื่นถือว่าจบขั้นแล้ว (7)
  const state = mode === 'auto' ? live.state : mode;
  const substep = mode === 'auto' ? live.substep : mode === 'calling' ? 3 : mode === 'idle' ? 0 : 7;
  const tone = stateTone[state];
  const isDemo = mode !== 'auto';

  const stateLabel: Record<FlowState, string> = {
    idle: T.flow_state_idle,
    calling: T.flow_state_calling,
    ringing: T.flow_state_ringing,
    success: T.flow_state_success,
    failed: T.flow_state_failed,
  };

  // จำนวนจุดวิ่งบนเส้นแรก = จำนวนงานในคิวจริง (จำกัด 1-4 ตามที่ดีไซน์รองรับ)
  const packetCount = reqOverride ?? Math.min(4, Math.max(1, pending.length || 1));
  const queuedCount = pending.filter((j) => j.status === 'queued').length;

  const shared: LayoutProps = { state, substep, packets: packetCount, tone, T, latest, queued: queuedCount };

  return (
    <section className="overflow-hidden rounded-card border border-line bg-surface shadow-card">
      <div className="flex flex-wrap items-center gap-2.5 border-b border-line-2 px-4 py-3">
        {/* จุดสีนำหน้าหัวข้อ ตามภาพ — สีตามสถานะปัจจุบัน */}
        <span className={cn('size-2 shrink-0 rounded-full', toneFill[tone], state !== 'idle' && 'animate-soft-pulse')} />
        <h3 className="text-lead font-bold whitespace-nowrap">{T.flow_title}</h3>

        <select
          value={mode}
          onChange={(e) => setMode(e.target.value as 'auto' | FlowState)}
          className={cn(
            'rounded-control border bg-surface px-2 py-1 font-mono text-micro',
            isDemo ? 'border-warn text-warn' : 'border-line text-ink-2',
          )}
        >
          <option value="auto">▶ {T.flow_auto}</option>
          <option value="idle">{T.flow_state_idle}</option>
          <option value="calling">{T.flow_state_calling}</option>
          <option value="ringing">{T.flow_state_ringing}</option>
          <option value="success">{T.flow_state_success}</option>
          <option value="failed">{T.flow_state_failed}</option>
        </select>

        <span className="rounded-md border border-brand bg-surface px-2 py-0.5 font-mono text-micro whitespace-nowrap text-brand">
          {T.flow_req(packetCount)}
        </span>

        {isDemo ? (
          <span className="rounded-full border border-warn bg-warn-soft px-2.5 py-0.5 font-mono text-micro whitespace-nowrap text-warn">
            {T.flow_demo_mode}
          </span>
        ) : null}
        {!gsmConnected && !isDemo ? (
          <span className="rounded-full border border-bad bg-bad-soft px-2.5 py-0.5 font-mono text-micro whitespace-nowrap text-bad">
            {T.flow_gsm_offline}
          </span>
        ) : null}

        {/* สถานะเป็นข้อความสีตามโทน ไม่ใช่ pill — ตามภาพ */}
        <span className={cn('ms-auto max-w-[180px] truncate text-caption font-medium', toneText[tone])}>
          {stateLabel[state]}
        </span>
        <button
          type="button"
          title={T.flow_layout_style}
          onClick={() => setSettingsOpen((v) => !v)}
          className={cn(
            'grid size-7 shrink-0 place-items-center rounded-md border font-mono',
            settingsOpen ? 'border-brand bg-brand text-brand-ink' : 'border-line bg-transparent text-ink-2',
          )}
        >
          ⚙
        </button>
      </div>

      {settingsOpen ? (
        <div className="flex animate-fade-up flex-col gap-2 border-b border-line-2 bg-surface-2 px-4 py-3">
          <span className="font-mono text-micro tracking-[0.12em] text-ink-2 uppercase">{T.flow_layout_style}</span>
          <div className="flex flex-wrap gap-1.5">
            {LAYOUTS.map((l) => (
              <button
                key={l.id}
                type="button"
                onClick={() => setLayout(l.id)}
                className={cn(
                  'flex items-center gap-1.5 rounded-control border px-2.5 py-1.5 text-caption font-medium',
                  layout === l.id ? 'border-brand bg-brand text-brand-ink' : 'border-line bg-surface text-ink-2',
                )}
              >
                <span className="font-mono text-micro opacity-65">{l.abbr}</span>
                {l.label}
              </button>
            ))}
          </div>

          {/* ตัวเลือกนี้บังคับจำนวนจุดวิ่งตอนสาธิต — ปกติใช้จำนวนงานในคิวจริง
              กด "auto" (ปุ่มซ้ายสุด) เพื่อกลับไปใช้ค่าจริง */}
          <span className="mt-1 font-mono text-micro tracking-[0.12em] text-ink-2 uppercase">
            {T.flow_incoming_requests}
          </span>
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => setReqOverride(null)}
              className={cn(
                'rounded-control border px-3 py-1 font-mono text-caption',
                reqOverride === null ? 'border-brand bg-brand text-brand-ink' : 'border-line bg-surface text-ink-2',
              )}
            >
              {T.flow_auto}
            </button>
            {[1, 2, 3, 4].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setReqOverride(n)}
                className={cn(
                  'rounded-control border px-3 py-1 font-mono text-caption',
                  reqOverride === n ? 'border-brand bg-brand text-brand-ink' : 'border-line bg-surface text-ink-2',
                )}
              >
                {n}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {isDemo ? (
        <p className="border-b border-line-2 bg-warn-soft px-4 py-2 text-micro leading-[1.7] text-warn">
          {T.flow_demo_note}
        </p>
      ) : null}

      {/* แถบ SIGNAL STEP 8 ช่อง — อยู่ใน mockup แต่ไม่มีใน handoff .tsx (ไล่จาก substep เดียวกับโหนด) */}
      <div className="flex flex-wrap items-center gap-2.5 px-4 pt-3">
        <span className="font-mono text-micro tracking-[0.16em] text-ink-2 uppercase">{T.flow_signal_step}</span>
        <span className="ms-auto font-mono text-micro whitespace-nowrap">
          <span className={toneText[tone]}>{stateLabel[state]}</span>
        </span>
      </div>
      <div className="flex gap-1 px-4 pt-1.5">
        {Array.from({ length: 8 }).map((_, i) => (
          <span
            key={i}
            className={cn(
              'h-1.5 flex-1 rounded-full transition-colors',
              state === 'idle' ? 'bg-line' : i <= substep ? toneFill[tone] : 'bg-line',
            )}
          />
        ))}
      </div>

      {layout === 'linear' ? <LinearLayout {...shared} /> : null}
      {layout === 'circular' ? <CircularLayout {...shared} /> : null}
      {layout === 'camera' ? <CameraLayout {...shared} /> : null}
      {layout === 'stepflow' ? <StepFlowLayout {...shared} /> : null}
      {layout === 'radar' ? <RadarLayout {...shared} /> : null}
      {layout === 'timeline' ? <TimelineLayout {...shared} /> : null}

      {/* legend ซ้าย + badge layout ขวา ตามภาพ (เดิมผมเอา badge ไปไว้ที่หัวการ์ด) */}
      <div className="flex flex-wrap items-center gap-3 border-t border-line-2 px-4 py-3">
        <Legend T={T} short state={state} substep={substep} tone={tone} />
        <span className="ms-auto rounded-md border border-line bg-surface-2 px-2 py-0.5 font-mono text-micro whitespace-nowrap text-ink-2">
          Layout {LAYOUTS.find((l) => l.id === layout)?.abbr} · {LAYOUTS.find((l) => l.id === layout)?.label}
        </span>
      </div>

      <p className="border-t border-line-2 px-4 py-2.5 text-micro leading-[1.7] text-ink-2">{T.flow_step_note}</p>
    </section>
  );
}

type LayoutProps = {
  state: FlowState;
  substep: number;
  packets: number;
  tone: Tone;
  T: ReturnType<typeof useApp>['T'];
  /** งานล่าสุด — Timeline ใช้เวลาจริงของงานนี้เป็นจุดอ้างอิงแถวแรก */
  latest: HistoryItem | null;
  /** จำนวนงานสถานะ queued — โชว์เป็น badge "รอคิว N" เหนือโหนด API ตามภาพ */
  queued: number;
};

function nodeLive(state: FlowState, substep: number, id: NodeId) {
  if (state === 'idle') return false;
  if (state === 'success' || state === 'ringing') return true;
  return substep >= NODE_STEP[id];
}

/** จุดวิ่งบนเส้น — animation-delay ใช้ arbitrary property ของ Tailwind (ไม่ใช้ inline style) */
const DELAY = ['[animation-delay:0ms]', '[animation-delay:240ms]', '[animation-delay:480ms]', '[animation-delay:720ms]'];

function Packets({ count, tone }: { count: number; tone: Tone }) {
  return (
    <span className="pointer-events-none absolute inset-0 overflow-hidden">
      {Array.from({ length: count }).map((_, i) => (
        <span
          key={i}
          className={cn('absolute top-1/2 size-1.5 -translate-y-1/2 rounded-full', toneFill[tone], 'animate-packet', DELAY[i])}
        />
      ))}
    </span>
  );
}

/* ── A. Linear ─────────────────────────────────────────────
   แทร็ก min-w-max ในกล่อง overflow-x-auto → จอ 360px เลื่อนดูครบทุกโหนด */
function LinearLayout({ state, substep, packets, tone, T, queued }: LayoutProps) {
  const labels: Record<NodeId, string> = {
    api: T.flow_node_api,
    pi: T.flow_node_pi,
    antenna: T.flow_node_antenna,
    phone: T.flow_node_phone,
  };
  /** โหนดที่กำลังทำงานอยู่ตอนนี้ — ตามภาพจะมีพื้นสีอ่อนเน้นไว้ */
  const currentIdx =
    state === 'idle' ? -1 : state === 'success' || state === 'ringing' ? 3 : Math.min(3, Math.floor(substep / 2));

  return (
    <div className="flex flex-col items-center gap-3 overflow-x-auto overscroll-x-contain px-3.5 pt-3 pb-4">
      <div className="mx-auto flex min-w-max items-center justify-center">
        {NODES.map((id, i) => {
          const live = nodeLive(state, substep, id);
          const isCurrent = i === currentIdx;
          const lineLive = i < 3 && (state === 'success' || state === 'ringing' || substep >= LINE_STEP[i]);
          const flowing = i < 3 && state === 'calling' && substep >= LINE_STEP[i];
          return (
            <div key={id} className="flex items-center">
              <div className="flex w-[92px] flex-col items-center gap-2">
                {/* badge ลอยเหนือโหนดแรกตามภาพ — ใช้ความสูงคงที่กันการ์ดขยับตอน badge หาย/โผล่ */}
                <span className="flex min-h-[38px] flex-col items-center gap-1">
                  {i === 0 && state !== 'idle' ? (
                    <span className="flex items-center gap-1 rounded-full border border-brand bg-surface px-2 py-0.5 font-mono text-micro whitespace-nowrap text-brand">
                      <span className="size-1.5 rounded-full bg-brand" />
                      {T.flow_badge_working}
                    </span>
                  ) : null}
                  {i === 0 && queued > 0 ? (
                    <span className="flex items-center gap-1 rounded-full border border-warn bg-surface px-2 py-0.5 font-mono text-micro whitespace-nowrap text-warn">
                      <span className="size-1.5 rounded-full bg-warn" />
                      {T.flow_badge_queued(queued)}
                    </span>
                  ) : null}
                </span>

                <span
                  className={cn(
                    'relative grid size-[54px] place-items-center rounded-2xl border-[1.5px] transition-colors',
                    live ? cn(toneBorder[tone], toneText[tone]) : 'border-line text-ink-2',
                    // โหนดที่กำลังทำงานมีพื้นสีอ่อน ที่เหลือพื้นเดียวกับการ์ด (ตามภาพ)
                    isCurrent ? toneBg[tone] : 'bg-surface',
                    id === 'phone' && state === 'ringing' && 'animate-vibrate',
                  )}
                >
                  {(id === 'antenna' && (state === 'calling' || state === 'ringing')) ||
                  (id === 'phone' && state === 'ringing') ? (
                    <span className="absolute inset-0 animate-wave-out rounded-2xl bg-current opacity-15" />
                  ) : null}
                  <NodeIcon id={id} className="relative size-6" />
                  {id === 'phone' && state === 'success' ? (
                    <span className="absolute -end-2 -top-2 grid size-[17px] animate-pop place-items-center rounded-full border border-ok bg-surface font-mono text-micro font-bold text-ok">
                      ✓
                    </span>
                  ) : null}
                </span>
                {/* label ไทยยาวกว่า EN — ปล่อยให้ตัดบรรทัดได้ ห้าม nowrap */}
                <span
                  className={cn(
                    'text-center text-micro font-medium transition-colors',
                    isCurrent ? toneText[tone] : live ? toneText[tone] : 'text-ink-2',
                  )}
                >
                  {labels[id]}
                </span>
              </div>

              {i < 3 ? (
                <div className="relative mx-1.5 mb-[22px] h-5 min-w-[34px] flex-1 basis-[62px]">
                  {/* เส้นเชื่อมเป็นเส้นประตามภาพ ไม่ใช่เส้นทึบ */}
                  <svg viewBox="0 0 130 20" preserveAspectRatio="none" className="absolute inset-0 h-5 w-full">
                    <line
                      x1="0"
                      y1="10"
                      x2="130"
                      y2="10"
                      strokeWidth="2"
                      strokeDasharray="7 5"
                      className={lineLive ? cn('stroke-current', toneText[tone]) : 'stroke-line'}
                    />
                  </svg>
                  {flowing ? <Packets count={i === 0 ? packets : 3} tone={tone} /> : null}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ── B. Circular ───────────────────────────────────────────
   4 โหนดรอบวงกลม r=92 เส้นเชื่อมเป็น arc โก่งเข้าศูนย์กลาง */
const CX = 160;
const CY = 142;
const R = 92;
const polar = (deg: number) => ({
  x: CX + R * Math.cos((deg * Math.PI) / 180),
  y: CY + R * Math.sin((deg * Math.PI) / 180),
});
const CIRC: Record<NodeId, { x: number; y: number }> = {
  api: polar(180),
  pi: polar(270),
  antenna: polar(0),
  phone: polar(90),
};

function arcPath(a: { x: number; y: number }, b: { x: number; y: number }) {
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const dx = CX - mx;
  const dy = CY - my;
  const len = Math.hypot(dx, dy) || 1;
  const r = (n: number) => Math.round(n * 10) / 10;
  return `M${r(a.x)},${r(a.y)} Q${r(mx + (dx / len) * 26)},${r(my + (dy / len) * 26)} ${r(b.x)},${r(b.y)}`;
}

function CircularLayout({ state, substep, tone, T }: LayoutProps) {
  const arcs = [arcPath(CIRC.api, CIRC.pi), arcPath(CIRC.pi, CIRC.antenna), arcPath(CIRC.antenna, CIRC.phone)];
  const pos: Record<NodeId, string> = {
    api: 'start-[41px] top-[115px]',
    pi: 'start-[133px] top-[23px]',
    antenna: 'start-[225px] top-[115px]',
    phone: 'start-[133px] top-[207px]',
  };
  const stateLabel: Record<FlowState, string> = {
    idle: T.flow_state_idle,
    calling: T.flow_state_calling,
    ringing: T.flow_state_ringing,
    success: T.flow_state_success,
    failed: T.flow_state_failed,
  };
  return (
    <div className="flex flex-col items-center gap-3 overflow-x-auto px-3.5 pt-4 pb-3.5">
      <div className="relative size-[320px] shrink-0 basis-[270px]">
        <svg viewBox="0 0 320 270" className="absolute inset-0 size-full">
          <circle cx={CX} cy={CY} r={R} fill="none" strokeWidth="1" strokeDasharray="4 6" className="stroke-line" />
          {arcs.map((d, i) => {
            const lit = state === 'success' || state === 'ringing' || substep >= LINE_STEP[i];
            return (
              <path
                key={d}
                d={d}
                fill="none"
                strokeWidth={lit ? 2 : 1.5}
                className={lit ? cn('stroke-current', toneText[tone]) : 'stroke-line'}
              />
            );
          })}
        </svg>
        {NODES.map((id) => {
          const live = nodeLive(state, substep, id);
          return (
            <span
              key={id}
              className={cn(
                'absolute grid size-[54px] place-items-center rounded-2xl border-[1.5px] bg-surface transition-colors',
                pos[id],
                live ? cn(toneBorder[tone], toneText[tone]) : 'border-line text-ink-2',
              )}
            >
              <NodeIcon id={id} className="size-6" />
            </span>
          );
        })}
        <span className="absolute start-[100px] top-[128px] grid w-[120px] place-items-center">
          <span
            className={cn(
              'rounded-control border bg-surface px-2.5 py-1 text-center text-micro',
              toneBorder[tone],
              toneText[tone],
            )}
          >
            {stateLabel[state]}
          </span>
        </span>
      </div>
      <Legend T={T} />
    </div>
  );
}

/* ── C. Camera ─────────────────────────────────────────────
   โฟกัสโหนดเดียวไล่ทีละขั้น + progress bar ด้านล่าง */
function CameraLayout({ state, substep, packets, tone, T }: LayoutProps) {
  const idx =
    state === 'idle' ? 0 : state === 'success' || state === 'ringing' ? 3 : Math.min(3, Math.floor(substep / 2));
  const id = NODES[idx];
  const labels: Record<NodeId, string> = {
    api: T.flow_node_api,
    pi: T.flow_node_pi,
    antenna: T.flow_node_antenna,
    phone: T.flow_node_phone,
  };
  // ข้อความบรรทัดล่างเป็น mono technical ตามดีไซน์ — ค่า requests มาจากคิวจริง
  const sub =
    state === 'idle'
      ? 'standby'
      : state === 'success'
        ? '✓ answered'
        : id === 'api'
          ? `${packets} in queue`
          : id === 'pi'
            ? 'encoding audio…'
            : id === 'antenna'
              ? 'transmitting…'
              : 'ringing…';

  return (
    <div className="flex flex-col items-center gap-3.5 px-4 pt-4 pb-3.5">
      <div
        className={cn(
          'relative h-[220px] w-full max-w-[360px] overflow-hidden rounded-card border-[1.5px] bg-surface transition-colors',
          toneBorder[tone],
        )}
      >
        <div className="absolute inset-x-0 top-0 z-[3] flex items-center justify-between px-3.5 pt-2.5 pb-2">
          <span className="flex items-center gap-1.5">
            <span className={cn('size-1.5 rounded-full', toneFill[tone], state !== 'idle' && 'animate-soft-pulse')} />
            <span className="font-mono text-micro tracking-[0.16em] text-ink-2 uppercase">viewport</span>
          </span>
          <span className="font-mono text-micro text-ink-2">{idx + 1} / 4</span>
        </div>
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
          <span
            className={cn(
              'relative grid size-[90px] place-items-center rounded-[22px] border-[1.5px]',
              toneBorder[tone],
              toneBg[tone],
              toneText[tone],
            )}
          >
            <NodeIcon id={id} className="relative size-10 animate-slide-in" />
          </span>
          <span className="text-lead font-semibold">{labels[id]}</span>
          <span className={cn('animate-fade-up font-mono text-caption', toneText[tone])}>{sub}</span>
        </div>
      </div>
      <div className="flex items-center gap-2.5">
        {NODES.map((n, i) => (
          <span key={n} className="flex flex-col items-center gap-1.5">
            <span
              className={cn(
                'grid size-[34px] place-items-center rounded-xl border-[1.5px] font-mono text-micro font-bold',
                i === idx ? cn(toneBorder[tone], toneBg[tone], toneText[tone]) : 'border-line bg-surface text-ink-2',
              )}
            >
              {i + 1}
            </span>
            <span
              className={cn('h-1.5 rounded-full transition-all', i === idx ? cn('w-6', toneFill[tone]) : 'w-1.5 bg-line')}
            />
          </span>
        ))}
      </div>
    </div>
  );
}

/* ── D. Step Flow ──────────────────────────────────────────
   การ์ด 4 ใบ + ชิปสถานะ done/active/ringing/error */
function StepFlowLayout({ state, substep, packets, tone, T }: LayoutProps) {
  const meta: Record<NodeId, { label: string; sub: string }> = {
    api: { label: T.flow_node_api, sub: 'POST /notify' },
    pi: { label: T.flow_node_pi, sub: 'gTTS → mp3' },
    antenna: { label: T.flow_node_antenna, sub: 'AT+ATD' },
    phone: { label: T.flow_node_phone, sub: 'answer' },
  };
  const chipOf = (id: NodeId) => {
    if (state === 'idle') return { text: 'standby', cls: 'bg-surface-2 text-ink-2' };
    if (state === 'failed' && id !== 'phone') return { text: 'error', cls: 'bg-bad-soft text-bad' };
    if (state === 'ringing' && id === 'phone') return { text: 'ringing', cls: 'bg-warn-soft text-warn' };
    if (state === 'calling' && substep === NODE_STEP[id]) return { text: 'active', cls: 'bg-brand-soft text-brand' };
    return nodeLive(state, substep, id)
      ? { text: 'done', cls: 'bg-ok-soft text-ok' }
      : { text: 'waiting', cls: 'bg-surface-2 text-ink-2' };
  };

  return (
    <div className="overflow-x-auto px-3.5 pt-10 pb-4">
      <div className="mx-auto flex min-w-max items-stretch gap-1">
        {NODES.map((id, i) => {
          const chip = chipOf(id);
          const live = nodeLive(state, substep, id);
          const lifted = chip.text === 'active' || chip.text === 'ringing';
          const flowing = i < 3 && state === 'calling' && substep >= LINE_STEP[i];
          return (
            <div key={id} className="flex items-stretch">
              <div
                className={cn(
                  'flex w-[132px] flex-col items-center gap-1.5 rounded-card border-[1.5px] px-2.5 py-3 transition-all',
                  live ? toneBorder[tone] : 'border-line',
                  lifted ? cn('-translate-y-1.5 scale-[1.03]', toneBg[tone]) : 'bg-surface',
                )}
              >
                <span
                  className={cn(
                    'grid size-11 place-items-center rounded-xl border bg-surface',
                    live ? cn(toneBorder[tone], toneText[tone]) : 'border-line text-ink-2',
                  )}
                >
                  <NodeIcon id={id} className="size-[22px]" />
                </span>
                <span className={cn('text-center text-micro font-semibold', live ? toneText[tone] : 'text-ink-2')}>
                  {meta[id].label}
                </span>
                <span className="font-mono text-micro text-ink-2">{meta[id].sub}</span>
                <span className={cn('rounded-full px-2.5 py-0.5 font-mono text-micro', chip.cls)}>{chip.text}</span>
              </div>
              {i < 3 ? (
                <div className="relative mx-0.5 h-3 w-[26px] shrink-0 self-center">
                  <svg viewBox="0 0 26 12" className="absolute inset-0">
                    <line
                      x1="0"
                      y1="6"
                      x2="19"
                      y2="6"
                      strokeWidth="1.5"
                      className={live ? cn('stroke-current', toneText[tone]) : 'stroke-line'}
                    />
                    <polygon
                      points="18,3 25,6 18,9"
                      className={live ? cn('fill-current', toneText[tone]) : 'fill-line'}
                    />
                  </svg>
                  {flowing ? <Packets count={i === 0 ? packets : 3} tone={tone} /> : null}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ── E. Radar ──────────────────────────────────────────────
   จอสแกนพื้นกรมท่า — สีเข้มพวกนี้ hardcode โดยเจตนาตามดีไซน์ (จอเรดาร์ต้องเข้มทั้ง 2 ธีม) */
const RX = 160;
const RY = 145;
const RR = 105;
const radarAt = (deg: number) => ({
  x: Math.round((RX + RR * Math.cos((deg * Math.PI) / 180)) * 10) / 10,
  y: Math.round((RY + RR * Math.sin((deg * Math.PI) / 180)) * 10) / 10,
});
const RADAR_POS = [radarAt(190), radarAt(240), radarAt(300), radarAt(350)];
const SHORT = ['API', 'RPi', '4G', 'SIP'];

function RadarLayout({ state, substep, tone, T }: LayoutProps) {
  const inward = (p: { x: number; y: number }) => {
    const dx = RX - p.x;
    const dy = RY - p.y;
    const l = Math.hypot(dx, dy) || 1;
    return { x: Math.round(p.x + (dx / l) * 22), y: Math.round(p.y + (dy / l) * 22) };
  };
  const sweeping = state === 'calling' || state === 'ringing';

  return (
    <div className="flex flex-col items-center gap-3 overflow-x-auto px-3.5 pt-4 pb-3.5">
      <div className="relative h-[290px] w-[320px] shrink-0">
        <svg viewBox="0 0 320 290" className="absolute inset-0 size-full">
          <circle cx={RX} cy={RY} r="115" fill="#0f172a" />
          {[36, 65].map((r) => (
            <circle
              key={r}
              cx={RX}
              cy={RY}
              r={r}
              fill="none"
              strokeWidth="1"
              stroke={state === 'idle' ? '#1e293b' : 'currentColor'}
              className={toneText[tone]}
              opacity="0.45"
            />
          ))}
          <circle cx={RX} cy={RY} r="96" fill="none" strokeWidth="1" strokeDasharray="4 5" stroke="#1e293b" />
          <line x1="45" y1={RY} x2="275" y2={RY} stroke="#1e293b" strokeWidth="0.5" />
          <line x1={RX} y1="30" x2={RX} y2="260" stroke="#1e293b" strokeWidth="0.5" />

          {sweeping ? (
            <g className="origin-[160px_145px] animate-sweep">
              <path
                d="M160,145 L270,145 A110,110 0 0,1 215,49.7 Z"
                className={cn('fill-current', toneText[tone])}
                opacity="0.2"
              />
              <line
                x1={RX}
                y1={RY}
                x2="270"
                y2={RY}
                strokeWidth="1"
                className={cn('stroke-current', toneText[tone])}
                opacity="0.75"
              />
            </g>
          ) : null}

          {RADAR_POS.slice(0, 3).map((p, i) => {
            const lit = state === 'success' || state === 'ringing' || substep >= LINE_STEP[i];
            if (!lit) return null;
            const q = RADAR_POS[i + 1];
            return (
              <path
                key={i}
                d={`M${p.x},${p.y} L${q.x},${q.y}`}
                fill="none"
                strokeWidth="1.5"
                strokeDasharray="6 4"
                className={cn('animate-dash stroke-current', toneText[tone])}
                opacity="0.9"
              />
            );
          })}

          {RADAR_POS.map((p, i) => {
            const live = nodeLive(state, substep, NODES[i]);
            return (
              <g key={i}>
                {live ? (
                  <circle cx={p.x} cy={p.y} r="11" className={cn('fill-current', toneText[tone])} opacity="0.16" />
                ) : null}
                <circle cx={p.x} cy={p.y} r="4" className={live ? cn('fill-current', toneText[tone]) : 'fill-[#334155]'} />
              </g>
            );
          })}
          <circle cx={RX} cy={RY} r="3" className={state === 'idle' ? 'fill-[#334155]' : cn('fill-current', toneText[tone])} />

          {/* ป้ายชื่อโหนดวาดเป็น <text> ใน svg แทน <span> ที่ต้นฉบับใช้
              เพราะต้นฉบับเขียน `left-[${lp.x}px]` ซึ่ง Tailwind สร้างคลาสให้ไม่ได้
              (JIT สแกนซอร์สแบบ static ไม่รู้จักค่าที่คำนวณตอน runtime) ป้ายจะไม่ขยับเลย
              พิกัดมาจากเรขาคณิต ใช้ attribute ของ svg ตรงๆ ถูกต้องกว่าและไม่ต้องมี inline style */}
          {RADAR_POS.map((p, i) => {
            const lp = inward(p);
            const live = nodeLive(state, substep, NODES[i]);
            return (
              <text
                key={`label-${i}`}
                x={lp.x}
                y={lp.y}
                textAnchor="middle"
                dominantBaseline="middle"
                className={cn('font-mono text-[11px] font-medium', live ? toneText[tone] : 'text-[#94a3b8]')}
                fill="currentColor"
              >
                {SHORT[i]}
              </text>
            );
          })}

          <text
            x={RX}
            y={RY + 26}
            textAnchor="middle"
            className={cn('font-mono text-[11px]', state === 'idle' ? 'text-[#94a3b8]' : toneText[tone])}
            fill="currentColor"
          >
            {state === 'calling'
              ? `TX_${substep}`
              : state === 'ringing'
                ? 'RINGING'
                : state === 'success'
                  ? 'CONNECTED'
                  : 'OFFLINE'}
          </text>
        </svg>
      </div>
      <Legend T={T} short />
    </div>
  );
}

/* ── F. Timeline ───────────────────────────────────────────
   8 เหตุการณ์เรียงตามลำดับ — layout นี้ทนข้อความไทยยาวได้ดีที่สุด

   ต้นฉบับใส่ timestamp ปลอมไว้ทุกแถว (00:00.00, 00:00.05, …) พร้อมรายละเอียดที่
   แต่งขึ้น (RSRP −85 dBm, PCM 8kHz, RTP/UDP) — ตัดออกทั้งหมด
   หน้าจอ monitoring ที่โชว์เวลาปลอมอันตรายกว่าไม่โชว์เวลา
   แถวแรกใช้ created_at จริงของงานล่าสุด ที่เหลือขึ้น "—" จนกว่าจะมี GET /history/{job_id} */
function TimelineLayout({ state, substep, packets, T, latest }: LayoutProps) {
  const startedAt = latest ? new Date(latest.created_at).toLocaleTimeString() : null;

  const rows: { node?: NodeId; label: string; detail: string; time: string | null; step: number }[] = [
    { node: 'api', label: T.flow_node_api, detail: `POST /notify · ${packets}`, time: startedAt, step: 0 },
    { label: 'queued', detail: 'รอ worker หยิบงาน', time: null, step: 1 },
    { node: 'pi', label: T.flow_node_pi, detail: 'gTTS → mp3', time: null, step: 2 },
    { label: 'dial', detail: 'ATD ผ่าน serial', time: null, step: 3 },
    { node: 'antenna', label: T.flow_node_antenna, detail: 'ส่งออกเครือข่าย', time: null, step: 4 },
    { label: 'relay', detail: 'ปลายทางเริ่มดัง', time: null, step: 5 },
    { label: 'ringing', detail: 'รอปลายทางรับสาย', time: null, step: 6 },
    {
      node: 'phone',
      label: T.flow_node_phone,
      detail: state === 'success' ? 'รับสาย — เล่นข้อความ' : 'ยังไม่รับ',
      time: null,
      step: 7,
    },
  ];

  const rowTone = (step: number) => {
    if (state === 'idle') return 'idle' as const;
    if (state === 'failed') return step <= 3 ? ('done' as const) : step === 4 ? ('error' as const) : ('idle' as const);
    if (state === 'ringing') return step < 6 ? ('done' as const) : step === 6 ? ('ringing' as const) : ('idle' as const);
    if (state === 'success') return 'done' as const;
    return substep === step ? ('active' as const) : substep > step ? ('done' as const) : ('idle' as const);
  };

  const cls = {
    idle: { ink: 'text-ink-2', dot: 'border-line bg-surface-2 text-ink-2', line: 'bg-line', row: '' },
    active: { ink: 'text-brand', dot: 'border-brand bg-brand text-brand-ink', line: 'bg-brand', row: 'border-brand bg-brand-soft' },
    done: { ink: 'text-ok', dot: 'border-ok bg-ok text-white', line: 'bg-ok', row: '' },
    error: { ink: 'text-bad', dot: 'border-bad bg-bad text-white', line: 'bg-bad', row: 'border-bad bg-bad-soft' },
    ringing: { ink: 'text-warn', dot: 'border-warn bg-warn text-white', line: 'bg-warn', row: 'border-warn bg-warn-soft animate-vibrate' },
  } as const;

  return (
    <div className="flex flex-col items-center gap-2 px-4 pt-3.5 pb-4">
      <div className="flex w-full max-w-[460px] flex-col gap-0.5">
        {rows.map((r, i) => {
          const q = rowTone(r.step);
          const c = cls[q];
          return (
            <div
              key={r.label + r.step}
              className={cn(
                'flex items-start gap-3 rounded-xl border border-transparent px-2.5 py-1.5 transition-colors',
                c.row,
              )}
            >
              <span className="flex w-5 shrink-0 flex-col items-center self-stretch">
                <span
                  className={cn(
                    'grid shrink-0 place-items-center rounded-full border-[1.5px]',
                    r.node ? 'size-5' : 'mt-1 size-[11px]',
                    c.dot,
                  )}
                >
                  {r.node ? <NodeIcon id={r.node} className="size-[11px]" /> : null}
                </span>
                {i < rows.length - 1 ? <span className={cn('min-h-2.5 w-px flex-1 transition-colors', c.line)} /> : null}
              </span>
              <span className="flex min-w-0 flex-1 items-start justify-between gap-2">
                <span className="flex min-w-0 flex-col">
                  <span className={cn('text-caption font-semibold transition-colors', q === 'done' ? 'text-ink' : c.ink)}>
                    {r.label}
                  </span>
                  <span className="font-mono text-micro text-ink-2">{r.detail}</span>
                </span>
                <span className="mt-px shrink-0 font-mono text-micro text-ink-2">{r.time ?? '—'}</span>
              </span>
            </div>
          );
        })}
      </div>
      <p className="text-micro text-ink-2">{T.flow_time_unknown}</p>
    </div>
  );
}

/**
 * legend ท้ายการ์ด — จุดของโหนดที่กำลังทำงานอยู่ใช้สีตามสถานะ ที่เหลือเป็นสี brand
 * (ในภาพ API/RPi/4G เป็นน้ำเงิน แต่ SIP เป็นส้มเพราะตอนนั้นสถานะคือ "กำลังดังเรียก")
 * ถ้าไม่ส่ง state เข้ามาจะเป็นสี brand ทั้งหมด — ใช้กับ layout ที่ไม่ต้องเน้น
 */
function Legend({
  T,
  short = false,
  state,
  substep,
  tone,
}: {
  T: LayoutProps['T'];
  short?: boolean;
  state?: FlowState;
  substep?: number;
  tone?: Tone;
}) {
  const items: { id: NodeId; label: string }[] = [
    { id: 'api', label: short ? 'API' : T.flow_node_api },
    { id: 'pi', label: short ? 'RPi 4B' : T.flow_node_pi },
    { id: 'antenna', label: short ? '4G LTE' : T.flow_node_antenna },
    { id: 'phone', label: short ? 'SIP' : T.flow_node_phone },
  ];
  const currentIdx =
    state == null || substep == null || state === 'idle'
      ? -1
      : state === 'success' || state === 'ringing'
        ? 3
        : Math.min(3, Math.floor(substep / 2));

  return (
    <div className="flex flex-wrap items-center gap-2.5">
      {items.map((n, i) => (
        <span key={n.id} className="flex items-center gap-1.5">
          <span className={cn('size-1.5 rounded-full', i === currentIdx && tone ? toneFill[tone] : 'bg-brand')} />
          <span className="font-mono text-micro font-medium text-ink-2">{n.label}</span>
        </span>
      ))}
    </div>
  );
}

function NodeIcon({ id, className }: { id: NodeId; className?: string }) {
  const common = {
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.75,
    strokeLinecap: 'round' as const,
  };
  if (id === 'api')
    return (
      <svg {...common} className={className}>
        <path d="M8.5 8.5 5 12l3.5 3.5" />
        <path d="M15.5 8.5 19 12l-3.5 3.5" />
        <path d="M13.4 5.5 10.6 18.5" />
      </svg>
    );
  if (id === 'pi')
    return (
      <svg {...common} className={className}>
        <rect x="7" y="7" width="10" height="10" rx="1.5" />
        <path d="M7 9H5M7 12H5M7 15H5M17 9h2M17 12h2M17 15h2M9 7V5M12 7V5M15 7V5M9 17v2M12 17v2M15 17v2" />
      </svg>
    );
  if (id === 'antenna')
    return (
      <svg {...common} className={className}>
        <path d="M12 20V11" />
        <path d="M12 11l-3.5-3.5" />
        <path d="M12 11l3.5-3.5" />
        <path d="M7.8 6.2a6.5 6.5 0 0 0 8.4 8.4" />
        <path d="M5.2 3.6a10 10 0 0 0 13.2 13.2" />
      </svg>
    );
  return (
    <svg {...common} className={className}>
      <rect x="5" y="2" width="14" height="20" rx="2.5" />
      <line x1="9" y1="5" x2="15" y2="5" strokeWidth="1.5" />
    </svg>
  );
}
