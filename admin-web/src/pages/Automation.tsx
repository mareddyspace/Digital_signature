import { api, type Employee } from "../api";
import { Badge, ErrorNote, Page, SeverityBadge, Toggle, useAction, useLoad } from "../ui";

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

export default function Automation({ me }: { me: Employee }) {
  const state = useLoad(() => api<State>("/automation"));
  const { run, busy, Notes } = useAction(() => state.reload());
  const isAdmin = me.role === "admin";
  const s = state.data?.summary ?? {};

  return (
    <Page
      title="Automation"
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
