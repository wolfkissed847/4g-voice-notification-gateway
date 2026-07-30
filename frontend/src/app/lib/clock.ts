import { useState, useEffect } from "react";
import type { Lang } from "../types";

export function useLiveClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

const TH_DAYS = ["วันอาทิตย์", "วันจันทร์", "วันอังคาร", "วันพุธ", "วันพฤหัสบดี", "วันศุกร์", "วันเสาร์"];
const TH_MONTHS = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
const EN_DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const EN_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function formatClock(d: Date, lang: Lang): { date: string; time: string } {
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  if (lang === "th") {
    return {
      date: `${TH_DAYS[d.getDay()]} ${d.getDate()} ${TH_MONTHS[d.getMonth()]} ${d.getFullYear() + 543}`,
      time: `${hh}:${mm}:${ss} น.`,
    };
  }
  return {
    date: `${EN_DAYS[d.getDay()]}, ${d.getDate()} ${EN_MONTHS[d.getMonth()]} ${d.getFullYear()}`,
    time: `${hh}:${mm}:${ss}`,
  };
}
