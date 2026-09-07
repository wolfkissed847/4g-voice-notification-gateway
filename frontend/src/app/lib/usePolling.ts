import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Polls `fetcher` every `intervalMs`, exposing the latest result, loading and error state.
 *
 * `refresh()` ดึงใหม่ทันทีโดยไม่รอรอบถัดไป — ใช้หลังจากผู้ใช้ทำอะไรที่เปลี่ยนข้อมูลเอง
 * (เช่นยกเลิกงานในคิว) ถ้าปล่อยให้รอรอบ polling ช่วงที่หน้าจอยังโชว์ของเก่าอ่านได้ว่า
 * กดแล้วไม่มีอะไรเกิดขึ้น แล้วคนจะกดซ้ำ
 */
export function usePolling<T>(fetcher: () => Promise<T>, intervalMs: number) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const tickRef = useRef<(() => Promise<void>) | null>(null);

  useEffect(() => {
    let cancelled = false;

    const tick = async () => {
      try {
        const result = await fetcherRef.current();
        if (!cancelled) { setData(result); setError(null); }
      } catch (e) {
        if (!cancelled) setError(e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    tickRef.current = tick;
    tick();
    const id = setInterval(tick, intervalMs);
    return () => { cancelled = true; clearInterval(id); };
  }, [intervalMs]);

  /* เรียก tick ตัวปัจจุบันผ่าน ref — ตัวที่อยู่ใน effect ปิดทับ `cancelled` ของรอบนั้นไว้
     จึงยกเลิกตัวเองถูกต้องตอน component ถูกถอด ไม่เขียน state ทิ้งไว้หลัง unmount */
  const refresh = useCallback(async () => {
    await tickRef.current?.();
  }, []);

  return { data, loading, error, refresh };
}
