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
    <div className="flex flex-col gap-3.5">
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

      {/* บอกให้ชัดตั้งแต่แรกว่าหน้านี้ไม่เกี่ยวกับผู้รับ — กันคนตามหาช่องเลือกกลุ่มที่ย้ายไปแล้ว */}
      <p className="rounded-control border border-line bg-surface-2 px-3.5 py-2.5 text-caption leading-[1.8] text-ink-2">
        {T.et_words_only_hint}
      </p>

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
        <div className="bg-surface rounded-card border border-line overflow-hidden">
          <div className="overflow-x-auto overscroll-x-contain">
            {/* min-w เท่ากับตารางหน้าอื่น (คิว/ประวัติ) — เดิมมีแค่ w-full ตารางเลยถูกบีบ
                จน 5 คอลัมน์เบียดกันอ่านไม่ออกบนมือถือ แทนที่จะเลื่อนดูแนวนอนได้ */}
            <table className="w-full min-w-[35rem]">
              <thead>
                <tr className="border-b border-line bg-surface-2">
                  {[T.col_code, T.col_name, T.et_used_by, T.col_active, T.col_actions].map((h) => (
                    <th key={h} className="text-left px-4 py-2.5 font-mono text-micro font-bold text-ink-2">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line-2">
                {eventTypes.map((et) => (
                  <tr key={et.id} className="hover:bg-surface-2 transition-colors">
                    <td className="px-4 py-3 font-mono text-caption text-brand-strong">{et.code}</td>
                    <td className="px-4 py-3 text-caption">{et.display_name}</td>
                    <td className="px-4 py-3 text-caption text-ink-2">
                      {usage[et.id] ? T.et_used_by_count(usage[et.id]) : T.et_used_by_none}
                    </td>
                    <td className="px-4 py-3"><Toggle on={et.is_active} onChange={() => toggleActive(et)} /></td>
                    <td className="px-4 py-3">
                      {/* ขนาดปุ่มและระยะห่างชุดเดียวกับแท็บกลุ่มผู้รับ — 32px และเว้นช่อง
                          ก่อนปุ่มลบ สามแท็บนี้อยู่หน้าเดียวกัน ปุ่มแก้/ลบต้องกดเหมือนกันหมด */}
                      <div className="flex items-center">
                        <button onClick={() => openEdit(et)} title={T.edit}
                          className="grid size-8 place-items-center rounded-control hover:bg-surface-2 text-ink-2 hover:text-ink transition-colors">
                          <Pencil size={15} />
                        </button>
                        <button onClick={() => setDeleteTarget(et)} title={T.delete}
                          className="ms-1 grid size-8 place-items-center rounded-control hover:bg-bad-soft text-ink-2 hover:text-bad-strong transition-colors">
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Create/edit dialog */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{form.id ? T.edit_event_type : T.new_event_type}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {formErr && <p className="text-caption text-bad-strong">{formErr}</p>}
            <div>
              <label className="text-caption text-ink-2 block mb-1.5">{T.code_label}</label>
              <input value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))}
                disabled={!!form.id} placeholder={T.code_ph} className={inputCls} />
              <p className="text-micro text-ink-2 mt-1">{T.code_hint}</p>
            </div>
            <div>
              <label className="text-caption text-ink-2 block mb-1.5">{T.display_name_label}</label>
              <input value={form.display_name} onChange={(e) => setForm((f) => ({ ...f, display_name: e.target.value }))}
                placeholder={T.display_name_ph} className={inputCls} />
            </div>
            <div>
              <label className="text-caption text-ink-2 block mb-1.5">{T.message_template_label}</label>
              <textarea value={form.message_template} onChange={(e) => setForm((f) => ({ ...f, message_template: e.target.value }))}
                placeholder={T.message_template_ph} rows={3} className={inputCls} />
              <p className="text-micro text-ink-2 mt-1">{T.message_template_hint}</p>
            </div>
            {form.id && (
              <div className="flex items-center justify-between">
                <label className="text-caption text-ink-2">{T.active_label}</label>
                <Toggle on={form.is_active} onChange={(v) => setForm((f) => ({ ...f, is_active: v }))} />
              </div>
            )}
          </div>
          <DialogFooter>
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
