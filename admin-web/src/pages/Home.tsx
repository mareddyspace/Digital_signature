import { Link } from "react-router-dom";
import { api, fmt, type AuditEvent, type Brand, type Employee } from "../api";
import { ErrorNote, Page, SeverityBadge, useLoad } from "../ui";

interface Summary {
  employees: number; employees_with_data_issues: number; live_templates: number; pending_template_approvals: number;
  pending_delegations: number; active_delegations: number; flagged_permissions: number; total_permissions: number;
  verifications_today: number; failed_verifications_today: number; unapproved_send_as_7d: number; alerts: AuditEvent[];
  tampered_templates?: number; signatures_today?: number; live_campaigns?: number;
}
interface Insight { id: string; severity: string; title: string; detail: string; area: string; action: { label: string } | null }
interface Integrations {
  directory: { source: string; last_sync: string | null; employees: number };
  microsoft_365: { connected: boolean; auth_mode?: string; addin_coverage_pct?: number; addin_active_senders_7d?: number };
  google_workspace: { connected: boolean };
}
interface Matrix { rows: { department: string; cells: Record<string, { template: string | null }> }[] }

const ALERT_TEXT: Record<string, string> = {
  "verify.failed": "Someone checked a code SignGuard never issued",
  "verify.wrong_recipient": "A real code was checked by the wrong recipient",
  "signature.unapproved_send_as": "Email written from another person's mailbox without approval",
  "integrity.template_tampered": "A template changed outside approval was blocked",
  "integrity.signature_mismatch": "A received signature didn't match what was issued",
};
const AREA_LINK: Record<string, string> = {
  policies: "/rules", templates: "/signatures", campaigns: "/campaigns", directory: "/people", integrity: "/integrity",
};

export default function Home({ me }: { me: Employee }) {
  const s = useLoad(() => api<Summary>("/trust-center"));
  const auto = useLoad(() => api<{ insights: Insight[] }>("/automation").catch(() => ({ insights: [] as Insight[] })));
  const integ = useLoad(() => api<Integrations>("/integrations").catch(() => null));
  const brand = useLoad(() => api<Brand>("/brand").catch(() => null));
  const cover = useLoad(() => api<Matrix>("/assignments").catch(() => null));
  const d = s.data;

  type Item = { key: string; sev: string; title: string; detail?: string; to: string; cta: string };
  const items: Item[] = [];
  if (d) {
    if (d.tampered_templates) items.push({ key: "tamper", sev: "critical", title: `${d.tampered_templates} signature${d.tampered_templates > 1 ? "s" : ""} failed the integrity check`, detail: "Changed outside the approval workflow, so they're blocked.", to: "/integrity", cta: "Review" });
    if (d.pending_template_approvals) items.push({ key: "tpl", sev: "warning", title: `${d.pending_template_approvals} signature change${d.pending_template_approvals > 1 ? "s" : ""} waiting for approval`, detail: "Approve or reject it before it reaches email.", to: "/signatures", cta: "Review" });
    if (d.pending_delegations) items.push({ key: "del", sev: "warning", title: `${d.pending_delegations} delegation request${d.pending_delegations > 1 ? "s" : ""} to decide`, to: "/delegations", cta: "Decide" });
    if (d.flagged_permissions) items.push({ key: "perm", sev: "error", title: `${d.flagged_permissions} of ${d.total_permissions} mailbox access grants are flagged`, detail: "No approval on record, old, or never used.", to: "/permissions", cta: "Review" });
    if (d.unapproved_send_as_7d) items.push({ key: "sendas", sev: "error", title: `${d.unapproved_send_as_7d} unapproved send-as attempt${d.unapproved_send_as_7d > 1 ? "s" : ""} this week`, detail: "Someone wrote from another person's mailbox without a delegation.", to: "/audit", cta: "See audit log" });
  }
  (auto.data?.insights ?? []).filter((i) => i.severity !== "info" && i.area !== "integrity").forEach((i) =>
    items.push({ key: i.id, sev: i.severity, title: i.title, detail: i.detail, to: i.action ? "/settings/automation" : AREA_LINK[i.area] ?? "/settings/automation", cta: i.action ? i.action.label : "Open" }));
  const order: Record<string, number> = { critical: 0, error: 1, warning: 2, info: 3 };
  items.sort((a, b) => order[a.sev] - order[b.sev]);

  const gaps = cover.data?.rows.filter((r) => !r.cells.external_new?.template).length ?? 0;
  const i = integ.data;
  const setup: { done: boolean; title: string; detail: string; to: string }[] = i ? [
    { done: i.directory.source !== "sample", title: "Connect your directory", detail: i.directory.source === "sample" ? "Using sample people. Connect Microsoft Entra ID or Google Workspace." : `Synced from ${i.directory.source === "graph" ? "Microsoft Entra ID" : "Google Workspace"} · ${fmt(i.directory.last_sync)}`, to: "/settings/integrations" },
    { done: !!(brand.data?.logo_url && brand.data?.website), title: "Complete the brand kit", detail: brand.data?.logo_url ? "Logo and website set" : "Add your logo, website and social links", to: "/settings/brand" },
    { done: gaps === 0, title: "Give every department an external signature", detail: gaps ? `${gaps} department${gaps > 1 ? "s" : ""} have none` : "Every department is covered", to: "/rules?tab=coverage" },
    { done: (i.microsoft_365.addin_coverage_pct ?? 0) >= 80, title: "Deploy the Outlook add-in", detail: `${i.microsoft_365.addin_active_senders_7d ?? 0} people used it in the last 7 days (${i.microsoft_365.addin_coverage_pct ?? 0}%)`, to: "/settings/integrations" },
    { done: i.microsoft_365.auth_mode === "entra", title: "Turn on Entra ID sign-in", detail: i.microsoft_365.auth_mode === "entra" ? "On" : "Development sign-in is on: anyone can act as anyone", to: "/settings/integrations" },
  ] : [];
  const done = setup.filter((x) => x.done).length;

  return (
    <Page title={`Home`} intro={`Signed in as ${me.name}. What needs a decision, and how far your rollout has got.`}>
      <ErrorNote error={s.error} />
      {d && (
        <div className="stats">
          <div className="stat"><div className="stat-label">Signatures served today</div><div className="stat-value">{d.signatures_today ?? 0}</div></div>
          <div className="stat"><div className="stat-label">Verification checks today</div><div className="stat-value">{d.verifications_today}</div><div className="stat-note">{d.failed_verifications_today} failed</div></div>
          <div className="stat"><div className="stat-label">Live signatures</div><div className="stat-value">{d.live_templates}</div></div>
          <div className="stat"><div className="stat-label">Live campaigns</div><div className="stat-value">{d.live_campaigns ?? 0}</div></div>
          <div className="stat"><div className="stat-label">People</div><div className="stat-value">{d.employees}</div><div className="stat-note">{d.employees_with_data_issues} with incomplete details</div></div>
        </div>
      )}
      <div className="two-wide">
        <div className="card flush">
          <div className="card-head"><h2>Needs attention</h2><span className="sub">{items.length} item{items.length === 1 ? "" : "s"}</span></div>
          {items.length === 0 ? <div className="card-body sub">Nothing needs a decision right now.</div> : (
            <ul className="attention">
              {items.slice(0, 10).map((x) => (
                <li key={x.key}>
                  <SeverityBadge severity={x.sev} />
                  <div><strong>{x.title}</strong>{x.detail && <div className="sub">{x.detail}</div>}</div>
                  <Link to={x.to} className="btn secondary small">{x.cta}</Link>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="card flush">
          <div className="card-head"><h2>Rollout</h2>{setup.length > 0 && <span className="sub">{done} of {setup.length} done</span>}</div>
          {setup.length > 0 && <div className="progress" aria-label={`${done} of ${setup.length} steps done`}><span style={{ width: `${(100 * done) / setup.length}%` }} /></div>}
          {d && auto.data && !integ.data && <div className="card-body sub">Rollout status isn't available. Restart the backend to load it.</div>}
          <ul className="checklist">
            {setup.map((x) => (
              <li key={x.title} className={x.done ? "done" : ""}>
                <span className="check-mark" aria-label={x.done ? "Done" : "Not done"}>{x.done ? "✓" : ""}</span>
                <div><Link to={x.to}><strong>{x.title}</strong></Link><div className="sub">{x.detail}</div></div>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="section card flush">
        <div className="card-head"><h2>Recent security alerts</h2><Link to="/audit">Audit log</Link></div>
        {d && d.alerts.length === 0 ? <div className="card-body sub">No alerts. Unapproved send-as attempts and failed checks appear here.</div> : (
          <table>
            <thead><tr><th>When</th><th>What happened</th><th>Who or which code</th></tr></thead>
            <tbody>
              {d?.alerts.map((a) => (
                <tr key={a.id}>
                  <td className="nowrap">{fmt(a.created_at)}</td>
                  <td>{ALERT_TEXT[a.action] ?? a.action}</td>
                  <td className="sub">{a.actor !== "public" && a.actor !== "system" ? `${a.actor} → ${a.target_id}` : a.target_id}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Page>
  );
}
