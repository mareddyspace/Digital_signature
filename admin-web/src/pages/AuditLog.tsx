import { useState } from "react";
import { api, download, fmt, type AuditEvent } from "../api";
import { ErrorNote, Page, useLoad } from "../ui";

const GROUPS = [
  ["", "Everything"],
  ["delegation.", "Delegations"],
  ["template.", "Templates"],
  ["policy.", "Policies"],
  ["permission", "Permissions"],
  ["verify.", "Verification checks"],
  ["signature.", "Signature warnings"],
  ["directory.", "Directory sync"],
];

export default function AuditLog() {
  const [action, setAction] = useState("");
  const list = useLoad(() => api<AuditEvent[]>(`/audit?limit=300${action ? `&action=${encodeURIComponent(action)}` : ""}`), [action]);
  const [error, setError] = useState<string | null>(null);

  return (
    <Page
      title="Audit trail"
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
