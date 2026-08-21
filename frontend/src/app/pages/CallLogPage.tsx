/**
 * CallLogPage — ประวัติการโทร
 *
 * ── ที่ออกแบบใหม่รอบนี้ และเหตุผล ──────────────────────────────────────────
 * 1. ตัวเลือกช่วงเวลาเคยซ่อนอยู่หลัง dropdown "กำหนดเอง" — ต้องกด 2 ชั้นกว่าจะเจอช่องวันที่
 *    (เปิด dropdown ก่อน แล้วค่อยเจอช่อง) ตอนนี้ปุ่มลัดทุกอันโผล่ตลอด ส่วนช่องวันที่อยู่
 *    หลังชิป "ระบุเอง" ที่ต่อท้ายปุ่มลัดในแถวเดียวกัน = กดครั้งเดียวถึง และอยู่ที่เดิมเสมอ
 *    เหตุที่ไม่กางค้างไว้: มันถูกใช้จริงน้อยมากเทียบกับปุ่มลัด แต่กินความสูงถาวรหนึ่งแถว
 *    และหน้าตาเป็นช่องกรอกดิบๆ ที่อ่านแล้วไม่รู้ว่าตกลงกำลังดูช่วงไหน
 *    ตอนตั้งช่วงเองไว้ ชิปจะเขียนช่วงนั้นบนตัวมันเอง ปิดแถวไปก็ยังเห็นว่าตั้งอะไรค้างไว้
 *    และเพิ่มช่อง "เลือกทั้งเดือน" (<input type="month">) เพราะการดูย้อนหลังส่วนใหญ่
 *    คิดเป็นเดือน ไม่ใช่ช่วงวันที่คร่อมเดือน — เลือกทีเดียวได้ทั้งเดือนโดยไม่ต้องกด 2 ช่อง
 *
 * 2. เดิมทุกแถวโชว์วันที่-เวลาเต็มซ้ำกันทุกบรรทัด กินความกว้างและอ่านยากเวลามีหลายสิบแถว
 *    เปลี่ยนเป็นจัดกลุ่มตามวัน มีหัววันคั่น (พร้อมจำนวนสายของวันนั้น) แถวเหลือแค่เวลา
 *    การกวาดตาหาว่า "วันนั้นเกิดอะไรบ้าง" จึงทำได้โดยไม่ต้องอ่านวันที่ซ้ำทุกบรรทัด
 *
 * 3. สถานะเคยเป็นข้อความดิบภาษาอังกฤษ (connected/failed) ไม่ตรงกับหน้าอื่นที่ใช้ badge
 *    เปลี่ยนมาใช้ StatusBadge ตัวเดียวกับทั้งระบบ — สีและคำแปลมาจากที่เดียว
 *
 * 4. เดิมตารางกว้างเกินจอมือถือแล้วต้องเลื่อนแนวนอน เปลี่ยนเป็นแถวแบบ flex-wrap
 *    จอแคบข้อมูลจะไหลลงบรรทัดถัดไปเองแทนที่จะหลุดออกนอกจอ
 *
 * 5. หน้าเดิมยาวเกินจอเสมอ ต้องเลื่อนลงไปดูแถวท้ายๆ แล้วเลื่อนกลับขึ้นมากดเปลี่ยนหน้า
 *    ตอนนี้ทั้งหน้าจบในจอเดียว: แถบตัวกรองยุบเหลือแถบเดียว และจำนวนแถวต่อหน้า
 *    ไม่ได้ตรึงไว้ที่ 20 แต่วัดจากความสูงของกล่องจริง (ดูหัวข้อ "จำนวนแถวต่อหน้า" ข้างล่าง)
 *
 * ── ต่างจากดีไซน์เดิมของ figma ────────────────────────────────────────────
 * - ชิป "งดตามเวลา"/"ส่ง SMS แทน" ไม่มี เพราะ backend ไม่มีสถานะพวกนั้น (ดู LIMITATIONS.md)
 * - คอลัมน์ "ค่าที่อ่านได้" เปลี่ยนเป็นชื่อเหตุการณ์ — อุปกรณ์ส่งมาแค่ event_type_code
 */
import { useEffect, useMemo, useRef, useState } from 'react';

import {
  CalendarClock,
  CalendarDays,
  CalendarRange,
  Check,
  ChevronDown,
  History,
  LayoutGrid,
  Phone,
  PhoneCall,
  PhoneMissed,
  Sun,
  X,
  type LucideIcon,
} from 'lucide-react';

import { cn } from '@/app/components/ui/utils';
import { getHistory } from '../api/history';
import { PageHeader } from '../components/primitives';
import { StatusBadge } from '../components/StatusBadge';
import { useApp } from '../context/AppContext';
import type { CallStatus, HistoryItem, Lang } from '../types';

/**
 * ขีดสีที่ขอบซ้ายของแถว — ไว้กวาดตาหา "สายที่ไม่เรียบร้อย" โดยไม่ต้องอ่านทีละแถว
 *
 * ป้ายสถานะอยู่สุดขอบขวาซึ่งอ่านได้แม่นแต่ช้า: ต้องกวาดสายตาข้ามทั้งแถวทุกบรรทัด
 * ขีดสีอยู่ตรงที่สายตาเริ่มอ่านพอดี จึงเห็นทันทีว่าหน้านี้มีปัญหากี่จุดก่อนจะอ่านอะไรเลย
 *
 * แถวที่โทรติดได้ขีดใส (ไม่ใช่ไม่มีขีด) เพื่อให้ข้อความทุกแถวยังเริ่มตรงแนวเดียวกัน
 */
function railClass(status: CallStatus): string {
  if (status === 'failed') return 'border-s-bad';
  if (status === 'no_answer' || status === 'busy' || status === 'escalated' || status === 'retrying')
    return 'border-s-warn';
  return 'border-s-transparent';
}

/** ชิปกรอง → ค่า status ที่ /history รับ (undefined = ไม่กรอง) */
const FILTERS = [
  { id: 'all', status: undefined },
  { id: 'ok', status: 'connected' },
  { id: 'no_answer', status: 'no_answer' },
  { id: 'failed', status: 'failed' },
] as const;

type FilterId = (typeof FILTERS)[number]['id'];

/* ── วันที่: ทำงานบนสตริง "YYYY-MM-DD" ตลอด ─────────────────────────────────
   ใช้รูปแบบเดียวกับที่ <input type="date"> รับ/คืน จึงไม่ต้องแปลงไปกลับ
   และไม่มีจังหวะที่ Date object ถูกตีความเป็น UTC จนวันเพี้ยนไปหนึ่งวัน */

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return ymd(d);
}

/**
 * "YYYY-MM-DD" ที่ผู้ใช้เลือก → ISO UTC ที่ backend ต้องการ
 *
 * created_at ฝั่ง backend เก็บเป็น UTC แต่ผู้ใช้คิดเป็นเวลาไทย — เลือก "9 ส.ค."
 * ต้องได้ทั้งวันตามเวลาไทย ไม่ใช่ 07:00 ของวันนั้นถึง 07:00 ของวันถัดไป
 * `new Date('2026-08-09T00:00:00')` (ไม่มี Z) ถูกตีความเป็นเวลาท้องถิ่นตามสเปก
 * .toISOString() จึงถอยกลับ 7 ชั่วโมงให้เองอัตโนมัติ ไม่ต้องบวกลบเอง
 */
const startOfDayUtc = (day: string) => new Date(`${day}T00:00:00`).toISOString();
const endOfDayUtc = (day: string) => new Date(`${day}T23:59:59.999`).toISOString();

const locale = (lang: Lang) => (lang === 'th' ? 'th-TH' : 'en-GB');

/** "15 สิงหาคม 2569" — th-TH ให้ปี พ.ศ. มาเองโดยไม่ต้องบวก 543 */
function fmtDay(day: string, lang: Lang, withWeekday = false): string {
  const d = new Date(`${day}T00:00:00`);
  return d.toLocaleDateString(locale(lang), {
    weekday: withWeekday ? 'long' : undefined,
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

/** ย่อช่วงวันที่ให้อ่านง่าย — เดือน/ปีเดียวกันไม่ต้องเขียนซ้ำสองรอบ */
function fmtRange(from: string, to: string, lang: Lang, allLabel: string): string {
  if (!from && !to) return allLabel;
  if (from && to && from === to) return fmtDay(from, lang, true);
  if (!to) return `${fmtDay(from, lang)} –`;
  if (!from) return `– ${fmtDay(to, lang)}`;
  const a = new Date(`${from}T00:00:00`);
  const b = new Date(`${to}T00:00:00`);
  if (a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth()) {
    return `${a.getDate()} – ${fmtDay(to, lang)}`;
  }
  return `${fmtDay(from, lang)} – ${fmtDay(to, lang)}`;
}

const ctlCls =
  'rounded-control border border-line bg-surface px-2 py-1 font-mono text-micro text-ink transition-colors ' +
  'hover:border-brand-strong focus:border-brand-strong focus:outline-none [color-scheme:light] dark:[color-scheme:dark]';

/** หัวกลุ่มตัวกรอง = ไอคอนในวงกลม + ชื่อกลุ่ม บอกว่าชิปที่ตามมาเป็นพวกใคร */
function GroupLabel({ icon: Icon, children }: { icon: LucideIcon; children: React.ReactNode }) {
  return (
    <span className="flex shrink-0 items-center gap-1.5 pe-0.5 text-[0.6875rem] font-medium text-ink-2">
      <span className="grid size-5 shrink-0 place-items-center rounded-full bg-surface-2">
        <Icon size="1em" />
      </span>
      {children}
    </span>
  );
}

/**
 * ชิปกรอง 1 ตัว
 *
 * tone = สีตามความหมายของตัวเลือกนั้น (สำเร็จเขียว / ไม่รับสายส้ม / ล้มเหลวแดง)
 * ตอนยังไม่ถูกเลือกจะเป็นสีอ่อนๆ ของโทนตัวเอง ตอนถูกเลือกถึงลงสีเต็ม — ไม่ใช่ฟ้าเหมือนกันหมด
 * เพราะสีของชิปกับสีของป้ายสถานะในตารางข้างล่างเป็นชุดเดียวกัน กดสีเขียวแล้วได้แถวป้ายเขียว
 * สายตาจึงโยงถูกโดยไม่ต้องอ่าน
 *
 * ติ๊กถูกท้ายชิปที่เลือกอยู่ มีไว้เผื่อคนที่แยกสีไม่ออก — สถานะ "เลือกอยู่" จะได้ไม่ได้
 * บอกด้วยสีอย่างเดียว
 */
type ChipTone = 'brand' | 'ok' | 'warn' | 'bad';

const CHIP_ON: Record<ChipTone, string> = {
  brand: 'border-brand bg-brand text-brand-ink',
  ok: 'border-ok-strong bg-ok-strong text-status-ink',
  warn: 'border-warn-strong bg-warn-strong text-status-ink',
  bad: 'border-bad-strong bg-bad-strong text-status-ink',
};

const CHIP_OFF: Record<ChipTone, string> = {
  brand: 'border-line bg-surface text-ink-2 hover:border-brand-strong hover:text-ink',
  ok: 'border-ok bg-ok-soft text-ok-strong hover:border-ok-strong',
  warn: 'border-warn bg-warn-soft text-warn-strong hover:border-warn-strong',
  bad: 'border-bad bg-bad-soft text-bad-strong hover:border-bad-strong',
};

function Chip({
  on,
  onClick,
  icon: Icon,
  tone = 'brand',
  children,
}: {
  on: boolean;
  onClick: () => void;
  icon?: LucideIcon;
  tone?: ChipTone;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        'flex shrink-0 items-center gap-1 rounded-full border px-2 py-1 text-[0.6875rem] whitespace-nowrap transition-colors',
        on ? `font-semibold ${CHIP_ON[tone]}` : `font-medium ${CHIP_OFF[tone]}`,
      )}
    >
      {Icon ? <Icon size="1.1em" className="shrink-0 opacity-90" /> : null}
      {children}
      {on ? <Check size="1em" className="shrink-0" strokeWidth={3} /> : null}
    </button>
  );
}

/** เส้นคั่นแนวตั้งระหว่างกลุ่มตัวกรอง — ตอนนี้ตัวกรองทุกตัวอยู่ในแถบเดียวกัน
 *  ถ้าไม่มีเส้นคั่นจะอ่านไม่ออกว่าชิปตัวไหนเป็นช่วงเวลา ตัวไหนเป็นผลการโทร
 *  ซ่อนบนจอแคบเพราะที่นั่นแต่ละกลุ่มขึ้นบรรทัดของตัวเองอยู่แล้ว */
function VDiv() {
  return <span className="hidden h-5 w-px shrink-0 bg-line-2 sm:block" aria-hidden="true" />;
}

/* ── จำนวนแถวต่อหน้า: ปรับเองจนเต็มกล่องพอดี ──────────────────────────────
   หน้านี้ต้องจบในจอเดียว จึงไม่ตรึง page_size ไว้ที่ 20 แล้วปล่อยให้หน้ายาวลงไป
   — จอสูงก็ได้หลายแถว จอเตี้ยก็ได้น้อยแถว ส่วนที่เหลือไล่ดูด้วยปุ่ม ‹ ›

   วิธีแรกที่ลองคือคำนวณจากค่าคงที่ (ความสูงแถว/หัววัน/หัวคอลัมน์) แล้วหารเอา
   ซึ่งพลาด: ได้ 9 แถวในกล่องที่ใส่ได้ 13 เพราะค่าคงที่ไม่มีทางตรงกับของจริง
   ทั้งฟอนต์ที่โหลดทีหลัง หัววันที่มีกี่อันก็ไม่รู้ล่วงหน้า และ padding ที่แก้ทีหลัง
   แล้วลืมมาแก้ตัวเลขตรงนี้

   จึงเปลี่ยนเป็นดูของจริง: เทียบ scrollHeight กับ clientHeight ของกล่อง
   เหลือที่ว่างพอใส่อีกแถวก็ขอเพิ่ม ล้นก็ขอลด ทำซ้ำจนนิ่ง (ปกติ 1–2 รอบ)
   ไม่ต้องรู้ความสูงของอะไรเลย และแก้ CSS ทีหลังก็ยังถูกอยู่ */

const MIN_ROWS = 5;
/** ขอรอบแรกเท่านี้ก่อนแล้วค่อยปรับ — ใกล้เคียงจอโน้ตบุ๊กทั่วไป จะได้ไม่ต้องปรับหลายรอบ */
const FALLBACK_ROWS = 12;
export function CallLogPage() {
  const { T, lang } = useApp();
  const [filter, setFilter] = useState<FilterId>('all');
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<HistoryItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  // ค่าว่าง = ไม่จำกัดช่วงเวลา (ดูทั้งหมด)
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  /** แถวช่องวันที่กางอยู่หรือเปล่า — เริ่มปิดเสมอ เพราะช่วงเริ่มต้นคือ "ทุกช่วงเวลา"
   *  ซึ่งตั้งจากปุ่มลัดอยู่แล้ว ไม่มีทางที่เปิดหน้ามาแล้วมีช่วงที่ตั้งเองค้างอยู่ */
  const [customOpen, setCustomOpen] = useState(false);

  const listRef = useRef<HTMLDivElement>(null);
  const [perPage, setPerPage] = useState(FALLBACK_ROWS);
  const headRef = useRef<HTMLDivElement>(null);
  const dayRef = useRef<HTMLDivElement>(null);
  const [fitTick, setFitTick] = useState(0);
  /** fitTick ที่คำนวณจำนวนแถวไปแล้ว — กันไม่ให้คำนวณซ้ำตอน rows เปลี่ยน (ดูหมายเหตุที่ effect) */
  const measuredTick = useRef(-1);

  const today = ymd(new Date());

  /** กล่องเปลี่ยนขนาด (ย่อ/ขยายหน้าต่าง, หมุนแท็บเล็ต, แถบตัวกรองขึ้นบรรทัดใหม่)
   *  = จำนวนแถวที่ใส่ได้เปลี่ยน ต้องเปิดให้ปรับใหม่อีกรอบ */
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const recheck = () => setFitTick((t) => t + 1);
    const ro = new ResizeObserver(recheck);
    ro.observe(el);

    /* เช็คซ้ำหลังทุกอย่างนิ่ง — ไม่ใช่ทุกอย่างที่ทำให้กล่องโตขึ้นจะยิง ResizeObserver
       ทันเสมอ (ฟอนต์เว็บโหลดเสร็จทีหลัง, แถบเลื่อนหาย, ความสูงจอที่ 100dvh เพิ่งได้ค่าจริง)
       ถ้าพลาดจังหวะนั้นไป หน้าจะค้างอยู่กับจำนวนแถวที่คำนวณจากกล่องตอนยังไม่เต็มความสูง
       แล้วเหลือที่ว่างท้ายตารางค้างไว้ตลอด โดยไม่มีอะไรมากระตุ้นให้คำนวณใหม่อีก

       เช็คสองจังหวะ: 600ms พอสำหรับเครื่องเร็ว ส่วน 1800ms เผื่อ Pi ที่โหลดฟอนต์ช้ากว่า
       (รอบที่ไม่มีอะไรเปลี่ยนก็แค่คำนวณแล้วจบ ไม่ได้ render ใหม่) */
    const t1 = setTimeout(recheck, 600);
    const t2 = setTimeout(recheck, 1800);
    return () => {
      ro.disconnect();
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, []);

  /**
   * คำนวณจำนวนแถวต่อหน้าจากขนาดที่วัดได้จริง
   *
   * เวอร์ชันแรกใช้วิธี "ดูว่าล้นหรือเหลือ แล้วขยับทีละขั้นจนนิ่ง" ซึ่งพังเงียบ:
   * ตอนเปิดหน้าใหม่ๆ ขนาดกล่องยังเปลี่ยนอยู่ (ฟอนต์ยังโหลดไม่เสร็จ) การขยับสองสามรอบแรก
   * จึงเป็นการไล่ตามขนาดที่ยังไม่นิ่ง พอถึงตอนขนาดนิ่งจริงก็ติดเงื่อนไขกันวนไม่จบไปแล้ว
   * ค้างที่ 7 แถวในกล่องที่ใส่ได้ 13 โดยไม่มีอะไรฟ้อง
   *
   * เวอร์ชันถัดมาวัดความสูงของ "แถวหนึ่งแถว" แล้วหารครั้งเดียวจบ ซึ่งใช้ได้ตอนที่ทุกแถว
   * สูงเท่ากัน — แต่ตอนนี้แถวที่มีบรรทัดรายละเอียด (เช่น "ไม่มีผู้รับสายภายใน 60 วินาที")
   * สูงกว่าแถวธรรมดาอยู่ราวครึ่งแถว ความสูงจึงไม่เท่ากันอีกต่อไป
   *
   * เวอร์ชันถัดมาหารด้วย "ความสูงเฉลี่ยของแถวที่วาดอยู่จริง" ซึ่งพังหนักกว่าเดิม:
   * ค่าเฉลี่ยขึ้นกับว่าหน้านั้นมีแถวที่มีบรรทัดหมายเหตุกี่แถว = ทุกหน้าได้ค่าไม่เท่ากัน
   * ผลคือวนไม่จบ — หน้าที่หมายเหตุเยอะ เฉลี่ยสูง จึงขอแถวน้อยลง พอโหลดชุดใหม่มา
   * หมายเหตุน้อยลง เฉลี่ยต่ำ ก็ขอแถวเพิ่ม สลับไปมาไม่หยุด แต่ละรอบยิง API ใหม่
   * (อาการที่เห็น: เปิดหน้า 7 แล้วกระพริบจนอ่านข้อมูลไม่ได้)
   *
   * ตอนนี้แก้สองชั้นให้วนไม่ได้ในเชิงโครงสร้าง ไม่ใช่แค่ "หวังว่าจะนิ่ง":
   *   1. วัดจาก "แถวที่ไม่มีบรรทัดหมายเหตุ" เท่านั้น ซึ่งสูงเท่ากันทุกแถวทุกหน้า
   *      ค่าที่ได้จึงไม่ขึ้นกับว่าหน้านั้นมีข้อมูลแบบไหน
   *   2. วัดครั้งเดียวต่อ "หนึ่งขนาดกล่อง" (จำ fitTick ที่วัดไปแล้ว) หลังจากนั้น
   *      ต่อให้ rows เปลี่ยนกี่รอบก็ไม่คำนวณใหม่ — ตัดวงจรป้อนกลับทิ้งทั้งเส้น
   *      จะวัดใหม่อีกทีก็ต่อเมื่อขนาดกล่องเปลี่ยนจริง (ย่อ/ขยายหน้าต่าง)
   *
   * แลกมาด้วยการที่หน้าซึ่งมีหมายเหตุเยอะจะล้นกล่องนิดหน่อยแล้วเลื่อนได้ — ซึ่งดีกว่า
   * หน้ากระพริบจนใช้งานไม่ได้อย่างเทียบกันไม่ติด
   */
  useEffect(() => {
    // วัดไปแล้วสำหรับขนาดกล่องนี้ — ห้ามคำนวณซ้ำเพราะ rows เปลี่ยน
    if (measuredTick.current === fitTick) return;

    const el = listRef.current;
    if (!el || el.clientHeight <= 0) return;

    const wrappers = Array.from(el.querySelectorAll<HTMLElement>('[data-log-row]'));
    if (wrappers.length === 0) return; // ยังไม่มีแถวให้วัด รอรอบหน้า (ยังไม่ล็อก tick)

    // แถวธรรมดามาก่อน ถ้าหน้านี้มีแต่แถวที่มีหมายเหตุ ค่อยใช้แถวที่เตี้ยที่สุดแทน
    const plain = wrappers.filter((w) => w.dataset.logRow === 'plain');
    const pool = plain.length > 0 ? plain : wrappers;
    const rowH = Math.min(...pool.map((w) => w.offsetHeight));
    if (!Number.isFinite(rowH) || rowH <= 0) return;

    measuredTick.current = fitTick;

    const headH = headRef.current?.offsetHeight ?? 0;
    const dayH = dayRef.current?.offsetHeight ?? 0;
    // เผื่อหัววันไว้ 2 อัน — หน้าหนึ่งมักคร่อม 1–2 วัน เผื่อมากกว่านี้จะเสียแถวฟรี
    const usable = el.clientHeight - headH - dayH * 2;
    const next = Math.max(MIN_ROWS, Math.floor(usable / rowH));
    setPerPage((cur) => (next === cur ? cur : next));
  }, [rows, fitTick]);

  // poll ทุก 5 วิ — หน้านี้คนเปิดค้างไว้ดู ถ้าดึงครั้งเดียวจะไม่เห็นสายที่เพิ่งเกิด
  useEffect(() => {
    let cancelled = false;
    const status = FILTERS.find((f) => f.id === filter)?.status;
    const load = () => {
      setLoading(true);
      getHistory({
        page,
        page_size: perPage,
        status,
        date_from: dateFrom ? startOfDayUtc(dateFrom) : undefined,
        date_to: dateTo ? endOfDayUtc(dateTo) : undefined,
      })
        .then((res) => {
          if (cancelled) return;
          setRows(res.items);
          setTotal(res.total_count);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    };
    load();
    const id = setInterval(load, 5000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [filter, page, perPage, dateFrom, dateTo]);

  const lastPage = Math.max(1, Math.ceil(total / perPage));

  /** ย่อหน้าต่างให้เตี้ยลง = แถวต่อหน้าน้อยลง = จำนวนหน้ามากขึ้น ไม่มีปัญหา
   *  แต่ขยายให้สูงขึ้น จำนวนหน้าลดลง อาจค้างอยู่หน้าที่ไม่มีอยู่แล้วและเห็นจอว่างเปล่า */
  useEffect(() => {
    if (page > lastPage) setPage(lastPage);
  }, [page, lastPage]);

  /** เปลี่ยนตัวกรองใดๆ ต้องกลับหน้า 1 ไม่งั้นอาจค้างที่หน้าที่ไม่มีข้อมูลแล้ว */
  const setRange = (from: string, to: string) => {
    setDateFrom(from);
    setDateTo(to);
    setPage(1);
  };
  const pick = (id: FilterId) => {
    setFilter(id);
    setPage(1);
  };

  /** เลือกทั้งเดือนจาก <input type="month"> ("YYYY-MM") → วันแรกถึงวันสุดท้ายของเดือนนั้น */
  const pickMonth = (m: string) => {
    if (!m) return setRange('', '');
    const [y, mo] = m.split('-').map(Number);
    setRange(`${m}-01`, ymd(new Date(y, mo, 0)));
  };

  const monthValue =
    dateFrom && dateTo && dateFrom.slice(8) === '01' && dateFrom.slice(0, 7) === dateTo.slice(0, 7)
      ? dateFrom.slice(0, 7)
      : '';

  const startOfMonth = `${today.slice(0, 7)}-01`;
  const presets = [
    { id: 'all', label: T.log_date_all, from: '', to: '', icon: History },
    { id: 'today', label: T.log_date_today, from: today, to: today, icon: Sun },
    { id: 'yst', label: T.log_date_yesterday, from: daysAgo(1), to: daysAgo(1), icon: CalendarClock },
    { id: '7d', label: T.log_date_7d, from: daysAgo(6), to: today, icon: CalendarDays },
    { id: '30d', label: T.log_date_30d, from: daysAgo(29), to: today, icon: CalendarDays },
    { id: 'month', label: T.log_date_this_month, from: startOfMonth, to: today, icon: CalendarRange },
  ];

  /** ช่วงที่ตั้งอยู่ตอนนี้ไม่ตรงกับปุ่มลัดอันไหนเลย = ผู้ใช้ระบุวันเอง
   *  ใช้ตัดสินว่าชิป "ระบุเอง" ต้องติดไฟและเขียนช่วงนั้นบนตัวมันเองหรือเปล่า
   *  ไม่งั้นพอปิดแถวช่องวันที่ไป จะไม่มีอะไรบอกเลยว่ากำลังกรองช่วงไหนอยู่ */
  const isCustomRange = !presets.some((p) => p.from === dateFrom && p.to === dateTo);

  /** จัดกลุ่มแถวตาม "วัน" ตามเวลาเครื่องผู้ใช้ — rows เรียงใหม่→เก่ามาแล้วจากฝั่ง backend */
  const groups = useMemo(() => {
    const out: { day: string; items: HistoryItem[] }[] = [];
    for (const r of rows) {
      const day = ymd(new Date(r.created_at));
      const last = out[out.length - 1];
      if (last && last.day === day) last.items.push(r);
      else out.push({ day, items: [r] });
    }
    return out;
  }, [rows]);

  const from = total === 0 ? 0 : (page - 1) * perPage + 1;
  const to = Math.min(page * perPage, total);

  return (
    /* h-full + min-h-0 = หน้านี้สูงเท่าจอพอดี ไม่เลื่อนหน้าเว็บ
       แถบตัวกรองกับแถบเลขหน้าเป็น shrink-0 ตรึงหัวท้ายไว้ ที่เหลือเป็นของกล่องรายการ */
    <div className="flex h-full min-h-0 flex-col gap-3">
      {/* ช่วงเวลาที่กำลังดูอยู่ไปรวมกับจำนวนรายการบนหัวหน้า ไม่ได้ลอยอยู่ท้ายแถวช่องวันที่
          แบบเดิม — มันเป็น "สรุปว่ากำลังดูอะไรอยู่" ซึ่งเป็นเรื่องเดียวกับจำนวนรายการ
          ไม่ใช่ส่วนหนึ่งของช่องกรอก และตอนดูทั้งหมดก็ไม่ต้องเขียนซ้ำ เพราะชิปที่เลือกอยู่บอกแล้ว */}
      <PageHeader
        title={T.history_title}
        meta={
          dateFrom || dateTo
            ? `${T.history_records(total)} · ${fmtRange(dateFrom, dateTo, lang, T.log_date_all)}`
            : T.history_records(total)
        }
      />

      {/* ── ตัวกรอง: หนึ่งแถว หนึ่งกลุ่ม ───────────────────────────────────
          เดิมซ้อนกัน 4 ชั้นแล้วขีดคั่น ต่อด้วยกลุ่มผลการโทรอีกชุด รวมแล้วสูงเกิน 200px
          ซึ่งบนจอโน้ตบุ๊กคือเกือบหนึ่งในสามของจอ ทั้งที่เป็นของที่ตั้งครั้งเดียว
          แล้วแทบไม่ได้แตะอีก — พื้นที่ตรงนี้ควรเป็นของตารางมากกว่า

          รอบแรกที่ย่อ ยุบทุกอย่างเป็นแถวเดียวรวดแล้วปล่อยให้ไหลขึ้นบรรทัดใหม่เอง
          ซึ่งเตี้ยจริงแต่ดูรก: ชิป "ทั้งหมด" ของผลการโทรไปค้างท้ายบรรทัดบน ที่เหลือ
          ตกลงบรรทัดล่าง กลายเป็นกลุ่มเดียวแต่อยู่คนละแถว มองไม่ออกว่าอันไหนพวกใคร

          ตอนนี้กำหนดเป็นแถวตายตัวแถวละกลุ่ม ป้ายกลุ่มกว้างเท่ากันหมดชิปจึงเริ่มตรงแนวเดียวกัน
          ไม่มีกลุ่มไหนถูกหั่นกลางคันไม่ว่าจอกว้างแค่ไหน และยังเตี้ยกว่าของเดิมเกือบครึ่ง */}
      <div className="flex shrink-0 flex-col gap-2 rounded-card border border-line bg-surface px-3 py-2.5">
        {/* ปุ่มลัด — ครอบคลุมการใช้งานเกือบทั้งหมด จึงอยู่แถวบนสุด
            "ระบุเอง" เป็นชิปตัวสุดท้ายในแถวเดียวกัน ไม่ใช่แถวช่องวันที่ที่กางค้างไว้ตลอด:
            ช่องวันที่ถูกใช้จริงน้อยมากเมื่อเทียบกับปุ่มลัด แต่กินความสูงถาวรไปหนึ่งแถว
            และหน้าตาเป็นช่องกรอกดิบๆ ที่อ่านแล้วไม่รู้ว่ากำลังดูช่วงไหนอยู่

            ที่ไม่กลับไปใช้ dropdown แบบรุ่นแรก เพราะอันนั้นต้องกด 2 ชั้นกว่าจะถึงช่องวันที่
            (เปิด dropdown → ค่อยเจอช่อง) อันนี้กดชิปเดียวแล้วช่องโผล่ทันทีในที่เดิมเสมอ
            และตอนตั้งช่วงเองไว้ ชิปจะเขียนช่วงนั้นบนตัวมันเอง ปิดแถวไปก็ยังเห็นว่าตั้งอะไรไว้ */}
        {/* ── ทุกตัวกรองอยู่แถวเดียวกัน ──
            แต่ละกลุ่มเป็นก้อนของตัวเอง (div ซ้อนอีกชั้น) ไม่ใช่ชิปสิบกว่าตัวไหลรวมกันรวด
            — นั่นคือสิ่งที่รอบก่อนทำแล้วพัง: ชิป "ทั้งหมด" ของผลการโทรไปค้างท้ายบรรทัดบน
            ที่เหลือตกลงบรรทัดล่าง กลายเป็นกลุ่มเดียวแต่อยู่คนละแถว มองไม่ออกว่าอันไหนพวกใคร
            พอห่อเป็นก้อน จอแคบลงก็ตกทั้งก้อนพร้อมหัวกลุ่มของมัน ไม่มีทางถูกหั่นกลางกลุ่ม */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <GroupLabel icon={CalendarDays}>{T.log_group_range}</GroupLabel>
            {presets.map((p) => (
              <Chip
                key={p.id}
                icon={p.icon}
                on={dateFrom === p.from && dateTo === p.to}
                onClick={() => setRange(p.from, p.to)}
              >
                {p.label}
              </Chip>
            ))}
            <Chip icon={CalendarRange} on={customOpen || isCustomRange} onClick={() => setCustomOpen((v) => !v)}>
              {isCustomRange ? fmtRange(dateFrom, dateTo, lang, T.log_date_all) : T.log_group_custom}
              {/* ลูกศรแทนติ๊กถูก เพราะชิปนี้ไม่ได้แปลว่า "เลือกแล้ว" แต่แปลว่า "กางอยู่" */}
              <ChevronDown size="1em" className={cn('shrink-0 transition-transform', customOpen && 'rotate-180')} />
            </Chip>
          </div>

          <VDiv />

          <div className="flex flex-wrap items-center gap-1.5">
            <GroupLabel icon={Phone}>{T.log_group_status}</GroupLabel>
            {(
              [
                { id: 'all', label: T.log_filter_all, icon: LayoutGrid, tone: 'brand' },
                { id: 'ok', label: T.log_filter_ok, icon: PhoneCall, tone: 'ok' },
                { id: 'no_answer', label: T.log_filter_no_answer, icon: PhoneMissed, tone: 'warn' },
                { id: 'failed', label: T.log_filter_failed, icon: X, tone: 'bad' },
              ] as const
            ).map((f) => (
              <Chip key={f.id} icon={f.icon} tone={f.tone} on={filter === f.id} onClick={() => pick(f.id)}>
                {f.label}
              </Chip>
            ))}
          </div>
        </div>

        {customOpen ? (
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-2">
            <GroupLabel icon={CalendarRange}>{T.log_group_custom}</GroupLabel>
            <label className="flex items-center gap-1.5">
              <span className="text-micro whitespace-nowrap text-ink-2">{T.log_date_from}</span>
              <input
                type="date"
                lang={lang === 'th' ? 'th-TH' : 'en-GB'}
                value={dateFrom}
                max={dateTo || today}
                onChange={(e) => setRange(e.target.value, dateTo)}
                className={ctlCls}
              />
            </label>
            <label className="flex items-center gap-1.5">
              <span className="text-micro whitespace-nowrap text-ink-2">{T.log_date_to}</span>
              <input
                type="date"
                lang={lang === 'th' ? 'th-TH' : 'en-GB'}
                value={dateTo}
                min={dateFrom || undefined}
                max={today}
                onChange={(e) => setRange(dateFrom, e.target.value)}
                className={ctlCls}
              />
            </label>

            <VDiv />

            {/* เลือกทั้งเดือนทีเดียว — การดูย้อนหลังส่วนใหญ่คิดเป็นเดือน ไม่ใช่ช่วงวัน */}
            <label className="flex items-center gap-1.5">
              <span className="text-micro whitespace-nowrap text-ink-2">{T.log_pick_month}</span>
              <input
                type="month"
                lang={lang === 'th' ? 'th-TH' : 'en-GB'}
                value={monthValue}
                max={today.slice(0, 7)}
                onChange={(e) => pickMonth(e.target.value)}
                className={ctlCls}
              />
            </label>

            {dateFrom || dateTo ? (
              <button
                type="button"
                onClick={() => setRange('', '')}
                className="ms-auto text-micro font-medium text-brand-strong"
              >
                {T.log_clear_range}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* ── รายการทั้งหมดอยู่ในกล่องเดียว ────────────────────────────────────
          หัวคอลัมน์ หัววัน และแถวข้อมูล อยู่ในกรอบเดียวกัน แยกกันด้วยเส้นคั่น
          เดิมแยกเป็นกล่องย่อยต่อวัน ทำให้หน้ายาวๆ ดูเป็นแผ่นๆ ไม่ต่อเนื่อง

          กล่องนี้กินพื้นที่ที่เหลือทั้งหมด (flex-1) และเป็นตัวเดียวในหน้าที่เลื่อนได้
          ปกติไม่ต้องเลื่อนเพราะขอแถวมาเท่าที่ใส่พอดีอยู่แล้ว — overflow มีไว้กันเหนียว
          ตอนกางรายละเอียดแถว หรือตอนหัววันในหน้านั้นมีมากกว่าที่เผื่อไว้

          ความกว้างของคอลัมน์ขวา (เบอร์/สถานะ/ลูกศร) ถูกตรึงเป็นตัวเลขตายตัว
          และ "จองที่ลูกศรไว้เสมอ" แม้แถวนั้นจะไม่มีรายละเอียดให้กาง — ไม่งั้น
          แถวที่มีลูกศรจะดัน badge เบียดซ้ายไปหนึ่งช่อง แล้วสำเร็จ/ล้มเหลว
          ของแต่ละแถวจะไม่ตรงกันเป็นแนวเดียว */}
      <div
        ref={listRef}
        className="min-h-[10rem] min-w-0 flex-1 overflow-auto overscroll-contain rounded-card border border-line bg-surface shadow-card"
      >
        {/* ซ่อนหัวคอลัมน์บนจอแคบ — ที่นั่นแถวไหลลงบรรทัดใหม่จนป้ายไม่ตรงกับข้อมูลแล้ว */}
        <div
          ref={headRef}
          /* ── ลำดับขนาดตัวอักษรของหน้านี้ (ค่าที่จอ 14" — จอใหญ่โตตามสัดส่วนทั้งชุด) ──
               แถวข้อมูล        0.78rem   12.5px   อ่านซ้ำทุกแถว จึงใหญ่สุด
               หัวคอลัมน์       text-micro 12px    อ่านครั้งเดียวตอนหาว่าคอลัมน์ไหนคืออะไร
               ชิปตัวกรอง       0.6875rem 11px
               บรรทัดหมายเหตุ ↳ 0.625rem  10px     มีเฉพาะบางแถว เป็นของเสริมของแถวเหนือมัน
             เขียนรวมไว้ที่เดียวเพราะสี่ค่านี้ต้องดูเป็นชุดเดียวกัน ถ้าไปแก้ทีละจุดโดยไม่เห็น
             ตัวอื่น จะได้ลำดับที่ขัดกันเอง (เช่นป้ายกำกับใหญ่กว่าข้อมูลที่มันกำกับอยู่) */
          className="sticky top-0 z-10 hidden flex-wrap items-center gap-x-3 border-s-2 border-s-transparent border-b border-line bg-surface-2 px-3.5 py-1.5 font-mono text-micro font-bold text-ink-2 sm:flex"
        >
          <span className="w-[2.875rem] shrink-0">{T.col_datetime}</span>
          <span className="min-w-0 flex-1 basis-[9.375rem]">{T.log_col_device}</span>
          <span className="min-w-0 flex-[1.2] basis-[10.625rem]">{T.log_col_event}</span>
          <span className="min-w-0 flex-[0.9] basis-[7.5rem]">{T.col_group}</span>
          <span className="w-[6.25rem] shrink-0 text-end">{T.col_phone}</span>
          <span className="w-[5.25rem] shrink-0 text-end">{T.col_status}</span>
        </div>

        {groups.map((g, gi) => (
          <div key={g.day}>
            <div
              ref={gi === 0 ? dayRef : undefined}
              // border-s-2 ใสเหมือนแถวข้อมูล ไม่งั้นหัววันจะเยื้องจากแถวใต้มัน 2px
              className="flex flex-wrap items-baseline gap-x-2.5 border-s-2 border-s-transparent border-b border-line-2 bg-surface-2/60 px-3.5 py-1.5"
            >
              <h2 className="text-[0.78rem] font-bold">{fmtDay(g.day, lang, true)}</h2>
              <span className="font-mono text-micro text-ink-2">{T.log_day_calls(g.items.length)}</span>
            </div>

            {/* data-log-row = จุดที่ effect วัดความสูงแถว (ดูหัวข้อจำนวนแถวต่อหน้า)
                ต้องเป็นตัวห่อ ไม่ใช่ตัวแถว เพราะบรรทัดหมายเหตุนับเป็นความสูงของแถวด้วย
                ค่า plain/note บอกว่าแถวนี้มีบรรทัดหมายเหตุหรือเปล่า — ตัววัดใช้เฉพาะ plain
                เพราะมันสูงเท่ากันทุกแถวทุกหน้า ต่างจาก note ที่ทำให้แต่ละหน้าได้ค่าไม่เท่ากัน */}
            {g.items.map((r) => (
              <div
                key={r.job_id}
                data-log-row={r.last_detail ? 'note' : 'plain'}
                className={cn(
                  'border-s-2 border-b border-line-2 last:border-b-0',
                  // ขีดสีที่ขอบซ้าย = สายที่ไม่เรียบร้อย เห็นได้ตั้งแต่กวาดตาลงมาโดยไม่ต้อง
                  // อ่านป้ายสถานะที่อยู่สุดขอบขวา (สายตาต้องเดินข้ามทั้งแถวกว่าจะถึง)
                  // แถวที่โทรติดได้ขีดใส เพื่อให้ข้อความทุกแถวยังเริ่มตรงแนวเดียวกัน
                  railClass(r.status as CallStatus),
                )}
              >
                <div className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-3.5 py-2 text-start">
                  {/* เวลาอย่างเดียว — วันที่อยู่ที่หัวกลุ่มแล้ว ไม่ต้องซ้ำทุกบรรทัด */}
                  <span className="w-[2.875rem] shrink-0 font-mono text-[0.78rem] font-bold">
                    {new Date(r.created_at).toLocaleTimeString(locale(lang), {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                  {/* สองคอลัมน์นี้แบ่งที่ว่างที่เหลือกัน (flex-1 ทั้งคู่) ไม่ใช่ให้คอลัมน์เดียว
                      กินหมดแบบเดิม — ของเดิมชื่ออุปกรณ์กว้างตายตัว 150px แล้วเหตุการณ์
                      อมที่ว่างทั้งแถบ เกิดเป็นช่องโหว่ยาวๆ ก่อนถึงเบอร์โทรกับสถานะ
                      สายตาต้องเดินข้ามที่ว่างนั้นทุกแถวกว่าจะรู้ว่าโทรติดหรือไม่ติด */}
                  <span className="min-w-0 flex-1 basis-[9.375rem] truncate text-[0.78rem] font-medium">
                    {r.source_device ?? '—'}
                  </span>
                  <span className="min-w-0 flex-[1.2] basis-[10.625rem] truncate text-[0.78rem] text-ink-2">
                    {r.event_type_display_name ?? r.event_type_code ?? '—'}
                  </span>
                  {/* กลุ่มผู้รับ — ข้อมูลนี้ดึงมาอยู่แล้วแต่ไม่เคยเอามาแสดง
                      ที่ว่างกลางแถวเดิมกว้างมากจนสายตาต้องเดินข้ามไปหาเบอร์กับสถานะ
                      เอาของที่มีประโยชน์มาวางแทนดีกว่าปล่อยว่าง — และตอบคำถามที่ถามบ่อย
                      เวลาไล่ปัญหา: "สายนี้ไปเข้าทีมไหน" */}
                  <span className="min-w-0 flex-[0.9] basis-[7.5rem] truncate text-[0.78rem] text-ink-2">
                    {r.group_name || '—'}
                  </span>
                  <span className="w-[6.25rem] shrink-0 text-end font-mono text-[0.78rem] text-ink-2">
                    {r.last_phone_masked ?? '—'}
                  </span>
                  <span className="flex w-[5.25rem] shrink-0 justify-end [&>span]:px-2 [&>span]:py-px [&>span]:text-[0.6875rem]">
                    <StatusBadge status={r.status as CallStatus} />
                  </span>
                </div>

                {/* ── บรรทัดรายละเอียด ──
                    เห็นตลอด ไม่ต้องกดกาง — ของเดิมซ่อนไว้หลังลูกศร ▸ ซึ่งแปลว่าคนที่กวาดตา
                    หาสาเหตุต้องกดทีละแถวเพื่อดูว่าแต่ละสายพลาดเพราะอะไร ทั้งที่ข้อความ
                    สั้นแค่บรรทัดเดียวและมีเฉพาะแถวที่มีอะไรให้บอกอยู่แล้ว

                    ps-[4.5rem] = 2.875rem (ช่องเวลา) + 0.875rem (px-3.5) + 0.75rem (gap-x-3)
                    ทุกตัวเป็น rem เหมือนกันหมด ลูกศร ↳ จึงยังชี้ขึ้นไปตรงกับชื่ออุปกรณ์
                    ไม่ว่าจอจะทำให้ตัวอักษรใหญ่ขึ้นแค่ไหน (ถ้าตัวใดตัวหนึ่งเป็น px จะเยื้องทันที)
                    ไปตรงกับชื่ออุปกรณ์ของแถวตัวเอง ไม่ใช่ลอยอยู่ใต้ช่องเวลา */}
                {r.last_detail ? (
                  <p className="-mt-0.5 flex gap-1.5 pb-2 pe-3.5 ps-[4.5rem] text-[0.625rem] leading-[1.7] text-ink-2">
                    <span aria-hidden className="shrink-0 opacity-60">
                      ↳
                    </span>
                    <span className="min-w-0">{r.last_detail}</span>
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        ))}

        {/* ข้อความ "ไม่มีข้อมูล" อยู่ในกล่องเดียวกับตาราง ไม่ใช่กล่องแยกข้างล่างแบบเดิม
            — ไม่งั้นเวลาไม่มีข้อมูลจะเห็นกรอบเปล่าใบหนึ่งค้างอยู่เหนือมันโดยไม่มีเหตุผล */}
        {!loading && rows.length === 0 ? (
          <p className="px-4 py-10 text-center text-caption text-ink-2">{T.log_empty}</p>
        ) : null}
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2.5 font-mono text-micro text-ink-2">
        <span>{T.log_range(from, to, total)}</span>
        <span className="ms-auto flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="rounded-control border border-line bg-surface px-2.5 py-1 transition-colors hover:border-brand-strong disabled:opacity-40 disabled:hover:border-line"
          >
            ‹
          </button>
          {/* เลขหน้าอยู่ระหว่างปุ่ม — เดิมมีแต่ลูกศรสองตัว กดแล้วไม่รู้ว่าอยู่หน้าไหน
              และไม่รู้ว่าเหลืออีกกี่หน้า ตัวเลขล้วนจึงไม่ต้องแปลภาษา */}
          <span className="min-w-[3.25rem] text-center tabular-nums">
            {page} / {lastPage}
          </span>
          <button
            type="button"
            onClick={() => setPage((p) => Math.min(lastPage, p + 1))}
            disabled={page >= lastPage}
            className="rounded-control border border-line bg-surface px-2.5 py-1 transition-colors hover:border-brand-strong disabled:opacity-40 disabled:hover:border-line"
          >
            ›
          </button>
        </span>
      </div>
    </div>
  );
}
