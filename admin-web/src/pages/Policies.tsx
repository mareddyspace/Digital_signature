import { useState } from "react";
import { api, type Employee, type SignatureResult } from "../api";
import { Badge, ErrorNote, Page, SignaturePreview, useLoad } from "../ui";

interface Policy {
  id: number;
  name: string;
  priority: number;
  departments: string;
  recipient_type: string;
  message_type: string;
  template_id: number;
  template_name: string | null;
  enabled: boolean;
}

const EMPTY = { name: "", priority: 100, departments: "", recipient_type: "any", message_type: "any", template_id: 0, enabled: true };

export default function Policies({ me }: { me: Employee }) {
  const policies = useLoad(() => api<Policy[]>("/policies"));
  const templates = useLoad(() => api<{ id: number; name: string }[]>("/templates"));
  const people = useLoad(() => api<Employee[]>("/employees"));
  const [editing, setEditing] = useState<(typeof EMPTY & { id?: number }) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isAdmin = me.role === "admin";

  const [sender, setSender] = useState("sara.khan@contoso.com");
  const [recipients, setRecipients] = useState("buyer@fabrikam.com");
  const [messageType, setMessageType] = useState("new");
  const [result, setResult] = useState<SignatureResult | null>(null);

  const save = async () => {
    if (!editing) return;
    setError(null);
    try {
      const { id, ...body } = editing;
      await api(id ? `/policies/${id}` : "/policies", { method: id ? "PUT" : "POST", body });
      setEditing(null);
      policies.reload();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const remove = async (p: Policy) => {
    if (!confirm(`Delete the policy "${p.name}"?`)) return;
    try {
      await api(`/policies/${p.id}`, { method: "DELETE" });
      policies.reload();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const test = async () => {
    setError(null);
    try {
      setResult(await api<SignatureResult>("/policies/test", {
        body: { sender_email: sender, recipients: recipients.split(/[,;\s]+/).filter(Boolean), message_type: messageType },
      }));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <Page
      title="Signature policies"
      intro="SignGuard checks policies from the top; the first one that matches the sender's department and the recipients picks the template."
      actions={isAdmin && <button onClick={() => setEditing({ ...EMPTY, template_id: templates.data?.[0]?.id ?? 0 })}>Add policy</button>}
    >
      <ErrorNote error={policies.error ?? error} />
      {editing && (
        <div className="card form-grid">
          <label>Name<input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></label>
          <label>Order (lower runs first)<input type="number" value={editing.priority} onChange={(e) => setEditing({ ...editing, priority: Number(e.target.value) })} /></label>
          <label>Departments (comma-separated, empty = everyone)<input value={editing.departments} onChange={(e) => setEditing({ ...editing, departments: e.target.value })} /></label>
          <label>Recipients
            <select value={editing.recipient_type} onChange={(e) => setEditing({ ...editing, recipient_type: e.target.value })}>
              <option value="any">Anyone</option><option value="internal">Colleagues only</option><option value="external">Includes outside people</option>
            </select>
          </label>
          <label>Email type
            <select value={editing.message_type} onChange={(e) => setEditing({ ...editing, message_type: e.target.value })}>
              <option value="any">New or reply</option><option value="new">New email</option><option value="reply">Reply or forward</option>
            </select>
          </label>
          <label>Template
            <select value={editing.template_id} onChange={(e) => setEditing({ ...editing, template_id: Number(e.target.value) })}>
              {templates.data?.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
          <div className="row">
            <button onClick={save} disabled={!editing.name.trim()}>Save policy</button>
            <button className="secondary" onClick={() => setEditing(null)}>Cancel</button>
          </div>
        </div>
      )}
      <table>
        <thead><tr><th>Order</th><th>Policy</th><th>Who</th><th>Recipients</th><th>Email type</th><th>Template</th>{isAdmin && <th />}</tr></thead>
        <tbody>
          {policies.data?.map((p) => (
            <tr key={p.id}>
              <td>{p.priority}</td>
              <td><strong>{p.name}</strong> {!p.enabled && <Badge>off</Badge>}</td>
              <td>{p.departments || "Everyone"}</td>
              <td>{{ any: "Anyone", internal: "Colleagues only", external: "Includes outside people" }[p.recipient_type]}</td>
              <td>{{ any: "Any", new: "New", reply: "Reply or forward" }[p.message_type]}</td>
              <td>{p.template_name}</td>
              {isAdmin && (
                <td className="nowrap">
                  <button className="link-button" onClick={() => setEditing({ ...p })}>Edit</button>
                  <button className="link-button danger" onClick={() => remove(p)}>Delete</button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>

      <h2 className="section">Test a policy</h2>
      <div className="card form-grid">
        <label>Sender
          <select value={sender} onChange={(e) => setSender(e.target.value)}>
            {people.data?.map((p) => <option key={p.email} value={p.email}>{p.name} ({p.department})</option>)}
          </select>
        </label>
        <label>Recipients<input value={recipients} onChange={(e) => setRecipients(e.target.value)} /></label>
        <label>Email type
          <select value={messageType} onChange={(e) => setMessageType(e.target.value)}>
            <option value="new">New email</option><option value="reply">Reply</option>
          </select>
        </label>
        <div className="row"><button onClick={test}>Show which signature they get</button></div>
      </div>
      {result && (
        <div className="card">
          <p><strong>{result.template_name ?? "No signature"}</strong> · {result.reason}</p>
          <SignaturePreview html={result.html} />
        </div>
      )}
    </Page>
  );
}
