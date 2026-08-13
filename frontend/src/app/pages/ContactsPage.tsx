/**
 * ContactsPage — กลุ่มผู้รับ + เบอร์เรียงตามลำดับการโทร (escalation chain)
 *
 * หน้านี้เป็น "สมุดโทรศัพท์" ของระบบ อยู่ได้ด้วยตัวเองโดยไม่ต้องผูกกับอะไรเลย
 * สร้างกลุ่ม เพิ่ม/ลบ/แก้เบอร์และชื่อได้อิสระ ส่วนใครจะถูกโทรตอนไหนเป็นเรื่องของ
 * หน้าอุปกรณ์ & key ซึ่งหยิบกลุ่มหรือเจาะเบอร์จากที่นี่ไปใช้
 *
 * ── ที่แก้จากเวอร์ชันเดิม ──────────────────────────────────────────────────
 * 1. hardcode hex 71 จุด → token ทั้งหมด
 * 2. ตัด MOCK_GROUPS_PREVIEW ออก — เดิมพอไม่มีกลุ่มจะโชว์ "ทีมเครือข่าย/ทีมไฟฟ้า"
 *    พร้อมเบอร์ปลอม 5 เบอร์ (แม้จะ pointer-events-none) ซึ่งอ่านผิดได้ว่าตั้งค่าไว้แล้ว
 *    หน้านี้คือที่ที่บอกว่า "ระบบจะโทรหาใคร" — ต้องไม่มีเบอร์ปลอมโผล่เลย
 * 3. เปลี่ยน window.confirm ตอนลบกลุ่ม → ยืนยัน 2 จังหวะในปุ่มเดิมตามดีไซน์
 * 4. ลำดับเบอร์ = ลำดับที่ระบบจะไล่โทร จึงเน้นเลขลำดับให้เห็นชัดกว่าเดิม
 * 5. เพิ่ม "แก้ไข" ที่ยังขาดไป — เดิมเพิ่มกับลบได้อย่างเดียว พิมพ์เบอร์ผิดตัวเดียว
 *    ต้องลบทิ้งแล้วเพิ่มใหม่ ซึ่งทำให้เบอร์ไปต่อท้ายลำดับไล่สายแทนที่จะอยู่ที่เดิม
 *    (คนที่ควรถูกโทรเป็นคนแรกกลายเป็นคนสุดท้ายโดยไม่มีใครสังเกต) และตอนเพิ่มเบอร์
 *    ก็ใส่ชื่อไม่ได้เลยทั้งที่ฐานข้อมูลรองรับ ต้องมาแก้ทีหลังซึ่งก็ยังแก้ไม่ได้อีก
 */
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { ArrowDown, ArrowUp, Check, ChevronDown, ChevronUp, Pencil, Plus, Trash2, Users, X } from 'lucide-react';

import { cn } from '@/app/components/ui/utils';
import { ApiError } from '../api/client';
import {
  createContact, createGroup, deleteContact, deleteGroup, listContacts, listGroups,
  reorderContacts, updateContact, updateGroup,
} from '../api/groups';
import { Btn, Card, PageHeader, inputCls } from '../components/primitives';
import { useApp } from '../context/AppContext';
import type { Contact, Group } from '../types';

/** ค่าที่กำลังพิมพ์อยู่ในแถวเพิ่มเบอร์ของแต่ละกลุ่ม */
interface DraftContact {
  phone: string;
  name: string;
}

const EMPTY_DRAFT: DraftContact = { phone: '', name: '' };

/** embedded = ถูกฝังอยู่ในหน้า SetupPage ที่มีหัวข้อของตัวเองแล้ว จึงไม่ต้องขึ้นหัวข้อซ้ำ */
export function ContactsPage({ embedded = false }: { embedded?: boolean } = {}) {
  const { T } = useApp();
  const [groups, setGroups] = useState<Group[]>([]);
  const [contactsByGroup, setContactsByGroup] = useState<Record<number, Contact[]>>({});
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  const [adding, setAdding] = useState<Record<number, DraftContact>>({});
  const [newName, setNewName] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  // แก้ไขทีละรายการ เก็บ id ที่กำลังแก้ + ค่าที่พิมพ์ค้างไว้
  const [editingContact, setEditingContact] = useState<number | null>(null);
  const [contactDraft, setContactDraft] = useState<DraftContact>(EMPTY_DRAFT);
  const [editingGroup, setEditingGroup] = useState<number | null>(null);
  const [groupDraft, setGroupDraft] = useState('');

  const loadGroups = () => listGroups().then(setGroups);

  useEffect(() => {
    void loadGroups().finally(() => setLoading(false));
  }, []);

  const loadContacts = (groupId: number) => {
    listContacts(groupId)
      .then((cs) => setContactsByGroup((m) => ({ ...m, [groupId]: cs })))
      .catch(() => toast.error(T.error_generic));
  };

  const toggleExpand = (groupId: number) => {
    const willExpand = !expanded[groupId];
    setExpanded((e) => ({ ...e, [groupId]: willExpand }));
    if (willExpand && !contactsByGroup[groupId]) loadContacts(groupId);
  };

  const addGroup = () => {
    if (!newName.trim()) return;
    createGroup({ name: newName.trim() })
      .then((g) => {
        setGroups((gs) => [...gs, g]);
        setNewName('');
        setShowNew(false);
        toast.success(T.toast_created);
      })
      .catch((e) => toast.error(e instanceof ApiError ? e.message : T.error_generic));
  };

  const saveGroupName = (groupId: number) => {
    const name = groupDraft.trim();
    if (!name) return;
    updateGroup(groupId, { name })
      .then((g) => {
        setGroups((gs) => gs.map((x) => (x.id === groupId ? { ...x, name: g.name } : x)));
        setEditingGroup(null);
        toast.success(T.toast_updated);
      })
      .catch((e) => toast.error(e instanceof ApiError ? e.message : T.error_generic));
  };

  const removeGroup = (groupId: number) => {
    deleteGroup(groupId)
      .then(() => {
        setGroups((gs) => gs.filter((g) => g.id !== groupId));
        setContactsByGroup((m) => {
          const { [groupId]: _drop, ...rest } = m;
          return rest;
        });
        setPendingDelete(null);
        toast.success(T.toast_deleted);
      })
      // backend ตอบ 409 ถ้ากลุ่มยังถูกอุปกรณ์ใช้อยู่ — ข้อความจาก detail อธิบายชัดแล้ว
      .catch((e) => toast.error(e instanceof ApiError ? e.message : T.error_generic));
  };

  const addPhone = (groupId: number) => {
    const draft = adding[groupId] ?? EMPTY_DRAFT;
    const phone = draft.phone.trim();
    if (!phone) return;
    createContact(groupId, { phone_number: phone, name: draft.name.trim() || undefined })
      .then((c) => {
        setContactsByGroup((m) => ({ ...m, [groupId]: [...(m[groupId] || []), c] }));
        setAdding((a) => ({ ...a, [groupId]: EMPTY_DRAFT }));
        setGroups((gs) => gs.map((g) => (g.id === groupId ? { ...g, contact_count: g.contact_count + 1 } : g)));
      })
      .catch((e) => toast.error(e instanceof ApiError ? e.message : T.error_generic));
  };

  const startEditContact = (c: Contact) => {
    setEditingContact(c.id);
    setContactDraft({ phone: c.phone_number, name: c.name ?? '' });
  };

  const saveContact = (groupId: number, contactId: number) => {
    const phone = contactDraft.phone.trim();
    if (!phone) return;
    updateContact(contactId, { phone_number: phone, name: contactDraft.name.trim() })
      .then((updated) => {
        setContactsByGroup((m) => ({
          ...m,
          [groupId]: (m[groupId] || []).map((c) => (c.id === contactId ? updated : c)),
        }));
        setEditingContact(null);
        toast.success(T.toast_updated);
      })
      .catch((e) => toast.error(e instanceof ApiError ? e.message : T.error_generic));
  };

  const removePhone = (groupId: number, contactId: number) => {
    deleteContact(contactId)
      .then(() => {
        setContactsByGroup((m) => ({
          ...m,
          [groupId]: (m[groupId] || []).filter((c) => c.id !== contactId),
        }));
        setGroups((gs) =>
          gs.map((g) => (g.id === groupId ? { ...g, contact_count: Math.max(0, g.contact_count - 1) } : g)),
        );
      })
      .catch((e) => toast.error(e instanceof ApiError ? e.message : T.error_generic));
  };

  const movePhone = (groupId: number, idx: number, dir: -1 | 1) => {
    const list = contactsByGroup[groupId] || [];
    const ni = idx + dir;
    if (ni < 0 || ni >= list.length) return;
    const reordered = [...list];
    [reordered[idx], reordered[ni]] = [reordered[ni], reordered[idx]];
    // สลับใน UI ทันทีแล้วค่อยยิง API — ถ้าพลาดจะย้อนกลับเป็นลำดับเดิม
    setContactsByGroup((m) => ({ ...m, [groupId]: reordered }));
    reorderContacts(groupId, reordered.map((c) => c.id))
      .then((cs) => setContactsByGroup((m) => ({ ...m, [groupId]: cs })))
      .catch((e) => {
        toast.error(e instanceof ApiError ? e.message : T.error_generic);
        setContactsByGroup((m) => ({ ...m, [groupId]: list }));
      });
  };

  if (loading) {
    return <p className="text-caption text-ink-2">{T.loading}</p>;
  }

  return (
    <div className="flex flex-col gap-3.5">
      {embedded ? (
        <div className="flex flex-wrap items-center gap-3">
          <p className="font-mono text-caption text-ink-2">{T.contacts_sub}</p>
          <span className="ms-auto">
            <Btn variant="primary" onClick={() => setShowNew(true)}>
              <Plus size={15} />
              {T.add_group}
            </Btn>
          </span>
        </div>
      ) : (
        <PageHeader
          title={T.contacts_title}
          meta={T.contacts_sub}
          action={
            <Btn variant="primary" onClick={() => setShowNew(true)}>
              <Plus size={15} />
              {T.add_group}
            </Btn>
          }
        />
      )}

      {showNew ? (
        <Card className="flex max-w-2xl flex-col gap-3 border-brand p-4">
          <p className="text-caption font-semibold">{T.new_group}</p>
          <div className="flex flex-wrap gap-2">
            <input
              className={cn(inputCls, 'min-w-0 flex-1 basis-[180px]')}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addGroup()}
              placeholder={T.new_group_ph}
              autoFocus
            />
            <Btn variant="primary" onClick={addGroup} disabled={!newName.trim()}>
              {T.create}
            </Btn>
            <Btn onClick={() => setShowNew(false)} aria-label={T.cancel}>
              <X size={15} />
            </Btn>
          </div>
        </Card>
      ) : null}

      {groups.length === 0 && !showNew ? (
        <div className="flex flex-col items-center gap-2.5 rounded-card border border-dashed border-line px-4 py-7 text-center">
          <p className="text-lead font-semibold">{T.contacts_title}</p>
          <p className="text-caption text-ink-2">{T.contacts_sub}</p>
          <Btn variant="primary" className="mt-0.5" onClick={() => setShowNew(true)}>
            <Plus size={15} />
            {T.add_group}
          </Btn>
        </div>
      ) : null}

      <div className="grid grid-cols-[repeat(auto-fill,minmax(min(320px,100%),1fr))] items-start gap-3">
        {groups.map((g) => {
          const phones = contactsByGroup[g.id] || [];
          const pending = pendingDelete === g.id;
          const renaming = editingGroup === g.id;
          return (
            <Card key={g.id} className="min-w-0 overflow-hidden">
              <div className="flex w-full items-center gap-2.5 px-4 py-3.5">
                {renaming ? (
                  <>
                    <input
                      className={cn(inputCls, 'min-w-0 flex-1 py-1.5 text-caption')}
                      value={groupDraft}
                      onChange={(e) => setGroupDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') saveGroupName(g.id);
                        if (e.key === 'Escape') setEditingGroup(null);
                      }}
                      autoFocus
                    />
                    <button
                      type="button"
                      onClick={() => saveGroupName(g.id)}
                      disabled={!groupDraft.trim()}
                      className="shrink-0 rounded-control px-1.5 py-1 text-ok disabled:opacity-40"
                      aria-label={T.save}
                    >
                      <Check size={15} />
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingGroup(null)}
                      className="shrink-0 rounded-control px-1.5 py-1 text-ink-2"
                      aria-label={T.cancel}
                    >
                      <X size={15} />
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => toggleExpand(g.id)}
                      className="flex min-w-0 flex-1 items-center gap-2.5 text-start"
                    >
                      <span className="grid size-8 shrink-0 place-items-center rounded-control bg-brand-soft">
                        <Users size={15} className="text-brand" strokeWidth={1.8} />
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-caption font-semibold">{g.name}</span>
                        <span className="block font-mono text-micro text-ink-2">{T.phones_count(g.contact_count)}</span>
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => { setEditingGroup(g.id); setGroupDraft(g.name); }}
                      className="shrink-0 rounded-control px-1.5 py-1 text-ink-2 transition-colors hover:text-ink"
                      aria-label={T.edit_group_name}
                      title={T.edit_group_name}
                    >
                      <Pencil size={14} />
                    </button>

                    <button
                      type="button"
                      onClick={() => (pending ? removeGroup(g.id) : setPendingDelete(g.id))}
                      className={cn(
                        'shrink-0 rounded-control px-2 py-1.5 text-micro transition-colors',
                        pending ? 'bg-bad text-white' : 'text-ink-2 hover:text-bad',
                      )}
                    >
                      {pending ? T.device_remove_confirm : <Trash2 size={14} />}
                    </button>

                    <button type="button" onClick={() => toggleExpand(g.id)} className="shrink-0 text-ink-2">
                      {expanded[g.id] ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                    </button>
                  </>
                )}
              </div>

              {expanded[g.id] ? (
                <div className="border-t border-line">
                  {phones.length === 0 ? (
                    <p className="px-4 py-4 text-caption text-ink-2">{T.no_phones}</p>
                  ) : null}

                  {phones.map((c, idx) => (
                    <div
                      key={c.id}
                      className="flex items-center gap-2.5 border-b border-line-2 px-4 py-2.5 last:border-b-0"
                    >
                      {editingContact === c.id ? (
                        <>
                          {/* ลำดับไม่เปลี่ยนตอนแก้ — แก้เบอร์ผิดแล้วต้องอยู่ตำแหน่งเดิมในสายไล่โทร */}
                          <span className="grid size-6 shrink-0 place-items-center rounded-full bg-surface-2 font-mono text-micro font-bold">
                            {idx + 1}
                          </span>
                          <span className="flex min-w-0 flex-1 flex-wrap gap-1.5">
                            <input
                              className={cn(inputCls, 'min-w-0 flex-1 basis-[130px] py-1.5 font-mono text-caption')}
                              value={contactDraft.phone}
                              onChange={(e) => setContactDraft((d) => ({ ...d, phone: e.target.value }))}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') saveContact(g.id, c.id);
                                if (e.key === 'Escape') setEditingContact(null);
                              }}
                              placeholder={T.phone_ph}
                              autoFocus
                            />
                            <input
                              className={cn(inputCls, 'min-w-0 flex-1 basis-[100px] py-1.5 text-caption')}
                              value={contactDraft.name}
                              onChange={(e) => setContactDraft((d) => ({ ...d, name: e.target.value }))}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') saveContact(g.id, c.id);
                                if (e.key === 'Escape') setEditingContact(null);
                              }}
                              placeholder={T.contact_name_ph}
                            />
                          </span>
                          <button
                            type="button"
                            onClick={() => saveContact(g.id, c.id)}
                            disabled={!contactDraft.phone.trim()}
                            className="shrink-0 rounded-control px-1.5 py-1 text-ok disabled:opacity-40"
                            aria-label={T.save}
                          >
                            <Check size={15} />
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingContact(null)}
                            className="shrink-0 rounded-control px-1.5 py-1 text-ink-2"
                            aria-label={T.cancel}
                          >
                            <X size={15} />
                          </button>
                        </>
                      ) : (
                        <>
                          <span className="flex shrink-0 flex-col gap-0.5">
                            <button
                              type="button"
                              onClick={() => movePhone(g.id, idx, -1)}
                              disabled={idx === 0}
                              className="grid size-5 place-items-center text-ink-2 hover:text-ink disabled:opacity-20"
                              aria-label={T.move_up}
                            >
                              <ArrowUp size={12} />
                            </button>
                            <button
                              type="button"
                              onClick={() => movePhone(g.id, idx, 1)}
                              disabled={idx === phones.length - 1}
                              className="grid size-5 place-items-center text-ink-2 hover:text-ink disabled:opacity-20"
                              aria-label={T.move_down}
                            >
                              <ArrowDown size={12} />
                            </button>
                          </span>

                          {/* ลำดับนี้คือลำดับที่ระบบจะไล่โทรจริง เน้นให้เห็นชัด */}
                          <span className="grid size-6 shrink-0 place-items-center rounded-full bg-surface-2 font-mono text-micro font-bold">
                            {idx + 1}
                          </span>

                          <span className="min-w-0 flex-1 truncate font-mono text-caption">
                            {c.phone_number}
                            {c.name ? <span className="font-sans text-ink-2"> · {c.name}</span> : null}
                          </span>

                          <button
                            type="button"
                            onClick={() => startEditContact(c)}
                            className="shrink-0 rounded-control px-1.5 py-1 text-ink-2 transition-colors hover:text-ink"
                            aria-label={T.edit}
                            title={T.edit}
                          >
                            <Pencil size={13} />
                          </button>

                          <button
                            type="button"
                            onClick={() => removePhone(g.id, c.id)}
                            className="shrink-0 rounded-control px-1.5 py-1 text-ink-2 transition-colors hover:text-bad"
                            aria-label={T.delete}
                            title={T.delete}
                          >
                            <Trash2 size={13} />
                          </button>
                        </>
                      )}
                    </div>
                  ))}

                  <div className="flex flex-wrap gap-2 bg-surface-2 px-4 py-3">
                    <input
                      className={cn(inputCls, 'min-w-0 flex-1 basis-[130px] bg-surface font-mono')}
                      value={adding[g.id]?.phone ?? ''}
                      onChange={(e) =>
                        setAdding((a) => ({ ...a, [g.id]: { ...(a[g.id] ?? EMPTY_DRAFT), phone: e.target.value } }))
                      }
                      onKeyDown={(e) => e.key === 'Enter' && addPhone(g.id)}
                      placeholder={T.phone_ph}
                    />
                    <input
                      className={cn(inputCls, 'min-w-0 flex-1 basis-[100px] bg-surface')}
                      value={adding[g.id]?.name ?? ''}
                      onChange={(e) =>
                        setAdding((a) => ({ ...a, [g.id]: { ...(a[g.id] ?? EMPTY_DRAFT), name: e.target.value } }))
                      }
                      onKeyDown={(e) => e.key === 'Enter' && addPhone(g.id)}
                      placeholder={T.contact_name_ph}
                    />
                    <Btn onClick={() => addPhone(g.id)} disabled={!(adding[g.id]?.phone ?? '').trim()}>
                      <Plus size={15} />
                    </Btn>
                  </div>
                </div>
              ) : null}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
