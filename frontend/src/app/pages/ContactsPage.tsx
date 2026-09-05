/**
 * ContactsPage — กลุ่มผู้รับ + เบอร์เรียงตามลำดับการโทร (escalation chain)
 *
 * หน้านี้เป็น "สมุดโทรศัพท์" ของระบบ อยู่ได้ด้วยตัวเองโดยไม่ต้องผูกกับอะไรเลย
 * สร้างกลุ่ม เพิ่ม/ลบ/แก้เบอร์และชื่อได้อิสระ ส่วนใครจะถูกโทรตอนไหนเป็นเรื่องของ
 * หน้าอุปกรณ์ & key ซึ่งหยิบกลุ่มหรือเจาะเบอร์จากที่นี่ไปใช้
 *
 * ── รูปทรงมาจากไฟล์ดีไซน์ ─────────────────────────────────────────────────
 * figma/Redesign Notification Settings Page/src/pages/ContactsPage.tsx
 * แต่ใช้ token ของธีมเราทั้งหมด ไม่ใช่ slate/blue ของไฟล์นั้น
 *
 * สาระที่เอามาใช้จริง: แก้ทั้งกลุ่มในป๊อปอัพเดียว (ชื่อกลุ่ม + สมาชิก + ลำดับ)
 * แทนที่จะแก้ทีละช่องคาที่อยู่ในแถว
 *
 * ส่วนรายการกลุ่มไม่ได้ใช้ทรงการ์ดใบละกลุ่มของไฟล์นั้น — ผู้ใช้สั่งกลับเป็นตาราง
 * ชุดเดียวกับแท็บประเภทเหตุการณ์ กางแถวดูรายชื่อได้ ตารางมีหน้าที่เดียวคือ
 * ให้กวาดตาหาแล้วเลือกกลุ่มที่จะแก้ ที่เหลือเป็นงานของป๊อปอัพ
 *
 * ── ที่ต่างจากไฟล์ดีไซน์โดยตั้งใจ ──────────────────────────────────────────
 * 1. ป๊อปอัพแก้กลุ่ม "ไล่ diff" แทนที่จะสร้างสมาชิกใหม่ทั้งชุด
 *    ของต้นฉบับเป็น mock in-memory จึงสร้าง id ใหม่ให้ทุกแถวตอนบันทึกได้
 *    ของจริงทำแบบนั้นไม่ได้ — เบอร์ถูกอ้างถึงโดยตาราง api_key_event_contacts
 *    (คู่ อุปกรณ์+เหตุการณ์ ที่เจาะเบอร์เอง) ลบทิ้งแล้วสร้างใหม่ = ผู้รับสายที่ตั้งไว้
 *    หายเงียบทั้งระบบโดยไม่มีอะไรเตือน จึงเก็บ id เดิมไว้แล้วสั่งเฉพาะที่เปลี่ยนจริง
 * 2. เก็บช่องค้นหาไว้ (ต้นฉบับไม่มี) — ของจริงมีหลายกลุ่มและคำถามที่ถูกถามบ่อยสุดคือ
 *    "เบอร์นี้/คนนี้อยู่กลุ่มไหน" ซึ่งตอบไม่ได้เลยถ้าไม่มีที่ค้น
 * 3. เก็บป๊อปอัพยืนยันตอนลบ (ต้นฉบับลบทันที) — ลบกลุ่มคือลบเบอร์ทั้งกลุ่มตามไปด้วย
 */
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { ChevronDown, ChevronUp, Plus, Search, Users, X } from 'lucide-react';

import { cn } from '@/app/components/ui/utils';
import { ApiError } from '../api/client';
import {
  createContact, createGroup, deleteContact, deleteGroup, listContacts, listGroups,
  reorderContacts, updateContact, updateGroup,
} from '../api/groups';
import { Btn, PageHeader, Pill, inputCls } from '../components/primitives';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '../components/ui/alert-dialog';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '../components/ui/dialog';
import { useApp } from '../context/AppContext';
import { SNAP, readSnapshot, writeSnapshot } from '../lib/snapshot';
import type { Contact, Group } from '../types';

/** หนึ่งแถวในป๊อปอัพแก้กลุ่ม — `id` มีเฉพาะแถวที่มีอยู่จริงในฐานข้อมูลแล้ว
 *  แถวที่เพิ่งกด "เพิ่มสมาชิก" ยังไม่มี id จึงเป็นตัวบอกว่าต้อง POST ไม่ใช่ PUT */
interface MemberRow {
  id?: number;
  name: string;
  phone: string;
}

const EMPTY_ROW: MemberRow = { name: '', phone: '' };

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
  const [query, setQuery] = useState('');
  /* แถวไหนกางอยู่ — ตารางกลับมาแล้วจึงต้องจำอีกครั้ง (ตอนเป็นการ์ดกางค้างทุกใบ) */
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  // มีของเก่าอยู่แล้ว = ไม่ต้องขึ้น "กำลังโหลด" ให้วาดของเก่าไปก่อนแล้วโหลดทับเงียบๆ
  const [loading, setLoading] = useState(!cached);

  /* ป๊อปอัพแก้กลุ่ม — `editing` เป็น null ตอนสร้างกลุ่มใหม่ */
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Group | null>(null);
  const [groupName, setGroupName] = useState('');
  const [rows, setRows] = useState<MemberRow[]>([EMPTY_ROW]);
  const [saving, setSaving] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<Group | null>(null);

  const loadAll = () =>
    listGroups()
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
      .then((pairs) => setContactsByGroup(Object.fromEntries(pairs)));

  useEffect(() => {
    /* ดึงเบอร์ของทุกกลุ่มมาตั้งแต่แรก ไม่ใช่รอตอนกางกลุ่ม — ตอนนี้การ์ดกางค้างอยู่แล้ว
       ทุกใบต้องมีรายชื่อพร้อมวาดตั้งแต่โหลดเสร็จ ไม่มีจังหวะ "กางแล้วค่อยโหลด" อีกต่อไป
       (กลุ่มมีไม่กี่กลุ่มและแต่ละคำขอเล็กมาก ต่างกับหน้าประวัติที่ข้อมูลโตไม่จำกัด) */
    void loadAll()
      .catch(() => toast.error(T.error_generic))
      .finally(() => setLoading(false));
  }, []);

  // ฝากของชุดล่าสุดไว้ทุกครั้งที่มันเปลี่ยน ไม่ใช่แค่ตอนโหลดเสร็จ
  useEffect(() => {
    if (!loading) writeSnapshot<ContactsSnap>(SNAP.contacts, { groups, contactsByGroup });
  }, [loading, groups, contactsByGroup]);

  const openCreate = () => {
    setEditing(null);
    setGroupName('');
    setRows([EMPTY_ROW]);
    setFormOpen(true);
  };

  const openEdit = (g: Group) => {
    setEditing(g);
    setGroupName(g.name);
    const cs = contactsByGroup[g.id] ?? [];
    setRows(cs.length ? cs.map((c) => ({ id: c.id, name: c.name ?? '', phone: c.phone_number })) : [EMPTY_ROW]);
    setFormOpen(true);
  };

  const moveRow = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= rows.length) return;
    const next = [...rows];
    [next[i], next[j]] = [next[j], next[i]];
    setRows(next);
  };

  /* ── บันทึกทั้งกลุ่มรวดเดียว ────────────────────────────────────────────
     backend ไม่มี endpoint ที่รับทั้งกลุ่มพร้อมสมาชิกในคำขอเดียว จึงต้องไล่สั่งเอง
     ลำดับสำคัญ: ลบก่อน → แก้ → เพิ่ม → จัดลำดับ
       ลบก่อน เพราะถ้าเพิ่มก่อนแล้วค่อยลบ ช่วงกลางจะมีเบอร์ซ้ำอยู่ในกลุ่มจริงๆ
       จัดลำดับท้ายสุด เพราะต้องรู้ id ของแถวที่เพิ่งสร้างถึงจะส่งลำดับครบได้

     ถ้าพังกลางทาง ไม่พยายามย้อนเอง — โหลดของจริงจากเซิร์ฟเวอร์มาทับแล้วบอกว่าพัง
     การเดาว่าคำสั่งไหนผ่านไปแล้วบ้างแล้วย้อนเองมีโอกาสทำให้ข้อมูลเพี้ยนกว่าเดิม */
  const submitForm = async () => {
    const name = groupName.trim();
    const valid = rows
      .map((r) => ({ ...r, name: r.name.trim(), phone: r.phone.trim() }))
      .filter((r) => r.phone && r.name);
    if (!name) return;

    setSaving(true);
    try {
      let groupId: number;
      if (editing) {
        groupId = editing.id;
        if (name !== editing.name) await updateGroup(groupId, { name });
      } else {
        const created = await createGroup({ name });
        groupId = created.id;
      }

      const before = editing ? (contactsByGroup[editing.id] ?? []) : [];
      const keptIds = new Set(valid.map((r) => r.id).filter((x): x is number => x !== undefined));

      for (const c of before) {
        if (!keptIds.has(c.id)) await deleteContact(c.id);
      }
      for (const r of valid) {
        if (r.id === undefined) continue;
        const old = before.find((c) => c.id === r.id);
        if (old && (old.phone_number !== r.phone || (old.name ?? '') !== r.name)) {
          await updateContact(r.id, { phone_number: r.phone, name: r.name });
        }
      }
      const finalIds: number[] = [];
      for (const r of valid) {
        if (r.id !== undefined) finalIds.push(r.id);
        else {
          const c = await createContact(groupId, { phone_number: r.phone, name: r.name });
          finalIds.push(c.id);
        }
      }
      if (finalIds.length > 1) await reorderContacts(groupId, finalIds);

      await loadAll();
      setFormOpen(false);
      toast.success(editing ? T.toast_updated : T.toast_created);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : T.error_generic);
      await loadAll().catch(() => undefined);
    } finally {
      setSaving(false);
    }
  };

  const confirmDeleteGroup = () => {
    if (!deleteTarget) return;
    const groupId = deleteTarget.id;
    deleteGroup(groupId)
      .then(() => {
        setGroups((gs) => gs.filter((g) => g.id !== groupId));
        setContactsByGroup((m) => {
          const { [groupId]: _drop, ...rest } = m;
          return rest;
        });
        toast.success(T.toast_deleted);
      })
      // backend ตอบ 409 ถ้ากลุ่มยังถูกอุปกรณ์ใช้อยู่ — ข้อความจาก detail อธิบายชัดแล้ว
      .catch((e) => toast.error(e instanceof ApiError ? e.message : T.error_generic))
      .finally(() => setDeleteTarget(null));
  };

  if (loading) {
    return <p className="text-caption text-ink-2">{T.loading}</p>;
  }

  /* คำค้นเดียวหาได้ทั้งสามอย่าง — ชื่อกลุ่ม ชื่อคน และเบอร์
     เพราะคนเปิดหน้านี้รู้อยู่แค่อย่างเดียวในสามอย่างนั้น แล้วอยากได้อีกสองอย่างที่เหลือ */
  const q = query.trim().toLowerCase();
  const qDigits = digitsOf(q);
  const hitsIn = (groupId: number) =>
    (contactsByGroup[groupId] ?? []).some((c) => contactMatches(c, q, qDigits));
  const visible = q
    ? groups.filter((g) => g.name.toLowerCase().includes(q) || hitsIn(g.id))
    : groups;

  const searchBox =
    groups.length > 0 ? (
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
    ) : null;

  return (
    /* flex-1 + min-h-0: ขอพื้นที่ที่เหลือจาก SetupPage มาให้รายการการ์ดเลื่อนในตัวเอง
       ไม่งั้นหน้าจะยาวลงไปเรื่อยๆ ตามจำนวนกลุ่ม — การ์ดกางค้างทุกใบ หน้าจึงยาวเร็วมาก */
    <div className="flex min-h-0 flex-1 flex-col gap-3.5">
      {embedded ? (
        <div className="flex flex-wrap items-center gap-3">
          {searchBox}
          <span className="ms-auto">
            <Btn variant="primary" onClick={openCreate}>
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
            <Btn variant="primary" onClick={openCreate}>
              <Plus size={15} />
              {T.add_group}
            </Btn>
          }
        />
      )}

      {!embedded && searchBox ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2.5">{searchBox}</div>
      ) : null}

      {groups.length === 0 ? (
        <div className="flex flex-col items-center gap-2.5 rounded-card border border-dashed border-line px-4 py-10 text-center">
          <span className="grid size-14 place-items-center rounded-card bg-surface-2">
            <Users size={26} className="text-ink-2" strokeWidth={1.5} />
          </span>
          <p className="text-lead font-semibold">{T.contacts_title}</p>
          <p className="text-caption text-ink-2">{T.contacts_sub}</p>
          <Btn variant="primary" className="mt-0.5" onClick={openCreate}>
            <Plus size={15} />
            {T.add_group}
          </Btn>
        </div>
      ) : (
        /* ── ตารางชุดเดียวกับแท็บประเภทเหตุการณ์ ──────────────────────────
           กลับมาเป็นตารางตามที่ผู้ใช้สั่ง หลังจากลองเป็นการ์ดใบละกลุ่มตามไฟล์ดีไซน์
           ส่วนที่เหลือของดีไซน์นั้นอยู่ครบ — การแก้ทั้งกลุ่มยังทำในป๊อปอัพเดียวเหมือนเดิม
           ตารางนี้มีหน้าที่เดียวคือให้กวาดตาหาแล้วเลือกกลุ่มที่จะแก้

           กางแถวได้เพื่อดูรายชื่อกับลำดับไล่โทรโดยไม่ต้องเปิดป๊อปอัพ — เป็นการ "อ่าน"
           ซึ่งเกิดบ่อยกว่าการ "แก้" มาก ไม่ควรต้องเปิดกล่องโมดัลทุกครั้งที่แค่อยากดู */
        <div className="min-h-[10rem] min-w-0 flex-1 overflow-auto overscroll-contain rounded-card border border-line bg-surface shadow-card">
          {/* ซ่อนหัวคอลัมน์บนจอแคบ — ที่นั่นแถวไหลลงบรรทัดใหม่จนป้ายไม่ตรงกับข้อมูลแล้ว */}
          {visible.length > 0 ? (
            <div className="sticky top-0 z-10 hidden flex-wrap items-center gap-x-3 border-b border-line bg-surface-2 px-3.5 py-1.5 font-mono text-body font-bold text-ink-2 sm:flex">
              <span className="min-w-0 flex-1 basis-[10rem]">{T.group_name_label}</span>
              <span className="min-w-0 flex-[0.7] basis-[6rem]">{T.ct_col_phones}</span>
              <span className="min-w-0 flex-[1.3] basis-[10rem]">{T.ct_col_members}</span>
              <span className="w-[7rem] shrink-0 text-end">{T.col_actions}</span>
            </div>
          ) : null}

          {q ? (
            <p className="border-b border-line-2 px-3.5 py-1.5 font-mono text-micro text-ink-2">
              {T.contacts_search_found(visible.length)}
            </p>
          ) : null}

          {visible.length === 0 ? (
            <p className="px-4 py-10 text-center text-caption text-ink-2">{T.contacts_search_none}</p>
          ) : null}

          {visible.map((g) => {
            const members = contactsByGroup[g.id] ?? [];
            const preview = members.slice(0, 3).map((c) => c.name?.trim() || c.phone_number);
            const rest = members.length - preview.length;
            /* ค้นเจอคนในกลุ่มไหน ให้กางกลุ่มนั้นเอง — คนค้นชื่อคนอยากเห็นคนนั้น
               ไม่ใช่แค่ชื่อกลุ่มที่เขาอยู่ คิดเป็นค่าจาก q ตรงนี้แทนที่จะไปเขียนทับ state
               เพราะถ้าเขียนทับ พอลบคำค้นออกกลุ่มจะค้างกางอยู่ทั้งที่ผู้ใช้ไม่ได้กดเอง */
            const open = expanded[g.id] || (q !== '' && hitsIn(g.id));
            return (
              <div key={g.id} className="min-w-0 border-b border-line-2 last:border-b-0">
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => setExpanded((e) => ({ ...e, [g.id]: !open }))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setExpanded((x) => ({ ...x, [g.id]: !open }));
                    }
                  }}
                  className={cn(
                    'flex w-full cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 px-3.5 py-2 transition-colors hover:bg-surface-2',
                    open && 'bg-surface-2',
                  )}
                >
                  {/* ลูกศรอยู่หน้าชื่อ ไม่ใช่ท้ายแถว — มันบอกว่า "แถวนี้กางได้" ซึ่งเป็น
                      เรื่องของตัวแถวเอง ไม่ใช่คอลัมน์ข้อมูลอีกคอลัมน์ และวางไว้หน้าชื่อ
                      ทำให้เห็นทันทีว่าแถวไหนกางอยู่โดยไม่ต้องกวาดตาไปสุดขอบขวา */}
                  <span className="flex min-w-0 flex-1 basis-[10rem] items-center gap-2">
                    <span aria-hidden className="grid size-5 shrink-0 place-items-center text-ink-2">
                      {open ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                    </span>
                    <span className="truncate text-caption font-medium">{g.name}</span>
                  </span>

                  <span className="min-w-0 flex-[0.7] basis-[6rem] truncate font-mono text-caption text-ink-2">
                    {T.phones_count(members.length)}
                  </span>

                  {/* ยังไม่มีเบอร์ = ขีดเดียว ไม่ใช่ช่องว่าง — ช่องว่างอ่านได้ว่าโหลดไม่ขึ้น */}
                  <span className="min-w-0 flex-[1.3] basis-[10rem] truncate text-caption text-ink-2">
                    {preview.length === 0 ? '—' : preview.join(', ') + (rest > 0 ? ` +${rest}` : '')}
                  </span>

                  {/* ปุ่มเป็นข้อความ ไม่ใช่ไอคอนเปล่า — สองปุ่มนี้ทำคนละเรื่องกันมาก
                      (แก้ทั้งกลุ่ม vs ลบทั้งกลุ่ม) ไอคอนดินสอ/ถังขยะที่อยู่ติดกันเคยกดพลาด
                      stopPropagation ไม่งั้นกดปุ่มแล้วแถวกางออกมาด้วย */}
                  <span className="flex w-[7rem] shrink-0 items-center justify-end gap-1">
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); openEdit(g); }}
                      className="rounded-control px-2.5 py-1 text-micro font-medium text-brand-strong transition-colors hover:bg-brand-soft"
                    >
                      {T.edit}
                    </button>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); setDeleteTarget(g); }}
                      className="rounded-control px-2.5 py-1 text-micro text-ink-2 transition-colors hover:bg-bad-soft hover:text-bad-strong"
                    >
                      {T.delete}
                    </button>
                  </span>
                </div>

                {open ? (
                  <div className="border-t border-line-2 bg-surface">
                    {members.length === 0 ? (
                      <p className="px-4 py-3.5 text-caption text-ink-2">{T.no_phones}</p>
                    ) : (
                      members.map((c, i) => (
                        /* ไม่กรองแถวทิ้งตอนค้น — เลขลำดับคือลำดับไล่โทรจริง ถ้าซ่อนบางแถว
                           เลขที่เห็นจะไม่ตรงกับที่ระบบใช้ เลยแค่ทำแถวที่ตรงให้เด่นขึ้น */
                        <div
                          key={c.id}
                          className={cn(
                            'flex items-stretch border-b border-line-2 ps-3.5 pe-4 last:border-b-0',
                            q !== '' && contactMatches(c, q, qDigits) && 'bg-brand-soft',
                          )}
                        >
                          {/* เส้นโยงแบบต้นไม้ — ขีดตั้งไล่ลงมาจากแถวกลุ่ม แล้วแตกขีดนอน
                              เข้าหาสมาชิกแต่ละคน คนสุดท้ายขีดตั้งจบครึ่งแถว (เป็นมุม └)
                              บอกว่าหมดกลุ่มแล้วโดยไม่ต้องมีเส้นคั่นหรือคำกำกับเพิ่ม

                              วางกึ่งกลางไว้ที่ 24px เท่ากับกึ่งกลางลูกศรกาง/หุบของแถวกลุ่ม
                              (ps-3.5 = 14px + ครึ่งของ w-5 = 10px) เส้นจึงลากลงมาจากลูกศร
                              ตรงๆ ไม่ใช่ลอยอยู่ข้างๆ

                              items-stretch ที่แถว + self-stretch ตรงนี้ ทำให้ขีดตั้งของแต่ละแถว
                              ยาวเต็มความสูงแถวและไปบรรจบกับของแถวถัดไปพอดี ไม่ขาดเป็นท่อนๆ */}
                          <span aria-hidden className="relative w-5 shrink-0 self-stretch">
                            <span
                              className={cn(
                                'absolute start-1/2 top-0 w-px -translate-x-1/2 bg-line',
                                i === members.length - 1 ? 'h-1/2' : 'bottom-0',
                              )}
                            />
                            <span className="absolute start-1/2 top-1/2 h-px w-2 bg-line" />
                          </span>

                          <span className="flex min-w-0 flex-1 items-center gap-3 py-2 ps-2">
                            <span className="grid size-6 shrink-0 place-items-center rounded-full bg-brand-soft font-mono text-micro font-bold text-brand-strong">
                              {i + 1}
                            </span>
                            <span className="min-w-0 flex-1 truncate text-caption font-medium">
                              {c.name?.trim() || '—'}
                            </span>
                            <span className="shrink-0 font-mono text-caption text-ink-2">{c.phone_number}</span>
                          </span>
                        </div>
                      ))
                    )}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}

      {/* ── ป๊อปอัพสร้าง/แก้กลุ่ม ───────────────────────────────────────────
          ชื่อกลุ่มกับสมาชิกอยู่ในฟอร์มเดียวกัน เพราะกลุ่มที่ไม่มีเบอร์ไม่มีประโยชน์
          และลำดับสมาชิกก็ตั้งได้ที่นี่ที่เดียว ไม่ต้องกลับไปกดลูกศรทีละแถวในการ์ด */}
      <Dialog
        open={formOpen}
        onOpenChange={(next) => {
          if (!saving) setFormOpen(next);
        }}
      >
        <DialogContent className="max-h-[85vh] max-w-[calc(100%-2rem)] overflow-y-auto sm:max-w-[min(34rem,calc(100%-2rem))]">
          <DialogHeader className="gap-3 text-start">
            <div className="flex flex-row items-center gap-3 pe-6">
              <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand-strong">
                <Users size={20} strokeWidth={1.8} />
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <DialogTitle className="text-lead font-bold">
                  {editing ? T.ct_edit_group : T.new_group}
                </DialogTitle>
                <DialogDescription className="text-micro leading-[1.6] text-ink-2">
                  {T.contacts_sub}
                </DialogDescription>
              </span>
            </div>
          </DialogHeader>

          <div className="flex flex-col gap-4">
            <div>
              <label className="mb-1.5 block text-caption text-ink-2" htmlFor="group-name">
                {T.group_name_label}
              </label>
              <input
                id="group-name"
                className={cn(inputCls, 'w-full')}
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                placeholder={T.new_group_ph}
                autoFocus
              />
            </div>

            <div>
              <p className="mb-2 text-caption text-ink-2">
                {T.ct_members} <span className="text-micro">{T.ct_order_hint}</span>
              </p>
              <div className="flex flex-col gap-2">
                {rows.map((r, i) => (
                  <div key={i} className="flex flex-wrap items-center gap-1.5">
                    <span className="w-5 shrink-0 text-center font-mono text-micro font-bold text-ink-2">
                      {i + 1}
                    </span>
                    <input
                      className={cn(inputCls, 'min-w-0 flex-1 basis-[7rem] py-2 text-caption')}
                      value={r.name}
                      onChange={(e) => setRows((rs) => rs.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                      placeholder={T.contact_name_ph}
                    />
                    <input
                      className={cn(inputCls, 'min-w-0 flex-1 basis-[7rem] py-2 font-mono text-caption')}
                      value={r.phone}
                      onChange={(e) => setRows((rs) => rs.map((x, j) => (j === i ? { ...x, phone: e.target.value } : x)))}
                      placeholder={T.phone_ph}
                    />
                    {/* ลูกศรเป็นตัวจัดลำดับไล่สาย ไม่ใช่แค่จัดหน้าให้สวย จึงไม่ซ่อนตอนกดไม่ได้
                        แค่จางลง — ที่ว่างที่หายไปจะทำให้แถวขยับทุกครั้งที่สลับตำแหน่ง */}
                    <span className="flex shrink-0 flex-col">
                      <button
                        type="button"
                        onClick={() => moveRow(i, -1)}
                        disabled={i === 0}
                        aria-label={T.move_up}
                        className="grid size-5 place-items-center text-ink-2 hover:text-ink disabled:opacity-20"
                      >
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
                          <path d="M2 8l4-4 4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </button>
                      <button
                        type="button"
                        onClick={() => moveRow(i, 1)}
                        disabled={i === rows.length - 1}
                        aria-label={T.move_down}
                        className="grid size-5 place-items-center text-ink-2 hover:text-ink disabled:opacity-20"
                      >
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
                          <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </button>
                    </span>
                    <button
                      type="button"
                      onClick={() => setRows((rs) => (rs.length === 1 ? [EMPTY_ROW] : rs.filter((_, j) => j !== i)))}
                      aria-label={T.delete}
                      title={T.delete}
                      className="grid size-8 shrink-0 place-items-center rounded-control text-ink-2 transition-colors hover:bg-bad-soft hover:text-bad-strong"
                    >
                      <X size={15} />
                    </button>
                  </div>
                ))}
              </div>
              <button
                type="button"
                onClick={() => setRows((rs) => [...rs, EMPTY_ROW])}
                className="mt-2.5 flex items-center gap-1.5 text-caption font-medium text-brand-strong"
              >
                <Plus size={14} />
                {T.ct_add_member}
              </button>
              <p className="mt-2 text-micro leading-[1.7] text-ink-2">{T.ct_member_hint}</p>
            </div>
          </div>

          <DialogFooter>
            <Btn onClick={() => setFormOpen(false)} disabled={saving}>{T.cancel}</Btn>
            <Btn variant="primary" onClick={() => void submitForm()} disabled={saving || !groupName.trim()}>
              {saving ? T.saving : T.save}
            </Btn>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── ยืนยันลบกลุ่ม ─────────────────────────────────────────────────── */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{T.delete_confirm_title}</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget
                ? `${deleteTarget.name} · ${T.phones_count(deleteTarget.contact_count)} — ${T.group_delete_confirm}`
                : T.group_delete_confirm}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{T.cancel}</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDeleteGroup}>{T.yes_delete}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
