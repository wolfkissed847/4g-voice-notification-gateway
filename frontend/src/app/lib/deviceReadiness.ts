/**
 * ความพร้อมของอุปกรณ์ — "ถ้าตอนนี้เกิดเรื่องขึ้น เครื่องนี้จะโทรออกได้จริงมั้ย"
 *
 * ── ทำไมไม่ใช่ online/offline ──────────────────────────────────────────────
 * เดิมป้ายนี้วัดจาก last_used_at ว่ายิงเข้ามาภายใน 15 นาทีล่าสุดหรือเปล่า ซึ่งใช้กับ
 * ระบบนี้ไม่ได้: อุปกรณ์ไม่ได้ ping เข้ามาเรื่อยๆ มันยิงเฉพาะตอนมีเรื่องแจ้ง
 * เครื่องที่ปกติดีทุกอย่างจึงขึ้นว่า "เงียบอยู่" เกือบตลอดเวลา — เตือนในสิ่งที่ควรเกิด
 * แล้วกลบสิ่งที่เป็นปัญหาจริง
 *
 * สามอย่างนี้เป็นปัญหาจริงและเช็คได้จากข้อมูลที่มี เรียงจากหนักไปเบา:
 *   ปิดอยู่        → ยิงเข้ามาก็ถูกปฏิเสธตั้งแต่ประตู
 *   ไม่มีเหตุการณ์ → ยิงอะไรเข้ามาก็ไม่ตรงกับที่อนุญาตไว้
 *   ไม่มีผู้รับสาย → เข้าคิวได้ แต่ไม่มีเบอร์ให้โทร = แจ้งแล้วไม่มีใครรู้ (เงียบที่สุด
 *                   ในสามแบบ เพราะทุกอย่างดู "สำเร็จ" หมดจนกว่าจะมีเรื่องจริง)
 *
 * ── ทำไมอยู่ใน lib ไม่ใช่ในหน้าใดหน้าหนึ่ง ────────────────────────────────
 * ทั้งหน้าอุปกรณ์และหน้าภาพรวมต้องตอบคำถามเดียวกันนี้ ถ้าต่างคนต่างเขียนเงื่อนไขเอง
 * วันหนึ่งจะเพี้ยนกัน แล้วผู้ใช้จะเห็นเครื่องเดียวกันเป็นคนละสถานะในสองหน้า
 * (เคยเกิดมาแล้วตอนแก้ online/offline ที่หน้าอุปกรณ์แต่ลืมหน้าภาพรวม)
 */
import { AlertTriangle, Ban, ShieldCheck, type LucideIcon } from 'lucide-react';

import type { useApp } from '../context/AppContext';
import type { ApiKey } from '../types';

export type ReadinessTone = 'ok' | 'warn' | 'muted';

export type Readiness = {
  tone: ReadinessTone;
  label: string;
  Icon: LucideIcon;
};

export function readiness(device: ApiKey, T: ReturnType<typeof useApp>['T']): Readiness {
  if (!device.is_active) return { tone: 'muted', label: T.device_off, Icon: Ban };
  if (device.allowed_event_types.length === 0)
    return { tone: 'warn', label: T.device_not_ready_events, Icon: AlertTriangle };
  const hasSomeone = device.allowed_event_types.some((e) => e.contacts.length > 0 || e.group_id !== null);
  if (!hasSomeone) return { tone: 'warn', label: T.device_not_ready_recipients, Icon: AlertTriangle };
  return { tone: 'ok', label: T.device_ready, Icon: ShieldCheck };
}

/** สี token ของแต่ละโทน — ใช้กับวงแสงรอบไอคอนและเส้นขอบที่ต้องเขียนเป็น inline style */
export const TONE_RGB: Record<ReadinessTone, string> = {
  ok: 'var(--ok)',
  warn: 'var(--warn)',
  muted: 'var(--ink-2)',
};

/** นับเฉพาะเครื่องที่พร้อมโทรออกได้จริง — ตัวเลขสรุปบนหน้าภาพรวมใช้ค่านี้ */
export function countReady(devices: ApiKey[], T: ReturnType<typeof useApp>['T']): number {
  return devices.filter((d) => readiness(d, T).tone === 'ok').length;
}
