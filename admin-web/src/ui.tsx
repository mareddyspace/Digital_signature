import { useCallback, useEffect, useState, type ReactNode } from "react";

/** Load data from the API; reload() refetches. */
export function useLoad<T>(load: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(() => {
    setError(null);
    load().then(setData).catch((e: Error) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(reload, [reload]);
  return { data, error, reload };
}

export function Page({ title, intro, actions, children, wide }: { title: string; intro?: string; actions?: ReactNode; children: ReactNode; wide?: boolean }) {
  return (
    <section className={`page ${wide ? "wide" : ""}`}>
      <header className="page-head">
        <div>
          <h1>{title}</h1>
          {intro && <p className="intro">{intro}</p>}
        </div>
        {actions && <div className="page-actions">{actions}</div>}
      </header>
      {children}
    </section>
  );
}

export function ErrorNote({ error }: { error: string | null }) {
  return error ? <div className="note bad" role="alert">{error}</div> : null;
}

export function Badge({ tone = "neutral", children }: { tone?: "good" | "warn" | "bad" | "neutral" | "info"; children: ReactNode }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}

/** Signature HTML is shown in a sandbox so template markup can never run script here. */
export function SignaturePreview({ html, height = 190 }: { html: string; height?: number }) {
  if (!html) return <div className="empty">No signature</div>;
  return <iframe className="sig-preview" sandbox="" title="Signature preview" srcDoc={`<body style="margin:12px;background:#fff">${html}</body>`} style={{ height }} />;
}

const STATE_TONES: Record<string, "good" | "warn" | "bad" | "neutral" | "info"> = {
  active: "good", live: "good", verified: "good", approved: "good",
  pending: "warn", scheduled: "info", draft: "neutral",
  rejected: "bad", revoked: "neutral", expired: "neutral", retired: "neutral",
  completed: "good", partial: "warn", failed: "bad", running: "info", queued: "info",
};

export function StateBadge({ state }: { state: string }) {
  return <Badge tone={STATE_TONES[state] ?? "neutral"}>{state}</Badge>;
}

export const FLAG_TEXT: Record<string, string> = {
  no_approval: "No approval on record",
  unused_90_days: "Not used in 90 days",
};

export function flagText(flag: string): string {
  if (FLAG_TEXT[flag]) return FLAG_TEXT[flag];
  const m = flag.match(/^older_than_(\d+)_days$/);
  return m ? `Older than ${m[1]} days` : flag;
}

export const PERMISSION_TEXT: Record<string, string> = {
  full_access: "Full access",
  send_as: "Send as",
  send_on_behalf: "Send on behalf",
};

export function ScoreBadge({ score, grade }: { score: number; grade?: string }) {
  const tone = score >= 90 ? "good" : score >= 70 ? "info" : score >= 50 ? "warn" : "bad";
  return <Badge tone={tone}>{grade ? `${grade} · ` : ""}{score}/100</Badge>;
}

const SEVERITY_TONE: Record<string, "bad" | "warn" | "info" | "neutral"> = {
  critical: "bad", error: "bad", warning: "warn", info: "info",
};

export function SeverityBadge({ severity }: { severity: string }) {
  const text = severity.charAt(0).toUpperCase() + severity.slice(1);
  return <Badge tone={SEVERITY_TONE[severity] ?? "neutral"}>{text}</Badge>;
}

export function Toggle({ checked, onChange, label, disabled, ariaLabel }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; disabled?: boolean; ariaLabel?: string }) {
  return (
    <label className={`toggle ${disabled ? "disabled" : ""}`}>
      <input type="checkbox" role="switch" aria-label={ariaLabel} checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="toggle-track" aria-hidden="true"><span className="toggle-thumb" /></span>
      <span>{label}</span>
    </label>
  );
}

export function StatTile({ label, value, note, tone }: { label: string; value: ReactNode; note?: string; tone?: "good" | "warn" | "bad" }) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className={`stat-value ${tone ?? ""}`}>{value}</div>
      {note && <div className="stat-note">{note}</div>}
    </div>
  );
}

/** Run an action and report success or failure in one place. */
export function useAction(after?: () => void) {
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>, message?: string) => {
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      await fn();
      if (message) setNotice(message);
      after?.();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };
  const Notes = () => (
    <>
      <ErrorNote error={error} />
      {notice && <div className="note good" role="status">{notice}</div>}
    </>
  );
  return { run, busy, error, notice, Notes };
}

export function toLocalInput(value: string | null): string {
  if (!value) return "";
  const d = new Date(value.endsWith("Z") ? value : `${value}Z`);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fromLocalInput(value: string): string | null {
  return value ? new Date(value).toISOString() : null;
}

/** Right-side editing pane (CodeTwo-style). Closes on Escape or backdrop click. */
export function Drawer({ title, onClose, children, footer, width }: { title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; width?: number }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [onClose]);
  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={typeof title === "string" ? title : undefined} style={width ? { width: `min(${width}px, 100vw)` } : undefined}>
        <div className="drawer-head"><h2>{title}</h2><button className="icon" aria-label="Close" onClick={onClose}>✕</button></div>
        <div className="drawer-body">{children}</div>
        {footer && <div className="drawer-foot">{footer}</div>}
      </aside>
    </>
  );
}

/** Half-size, non-interactive rendering of a signature for lists. */
export function SignatureThumb({ html, height = 132 }: { html: string; height?: number }) {
  return (
    <div className="sig-thumb" style={{ height }}>
      {html ? <iframe sandbox="" tabIndex={-1} aria-hidden="true" title="" style={{ height: height / 0.65 }}
        srcDoc={`<!doctype html><html><body style="margin:16px;background:#fff">${html}</body></html>`} /> : <div className="sub" style={{ padding: 12 }}>No preview</div>}
    </div>
  );
}
