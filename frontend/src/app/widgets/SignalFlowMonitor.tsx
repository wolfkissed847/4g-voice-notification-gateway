/**
 * SignalFlowMonitor — การ์ดติดตามงานแจ้งเตือน 1 งาน ตั้งแต่ API รับเรื่องจนปลายสายได้ยินเสียง
 *
 * พอร์ตหน้าตาจาก figma/Redesign Corporate Web App (ดีไซน์รอบใหม่) บนชั้นข้อมูลเดิมทั้งหมด
 *
 * ── สิ่งที่เอามาจากดีไซน์ใหม่ ──────────────────────────────────────────────
 * 1. แถบความคืบหน้าแบ่งเป็น 4 ช่วง "กว้างไม่เท่ากันตามเวลาที่ใช้จริง" (12/18/40/30)
 *    ของเดิมแบ่ง 8 ช่องเท่ากัน ซึ่งทำให้ขั้นอัปโหลดเสียงที่กินเวลา 15-20 วิ
 *    ดูเหมือนสั้นเท่าขั้นแปลงข้อความที่ใช้ไม่ถึงวินาที
 * 2. โหนดเป็นไทล์มุมมนพร้อมเลขลำดับ 01-04 และวงกระเพื่อมรอบไทล์ที่กำลังทำงาน
 * 3. เส้นเชื่อมเป็น SVG เส้นประที่ไหลไปข้างหน้า + จุดวิ่งตามเส้น
 * 4. ท้ายการ์ดมีแถวดัชนีโหนดกับคำอธิบายสี 5 สถานะ
 *
 * ── สิ่งที่ดีไซน์ใหม่ยังไม่ได้ทำ แล้วเติมให้ที่นี่ ──────────────────────────
 * ไฟล์ดีไซน์รู้จักแค่ 4 ขั้นและวาดได้ 3 สถานะ (ผ่านแล้ว / กำลังทำ / ยังไม่ถึง)
 * แต่คำอธิบายสีท้ายการ์ดของมันโฆษณาไว้ 5 สถานะ — "กำลังโทร" กับ "ล้มเหลว"
 * ไม่มีโค้ดที่ทำให้เกิดขึ้นได้เลย ทั้งที่ backend ของเรารายงานทั้งคู่จริง
 * ที่นี่จึงต่อครบ: ขั้น waiting_retry (ขั้นที่ 5 ที่ worker รายงาน), สีส้มตอนกำลังเรียก,
 * สีแดงตอนสายไม่สำเร็จ, ป้ายโมดูลหลุด และไฟกะพริบตอนมีคำขอใหม่ยิงเข้ามา
 *
 * ── ระบบสี ────────────────────────────────────────────────────────────────
 * เขียว = ผ่านแล้ว · น้ำเงิน = กำลังทำ · ส้ม = กำลังเรียก · แดง = ล้มเหลว · เทา = ยังไม่ถึง
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

/**
 * ความกว้างของแต่ละช่วงบนแถบ = สัดส่วนเวลาที่ขั้นนั้นใช้จริง ไม่ใช่แบ่งเท่ากัน
 *
 *   รับคำขอ  ทันที          → 12%
 *   แปลงเสียง ~1-2 วิ        → 18%
 *   อัปโหลดเข้าโมดูล 15-20 วิ → 40%   ← ขั้นที่กินเวลาที่สุด
 *   โทร + เล่นเสียง 20-60 วิ  → 30%
 *
 * แบ่งเท่ากันจะทำให้แถบนิ่งสนิทอยู่ช่องเดียวเกือบตลอดสาย จนดูเหมือนระบบค้าง
 */
const SEG_WIDTH = ['12%', '18%', '40%', '30%'];

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

/** สัดส่วนที่เติมแล้วของช่วงที่ i (0-1) — โหนดละ 2 ขั้นจาก 8 ขั้น */
function segFill(index: number, snap: Snapshot, currentStep: CallStep | null, progress: number | null): number {
  // ขั้นอัปโหลดวัดความคืบหน้าได้จริง ใช้ค่าที่ worker รายงานแทนการปัดเป็นครึ่งช่อง
  if (index === 2 && currentStep === 'uploading_audio' && progress != null) {
    return Math.max(0, Math.min(1, progress));
  }
  return Math.max(0, Math.min(1, (snap.passedSteps - index * 2) / 2));
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
  const idle = snap.nodeIndex === null && snap.passedSteps === 0;

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
  // คำกำกับสั้นๆ ต่อขั้น ใช้ในกล่องรายละเอียดท้ายการ์ด
  const stepCaption: Record<CallStep, string> = {
    preparing_audio: T.flow_cap_tts,
    uploading_audio: T.flow_cap_upload,
    dialing: T.flow_cap_dialing,
    playing: T.flow_cap_playing,
    waiting_retry: T.flow_cap_retry,
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

  const detailCaption = currentStep ? stepCaption[currentStep] : idle ? T.flow_cap_idle : '';

  const shownStep = snap.nodeIndex === null ? (snap.passedSteps === 8 ? 4 : 0) : snap.nodeIndex + 1;

  const legend = [
    { label: T.flow_legend_done, color: COLOR.green },
    { label: T.flow_legend_active, color: COLOR.blue },
    { label: T.flow_legend_ringing, color: COLOR.orange },
    { label: T.flow_legend_failed, color: COLOR.red },
    { label: T.flow_legend_pending, color: COLOR.grey },
  ];

  return (
    <article
      /* h-full + flex column: การ์ดนี้อยู่ในแถวที่ยืดได้ ถ้าไม่รับความสูงมาใช้
         มันจะสูงตามเนื้อหาแล้วเหลือพื้นที่ว่างใต้การ์ดเป็นแถบยาว */
      className="flex h-full flex-col font-sans"
      style={{
        background: 'var(--sfm-surface)',
        color: 'var(--sfm-ink)',
        border: '1px solid var(--sfm-border)',
        borderRadius: 'var(--sfm-radius)',
        boxShadow: 'var(--sfm-shadow)',
        padding: 14,
      }}
      aria-label={`${T.flow_title} — ${headline}`}
    >
      {/* ── หัวการ์ด ─────────────────────────────────────────────────────── */}
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <span
          className={cn('block shrink-0 rounded-full', !idle && 'sfm-ring')}
          style={
            {
              width: 8,
              height: 8,
              background: idle ? COLOR.grey : snap.color,
              '--sfm-state': snap.color,
            } as CSSProperties
          }
        />
        <h2 className="text-caption font-bold">{T.flow_title}</h2>

        <Chip color={COLOR.blue}>{T.flow_req(pending.length)}</Chip>
        {gsmConnected === false ? <Chip color={COLOR.red}>{T.flow_gsm_offline}</Chip> : null}

        <span className="ms-auto font-mono text-micro" style={{ color: 'var(--sfm-muted)' }}>
          {busy || snap.failed ? headline : T.flow_state_idle}
        </span>
      </div>

      <p className="mb-2 font-mono text-micro" style={{ color: 'var(--sfm-muted)' }}>
        {T.flow_signal_step} · {shownStep}/4
      </p>

      {/* ── แถบความคืบหน้า 4 ช่วง กว้างตามเวลาที่ใช้จริง ──────────────────── */}
      <div className="mb-4 flex gap-1" style={{ height: 3 }} aria-hidden="true">
        {NODE_IDS.map((id, i) => {
          const state = nodeStateAt(i, snap);
          const fill = segFill(i, snap, currentStep, progress);
          // ขั้นที่วัดความคืบหน้าไม่ได้ (โทรออก/เล่นเสียง) ใช้แถบเรืองแทนตัวเลขปลอม
          const indeterminate = state === 'current' && !(i === 2 && currentStep === 'uploading_audio');
          const barColor = state === 'failed' ? COLOR.red : state === 'passed' ? COLOR.green : snap.color;
          return (
            <div
              key={id}
              style={{
                width: SEG_WIDTH[i],
                flex: 'none',
                background: 'var(--sfm-surface-sunk)',
                borderRadius: 2,
                overflow: 'hidden',
              }}
            >
              <div
                className={cn(indeterminate && 'sfm-shimmer')}
                style={{
                  height: '100%',
                  width: `${(indeterminate ? 0.5 : fill) * 100}%`,
                  borderRadius: 2,
                  background: indeterminate
                    ? `linear-gradient(90deg, ${barColor} 0%, var(--sfm-surface-sunk) 50%, ${barColor} 100%)`
                    : barColor,
                  transition: 'width 500ms ease',
                }}
              />
            </div>
          );
        })}
      </div>

      {/* ── โหนดกับเส้นเชื่อม ─────────────────────────────────────────────── */}
      {/* flex-1 + จัดกึ่งกลาง: แผนภาพคือของชิ้นหลักของการ์ด จึงให้มันกินที่ว่างที่เหลือ
          แล้วลอยอยู่กลางแทนที่จะเกาะขอบบนโดยมีที่ว่างค้างอยู่ใต้กล่องรายละเอียด */}
      <div
        style={{ overflowX: 'auto', margin: '0 -4px' }}
        className="flex min-h-0 flex-1 items-center overscroll-x-contain pb-1"
      >
        <div className="flex w-full items-start px-1" style={{ minWidth: 300 }}>
          {NODE_IDS.map((id, i) => {
            const state = nodeStateAt(i, snap);
            const last = i === NODE_IDS.length - 1;
            return (
              <div
                key={id}
                className="flex items-start"
                style={{ flex: last ? '0 0 auto' : '1 1 0', minWidth: 0 }}
              >
                <FlowNode
                  id={id}
                  ordinal={ORDINALS[i]}
                  label={labels[id]}
                  state={state}
                  color={snap.color}
                  flash={i === 0 && apiFlash}
                />
                {!last ? (
                  <div style={{ flex: 1, minWidth: 20, padding: '0 4px', marginTop: 40 }}>
                    <Connector
                      passed={(i + 1) * 2 <= snap.passedSteps}
                      live={state === 'current' || state === 'failed'}
                      color={state === 'failed' ? COLOR.red : snap.color}
                    />
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── ท้ายการ์ด: ดัชนีโหนด + คำอธิบายสี ────────────────────────────── */}
      <div className="mt-3 flex flex-col gap-2 pt-2.5" style={{ borderTop: '1px solid var(--sfm-hairline)' }}>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {legend.map((l) => (
            <span key={l.label} className="flex items-center gap-1.5">
              <span className="block rounded-full" style={{ width: 7, height: 7, background: l.color }} />
              <span className="text-micro" style={{ color: 'var(--sfm-muted)' }}>
                {l.label}
              </span>
            </span>
          ))}
        </div>
      </div>

      {/* กล่องรายละเอียดท้ายการ์ด — อยู่ตลอดทุกสถานะ ไม่ใช่โผล่เฉพาะตอนอัปโหลดแบบเดิม
          ของเดิมกล่องนี้เด้งเข้าเด้งออกตามขั้นตอน ทำให้การ์ดสูงขึ้น-เตี้ยลงกลางการโทร
          แล้วดันของที่อยู่ใต้มันทั้งหน้าขยับตาม ซึ่งกวนสายตามากบนหน้าที่เปิดค้างไว้ดู

          ขั้นอัปโหลดยังเป็นขั้นเดียวที่วัดความคืบหน้าได้ จึงต่อเปอร์เซ็นต์ท้ายข้อความ
          เฉพาะขั้นนั้น — ไม่งั้นคนดูจะนึกว่าค้างเพราะมันกินเวลาราว 40% ของทั้งสาย */}
      <p
        className="mt-2 flex flex-wrap items-baseline gap-x-1.5 rounded-control px-3 py-1.5"
        style={{ background: 'var(--sfm-surface-sunk)' }}
      >
        <span className="text-caption" style={{ color: 'var(--sfm-ink)' }}>
          {headline}
          {currentStep === 'uploading_audio' && progress != null ? ` ${Math.round(progress * 100)}%` : ''}
        </span>
        {/* ไม่โชว์คำกำกับถ้ามันซ้ำกับบรรทัดหลักอยู่แล้ว */}
        {detailCaption && detailCaption !== headline ? (
          <span className="text-micro" style={{ color: 'var(--sfm-muted)' }}>
            {detailCaption}
          </span>
        ) : null}
      </p>
    </article>
  );
}

/* ── ชิ้นส่วน ────────────────────────────────────────────────────────────── */

const TILE = 40;

function FlowNode({
  id,
  ordinal,
  label,
  state,
  color,
  flash,
}: {
  id: NodeId;
  ordinal: string;
  label: string;
  state: NodeState;
  color: string;
  flash: boolean;
}) {
  const Icon = NODE_ICONS[id];
  const live = state === 'current' || state === 'failed';
  const tone = state === 'failed' ? COLOR.red : state === 'passed' ? COLOR.green : live ? color : COLOR.grey;

  return (
    <div className="flex shrink-0 flex-col items-center gap-1.5" style={{ width: 64 }}>
      <span className="font-mono text-micro" style={{ color: 'var(--sfm-muted)' }}>
        {ordinal}
      </span>

      <span
        className={cn('relative grid place-items-center rounded-control', (live || flash) && 'sfm-ring')}
        style={
          {
            width: TILE,
            height: TILE,
            color: tone,
            // พื้นอ่อนเฉพาะโหนดที่ "มีอะไรเกิดขึ้น" — โหนดที่ยังไม่ถึงใช้พื้นจมเรียบๆ
            background: state === 'pending' ? 'var(--sfm-surface-sunk)' : `color-mix(in oklab, ${tone} 14%, transparent)`,
            border: state === 'pending' ? '1px solid var(--sfm-border)' : `1.5px solid ${tone}`,
            transition: 'color 300ms ease, background 300ms ease, border-color 300ms ease',
            '--sfm-state': tone,
          } as CSSProperties
        }
      >
        <Icon width={18} height={18} />

        {/* ตราผลลัพธ์มุมขวาบน — ติ๊กถูกเมื่อผ่านแล้ว เครื่องหมายตกใจเมื่อพัง */}
        {state === 'passed' || state === 'failed' ? (
          <span
            className="absolute grid place-items-center rounded-full"
            style={{
              top: -5,
              insetInlineEnd: -5,
              width: 16,
              height: 16,
              background: state === 'passed' ? COLOR.green : COLOR.red,
              color: 'var(--sfm-surface)',
            }}
          >
            {state === 'passed' ? <CheckIcon /> : <BangIcon />}
          </span>
        ) : null}
      </span>

      <span
        className="text-center text-micro leading-tight"
        style={{ color: live ? 'var(--sfm-ink)' : 'var(--sfm-muted)', maxWidth: 64 }}
      >
        {label}
      </span>
    </div>
  );
}

/**
 * เส้นเชื่อมระหว่างโหนด — เส้นประฐานสีเทาเสมอ ทับด้วยเส้นประสีที่ไหลไปข้างหน้า
 * เมื่อช่วงนั้นกำลังทำงาน และมีจุดวิ่งตามเส้นบอกทิศทางการไหลของข้อมูล
 */
function Connector({ passed, live, color }: { passed: boolean; live: boolean; color: string }) {
  return (
    <svg
      width="100%"
      height="16"
      viewBox="0 0 100 16"
      preserveAspectRatio="none"
      style={{ overflow: 'visible', display: 'block' }}
      aria-hidden="true"
    >
      <line x1="0" y1="8" x2="100" y2="8" stroke="var(--sfm-hairline)" strokeWidth="1.5" strokeDasharray="4 4" />
      {passed || live ? (
        <line
          className={cn(live && 'sfm-dash')}
          x1="0"
          y1="8"
          x2="100"
          y2="8"
          stroke={passed && !live ? COLOR.green : color}
          strokeWidth="1.5"
          strokeDasharray="4 4"
        />
      ) : null}
      {live ? (
        <circle r="2.6" cy="8" fill={color}>
          <animateMotion dur="1.2s" repeatCount="indefinite" path="M0,0 L100,0" />
        </circle>
      ) : null}
    </svg>
  );
}

function Chip({ color, children }: { color: string; children: ReactNode }) {
  return (
    <span
      className="rounded-full px-2 py-0.5 text-micro font-semibold whitespace-nowrap"
      style={{ color, background: `color-mix(in oklab, ${color} 14%, transparent)` }}
    >
      {children}
    </span>
  );
}

/* ── ไอคอน ───────────────────────────────────────────────────────────────── */

const iconBase: SVGProps<SVGSVGElement> = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
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
    <svg {...iconBase} width={10} height={10} strokeWidth={3} {...props}>
      <path d="M4.5 12.5 9.5 17.5 19.5 6.5" />
    </svg>
  );
}

function BangIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...iconBase} width={10} height={10} strokeWidth={3} {...props}>
      <path d="M12 4.5v9.5" />
      <path d="M12 19h.01" />
    </svg>
  );
}
