import { useState } from "react";
import { api, fmt, type Campaign, type Employee } from "../api";
import { Badge, Drawer, ErrorNote, FitPreview, Page, Toggle, fromLocalInput, toLocalInput, useAction, useConfirm, useLoad } from "../ui";

type Form = Omit<Campaign, "id" | "impressions" | "clicks" | "ctr" | "state" | "preview_html"> & { id?: number };

const EMPTY: Form = {
  name: "", headline: "", body: "", cta_text: "Learn more", link_url: "", image_url: "", alt_text: "",
  background: "#11263f", text_color: "#ffffff", departments: "", recipient_type: "external",
  starts_at: null, ends_at: null, priority: 100, enabled: true,
};

const STATE_TONE: Record<string, "good" | "info" | "neutral" | "warn"> = { live: "good", scheduled: "info", ended: "neutral", disabled: "neutral" };

export default function Campaigns({ me }: { me: Employee }) {
  const [ask, confirmDialog] = useConfirm();
  const list = useLoad(() => api<Campaign[]>("/campaigns"));
  const [form, setForm] = useState<Form | null>(null);
  const { run, busy, Notes } = useAction(() => list.reload());
  const canEdit = me.role === "admin" || me.role === "dept_admin";

  const save = () => form && run(async () => {
    const body = { ...form };
    delete body.id;
    await api(form.id ? `/campaigns/${form.id}` : "/campaigns", { method: form.id ? "PUT" : "POST", body });
    setForm(null);
  }, form.id ? "Banner updated." : "Banner created.");

  const set = <K extends keyof Form>(k: K, v: Form[K]) => form && setForm({ ...form, [k]: v });
  const live = list.data?.filter((c) => c.state === "live").length ?? 0;
  const totalImp = list.data?.reduce((n, c) => n + c.impressions, 0) ?? 0;
  const totalClicks = list.data?.reduce((n, c) => n + c.clicks, 0) ?? 0;

  return (
    <Page
      title="Campaigns"
      intro="Add a marketing banner under signatures for the right audience and dates. SignGuard picks the first live banner that matches the sender's department and the recipients, and counts views and clicks."
      actions={canEdit && <button onClick={() => setForm({ ...EMPTY })}>New banner</button>}
    >
      <Notes />
      <ErrorNote error={list.error} />
      <div className="stats">
        <div className="stat"><div className="stat-label">Live banners</div><div className="stat-value">{live}</div></div>
        <div className="stat"><div className="stat-label">Views</div><div className="stat-value">{totalImp}</div></div>
        <div className="stat"><div className="stat-label">Clicks</div><div className="stat-value">{totalClicks}</div></div>
        <div className="stat"><div className="stat-label">Click-through rate</div><div className="stat-value">{totalImp ? ((100 * totalClicks) / totalImp).toFixed(1) : "0.0"}%</div></div>
      </div>

      {form && (
        <Drawer title={form.id ? `Edit banner: ${form.name}` : "New banner"} onClose={() => setForm(null)} width={760}
          footer={<><button className="secondary" onClick={() => setForm(null)}>Cancel</button><button onClick={save} disabled={busy || !form.name.trim()}>Save banner</button></>}>
          <h3 style={{ marginTop: 0 }}>Preview</h3>
          <BannerPreview f={form} />
          <p className="hint">Text banners show even when the recipient blocks images. Banners end automatically on their end date.</p>
          <div>
            <div className="form-grid">
              <label className="field">Name<input value={form.name} onChange={(e) => set("name", e.target.value)} /></label>
              <label className="field">Priority (lower wins)<input type="number" value={form.priority} onChange={(e) => set("priority", Number(e.target.value))} /></label>
              <label className="field span">Headline<input value={form.headline} onChange={(e) => set("headline", e.target.value)} /></label>
              <label className="field span">Supporting text<input value={form.body} onChange={(e) => set("body", e.target.value)} /></label>
              <label className="field">Button text<input value={form.cta_text} onChange={(e) => set("cta_text", e.target.value)} /></label>
              <label className="field">Link (https://)<input value={form.link_url} onChange={(e) => set("link_url", e.target.value)} /></label>
              <label className="field">Background<input type="color" value={form.background} onChange={(e) => set("background", e.target.value)} /></label>
              <label className="field">Text colour<input type="color" value={form.text_color} onChange={(e) => set("text_color", e.target.value)} /></label>
              <label className="field span">Image URL (optional, replaces the text banner)<input value={form.image_url} placeholder="https://" onChange={(e) => set("image_url", e.target.value)} /></label>
              {form.image_url && <label className="field span">Image alt text<input value={form.alt_text} onChange={(e) => set("alt_text", e.target.value)} /></label>}
              <label className="field">Departments (blank = all)<input value={form.departments} placeholder="Sales, Marketing" onChange={(e) => set("departments", e.target.value)} /></label>
              <label className="field">Recipients
                <select value={form.recipient_type} onChange={(e) => set("recipient_type", e.target.value)}>
                  <option value="external">External only</option><option value="internal">Internal only</option><option value="any">Everyone</option>
                </select>
              </label>
              <label className="field">Starts<input type="datetime-local" value={toLocalInput(form.starts_at)} onChange={(e) => set("starts_at", fromLocalInput(e.target.value))} /></label>
              <label className="field">Ends<input type="datetime-local" value={toLocalInput(form.ends_at)} onChange={(e) => set("ends_at", fromLocalInput(e.target.value))} /></label>
              <div className="span"><Toggle label="Enabled" checked={form.enabled} onChange={(v) => set("enabled", v)} /></div>
            </div>
          </div>
        </Drawer>
      )}

      <div className="campaign-grid">
        {list.data?.map((c) => (
          <article key={c.id} className="card campaign-card">
            <div className="row between">
              <strong>{c.name}</strong>
              <Badge tone={STATE_TONE[c.state] ?? "neutral"}>{c.state.charAt(0).toUpperCase() + c.state.slice(1)}</Badge>
            </div>
            <FitPreview html={c.preview_html} />
            <div className="details">
              <span>{c.departments || "All departments"}</span>
              <span>{c.recipient_type === "any" ? "Everyone" : `${c.recipient_type === "external" ? "External" : "Internal"} recipients`}</span>
              <span>{c.starts_at ? fmt(c.starts_at) : "Now"} → {c.ends_at ? fmt(c.ends_at) : "no end"}</span>
            </div>
            <div className="metrics">
              <span><b>{c.impressions}</b> views</span><span><b>{c.clicks}</b> clicks</span><span><b>{c.ctr}%</b> CTR</span>
            </div>
            {canEdit && (
              <div className="row">
                <button className="secondary" onClick={() => setForm({ ...c })}>Edit</button>
                {me.role === "admin" && (
                  <button className="link-button danger" onClick={async () => (await ask({ title: `Delete "${c.name}"?`, detail: "The banner stops appearing in signatures. Its view and click counts are kept in the audit trail.", confirm: "Delete banner", danger: true }))
                    && run(() => api(`/campaigns/${c.id}`, { method: "DELETE" }), "Banner deleted.")}>Delete</button>
                )}
              </div>
            )}
          </article>
        ))}
        {list.data?.length === 0 && <div className="empty">No banners yet.</div>}
      </div>
      {confirmDialog}
    </Page>
  );
}

function BannerPreview({ f }: { f: Form }) {
  if (f.image_url) {
    return <div className="banner-preview"><img src={f.image_url} alt={f.alt_text || f.headline} style={{ maxWidth: "100%", display: "block" }} /></div>;
  }
  return (
    <div className="banner-preview text" style={{ background: f.background, color: f.text_color }}>
      <div>
        <div style={{ fontWeight: 700, fontSize: 14 }}>{f.headline || f.name || "Headline"}</div>
        {f.body && <div style={{ fontSize: 12 }}>{f.body}</div>}
      </div>
      {f.link_url && <span className="banner-cta" style={{ background: f.text_color, color: f.background }}>{f.cta_text || "Learn more"}</span>}
    </div>
  );
}
