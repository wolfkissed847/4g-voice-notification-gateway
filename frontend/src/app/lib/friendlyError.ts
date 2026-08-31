// ─── แปลข้อความ error จาก API ให้คนทั่วไปอ่านรู้เรื่อง ────────────────────────
//
// ปัญหาที่แก้: FastAPI ตอบ 422 กลับมาเป็น "array ของ validation error" ดิบๆ เช่น
//
//   [{"type":"string_too_short","loc":["body","phone_number"],
//     "msg":"String should have at least 8 characters","input":"0812",
//     "ctx":{"min_length":8}}]
//
// ของเดิมเอา JSON.stringify ยัดลงกล่องแจ้งเตือนทั้งดุ้น ผู้ใช้ที่ไม่ได้เขียนโปรแกรม
// อ่านไม่ออกเลยว่าตัวเองทำอะไรผิด และไม่รู้ว่าต้องแก้ตรงไหน
//
// ไฟล์นี้แปลงเป็นประโยคเดียวที่บอกว่า "ช่องไหน ผิดยังไง ต้องเป็นเท่าไหร่"
// เช่น → "เบอร์โทรสั้นเกินไป ต้องมีอย่างน้อย 8 หลัก"

type Lang = "th" | "en";

const LANG_STORAGE_KEY = "gateway_lang";

function currentLang(): Lang {
  try {
    return localStorage.getItem(LANG_STORAGE_KEY) === "en" ? "en" : "th";
  } catch {
    return "th"; // localStorage ใช้ไม่ได้ (โหมดส่วนตัวบางเบราว์เซอร์) — ถอยไปภาษาไทย
  }
}

/**
 * ชื่อช่องกรอกที่ผู้ใช้เห็นบนหน้าจอ — คีย์คือชื่อ field จริงใน API
 * ถ้าเจอ field ที่ไม่มีในนี้ จะใช้ชื่อดิบไปก่อน ดีกว่าไม่บอกอะไรเลย
 */
const FIELD_LABELS: Record<string, { th: string; en: string; unit?: { th: string; en: string } }> = {
  phone_number: { th: "เบอร์โทร", en: "Phone number", unit: { th: "หลัก", en: "digits" } },
  name: { th: "ชื่อ", en: "Name" },
  username: { th: "ชื่อผู้ใช้", en: "Username" },
  password: { th: "รหัสผ่าน", en: "Password" },
  description: { th: "คำอธิบาย", en: "Description" },

  code: { th: "รหัสเหตุการณ์", en: "Event code" },
  event_type_code: { th: "รหัสเหตุการณ์", en: "Event code" },
  display_name: { th: "ชื่อเหตุการณ์", en: "Event name" },
  message_template: { th: "ข้อความที่จะพูด", en: "Spoken message" },
  message: { th: "ข้อความ", en: "Message" },
  variables: { th: "ตัวแปรในข้อความ", en: "Message variables", unit: { th: "ตัว", en: "items" } },

  contact_ids: { th: "เบอร์ที่เลือก", en: "Selected numbers", unit: { th: "เบอร์", en: "numbers" } },
  event_type_ids: { th: "เหตุการณ์ที่อนุญาต", en: "Allowed events", unit: { th: "รายการ", en: "items" } },
  ordered_ids: { th: "ลำดับเบอร์", en: "Number order", unit: { th: "รายการ", en: "items" } },
  device_id: { th: "อุปกรณ์", en: "Device" },
  group_id: { th: "กลุ่มผู้รับ", en: "Recipient group" },

  call_retry_count: { th: "จำนวนครั้งที่โทรซ้ำ", en: "Retry count", unit: { th: "ครั้ง", en: "times" } },
  call_retry_delay_seconds: { th: "เวลารอก่อนโทรซ้ำ", en: "Retry delay", unit: { th: "วินาที", en: "seconds" } },
  call_ring_timeout_seconds: { th: "เวลารอให้รับสาย", en: "Ring timeout", unit: { th: "วินาที", en: "seconds" } },
  call_answer_delay_seconds: { th: "เวลาเว้นก่อนเริ่มพูด", en: "Delay before speaking", unit: { th: "วินาที", en: "seconds" } },
  call_repeat_count: { th: "จำนวนรอบที่พูดซ้ำ", en: "Repeat count", unit: { th: "รอบ", en: "rounds" } },
};

/** ชื่อช่อง + หน่วยนับที่เหมาะกับช่องนั้น (เบอร์โทรนับเป็น "หลัก" ไม่ใช่ "ตัวอักษร") */
function labelOf(field: string, lang: Lang): { label: string; unit: string } {
  const entry = FIELD_LABELS[field];
  const fallbackUnit = lang === "th" ? "ตัวอักษร" : "characters";
  if (!entry) return { label: field, unit: fallbackUnit };
  return { label: entry[lang], unit: entry.unit ? entry.unit[lang] : fallbackUnit };
}

interface PydanticError {
  type?: string;
  loc?: unknown[];
  msg?: string;
  ctx?: Record<string, unknown>;
}

/** หา "ชื่อช่อง" จาก loc — ตัด "body"/"query" ที่เป็นแค่ตำแหน่งทิ้ง เอาชื่อจริงตัวสุดท้าย */
function fieldFromLoc(loc: unknown[] | undefined): string {
  if (!Array.isArray(loc)) return "";
  const parts = loc.filter((p): p is string => typeof p === "string" && !["body", "query", "path", "header"].includes(p));
  return parts.length ? parts[parts.length - 1] : "";
}

function num(ctx: Record<string, unknown> | undefined, key: string): number | null {
  const v = ctx?.[key];
  return typeof v === "number" ? v : null;
}

/** แปล validation error 1 ข้อเป็นประโยคเดียว */
function translateOne(err: PydanticError, lang: Lang): string {
  const field = fieldFromLoc(err.loc);
  const { label, unit } = labelOf(field, lang);
  const t = err.type ?? "";
  const ctx = err.ctx;
  const th = lang === "th";

  const min = num(ctx, "min_length") ?? num(ctx, "ge") ?? num(ctx, "gt");
  const max = num(ctx, "max_length") ?? num(ctx, "le") ?? num(ctx, "lt");

  switch (t) {
    case "missing":
      return th ? `ยังไม่ได้กรอก${label}` : `${label} is required`;

    case "string_too_short":
    case "too_short":
      return min !== null
        ? th
          ? `${label}สั้นเกินไป ต้องมีอย่างน้อย ${min} ${unit}`
          : `${label} is too short — needs at least ${min} ${unit}`
        : th
          ? `${label}สั้นเกินไป`
          : `${label} is too short`;

    case "string_too_long":
    case "too_long":
      return max !== null
        ? th
          ? `${label}ยาวเกินไป ใส่ได้ไม่เกิน ${max} ${unit}`
          : `${label} is too long — at most ${max} ${unit}`
        : th
          ? `${label}ยาวเกินไป`
          : `${label} is too long`;

    case "greater_than_equal":
    case "greater_than":
      return th
        ? `${label}น้อยเกินไป ต้องไม่ต่ำกว่า ${min} ${unit}`
        : `${label} is too low — minimum is ${min} ${unit}`;

    case "less_than_equal":
    case "less_than":
      return th
        ? `${label}มากเกินไป ต้องไม่เกิน ${max} ${unit}`
        : `${label} is too high — maximum is ${max} ${unit}`;

    case "int_parsing":
    case "int_type":
    case "float_parsing":
      return th ? `${label}ต้องเป็นตัวเลข` : `${label} must be a number`;

    case "string_type":
      return th ? `${label}ต้องเป็นข้อความ` : `${label} must be text`;

    case "string_pattern_mismatch":
      return th ? `${label}อยู่ในรูปแบบที่ไม่ถูกต้อง` : `${label} has an invalid format`;

    case "value_error":
      // ข้อความจาก validator ที่เราเขียนเอง มักเป็นภาษาไทยที่อ่านรู้เรื่องอยู่แล้ว
      return err.msg?.replace(/^Value error,\s*/i, "") || (th ? `${label}ไม่ถูกต้อง` : `${label} is invalid`);

    default:
      if (field) return th ? `${label}ไม่ถูกต้อง` : `${label} is invalid`;
      return err.msg || (th ? "ข้อมูลที่กรอกไม่ถูกต้อง" : "Invalid input");
  }
}

/**
 * แปลง `detail` ที่ได้จาก API เป็นข้อความเดียวที่คนทั่วไปอ่านเข้าใจ
 * รองรับทั้งกรณีที่ detail เป็นสตริงอยู่แล้ว (เราเขียนเองฝั่ง backend)
 * และกรณีที่เป็น array ของ validation error จาก Pydantic
 */
export function humanizeDetail(detail: unknown): string {
  const lang = currentLang();

  if (typeof detail === "string") return detail;

  if (Array.isArray(detail)) {
    const msgs = detail
      .map((e) => translateOne(e as PydanticError, lang))
      .filter((m, i, arr) => m && arr.indexOf(m) === i); // ตัดข้อความซ้ำออก
    if (msgs.length === 0) return "";
    // เกิน 3 ข้อแล้วอ่านไม่ไหว — บอกจำนวนที่เหลือแทนการพ่นออกมาทั้งหมด
    if (msgs.length > 3) {
      const rest = msgs.length - 3;
      return lang === "th"
        ? `${msgs.slice(0, 3).join(" · ")} (และอีก ${rest} เรื่อง)`
        : `${msgs.slice(0, 3).join(" · ")} (and ${rest} more)`;
    }
    return msgs.join(" · ");
  }

  if (detail && typeof detail === "object") {
    const msg = (detail as { msg?: unknown }).msg;
    if (typeof msg === "string") return msg;
  }

  return "";
}

/** ข้อความสำรองตามรหัสสถานะ ใช้เมื่อเซิร์ฟเวอร์ไม่ได้บอกอะไรมาเลย */
export function fallbackByStatus(status: number): string {
  const th = currentLang() === "th";
  if (status === 403) return th ? "ไม่มีสิทธิ์ทำรายการนี้" : "You don't have permission for this action";
  if (status === 404) return th ? "ไม่พบข้อมูลที่ต้องการ อาจถูกลบไปแล้ว" : "Not found — it may have been deleted";
  if (status === 409) return th ? "ทำรายการไม่ได้เพราะข้อมูลนี้ถูกใช้งานอยู่" : "Conflict — this item is still in use";
  if (status === 429) return th ? "ทำรายการถี่เกินไป รอสักครู่แล้วลองใหม่" : "Too many requests — please wait and try again";
  if (status >= 500) {
    return th
      ? `ระบบขัดข้อง (${status}) ลองใหม่อีกครั้ง ถ้ายังไม่หายให้แจ้งผู้ดูแล`
      : `Server error (${status}) — please try again, or contact the administrator`;
  }
  return th ? `ทำรายการไม่สำเร็จ (${status})` : `Request failed (${status})`;
}
