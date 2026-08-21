import type { CallStatus } from '../types';

/**
 * ความหมายของสถานะงานโทรแต่ละค่า — แหล่งเดียวของทั้งเว็บ
 *
 * เดิมเขียนไว้ในหน้าคู่มืออย่างเดียว พอหน้าคิวต้องใช้ชุดเดียวกันด้วยจึงยกออกมาไว้ตรงนี้
 * ถ้าปล่อยให้ก๊อปไปไว้สองที่ วันหนึ่งจะมีหน้าหนึ่งที่อธิบายสถานะไม่ตรงกับอีกหน้า
 * ซึ่งบนหน้าจอที่คนเปิดดูตอนเกิดเหตุ คำอธิบายที่ขัดกันเองแย่กว่าไม่มีคำอธิบายเลย
 *
 * เรียงตามลำดับที่งานจริงเดินผ่าน (เข้าคิว → กำลังโทร → ผลลัพธ์) ไม่ใช่เรียงตามตัวอักษร
 * — คนอ่านจะได้เห็นเส้นทางของงานไปในตัว
 */
export function statusMeanings(th: boolean): { status: CallStatus; meaning: string }[] {
  return [
    {
      status: 'queued',
      meaning: th ? 'รับคำขอแล้ว รออยู่ในคิว ยังไม่ได้โทร' : 'Accepted, waiting in the queue',
    },
    {
      status: 'in_progress',
      meaning: th ? 'กำลังโทรอยู่ตอนนี้' : 'Dialing right now',
    },
    {
      status: 'connected',
      meaning: th ? 'ปลายสายรับและได้ยินข้อความจนจบ = สำเร็จ' : 'Answered and the message played through',
    },
    {
      status: 'no_answer',
      meaning: th ? 'ปล่อยดังจนครบเวลาแล้วไม่มีใครรับ' : 'Rang the full timeout with no answer',
    },
    {
      status: 'busy',
      meaning: th ? 'ปลายสายกำลังคุยสายอื่นอยู่' : 'The line was busy',
    },
    {
      status: 'retrying',
      meaning: th ? 'รอโทรซ้ำเบอร์เดิม ตามค่าที่ตั้งไว้' : 'Waiting to redial the same number',
    },
    {
      status: 'escalated',
      meaning: th ? 'เบอร์นี้หมดโควตาแล้ว กำลังเลื่อนไปเบอร์ถัดไป' : 'Moving on to the next contact',
    },
    {
      status: 'failed',
      // สั้นไว้ให้จบบรรทัดเดียว — การ์ดนี้ไปโผล่ในหน้าคิวด้วย ซึ่งทุกบรรทัดที่ตกลงมา
      // คือความสูงที่ตารางคิวเสียไป
      meaning: th ? 'ไล่ครบทุกเบอร์แล้วไม่มีใครรับ หรือเกิดข้อผิดพลาด' : 'All contacts exhausted, or an error occurred',
    },
  ];
}
