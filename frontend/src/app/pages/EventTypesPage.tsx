/**
 * EventTypesPage — คลัง "คำพูด" ของระบบ
 *
 * หน้านี้ตอบคำถามเดียว: เหตุการณ์นี้ให้พูดว่าอะไร
 * ไม่ตอบว่าใครจะได้รับสาย และไม่มีช่องให้เลือกกลุ่มหรือเบอร์โดยตั้งใจ
 *
 * เดิมมีช่อง "กลุ่มเริ่มต้น" อยู่ตรงนี้ ซึ่งทำให้ผู้รับถูกตั้งได้จากสองที่ (ที่นี่ + หน้าอุปกรณ์)
 * แล้วคำตอบว่า "ยิงเหตุการณ์นี้แล้วใครได้รับสาย" ขึ้นอยู่กับว่าที่ไหนถูกตั้งไว้ก่อน
 * ต้องไล่ดูสองจุดเสมอถึงจะรู้ ตอนนี้ผู้รับอยู่ที่หน้าอุปกรณ์จุดเดียว
 *
 * ปุ่มทดสอบก็ย้ายไปหน้าอุปกรณ์ด้วยเหตุผลเดียวกัน — เหตุการณ์ลอยๆ ไม่มีผู้รับให้โทร
 * ทดสอบจากหน้าอุปกรณ์จึงเดินเส้นทางเดียวกับของจริงทุกขั้น ไม่ใช่เส้นทางทดสอบแยกต่างหาก
 */
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus, Trash2, Pencil, Layers } from "lucide-react";
import { useApp } from "../context/AppContext";
import { Toggle } from "../components/Toggle";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "../components/ui/dialog";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription,
  AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from "../components/ui/alert-dialog";
import { listApiKeys } from "../api/apiKeys";
import { listEventTypes, createEventType, updateEventType, deleteEventType } from "../api/eventTypes";
import { ApiError } from "../api/client";
import { cn } from "@/app/components/ui/utils";
import { Alert } from "../components/Alert";
import { Btn, PageHeader, inputCls } from "../components/primitives";
import { SNAP, readSnapshot, writeSnapshot } from "../lib/snapshot";
import type { EventType } from "../types";

interface FormState {
  id?: number;
  code: string;
  display_name: string;
  message_template: string;
  is_active: boolean;
}

const EMPTY_FORM: FormState = { code: "", display_name: "", message_template: "", is_active: true };

/**
 * กล่องช่วยตอนพิมพ์ข้อความ — อ่าน {ชื่อตัวแปร} จากสิ่งที่พิมพ์อยู่แล้วบอกว่า
 * อุปกรณ์ต้องส่งอะไรมาบ้าง พร้อมตัวอย่าง JSON ที่ประกอบจากตัวแปรจริงในข้อความนั้น
 *
 * ── ทำไมต้องมี ────────────────────────────────────────────────────────────
 * กลไก {ตัวแปร} มีมาตั้งแต่แรกแต่ไม่เคยเขียนไว้ที่ไหนในเว็บ คนตั้งค่าจึงไม่รู้ว่าทำได้
 * และคำถามที่ถูกถามบ่อยที่สุดหลังตั้งค่าเสร็จคือ "ถ้าอยากให้บอกอุณหภูมิด้วยล่ะ"
 *
 * ── ทำไมอ่านจากข้อความจริง ไม่ใช่เขียนตัวอย่างตายตัว ─────────────────────
 * ตัวอย่างตายตัวบอกได้แค่ว่า "ทำได้นะ" แต่ไม่ได้บอกว่า "ของคุณต้องส่งอะไร"
 * พออ่านจากข้อความที่กำลังพิมพ์ มันจะตอบคำถามที่คนกำลังมีอยู่ตรงหน้าพอดี
 * และจับได้ทันทีถ้าพิมพ์ชื่อตัวแปรผิด (เห็นชื่อที่ไม่ได้ตั้งใจโผล่ในรายการ)
 */
function TemplateVarsHelp({ template, code }: { template: string; code: string }) {
  const { T } = useApp();

  // ตัวแปรที่ Python .format() รับ = ตัวอักษร/ตัวเลข/ขีดล่าง เท่านั้น
  const found = Array.from(template.matchAll(/\{(\w+)\}/g)).map((m) => m[1]);
  // ทุกตัวต้องส่งมาจาก payload ไม่มีตัวไหนได้รับการยกเว้น — เดิม {device} ถูกเติมจาก
  // ชื่ออุปกรณ์เจ้าของ key ให้เบื้องหลัง กล่องนี้เลยต้องแยกอธิบายสองแบบว่าตัวไหนต้องส่ง
  // ตัวไหนไม่ต้อง ซึ่งเป็นกฎที่มองจากข้อความที่พิมพ์อยู่ไม่ออกเลย ตอนนี้เหลือกฎเดียว
  const needed = Array.from(new Set(found));

  /* จัดรูป JSON เองแทน JSON.stringify(obj, null, 2) เพราะค่าตัวอย่างเป็น "..." ที่ไม่ใช่
     ค่าจริง และคีย์ต้องเรียงตามลำดับที่พิมพ์ในข้อความ ไม่ใช่ลำดับที่ object เก็บไว้
     ผลคืออ่านแล้วก๊อปไปใช้ได้ทันที ไม่ต้องเดาว่าวงเล็บไหนปิดตรงไหน */
  const body =
    needed.length === 0
      ? `{\n  "event_type_code": "${code || "your_code"}"\n}`
      : [
          "{",
          `  "event_type_code": "${code || "your_code"}",`,
          '  "variables": {',
          needed.map((v) => `    "${v}": "..."`).join(",\n"),
          "  }",
          "}",
        ].join("\n");

  const chip = "rounded-full border px-2 py-px font-mono text-[0.6875rem] leading-[1.7]";

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <p className="text-caption font-semibold">{T.et_howto_title}</p>

      {/* ── ตัวแปรที่ตรวจเจอในข้อความ ─────────────────────────────────────
          บรรทัดละตัว ไม่ใช่เรียงต่อกันเป็นแถว — แต่ละตัวมีคำกำกับของตัวเองว่า
          "ต้องส่งมา" หรือ "ระบบเติมให้" ซึ่งเป็นข้อมูลที่ต่างกันคนละเรื่อง
          ถ้าเรียงต่อกันแล้วตกบรรทัด คำกำกับจะไปอยู่คนละบรรทัดกับชิปของมันเอง */}
      <div>
        <p className="mb-1.5 text-micro text-ink-2">{T.et_vars_title}</p>
        {needed.length === 0 ? (
          <p className="text-micro leading-[1.8] text-ink-2">{T.et_vars_none}</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {needed.map((v) => (
              <li key={v} className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className={cn(chip, "border-brand-strong bg-brand-soft text-brand-strong")}>
                  {`{${v}}`}
                </span>
                <span className="text-micro text-ink-2">— {T.et_vars_send}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="min-w-0">
        <p className="mb-1.5 text-micro text-ink-2">{T.et_vars_example}</p>
        <pre className="min-w-0 overflow-x-auto overscroll-x-contain rounded-control border border-line bg-surface-2 px-3 py-2.5 font-mono text-[0.6875rem] leading-[1.9] text-ink-2">
          {body}
        </pre>
      </div>

      <div>
        <p className="mb-1.5 text-micro text-ink-2">{T.et_limits_title}</p>
        <ul className="flex flex-col gap-1">
          {[T.et_limit_msg, T.et_limit_count, T.et_limit_value].map((line) => (
            /* จุดนำหน้าวาดเป็นวงกลมเอง ไม่ใช้อักขระ • — ฟอนต์ Mali ไม่มีสัญลักษณ์นี้
               เบราว์เซอร์เลยไปหยิบจากฟอนต์สำรองซึ่งได้เป็นสี่เหลี่ยมเล็กๆ คนละทรงกัน */
            <li key={line} className="flex items-start gap-2 text-micro leading-[1.7] text-ink-2">
              <span aria-hidden className="mt-[0.6em] size-[0.3em] shrink-0 rounded-full bg-current opacity-45" />
              <span className="min-w-0">{line}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* ขึ้นเฉพาะตอนมีตัวแปรที่ต้องส่งจริง — ถ้าข้อความไม่มีตัวแปรเลยก็ไม่มีอะไรให้พลาด
          กล่องเตือนที่ขึ้นตลอดเวลาจะกลายเป็นของประจำหน้าที่ไม่มีใครอ่าน */}
      {needed.length ? (
        <Alert tone="warn" className="px-3 py-2.5 [&_div]:text-micro [&_div]:leading-[1.8]">
          {T.et_vars_missing}
        </Alert>
      ) : null}
    </div>
  );
}

/** embedded = ถูกฝังอยู่ในหน้า SetupPage ที่มีหัวข้อของตัวเองแล้ว จึงไม่ต้องขึ้นหัวข้อซ้ำ */
/** ข้อมูลที่ฝากไว้ให้รอบหน้าหยิบไปวาดทันที (ดู lib/snapshot.ts) */
type EventSnap = { eventTypes: EventType[]; usage: Record<number, number> };

export function EventTypesPage({ embedded = false }: { embedded?: boolean } = {}) {
  const { T } = useApp();
  const cached = readSnapshot<EventSnap>(SNAP.eventTypes);
  const [eventTypes, setEventTypes] = useState<EventType[]>(cached?.eventTypes ?? []);
  // นับว่าเหตุการณ์แต่ละอันถูกอุปกรณ์กี่ตัวหยิบไปใช้ — แทนคอลัมน์ "กลุ่ม" ที่ตัดทิ้งไป
  // ตอบคำถามที่มีประโยชน์กว่าตอนจะลบ: ลบอันนี้แล้วจะกระทบอุปกรณ์ไหนบ้าง
  const [usage, setUsage] = useState<Record<number, number>>(cached?.usage ?? {});
  // มีของเก่าอยู่แล้ว = ไม่ต้องขึ้น "กำลังโหลด" ให้วาดของเก่าไปก่อนแล้วโหลดทับเงียบๆ
  const [loading, setLoading] = useState(!cached);
  const [saving, setSaving] = useState(false);

  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [formErr, setFormErr] = useState("");

  const [deleteTarget, setDeleteTarget] = useState<EventType | null>(null);

  const load = () =>
    Promise.all([listEventTypes(), listApiKeys()]).then(([ets, keys]) => {
      setEventTypes(ets);
      const counts: Record<number, number> = {};
      keys.forEach((k) => k.allowed_event_types.forEach((e) => {
        counts[e.id] = (counts[e.id] ?? 0) + 1;
      }));
      setUsage(counts);
    });

  useEffect(() => { void load().finally(() => setLoading(false)); }, []);

  // ฝากของชุดล่าสุดไว้ทุกครั้งที่มันเปลี่ยน ไม่ใช่แค่ตอนโหลดเสร็จ — การเพิ่ม/แก้/ลบ
  // อัปเดต state ตรงๆ โดยไม่โหลดใหม่ ถ้าเขียนแคชแค่ใน load() รอบหน้าจะได้ของก่อนแก้
  useEffect(() => {
    if (!loading) writeSnapshot<EventSnap>(SNAP.eventTypes, { eventTypes, usage });
  }, [loading, eventTypes, usage]);

  const openCreate = () => { setForm(EMPTY_FORM); setFormErr(""); setFormOpen(true); };
  const openEdit = (et: EventType) => {
    setForm({
      id: et.id, code: et.code, display_name: et.display_name,
      message_template: et.message_template, is_active: et.is_active,
    });
    setFormErr("");
    setFormOpen(true);
  };

  const submitForm = async () => {
    if (!form.display_name.trim() || !form.message_template.trim()) {
      setFormErr(T.error_generic);
      return;
    }
    setSaving(true);
    setFormErr("");
    try {
      if (form.id) {
        const updated = await updateEventType(form.id, {
          display_name: form.display_name,
          message_template: form.message_template,
          is_active: form.is_active,
        });
        setEventTypes((ets) => ets.map((e) => (e.id === updated.id ? updated : e)));
        toast.success(T.toast_updated);
      } else {
        if (!form.code.trim()) { setFormErr(T.error_generic); setSaving(false); return; }
        const created = await createEventType({
          code: form.code.trim(),
          display_name: form.display_name,
          message_template: form.message_template,
        });
        setEventTypes((ets) => [...ets, created]);
        toast.success(T.toast_created);
      }
      setFormOpen(false);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) setFormErr(T.code_exists_error);
      else setFormErr(e instanceof ApiError ? e.message : T.error_generic);
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = (et: EventType) => {
    updateEventType(et.id, { is_active: !et.is_active })
      .then((updated) => setEventTypes((ets) => ets.map((e) => (e.id === updated.id ? updated : e))))
      .catch((e) => toast.error(e instanceof ApiError ? e.message : T.error_generic));
  };

  const confirmDelete = () => {
    if (!deleteTarget) return;
    deleteEventType(deleteTarget.id)
      .then(() => {
        setEventTypes((ets) => ets.filter((e) => e.id !== deleteTarget.id));
        toast.success(T.toast_deleted);
      })
      .catch((e) => toast.error(e instanceof ApiError ? e.message : T.error_generic))
      .finally(() => setDeleteTarget(null));
  };

  if (loading) {
    return <p className="text-caption text-ink-2">{T.loading}</p>;
  }

  return (
    /* flex-1 + min-h-0: ขอพื้นที่ที่เหลือจาก SetupPage มาให้ตารางเลื่อนในตัวเอง
       เหมือนแท็บกลุ่มผู้รับและหน้าประวัติการโทร (ความสูงที่แน่นอนมาจาก SetupPage) */
    <div className="flex min-h-0 flex-1 flex-col gap-3.5">
      {embedded ? (
        <div className="flex flex-wrap items-center gap-3">
          <p className="font-mono text-caption text-ink-2">{T.event_types_sub}</p>
          <span className="ms-auto">
            <Btn variant="primary" onClick={openCreate}>
              <Plus size={15} />
              {T.add_event_type}
            </Btn>
          </span>
        </div>
      ) : (
        <PageHeader
          title={T.event_types_title}
          meta={T.event_types_sub}
          action={
            <Btn variant="primary" onClick={openCreate}>
              <Plus size={15} />
              {T.add_event_type}
            </Btn>
          }
        />
      )}

      {eventTypes.length === 0 ? (
        <div className="flex flex-col items-center gap-2.5 rounded-card border border-dashed border-line px-4 py-10 text-center">
          <span className="grid size-14 place-items-center rounded-card bg-surface-2">
            <Layers size={26} className="text-ink-2" strokeWidth={1.5} />
          </span>
          <p className="text-lead font-semibold">{T.no_event_types}</p>
          <Btn variant="primary" className="mt-0.5" onClick={openCreate}>
            <Plus size={15} />
            {T.add_event_type}
          </Btn>
        </div>
      ) : (
        /* ── ตารางชุดเดียวกับหน้าประวัติการโทร ──────────────────────────────
            เป็น flex ไม่ใช่ <table> ด้วยเหตุผลเดียวกับหน้านั้น: คอลัมน์แบ่งที่ว่างกันเอง
            ตามสัดส่วน (flex-[1.2] ฯลฯ) และพอจอแคบกว่า sm แถวไหลลงบรรทัดใหม่ได้
            ส่วน <table> จะยึด min-w ไว้แล้วบังคับให้เลื่อนแนวนอนแทน ซึ่งบนมือถือ
            แปลว่าต้องเลื่อนไปมาทุกแถวเพื่ออ่านให้ครบ

            กล่องเลื่อนในตัวเอง หัวคอลัมน์ sticky ค้างไว้ตอนเลื่อน — ที่นี่ยังไม่ยาวมาก
            แต่จำนวนประเภทเหตุการณ์โตขึ้นเรื่อยๆ ตามระบบ และเป็นชุดเดียวกับอีกสองแท็บ */
        <div className="min-h-[10rem] min-w-0 flex-1 overflow-auto overscroll-contain rounded-card border border-line bg-surface shadow-card">
          {/* ซ่อนหัวคอลัมน์บนจอแคบ — ที่นั่นแถวไหลลงบรรทัดใหม่จนป้ายไม่ตรงกับข้อมูลแล้ว

              หัวคอลัมน์ text-body (0.938rem) ใหญ่กว่าแถวข้อมูล text-caption (0.844rem)
              ตามที่ผู้ใช้ขอ — ต่างจากหน้าประวัติการโทรที่หัวเล็กกว่าแถว เพราะที่นั่นมี 20+ แถว
              ต่อหน้า หัวคอลัมน์อ่านครั้งเดียวแล้วไม่กลับไปอ่านอีก ส่วนตารางนี้สั้น
              หัวที่เด่นกว่าช่วยแบ่งกลุ่มคอลัมน์ให้เห็นชัดโดยไม่ต้องแลกความหนาแน่นของแถว */}
          <div className="sticky top-0 z-10 hidden flex-wrap items-center gap-x-3 border-b border-line bg-surface-2 px-3.5 py-1.5 font-mono text-body font-bold text-ink-2 sm:flex">
            <span className="min-w-0 flex-1 basis-[9rem]">{T.col_code}</span>
            <span className="min-w-0 flex-[1.2] basis-[10rem]">{T.col_name}</span>
            <span className="min-w-0 flex-[0.9] basis-[7.5rem]">{T.et_used_by}</span>
            <span className="w-[4.25rem] shrink-0 text-end">{T.col_active}</span>
            <span className="w-[4.25rem] shrink-0 text-end">{T.col_actions}</span>
          </div>

          {eventTypes.map((et) => (
            <div
              key={et.id}
              className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 border-b border-line-2 px-3.5 py-2 transition-colors last:border-b-0 hover:bg-surface-2"
            >
              <span className="min-w-0 flex-1 basis-[9rem] truncate font-mono text-caption text-brand-strong">
                {et.code}
              </span>
              <span className="min-w-0 flex-[1.2] basis-[10rem] truncate text-caption font-medium">
                {et.display_name}
              </span>
              <span className="min-w-0 flex-[0.9] basis-[7.5rem] truncate text-caption text-ink-2">
                {usage[et.id] ? T.et_used_by_count(usage[et.id]) : T.et_used_by_none}
              </span>
              <span className="flex w-[4.25rem] shrink-0 justify-end">
                <Toggle on={et.is_active} onChange={() => toggleActive(et)} />
              </span>
              {/* ขนาดปุ่มและระยะห่างชุดเดียวกับแท็บกลุ่มผู้รับ — 32px และเว้นช่อง
                  ก่อนปุ่มลบ สามแท็บนี้อยู่หน้าเดียวกัน ปุ่มแก้/ลบต้องกดเหมือนกันหมด */}
              <span className="flex w-[4.25rem] shrink-0 items-center justify-end">
                <button onClick={() => openEdit(et)} title={T.edit} aria-label={T.edit}
                  className="grid size-8 place-items-center rounded-control text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink">
                  <Pencil size={15} />
                </button>
                <button onClick={() => setDeleteTarget(et)} title={T.delete} aria-label={T.delete}
                  className="ms-1 grid size-8 place-items-center rounded-control text-ink-2 transition-colors hover:bg-bad-soft hover:text-bad-strong">
                  <Trash2 size={15} />
                </button>
              </span>
            </div>
          ))}
        </div>
      )}

      {/* ── ป๊อปอัพเพิ่ม/แก้ประเภทเหตุการณ์ ──────────────────────────────────
          แบ่งเป็น "ช่องกรอก" (ซ้าย) กับ "วิธีการนำไปใช้" (ขวา) คั่นด้วยเส้นแนวตั้ง
          ซ้าย = สิ่งที่ต้องตัดสินใจและพิมพ์ ขวา = สิ่งที่ต้องเอาไปบอกคนเขียนเฟิร์มแวร์
          สองอย่างนี้ต้องเห็นพร้อมกัน เพราะฝั่งขวาเปลี่ยนตามสิ่งที่พิมพ์อยู่ฝั่งซ้ายแบบทันที
          เส้นคั่นทำให้อ่านออกทันทีว่าอะไรเป็นของกรอก อะไรเป็นของอ่าน — เดิมสองฝั่ง
          หน้าตาเหมือนกันหมด จนดูเหมือนฝั่งขวายังมีอะไรให้กรอกอีก

          p-0 บน DialogContent แล้วให้แต่ละส่วนคุม padding เอง เส้นคั่นหัว/ท้ายจึงลากเต็ม
          ความกว้างกล่องได้จริง ไม่ต้องใช้ margin ติดลบมาหักล้าง padding ของกล่องนอก
          [&>button] = ปุ่มกากบาทของ Radix ขยับให้ตรงกลางแถบหัวพอดี (ค่าเดิม top-4 อิงกล่องที่มี p-6)

          กว้างเฉพาะ sm: ขึ้นไป — ต่ำกว่านั้นปล่อยเป็น calc(100%-2rem) ตามค่าเดิมของ DialogContent
          ถ้าเขียน max-w-[46rem] ไว้ตัวเดียว tailwind-merge จะลบ calc ของเดิมทิ้ง แล้วบนมือถือ
          กล่องจะกว้างเต็มจอชนขอบซ้ายขวาพอดี ไม่เหลือระยะขอบเลย
          [&>*]:min-w-0 — DialogContent เป็น grid ลูกทุกตัวย่อเล็กกว่าเนื้อหาไม่ได้
          ตัวอย่าง JSON ที่บรรทัดยาวจึงดันทั้งกล่องจนล้นขอบถ้าไม่ปลดตรงนี้

          ── ความกว้าง ──────────────────────────────────────────────────────
          52rem ไม่ใช่ 46rem — สองคอลัมน์แบ่งครึ่ง ฝั่งละราว 24rem ซึ่งพอให้คำใบ้ใต้
          ช่องกรอกและบรรทัดคำอธิบายฝั่งขวาอยู่บรรทัดเดียวจบเป็นส่วนใหญ่
          เขียนซ้อน min() กับ calc(100%-2rem) เพราะที่ sm: ขึ้นไป max-w ตัวนี้ทับตัวฐาน
          ถ้าใส่ 52rem เปล่าๆ จอที่กว้างไม่ถึง (หรือ root font ใหญ่จนคิดเป็น px แล้วเกิน)
          กล่องจะกว้างกว่าจอแล้วโดนตัด — ปิดเพดานไว้ที่ขอบจอลบระยะขอบเสมอ */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="max-h-[85vh] max-w-[calc(100%-2rem)] gap-0 overflow-y-auto p-0 sm:max-w-[min(52rem,calc(100%-2rem))] [&>*]:min-w-0 [&>button]:top-5 [&>button]:right-5">
          <DialogHeader className="flex-row items-center gap-3 border-b border-line px-5 py-3 pe-12 text-start">
            <span className="grid size-8 shrink-0 place-items-center rounded-control bg-brand-soft text-brand-strong">
              <Layers size={17} strokeWidth={1.8} />
            </span>
            <DialogTitle className="min-w-0 truncate text-lead font-bold">
              {form.id ? T.edit_event_type : T.new_event_type}
            </DialogTitle>
          </DialogHeader>

          {/* จอแคบกว่า sm ยุบเป็นคอลัมน์เดียว เส้นคั่นแนวตั้งกลายเป็นเส้นคั่นแนวนอนแทน
              สองคอลัมน์บนมือถือคือบีบทั้งคู่จนใช้ไม่ได้ทั้งสองฝั่ง */}
          {/* แบ่งครึ่งเท่ากัน ไม่ใช่ 16rem + ที่เหลือ — ของเดิมฝั่งขวากว้างกว่าเกือบเท่าตัว
              ทั้งที่ข้างในเป็นข้อความสั้นๆ ส่วนฝั่งซ้ายที่มีช่องกรอกสามช่องกลับถูกบีบ
              จนคำใบ้ใต้ช่องตกบรรทัดทุกอัน สองฝั่งเลยสูงไม่เท่ากันมาก เห็นเป็นที่ว่าง
              ยาวๆ ข้างเส้นคั่น พอเท่ากันแล้วช่องกรอกได้ที่พอใช้ และความสูงสองฝั่งใกล้กันเอง */}
          <div className="grid gap-0 px-5 py-4 sm:grid-cols-2">
            <div className="flex min-w-0 flex-col gap-3.5 sm:pe-5">
              {formErr ? <p className="text-caption text-bad-strong">{formErr}</p> : null}
              <div>
                <label className="text-caption text-ink-2 block mb-1.5">{T.code_label}</label>
                <input value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))}
                  disabled={!!form.id} placeholder={T.code_ph} className={inputCls} />
                <p className="text-micro leading-[1.7] text-ink-2 mt-1">{T.code_hint}</p>
              </div>
              <div>
                <label className="text-caption text-ink-2 block mb-1.5">{T.display_name_label}</label>
                <input value={form.display_name} onChange={(e) => setForm((f) => ({ ...f, display_name: e.target.value }))}
                  placeholder={T.display_name_ph} className={inputCls} />
              </div>
              {/* ช่องข้อความยืดกินที่ว่างที่เหลือของคอลัมน์ซ้าย (flex-1)
                  ความสูงของแถวถูกกำหนดโดยฝั่งที่สูงกว่าเสมอ ซึ่งมักเป็นฝั่งขวาเวลามีตัวแปรหลายตัว
                  ถ้าช่องนี้สูงคงที่ ที่ว่างใต้มันจะถูกทิ้งเปล่าและสองฝั่งจบไม่เท่ากัน
                  พอให้มันยืด ที่ว่างกลายเป็นพื้นที่พิมพ์ข้อความยาวๆ ซึ่งเป็นของที่ใช้จริง
                  max-h กันไว้ไม่ให้สูงเกินอ่านสบายตอนมีตัวแปร 20 ตัวเต็มเพดาน */}
              <div className="flex min-h-0 flex-1 flex-col">
                <label className="text-caption text-ink-2 block mb-1.5">{T.message_template_label}</label>
                <textarea value={form.message_template} onChange={(e) => setForm((f) => ({ ...f, message_template: e.target.value }))}
                  placeholder={T.message_template_ph} rows={3}
                  className={cn(inputCls, 'min-h-[5.25rem] max-h-[16rem] flex-1 resize-y')} />
                <p className="text-micro leading-[1.7] text-ink-2 mt-1">{T.message_template_hint}</p>
              </div>
              {form.id && (
                /* ใส่กรอบให้เท่ากับช่องกรอกด้านบน ไม่งั้นสวิตช์ลอยเดี่ยวๆ ในคอลัมน์ที่เหลือแต่ที่ว่าง */
                <div className="flex items-center justify-between gap-3 rounded-control border border-line bg-surface-2 px-3 py-2.5">
                  <label className="text-caption text-ink-2">{T.active_label}</label>
                  <Toggle on={form.is_active} onChange={(v) => setForm((f) => ({ ...f, is_active: v }))} />
                </div>
              )}
            </div>

            <div className="mt-4 min-w-0 border-t border-line pt-4 sm:mt-0 sm:border-t-0 sm:border-s sm:ps-5 sm:pt-0">
              <TemplateVarsHelp template={form.message_template} code={form.code} />
            </div>
          </div>

          <DialogFooter className="border-t border-line px-5 py-3.5">
            <button onClick={() => setFormOpen(false)} className="px-4 py-2.5 rounded-control border border-line text-caption text-ink-2 bg-surface-2">{T.cancel}</button>
            <button onClick={submitForm} disabled={saving} className="px-4 py-2.5 rounded-control bg-brand hover:brightness-110 text-brand-ink text-caption font-semibold disabled:opacity-60">
              {saving ? T.saving : T.save}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{T.delete_confirm_title}</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget && usage[deleteTarget.id]
                ? T.event_type_delete_in_use(usage[deleteTarget.id])
                : T.event_type_delete_confirm}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{T.cancel}</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete}>{T.yes_delete}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
