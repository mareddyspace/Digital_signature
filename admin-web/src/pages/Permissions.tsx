import { useState } from "react";
import { api, fmt, type Employee, type Permission } from "../api";
import { Badge, ErrorNote, Page, PERMISSION_TEXT, flagText, useLoad } from "../ui";

export default function Permissions({ me }: { me: Employee }) {
  const list = useLoad(() => api<Permission[]>("/permissions"));
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showRemoved, setShowRemoved] = useState(false);
  const isAdmin = me.role === "admin";

  const act = async (p: Permission, action: "accept" | "remove" | "convert") => {
    setError(null);
    setNotice(null);
    try {
      const r = await api<Permission & { delegation_id?: number }>(`/permissions/${p.id}/action`, { body: { action } });
      setNotice(
        action === "convert"
          ? `Delegation request #${r.delegation_id} created for ${p.trustee_name}. ${p.mailbox_name} or an admin must approve it.`
          : action === "remove"
            ? `Marked for removal. Run workers/apply-delegation.ps1 to remove it in Exchange.`
            : "Accepted as a known, approved grant.",
      );
      list.reload();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const importFile = async (file: File) => {
    setError(null);
    try {
      const rows = JSON.parse(await file.text());
      const r = await api<{ rows: number; added: number; no_longer_present: number }>("/permissions/import", { body: rows });
      setNotice(`Imported ${r.rows} grants (${r.added} new, ${r.no_longer_present} no longer present).`);
      list.reload();
    } catch (e) {
      setError(`Import failed: ${(e as Error).message}`);
    }
  };

  const rows = (list.data ?? []).filter((p) => showRemoved || p.review_state !== "removed");
  const flagged = rows.filter((p) => p.flags.length).length;

  return (
    <Page
      title="Mailbox permissions"
      intro="Everyone who can read or send from someone else's mailbox. Flagged grants have no approval in SignGuard, are old, or are never used."
      actions={
        isAdmin && (
          <label className="file-button">
            Import from Exchange
            <input type="file" accept="application/json" onChange={(e) => e.target.files?.[0] && importFile(e.target.files[0])} />
          </label>
        )
      }
    >
      <ErrorNote error={list.error ?? error} />
      {notice && <div className="note good">{notice}</div>}
      <p className="summary"><strong>{flagged}</strong> of {rows.length} grants need a decision. <label className="inline"><input type="checkbox" checked={showRemoved} onChange={(e) => setShowRemoved(e.target.checked)} /> Show removed</label></p>
      <table>
        <thead><tr><th>Mailbox</th><th>Who has access</th><th>Access</th><th>Granted</th><th>Last used</th><th>Flags</th>{isAdmin && <th>Decision</th>}</tr></thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p.id} className={p.review_state === "removed" ? "muted" : ""}>
              <td><strong>{p.mailbox_name}</strong><div className="sub">{p.mailbox}</div></td>
              <td><strong>{p.trustee_name}</strong><div className="sub">{p.trustee}</div></td>
              <td>{PERMISSION_TEXT[p.type] ?? p.type}</td>
              <td className="nowrap">{fmt(p.granted_at)}</td>
              <td className="nowrap">{p.last_used ? fmt(p.last_used) : "Never"}</td>
              <td>
                {p.review_state === "removed" ? <Badge>removed</Badge> : p.flags.length ? p.flags.map((f) => <Badge key={f} tone="bad">{flagText(f)}</Badge>) : <Badge tone="good">OK</Badge>}
              </td>
              {isAdmin && (
                <td className="nowrap">
                  {p.review_state !== "removed" && p.flags.length > 0 && (
                    <>
                      {p.type !== "full_access" && <button className="link-button" onClick={() => act(p, "convert")}>Make time-limited</button>}
                      <button className="link-button" onClick={() => act(p, "accept")}>Accept</button>
                      <button className="link-button danger" onClick={() => act(p, "remove")}>Remove</button>
                    </>
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="sub">Sample data is shown until you import real grants with <code>workers/export-mailbox-permissions.ps1</code>.</p>
    </Page>
  );
}
