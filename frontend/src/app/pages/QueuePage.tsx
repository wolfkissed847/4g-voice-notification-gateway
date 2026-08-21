/**
 * QueuePage — คิวงานโทรที่รอ/กำลังทำงาน
 *
 * ดีไซน์ใหม่ไม่มีหน้านี้ (ยุบเป็น pipeline counters ในหน้าภาพรวม) แต่ backend เรามีคิวจริง
 * และเป็นข้อมูลที่ต้องดูตอนเกิดเหตุ จึงเก็บหน้าไว้แล้วปรับให้ใช้ token ชุดใหม่
 *
 * ── ที่แก้จากเวอร์ชันเดิม ──────────────────────────────────────────────────
 * 1. hardcode hex 28 จุด (#0F172A, #2d5d83, bg-white, dark:bg-[#1a1a1a] ...) → token
 * 2. ตัด MOCK_QUEUE ออก — เดิมคิวว่างแล้วโชว์ข้อมูลปลอม 3 แถวพร้อมป้าย "ข้อมูลตัวอย่าง"
 *    ซึ่งอ่านผิดได้ง่ายว่ามีงานค้างจริง หน้านี้เป็นหน้าที่คนเปิดดูตอนฉุกเฉิน
 *    คิวว่างต้องเห็นชัดว่าว่าง จึงเปลี่ยนเป็น empty state จริง
 * 3. ตาราง desktop + การ์ด mobile ของเดิม รวมเป็น grid ชุดเดียวที่เลื่อนแนวนอนได้
 *    ตามกฎในดีไซน์ (บีบตัวอักษรไทยจนอ่านไม่ออกแย่กว่าปล่อยให้เลื่อน)
 */
import { cn } from "@/app/components/ui/utils";
import { getQueueStatus } from "../api/queue";
import { Dot, PageHeader } from "../components/primitives";
import { StatusBadge } from "../components/StatusBadge";
import { useApp } from "../context/AppContext";
import { statusMeanings } from "../lib/callStatus";
import { usePolling } from "../lib/usePolling";
import { SignalFlowMonitor } from "../widgets/SignalFlowMonitor";

/** กริดชุดเดียวใช้ทั้งหัวตารางและแถว — เปลี่ยนคอลัมน์ที่เดียว */
const queueGridCls =
  "grid gap-2.5 min-w-[32.5rem] grid-cols-[minmax(70px,0.6fr)_minmax(120px,1.2fr)_minmax(110px,1fr)_minmax(60px,0.5fr)_minmax(130px,1.2fr)]";

export function QueuePage() {
  const { T } = useApp();
  const { data, loading } = usePolling(getQueueStatus, 4000);
  const items = data?.items ?? [];

  return (
    /* h-full + min-h-0 = หน้านี้สูงเท่าจอพอดี ไม่เลื่อนหน้าเว็บ
       ส่วนที่ยาวไม่จำกัดคือตารางคิว จึงให้มันเป็นตัวเดียวที่เลื่อน (อยู่ในกล่องตัวเอง)
       — คิวยาวแค่ไหนหัวเรื่องกับการ์ดติดตามสัญญาณก็ยังอยู่ที่เดิม ไม่ถูกดันหายขึ้นไป */
    <div className="flex h-full min-h-0 flex-col gap-3.5">
      <PageHeader
        title={T.queue_title}
        meta={T.queue_sub}
        action={
          <span className="flex items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 py-1 font-mono text-micro text-ink-2">
            <Dot tone="accent" pulse />
            {T.queue_live}
          </span>
        }
      />

      {/* ── แถวบน: ติดตามสัญญาณ | ความหมายของสถานะ ────────────────────────
          การ์ดซ้ายบอกว่า "ตอนนี้กำลังทำอะไรกับงานที่หยิบไปแล้ว" ซึ่งเป็นคำถามแรกที่คน
          เปิดหน้านี้ตอนเกิดเหตุอยากรู้ — ตารางข้างล่างเห็นแค่สถานะ in_progress
          แต่ไม่รู้ว่าค้างอยู่ขั้นไหน (แปลงเสียง / อัปโหลด / กำลังโทร)

          การ์ดขวาแปลป้ายสถานะที่อยู่ในตารางข้างล่าง — วางคู่กันเพราะคนที่เปิดหน้านี้
          ตอนเกิดเหตุมักเป็นคนที่ไม่ได้ดูระบบทุกวัน เห็น "ไล่เบอร์ถัดไป" แล้วต้องเดาเอง
          ว่าดีหรือร้าย ถ้าต้องเปิดหน้าคู่มืออีกแท็บเพื่อแปลก็เสียเวลาในจังหวะที่สำคัญที่สุด */}
      <div className="grid items-stretch gap-3.5 xl:grid-cols-2">
        <SignalFlowMonitor />
        <StatusLegend />
      </div>

      {/* min-h-[9.375rem] กันกล่องแบนจนอ่านไม่ออกบนจอเตี้ย — ถ้าเตี้ยกว่านั้นจริงๆ
          ก็ปล่อยให้ทั้งหน้าเลื่อนตามปกติ ดีกว่าบีบตารางจนเหลือครึ่งแถว */}
      <div className="flex min-h-[9.375rem] min-w-0 flex-1 flex-col overflow-hidden rounded-card border border-line bg-surface shadow-card">
        {/* หัวตารางกับแถวข้อมูลอยู่ในกล่องเลื่อนเดียวกัน คอลัมน์จึงเลื่อนแนวนอนพร้อมกัน
            แล้วใช้ sticky ตรึงหัวไว้ตอนเลื่อนลง */}
        <div className="min-h-0 flex-1 overflow-auto overscroll-contain">
          <div
            className={cn(
              queueGridCls,
              "sticky top-0 z-10 border-b border-line bg-surface-2 px-4 py-2.5 font-mono text-micro font-bold text-ink-2",
            )}
          >
            <div>{T.col_id}</div>
            <div>{T.col_group}</div>
            <div>{T.col_status}</div>
            <div>{T.col_retry}</div>
            <div>{T.col_created}</div>
          </div>

          {items.map((item) => (
            <div
              key={item.job_id}
              className={cn(
                queueGridCls,
                "items-center border-b border-line-2 px-4 py-3 font-mono text-caption last:border-b-0",
              )}
            >
              <div className="text-brand-strong">#{item.job_id}</div>
              <div className="min-w-0 truncate font-sans">
                {item.priority_group}
              </div>
              <div>
                <StatusBadge status={item.status} />
              </div>
              <div className="text-ink-2">{item.retry_count}</div>
              <div className="text-ink-2">
                {new Date(item.created_at).toLocaleString()}
              </div>
            </div>
          ))}

          {!loading && items.length === 0 ? (
            <div className="flex flex-col items-center gap-1.5 px-4 py-8 text-center">
              <p className="text-lead font-semibold">{T.queue_empty}</p>
              <p className="text-caption text-ink-2">{T.queue_empty_sub}</p>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/**
 * ความหมายของป้ายสถานะที่โผล่ในตารางคิว
 *
 * ใช้ข้อความชุดเดียวกับหน้าคู่มือ (lib/callStatus) — ถ้าเขียนซ้ำไว้สองที่ วันหนึ่งจะมี
 * หน้าหนึ่งที่อธิบายไม่ตรงกับอีกหน้า
 *
 * overflow-y-auto: รายการมี 8 บรรทัดคงที่ ถ้าจอเตี้ยจนแสดงไม่หมดให้เลื่อนในกล่องนี้
 * ไม่ใช่ดันทั้งหน้าให้ยาวขึ้น — หน้านี้ตั้งใจให้พอดีจอเดียว
 */
function StatusLegend() {
  const { T, lang } = useApp();
  const rows = statusMeanings(lang === "th");

  return (
    <section className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-card border border-line bg-surface shadow-card">
      <div className="shrink-0 border-b border-line bg-surface-2 px-4 py-2">
        <h2 className="text-caption font-bold">{T.queue_legend_title}</h2>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {rows.map((r) => (
          <div
            key={r.status}
            className="flex flex-wrap items-start gap-2.5 border-b border-line-2 px-4 py-1 last:border-b-0"
          >
            {/* min-w ไม่ใช่ w — ป้ายไทยบางอันยาวกว่าที่คิด ("ไล่เบอร์ถัดไป")
                ถ้าตรึงความกว้างตายตัวมันจะล้นไปทับคำอธิบาย ใช้ min-w แทนได้ทั้งสองอย่าง:
                สั้นกว่าก็เรียงตรงกัน ยาวกว่าก็ดันช่องให้กว้างตามแทนที่จะทับ

                ย่อป้ายลงเฉพาะในกล่องนี้ (ไม่แตะ StatusBadge ตัวจริง เพราะตารางคิวกับ
                หน้าประวัติใช้ตัวเดียวกัน และที่นั่นป้ายคือข้อมูล ต้องอ่านง่ายไว้ก่อน)
                — ที่นี่ป้ายเป็นแค่ตัวอ้างอิงประกอบคำอธิบาย เล็กกว่าได้ */}
            <span className="min-w-[6.75rem] shrink-0 [&>span]:px-2 [&>span]:text-[0.6875rem]">
              <StatusBadge status={r.status} />
            </span>
            <span className="min-w-0 flex-1 basis-[11.25rem] text-micro text-ink-2">{r.meaning}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
