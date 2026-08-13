/**
 * ตัวช่วยเรื่อง "ระยะเวลา" ที่ผู้ใช้ต้องอ่านและกรอกในหน้าตั้งค่า
 *
 * backend เก็บและรับค่าเป็น "วินาทีล้วน" เสมอ (call_retry_delay_seconds,
 * call_ring_timeout_seconds) ไฟล์นี้มีหน้าที่เดียวคือแปลงไปกลับระหว่างวินาทีล้วน
 * กับรูปแบบ "นาที + วินาที" ที่คนอ่านรู้เรื่อง — ไม่แตะรูปแบบที่ส่งขึ้น API เลย
 *
 * ที่ต้องมีเพราะเดิมหน้าเว็บสร้างข้อความตัวอย่างด้วย `n % 60` ตรงๆ ซึ่งพังทันทีที่ค่าเกิน 60:
 * ตั้ง 120 วินาที แล้วได้ข้อความว่า "ไม่รับตอน 10:00:00 จะโทรซ้ำอีกทีตอน 10:00:00"
 * = บอกว่าโทรซ้ำ ณ วินาทีเดียวกับที่เพิ่งไม่รับ อ่านแล้วเข้าใจผิดว่าระบบรัวโทรซ้ำทันที
 * (ผู้ใช้เจอเองตอนตั้งค่าจริง) ตัวเลข 90 ก็ผิดเหมือนกันแต่เนียนกว่า — ได้ 10:00:30 แทน 10:01:30
 */

export interface MinSec {
  minutes: number;
  seconds: number;
}

/** 90 → { minutes: 1, seconds: 30 } */
export function toMinSec(total: number): MinSec {
  const t = Math.max(0, Math.round(Number(total) || 0));
  return { minutes: Math.floor(t / 60), seconds: t % 60 };
}

/** { minutes: 1, seconds: 30 } → 90 */
export function fromMinSec(minutes: number, seconds: number): number {
  const m = Math.max(0, Math.round(Number(minutes) || 0));
  const s = Math.max(0, Math.round(Number(seconds) || 0));
  return m * 60 + s;
}

/** 45 → "45 วินาที" · 60 → "1 นาที" · 90 → "1 นาที 30 วินาที" */
export function formatDurationTh(total: number): string {
  const { minutes, seconds } = toMinSec(total);
  if (minutes === 0) return `${seconds} วินาที`;
  if (seconds === 0) return `${minutes} นาที`;
  return `${minutes} นาที ${seconds} วินาที`;
}

/** 45 → "45s" · 60 → "1m" · 90 → "1m 30s" */
export function formatDurationEn(total: number): string {
  const { minutes, seconds } = toMinSec(total);
  if (minutes === 0) return `${seconds}s`;
  if (seconds === 0) return `${minutes}m`;
  return `${minutes}m ${seconds}s`;
}

/**
 * เวลาบนนาฬิกาหลังจาก base ไป total วินาที — ใช้กับข้อความตัวอย่างที่ยกเวลาสมมติมาให้ดู
 * วนกลับที่ 24 ชม. เพื่อไม่ให้ได้ "26:00:00" ถ้าวันหนึ่งมีคนขยายเพดานค่านี้
 */
export function clockAfter(total: number, base = '10:00:00'): string {
  const [bh, bm, bs] = base.split(':').map(Number);
  const shifted = bh * 3600 + bm * 60 + bs + Math.max(0, Math.round(Number(total) || 0));
  const t = ((shifted % 86400) + 86400) % 86400;
  return [Math.floor(t / 3600), Math.floor((t % 3600) / 60), t % 60]
    .map((v) => String(v).padStart(2, '0'))
    .join(':');
}
