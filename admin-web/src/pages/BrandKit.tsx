import { useEffect, useState } from "react";
import { api, fmt, type Brand, type Employee } from "../api";
import { ErrorNote, Page, ScoreBadge, Toggle, useAction, useLoad } from "../ui";

type Report = { template_id: number; name: string; version: number; score: number; grade: string; issues: { severity: string; message: string }[] };

const SOCIAL: [keyof Brand, string][] = [
  ["linkedin_url", "LinkedIn"], ["twitter_url", "X (Twitter)"], ["facebook_url", "Facebook"],
  ["instagram_url", "Instagram"], ["youtube_url", "YouTube"],
];

export default function BrandKit({ me }: { me: Employee }) {
  const brand = useLoad(() => api<Brand>("/brand"));
  const reports = useLoad(() => api<Report[]>("/compliance/templates"));
  const [form, setForm] = useState<Brand | null>(null);
  const { run, busy, Notes } = useAction(() => reports.reload());
  const isAdmin = me.role === "admin";

  useEffect(() => { if (brand.data) setForm(brand.data); }, [brand.data]);
  if (!form) return <Page title="Brand kit"><ErrorNote error={brand.error} /></Page>;

  const set = <K extends keyof Brand>(k: K, v: Brand[K]) => setForm({ ...form, [k]: v });
  const text = (k: keyof Brand, label: string, placeholder = "", type = "text") => (
    <label className="field">{label}
      <input type={type} value={String(form[k] ?? "")} placeholder={placeholder} disabled={!isAdmin}
        onChange={(e) => set(k, (type === "number" ? Number(e.target.value) : e.target.value) as never)} />
    </label>
  );
  const colour = (k: "primary_color" | "secondary_color" | "accent_color", label: string) => (
    <label className="field">{label}
      <span className="color-field">
        <input type="color" value={form[k]} disabled={!isAdmin} onChange={(e) => set(k, e.target.value)} aria-label={label} />
        <input value={form[k]} disabled={!isAdmin} maxLength={7} onChange={(e) => set(k, e.target.value)} />
      </span>
    </label>
  );
  const save = () => {
    const { fonts: _f, updated_by: _u, updated_at: _a, ...body } = form; // eslint-disable-line @typescript-eslint/no-unused-vars
    void _f; void _u; void _a;
    return run(async () => { const b = await api<Brand>("/brand", { method: "PUT", body }); setForm(b); }, "Brand kit saved. Signatures use it from the next email.");
  };
  const palette = [form.primary_color, form.secondary_color, form.accent_color, ...form.palette.split(",").map((c) => c.trim()).filter(Boolean)];

  return (
    <Page
      title="Brand kit"
      intro="One place for logo, colours, fonts and links. Templates pull these in as placeholders, and every template is checked against these rules."
      actions={isAdmin && <button onClick={save} disabled={busy}>Save brand kit</button>}
    >
      <Notes />
      {!isAdmin && <div className="note warn">Only admins can change the brand kit.</div>}
      <div className="two-wide">
        <div>
          <div className="card">
            <h2>Identity</h2>
            <div className="form-grid">
              {text("company_name", "Company name")}
              {text("website", "Website", "https://www.example.com")}
              {text("logo_url", "Logo URL (https, PNG or JPG)", "https://cdn.example.com/logo.png")}
              {text("logo_width", "Logo width (px)", "", "number")}
              <label className="field span">Office address
                <input value={form.address} disabled={!isAdmin} onChange={(e) => set("address", e.target.value)} />
              </label>
            </div>
            {form.logo_url && (
              <div className="logo-preview"><img src={form.logo_url} alt="Logo preview" width={form.logo_width} /></div>
            )}
          </div>
          <div className="card">
            <h2>Colours and type</h2>
            <div className="form-grid">
              {colour("primary_color", "Primary")}
              {colour("secondary_color", "Secondary (text)")}
              {colour("accent_color", "Accent")}
              <label className="field">More approved colours
                <input value={form.palette} placeholder="#eaf3ff, #f4b400" disabled={!isAdmin} onChange={(e) => set("palette", e.target.value)} />
              </label>
              <label className="field">Brand font
                <select value={form.font_family} disabled={!isAdmin} onChange={(e) => set("font_family", e.target.value)}>
                  {form.fonts.map((f) => <option key={f} value={f}>{f.split(",")[0].replace(/'/g, "")}</option>)}
                </select>
              </label>
              {text("max_width", "Maximum width (px)", "", "number")}
            </div>
            <div className="swatches" aria-label="Approved palette">
              {palette.map((c, i) => <span key={`${c}-${i}`} className="swatch" style={{ background: c }} title={c}><span>{c}</span></span>)}
            </div>
            <p className="sample" style={{ fontFamily: form.font_family, color: form.secondary_color }}>
              <b style={{ color: form.primary_color }}>Priya Sharma</b> · Executive Assistant
            </p>
          </div>
          <div className="card">
            <h2>Social links</h2>
            <div className="form-grid">{SOCIAL.map(([k, label]) => <div key={k}>{text(k, label, "https://")}</div>)}</div>
            <p className="sub">Social blocks hide networks without a link.</p>
          </div>
        </div>
        <div>
          <div className="card">
            <h2>Compliance rules</h2>
            <Toggle label="Every template must include the logo" checked={form.require_logo} disabled={!isAdmin} onChange={(v) => set("require_logo", v)} />
            <Toggle label="Block submission below the minimum score" checked={form.enforce_compliance} disabled={!isAdmin} onChange={(v) => set("enforce_compliance", v)} />
            <label className="field">Minimum score: {form.min_compliance_score}
              <input type="range" min={0} max={100} step={5} value={form.min_compliance_score} disabled={!isAdmin} onChange={(e) => set("min_compliance_score", Number(e.target.value))} />
            </label>
            <p className="sub">Checks: email-safe HTML, required fields, brand colours and font, logo, width, readability and contrast, image alt text, secure links, verification code.</p>
            <p className="sub">Last changed by {form.updated_by} · {fmt(form.updated_at)}</p>
          </div>
          <div className="card">
            <h2>Live templates</h2>
            <ErrorNote error={reports.error} />
            <table>
              <thead><tr><th>Template</th><th>Score</th><th>Top issue</th></tr></thead>
              <tbody>
                {reports.data?.map((r) => (
                  <tr key={r.template_id}>
                    <td>{r.name}<div className="sub">version {r.version}</div></td>
                    <td><ScoreBadge score={r.score} grade={r.grade} /></td>
                    <td className="sub">{r.issues[0]?.message ?? "None"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="sub">Scores reflect the saved brand kit.</p>
          </div>
        </div>
      </div>
    </Page>
  );
}
