import { useState } from "react";
import { api, download, fmt, type AuditEvent } from "../api";
import { ErrorNote, Page, useLoad } from "../ui";

// Labels match the sidebar names; values are action prefixes recorded by the backend.
const GROUPS = [
  ["", "Everything"],
  ["template.", "Signatures"],
  ["policy.", "Rules"],
  ["campaign.", "Campaigns"],
  ["disclaimer.", "Disclaimers"],
  ["brand.", "Brand kit"],
  ["delegation.", "Delegations"],
  ["permission", "Mailbox access"],
  ["verify.", "Verification checks"],
  ["integrity.", "Integrity"],
  ["signature.", "Signature warnings"],
  ["directory.", "Directory sync"],
  ["deployment.", "Deployments"],
  ["automation.", "Automation"],
];

export default function AuditLog() {
  const [action, setAction] = useState("");
  const list = useLoad(() => api<AuditEvent[]>(`/audit?limit=300${action ? `&action=${encodeURIComponent(action)}` : ""}`), [action]);
  const [error, setError] = useState<string | null>(null);

  return (
    <Page
      title="Audit log"
      intro="Every change, approval, delegation and verification check. Entries can't be edited or deleted."
      actions={
        <button className="secondary" onClick={() => download(`/audit.csv${action ? `?action=${encodeURIComponent(action)}` : ""}`, "signguard-audit.csv").catch((e) => setError(e.message))}>
          Export CSV
        </button>
      }
    >
      <ErrorNote error={list.error ?? error} />
      <div className="chips">
        {GROUPS.map(([value, label]) => (
          <button key={value} className={`chip ${action === value ? "selected" : ""}`} onClick={() => setAction(value)}>{label}</button>
        ))}
      </div>
      <div className="card flush table-wrap"><table>
        <thead><tr><th>When</th><th>Who</th><th>Action</th><th>On</th><th>Details</th></tr></thead>
        <tbody>
          {list.data?.map((a) => (
            <tr key={a.id}>
              <td className="nowrap">{fmt(a.created_at)}</td>
              <td>{a.actor}</td>
              <td><code>{a.action}</code></td>
              <td>{a.target_type} {a.target_id}</td>
              <td className="details">
                {Object.entries(a.details).filter(([, v]) => v !== null && v !== "").map(([k, v]) => (
                  <span key={k}>{k}: {String(v)}</span>
                ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table></div>
    </Page>
  );
}
