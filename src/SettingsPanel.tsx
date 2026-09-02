import { useEffect, useRef, useState } from "react";
import { Eye, ExternalLink, Power, RefreshCw, RotateCcw, X } from "lucide-react";
import trayLogoUrl from "../build/tray-logo.svg";
import { localizedCopy, resolveAppLocale } from "../electron/localization";
import { EMPTY_CODEX_OVERVIEW } from "../electron/defaults";
import { DEFAULT_SETTINGS } from "../electron/settings";
import { GROK_SHAPES, GrokShape, StatusColorRole } from "./character-engine/types";
import { CodexOverview, GrokColor, PetSettings } from "./types";

const BODY_COLORS: Array<[GrokColor, string]> = [
  ["black", "#000000"], ["gray", "#777777"], ["brown", "#855c36"],
  ["red", "#e02135"], ["orange", "#ff6700"], ["yellow", "#ffd60a"],
  ["green", "#009957"], ["cyan", "#00a592"], ["blue", "#0e74e0"],
  ["violet", "#804ee0"], ["magenta", "#e02a88"]
];
const EYE_COLORS = ["#ffffff", "#f3efe6", "#9fc9ff", "#8ff0b0", "#ffd66b", "#ff9fca", "#ff6b78"] as const;
const STATUS_ROLES: StatusColorRole[] = ["completed", "error", "stopped", "waiting"];

export default function SettingsPanel({ systemLocale }: { systemLocale?: string }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const locale = systemLocale === undefined ? window.pet.appLocale : resolveAppLocale(systemLocale);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [overview, setOverview] = useState(EMPTY_CODEX_OVERVIEW);
  const [petVisible, setPetVisible] = useState(true);
  const [appVersion, setAppVersion] = useState("…");
  const [selectedStatusRole, setSelectedStatusRole] = useState<StatusColorRole>("completed");

  useEffect(() => {
    void window.pet.getSettings().then(setSettings);
    void window.pet.getOverview().then(setOverview);
    void window.pet.isPetVisible().then(setPetVisible);
    void window.pet.getAppVersion().then(setAppVersion);
    const offSettings = window.pet.onSettings(setSettings);
    const offOverview = window.pet.onOverview(setOverview);
    const offShown = window.pet.onSettingsShown(() => resetSettingsScroll(scrollRef.current));
    return () => { offSettings(); offOverview(); offShown(); };
  }, [systemLocale]);

  const copy = localizedCopy(locale).settings;

  const update = (patch: Partial<PetSettings>) => {
    setSettings((current) => ({ ...current, ...patch, statusColors: { ...current.statusColors, ...(patch.statusColors || {}) } }));
    void window.pet.setSettings(patch);
  };
  const preview = (patch: Partial<PetSettings>) => {
    setSettings((current) => ({ ...current, ...patch }));
    void window.pet.previewSettings(patch);
  };
  const statusText = overview.connected
    ? overview.activeCount
      ? copy.working(overview.activeCount, overview.connectionMode === "local-inference")
      : overview.connectionMode === "local-inference" ? copy.localIdle : copy.connectedIdle
    : copy.disconnected;
  const visibleTasks = uniqueTasks(overview)
    .filter((task) => !settings.activeOnly || ["receiving", "processing", "waiting-input"].includes(task.status))
    .slice(0, 3);

  return (
    <main className="settings-panel">
      <div ref={scrollRef} className="settings-scroll">
      <header className="settings-header">
        <img className="brand-mark" src={trayLogoUrl} alt="" aria-hidden="true" />
        <div className="settings-heading"><strong>Grok Bot Pet</strong><span><i className={overview.connected ? "online" : "offline"} />{statusText}</span></div>
        <button className="icon-button" onClick={() => void window.pet.closeSettingsPanel()} aria-label={copy.closeSettings}><X size={17} /></button>
      </header>

      <div className="quick-actions">
        <button onClick={() => void window.pet.togglePet().then(setPetVisible)}><Eye size={15} />{petVisible ? copy.hidePet : copy.showPet}</button>
        <button onClick={() => void window.pet.refresh()}><RefreshCw size={15} />{copy.refresh}</button>
        <button onClick={() => void window.pet.openCodex()}><ExternalLink size={15} />{copy.openCodex}</button>
      </div>

      <section className="task-overview">
        <div className="task-overview-title"><strong>{overview.activeCount > 0 ? copy.inProgress : copy.recentTasks}</strong><div><span>{visibleTasks.length ? copy.taskCount(visibleTasks.length) : copy.noTasks}</span><button className={settings.activeOnly ? "selected" : ""} onClick={() => update({ activeOnly: !settings.activeOnly })}>{copy.activeOnly}</button></div></div>
        {visibleTasks.length > 0 ? <div className="task-list">
          {visibleTasks.map((task) => <div className={`task-row ${task.threadId === overview.selectedTask?.threadId ? "selected" : ""}`} key={task.threadId}>
            <i className={`task-dot status-${task.status}`} />
            <div><strong>{task.title}</strong><small>{task.cwd || copy.missingCwd}</small></div>
            <span>{taskStatus(task.status, copy.taskStatuses)}</span>
          </div>)}
        </div> : <div className="empty-tasks">{settings.activeOnly ? copy.noActiveTasks : copy.noRecentTasks}</div>}
      </section>

      <div className="settings-content">
        <section className="settings-section">
          <h2>{copy.appearance}</h2>
          <RangeRow label={copy.characterSize} valueLabel={`${settings.characterSize}px`} min={64} max={320} step={2} value={settings.characterSize}
            onPreview={(value) => preview({ characterSize: value })} onCommit={(value) => update({ characterSize: value })} />
          <RangeRow label={copy.opacity} valueLabel={`${Math.round(settings.opacity * 100)}%`} min={35} max={100} step={1} value={Math.round(settings.opacity * 100)}
            onPreview={(value) => preview({ opacity: value / 100 })} onCommit={(value) => update({ opacity: value / 100 })} />

          <SettingLabel>{copy.bodyColor}</SettingLabel>
          <div className="swatch-row body-swatches">
            {BODY_COLORS.map(([value, color]) => <button key={value} title={copy.colors[value]} aria-label={copy.colors[value]} className={`swatch ${settings.bodyColor === value ? "selected" : ""}`} style={{ "--swatch": color } as React.CSSProperties} onClick={() => update({ bodyColor: value })} />)}
          </div>
          <SettingLabel>{copy.eyeColor}</SettingLabel>
          <div className="swatch-row eye-swatches">
            {EYE_COLORS.map((value) => <button key={value} title={copy.eyeColors[value]} aria-label={copy.eyeColors[value]} className={`swatch ${settings.eyeColor === value ? "selected" : ""}`} style={{ "--swatch": value } as React.CSSProperties} onClick={() => update({ eyeColor: value })} />)}
          </div>

          <Toggle label={copy.statusColors} checked={settings.statusColorsEnabled} onChange={(checked) => update({ statusColorsEnabled: checked })} />
          {settings.statusColorsEnabled && <div className="status-color-picker">
            <div className="status-role-row">{STATUS_ROLES.map((role) => <button key={role} className={selectedStatusRole === role ? "selected" : ""} onClick={() => setSelectedStatusRole(role)}><i style={{ background: bodyHex(settings.statusColors[role]) }} />{copy.statusRoles[role]}</button>)}</div>
            <div className="swatch-row status-swatches">{BODY_COLORS.map(([value, color]) => <button key={value} title={copy.colors[value]} aria-label={copy.statusColorLabel(copy.statusRoles[selectedStatusRole], copy.colors[value])} className={`swatch ${settings.statusColors[selectedStatusRole] === value ? "selected" : ""}`} style={{ "--swatch": color } as React.CSSProperties} onClick={() => update({ statusColors: { ...settings.statusColors, [selectedStatusRole]: value } })} />)}</div>
          </div>}

          <Toggle label={copy.autoShape} checked={settings.autoShape} onChange={(checked) => update({ autoShape: checked })} />
          {!settings.autoShape && <div className="shape-grid">
            {GROK_SHAPES.map((shape) => <ShapeButton key={shape} shape={shape} label={copy.shapes[shape]} selected={settings.fixedShape === shape} onClick={() => update({ fixedShape: shape, autoShape: false })} />)}
          </div>}
        </section>

        <section className="settings-section">
          <h2>{copy.behavior}</h2>
          <Toggle label={copy.alwaysOnTop} checked={settings.alwaysOnTop} onChange={(checked) => update({ alwaysOnTop: checked })} />
          <Toggle label={copy.pointerFollowing} checked={settings.pointerFollowing} onChange={(checked) => update({ pointerFollowing: checked })} />
          <Toggle label={copy.clickInteractions} checked={settings.clickInteractions} onChange={(checked) => update({ clickInteractions: checked })} />
          <Toggle label={copy.showBadge} checked={settings.showBadge} onChange={(checked) => update({ showBadge: checked })} />
          <Toggle label={copy.shadows} checked={settings.shadowsEnabled} onChange={(checked) => update({ shadowsEnabled: checked })} />
        </section>

        <section className="settings-section">
          <h2>{copy.application}</h2>
          <Toggle label={copy.launchAtLogin} checked={settings.launchAtLogin} onChange={(checked) => update({ launchAtLogin: checked })} />
        </section>

        <div className="footer-actions">
          <button onClick={() => update({ ...DEFAULT_SETTINGS, activeOnly: settings.activeOnly, launchAtLogin: settings.launchAtLogin, alwaysOnTop: settings.alwaysOnTop })}><RotateCcw size={14} />{copy.restoreDefaults}</button>
          <span className="app-version">{copy.version(appVersion)}</span>
          <button className="danger" onClick={() => void window.pet.quit()}><Power size={14} />{copy.quit}</button>
        </div>
      </div>
      </div>
    </main>
  );
}

export function resetSettingsScroll(scroll: { scrollTop: number } | null) {
  if (scroll) scroll.scrollTop = 0;
}

function RangeRow({ label, valueLabel, min, max, step, value, onPreview, onCommit }: { label: string; valueLabel: string; min: number; max: number; step: number; value: number; onPreview(value: number): void; onCommit(value: number): void }) {
  return <label className="range-row"><span>{label}<output>{valueLabel}</output></span><input type="range" min={min} max={max} step={step} value={value} onChange={(event) => onPreview(Number(event.target.value))} onPointerUp={(event) => onCommit(Number(event.currentTarget.value))} onPointerCancel={(event) => onCommit(Number(event.currentTarget.value))} onKeyUp={(event) => onCommit(Number(event.currentTarget.value))} /></label>;
}

export function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange(value: boolean): void }) {
  return <button type="button" className="toggle-row" role="switch" aria-checked={checked} onClick={() => onChange(!checked)}><span>{label}</span><i /></button>;
}

function SettingLabel({ children }: { children: React.ReactNode }) { return <div className="setting-label">{children}</div>; }

function ShapeButton({ shape, label, selected, onClick }: { shape: GrokShape; label: string; selected: boolean; onClick(): void }) {
  const path = (window.GROK_GEO?.shapes[shape] as { path?: string } | undefined)?.path;
  return <button className={selected ? "selected" : ""} title={label} onClick={onClick}>{path && <svg viewBox="-15 -15 259 259"><path d={path} /></svg>}<span>{label}</span></button>;
}

function bodyHex(color: GrokColor) { return BODY_COLORS.find(([value]) => value === color)?.[1] || "#000"; }
function taskStatus(status: string, statuses: Record<string, string>) { return statuses[status] || status; }
function uniqueTasks(overview: CodexOverview) {
  const tasks = overview.selectedTask ? [overview.selectedTask, ...overview.recentTasks] : overview.recentTasks;
  return tasks.filter((task, index) => tasks.findIndex((candidate) => candidate.threadId === task.threadId) === index);
}
