/**
 * SystemPage — พอร์ตจาก figma/handoff/components/SystemPage.tsx
 * แทน SettingsPage เดิม (ดีไซน์ยุบการตั้งค่าเข้ามาไว้ในหน้านี้)
 *
 * ── ต่างจากดีไซน์ ──────────────────────────────────────────────────────────
 * ดีไซน์มี 4 การ์ด: โมดูล 4G / ซิม+เครดิต / เสียงเริ่มต้น / บัญชี+ธีม
 * ของที่มี endpoint จริงรองรับมีแค่ส่วนโมดูลกับธีม จึงจัดใหม่เป็น:
 *
 *   1. โมดูล 4G      — /system/gsm (จริงทั้งหมด)
 *   2. Raspberry Pi  — /system/pi (ดีไซน์ไม่มีการ์ดนี้ แต่เรามีข้อมูลจริงและมีประโยชน์)
 *   3. ค่าการโทร     — /config (retry/timeout) = ที่ดีไซน์วางไว้ในแท็บ retry ของหน้าอุปกรณ์
 *                      แต่ของเราเป็นค่ากลางทั้งระบบ จึงต้องอยู่หน้านี้
 *   4. รันไทม์+ธีม    — /system/info + ปุ่มสลับธีม
 *
 * ที่ตัดออกเพราะไม่มีข้อมูล/endpoint: เครดิตซิม, รีสตาร์ทโมดูล, เสียงชาย-หญิง+ความเร็ว,
 * เปลี่ยนรหัสผ่าน, ออกจากระบบทุกอุปกรณ์ — บอกไว้ในการ์ดท้ายหน้าตรงๆ ไม่ทำช่องหลอก
 */
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Moon, Sun } from 'lucide-react';

import { getConfig, updateConfig } from '../api/config';
import { listEventTypes, sendTestNotify } from '../api/eventTypes';
import { getGsmDetail, getPiDetail, getSystemInfo } from '../api/system';
import { Btn, Card, Divider, Field, PageHeader, Pill, inputCls } from '../components/primitives';
import { useApp } from '../context/AppContext';
import { operatorName } from '../lib/operator';
import type { AppConfig, GsmDetail, PiDetail, SystemInfo } from '../types';

export function SystemPage() {
  const { T, dark, toggleDark } = useApp();
  const [gsm, setGsm] = useState<GsmDetail | null>(null);
  const [pi, setPi] = useState<PiDetail | null>(null);
  const [info, setInfo] = useState<SystemInfo | null>(null);
  const [cfg, setCfg] = useState<AppConfig | null>(null);
  const [saving, setSaving] = useState(false);

  // config เป็นฟอร์มที่แก้ได้ ดึงครั้งเดียวพอ — poll ทับระหว่างพิมพ์จะเด้งค่าที่ยังไม่ได้กด "บันทึก" ทิ้ง
  useEffect(() => {
    void getConfig().then(setCfg);
  }, []);

  // gsm/pi/info เป็นค่าอ่านอย่างเดียว poll ได้อิสระ — เดิมดึงครั้งเดียวตอน mount ทำให้หน้านี้
  // "ค้าง" ไม่อัปเดตเลยจนกว่าจะ reload เอง ใช้จังหวะเดียวกับ DashboardPage (5 วิ)
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const [g, p, i] = await Promise.all([getGsmDetail(), getPiDetail(), getSystemInfo()]);
      if (cancelled) return;
      setGsm(g);
      setPi(p);
      setInfo(i);
    };
    void load();
    const id = setInterval(() => void load(), 5000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const saveConfig = async () => {
    if (!cfg) return;
    setSaving(true);
    try {
      const updated = await updateConfig(cfg);
      setCfg(updated);
      toast.success(T.toast_updated);
    } finally {
      setSaving(false);
    }
  };

  const testCall = async () => {
    const types = await listEventTypes();
    const first = types.find((t) => t.is_active);
    if (!first) {
      toast.error(T.allowed_events_empty_hint);
      return;
    }
    await sendTestNotify({ event_type_code: first.code });
    toast.success(T.toast_created);
  };

  const set = <K extends keyof AppConfig>(k: K, v: AppConfig[K]) => setCfg((c) => (c ? { ...c, [k]: v } : c));

  return (
    <div className="flex flex-col gap-3.5">
      <PageHeader title={T.sys_title} meta={T.sys_meta} />

      {/* 3 คอลัมน์ที่ 1180px ตามภาพ (เดิม minmax 280px ได้ 4 คอลัมน์ การ์ดแคบเกิน อ่านยาก)
          การ์ดค่าการโทรกินความกว้าง 2 ช่อง เพราะเป็นฟอร์มที่มีช่องกรอก 3 ช่องเรียงกัน
          ถ้าบีบเท่าการ์ดอื่นช่องกรอกจะแคบจนพิมพ์เลข 3 หลักไม่เห็น */}
      <p className="font-mono text-micro tracking-[0.12em] text-ink-2 uppercase">{T.sys_section_hw}</p>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(320px,100%),1fr))] items-start gap-3.5">
        <Card className="flex min-w-0 flex-col gap-3 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lead font-bold">{T.sys_module_4g}</h2>
            <Pill tone={gsm?.connected ? 'ok' : 'bad'}>
              {gsm?.connected ? T.gsm_status_ok : T.sys_module_offline}
            </Pill>
          </div>
          {/* ค่าทั้งหมดมาจาก AT command จริงที่ worker เช็คไว้ตอน idle (AT+CSQ, AT+COPS?) */}
          <dl className="font-mono text-caption leading-[2] break-words text-ink-2">
            <div>
              {T.gsm_operator_label} <b className="text-ink">{operatorName(gsm?.operator) ?? T.gsm_no_operator}</b>
            </div>
            <div>
              {T.gsm_mode_label} <b className="text-ink">{gsm?.network_mode ?? T.gsm_signal_unknown}</b>
            </div>
            <div>
              {T.gsm_signal_label}{' '}
              <b className="text-ink">
                {gsm?.signal_quality != null ? `${gsm.signal_quality}/31` : T.gsm_signal_unknown}
              </b>
            </div>
            <div>
              {T.sys_module_port} {gsm?.port ?? '—'}
            </div>
            <div>
              {T.sys_module_updated} {gsm?.updated_at ? new Date(gsm.updated_at).toLocaleString() : '—'}
            </div>
          </dl>
          <div className="flex flex-wrap gap-2">
            <Btn onClick={() => void testCall()}>{T.device_test_call}</Btn>
          </div>
        </Card>

        <Card className="flex min-w-0 flex-col gap-3 p-4">
          <h2 className="text-lead font-bold">{T.sys_pi_title}</h2>
          <dl className="font-mono text-caption leading-[2] break-words text-ink-2">
            <div>
              {T.pi_cpu_label} <b className="text-ink">{pi?.cpu_percent ?? '—'}%</b>
            </div>
            <div>
              {T.pi_ram_label}{' '}
              <b className="text-ink">
                {pi ? `${pi.mem_percent}% (${pi.mem_used_mb}/${pi.mem_total_mb} MB)` : '—'}
              </b>
            </div>
            <div>
              {T.pi_temp_label}{' '}
              <b className="text-ink">
                {pi?.cpu_temp_c != null ? `${pi.cpu_temp_c}°C` : T.pi_temp_unavailable}
              </b>
            </div>
          </dl>
        </Card>

        <Card className="flex min-w-0 flex-col gap-3 p-4">
          <h2 className="text-lead font-bold">{T.sys_runtime}</h2>
          <dl className="font-mono text-caption leading-[2] break-words text-ink-2">
            <div>
              {T.system_info_version} <b className="text-ink">{info?.app_version ?? '—'}</b>
            </div>
            <div>
              {T.system_info_worker}{' '}
              <b className={info?.worker_started_at ? 'text-ok' : 'text-bad'}>
                {info?.worker_started_at ? T.system_info_worker_running : T.system_info_worker_stopped}
              </b>
            </div>
            <div>
              {T.system_info_db_size}{' '}
              <b className="text-ink">
                {info?.db_size_bytes != null ? `${(info.db_size_bytes / 1024).toFixed(0)} KB` : '—'}
              </b>
            </div>
          </dl>

          <Divider />
          <div className="flex flex-wrap items-center gap-2.5 text-caption">
            <span className="flex-1">{T.sys_theme_label}</span>
            {/* ไอคอนแทนข้อความ ชุดเดียวกับปุ่มบนหัวเว็บ — มีคำว่า "ธีม" กำกับอยู่ซ้ายมืออยู่แล้ว */}
            <Btn
              className="grid size-9 place-items-center rounded-full p-0"
              onClick={toggleDark}
              aria-label={dark ? T.sys_theme_to_light : T.sys_theme_to_dark}
              title={dark ? T.sys_theme_to_light : T.sys_theme_to_dark}
            >
              {dark ? <Sun size={15} /> : <Moon size={15} />}
            </Btn>
          </div>
        </Card>
      </div>

      <p className="mt-1 font-mono text-micro tracking-[0.12em] text-ink-2 uppercase">{T.sys_section_call}</p>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(320px,100%),1fr))] items-start gap-3.5">
        <Card className="col-span-full flex flex-col gap-3 p-4">
          <h2 className="text-lead font-bold">{T.sys_call_config}</h2>
          {cfg ? (
            <>
              <div className="grid grid-cols-[repeat(auto-fit,minmax(140px,1fr))] gap-2.5">
                <Field label={T.retry_count}>
                  <input
                    type="number"
                    min={0}
                    max={10}
                    className={`${inputCls} font-mono`}
                    value={cfg.call_retry_count}
                    onChange={(e) => set('call_retry_count', Number(e.target.value))}
                  />
                </Field>
                <Field label={T.retry_delay}>
                  <input
                    type="number"
                    min={5}
                    max={300}
                    className={`${inputCls} font-mono`}
                    value={cfg.call_retry_delay_seconds}
                    onChange={(e) => set('call_retry_delay_seconds', Number(e.target.value))}
                  />
                </Field>
                <Field label={T.ring_timeout}>
                  <input
                    type="number"
                    min={10}
                    max={120}
                    className={`${inputCls} font-mono`}
                    value={cfg.call_ring_timeout_seconds}
                    onChange={(e) => set('call_ring_timeout_seconds', Number(e.target.value))}
                  />
                </Field>
              </div>

              <p className="text-caption leading-[1.8] text-ink-2">{T.sys_call_config_note}</p>
              <Btn variant="primary" className="self-start" onClick={() => void saveConfig()} disabled={saving}>
                {T.save}
              </Btn>
            </>
          ) : null}
        </Card>

      </div>

      {/* หมายเหตุนี้ทำเป็นกล่องเส้นประ ไม่ใช่การ์ดทึบ — มันเป็นข้อมูลกำกับ ไม่ใช่ของที่ใช้งานได้
          ถ้าทำเป็นการ์ดเหมือนกันจะแย่งน้ำหนักสายตากับการ์ดที่กดใช้จริง */}
      <div className="mt-1 flex flex-col gap-1.5 rounded-card border border-dashed border-warn bg-warn-soft/40 px-4 py-3.5">
        <h2 className="text-caption font-bold text-warn">{T.sys_missing_title}</h2>
        <p className="text-caption leading-[1.9] text-ink-2">{T.sys_missing_body}</p>
      </div>
    </div>
  );
}
