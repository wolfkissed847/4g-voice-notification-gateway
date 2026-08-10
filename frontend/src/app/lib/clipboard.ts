/**
 * คัดลอกข้อความลงคลิปบอร์ด พร้อม fallback สำหรับหน้าเว็บที่เปิดผ่าน http ธรรมดา
 *
 * navigator.clipboard มีให้ใช้เฉพาะ "secure context" (https หรือ localhost) เท่านั้น
 * แต่เครื่องนี้ deploy บน Pi แล้วเปิดจาก LAN ด้วย http://192.168.x.x:8000 ซึ่งไม่ใช่ secure context
 * → navigator.clipboard เป็น undefined ทั้งก้อน โค้ดเดิม (`navigator.clipboard?.writeText`)
 *   เลยเงียบไปเฉยๆ แต่ปุ่มยังขึ้น "คัดลอกแล้ว" = โกหกผู้ใช้ ซึ่งอันตรายมากกับหน้าโชว์ key ครั้งเดียว
 *
 * คืนค่า true ก็ต่อเมื่อคัดลอกสำเร็จจริง — ผู้เรียกต้องเช็คก่อนแจ้งว่าสำเร็จ
 */
export async function copyText(text: string): Promise<boolean> {
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // ผู้ใช้ปฏิเสธ permission หรือ browser บล็อก — ลองวิธีสำรองต่อ
    }
  }

  // วิธีสำรอง: execCommand('copy') เลิกใช้แล้วตามสเปกแต่ยังทำงานได้ทุก browser บน http
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    // ต้องอยู่ในหน้าจอจริง (ไม่ใช่ display:none) ถึงจะ select ได้ — ซ่อนด้วย opacity แทน
    ta.style.position = 'fixed';
    ta.style.top = '0';
    ta.style.opacity = '0';
    ta.style.pointerEvents = 'none';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
