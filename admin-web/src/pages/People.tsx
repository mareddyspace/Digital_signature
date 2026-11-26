import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, ApiError, fmt, type Employee, type SignatureResult } from "../api";
import { Badge, Drawer, ErrorNote, Page, SignaturePreview, useLoad } from "../ui";

const ROLE_TEXT: Record<string, string> = { admin: "Administrator", dept_admin: "Department admin", auditor: "Auditor", employee: "Employee" };

export default function People({ me }: { me: Employee }) {
  const { data, error, reload } = useLoad(() => api<Employee[]>("/employees"));
  const [syncing, setSyncing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [held, setHeld] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [dept, setDept] = useState("");
  const [incomplete, setIncomplete] = useState(false);
  const [open, setOpen] = useState<Employee | null>(null);

  // A sync that would deactivate an unusually large share of people is held back by the
  // server (409); the admin sees why and can apply it deliberately.
  const sync = async (force = false) => {
    setSyncing(true); setSyncError(null); setNotice(null); setHeld(null);
    try {
      const r = await api<{ created: number; updated: number; deactivated: number; renamed?: number }>(
        `/directory/sync${force ? "?force=true" : ""}`, { body: {} });
      setNotice(`Directory synced: ${r.created} added, ${r.updated} updated, ${r.renamed ?? 0} with a new email address, ${r.deactivated} removed.`);
      reload();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) setHeld(e.message);
      else setSyncError((e as Error).message);
    } finally { setSyncing(false); }
  };

  const departments = useMemo(() => [...new Set((data ?? []).map((e) => e.department).filter(Boolean))].sort(), [data]);
  const rows = (data ?? []).filter((e) =>
    `${e.name} ${e.email} ${e.job_title}`.toLowerCase().includes(query.toLowerCase()) &&
    (!dept || e.department === dept) && (!incomplete || e.data_issues.length > 0));
  const issues = (data ?? []).filter((e) => e.data_issues.length).length;

  return (
    <Page
      title="People"
      intro="Everyone SignGuard creates signatures for, synced from your directory. Signatures use these details, so a gap here shows up in that person's email."
      actions={me.role === "admin" && <button className="secondary" onClick={() => sync()} disabled={syncing}>{syncing ? "Syncing…" : "Sync directory"}</button>}
    >
      <ErrorNote error={error ?? syncError} />
      {held && (
        <div className="note bad row between" role="alert">
          <span>{held.replace(" To apply it anyway, use Sync directory on the People page and confirm.", "")}</span>
          <span className="row tight">
            <button className="secondary" onClick={() => setHeld(null)}>Cancel</button>
            <button className="danger" onClick={() => sync(true)} disabled={syncing}>Apply anyway</button>
          </span>
        </div>
      )}
      {notice && <div className="note good" role="status">{notice}</div>}
      <div className="toolbar">
        <input className="search" placeholder="Search name, email or title" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search people" />
        <select value={dept} onChange={(e) => setDept(e.target.value)} aria-label="Department">
          <option value="">All departments</option>
          {departments.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
        <label className="check"><input type="checkbox" checked={incomplete} onChange={(e) => setIncomplete(e.target.checked)} /> Incomplete details only ({issues})</label>
        <span className="spacer" />
        <span className="sub">{rows.length} of {data?.length ?? 0}</span>
      </div>
      <div className="card flush">
        <table>
          <thead><tr><th>Name</th><th>Job title</th><th>Department</th><th>Phone</th><th>SignGuard role</th><th>Directory details</th></tr></thead>
          <tbody>
            {rows.map((e) => (
              <tr key={e.id} className={`clickable ${open?.id === e.id ? "selected" : ""}`} onClick={() => setOpen(e)} tabIndex={0} onKeyDown={(k) => k.key === "Enter" && setOpen(e)}>
                <td><strong>{e.name}</strong><div className="sub">{e.email}</div></td>
                <td>{e.job_title || <span className="sub">–</span>}</td>
                <td>{e.department || <span className="sub">–</span>}</td>
                <td className="nowrap">{e.phone || <span className="sub">–</span>}</td>
                <td>{ROLE_TEXT[e.role] ?? e.role}</td>
                <td>{e.data_issues.length ? e.data_issues.map((i) => <Badge key={i} tone="warn">{i}</Badge>) : <Badge tone="good">Complete</Badge>}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={6} className="sub">Nobody matches.</td></tr>}
          </tbody>
        </table>
      </div>
      {open && <PersonDrawer person={open} everyone={data ?? []} onClose={() => setOpen(null)} />}
    </Page>
  );
}

function PersonDrawer({ person, everyone, onClose }: { person: Employee; everyone: Employee[]; onClose: () => void }) {
  const [external, setExternal] = useState<SignatureResult | null>(null);
  const [internal, setInternal] = useState<SignatureResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const colleague = everyone.find((e) => e.email !== person.email)?.email ?? person.email;
    setExternal(null); setInternal(null); setError(null);
    const test = (recipients: string[]) => api<SignatureResult>("/policies/test", { body: { sender_email: person.email, recipients } });
    Promise.all([test(["someone@customer.example"]), test([colleague])])
      .then(([x, i]) => { setExternal(x); setInternal(i); })
      .catch((e: Error) => setError(e.message));
  }, [person, everyone]);

  const field = (label: string, value: string, missing?: boolean) => (
    <div><dt>{label}</dt><dd>{value || <span className={missing ? "missing" : "sub"}>{missing ? "Missing: left out of the signature" : "–"}</span>}</dd></div>
  );
  const sig = (label: string, r: SignatureResult | null) => (
    <div className="section">
      <div className="section-head"><h3 style={{ margin: 0 }}>{label}</h3>
        {r && (r.template_name ? <span className="sub"><Link to={`/signatures`}>{r.template_name}</Link> via {r.policy_name}</span> : <Badge tone="bad">No signature</Badge>)}
      </div>
      {r ? <SignaturePreview html={r.html} height={230} /> : <p className="sub">Loading…</p>}
    </div>
  );
  return (
    <Drawer title={person.name} onClose={onClose} width={680}>
      <ErrorNote error={error} />
      <dl className="facts">
        {field("Email", person.email)}
        {field("Job title", person.job_title, true)}
        {field("Department", person.department, true)}
        {field("Phone", person.phone, true)}
        {field("Mobile", person.mobile)}
        {field("Manager", person.manager_email)}
        {field("Last synced", fmt(person.synced_at))}
      </dl>
      <p className="hint">These come from your directory. To change them, update the person in Microsoft 365 or Google Workspace and sync.</p>
      {sig("To people outside the company", external)}
      {sig("To colleagues", internal)}
      <p className="hint"><Link to="/rules?tab=tester">Open the rules tester</Link> to try other recipients or delegated mailboxes.</p>
    </Drawer>
  );
}
