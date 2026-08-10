import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus, Trash2, Pencil, Send, Layers } from "lucide-react";
import { useApp } from "../context/AppContext";
import { Toggle } from "../components/Toggle";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "../components/ui/dialog";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription,
  AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from "../components/ui/alert-dialog";
import { listGroups } from "../api/groups";
import { listEventTypes, createEventType, updateEventType, deleteEventType, sendTestNotify } from "../api/eventTypes";
import { ApiError } from "../api/client";
import { Btn, PageHeader, inputCls } from "../components/primitives";
import type { EventType, Group } from "../types";

// เดิมเป็น inputCls ของตัวเองที่ hardcode สี — ใช้ตัวกลางจาก primitives แทนเพื่อให้หน้าตา
// ช่องกรอกตรงกับทุกหน้า และเปลี่ยนที่เดียวเมื่อดีไซน์เปลี่ยน

interface FormState {
  id?: number;
  code: string;
  display_name: string;
  message_template: string;
  group_id: number | "";
  is_active: boolean;
}

const EMPTY_FORM: FormState = { code: "", display_name: "", message_template: "", group_id: "", is_active: true };

/** embedded = ถูกฝังอยู่ในหน้า SetupPage ที่มีหัวข้อของตัวเองแล้ว จึงไม่ต้องขึ้นหัวข้อซ้ำ */
export function EventTypesPage({ embedded = false }: { embedded?: boolean } = {}) {
  const { T } = useApp();
  const [eventTypes, setEventTypes] = useState<EventType[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [formErr, setFormErr] = useState("");

  const [deleteTarget, setDeleteTarget] = useState<EventType | null>(null);

  const [testTarget, setTestTarget] = useState<EventType | null>(null);
  const [testVars, setTestVars] = useState("");
  const [testMessage, setTestMessage] = useState("");
  const [sending, setSending] = useState(false);

  const load = () => Promise.all([listEventTypes(), listGroups()]).then(([ets, gs]) => { setEventTypes(ets); setGroups(gs); });

  useEffect(() => { load().finally(() => setLoading(false)); }, []);

  const openCreate = () => { setForm(EMPTY_FORM); setFormErr(""); setFormOpen(true); };
  const openEdit = (et: EventType) => {
    setForm({ id: et.id, code: et.code, display_name: et.display_name, message_template: et.message_template, group_id: et.group_id ?? "", is_active: et.is_active });
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
          group_id: form.group_id === "" ? null : Number(form.group_id),
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
          group_id: form.group_id === "" ? null : Number(form.group_id),
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

  const openTest = (et: EventType) => {
    setTestTarget(et);
    setTestVars("");
    setTestMessage("");
  };

  const sendTest = async () => {
    if (!testTarget) return;
    const variables: Record<string, string> = {};
    testVars.split("\n").forEach((line) => {
      const idx = line.indexOf("=");
      if (idx > 0) variables[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
    });
    setSending(true);
    try {
      const res = await sendTestNotify({
        event_type_code: testTarget.code,
        message: testMessage.trim() || undefined,
        variables,
      });
      toast.success(T.test_sent_ok(res.job_id));
      setTestTarget(null);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : T.error_generic);
    } finally {
      setSending(false);
    }
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

      {eventTypes.length === 0 ? (
        /* ตัด MOCK_EVENT_TYPES_PREVIEW ออก — เดิมโชว์ power_outage/network_outage ปลอมไว้
           ซึ่งอ่านผิดได้ว่าตั้งค่าไว้แล้ว ทั้งที่ยังยิง /notify ไม่ได้เลย */
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
            <table className="w-full min-w-[560px]">
              <thead>
                <tr className="border-b border-line bg-surface-2">
                  {[T.col_code, T.col_name, T.filter_group, T.col_active, T.col_actions].map((h) => (
                    <th key={h} className="text-left px-4 py-2.5 font-mono text-micro font-bold text-ink-2">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line-2">
                {eventTypes.map((et) => (
                  <tr key={et.id} className="hover:bg-surface-2 transition-colors">
                    <td className="px-4 py-3 font-mono text-caption text-brand">{et.code}</td>
                    <td className="px-4 py-3 text-caption">{et.display_name}</td>
                    <td className="px-4 py-3 text-caption text-ink-2">{et.group_name}</td>
                    <td className="px-4 py-3"><Toggle on={et.is_active} onChange={() => toggleActive(et)} /></td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <button onClick={() => openTest(et)} title={T.send_test}
                          className="p-1.5 rounded-control hover:bg-brand-soft text-ink-2 hover:text-brand transition-colors">
                          <Send size={14} />
                        </button>
                        <button onClick={() => openEdit(et)} title={T.edit}
                          className="p-1.5 rounded-control hover:bg-surface-2 text-ink-2 hover:text-ink transition-colors">
                          <Pencil size={14} />
                        </button>
                        <button onClick={() => setDeleteTarget(et)} title={T.delete}
                          className="p-1.5 rounded-control hover:bg-bad-soft text-ink-2 hover:text-bad transition-colors">
                          <Trash2 size={14} />
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
            {formErr && <p className="text-caption text-bad">{formErr}</p>}
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
            {/* กลุ่มผู้รับไม่ใช่ของบังคับอีกแล้ว — กลุ่มจริงเลือกที่หน้าตั้งค่าอุปกรณ์
                เพราะอุปกรณ์คนละตัวใช้เหตุการณ์เดียวกันแต่ต้องโทรหาคนละกลุ่มได้
                ช่องนี้เหลือไว้เป็น "ค่าสำรอง" ใช้ตอนกดทดสอบจาก dashboard ที่ไม่ได้ยิงผ่านอุปกรณ์ */}
            <div>
              <label className="text-caption text-ink-2 block mb-1.5">
                {T.et_group_label}
              </label>
              <select value={form.group_id} onChange={(e) => setForm((f) => ({ ...f, group_id: e.target.value ? Number(e.target.value) : "" }))}
                className={`${inputCls} [color-scheme:light] dark:[color-scheme:dark]`}>
                <option value="">{T.et_group_optional_none}</option>
                {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
              <p className="text-micro text-ink-2 mt-1 leading-[1.7]">{T.et_group_optional_hint}</p>
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

      {/* Send test dialog */}
      <Dialog open={!!testTarget} onOpenChange={(open) => !open && setTestTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{T.test_dialog_title}</DialogTitle>
            <DialogDescription className="font-mono text-caption">{testTarget?.code}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-caption text-ink-2 block mb-1.5">{T.test_message_override_label}</label>
              <textarea value={testMessage} onChange={(e) => setTestMessage(e.target.value)} rows={2} className={inputCls} />
            </div>
            <div>
              <label className="text-caption text-ink-2 block mb-1.5">{T.test_variables_label}</label>
              <textarea value={testVars} onChange={(e) => setTestVars(e.target.value)} rows={3} placeholder="location=Server room A" className={`${inputCls} font-mono`} />
              <p className="text-micro text-ink-2 mt-1">{T.test_variables_hint}</p>
            </div>
          </div>
          <DialogFooter>
            <button onClick={() => setTestTarget(null)} className="px-4 py-2.5 rounded-control border border-line text-caption text-ink-2 bg-surface-2">{T.cancel}</button>
            <button onClick={sendTest} disabled={sending} className="flex items-center gap-1.5 px-4 py-2.5 rounded-control bg-brand hover:brightness-110 text-brand-ink text-caption font-semibold disabled:opacity-60">
              <Send size={13} />{sending ? T.sending : T.send}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{T.delete_confirm_title}</AlertDialogTitle>
            <AlertDialogDescription>{T.event_type_delete_confirm}</AlertDialogDescription>
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
