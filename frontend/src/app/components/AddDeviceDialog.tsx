/**
 * AddDeviceDialog — เพิ่มอุปกรณ์ 2 ขั้น: ตั้งชื่อ → รับ key ไปใช้
 *
 * ── ขั้นที่ 1 มีแค่ช่องชื่อ ────────────────────────────────────────────────
 * เคยมีกริดติ๊กเลือกประเภทเหตุการณ์อยู่ในขั้นนี้ด้วย เอาออกแล้ว เพราะหน้าอุปกรณ์
 * รื้อใหม่ให้เพิ่มเหตุการณ์ทีละอันที่การ์ดของอุปกรณ์ (ปุ่ม "เพิ่มเหตุการณ์" แล้วกด
 * "ตั้งค่า" เลือกผู้รับสายต่อทันที) การติ๊กไว้ล่วงหน้าตรงนี้จึงได้แค่แถวเปล่าๆ ที่ยัง
 * ไม่มีผู้รับสาย ซึ่งขึ้นจุดส้ม "ยังไม่ได้ตั้งผู้รับสาย" ทุกแถวอยู่ดี — งานเท่าเดิม
 * แต่ต้องตัดสินใจสองรอบ และกล่องนี้ยาวขึ้นเท่าตัวโดยไม่ได้อะไรกลับมา
 *
 * ตอนนี้กล่องนี้ตอบคำถามเดียว: "อุปกรณ์ตัวนี้ชื่ออะไร" แล้วจบด้วยการยื่น key ให้
 *
 * ── ทำไมต้องแบ่งสองขั้น ───────────────────────────────────────────────────
 * key ต้องมาจาก server (secrets.token_urlsafe) และ server เก็บแค่ hash — สุ่มฝั่ง
 * client ไม่ได้ จึงต้อง POST ก่อนถึงจะมี key ให้โชว์ และโชว์ได้ครั้งเดียวเท่านั้น
 * ไม่มีปุ่ม "สร้างใหม่" ด้วยเหตุผลเดียวกัน — เปลี่ยน key = ต้องแฟลชบอร์ดใหม่
 * ถ้า key รั่วให้ลบอุปกรณ์แล้วสร้างใหม่ ซึ่งเป็นการตัดสินใจที่ควรตั้งใจทำ
 *
 * ── ทำไมใช้ <Dialog> ของ Radix ไม่ใช่ div ลอยเอง ─────────────────────────
 * AppShell ห่อทุกหน้าไว้ด้วย div ที่มี transform ซึ่งกลายเป็น containing block
 * ของ position:fixed — กล่องที่เขียน fixed เองจะไปอิงขอบ <main> แทนขอบจอ
 * Radix render ผ่าน portal ออกไปที่ <body> จึงไม่โดนผลนี้ และได้ล็อกสกรอลล์
 * พื้นหลัง + ปิดด้วย Esc + focus trap มาให้ฟรี เหมือนทุก dialog หน้าอื่น
 */
import { useState } from 'react';
import { toast } from 'sonner';
import { Check, Copy, Cpu, KeyRound } from 'lucide-react';

import { cn } from '@/app/components/ui/utils';
import { createApiKey } from '../api/apiKeys';
import { API_BASE_URL, ApiError } from '../api/client';
import { useApp } from '../context/AppContext';
import { copyText } from '../lib/clipboard';
import type { ApiKeyCreateResponse } from '../types';
import { Btn, inputCls } from './primitives';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog';

export function AddDeviceDialog({
  onClose,
  onCreated,
  onConfigure,
}: {
  onClose: () => void;
  onCreated: () => void;
  onConfigure: (id: number) => void;
}) {
  const { T } = useApp();
  const [name, setName] = useState('');
  const [created, setCreated] = useState<ApiKeyCreateResponse | null>(null);
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      // ส่งรายการเหตุการณ์ว่างเสมอ — ไปเพิ่มทีละอันที่การ์ดอุปกรณ์พร้อมตั้งผู้รับสายเลย
      const result = await createApiKey(name.trim(), []);
      setCreated(result);
      onCreated();
    } catch (e) {
      // เดิมไม่มี catch — พอ backend ตอบ 400 (เช่นชื่อซ้ำ) กล่องจะค้างเฉยๆ เหมือนกดแล้วไม่มีอะไรเกิดขึ้น
      toast.error(e instanceof ApiError ? e.message : T.error_generic);
    } finally {
      setSaving(false);
    }
  };

  const copy = async () => {
    if (!created) return;
    const ok = await copyText(created.plaintext_key);
    if (!ok) {
      toast.error(T.copy_failed);
      return;
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
    toast.success(T.copy);
  };

  // เฟส 2 = ห้ามปิดด้วย Esc หรือคลิกนอกกล่องโดยไม่ตั้งใจ ต้องกดปุ่มปิดเองเท่านั้น
  // (key ตัวนี้ดูซ้ำได้ทีหลังผ่านปุ่ม "แสดง" ที่การ์ดอุปกรณ์ — แต่กันพลาดไว้เพราะ
  //  คนอาจรีบปิดไปโดยยังไม่ทันคัดลอก แล้วต้องมาหาการ์ดอุปกรณ์เองทีหลัง)
  const lockClose = created !== null;

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next && !lockClose) onClose();
      }}
    >
      <DialogContent
        className={cn(
          // ขั้นที่ 1 เหลือช่องเดียว กล่องจึงไม่ต้องกว้าง 45rem เหมือนตอนมีกริดติ๊กสองคอลัมน์
          // 34rem พอให้ตัวอย่าง curl ในขั้นที่ 2 อยู่ได้โดยไม่ตัดบรรทัดถี่เกินไป
          'max-h-[90vh] gap-4 overflow-x-hidden overflow-y-auto p-4 sm:max-w-[34rem] sm:p-6',
          // [&>*]:min-w-0 สำคัญมาก: DialogContent เป็น grid ซึ่งลูกทุกตัวมี min-width:auto
          // = ย่อให้เล็กกว่าความกว้างเนื้อหาไม่ได้ พอมี key ยาวๆ ที่ตัดบรรทัดไม่ได้อยู่ข้างใน
          // มันจะดันทั้งกล่องจนล้นขอบ แล้วเกิดแถบเลื่อนแนวนอน
          '[&>*]:min-w-0',
          // ปุ่มกากบาทมุมขวาบนเป็น <button> ตัวสุดท้ายใน DialogContent (ดู ui/dialog.tsx)
          // เฟส 2 ซ่อนไว้ เพื่อให้เหลือทางออกทางเดียวคือปุ่มที่ผู้ใช้ตั้งใจกด
          lockClose && '[&>button:last-of-type]:hidden',
        )}
        onEscapeKeyDown={(e) => {
          if (lockClose) e.preventDefault();
        }}
        onInteractOutside={(e) => {
          if (lockClose) e.preventDefault();
        }}
      >
        <DialogHeader className="gap-3 text-start">
          <div className="flex flex-row items-center gap-3 pe-6">
            <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand-strong">
              {created ? <KeyRound size={20} /> : <Cpu size={20} />}
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <DialogTitle className="text-lead font-bold">{T.add_device}</DialogTitle>
              <DialogDescription className="text-micro leading-[1.6] text-ink-2">
                {created ? T.add_device_sub2 : T.add_device_sub}
              </DialogDescription>
            </span>
          </div>

          {/* แถบขั้นตอนเต็มความกว้าง แทนตัวเลข "1 › 2" จิ๋วที่มุมขวาบนแบบเดิม —
              ตัวเลขลอยๆ ไม่ได้บอกว่าแต่ละขั้นคืออะไร คนเลยไม่รู้ว่าเหลืออะไรอีก
              ชื่อขั้นซ่อนบนจอแคบ เหลือแค่วงกลมตัวเลขที่ยังอ่านออก */}
          <div className="flex items-center gap-2 sm:gap-3">
            <StepPill n={1} label={T.add_device_step1} state={created ? 'done' : 'current'} />
            <span className="h-px flex-1 bg-line" />
            <StepPill n={2} label={T.add_device_step2} state={created ? 'current' : 'todo'} />
          </div>
        </DialogHeader>

        {created ? (
          <>
            <div className="flex min-w-0 flex-col gap-3 rounded-card border border-brand-strong bg-brand-soft p-3.5 sm:p-4">
              <div className="min-w-0">
                <p className="text-caption font-semibold">{T.key_once_title}</p>
                <p className="mt-1 text-caption leading-[1.8] text-ink-2">{T.key_once_body}</p>
              </div>

              {/* จอแคบวางปุ่มไว้ใต้ key จอกว้างวางข้างกัน — บนมือถือ key ยาวๆ กับปุ่มที่ยืนอยู่
                  บรรทัดเดียวกันจะบีบ key ให้เหลือคอลัมน์แคบมากจนตัดเป็นสิบบรรทัด */}
              <div className="flex min-w-0 flex-col gap-2 rounded-control border border-line bg-surface p-3 sm:flex-row sm:items-start">
                {/* break-all ไม่ใช่ truncate: key ต้องอ่าน/ลากเลือกได้ครบทุกตัวอักษร
                    เพราะถ้าเปิดผ่าน http ปุ่มคัดลอกอาจใช้ไม่ได้ ต้องคัดลอกเองด้วยมือ */}
                <span className="min-w-0 flex-1 font-mono text-caption leading-[1.7] font-bold break-all select-all">
                  {created.plaintext_key}
                </span>
                <Btn
                  onClick={() => void copy()}
                  className={cn(
                    'shrink-0 gap-1.5 px-3 py-1.5 text-micro',
                    copied && 'border-ok text-ok-strong',
                  )}
                >
                  {copied ? <Check size={13} /> : <Copy size={13} />}
                  {copied ? T.copied : T.copy}
                </Btn>
              </div>
            </div>

            {/* ── ตัวอย่างการเอา key ไปใช้ ────────────────────────────────────
                curl เต็มคำสั่ง ไม่ใช่แค่ชื่อ header — ก๊อปไปวางในเทอร์มินัลได้เลย
                และเป็นสิ่งเดียวกับที่เฟิร์มแวร์ต้องยิงจริง ต่างแค่ภาษาที่เขียน */}
            <div className="min-w-0">
              <p className="mb-1.5 text-micro font-medium tracking-[0.04em] text-ink-2 uppercase">
                {T.key_example_label}
              </p>
              {/* ตัดบรรทัดแทนการเลื่อนแนวนอน — ถ้าให้เลื่อน ผู้ใช้จะไม่เห็นว่ามีข้อความต่ออยู่ */}
              <pre className="min-w-0 rounded-control border border-line bg-surface-2 p-3 font-mono text-micro leading-[1.9] break-all whitespace-pre-wrap text-ink-2">
                {`curl -X POST ${API_BASE_URL}/notify \\
  -H "X-API-Key: ${created.plaintext_key}" \\
  -H "Content-Type: application/json" \\
  -d '{"event_type_code": "your_code"}'`}
              </pre>
              {/* อุปกรณ์ที่เพิ่งสร้างยังไม่มีเหตุการณ์ใดเลย ยิงตามตัวอย่างข้างบนตอนนี้
                  จะได้ 403 ทุกครั้ง — บอกไว้ตรงนี้ ไม่ใช่ปล่อยให้ไปงงเอาตอนเทส */}
              <p className="mt-2 text-caption leading-[1.8] text-warn-strong">{T.key_next_step}</p>
            </div>

            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <Btn className="sm:min-w-[7.5rem]" onClick={onClose}>
                {T.done}
              </Btn>
              <Btn variant="primary" className="flex-1" onClick={() => onConfigure(created.id)}>
                {T.save_and_configure}
              </Btn>
            </div>
          </>
        ) : (
          <>
            <label className="flex min-w-0 flex-col gap-1.5">
              <span className="text-caption font-medium">{T.device_name_label}</span>
              <input
                className={cn(inputCls, 'text-body')}
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && name.trim() && !saving) void submit();
                }}
                placeholder={T.device_name_ph}
                autoFocus
              />
              <span className="text-micro leading-[1.7] text-ink-2">{T.device_name_hint}</span>
            </label>

            {/* จอแคบเรียงกลับด้าน (flex-col-reverse) ปุ่มหลักจึงอยู่บน ใกล้นิ้วโป้งกว่า
                และไม่ต้องเลื่อนผ่านปุ่มยกเลิกไปหาปุ่มที่ตั้งใจจะกด */}
            <div className="flex flex-col-reverse gap-2 border-t border-line-2 pt-4 sm:flex-row">
              <Btn variant="dashed" className="text-ink-2 sm:min-w-[7.5rem]" onClick={onClose}>
                {T.cancel}
              </Btn>
              <Btn
                variant="primary"
                className="flex-1"
                onClick={() => void submit()}
                disabled={!name.trim() || saving}
              >
                {saving ? T.saving : T.add_device_next}
              </Btn>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * หนึ่งขั้นในแถบขั้นตอน
 *
 * done = ผ่านมาแล้ว ยังคงเน้นสีไว้ ไม่ใช่ดับไปตอนขึ้นขั้นถัดไป — คนจะได้เห็นว่า
 * เดินมาถึงไหนแล้ว ไม่ใช่เห็นแค่ว่ากำลังอยู่ตรงไหน
 */
function StepPill({ n, label, state }: { n: number; label: string; state: 'done' | 'current' | 'todo' }) {
  const lit = state !== 'todo';
  return (
    <span className={cn('flex shrink-0 items-center gap-2', lit ? 'text-ink' : 'text-ink-2')}>
      <span
        className={cn(
          'grid size-6 shrink-0 place-items-center rounded-full border font-mono text-micro font-bold',
          state === 'current'
            ? 'border-brand bg-brand text-brand-ink'
            : state === 'done'
              ? 'border-brand-strong bg-brand-soft text-brand-strong'
              : 'border-line text-ink-2',
        )}
      >
        {state === 'done' ? <Check size={13} strokeWidth={3} /> : n}
      </span>
      <span className="hidden text-caption font-medium whitespace-nowrap sm:inline">{label}</span>
    </span>
  );
}
