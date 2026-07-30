import { Toaster } from "sonner";
import { useApp } from "../context/AppContext";

/** Thin wrapper around sonner's Toaster that follows the app's own dark-mode state
 *  (the app toggles dark mode via a plain class on <html>, not next-themes). */
export function AppToaster() {
  const { dark } = useApp();
  return <Toaster richColors position="top-right" theme={dark ? "dark" : "light"} />;
}
