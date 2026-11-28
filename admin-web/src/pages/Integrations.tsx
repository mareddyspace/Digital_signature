import { useState } from "react";
import { api, download, fmt, type Employee } from "../api";
import { Badge, ErrorNote, Page, StateBadge, useAction, useLoad } from "../ui";

interface DeploymentRow {
  id: number; target: string; scope: string; scope_value: string; mode: string; status: string;
  total: number; succeeded: number; failed: number; created_by: string; created_at: string; finished_at: string | null;
}
interface Provider {
  connected: boolean; directory: boolean; deploy_mode: string; last_deployment: DeploymentRow | null; setup: string[];
  addin_active_senders_7d?: number; addin_coverage_pct?: number; auth_mode?: string; tenant_id?: string | null; admin_email?: string | null;
}
interface Status {
  directory: { source: string; last_sync: string | null; employees: number; last_sync_details: Record<string, number> | null };
  microsoft_365: Provider;
  google_workspace: Provider;
}
interface Detail extends DeploymentRow { items: { employee_email: string; status: string; message: string; template_name: string }[] }

const TARGET_TEXT: Record<string, string> = { microsoft_365: "Microsoft 365", google_workspace: "Google Workspace" };
const MODE_TEXT: Record<string, string> = {
  live: "Live: writes Gmail signatures",
  simulated: "Simulated: renders only (connect Google to send)",
  script: "Export for PowerShell; the Outlook add-in applies signatures per email",
};
const SOURCE_TEXT: Record<string, string> = { sample: "Sample data", graph: "Microsoft Graph (Entra ID)", google: "Google Workspace directory" };

export default function Integrations({ me }: { me: Employee }) {
  const status = useLoad(() => api<Status>("/integrations"));
  const deps = useLoad(() => api<DeploymentRow[]>("/deployments"));
  const [target, setTarget] = useState("google_workspace");
  const [scope, setScope] = useState("all");
  const [value, setValue] = useState("");
  const [detail, setDetail] = useState<Detail | null>(null);
  const { run, busy, Notes } = useAction(() => { status.reload(); deps.reload(); });
  const isAdmin = me.role === "admin";

  const deploy = () => run(async () => {
    const d = await api<DeploymentRow>("/deployments", { body: { target, scope, scope_value: value } });
    // Deployments run in the background; fetch the result after a moment.
    setTimeout(async () => { setDetail(await api<Detail>(`/deployments/${d.id}`)); deps.reload(); }, 800);
  }, "Deployment started.");

  const s = status.data;
  const card = (key: "microsoft_365" | "google_workspace", p: Provider) => (
    <div className="card integration">
      <div className="row between">
        <div className="row tight">
          <span className={`provider-mark ${key}`} aria-hidden="true">{key === "microsoft_365" ? "M" : "G"}</span>
          <h2>{TARGET_TEXT[key]}</h2>
        </div>
        {p.connected ? <Badge tone="good">Connected</Badge> : <Badge tone="warn">Not connected</Badge>}
      </div>
      <dl className="facts">
        <div><dt>Directory</dt><dd>{p.directory ? "Synced from here" : "Not the directory source"}</dd></div>
        <div><dt>Deployment</dt><dd>{MODE_TEXT[p.deploy_mode]}</dd></div>
        {key === "microsoft_365" && <>
          <div><dt>Outlook add-in</dt><dd>{p.addin_active_senders_7d ? `${p.addin_active_senders_7d} used it in real Outlook in 7 days (${p.addin_coverage_pct}%)` : "Not used in real Outlook yet"}</dd></div>
          <div><dt>Sign-in</dt><dd>{p.auth_mode === "entra" ? "Entra ID" : "Development mode"}</dd></div>
        </>}
        {key === "google_workspace" && p.admin_email && <div><dt>Admin account</dt><dd>{p.admin_email}</dd></div>}
        <div><dt>Last deployment</dt><dd>{p.last_deployment ? <>{fmt(p.last_deployment.created_at)} · <StateBadge state={p.last_deployment.status} /></> : "Never"}</dd></div>
      </dl>
      <details>
        <summary>How to connect</summary>
        <ol className="steps">{p.setup.map((x) => <li key={x}>{x}</li>)}</ol>
      </details>
    </div>
  );

  return (
    <Page title="Integrations" intro="Connect Microsoft 365 and Google Workspace, keep the directory in sync, and push signatures to every mailbox.">
      <Notes />
      <ErrorNote error={status.error ?? deps.error} />
      {s && (
        <>
          <div className="card row between">
            <div>
              <strong>Employee directory: {SOURCE_TEXT[s.directory.source] ?? s.directory.source}</strong>
              <div className="sub">{s.directory.employees} active people · last sync {fmt(s.directory.last_sync)}
                {s.directory.last_sync_details && ` · ${s.directory.last_sync_details.created ?? 0} added, ${s.directory.last_sync_details.updated ?? 0} updated, ${s.directory.last_sync_details.deactivated ?? 0} removed`}</div>
            </div>
            {isAdmin && <button className="secondary" disabled={busy} onClick={() => run(() => api("/directory/sync", { body: {} }), "Directory synced.")}>Sync now</button>}
          </div>
          <div className="two">{card("microsoft_365", s.microsoft_365)}{card("google_workspace", s.google_workspace)}</div>
        </>
      )}

      {isAdmin && (
        <div className="card section">
          <h2>Deploy signatures</h2>
          <div className="form-grid">
            <label className="field">Where
              <select value={target} onChange={(e) => setTarget(e.target.value)}>
                <option value="google_workspace">Google Workspace (Gmail)</option>
                <option value="microsoft_365">Microsoft 365 (Outlook on the web, mobile)</option>
              </select>
            </label>
            <label className="field">Who
              <select value={scope} onChange={(e) => setScope(e.target.value)}>
                <option value="all">Everyone</option><option value="department">Departments</option><option value="people">Specific people</option>
              </select>
            </label>
            {scope !== "all" && (
              <label className="field">{scope === "department" ? "Departments" : "Email addresses"}
                <input value={value} placeholder={scope === "department" ? "Sales, Finance" : "a@contoso.com, b@contoso.com"} onChange={(e) => setValue(e.target.value)} />
              </label>
            )}
          </div>
          <p className="sub">Each person gets the signature their external-email policy picks, with banner and disclaimers. Static signatures can't carry per-email verification codes; the Outlook add-in adds those.</p>
          <button onClick={deploy} disabled={busy || (scope !== "all" && !value.trim())}>Deploy</button>
        </div>
      )}

      {detail && (
        <div className="card section">
          <div className="row between">
            <h2>Deployment #{detail.id}: {TARGET_TEXT[detail.target]}</h2>
            <div className="row tight">
              <StateBadge state={detail.status} />
              {detail.target === "microsoft_365" && isAdmin && (
                <button className="secondary" onClick={() => run(() => download(`/deployments/${detail.id}/export`, `signguard-deployment-${detail.id}.json`))}>Download export</button>
              )}
              <button className="link-button" onClick={() => setDetail(null)}>Close</button>
            </div>
          </div>
          <p className="sub">{detail.succeeded} done · {detail.failed} failed · {MODE_TEXT[detail.mode]}</p>
          {detail.target === "microsoft_365" && <p className="sub">Apply with <code>workers/deploy-outlook-signatures.ps1 -ExportFile signguard-deployment-{detail.id}.json</code></p>}
          <table>
            <thead><tr><th>Person</th><th>Result</th><th>Template</th><th>Details</th></tr></thead>
            <tbody>
              {detail.items.map((i) => (
                <tr key={i.employee_email}>
                  <td>{i.employee_email}</td>
                  <td><Badge tone={i.status === "ok" ? "good" : i.status === "failed" ? "bad" : "neutral"}>{i.status}</Badge></td>
                  <td>{i.template_name || "–"}</td>
                  <td className="sub">{i.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2 className="section">History</h2>
      <div className="card flush table-wrap"><table>
        <thead><tr><th>#</th><th>Target</th><th>Scope</th><th>Mode</th><th>Result</th><th>Started</th><th /></tr></thead>
        <tbody>
          {deps.data?.map((d) => (
            <tr key={d.id}>
              <td>{d.id}</td>
              <td>{TARGET_TEXT[d.target]}</td>
              <td>{d.scope === "all" ? "Everyone" : d.scope_value}</td>
              <td>{d.mode}</td>
              <td><StateBadge state={d.status} /> <span className="sub">{d.succeeded}/{d.total}</span></td>
              <td>{fmt(d.created_at)}<div className="sub">{d.created_by}</div></td>
              <td><button className="link-button" onClick={() => run(async () => setDetail(await api<Detail>(`/deployments/${d.id}`)))}>View</button></td>
            </tr>
          ))}
          {deps.data?.length === 0 && <tr><td colSpan={7} className="sub">No deployments yet.</td></tr>}
        </tbody>
      </table></div>
    </Page>
  );
}
