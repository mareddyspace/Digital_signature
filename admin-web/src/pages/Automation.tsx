import { useState } from "react";
import { api, type Employee } from "../api";
import { Badge, ErrorNote, Page, SeverityBadge, Skeleton, Toggle, useAction, useLoad } from "../ui";

interface Insight {
  id: string;
  severity: "critical" | "error" | "warning" | "info";
  title: string;
  detail: string;
  area: string;
  action: { type: string; label: string; [k: string]: unknown } | null;
}
interface Switch { key: string; label: string; enabled: boolean; locked: boolean }
interface State { insights: Insight[]; switches: Switch[]; summary: Record<string, number> }

interface Approval { mode: "two_admins" | "one_admin" | "off"; modes: Record<string, string> }
const MODE_TITLE: Record<string, string> = { two_admins: "Two admins", one_admin: "One admin", off: "No approval" };

export default function Automation({ me }: { me: Employee }) {
  const state = useLoad(() => api<State>("/automation"));
  const approval = useLoad(() => api<Approval>("/settings/approval"));
  const [pendingMode, setPendingMode] = useState<string | null>(null);
  const saveMode = (k: string) => run(() => api("/settings/approval", { method: "PUT", body: { mode: k } }).then(() => { setPendingMode(null); return approval.reload(); }), "Approval setting saved.");
  const { run, busy, Notes } = useAction(() => state.reload());
  const isAdmin = me.role === "admin";
  const s = state.data?.summary ?? {};

  return (
    <Page
      title="Automation and approvals"
      intro="SignGuard watches your policies, templates, banners and directory, explains what's wrong and fixes it with one click. Scheduled jobs run every minute."
      actions={isAdmin && <button className="secondary" disabled={busy} onClick={() => run(async () => {
        const r = await api<{ campaigns_ended: number; policies_created: number }>("/automation/run", { body: {} });
        return r;
      }, "Scheduled jobs ran.")}>Run jobs now</button>}
    >
      <Notes />
      <ErrorNote error={state.error} />
      <div className="two-wide">
        <div>
          <div className="section-head"><h2>Findings</h2><span className="sub">{["critical", "error", "warning", "info"].filter((k) => s[k]).map((k) => `${s[k]} ${k}`).join(" · ") || "None"}</span></div>
          {state.data?.insights.length === 0 && <div className="empty">Everything looks right.</div>}
          <div className="insights">
            {state.data?.insights.map((f) => (
              <div key={f.id} className={`insight ${f.severity}`}>
                <div className="insight-main">
                  <div className="row tight"><SeverityBadge severity={f.severity} /><Badge>{f.area}</Badge></div>
                  <strong>{f.title}</strong>
                  <p>{f.detail}</p>
                </div>
                {f.action && isAdmin && (
                  <button className="secondary" disabled={busy} onClick={() => run(async () => {
                    await api("/automation/apply", { body: { action: f.action } });
                  }, "Done.")}>{f.action.label}</button>
                )}
              </div>
            ))}
          </div>
        </div>
        <div>
          <div className="card">
            <h2>Signature approvals</h2>
            <p className="sub" style={{ marginTop: 4 }}>Who must approve a signature change before it reaches email. Every change of this setting is recorded in the audit log.</p>
            <ErrorNote error={approval.error} />
            <div role="radiogroup" aria-label="Signature approvals" style={{ marginTop: 12 }}>
              {approval.data && Object.entries(approval.data.modes).map(([k, text]) => (
                <label key={k} className="radio-card">
                  <input type="radio" name="approval" checked={approval.data!.mode === k} disabled={!isAdmin || busy}
                    onChange={() => (k === "two_admins" ? saveMode(k) : setPendingMode(k))} />
                  <span><strong>{MODE_TITLE[k] ?? k}{k === "two_admins" && " (recommended)"}</strong><small>{text}</small></span>
                </label>
              ))}
              {!approval.data && !approval.error && <Skeleton lines={3} height={40} />}
            </div>
            {pendingMode && (
              <div className="note warn" role="alert" style={{ marginTop: 12 }}>
                <strong>Switch to “{MODE_TITLE[pendingMode]}”?</strong> {pendingMode === "off"
                  ? "Signature changes will go live the moment they are submitted, without anyone checking them."
                  : "Admins will be able to approve their own signature changes."}
                <div className="row tight" style={{ marginTop: 8 }}>
                  <button className="small" disabled={busy} onClick={() => saveMode(pendingMode)}>Switch</button>
                  <button className="secondary small" disabled={busy} onClick={() => setPendingMode(null)}>Keep current setting</button>
                </div>
              </div>
            )}
          </div>
          <div className="card">
            <h2>Automatic rules</h2>
            {state.data?.switches.map((sw) => (
              <div key={sw.key} className="switch-row">
                <Toggle label={sw.label} checked={sw.enabled} disabled={!isAdmin || sw.locked || busy}
                  onChange={(v) => run(() => api("/automation/switches", { method: "PUT", body: { key: sw.key, enabled: v } }), "Saved.")} />
              </div>
            ))}
            <p className="sub">Pushing to Google Workspace on approval needs a connected service account (see Integrations).</p>
          </div>
          <div className="card">
            <h2>Always on</h2>
            <ul className="plain">
              <li>Delegations end on their end date and lose send-on-behalf.</li>
              <li>External email always gets the verification code where the template has one.</li>
              <li>Every approved template version is sealed; a changed one is never used.</li>
              <li>Banners and disclaimers follow department and recipient rules on every email.</li>
            </ul>
          </div>
        </div>
      </div>
    </Page>
  );
}
