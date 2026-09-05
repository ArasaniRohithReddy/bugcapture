/** Shared React hooks and small components used by all extension pages. */
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  DEFAULT_SETTINGS,
  getSettings,
  onSettingsChanged,
  saveSettings,
} from '../../core/settings';
import type { Settings } from '../../core/types';

/** Load settings and keep them in sync with other extension pages. */
export function useSettings(): {
  settings: Settings;
  loaded: boolean;
  update: (updater: (current: Settings) => Settings) => Promise<void>;
} {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    void getSettings().then((value) => {
      setSettings(value);
      setLoaded(true);
    });
    return onSettingsChanged(setSettings);
  }, []);

  const update = useCallback(async (updater: (current: Settings) => Settings) => {
    const current = await getSettings();
    const next = updater(current);
    setSettings(next);
    await saveSettings(next);
  }, []);

  return { settings, loaded, update };
}

/** Apply the theme preference to the document element. */
export function useTheme(theme: Settings['theme']): void {
  useEffect(() => {
    if (theme === 'system') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);
}

export function Toggle({
  label,
  checked,
  onChange,
  hint,
  disabled,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  hint?: string;
  disabled?: boolean;
}) {
  return (
    <div className="field">
      <label className="toggle">
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(event) => onChange(event.target.checked)}
        />
        <span>{label}</span>
      </label>
      {hint ? <p className="hint">{hint}</p> : null}
    </div>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="field">
      <label>
        <span>{label}</span>
        {children}
      </label>
      {hint ? <p className="hint">{hint}</p> : null}
    </div>
  );
}

export function Dialog({
  title,
  children,
  onClose,
  footer,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  footer?: ReactNode;
}) {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div className="dialog-backdrop" onMouseDown={onClose}>
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="spread">
          <h2>{title}</h2>
          <button type="button" className="ghost" onClick={onClose} aria-label="Close dialog">
            ✕
          </button>
        </div>
        {children}
        {footer ? (
          <div className="row" style={{ justifyContent: 'flex-end', marginTop: 16 }}>
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function Tabs<T extends string>({
  tabs,
  active,
  onChange,
}: {
  tabs: Array<{ id: T; label: string; count?: number }>;
  active: T;
  onChange: (id: T) => void;
}) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={tab.id === active}
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
          {tab.count === undefined ? null : <span className="badge"> {tab.count}</span>}
        </button>
      ))}
    </div>
  );
}
