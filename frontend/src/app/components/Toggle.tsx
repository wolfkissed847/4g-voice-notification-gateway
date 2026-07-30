import { cn } from '@/app/components/ui/utils';

/**
 * สวิตช์เปิด/ปิด — เดิม hardcode hex (#2d5d83 / #E2E8F0 / #333333) จึงไม่ตามธีมใหม่
 * เปลี่ยนมาใช้ token: เปิด = bg-brand, ปิด = bg-line, ปุ่มกลม = bg-surface
 * ขนาดตาม dimension ในดีไซน์ (h-[17px] w-[30px] ปุ่ม 13px)
 */
export function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!on)}
      role="switch"
      aria-checked={on}
      className={cn(
        'relative inline-block h-[17px] w-[30px] shrink-0 rounded-full transition-colors',
        on ? 'bg-brand' : 'bg-line',
      )}
    >
      <span
        className={cn(
          'absolute top-0.5 size-[13px] rounded-full transition-all',
          on ? 'end-0.5 bg-brand-ink' : 'start-0.5 bg-surface',
        )}
      />
    </button>
  );
}
