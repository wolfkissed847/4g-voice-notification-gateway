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
import { useEffect, useRef, useState } from 'react';
import type { SVGProps } from 'react';
import { toast } from 'sonner';
import { Moon, Sun } from 'lucide-react';

import { cn } from '@/app/components/ui/utils';
import { getConfig, updateConfig } from '../api/config';
import { getGsmDetail, getPiDetail, getSystemInfo, restartGsm } from '../api/system';
import { Btn, Card, Divider, PageHeader, Pill, inputCls } from '../components/primitives';
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
  const [confirmRestart, setConfirmRestart] = useState(false);
  // จำว่ารอบก่อนกำลังรีสตาร์ทอยู่ไหม เพื่อจับ "จังหวะที่เพิ่งเปลี่ยนจากกำลังทำ → เสร็จ"
  // แล้วเด้ง toast ครั้งเดียว ถ้าดูจาก restart_result อย่างเดียวจะเด้งซ้ำทุก 2 วิที่ poll
  const wasRestarting = useRef(false);

  // config เป็นฟอร์มที่แก้ได้ ดึงครั้งเดียวพอ — poll ทับระหว่างพิมพ์จะเด้งค่าที่ยังไม่ได้กด "บันทึก" ทิ้ง
  useEffect(() => {
    void getConfig().then(setCfg);
  }, []);

  // gsm/pi/info เป็นค่าอ่านอย่างเดียว poll ได้อิสระ — เดิมดึงครั้งเดียวตอน mount ทำให้หน้านี้
  // "ค้าง" ไม่อัปเดตเลยจนกว่าจะ reload เอง
  //
  // 2 วิ (ถี่กว่าหน้าอื่นที่ใช้ 5 วิ) เพราะหน้านี้คือหน้าที่คนเปิดค้างไว้ "เพื่อดูว่าเครื่องเป็นยังไง"
  // โดยเฉพาะตอนไล่ปัญหา เช่นดูว่า CPU พุ่งตอนโทรไหม อุณหภูมิขึ้นถึงเท่าไหร่ ถ้า 5 วิจะพลาดจังหวะสั้นๆ ไป
  // ต้นทุนต่ำเพราะฝั่ง backend อ่านค่าจาก /proc ตรงๆ ไม่มี query ฐานข้อมูล
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const [g, p, i] = await Promise.all([getGsmDetail(), getPiDetail(), getSystemInfo()]);
      if (cancelled) return;
      if (wasRestarting.current && !g.restarting) {
        if (g.restart_result === 'ok') toast.success(T.gsm_restart_ok);
        else if (g.restart_result === 'failed') toast.error(T.gsm_restart_failed);
      }
      wasRestarting.current = g.restarting;
      setGsm(g);
      setPi(p);
      setInfo(i);
    };
    void load();
    const id = setInterval(() => void load(), 2000);
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

  const set =<K extends keyof AppConfig>(k: K, v: AppConfig[K]) => setCfg((c) => (c ? { ...c, [k]: v } : c));

  return (
    <div className="flex flex-col gap-3.5">
      <PageHeader title={T.sys_title} meta={T.sys_meta} />

      {/* 3 คอลัมน์ที่ 1180px ตามภาพ (เดิม minmax 280px ได้ 4 คอลัมน์ การ์ดแคบเกิน อ่านยาก)
          การ์ดค่าการโทรกินความกว้าง 2 ช่อง เพราะเป็นฟอร์มที่มีช่องกรอก 3 ช่องเรียงกัน
          ถ้าบีบเท่าการ์ดอื่นช่องกรอกจะแคบจนพิมพ์เลข 3 หลักไม่เห็น */}
      {/* items-stretch (ไม่ใช่ items-start) = การ์ดทุกใบสูงเท่ากันตามใบที่สูงสุดในแถว
          เดิมใช้ items-start การ์ดจึงสูงตามเนื้อหาของตัวเอง ได้ขอบล่างไม่ตรงกันเป็นขั้นบันได */}
      <p className="font-mono text-micro tracking-[0.12em] text-ink-2 uppercase">{T.sys_section_hw}</p>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(320px,100%),1fr))] items-stretch gap-3.5">
        <Card className="flex min-w-0 flex-col gap-3 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <TowerIcon className="size-5 shrink-0 text-ink-2" />
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

          {/* mt-auto ดันปุ่มลงชิดขอบล่างการ์ด — การ์ดทุกใบสูงเท่ากันแล้ว ถ้าไม่ดันลง
              ปุ่มจะลอยอยู่กลางการ์ดโดยมีที่ว่างห้อยอยู่ข้างใต้ */}
          <div className="mt-auto flex flex-col gap-1.5 pt-1">
            <Btn
              className="self-start"
              disabled={!gsm?.connected || gsm.restarting}
              onClick={() => setConfirmRestart(true)}
            >
              {gsm?.restarting ? (
                <span className="flex items-center gap-2">
                  <RefreshIcon className="size-4 animate-spin" />
                  {T.gsm_restarting}
                </span>
              ) : (
                <span className="flex items-center gap-2">
                  <RefreshIcon className="size-4" />
                  {T.gsm_restart}
                </span>
              )}
            </Btn>
            <p className="text-micro leading-[1.6] text-ink-2">{T.gsm_restart_hint}</p>
          </div>
        </Card>

        <Card className="flex min-w-0 flex-col gap-3 p-4">
          <div className="flex items-center gap-2">
            {/* ไอคอนเต้นเบาๆ ตามจังหวะ = บอกว่าค่าที่เห็นเป็นของสดที่รีเฟรชอยู่ ไม่ใช่ค่าค้างจากตอนเปิดหน้า */}
            <PiIcon className="size-5 shrink-0 animate-soft-pulse text-ink-2" />
            <h2 className="text-lead font-bold">{T.sys_pi_title}</h2>
          </div>
          {/* แถบมิเตอร์แทนตัวเลขล้วน — ตัวเลข 64.9% ต้องอ่านแล้วตีความเองว่าเยอะไหม
              แต่แถบที่เต็มไป 2 ใน 3 กับเปลี่ยนเป็นสีส้มบอกได้ในแวบเดียวโดยไม่ต้องคิด */}
          <div className="flex flex-col gap-3">
            <Meter
              label={T.pi_cpu_label}
              value={pi?.cpu_percent ?? null}
              text={pi ? `${pi.cpu_percent}%` : '—'}
            />
            <Meter
              label={T.pi_ram_label}
              value={pi?.mem_percent ?? null}
              text={pi ? `${pi.mem_percent}% · ${pi.mem_used_mb}/${pi.mem_total_mb} MB` : '—'}
            />
            <Meter
              label={T.pi_temp_label}
              // Pi เริ่มลดความเร็ว CPU เองที่ 80°C — ใช้เป็นเพดานของแถบ ค่าที่เห็นจึงบอกได้ว่า
              // "ใกล้จุดที่เครื่องจะเริ่มช้าลงหรือยัง" ไม่ใช่แค่ตัวเลของศาที่ไม่มีบริบท
              value={pi?.cpu_temp_c != null ? (pi.cpu_temp_c / 80) * 100 : null}
              text={pi?.cpu_temp_c != null ? `${pi.cpu_temp_c}°C` : T.pi_temp_unavailable}
            />
          </div>
        </Card>

        <Card className="flex min-w-0 flex-col gap-3 p-4">
          <div className="flex items-center gap-2">
            <ServerIcon className="size-5 shrink-0 text-ink-2" />
            <h2 className="text-lead font-bold">{T.sys_runtime}</h2>
          </div>
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
              {/* ช่องกรอกกว้าง 90px พอดีเลข 3 หลัก — เดิมยืดเต็มคอลัมน์ในการ์ดที่กว้างทั้งหน้า
                  ได้ช่องยาวเป็นฟุตสำหรับกรอกเลขตัวเดียว ดูไม่ออกว่าต้องใส่อะไร
                  พื้นที่ที่เหลือเอาไปอธิบายว่าค่านั้นทำอะไร ซึ่งมีค่ากับคนใช้มากกว่าช่องกรอกยาวๆ */}
              <div className="flex flex-col divide-y divide-line-2">
                <ConfigRow
                  label={T.retry_count}
                  unit={T.unit_times}
                  min={0}
                  max={10}
                  value={cfg.call_retry_count}
                  onChange={(v) => set('call_retry_count', v)}
                  help={T.retry_count_help}
                  example={T.retry_count_example(cfg.call_retry_count)}
                />
                <ConfigRow
                  label={T.retry_delay}
                  unit={T.unit_seconds}
                  min={5}
                  max={300}
                  value={cfg.call_retry_delay_seconds}
                  onChange={(v) => set('call_retry_delay_seconds', v)}
                  help={T.retry_delay_help}
                  example={T.retry_delay_example(cfg.call_retry_delay_seconds)}
                />
                <ConfigRow
                  label={T.ring_timeout}
                  unit={T.unit_seconds}
                  min={10}
                  max={120}
                  value={cfg.call_ring_timeout_seconds}
                  onChange={(v) => set('call_ring_timeout_seconds', v)}
                  help={T.ring_timeout_help}
                  example={T.ring_timeout_example(cfg.call_ring_timeout_seconds)}
                />
              </div>

              {/* คิดเวลารวมให้ดูเลย — 3 ค่านี้คูณกันแล้วได้ผลลัพธ์ที่คนตั้งค่ามักคาดไม่ถึง
                  เช่น retry 2 + ดัง 25 วิ + รอ 30 วิ = กว่าจะข้ามไปเบอร์ที่ 2 ก็ 2 นาทีครึ่งแล้ว
                  ซึ่งอาจนานเกินไปมากสำหรับเหตุด่วน */}
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 rounded-control border border-line bg-surface-2 px-3.5 py-2.5">
                <span className="text-caption font-semibold">{T.call_budget_title}</span>
                <span className="font-mono text-caption text-ink-2">
                  {T.call_budget(
                    (cfg.call_retry_count + 1) * cfg.call_ring_timeout_seconds +
                      cfg.call_retry_count * cfg.call_retry_delay_seconds,
                    cfg.call_retry_count + 1,
                  )}
                </span>
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

      {/* ยืนยันก่อนรีสตาร์ท — ไม่ใช่ปุ่มกดพลาดแล้วไม่เป็นไร ระหว่างรีสตาร์ทโทรออกไม่ได้เลย
          ซึ่งถ้าเกิดเหตุพอดีช่วงนั้นคือแจ้งเตือนไม่ถึงคน */}
      <ConfirmDialog
        open={confirmRestart}
        title={T.gsm_restart_confirm_title}
        body={T.gsm_restart_confirm_body}
        confirmLabel={T.gsm_restart}
        cancelLabel={T.cancel}
        onCancel={() => setConfirmRestart(false)}
        onConfirm={async () => {
          setConfirmRestart(false);
          try {
            const res = await restartGsm();
            if (res.accepted) toast.success(T.gsm_restart_sent);
            else toast.error(res.message);
            wasRestarting.current = true; // กันพลาดกรณี poll รอบถัดไปมาช้ากว่าที่ worker ทำเสร็จ
          } catch (e) {
            toast.error(e instanceof Error ? e.message : T.error_generic);
          }
        }}
      />
    </div>
  );
}

/** กล่องยืนยันแบบง่าย — ใช้ที่เดียวในหน้านี้ จึงยังไม่ยกไปเป็น component กลาง */
function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/45 p-4"
      role="dialog"
      aria-modal="true"
      onClick={onCancel}
    >
      <div
        className="animate-fade-up flex w-full max-w-[420px] flex-col gap-3 rounded-card border border-line bg-surface p-5 shadow-card"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lead font-bold">{title}</h2>
        <p className="text-caption leading-[1.9] text-ink-2">{body}</p>
        <div className="mt-1 flex flex-wrap justify-end gap-2">
          <Btn onClick={onCancel}>{cancelLabel}</Btn>
          <Btn variant="primary" onClick={onConfirm}>
            {confirmLabel}
          </Btn>
        </div>
      </div>
    </div>
  );
}

function RefreshIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...iconBase} {...props}>
      <path d="M20.5 12a8.5 8.5 0 1 1-2.6-6.1" />
      <path d="M20.5 4.5V10h-5.5" />
    </svg>
  );
}

/* ── ชิ้นส่วนย่อย ─────────────────────────────────────────────────────────── */

/**
 * แถบมิเตอร์ของค่าที่วัดเป็นเปอร์เซ็นต์
 *
 * สีเปลี่ยนตามระดับ ไม่ได้เขียวตลอด — ตัวเลขอย่างเดียวต้องให้คนอ่านตีความเองว่า "เยอะไหม"
 * ซึ่งคนที่ไม่คุ้นกับ Pi ตอบไม่ได้ (64% ของ RAM คือปกติหรือใกล้เต็ม?) แถบสีตอบให้ทันที
 * เกณฑ์: <70 ปกติ · 70-89 เริ่มตึง · ≥90 อันตราย (ใกล้จุดที่ระบบจะเริ่มมีปัญหา)
 */
function Meter({ label, value, text }: { label: string; value: number | null; text: string }) {
  const pct = value == null ? 0 : Math.max(0, Math.min(100, value));
  const tone = value == null ? 'bg-line' : pct >= 90 ? 'bg-bad' : pct >= 70 ? 'bg-warn' : 'bg-ok';

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-2">
        <span className="text-caption text-ink-2">{label}</span>
        <span className="font-mono text-caption font-bold">{text}</span>
      </div>
      <span className="h-1.5 overflow-hidden rounded-full bg-line">
        {/* transition ให้แถบไหลไปค่าใหม่แทนการกระตุก — หน้านี้รีเฟรชทุก 2 วิ ถ้าเด้งทันที
            ทุกครั้งจะรบกวนสายตาคนที่เปิดจอค้างไว้ดูนานๆ */}
        <span
          className={cn('block h-full rounded-full transition-[width,background-color] duration-500', tone)}
          style={{ width: `${pct}%` }}
        />
      </span>
    </div>
  );
}

/**
 * หนึ่งแถวของค่าการโทร — ช่องกรอกเล็กๆ ทางซ้าย คำอธิบายทางขวา
 *
 * ตัวอย่างคำนวณจากค่าที่กรอกอยู่จริง ไม่ใช่ข้อความตายตัว — พิมพ์เลขเปลี่ยนปุ๊บประโยค
 * ตัวอย่างเปลี่ยนตาม เห็นผลของค่าที่กำลังจะบันทึกก่อนกดบันทึกจริง
 */
function ConfigRow({
  label,
  unit,
  min,
  max,
  value,
  onChange,
  help,
  example,
}: {
  label: string;
  unit: string;
  min: number;
  max: number;
  value: number;
  onChange: (v: number) => void;
  help: string;
  example: string;
}) {
  return (
    <div className="flex flex-col gap-2 py-3.5 first:pt-0 last:pb-0 sm:flex-row sm:items-start sm:gap-5">
      <div className="flex shrink-0 flex-col gap-1.5 sm:w-[190px]">
        <label className="text-caption font-semibold">{label}</label>
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={min}
            max={max}
            className={cn(inputCls, 'w-[90px] font-mono')}
            value={value}
            onChange={(e) => onChange(Number(e.target.value))}
          />
          <span className="text-caption whitespace-nowrap text-ink-2">{unit}</span>
        </div>
      </div>
      <div className="flex min-w-0 flex-col gap-1 sm:pt-6">
        <p className="text-caption leading-[1.8] text-ink-2">{help}</p>
        <p className="text-micro leading-[1.7] text-ink-2">
          <span className="font-mono">→ </span>
          {example}
        </p>
      </div>
    </div>
  );
}

/* ── ไอคอน (stroke 1.6 ชุดเดียวกับ Signal Flow Monitor) ──────────────────── */

const iconBase: SVGProps<SVGSVGElement> = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
};

function TowerIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...iconBase} {...props}>
      <path d="M12 9.5V20M9 20h6" />
      <path d="M8.8 8.4a4.4 4.4 0 0 1 6.4 0" />
      <path d="M5.9 5.6a8.6 8.6 0 0 1 12.2 0" />
      <circle cx="12" cy="7.6" r="1.15" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** บอร์ด Raspberry Pi — ชิปตรงกลางกับ header pin แถวบน */
function PiIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...iconBase} {...props}>
      <rect x="3" y="5.5" width="18" height="13" rx="2" />
      <rect x="9" y="10.5" width="6" height="5" rx="1" />
      <path d="M6 8.5h1.5M9.5 8.5H11M13 8.5h1.5M16.5 8.5H18" />
    </svg>
  );
}

function ServerIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...iconBase} {...props}>
      <rect x="3" y="4" width="18" height="7" rx="1.5" />
      <rect x="3" y="13" width="18" height="7" rx="1.5" />
      <path d="M6.5 7.5h.01M6.5 16.5h.01" />
    </svg>
  );
}
