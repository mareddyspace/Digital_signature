import { useState } from "react";
import { api, fmt, type Delegation, type Employee } from "../api";
import { ErrorNote, Page, StateBadge, useLoad } from "../ui";

function localInput(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const EXCHANGE_TEXT: Record<string, string> = {
  not_granted: "Not granted",
  simulated: "Granted (simulated in dev)",
  granted: "Granted in Exchange",
  removed: "Removed",
};

export default function Delegations({ me }: { me: Employee }) {
  const list = useLoad(() => api<Delegation[]>("/delegations"));
  const people = useLoad(() => api<{ email: string; name: string }[]>("/dev/users"));
  const now = new Date();
  const [form, setForm] = useState({
    delegate_email: me.email,
    owner_email: "",
    reason: "",
    starts_at: localInput(now),
    ends_at: localInput(new Date(now.getTime() + 7 * 864e5)),
  });
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const act = async (fn: () => Promise<unknown>, message: string) => {
    setError(null);
    setNotice(null);
    try {
      await fn();
      setNotice(message);
      list.reload();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const request = () =>
    act(
      () => api("/delegations", { body: { ...form, starts_at: new Date(form.starts_at).toISOString(), ends_at: new Date(form.ends_at).toISOString() } }),
      "Request sent. The mailbox owner (or an admin) must approve it.",
    );

  const canDecide = (d: Delegation) =>
    d.status === "pending" && (d.owner_email === me.email || me.role === "admin") && d.requested_by !== me.email && d.delegate_email !== me.email;
  const canRevoke = (d: Delegation) =>
    ["approved", "pending"].includes(d.status) && (me.role === "admin" || [d.owner_email, d.delegate_email].includes(me.email));

  return (
    <Page
      title="Delegations"
      intro="Sending email for someone else needs their approval and an end date. When it ends, SignGuard removes the access and the 'on behalf of' line."
    >
      <ErrorNote error={list.error ?? error} />
      {notice && <div className="note good">{notice}</div>}
      <div className="card form-grid">
        <h2 className="span">Request to send for someone</h2>
        <label>Who will send
          <select value={form.delegate_email} onChange={(e) => setForm({ ...form, delegate_email: e.target.value })} disabled={me.role !== "admin"}>
            {people.data?.map((p) => <option key={p.email} value={p.email}>{p.name}</option>)}
          </select>
        </label>
        <label>For whom (mailbox owner)
          <select value={form.owner_email} onChange={(e) => setForm({ ...form, owner_email: e.target.value })}>
            <option value="">Choose a person</option>
            {people.data?.filter((p) => p.email !== form.delegate_email).map((p) => <option key={p.email} value={p.email}>{p.name}</option>)}
          </select>
        </label>
        <label className="span">Reason<input value={form.reason} placeholder="e.g. Handle vendor emails while Arjun travels" onChange={(e) => setForm({ ...form, reason: e.target.value })} /></label>
        <label>Starts<input type="datetime-local" value={form.starts_at} onChange={(e) => setForm({ ...form, starts_at: e.target.value })} /></label>
        <label>Ends (max 90 days)<input type="datetime-local" value={form.ends_at} onChange={(e) => setForm({ ...form, ends_at: e.target.value })} /></label>
        <div className="row span"><button onClick={request} disabled={!form.owner_email || form.reason.trim().length < 3}>Send request</button></div>
      </div>
      <div className="card flush table-wrap"><table>
        <thead><tr><th>Who sends</th><th>For whom</th><th>Reason</th><th>When</th><th>Status</th><th>Exchange</th><th /></tr></thead>
        <tbody>
          {list.data?.length === 0 && <tr><td colSpan={7} className="empty">No delegations yet.</td></tr>}
          {list.data?.map((d) => (
            <tr key={d.id}>
              <td><strong>{d.delegate_name}</strong><div className="sub">{d.delegate_email}</div></td>
              <td><strong>{d.owner_name}</strong><div className="sub">{d.owner_email}</div></td>
              <td>{d.reason}<div className="sub">requested by {d.requested_by}{d.decided_by ? `, decided by ${d.decided_by}` : ""}</div></td>
              <td className="nowrap">{fmt(d.starts_at)}<div className="sub">until {fmt(d.ends_at)}</div></td>
              <td><StateBadge state={d.state} /></td>
              <td className="sub">{EXCHANGE_TEXT[d.exchange_state] ?? d.exchange_state}</td>
              <td className="nowrap">
                {canDecide(d) && (
                  <>
                    <button onClick={() => act(() => api(`/delegations/${d.id}/decide`, { body: { decision: "approve" } }), "Approved.")}>Approve</button>{" "}
                    <button className="secondary" onClick={() => act(() => api(`/delegations/${d.id}/decide`, { body: { decision: "reject" } }), "Rejected.")}>Reject</button>
                  </>
                )}
                {canRevoke(d) && !canDecide(d) && (
                  <button className="link-button danger" onClick={() => act(() => api(`/delegations/${d.id}/revoke`, { body: {} }), "Revoked.")}>Revoke</button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table></div>
    </Page>
  );
}
