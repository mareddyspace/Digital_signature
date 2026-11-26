import { useState } from "react";
import { api, type Disclaimer, type Employee } from "../api";
import { Badge, Drawer, ErrorNote, Page, Toggle, useAction, useLoad } from "../ui";

type Form = Omit<Disclaimer, "id"> & { id?: number };
const EMPTY: Form = { name: "", text: "", departments: "", recipient_type: "external", priority: 100, enabled: true };

const LIBRARY: { name: string; text: string; departments?: string }[] = [
  { name: "Confidentiality", text: "This email and any attachments are confidential and intended only for the named recipients. If you received it by mistake, please tell the sender and delete it." },
  { name: "Payment fraud warning", text: "We will never ask you to change bank details by email alone. Always confirm payment changes by phone using a number you already know.", departments: "Finance" },
  { name: "No contract by email", text: "Nothing in this email creates a binding contract unless expressly stated and signed by an authorised representative.", departments: "Legal, Sales" },
  { name: "Data protection", text: "We process personal data in line with our privacy notice. You can ask us at any time how your data is used." },
  { name: "Environment", text: "Please consider the environment before printing this email." },
];

export default function Disclaimers({ me }: { me: Employee }) {
  const list = useLoad(() => api<Disclaimer[]>("/disclaimers"));
  const [form, setForm] = useState<Form | null>(null);
  const { run, busy, Notes } = useAction(() => list.reload());
  const isAdmin = me.role === "admin";
  const set = <K extends keyof Form>(k: K, v: Form[K]) => form && setForm({ ...form, [k]: v });

  const save = () => form && run(async () => {
    const body = { ...form };
    delete body.id;
    await api(form.id ? `/disclaimers/${form.id}` : "/disclaimers", { method: form.id ? "PUT" : "POST", body });
    setForm(null);
  }, "Disclaimer saved.");

  return (
    <Page
      title="Legal disclaimers"
      intro="Disclaimers are added under signatures by rule: every enabled disclaimer whose departments and recipients match is added, in priority order. Templates can position them with a Disclaimer block."
      actions={isAdmin && <button onClick={() => setForm({ ...EMPTY })}>New disclaimer</button>}
    >
      <Notes />
      <ErrorNote error={list.error} />
      {form && (
        <Drawer title={form.id ? `Edit disclaimer: ${form.name}` : "New disclaimer"} onClose={() => setForm(null)}
          footer={<><button className="secondary" onClick={() => setForm(null)}>Cancel</button><button onClick={save} disabled={busy || !form.name.trim() || !form.text.trim()}>Save disclaimer</button></>}>
          {!form.id && (
            <div className="chips">
              <span className="sub">Start from:</span>
              {LIBRARY.map((l) => (
                <button key={l.name} type="button" className="chip" onClick={() => setForm({ ...form, name: l.name, text: l.text, departments: l.departments ?? "" })}>{l.name}</button>
              ))}
            </div>
          )}
          <div className="form-grid">
            <label className="field">Name<input value={form.name} onChange={(e) => set("name", e.target.value)} /></label>
            <label className="field">Priority (lower first)<input type="number" value={form.priority} onChange={(e) => set("priority", Number(e.target.value))} /></label>
            <label className="field">Departments (blank = all)<input value={form.departments} placeholder="Finance, Legal" onChange={(e) => set("departments", e.target.value)} /></label>
            <label className="field">Recipients
              <select value={form.recipient_type} onChange={(e) => set("recipient_type", e.target.value)}>
                <option value="external">External only</option><option value="internal">Internal only</option><option value="any">Everyone</option>
              </select>
            </label>
            <label className="field span">Text<textarea rows={4} value={form.text} onChange={(e) => set("text", e.target.value)} /></label>
            <div className="span"><Toggle label="Enabled" checked={form.enabled} onChange={(v) => set("enabled", v)} /></div>
          </div>
          <h3>Preview</h3>
          <div className="disclaimer-preview">{form.text || "Disclaimer text appears here."}</div>
        </Drawer>
      )}
      <div className="card flush"><table>
        <thead><tr><th>Disclaimer</th><th>Applies to</th><th>Priority</th><th>Status</th><th /></tr></thead>
        <tbody>
          {list.data?.map((d) => (
            <tr key={d.id}>
              <td><strong>{d.name}</strong><div className="sub clamp">{d.text}</div></td>
              <td>{d.departments || "All departments"}<div className="sub">{d.recipient_type === "any" ? "Everyone" : `${d.recipient_type} recipients`}</div></td>
              <td>{d.priority}</td>
              <td>{d.enabled ? <Badge tone="good">on</Badge> : <Badge>off</Badge>}</td>
              <td className="actions">
                {isAdmin && <>
                  <button className="link-button" onClick={() => setForm({ ...d })}>Edit</button>
                  <button className="link-button danger" onClick={() => window.confirm(`Delete "${d.name}"?`) && run(() => api(`/disclaimers/${d.id}`, { method: "DELETE" }), "Disclaimer deleted.")}>Delete</button>
                </>}
              </td>
            </tr>
          ))}
        </tbody>
      </table></div>
    </Page>
  );
}
