/**
 * StatCard — การ์ดตัวเลขพร้อมไอคอน
 *
 * เดิม hardcode hex 18 จุด (bg-white, #2d5d83, #0F172A, #64748B ...) จึงไม่ตามธีมใหม่
 * เปลี่ยนมาใช้ token: การ์ดใช้ recipe `card` เดียวกับ primitives และสีไอคอนผูกกับ
 * ok / warn / bad / brand ที่มาจาก theme.css จุดเดียว
 */
import type { ElementType } from 'react';

import { cn } from '@/app/components/ui/utils';
import { card } from './primitives';

type CardColor = 'brand' | 'green' | 'red' | 'amber' | 'slate';

/** คงชื่อสีเดิมไว้เพื่อไม่ต้องแก้ทุกที่ที่เรียกใช้ แต่ map ไปที่ token ตามความหมาย */
export const CARD_CLR: Record<CardColor, { bg: string; icon: string }> = {
  brand: { bg: 'bg-brand-soft', icon: 'text-brand-strong' },
  green: { bg: 'bg-ok-soft', icon: 'text-ok-strong' },
  red: { bg: 'bg-bad-soft', icon: 'text-bad-strong' },
  amber: { bg: 'bg-warn-soft', icon: 'text-warn-strong' },
  slate: { bg: 'bg-surface-2', icon: 'text-ink-2' },
};

export function StatCard({
  label,
  value,
  sub,
  icon: Icon,
  color = 'slate',
}: {
  label: string;
  value: string | number;
  sub?: string;
  icon: ElementType;
  color?: CardColor;
}) {
  const c = CARD_CLR[color];
  return (
    <div className={cn(card, 'flex items-start gap-4 p-5')}>
      <div className={cn('grid size-10 shrink-0 place-items-center rounded-control', c.bg)}>
        <Icon size={18} className={c.icon} strokeWidth={1.8} />
      </div>
      <div className="min-w-0">
        <p className="mb-0.5 text-caption text-ink-2">{label}</p>
        {/* ตัวเลขใช้ mono ให้ความกว้างนิ่งเวลาค่าเปลี่ยน */}
        <p className="font-mono text-h2 leading-none font-bold">{value}</p>
        {sub ? <p className="mt-1 text-micro text-ink-2">{sub}</p> : null}
      </div>
    </div>
  );
}
