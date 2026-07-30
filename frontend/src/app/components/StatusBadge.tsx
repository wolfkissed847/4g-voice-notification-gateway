/**
 * StatusBadge — badge สถานะของ CallJob
 *
 * เดิม hardcode สีเป็น hex ทั้ง light/dark (38 จุด) จึงไม่เปลี่ยนตามธีมใหม่
 * เปลี่ยนมาใช้ Pill จาก primitives ที่อ่านค่าจาก token (ok/warn/bad/accent/muted)
 * สีจึงมาจาก src/styles/theme.css ที่เดียว และสลับ dark ได้เอง
 */
import { Pill, type Tone } from './primitives';
import { useApp } from '../context/AppContext';
import type { CallStatus } from '../types';

/** สถานะ → โทนตามความหมาย ไม่ใช่ตามสีตรงๆ (สีจริงมาจาก token) */
const STATUS_TONE: Record<CallStatus, Tone> = {
  connected: 'ok',
  failed: 'bad',
  no_answer: 'warn',
  busy: 'warn',
  retrying: 'warn',
  escalated: 'warn',
  in_progress: 'accent',
  queued: 'muted',
  sms_fallback_sent: 'accent',
};

export function StatusBadge({ status }: { status: CallStatus }) {
  const { T } = useApp();
  const labelMap: Record<CallStatus, string> = {
    connected: T.badge_success,
    failed: T.badge_failed,
    retrying: T.badge_retrying,
    escalated: T.badge_escalated,
    in_progress: T.badge_calling,
    queued: T.badge_queued,
    sms_fallback_sent: T.badge_sms,
    no_answer: T.badge_no_answer,
    busy: T.badge_busy,
  };
  return <Pill tone={STATUS_TONE[status] ?? 'muted'}>{labelMap[status] ?? status}</Pill>;
}

export const STATUS_OPTS: CallStatus[] = [
  'queued', 'in_progress', 'connected', 'no_answer', 'busy', 'retrying', 'escalated', 'sms_fallback_sent', 'failed',
];
