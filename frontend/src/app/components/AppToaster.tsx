import { Toaster } from "sonner";
import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";
import { useApp } from "../context/AppContext";

/**
 * Thin wrapper around sonner's Toaster that follows the app's own dark-mode state
 * (the app toggles dark mode via a plain class on <html>, not next-themes)
 *
 * ไม่ใช้ richColors ของ sonner (เขียว/แดงมาตรฐานของ library) เพราะไม่ตรงกับโทนสี ok/warn/bad
 * ของดีไซน์นี้ (ดู tw-theme.css) — ผูก classNames เข้ากับ token เดียวกับที่ Alert.tsx ใช้แทน
 * ให้ toast กับ alert ฝังในหน้าหน้าตาเป็นชุดเดียวกัน
 */
export function AppToaster() {
  const { dark } = useApp();
  return (
    <Toaster
      position="top-right"
      theme={dark ? "dark" : "light"}
      icons={{
        success: <CheckCircle2 size={16} />,
        error: <XCircle size={16} />,
        warning: <AlertTriangle size={16} />,
        info: <Info size={16} />,
      }}
      toastOptions={{
        classNames: {
          toast: "rounded-card! border! shadow-card! bg-surface! font-sans!",
          title: "text-caption! font-medium! text-ink!",
          description: "text-micro! text-ink-2!",
          success: "border-ok! [&_[data-icon]]:text-ok-strong!",
          error: "border-bad! [&_[data-icon]]:text-bad-strong!",
          warning: "border-warn! [&_[data-icon]]:text-warn-strong!",
          info: "border-brand-strong! [&_[data-icon]]:text-brand-strong!",
        },
      }}
    />
  );
}
