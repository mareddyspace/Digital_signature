import { Link } from "react-router-dom";
import { api, fmt, type AuditEvent } from "../api";
import { Badge, ErrorNote, Page, useLoad } from "../ui";

interface Summary {
  employees: number;
  employees_with_data_issues: number;
  live_templates: number;
  pending_template_approvals: number;
  pending_delegations: number;
  active_delegations: number;
  flagged_permissions: number;
  total_permissions: number;
  verifications_today: number;
  failed_verifications_today: number;
  unapproved_send_as_7d: number;
  alerts: AuditEvent[];
}

const ALERT_TEXT: Record<string, string> = {
  "verify.failed": "Someone checked a code SignGuard never issued",
  "verify.wrong_recipient": "A real code was checked by the wrong recipient",
  "signature.unapproved_send_as": "Email written from another person's mailbox without approval",
};

function Tile({ label, value, tone, to, note }: { label: string; value: number; tone?: "warn" | "bad" | "good"; to?: string; note?: string }) {
  const body = (
    <>
      <div className="tile-label">{label}</div>
      <div className={`tile-value ${tone ?? ""}`}>{value}</div>
      {note && <div className="tile-note">{note}</div>}
    </>
  );
  return to ? <Link to={to} className="tile link">{body}</Link> : <div className="tile">{body}</div>;
}

export default function TrustCenter() {
  const { data, error } = useLoad(() => api<Summary>("/trust-center"));
  return (
    <Page title="Trust Center" intro="Who can send as whom, what needs a decision, and what recipients checked today.">
      <ErrorNote error={error} />
      {data && (
        <>
          <h2 className="section">Needs attention</h2>
          <div className="tiles">
            <Tile label="Flagged mailbox permissions" value={data.flagged_permissions} tone={data.flagged_permissions ? "bad" : "good"} to="/permissions" note={`of ${data.total_permissions} grants`} />
            <Tile label="Delegations waiting for approval" value={data.pending_delegations} tone={data.pending_delegations ? "warn" : undefined} to="/delegations" />
            <Tile label="Templates waiting for approval" value={data.pending_template_approvals} tone={data.pending_template_approvals ? "warn" : undefined} to="/templates" />
            <Tile label="Unapproved send-as attempts (7 days)" value={data.unapproved_send_as_7d} tone={data.unapproved_send_as_7d ? "bad" : "good"} to="/audit" />
          </div>
          <h2 className="section">Today</h2>
          <div className="tiles">
            <Tile label="Verification checks" value={data.verifications_today} />
            <Tile label="Failed checks" value={data.failed_verifications_today} tone={data.failed_verifications_today ? "bad" : "good"} />
            <Tile label="Active delegations" value={data.active_delegations} to="/delegations" />
            <Tile label="People with incomplete details" value={data.employees_with_data_issues} tone={data.employees_with_data_issues ? "warn" : "good"} to="/people" note={`of ${data.employees} people`} />
          </div>
          <h2 className="section">Recent alerts</h2>
          {data.alerts.length === 0 ? (
            <div className="empty">No alerts. Unapproved send-as attempts and failed verification checks will appear here.</div>
          ) : (
            <table>
              <thead><tr><th>When</th><th>What happened</th><th>Who or which code</th></tr></thead>
              <tbody>
                {data.alerts.map((a) => (
                  <tr key={a.id}>
                    <td className="nowrap">{fmt(a.created_at)}</td>
                    <td><Badge tone="bad">alert</Badge> {ALERT_TEXT[a.action] ?? a.action}</td>
                    <td>{a.actor !== "public" ? `${a.actor} → ${a.target_id}` : a.target_id}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </Page>
  );
}
