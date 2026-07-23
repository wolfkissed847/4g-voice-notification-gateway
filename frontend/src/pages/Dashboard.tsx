import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, AppConfig, clearToken, QueueStatus } from "../api";

const STATUS_STYLES: Record<string, string> = {
  queued: "bg-slate-100 text-slate-700",
  in_progress: "bg-blue-100 text-blue-700",
  connected: "bg-emerald-100 text-emerald-700",
  no_answer: "bg-amber-100 text-amber-700",
  busy: "bg-amber-100 text-amber-700",
  retrying: "bg-amber-100 text-amber-700",
  escalated: "bg-orange-100 text-orange-700",
  sms_fallback_sent: "bg-teal-100 text-teal-700",
  failed: "bg-red-100 text-red-700",
};

export default function Dashboard() {
  const [queue, setQueue] = useState<QueueStatus | null>(null);
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");
  const navigate = useNavigate();

  async function loadData() {
    try {
      const [q, c] = await Promise.all([api.getQueueStatus(), api.getConfig()]);
      setQueue(q);
      setConfig(c);
    } catch {
      // request() ใน api.ts จัดการ redirect ตอน 401 ให้แล้ว
    }
  }

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 5000); // refresh คิวทุก 5 วิ
    return () => clearInterval(interval);
  }, []);

  async function handleSaveConfig(e: React.FormEvent) {
    e.preventDefault();
    if (!config) return;
    setSaving(true);
    setSaveMsg("");
    try {
      const updated = await api.updateConfig(config);
      setConfig(updated);
      setSaveMsg("บันทึกแล้ว — ต้อง restart worker เพื่อให้มีผล");
    } catch (err) {
      setSaveMsg(err instanceof Error ? err.message : "บันทึกไม่สำเร็จ");
    } finally {
      setSaving(false);
    }
  }

  function handleLogout() {
    clearToken();
    navigate("/login");
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between">
        <h1 className="font-semibold text-slate-800">📟 Gateway Dashboard</h1>
        <button
          onClick={handleLogout}
          className="text-sm text-slate-500 hover:text-slate-700"
        >
          ออกจากระบบ
        </button>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-8 space-y-8">
        {/* Queue Status */}
        <section className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-slate-800">คิวงานโทร</h2>
            <span className="text-sm text-slate-500">
              ค้างอยู่ {queue?.total_pending ?? "..."} รายการ
            </span>
          </div>

          {queue && queue.items.length === 0 && (
            <p className="text-sm text-slate-400 text-center py-8">ไม่มีงานค้างอยู่ในคิว</p>
          )}

          <div className="space-y-2">
            {queue?.items.map((item) => (
              <div
                key={item.job_id}
                className="flex items-center justify-between rounded-lg border border-slate-100 px-4 py-3"
              >
                <div>
                  <span className="text-sm font-medium text-slate-700">#{item.job_id}</span>
                  <span className="text-sm text-slate-400 ml-2">{item.priority_group}</span>
                </div>
                <div className="flex items-center gap-3">
                  {item.retry_count > 0 && (
                    <span className="text-xs text-slate-400">retry {item.retry_count}</span>
                  )}
                  <span
                    className={`text-xs font-medium px-2 py-1 rounded-full ${
                      STATUS_STYLES[item.status] ?? "bg-slate-100 text-slate-600"
                    }`}
                  >
                    {item.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Config */}
        <section className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
          <h2 className="font-semibold text-slate-800 mb-4">ตั้งค่าการโทร</h2>

          {config && (
            <form onSubmit={handleSaveConfig} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-slate-600 mb-1">จำนวนครั้ง retry</label>
                  <input
                    type="number"
                    min={0}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    value={config.call_retry_count}
                    onChange={(e) =>
                      setConfig({ ...config, call_retry_count: Number(e.target.value) })
                    }
                  />
                </div>
                <div>
                  <label className="block text-sm text-slate-600 mb-1">
                    หน่วงเวลา retry (วินาที)
                  </label>
                  <input
                    type="number"
                    min={0}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    value={config.call_retry_delay_seconds}
                    onChange={(e) =>
                      setConfig({ ...config, call_retry_delay_seconds: Number(e.target.value) })
                    }
                  />
                </div>
                <div>
                  <label className="block text-sm text-slate-600 mb-1">
                    Timeout รอสายรับ (วินาที)
                  </label>
                  <input
                    type="number"
                    min={0}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    value={config.call_ring_timeout_seconds}
                    onChange={(e) =>
                      setConfig({ ...config, call_ring_timeout_seconds: Number(e.target.value) })
                    }
                  />
                </div>
                <div className="flex items-end">
                  <label className="flex items-center gap-2 text-sm text-slate-600">
                    <input
                      type="checkbox"
                      checked={config.sms_fallback_enabled}
                      onChange={(e) =>
                        setConfig({ ...config, sms_fallback_enabled: e.target.checked })
                      }
                    />
                    เปิดใช้ SMS Fallback
                  </label>
                </div>
              </div>

              <div className="flex items-center gap-3 pt-2">
                <button
                  type="submit"
                  disabled={saving}
                  className="bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg px-4 py-2 transition"
                >
                  {saving ? "กำลังบันทึก..." : "บันทึกการตั้งค่า"}
                </button>
                {saveMsg && <span className="text-sm text-slate-500">{saveMsg}</span>}
              </div>
            </form>
          )}
        </section>
      </main>
    </div>
  );
}
