import { useState } from "react";
import { api, fmt, type Employee } from "../api";
import { Badge, ErrorNote, Page, useLoad } from "../ui";

export default function People() {
  const { data, error, reload } = useLoad(() => api<Employee[]>("/employees"));
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  const sync = async () => {
    setSyncing(true);
    setSyncError(null);
    try {
      await api("/directory/sync", { body: {} });
      reload();
    } catch (e) {
      setSyncError((e as Error).message);
    } finally {
      setSyncing(false);
    }
  };

  const rows = (data ?? []).filter((e) => `${e.name} ${e.email} ${e.department}`.toLowerCase().includes(filter.toLowerCase()));

  return (
    <Page
      title="People"
      intro="Synced from your directory. Signatures use these details, so gaps here show up in every email."
      actions={<button onClick={sync} disabled={syncing}>{syncing ? "Syncing…" : "Sync directory now"}</button>}
    >
      <ErrorNote error={error ?? syncError} />
      <input className="search" placeholder="Search name, email or department" value={filter} onChange={(e) => setFilter(e.target.value)} />
      <table>
        <thead><tr><th>Name</th><th>Title</th><th>Department</th><th>Phone</th><th>Role</th><th>Details</th><th>Synced</th></tr></thead>
        <tbody>
          {rows.map((e) => (
            <tr key={e.id}>
              <td><strong>{e.name}</strong><div className="sub">{e.email}</div></td>
              <td>{e.job_title || "–"}</td>
              <td>{e.department || "–"}</td>
              <td>{e.phone || "–"}</td>
              <td>{e.role.replace("_", " ")}</td>
              <td>{e.data_issues.length ? e.data_issues.map((i) => <Badge key={i} tone="warn">{i}</Badge>) : <Badge tone="good">complete</Badge>}</td>
              <td className="nowrap">{fmt(e.synced_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Page>
  );
}
