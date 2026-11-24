import { useEffect, useState } from "react";
import { api, fmt, type Employee } from "../api";
import { ErrorNote, Page, SignaturePreview, StateBadge, useLoad } from "../ui";

interface Template {
  id: number;
  name: string;
  description: string;
  live_version: number | null;
  live_html: string | null;
  latest: { id: number; number: number; status: string; html: string; created_by: string; created_at: string } | null;
}

interface Version { id: number; number: number; status: string; created_by: string; created_at: string; decided_by: string | null; decided_at: string | null }

const PLACEHOLDERS = ["name", "job_title", "department", "phone", "mobile", "email", "company", "verification_code", "verify_url", "on_behalf_of", "on_behalf_title"];

export default function Templates({ me }: { me: Employee }) {
  const templates = useLoad(() => api<Template[]>("/templates"));
  const people = useLoad(() => api<Employee[]>("/employees"));
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [html, setHtml] = useState("");
  const [previewAs, setPreviewAs] = useState(me.email);
  const [onBehalf, setOnBehalf] = useState("");
  const [preview, setPreview] = useState<{ html: string; problems: string[] } | null>(null);
  const [versions, setVersions] = useState<Version[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");

  const canEdit = me.role === "admin" || me.role === "dept_admin";
  const selected = templates.data?.find((t) => t.id === selectedId) ?? null;

  useEffect(() => {
    if (!selectedId && templates.data?.length) setSelectedId(templates.data[0].id);
  }, [templates.data, selectedId]);

  useEffect(() => {
    if (!selected) return;
    setHtml(selected.latest?.html ?? selected.live_html ?? "");
    api<Version[]>(`/templates/${selected.id}/versions`).then(setVersions).catch(() => setVersions([]));
    // Reset only when switching template or after a save changes the latest version.
  }, [selected?.id, selected?.latest?.id, selected?.latest?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!html) return;
    const t = setTimeout(() => {
      api<{ html: string; problems: string[] }>("/templates/preview", { body: { html, employee_email: previewAs, on_behalf_of_email: onBehalf || null } })
        .then(setPreview)
        .catch((e: Error) => setPreview({ html: "", problems: [e.message] }));
    }, 300);
    return () => clearTimeout(t);
  }, [html, previewAs, onBehalf]);

  const act = async (fn: () => Promise<unknown>, message: string) => {
    setError(null);
    setNotice(null);
    try {
      await fn();
      setNotice(message);
      templates.reload();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const create = () =>
    act(async () => {
      const t = await api<Template>("/templates", { body: { name: newName, html: selected?.live_html ?? "<table><tr><td>{{name}}</td></tr></table>" } });
      setSelectedId(t.id);
      setCreating(false);
      setNewName("");
    }, "Template created as a draft.");

  const latest = selected?.latest;
  const dirty = latest ? html !== latest.html : false;
  const isPending = latest?.status === "pending";

  return (
    <Page
      title="Signature templates"
      intro="Every change is a new version. A second admin must approve it before it reaches anyone's email."
      actions={canEdit && <button className="secondary" onClick={() => setCreating(!creating)}>New template</button>}
    >
      <ErrorNote error={templates.error ?? error} />
      {notice && <div className="note good">{notice}</div>}
      {creating && (
        <div className="card row">
          <input placeholder="Template name, e.g. Sales external" value={newName} onChange={(e) => setNewName(e.target.value)} />
          <button onClick={create} disabled={!newName.trim()}>Create</button>
        </div>
      )}
      <div className="split">
        <div className="list">
          {templates.data?.map((t) => (
            <button key={t.id} className={`list-item ${t.id === selectedId ? "selected" : ""}`} onClick={() => setSelectedId(t.id)}>
              <strong>{t.name}</strong>
              <span className="sub">{t.live_version ? `Live: version ${t.live_version}` : "Not live yet"}</span>
              {t.latest && t.latest.status !== "live" && <StateBadge state={t.latest.status} />}
            </button>
          ))}
        </div>
        {selected && (
          <div className="editor">
            <div className="editor-head">
              <h2>{selected.name}</h2>
              {latest && <span>Version {latest.number} <StateBadge state={latest.status} /> by {latest.created_by}</span>}
            </div>
            {isPending && (
              <div className="note warn">
                Version {latest!.number} is waiting for approval.
                {me.role === "admin" && latest!.created_by !== me.email ? (
                  <span className="inline-actions">
                    <button onClick={() => act(() => api(`/templates/${selected.id}/decide`, { body: { decision: "approve" } }), "Approved: this version is now live.")}>Approve</button>
                    <button className="secondary" onClick={() => act(() => api(`/templates/${selected.id}/decide`, { body: { decision: "reject" } }), "Rejected.")}>Reject</button>
                  </span>
                ) : (
                  <span> {latest!.created_by === me.email ? "Another admin must approve your change." : "An admin must approve it."}</span>
                )}
              </div>
            )}
            <label htmlFor="html">Template HTML <span className="sub">Use tables and inline styles; Outlook ignores most CSS.</span></label>
            <textarea id="html" value={html} onChange={(e) => setHtml(e.target.value)} readOnly={!canEdit || isPending} spellCheck={false} rows={14} />
            <div className="chips">
              {PLACEHOLDERS.map((p) => (
                <code key={p}>{`{{${p}}}`}</code>
              ))}
            </div>
            {canEdit && !isPending && (
              <div className="row">
                <button
                  disabled={!dirty}
                  onClick={() => act(() => api(`/templates/${selected.id}`, { method: "PUT", body: { html } }), "Draft saved.")}
                >
                  Save draft
                </button>
                <button
                  className="secondary"
                  disabled={dirty || latest?.status !== "draft"}
                  onClick={() => act(() => api(`/templates/${selected.id}/submit`, { body: {} }), "Submitted for approval.")}
                >
                  Submit for approval
                </button>
              </div>
            )}
            <div className="preview-head">
              <h3>Preview</h3>
              <select value={previewAs} onChange={(e) => setPreviewAs(e.target.value)} aria-label="Preview for">
                {people.data?.map((p) => <option key={p.email} value={p.email}>{p.name}</option>)}
              </select>
              <select value={onBehalf} onChange={(e) => setOnBehalf(e.target.value)} aria-label="On behalf of">
                <option value="">Not sending for anyone</option>
                {people.data?.filter((p) => p.email !== previewAs).map((p) => <option key={p.email} value={p.email}>On behalf of {p.name}</option>)}
              </select>
            </div>
            {preview?.problems.length ? <div className="note warn">{preview.problems.join(" · ")}</div> : null}
            <SignaturePreview html={preview?.html ?? ""} />
            <h3>History</h3>
            <table>
              <thead><tr><th>Version</th><th>Status</th><th>Written by</th><th>Decided by</th></tr></thead>
              <tbody>
                {versions.map((v) => (
                  <tr key={v.id}>
                    <td>{v.number}</td>
                    <td><StateBadge state={v.status} /></td>
                    <td>{v.created_by}<div className="sub">{fmt(v.created_at)}</div></td>
                    <td>{v.decided_by ?? "–"}<div className="sub">{v.decided_at ? fmt(v.decided_at) : ""}</div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Page>
  );
}
