/**
 * SignalFlowMonitor — การ์ดติดตามงานแจ้งเตือน 1 งาน ตั้งแต่ API รับเรื่องจนปลายสายได้ยินเสียง
 *
 * พอร์ตจาก figma/Signal Flow Monitor Design/ (ดีไซน์ใหม่ แทนของเดิมทั้งใบ)
 *
 * ── ต่างจากไฟล์ดีไซน์ 3 จุด ────────────────────────────────────────────────
 * 1. ดีไซน์ใช้ useSignalFlow() ที่วนสถานะเองทุก N วินาที + SNAPSHOTS ที่เขียนค่าไว้ตายตัว
 *    (queued: 3, status: 'กำลังเตรียมเสียง') ของเราคำนวณจากข้อมูลจริงทั้งหมดผ่าน
 *    snapshotFrom() — ทุกตัวเลขบนการ์ดนี้คือสิ่งที่ worker กำลังทำอยู่จริง ณ วินาทีนั้น
 *
 * 2. ดีไซน์แยกเป็น 6 ไฟล์ (index/FlowRow/ProgressBar/Legend/icons/states)
 *    รวมเป็นไฟล์เดียวตามแบบ widget อื่นในโปรเจคนี้ แบ่งส่วนด้วยหัวข้อคอมเมนต์แทน
 *
 * 3. เพิ่มของที่ดีไซน์ไม่มีแต่ระบบจริงต้องมี: ป้ายเตือนโมดูลหลุด และไฟกะพริบตอน
 *    มีคำขอใหม่ยิงเข้ามา (ผูกกับเลขงานที่เพิ่มขึ้นจริง ไม่ใช่ตั้งเวลาให้กะพริบเอง)
 *
 * ── ระบบสี ────────────────────────────────────────────────────────────────
 * เขียว = ผ่านแล้ว · สีสถานะ = กำลังทำอยู่ · เทา = ยังไม่ถึง · แดง = ล้มเหลว
 * ทั้งสามอยู่บนจอพร้อมกัน จึงอ่านออกในแวบเดียวว่างานเดินไปถึงไหน
 */
import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactElement, ReactNode, SVGProps } from 'react';

import { cn } from '@/app/components/ui/utils';
import { getHistory } from '../api/history';
import { getQueueStatus } from '../api/queue';
import { getGsmDetail } from '../api/system';
import { useApp } from '../context/AppContext';
import type { CallStep, HistoryItem, QueueStatusItem } from '../types';

/* ── โครงข้อมูล ──────────────────────────────────────────────────────────── */

type NodeId = 'api' | 'pi' | 'tower' | 'phone';
/** สถานะรายโหนด — ผ่านแล้ว / กำลังทำ / ยังไม่ถึง / พัง */
type NodeState = 'passed' | 'current' | 'pending' | 'failed';

type Snapshot = {
  /** โหนดที่งานอยู่ตอนนี้ (0-3) — null เมื่อระบบว่างหรืองานจบแล้ว */
  nodeIndex: number | null;
  /** 0-8 จำนวนขั้นที่ผ่านไปแล้ว คุมทั้งแถบความคืบหน้าและสีของโหนด/เส้น */
  passedSteps: number;
  /** ตัวแปร CSS ของสีที่สื่อสถานะนี้ */
  color: string;
  failed: boolean;
};

const COLOR = {
  grey: 'var(--sfm-grey)',
  blue: 'var(--sfm-blue)',
  orange: 'var(--sfm-orange)',
  green: 'var(--sfm-green)',
  red: 'var(--sfm-red)',
} as const;

const ORDINALS = ['01', '02', '03', '04'];
const NODE_IDS: NodeId[] = ['api', 'pi', 'tower', 'phone'];

/** 2 วิ — ขั้นตอนย่อยบางขั้นสั้นมาก (แปลงเสียงใช้ไม่ถึง 1 วิ) ถ้ารีเฟรชช้ากว่านี้
 *  จะกระพริบข้ามขั้นนั้นไปเลย ผู้ใช้เห็นแค่ขั้นยาวๆ เหมือนไม่มีอะไรเกิดขึ้น */
const REFRESH_MS = 2000;

/** แสดงผลของสายที่เพิ่งจบนานแค่ไหนก่อนกลับไปสถานะพัก
 *  6 วิ = การ์ดรีเฟรชทุก 2 วิ จึงการันตีว่าเห็นผลอย่างน้อย 2-3 รอบก่อนหาย
 *  ไม่หน่วงงานถัดไป: มีงานใหม่เข้ามาเมื่อไหร่ไฟไล่รอบใหม่ทันที ไม่ต้องรอครบ 6 วิ */
const RESULT_LINGER_MS = 6_000;

/**
 * แปลงข้อมูลจริง → snapshot ของภาพ
 *
 * ลำดับความสำคัญ: ขั้นตอนย่อยที่ worker รายงานสดๆ > งานที่กำลังทำ > งานที่รอในคิว
 *                 > ผลของสายที่เพิ่งจบ (6 วิ) > ว่าง
 *
 * ค่า passedSteps ผูกกับโหนดแบบ "โหนด i ผ่านแล้วเมื่อ i*2+2 <= passedSteps"
 * (โหนดละ 2 ขั้น) จึงต้องเลือกเลขให้ตรงกับโหนดที่กำลังทำงานเสมอ
 */
function snapshotFrom(
  pending: QueueStatusItem[],
  latest: HistoryItem | null,
  currentStep: CallStep | null,
  progress: number | null,
): Snapshot {
  if (currentStep) {
    switch (currentStep) {
      case 'preparing_audio':
        return { nodeIndex: 1, passedSteps: 2, color: COLOR.blue, failed: false };
      case 'uploading_audio':
        // ขั้นนี้กินเวลา 15-20 วิ ยาวกว่าขั้นอื่นมาก ถ้าตรึงไว้ช่องเดียวแถบจะนิ่งสนิท
        // เกือบตลอดการโทรจนดูเหมือนค้าง — กางเป็น 2 ช่องแล้วเลื่อนตามจำนวน byte
        // ที่ส่งเข้าโมดูลไปแล้วจริงๆ ที่ worker รายงานมา ไม่ใช่จับเวลาเดาเอา
        return {
          nodeIndex: 2,
          passedSteps: progress != null && progress >= 0.5 ? 5 : 4,
          color: COLOR.blue,
          failed: false,
        };
      case 'dialing':
        return { nodeIndex: 3, passedSteps: 6, color: COLOR.orange, failed: false };
      case 'playing':
        return { nodeIndex: 3, passedSteps: 7, color: COLOR.green, failed: false };
      case 'waiting_retry':
        return { nodeIndex: 3, passedSteps: 6, color: COLOR.red, failed: true };
    }
  }

  // worker ถืองานอยู่แต่ยังไม่ทันรายงานขั้นตอน — เกิดได้ในช่วงเสี้ยววินาทีแรกที่หยิบงาน
  if (pending.some((j) => j.status === 'in_progress')) {
    return { nodeIndex: 1, passedSteps: 2, color: COLOR.blue, failed: false };
  }

  // รอโทรซ้ำ = สายที่แล้ว "ไม่สำเร็จ" ต้องขึ้นแดงที่ปลายทาง ไม่ใช่ส้มเหมือนกำลังเรียกอยู่
  // (ยังไม่ได้เริ่มโทรรอบใหม่ แค่รอถึงเวลานัด)
  if (pending.some((j) => j.status === 'retrying' || j.status === 'escalated')) {
    return { nodeIndex: 3, passedSteps: 6, color: COLOR.red, failed: true };
  }

  if (pending.length > 0) {
    return { nodeIndex: 0, passedSteps: 0, color: COLOR.blue, failed: false };
  }

  // สายเพิ่งจบ — โชว์ผลแวบหนึ่งก่อนกลับไปว่าง ไม่งั้นจะกระโดดจาก "กำลังพูดข้อความ"
  // ไปเป็น "ว่าง" ทันทีจนผู้ใช้ไม่รู้เลยว่าตกลงสายนั้นสำเร็จหรือล้มเหลว
  // ใช้ updated_at (เวลาที่สถานะเปลี่ยนล่าสุด) ไม่ใช่ created_at เพราะงานที่ retry
  // หลายรอบ created_at คือตอนเข้าคิว ซึ่งห่างจากเวลาที่โทรจบจริงหลายนาที
  if (latest && Date.now() - new Date(latest.updated_at).getTime() < RESULT_LINGER_MS) {
    if (latest.status === 'connected') {
      return { nodeIndex: null, passedSteps: 8, color: COLOR.green, failed: false };
    }
    if (latest.status === 'failed') {
      return { nodeIndex: 3, passedSteps: 6, color: COLOR.red, failed: true };
    }
  }

  return { nodeIndex: null, passedSteps: 0, color: COLOR.grey, failed: false };
}

/** โหนด i ผ่านไปแล้วเมื่องานเดินเลยมันไป (โหนดละ 2 ขั้นบนแถบ 8 ช่อง) */
function nodeStateAt(index: number, snap: Snapshot): NodeState {
  if (snap.failed && index === snap.nodeIndex) return 'failed';
  if (snap.nodeIndex === index) return 'current';
  if (index * 2 + 2 <= snap.passedSteps) return 'passed';
  return 'pending';
}

/* ── การ์ด ───────────────────────────────────────────────────────────────── */

export function SignalFlowMonitor() {
  const { T } = useApp();
  const [pending, setPending] = useState<QueueStatusItem[]>([]);
  const [latest, setLatest] = useState<HistoryItem | null>(null);
  // null = ยังไม่รู้ (โหลดรอบแรกยังไม่เสร็จ) ต่างจาก false ที่แปลว่ารู้แล้วว่าโมดูลหลุด
  // เดิมเริ่มที่ false ป้ายแดง "โมดูลยังไม่เชื่อมต่อ" จึงโผล่แวบหนึ่งทุกครั้งที่เข้าหน้า
  const [gsmConnected, setGsmConnected] = useState<boolean | null>(null);
  const [currentStep, setCurrentStep] = useState<CallStep | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  // กะพริบโหนด API ตอนมีงานใหม่เข้ามา — ตรวจจากเลขงานล่าสุดที่เพิ่มขึ้นจริง
  // ไม่ใช่ตั้งเวลาให้กะพริบเอง จะได้ไม่หลอกว่ามีงานเข้าทั้งที่ไม่มี
  const [apiFlash, setApiFlash] = useState(false);
  const lastJobId = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const [queue, history, gsm] = await Promise.all([
        getQueueStatus(),
        getHistory({ page: 1, page_size: 1 }),
        getGsmDetail(),
      ]);
      if (cancelled) return;
      setPending(queue.items);
      setCurrentStep(queue.current_step);
      setProgress(queue.current_progress);
      const newest = history.items[0]?.job_id ?? null;
      if (lastJobId.current !== null && newest !== null && newest > lastJobId.current) {
        setApiFlash(true);
        setTimeout(() => setApiFlash(false), 1500);
      }
      lastJobId.current = newest;
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

  const snap = snapshotFrom(pending, latest, currentStep, progress);
  const busy = snap.nodeIndex !== null && !snap.failed;

  const labels: Record<NodeId, string> = {
    api: T.flow_node_api,
    pi: T.flow_node_pi,
    tower: T.flow_node_antenna,
    phone: T.flow_node_phone,
  };

  // ถ้า worker กำลังทำขั้นตอนย่อยอยู่ ให้ใช้ชื่อขั้นตอนนั้นแทนคำกว้างๆ อย่าง "กำลังต่อสาย"
  // — บอกตรงๆ ว่าตอนนี้อยู่ขั้นไหนมีค่ากับการดีบักมากกว่ามาก โดยเฉพาะขั้นอัปโหลดเสียง
  // ที่กินเวลาเป็นสิบวินาที ถ้าไม่บอกผู้ใช้จะนึกว่าระบบค้าง
  const stepHeadline: Record<CallStep, string> = {
    preparing_audio: T.flow_step_preparing,
    uploading_audio: T.flow_step_uploading,
    dialing: T.flow_step_dialing,
    playing: T.flow_step_playing,
    waiting_retry: T.flow_step_waiting_retry,
  };
  // ตอนรอโทรซ้ำต้องบอกด้วยว่าสายที่แล้วพลาดเพราะอะไร ไม่ใช่แค่ว่ากำลังรอ —
  // ปฏิเสธสาย / ไม่รับ / สายไม่ว่าง เป็นคนละเรื่องกันสำหรับคนที่ต้องตัดสินใจว่าจะทำอะไรต่อ
  const resultHeadline: Record<string, string> = {
    rejected: T.flow_result_rejected,
    no_answer: T.flow_result_no_answer,
    busy: T.flow_result_busy,
  };
  const waitingRetry =
    !currentStep && pending.some((j) => j.status === 'retrying' || j.status === 'escalated');

  const headline = currentStep
    ? stepHeadline[currentStep]
    : waitingRetry && latest?.last_result
      ? (resultHeadline[latest.last_result] ?? T.flow_state_ringing)
      : snap.nodeIndex === 0
        ? T.flow_cap_received
        : snap.passedSteps === 8
          ? T.flow_state_success
          : snap.failed
            ? T.flow_state_failed
            : T.flow_state_idle;

  const stepCaption: Record<CallStep, string> = {
    preparing_audio: T.flow_cap_tts,
    uploading_audio: T.flow_cap_upload,
    dialing: T.flow_cap_dialing,
    playing: T.flow_cap_playing,
    waiting_retry: T.flow_cap_retry,
  };
  const caption = currentStep
    ? stepCaption[currentStep]
    : snap.failed
      ? T.flow_cap_retry
      : snap.nodeIndex === 0
        ? T.flow_cap_received
        : null;

  const shownStep = Math.min(snap.passedSteps + (busy ? 1 : 0), 8);

  return (
    <article
      className="font-sans"
      style={{
        background: 'var(--sfm-surface)',
        color: 'var(--sfm-ink)',
        border: '1px solid var(--sfm-border)',
        borderRadius: 'var(--sfm-radius)',
        boxShadow: 'var(--sfm-shadow)',
        padding: 16,
      }}
      aria-label={`${T.flow_title} — ${headline}`}
    >
      {/* ── 1 หัวการ์ด ─────────────────────────────────────────────────── */}
      <header className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className={cn('relative shrink-0 rounded-full', busy && 'sfm-ring')}
            style={
              {
                width: 8,
                height: 8,
                background: snap.color,
                '--sfm-state': snap.color,
              } as CSSProperties
            }
          />
          <h2 className="truncate text-[17px] leading-tight font-bold">{T.flow_title}</h2>
          <span
            className="shrink-0 rounded-full px-2 py-px font-mono text-[10px] tracking-[0.08em]"
            style={{
              background: 'var(--sfm-surface-sunk)',
              border: '1px solid var(--sfm-hairline)',
              color: 'var(--sfm-muted)',
            }}
          >
            {T.flow_req(pending.length)}
          </span>
          {/* ดีไซน์ไม่มีป้ายนี้ แต่ระบบจริงต้องมี — ถ้าโมดูลหลุด ทุกอย่างบนการ์ดนี้
              หยุดเดินโดยไม่มีอะไรบอกสาเหตุเลย ผู้ใช้จะนึกว่าเว็บค้าง */}
          {gsmConnected === false ? (
            <span
              className="shrink-0 rounded-full px-2 py-px text-[10.5px] whitespace-nowrap"
              style={{
                background: 'color-mix(in srgb, var(--sfm-red) 12%, var(--sfm-surface))',
                border: '1px solid var(--sfm-red)',
                color: 'var(--sfm-red)',
              }}
            >
              {T.flow_gsm_offline}
            </span>
          ) : null}
        </div>

        <span
          className="ms-auto max-w-[190px] shrink-0 truncate text-end text-[12.5px] leading-tight"
          style={{ color: snap.color }}
        >
          {headline}
        </span>
      </header>

      {/* ── 2 ป้ายหมวด ─────────────────────────────────────────────────── */}
      <div
        className="mt-4 mb-2 font-mono text-[9.5px] tracking-[0.16em] uppercase"
        style={{ color: 'var(--sfm-muted)' }}
      >
        {T.flow_signal_step} · {shownStep}/8
      </div>

      {/* ── 3 แถบความคืบหน้า 8 ช่อง ─────────────────────────────────────── */}
      <ProgressBar snap={snap} steps={T.flow_steps} T={T} />

      {/* ── 4 เส้นทาง ──────────────────────────────────────────────────────
          ไม่ใช้ overflow-x-auto: คอลัมน์ย่อได้ถึง 56px แถวจึงกว้างต่ำสุดราว 272px
          พอดีจอ 320px อยู่แล้ว ไม่ต้องมีแถบเลื่อน — และที่สำคัญกว่านั้นคือ
          overflow-x ที่ไม่ใช่ visible จะบังคับให้ overflow-y กลายเป็น auto ตามไปด้วย
          วงแหวน sfm-ring ที่ scale เกินขอบโหนดจึงไปดัน scrollbar แนวตั้งขึ้นมาเอง */}
      <div className="mt-4 flex items-start justify-center">
        {NODE_IDS.map((id, i) => {
          const state = nodeStateAt(i, snap);
          // เส้นที่ "กำลังส่ง" คือเส้นที่วิ่งเข้าหาโหนดปัจจุบัน
          const linkPassed = i * 2 + 2 <= snap.passedSteps;
          const linkLive = snap.nodeIndex === i + 1 && !snap.failed;
          return (
            <div key={id} className="contents">
              <NodeTile
                id={id}
                ordinal={ORDINALS[i]}
                label={labels[id]}
                state={state}
                color={snap.color}
                caption={state === 'current' || state === 'failed' ? caption : null}
                flash={i === 0 && apiFlash}
              />
              {i < NODE_IDS.length - 1 ? (
                <Connector passed={linkPassed} live={linkLive} color={snap.color} />
              ) : null}
            </div>
          );
        })}
      </div>

      {/* ── 5 คำอธิบาย ─────────────────────────────────────────────────── */}
      <div className="mt-4 border-t pt-3" style={{ borderColor: 'var(--sfm-hairline)' }}>
        {/* เลขกำกับผูกกับเลขที่อยู่เหนือแต่ละโหนด อ่านคู่กันได้ทันที */}
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {NODE_IDS.map((id, i) => (
            <span key={id} className="flex items-baseline gap-1.5 text-[11.5px]">
              <span
                className="font-mono text-[9.5px] tracking-[0.16em]"
                style={{ color: 'var(--sfm-grey)' }}
              >
                {ORDINALS[i]}
              </span>
              <span style={{ color: 'var(--sfm-muted)' }}>{labels[id]}</span>
            </span>
          ))}
        </div>

        {/* คู่มือสี — จำเป็นเพราะบนจอมีหลายสีพร้อมกัน ถ้าไม่บอกผู้ใช้ต้องเดาเองว่า
            เขียวคือ "เสร็จแล้ว" หรือ "กำลังทำงานปกติ" ซึ่งตีความได้ทั้งสองทาง */}
        <div
          className="mt-2.5 flex flex-wrap gap-x-3.5 gap-y-1.5 border-t pt-2.5"
          style={{ borderColor: 'var(--sfm-hairline)' }}
        >
          {[
            { color: COLOR.green, label: T.flow_legend_done },
            { color: COLOR.blue, label: T.flow_legend_active },
            { color: COLOR.orange, label: T.flow_legend_ringing },
            { color: COLOR.red, label: T.flow_legend_failed },
            { color: COLOR.grey, label: T.flow_legend_pending },
          ].map((item) => (
            <span key={item.label} className="flex items-center gap-1.5">
              <span
                className="block rounded-full"
                style={{ width: 8, height: 8, background: item.color }}
              />
              {/* sans ไม่ใช่ mono ด้วยเหตุผลเดียวกับชื่อโหนด — คำอธิบายทั้งหมดเป็นภาษาไทย */}
              <span className="text-[10.5px]" style={{ color: 'var(--sfm-muted)' }}>
                {item.label}
              </span>
            </span>
          ))}
        </div>
      </div>
    </article>
  );
}

/* ── แถบความคืบหน้า ──────────────────────────────────────────────────────── */

/**
 * 8 ช่อง ช่องละ 1 ขั้น — ช่องที่ผ่านแล้วสูง 6px สีเขียว ช่องปัจจุบันสูง 10px
 * เป็นสีสถานะและหายใจเข้าออก ที่เหลือ 6px เทา แถวสูง 10px คงที่จึงไม่มีอะไรขยับ
 *
 * ที่ต้องให้ช่องปัจจุบันสูงกว่าเพื่อน เพราะถ้าสีเดียวความสูงเท่ากันหมด แถบจะบอกได้
 * แค่ "ไปถึงไหนแล้ว" แต่บอกไม่ได้ว่ากำลังทำอะไรอยู่
 */
function ProgressBar({
  snap,
  steps,
  T,
}: {
  snap: Snapshot;
  steps: readonly string[];
  T: ReturnType<typeof useApp>['T'];
}) {
  const currentIndex = snap.nodeIndex === null ? -1 : snap.passedSteps;
  const aria =
    snap.passedSteps >= steps.length
      ? T.flow_all_steps_done
      : T.flow_step_aria(Math.min(snap.passedSteps + 1, 8), steps[Math.min(snap.passedSteps, 7)]);

  return (
    <div className="flex h-[10px] items-center gap-[4px]" role="img" aria-label={aria}>
      {steps.map((step, i) => {
        const passed = i < snap.passedSteps;
        const current = i === currentIndex;
        return (
          <span
            key={step}
            title={step}
            className={cn('flex-1 rounded-full', current && 'sfm-seg-current')}
            style={{
              height: current ? 10 : 6,
              background: current ? snap.color : passed ? COLOR.green : COLOR.grey,
              opacity: current || passed ? 1 : 0.42,
              transition: 'height 260ms ease, background-color 260ms ease, opacity 260ms ease',
            }}
          />
        );
      })}
    </div>
  );
}

/* ── โหนดและเส้นเชื่อม ───────────────────────────────────────────────────── */

const TILE = 54;
/** ช่องว่างบน/ล่างโหนดสูงคงที่ กันการ์ดกระตุกตอน badge หรือ caption โผล่/หาย */
const SLOT_TOP = 22;
const CAPTION_SLOT = 32;

function NodeTile({
  id,
  ordinal,
  label,
  state,
  color,
  caption,
  flash,
}: {
  id: NodeId;
  ordinal: string;
  label: string;
  state: NodeState;
  color: string;
  caption: string | null;
  flash: boolean;
}) {
  const Icon = NODE_ICONS[id];
  // คำขอใหม่เพิ่งเข้ามา — ให้โหนด API สว่างขึ้นชั่วครู่แม้จะผ่านขั้นนี้ไปแล้ว
  const live = state === 'current' || state === 'failed' || flash;

  const accent = state === 'failed' ? COLOR.red : flash ? COLOR.blue : color;
  const stroke =
    state === 'current' || flash
      ? accent
      : state === 'failed'
        ? COLOR.red
        : state === 'passed'
          ? COLOR.green
          : COLOR.grey;
  const tint =
    state === 'current' || flash
      ? `color-mix(in srgb, ${accent} 12%, var(--sfm-surface))`
      : state === 'failed'
        ? `color-mix(in srgb, ${COLOR.red} 12%, var(--sfm-surface))`
        : state === 'passed'
          ? `color-mix(in srgb, ${COLOR.green} 8%, var(--sfm-surface))`
          : 'var(--sfm-surface-sunk)';

  const ringing = state === 'current' && id === 'phone';

  return (
    // คอลัมน์กว้างกว่าตัวโหนด (54px) เพื่อให้ชื่อกับ caption มีที่อยู่ในกระแสปกติ
    // ไม่ต้องวางลอยแบบ absolute ซึ่งล้นออกนอกคอลัมน์แล้วโดนตัด
    <div className="flex w-[92px] min-w-[56px] flex-col items-center">
      {/* ช่องบน — badge ✓ / ! หรือเลขกำกับเมื่อไม่มีทั้งสองอย่าง */}
      <div className="flex items-end justify-center" style={{ height: SLOT_TOP }}>
        {state === 'passed' ? (
          <Badge color={COLOR.green}>
            <CheckIcon />
          </Badge>
        ) : state === 'failed' ? (
          <Badge color={COLOR.red}>
            <BangIcon />
          </Badge>
        ) : (
          <span
            className="font-mono text-[10px] tracking-[0.16em]"
            style={{ color: state === 'current' ? accent : COLOR.grey }}
          >
            {ordinal}
          </span>
        )}
      </div>

      <div
        className={cn(
          'relative mt-1.5 flex items-center justify-center',
          live && 'sfm-ring',
          ringing && 'sfm-vibrate',
        )}
        style={
          {
            width: TILE,
            height: TILE,
            borderRadius: 16,
            border: `1.5px solid ${stroke}`,
            background: tint,
            color: stroke,
            '--sfm-state': accent,
            transition: 'border-color 280ms ease, background-color 280ms ease, color 280ms ease',
          } as CSSProperties
        }
      >
        <Icon aria-hidden />
      </div>

      <div className="mt-2 w-full px-0.5 text-center">
        {/* ชื่อโหนดใช้ font-sans ไม่ใช่ mono — Space Mono ไม่มีตัวอักษรไทย
            "เสาสัญญาณ 4G" จะ fallback ไปฟอนต์อื่นทั้งที่ "API Gateway" ยังเป็น mono
            กลายเป็นสองฟอนต์ปนกันในแถวเดียว และตัวไทยที่ fallback มายังตัดบรรทัดเพี้ยนด้วย
            (label ไทยยาวกว่า EN — ปล่อยให้ตัดบรรทัดได้ ห้าม nowrap) */}
        <div className="text-[10.5px] leading-[1.35]" style={{ color: 'var(--sfm-muted)' }}>
          {label}
        </div>
        {/* ช่อง caption สูงคงที่ กันการ์ดกระตุกตอนข้อความโผล่/หาย */}
        <div style={{ minHeight: CAPTION_SLOT }}>
          {caption ? (
            <div
              className="sfm-fade mt-0.5 text-[11.5px] leading-[1.35]"
              style={{ color: state === 'failed' ? COLOR.red : color }}
            >
              {caption}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function Badge({ color, children }: { color: string; children: ReactNode }) {
  return (
    <span
      className="sfm-fade flex items-center justify-center rounded-full"
      style={{ width: 18, height: 18, background: color, color: 'var(--sfm-surface)' }}
      aria-hidden
    >
      {children}
    </span>
  );
}

function Connector({ passed, live, color }: { passed: boolean; live: boolean; color: string }) {
  return (
    // max-w กันเส้นยืดจนสุดขอบการ์ดบนจอกว้าง — ถ้าปล่อย flex-1 อิสระ โหนดจะกระจาย
    // ห่างกันเป็นร้อย px จนอ่านไม่ออกว่าเป็นเส้นทางเดียวกัน (การ์ดนี้กว้างเต็มหน้า dashboard)
    <div
      className="relative min-w-[16px] max-w-[104px] flex-1"
      style={{ height: TILE, marginTop: SLOT_TOP + 6 }}
      aria-hidden
    >
      <div
        className="absolute top-1/2 right-1 left-1 -mt-px"
        style={{
          height: 2,
          borderRadius: 2,
          background: passed
            ? COLOR.green
            : `repeating-linear-gradient(to right, ${COLOR.grey} 0 4px, transparent 4px 8px)`,
          opacity: passed ? 1 : 0.55,
          transition: 'background 280ms ease, opacity 280ms ease',
        }}
      />
      {live ? (
        <div
          className="absolute top-1/2 right-1 left-1"
          style={{ '--sfm-state': color } as CSSProperties}
        >
          <span className="sfm-travel" />
          <span className="sfm-travel" />
          <span className="sfm-travel" />
        </div>
      ) : null}
    </div>
  );
}

/* ── ไอคอน ───────────────────────────────────────────────────────────────── */

const iconBase: SVGProps<SVGSVGElement> = {
  viewBox: '0 0 24 24',
  width: 24,
  height: 24,
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
};

/** API Gateway — payload ลอดผ่านวงเล็บปีกกา */
function ApiIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...iconBase} {...props}>
      <path d="M8.5 6 4 12l4.5 6M15.5 6l4.5 6-4.5 6" />
      <path d="M13.4 5.2 10.6 18.8" />
    </svg>
  );
}

/** Raspberry Pi — บอร์ดที่มีชิปกับ header pin */
function PiIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...iconBase} {...props}>
      <rect x="3" y="5.5" width="18" height="13" rx="2" />
      <rect x="9" y="10.5" width="6" height="5" rx="1" />
      <path d="M6 8.5h1.5M9.5 8.5H11M13 8.5h1.5M16.5 8.5H18" />
    </svg>
  );
}

/** เสาสัญญาณ 4G — เสาที่ปล่อยคลื่นออก 2 ชั้น */
function TowerIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...iconBase} {...props}>
      <path d="M12 9.5V20M9 20h6" />
      <path d="M8.8 8.4a4.4 4.4 0 0 1 6.4 0" />
      <path d="M5.9 5.6a8.6 8.6 0 0 1 12.2 0" />
      <circle cx="12" cy="7.6" r="1.15" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** โทรศัพท์ปลายทาง */
function PhoneIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...iconBase} {...props}>
      <rect x="6.5" y="2.5" width="11" height="19" rx="2.5" />
      <path d="M10.5 18.5h3" />
      <path d="M9.5 6h5" opacity="0.55" />
    </svg>
  );
}

const NODE_ICONS: Record<NodeId, (props: SVGProps<SVGSVGElement>) => ReactElement> = {
  api: ApiIcon,
  pi: PiIcon,
  tower: TowerIcon,
  phone: PhoneIcon,
};

function CheckIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...iconBase} width={11} height={11} strokeWidth={2.8} {...props}>
      <path d="M4.5 12.5 9.5 17.5 19.5 6.5" />
    </svg>
  );
}

function BangIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...iconBase} width={11} height={11} strokeWidth={2.8} {...props}>
      <path d="M12 4.5v9.5" />
      <path d="M12 19h.01" />
    </svg>
  );
}
