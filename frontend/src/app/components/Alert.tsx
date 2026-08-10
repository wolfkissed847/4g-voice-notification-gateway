/**
 * Alert — กล่องแจ้งเตือนแบบฝังในหน้า (ต่างจาก toast ที่ลอยแล้วหายเอง)
 * ดึง pattern มาจากกล่อง error เดิมใน LoginPage แล้วทำเป็น component ใช้ซ้ำได้
 * เข้าเฟรมด้วย animate-fade-up (keyframe ที่มีอยู่แล้วใน tw-theme.css)
 */
import type { ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react';
import { cn } from '@/app/components/ui/utils';

export type AlertTone = 'ok' | 'warn' | 'bad' | 'accent';

const toneStyle: Record<AlertTone, string> = {
  ok: 'border-ok bg-ok-soft text-ok',
  warn: 'border-warn bg-warn-soft text-warn',
  bad: 'border-bad bg-bad-soft text-bad',
  accent: 'border-brand bg-brand-soft text-brand',
};

const toneIcon: Record<AlertTone, typeof AlertTriangle> = {
  ok: CheckCircle2,
  warn: AlertTriangle,
  bad: XCircle,
  accent: Info,
};

export function Alert({
  tone = 'accent',
  title,
  children,
  action,
  className,
}: {
  tone?: AlertTone;
  title?: string;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  const Icon = toneIcon[tone];
  return (
    <div
      role="alert"
      className={cn(
        'flex animate-fade-up items-start gap-2.5 rounded-control border px-3.5 py-3',
        toneStyle[tone],
        className,
      )}
    >
      <Icon size={16} className="mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">
        {title ? <p className="text-caption font-semibold">{title}</p> : null}
        {children ? <div className="text-caption leading-[1.7]">{children}</div> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
