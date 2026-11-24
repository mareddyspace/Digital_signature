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

export function Page({ title, intro, actions, children }: { title: string; intro?: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="page">
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
