/**
 * Design primitives — พอร์ตจาก figma/handoff/components/ui-primitives.tsx
 *
 * ── ต่างจากต้นฉบับ 2 จุด ──────────────────────────────────────────────
 * 1. utility class `accent` → `brand` ทุกที่ (ดูเหตุผลใน src/styles/tw-theme.css)
 *    ชื่อ *tone* ยังเป็น 'accent' ตามต้นฉบับ เพื่อให้ component ที่ส่ง tone="accent"
 *    เข้ามาใช้ได้โดยไม่ต้องแก้ — เปลี่ยนแค่คลาสที่ mapping ไป
 * 2. import cn จาก @/app/components/ui/utils (ต้นฉบับใช้ @/lib/utils)
 *
 * กฎที่ยึดทุกที่: ไม่มี inline style, ไม่มีความสูงคงที่กับกล่องที่มีข้อความ
 * (ไทยสูงกว่า EN เพราะวรรณยุกต์) — ใช้ padding + min-h-* แทน
 */
import type { ReactNode } from 'react';
import { cn } from '@/app/components/ui/utils';

/* recipe ของ Tailwind classes ที่ใช้ซ้ำทั้งดีไซน์ */
export const card = 'bg-surface border border-line rounded-card shadow-card';
export const control = 'bg-surface-2 border border-line rounded-control';
export const inputCls =
  'w-full bg-surface-2 border border-line rounded-control px-3 py-3 text-body outline-none focus:border-brand-strong';
export const monoCls = 'font-mono text-caption whitespace-nowrap';

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn(card, className)}>{children}</div>;
}

export function CardHead({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-line px-4 py-3.5">
      <h3 className="text-lead font-bold">{title}</h3>
      {hint ? <p className="min-w-0 font-mono text-micro text-ink-2">{hint}</p> : null}
      {action ? <div className="ms-auto">{action}</div> : null}
    </div>
  );
}

export function PageHeader({ title, meta, action }: { title: string; meta?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="min-w-0">
        {/* text-page เป็น clamp — ห้ามใส่ font-size คงที่กับหัวข้อหน้า */}
        <h1 className="text-page font-bold">{title}</h1>
        {meta ? <p className="mt-1 font-mono text-caption text-ink-2">{meta}</p> : null}
      </div>
      {action ? <div className="ms-auto">{action}</div> : null}
    </div>
  );
}

export type Tone = 'ok' | 'warn' | 'bad' | 'accent' | 'muted';

const toneRing: Record<Tone, string> = {
  ok: 'border-ok text-ok-strong bg-ok-soft',
  warn: 'border-warn text-warn-strong bg-warn-soft',
  bad: 'border-bad text-bad-strong bg-bad-soft',
  accent: 'border-brand-strong text-brand-strong bg-brand-soft',
  muted: 'border-line text-ink-2 bg-transparent',
};

const toneDot: Record<Tone, string> = {
  ok: 'bg-ok',
  warn: 'bg-warn',
  bad: 'bg-bad',
  accent: 'bg-brand',
  muted: 'bg-ink-2',
};

/** badge สถานะ — ข้อความไทยสั้น ใช้ nowrap ได้ */
export function Pill({ tone = 'muted', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className={cn('rounded-full border px-2.5 py-0.5 text-micro font-medium whitespace-nowrap', toneRing[tone])}>
      {children}
    </span>
  );
}

export function Dot({ tone = 'muted', pulse = false }: { tone?: Tone; pulse?: boolean }) {
  return <span className={cn('size-2 shrink-0 rounded-full', toneDot[tone], pulse && 'animate-soft-pulse')} />;
}

/** min-w-0 บนตัวการ์ด: เป็น grid item เสมอ ถ้าไม่ใส่ ข้อความยาวใน foot (เช่นชื่อผู้ให้บริการ)
 *  จะดันคอลัมน์กว้างเกินจนทั้งหน้าเลื่อนแนวนอนได้บนมือถือ */
/**
 * ช่องตัวเลขสรุปบนหัวหน้าภาพรวม
 *
 * alert = ช่องนี้กำลังบอกเรื่องผิดปกติ ไม่ใช่แค่ตัวเลข — ตีกรอบและลงพื้นสีแดง
 * ให้เห็นจากหางตาโดยไม่ต้องมีแถบเตือนแยกอีกแถบเหนือแถวนี้
 */
export function StatTile({
  label,
  value,
  foot,
  alert,
}: {
  label: string;
  value: ReactNode;
  foot?: ReactNode;
  alert?: boolean;
}) {
  return (
    <div
      className={cn(
        card,
        'animate-fade-up min-w-0 p-4 transition-transform duration-200 hover:-translate-y-0.5 hover:shadow-card',
        alert && 'border-bad bg-bad-soft/35',
      )}
    >
      <p className="text-caption text-ink-2">{label}</p>
      <p className="mt-1 font-mono text-h2 font-bold break-words">{value}</p>
      {foot ? <div className="mt-2 font-mono text-micro break-words text-ink-2">{foot}</div> : null}
    </div>
  );
}

/** ปุ่ม — py-3 ให้ hit target ≥44px บนมือถือ */
export function Btn({
  variant = 'ghost',
  className,
  children,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'danger' | 'dashed' }) {
  const map = {
    primary: 'bg-brand text-brand-ink border-transparent hover:brightness-110',
    ghost: 'bg-surface-2 text-ink border-line hover:border-brand-strong',
    danger: 'bg-bad-strong text-status-ink border-bad-strong',
    dashed: 'bg-transparent text-brand-strong border-dashed border-line',
  } as const;
  return (
    <button
      type="button"
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-control border px-4 py-3 text-caption font-medium transition-colors',
        map[variant],
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

/** แท็บ/ชิปกรอง — flex-wrap เสมอ เพราะ label ไทยยาวกว่า EN */
export function ChipRow({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-1.5">{children}</div>;
}

export function Chip({ active, children, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return (
    <button
      type="button"
      className={cn(
        'rounded-full border px-3.5 py-2 text-caption transition-colors',
        active ? 'border-brand-strong bg-brand-soft font-semibold text-brand-strong' : 'border-line bg-surface text-ink hover:border-brand-strong',
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex min-w-0 flex-col gap-1.5">
      <span className="text-caption text-ink-2">{label}</span>
      {children}
    </label>
  );
}

/** แถว key แบบปิดบัง + ปุ่มคัดลอก
 *  min-w-0 บน span คือสิ่งที่ทำให้ truncate ทำงานใน flex — ห้ามลบ */
export function KeyRow({
  masked,
  copied,
  onCopy,
  copyLabel,
  copiedLabel,
}: {
  masked: string;
  copied: boolean;
  onCopy: () => void;
  copyLabel: string;
  copiedLabel: string;
}) {
  return (
    <div className={cn(control, 'flex items-center gap-2 px-2.5 py-2')}>
      <span className="min-w-0 flex-1 truncate font-mono text-caption">{masked}</span>
      <button
        type="button"
        onClick={onCopy}
        className="shrink-0 rounded-md border border-line bg-surface px-2 py-0.5 font-mono text-micro whitespace-nowrap"
      >
        {copied ? `✓ ${copiedLabel}` : copyLabel}
      </button>
    </div>
  );
}

export function Divider() {
  return <div className="h-px bg-line" />;
}

/** กล่องโค้ดพื้นเข้ม — สีคงที่ทั้ง light/dark โดยเจตนา (โค้ดอ่านง่ายกว่าบนพื้นเข้มเสมอ) */
export function CodePanel({
  lang,
  status,
  copied,
  onCopy,
  copyLabel,
  copiedLabel,
  children,
}: {
  lang: string;
  status?: { code: string; tone: 'ok' | 'bad' };
  copied: boolean;
  onCopy: () => void;
  copyLabel: string;
  copiedLabel: string;
  children: ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-card border border-[#2a3140] bg-[#12161e]">
      <div className="flex items-center gap-2.5 border-b border-[#2a3140] px-3 py-2">
        <span className="font-mono text-caption text-[#7c8798]">{lang}</span>
        {status ? (
          <span
            className={cn(
              'rounded px-1.5 py-px font-mono text-micro font-bold',
              status.tone === 'ok' ? 'bg-[#14532d] text-[#86efac]' : 'bg-[#4c1d24] text-[#fca5a5]',
            )}
          >
            {status.code}
          </span>
        ) : null}
        <button
          type="button"
          onClick={onCopy}
          className="ms-auto font-mono text-caption text-[#7c8798] hover:text-[#cbd5e1]"
        >
          ⧉ {copied ? copiedLabel : copyLabel}
        </button>
      </div>
      <pre className="overflow-x-auto px-3 py-3.5 font-mono text-caption leading-[1.9] text-[#cbd5e1]">{children}</pre>
    </div>
  );
}

/** หัวตาราง/แถว: กริดชุดเดียวกันทั้ง header และ body — เปลี่ยนที่เดียว
 *  ตารางคอลัมน์แน่นให้ห่อด้วย <div className="overflow-x-auto"> แล้วใส่ min-w ที่แถว */
export const apiGridCls = 'grid gap-2.5 grid-cols-[minmax(88px,1.1fr)_minmax(58px,0.7fr)_minmax(120px,2.2fr)]';
export const logGridCls =
  'grid gap-2.5 min-w-[560px] grid-cols-[minmax(96px,0.8fr)_minmax(110px,1.1fr)_minmax(110px,1.1fr)_minmax(96px,0.9fr)_minmax(70px,0.6fr)]';
