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
import { ArrowDown, ArrowUp, Check, ChevronDown, ChevronUp, Pencil, Plus, Search, Trash2, Users, X } from 'lucide-react';

import { cn } from '@/app/components/ui/utils';
import { ApiError } from '../api/client';
import {
  createContact, createGroup, deleteContact, deleteGroup, listContacts, listGroups,
  reorderContacts, updateContact, updateGroup,
} from '../api/groups';
import { Btn, PageHeader, inputCls } from '../components/primitives';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '../components/ui/dialog';
import { useApp } from '../context/AppContext';
import { SNAP, readSnapshot, writeSnapshot } from '../lib/snapshot';
import type { Contact, Group } from '../types';

/** ค่าที่กำลังพิมพ์อยู่ในแถวเพิ่มเบอร์ของแต่ละกลุ่ม */
interface DraftContact {
  phone: string;
  name: string;
}

const EMPTY_DRAFT: DraftContact = { phone: '', name: '' };

/** ชื่อ 3 คนแรกของกลุ่มไว้โชว์ในแถว — คนที่ไม่ได้ตั้งชื่อใช้เบอร์แทน
 *  เกินนั้นสรุปเป็น "+N" เพราะแถวมีที่จำกัดและรายชื่อเต็มอยู่ในส่วนที่กางออกมาแล้ว */
const PREVIEW_NAMES = 3;

function memberPreview(contacts: Contact[] | undefined): string {
  if (!contacts || contacts.length === 0) return '';
  const shown = contacts.slice(0, PREVIEW_NAMES).map((c) => c.name?.trim() || c.phone_number);
  const rest = contacts.length - shown.length;
  return rest > 0 ? `${shown.join(', ')} +${rest}` : shown.join(', ');
}

/** ตัดทุกอย่างที่ไม่ใช่ตัวเลขทิ้ง — คนพิมพ์ค้นเป็น "081-234" หรือ "081 234 5678" ก็ต้องเจอ
 *  เบอร์ที่เก็บไว้เป็น 0812345678 ไม่งั้นค้นด้วยเบอร์แทบไม่มีวันตรง */
const digitsOf = (s: string) => s.replace(/\D/g, '');

/** เบอร์นี้ตรงคำค้นไหม — ดูทั้งชื่อคนและตัวเลข
 *  ตัวเลขเทียบเฉพาะตอนที่คำค้นมีตัวเลขอยู่จริง ไม่งั้นค้นคำว่า "ช่าง" (digits = "")
 *  จะกลายเป็น "".includes("") = true คือตรงกับทุกเบอร์ในระบบ */
function contactMatches(c: Contact, q: string, digits: string): boolean {
  if ((c.name ?? '').toLowerCase().includes(q)) return true;
  return digits.length > 0 && digitsOf(c.phone_number).includes(digits);
}

/** ข้อมูลที่ฝากไว้ให้รอบหน้าหยิบไปวาดทันที (ดู lib/snapshot.ts) */
type ContactsSnap = { groups: Group[]; contactsByGroup: Record<number, Contact[]> };

/** embedded = ถูกฝังอยู่ในหน้า SetupPage ที่มีหัวข้อของตัวเองแล้ว จึงไม่ต้องขึ้นหัวข้อซ้ำ */
export function ContactsPage({ embedded = false }: { embedded?: boolean } = {}) {
  const { T } = useApp();
  const cached = readSnapshot<ContactsSnap>(SNAP.contacts);
  const [groups, setGroups] = useState<Group[]>(cached?.groups ?? []);
  const [contactsByGroup, setContactsByGroup] = useState<Record<number, Contact[]>>(cached?.contactsByGroup ?? {});
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  const [adding, setAdding] = useState<Record<number, DraftContact>>({});
  const [newName, setNewName] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [query, setQuery] = useState('');
  const [pendingDelete, setPendingDelete] = useState<number | null>(null);
  // มีของเก่าอยู่แล้ว = ไม่ต้องขึ้น "กำลังโหลด" ให้วาดของเก่าไปก่อนแล้วโหลดทับเงียบๆ
  const [loading, setLoading] = useState(!cached);

  // แก้ไขทีละรายการ เก็บ id ที่กำลังแก้ + ค่าที่พิมพ์ค้างไว้
  const [editingContact, setEditingContact] = useState<number | null>(null);
  const [contactDraft, setContactDraft] = useState<DraftContact>(EMPTY_DRAFT);
  const [editingGroup, setEditingGroup] = useState<number | null>(null);
  const [groupDraft, setGroupDraft] = useState('');

  const loadGroups = () => listGroups().then(setGroups);

  useEffect(() => {
    /* ดึงเบอร์ของทุกกลุ่มมาตั้งแต่แรก ไม่ใช่รอตอนกางกลุ่ม
       เดิมโหลดตอนกางเท่านั้น ซึ่งประหยัดคำขอจริง แต่แลกมาด้วยการที่หน้านี้ตอบคำถาม
       ที่คนเปิดมาถามบ่อยที่สุดไม่ได้เลย — "ช่างต้นอยู่กลุ่มไหน" ต้องกางทีละกลุ่มจนครบ 6 ครั้ง
       ตอนนี้เอาชื่อ 3 คนแรกมาโชว์ในแถวเลย ตอบได้ด้วยการกวาดตารอบเดียว
       (กลุ่มมีไม่กี่กลุ่มและแต่ละคำขอเล็กมาก ต่างกับหน้าประวัติที่ข้อมูลโตไม่จำกัด) */
    void listGroups()
      .then((gs) => {
        setGroups(gs);
        return Promise.all(
          gs.map((g) =>
            listContacts(g.id)
              .then((cs) => [g.id, cs] as const)
              .catch(() => [g.id, [] as Contact[]] as const),
          ),
        );
      })
      .then((pairs) => setContactsByGroup(Object.fromEntries(pairs)))
      .catch(() => toast.error(T.error_generic))
      .finally(() => setLoading(false));
  }, []);

  // ฝากของชุดล่าสุดไว้ทุกครั้งที่มันเปลี่ยน ไม่ใช่แค่ตอนโหลดเสร็จ — การเพิ่ม/แก้/ลบ/สลับลำดับ
  // อัปเดต state ตรงๆ โดยไม่โหลดใหม่ ถ้าเขียนแคชแค่ตอนโหลด รอบหน้าจะได้ของก่อนแก้
  useEffect(() => {
    if (!loading) writeSnapshot<ContactsSnap>(SNAP.contacts, { groups, contactsByGroup });
  }, [loading, groups, contactsByGroup]);

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

  /* คำค้นเดียวหาได้ทั้งสามอย่าง — ชื่อกลุ่ม ชื่อคน และเบอร์
     เพราะคนเปิดหน้านี้รู้อยู่แค่อย่างเดียวในสามอย่างนั้น ("เบอร์ 081... อยู่กลุ่มไหน"
     หรือ "ช่างต้นอยู่กลุ่มไหน") แล้วอยากได้อีกสองอย่างที่เหลือ
     ถ้าแยกเป็นช่องค้นตามประเภท คนต้องรู้ก่อนว่าสิ่งที่ตัวเองถืออยู่เรียกว่าอะไร */
  const q = query.trim().toLowerCase();
  const qDigits = digitsOf(q);
  const hitsIn = (groupId: number) =>
    (contactsByGroup[groupId] ?? []).some((c) => contactMatches(c, q, qDigits));
  const visible = q
    ? groups.filter((g) => g.name.toLowerCase().includes(q) || hitsIn(g.id))
    : groups;

  return (
    /* flex-1 + min-h-0: ขอพื้นที่ที่เหลือจาก SetupPage มาให้กล่องรายชื่อเลื่อนในตัวเอง
       เหมือนหน้าคิวกับหน้าประวัติ ไม่งั้นหน้าจะยาวลงไปเรื่อยๆ ตามจำนวนกลุ่ม
       ความสูงที่แน่นอนมาจาก SetupPage (h-full เฉพาะตอนอยู่แท็บนี้) — ที่นี่ต้องไม่เขียน
       h-full ซ้ำ เพราะจะกลายเป็น 100% ของทั้งหน้า ซึ่งมากกว่าที่เหลือจริงหลังหักหัวเรื่องกับแท็บ */
    <div className="flex min-h-0 flex-1 flex-col gap-3.5">
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

      {/* ช่องค้นหาโผล่เมื่อมีกลุ่มแล้วเท่านั้น — หน้าเปล่าไม่มีอะไรให้ค้น */}
      {groups.length > 0 ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2.5">
          <span className="relative min-w-0 flex-1 basis-[15rem] sm:max-w-[24rem]">
            <Search
              size={15}
              aria-hidden
              className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-ink-2"
            />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={T.contacts_search}
              aria-label={T.contacts_search}
              className={cn(inputCls, 'w-full ps-9')}
            />
          </span>
          {q ? (
            <span className="font-mono text-micro text-ink-2">{T.contacts_search_found(visible.length)}</span>
          ) : null}
        </div>
      ) : null}

      {groups.length === 0 ? (
        <div className="flex flex-col items-center gap-2.5 rounded-card border border-dashed border-line px-4 py-7 text-center">
          <p className="text-lead font-semibold">{T.contacts_title}</p>
          <p className="text-caption text-ink-2">{T.contacts_sub}</p>
          <Btn variant="primary" className="mt-0.5" onClick={() => setShowNew(true)}>
            <Plus size={15} />
            {T.add_group}
          </Btn>
        </div>
      ) : null}

      {/* กลุ่มทั้งหมดอยู่ใน "กล่องเดียว" คั่นแต่ละกลุ่มด้วยเส้น ไม่ใช่การ์ดลอยใบละกลุ่ม
          เป็นรูปแบบเดียวกับตารางคิว ตารางประวัติ และรายการอุปกรณ์บนหน้าภาพรวม
          หน้านี้เคยเป็นหน้าเดียวในเว็บที่เนื้อหาลอยอยู่บนพื้นหลังโดยไม่มีกรอบ
          จึงดูเหมือนคนละเว็บกับหน้าอื่นทั้งที่ใช้สีชุดเดียวกัน */}
      <div className="min-h-[10rem] min-w-0 flex-1 overflow-auto overscroll-contain rounded-card border border-line bg-surface shadow-card">
        {visible.length === 0 ? (
          <p className="px-4 py-10 text-center text-caption text-ink-2">{T.contacts_search_none}</p>
        ) : null}

        {visible.map((g) => {
          const phones = contactsByGroup[g.id] || [];
          const pending = pendingDelete === g.id;
          const renaming = editingGroup === g.id;
          /* ตอนค้นเจอคนในกลุ่ม ให้กางกลุ่มนั้นเองโดยไม่ต้องกด — คนค้นชื่อคนอยากเห็นคนนั้น
             ไม่ใช่แค่ชื่อกลุ่มที่เขาอยู่ คิดเป็นค่าจาก q ตรงนี้แทนที่จะไปแก้ state expanded
             เพราะถ้าไปเขียน state ทับ พอลบคำค้นออกกลุ่มจะค้างกางอยู่ทั้งที่ผู้ใช้ไม่ได้กดเอง */
          const open = expanded[g.id] || (q !== '' && hitsIn(g.id));
          return (
            <div key={g.id} className="min-w-0 border-b border-line-2 last:border-b-0">
              {/* ทั้งแถวกดกางได้ ไม่ใช่เฉพาะช่วงชื่อกับลูกศร (ตามไฟล์ดีไซน์)
                  ของเดิมพื้นที่ว่างกลางแถวกดไม่ติด ทั้งที่ตาเห็นเป็นแถบเดียวกันหมด
                  กดแล้วไม่มีอะไรเกิดขึ้นอ่านได้ว่าเว็บค้าง มากกว่าจะเดาว่ากดผิดที่

                  ปุ่มข้างในต้อง stopPropagation ไม่งั้นกดแก้ชื่อแล้วแถวกางออกมาด้วย */
              }
              <div
                role={renaming ? undefined : 'button'}
                tabIndex={renaming ? undefined : 0}
                onClick={renaming ? undefined : () => toggleExpand(g.id)}
                onKeyDown={
                  renaming
                    ? undefined
                    : (e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          toggleExpand(g.id);
                        }
                      }
                }
                className={cn(
                  'flex w-full items-center gap-2.5 px-4 py-3.5',
                  !renaming && 'cursor-pointer transition-colors hover:bg-surface-2',
                )}
              >
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
                      className="shrink-0 rounded-control px-1.5 py-1 text-ok-strong disabled:opacity-40"
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
                    <span className="flex min-w-0 flex-1 items-center gap-2.5 text-start">
                      <span className="grid size-8 shrink-0 place-items-center rounded-control bg-brand-soft">
                        <Users size={15} className="text-brand-strong" strokeWidth={1.8} />
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-caption font-semibold">{g.name}</span>
                        <span className="block truncate text-micro text-ink-2">
                          <span className="font-mono">{T.phones_count(g.contact_count)}</span>
                          {memberPreview(contactsByGroup[g.id]) ? ` · ${memberPreview(contactsByGroup[g.id])}` : ''}
                        </span>
                      </span>
                    </span>

                    {/* ปุ่มไอคอนขนาด 32px ไม่ใช่ ~24px แบบเดิม และเว้นช่องก่อนปุ่มลบ
                        ของเดิมดินสอกับถังขยะติดกันเกือบชิด ทั้งคู่เล็กและไม่มีข้อความกำกับ
                        พลาดไปหนึ่งช่องคือลบทั้งกลุ่ม (มียืนยันสองจังหวะก็จริง แต่การกดพลาด
                        ไม่ควรเริ่มต้นที่ปุ่มทำลายตั้งแต่แรก) */}
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); setEditingGroup(g.id); setGroupDraft(g.name); }}
                      className="grid size-8 shrink-0 place-items-center rounded-control text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink"
                      aria-label={T.edit_group_name}
                      title={T.edit_group_name}
                    >
                      <Pencil size={15} />
                    </button>

                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); pending ? removeGroup(g.id) : setPendingDelete(g.id); }}
                      title={T.device_remove}
                      className={cn(
                        'ms-1 shrink-0 rounded-control text-micro transition-colors',
                        pending
                          ? 'bg-bad-strong px-2.5 py-1.5 text-status-ink'
                          : 'grid size-8 place-items-center text-ink-2 hover:bg-bad-soft hover:text-bad-strong',
                      )}
                    >
                      {pending ? T.device_remove_confirm : <Trash2 size={15} />}
                    </button>

                    {/* ลูกศรเป็นแค่สัญลักษณ์บอกว่ากางได้ — ทั้งแถวรับคลิกอยู่แล้ว
                        จึงไม่ต้องเป็นปุ่มซ้อนปุ่ม (และไม่ต้องมี tab stop ของตัวเอง) */}
                    <span
                      aria-hidden="true"
                      className="grid size-8 shrink-0 place-items-center text-ink-2"
                    >
                      {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                    </span>
                  </>
                )}
              </div>

              {open ? (
                <div className="border-t border-line">
                  {phones.length === 0 ? (
                    <p className="px-4 py-4 text-caption text-ink-2">{T.no_phones}</p>
                  ) : null}

                  {/* ไม่กรองแถวเบอร์ทิ้งตอนค้น — เลขลำดับคือลำดับไล่โทรจริง ถ้าซ่อนบางแถว
                      เลขที่เห็นจะไม่ตรงกับที่ระบบใช้ และคนที่ค้นเจอ "ช่างต้น" มักอยากรู้ด้วยว่า
                      เขาอยู่ลำดับที่เท่าไหร่ ใครโทรก่อน ใครโทรต่อ — เลยแค่ทำแถวที่ตรงให้เด่นขึ้น */}
                  {phones.map((c, idx) => (
                    <div
                      key={c.id}
                      className={cn(
                        'flex items-center gap-2.5 border-b border-line-2 px-4 py-2.5 last:border-b-0',
                        q !== '' && contactMatches(c, q, qDigits) && 'bg-brand-soft',
                      )}
                    >
                      {editingContact === c.id ? (
                        <>
                          {/* ลำดับไม่เปลี่ยนตอนแก้ — แก้เบอร์ผิดแล้วต้องอยู่ตำแหน่งเดิมในสายไล่โทร */}
                          <span className="grid size-6 shrink-0 place-items-center rounded-full bg-surface-2 font-mono text-micro font-bold">
                            {idx + 1}
                          </span>
                          <span className="flex min-w-0 flex-1 flex-wrap gap-1.5">
                            <input
                              className={cn(inputCls, 'min-w-0 flex-1 basis-[8.125rem] py-1.5 font-mono text-caption')}
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
                              className={cn(inputCls, 'min-w-0 flex-1 basis-[6.25rem] py-1.5 text-caption')}
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
                            className="shrink-0 rounded-control px-1.5 py-1 text-ok-strong disabled:opacity-40"
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
                            className="shrink-0 rounded-control px-1.5 py-1 text-ink-2 transition-colors hover:text-bad-strong"
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
                      className={cn(inputCls, 'min-w-0 flex-1 basis-[8.125rem] bg-surface font-mono')}
                      value={adding[g.id]?.phone ?? ''}
                      onChange={(e) =>
                        setAdding((a) => ({ ...a, [g.id]: { ...(a[g.id] ?? EMPTY_DRAFT), phone: e.target.value } }))
                      }
                      onKeyDown={(e) => e.key === 'Enter' && addPhone(g.id)}
                      placeholder={T.phone_ph}
                    />
                    <input
                      className={cn(inputCls, 'min-w-0 flex-1 basis-[6.25rem] bg-surface')}
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
            </div>
          );
        })}
      </div>

      {/* ── ป๊อปอัพสร้างกลุ่ม ───────────────────────────────────────────────
          เดิมเป็นการ์ดที่แทรกกลางหน้า ซึ่งดันรายการกลุ่มทั้งก้อนเลื่อนลงตอนกดเพิ่ม
          ตำแหน่งที่ตาจ้องอยู่จึงขยับหนีทุกครั้ง และการ์ดนั้นก็ไม่มีที่ให้อธิบายว่า
          "ชื่อกลุ่มนี้จะไปโผล่ที่ไหน" ทั้งที่เป็นสิ่งเดียวที่ต้องตัดสินใจตอนสร้าง

          ใช้ <Dialog> ของ Radix ด้วยเหตุผลเดียวกับหน้าอุปกรณ์: AppShell ห่อทุกหน้าไว้ด้วย
          div ที่มี transform ซึ่งกลายเป็น containing block ของ position:fixed
          กล่องที่เขียน fixed เองจึงไปอิงขอบ <main> แทนขอบจอ */}
      <Dialog
        open={showNew}
        onOpenChange={(next) => {
          setShowNew(next);
          if (!next) setNewName('');
        }}
      >
        <DialogContent className="max-w-[calc(100%-2rem)] sm:max-w-[28rem]">
          <DialogHeader className="gap-3 text-start">
            <div className="flex flex-row items-center gap-3 pe-6">
              <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand-strong">
                <Users size={20} strokeWidth={1.8} />
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <DialogTitle className="text-lead font-bold">{T.new_group}</DialogTitle>
                <DialogDescription className="text-micro leading-[1.6] text-ink-2">
                  {T.contacts_sub}
                </DialogDescription>
              </span>
            </div>
          </DialogHeader>

          <div>
            <label className="text-caption text-ink-2 mb-1.5 block" htmlFor="new-group-name">
              {T.group_name_label}
            </label>
            <input
              id="new-group-name"
              className={cn(inputCls, 'w-full')}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addGroup()}
              placeholder={T.new_group_ph}
              autoFocus
            />
            <p className="text-micro mt-1.5 leading-[1.7] text-ink-2">{T.new_group_hint}</p>
          </div>

          <DialogFooter>
            <Btn onClick={() => setShowNew(false)}>{T.cancel}</Btn>
            <Btn variant="primary" onClick={addGroup} disabled={!newName.trim()}>
              <Plus size={15} />
              {T.create}
            </Btn>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
