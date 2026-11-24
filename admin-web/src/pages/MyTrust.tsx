import { Link } from "react-router-dom";
import { api, fmt, type Delegation, type Permission } from "../api";
import { Badge, ErrorNote, Page, PERMISSION_TEXT, SignaturePreview, StateBadge, flagText, useLoad } from "../ui";

interface MyTrustData {
  me: { name: string; email: string; job_title: string; department: string };
  signature_external: string;
  signature_internal: string;
  who_can_send_as_me: Permission[];
  delegations: Delegation[];
}

export default function MyTrust() {
  const { data, error } = useLoad(() => api<MyTrustData>("/me/trust"));
  return (
    <Page title="My Trust" intro="Your signature, and everyone who can send email as you.">
      <ErrorNote error={error} />
      {data && (
        <>
          <h2 className="section">Who can send as me</h2>
          {data.who_can_send_as_me.length === 0 ? (
            <div className="empty">Nobody else has access to your mailbox.</div>
          ) : (
            <table>
              <thead><tr><th>Person</th><th>Access</th><th>Granted</th><th>Last used</th><th>Status</th></tr></thead>
              <tbody>
                {data.who_can_send_as_me.map((p) => (
                  <tr key={p.id}>
                    <td><strong>{p.trustee_name}</strong><div className="sub">{p.trustee}</div></td>
                    <td>{PERMISSION_TEXT[p.type] ?? p.type}</td>
                    <td>{fmt(p.granted_at)}</td>
                    <td>{p.last_used ? fmt(p.last_used) : "Never"}</td>
                    <td>{p.flags.length ? p.flags.map((f) => <Badge key={f} tone="bad">{flagText(f)}</Badge>) : <Badge tone="good">Approved</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="sub">Don't recognise someone? Tell your IT team. To give someone time-limited access, use <Link to="/delegations">Delegations</Link>.</p>

          <h2 className="section">My delegations</h2>
          {data.delegations.length === 0 ? (
            <div className="empty">No delegations.</div>
          ) : (
            <table>
              <thead><tr><th>Who sends</th><th>For whom</th><th>Until</th><th>Status</th></tr></thead>
              <tbody>
                {data.delegations.map((d) => (
                  <tr key={d.id}>
                    <td>{d.delegate_name}</td>
                    <td>{d.owner_name}</td>
                    <td>{fmt(d.ends_at)}</td>
                    <td><StateBadge state={d.state} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <h2 className="section">My signatures</h2>
          <div className="two">
            <div><h3>To people outside the company</h3><SignaturePreview html={data.signature_external} /></div>
            <div><h3>To colleagues</h3><SignaturePreview html={data.signature_internal} height={120} /></div>
          </div>
        </>
      )}
    </Page>
  );
}
