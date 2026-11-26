import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api, fmt, type AiVariant, type Design, type Employee } from "../api";
import { Badge, ErrorNote, Page, ScoreBadge, SignatureThumb, StateBadge, useLoad } from "../ui";

export interface TemplateRow {
  id: number;
  name: string;
  description: string;
  live_version: number | null;
  live_html: string | null;
  integrity: boolean | null;
  latest: { id: number; number: number; status: string; html: string; created_by: string; created_at: string; design: Design | null } | null;
}
interface Policy { id: number; name: string; template_id: number; enabled: boolean; priority: number }
interface Score { template_id: number; score: number; grade: string }

type Filter = "all" | "live" | "draft" | "pending";

export default function Signatures({ me }: { me: Employee }) {
  const templates = useLoad(() => api<TemplateRow[]>("/templates"));
  const policies = useLoad(() => api<Policy[]>("/policies"));
  const scores = useLoad(() => api<Score[]>("/compliance/templates").catch(() => [] as Score[]));
  const [previews, setPreviews] = useState<Record<number, string>>({});
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [view, setView] = useState<"large" | "compact">("large");
  const [params, setParams] = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const canEdit = me.role === "admin" || me.role === "dept_admin";
  const creating = params.get("new");
  const navigate = useNavigate();

  // Render each signature for the signed-in person (no banner or disclaimer, so the design is clear).
  useEffect(() => {
    templates.data?.forEach((t) => {
      const html = t.live_html ?? t.latest?.html;
      if (!html) return;
      api<{ html: string }>("/templates/preview", { body: { html, employee_email: me.email, with_extras: false } })
        .then((r) => setPreviews((p) => ({ ...p, [t.id]: r.html })))
        .catch(() => undefined);
    });
  }, [templates.data, me.email]);

  const usedBy = useMemo(() => {
    const m: Record<number, Policy[]> = {};
    (policies.data ?? []).forEach((p) => { (m[p.template_id] ??= []).push(p); });
    return m;
  }, [policies.data]);
  const scoreOf = (id: number) => scores.data?.find((s) => s.template_id === id);

  const rows = (templates.data ?? []).filter((t) => {
    const q = query.trim().toLowerCase();
    if (q && !`${t.name} ${t.description}`.toLowerCase().includes(q)) return false;
    const status = t.latest?.status;
    if (filter === "live") return !!t.live_version;
    if (filter === "draft") return status === "draft";
    if (filter === "pending") return status === "pending";
    return true;
  });
  const pending = (templates.data ?? []).filter((t) => t.latest?.status === "pending").length;

  const duplicate = async (t: TemplateRow) => {
    setError(null);
    try {
      const copy = await api<TemplateRow>("/templates", {
        body: { name: `${t.name} (copy)`, description: t.description, html: t.latest?.html ?? t.live_html, design: t.latest?.design ?? undefined },
      });
      navigate(`/signatures/${copy.id}`);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <Page
      title="Signatures"
      intro="Every signature design in your organisation. Rules decide who gets which one; each change is approved by a second admin before it reaches email."
      actions={canEdit && <button onClick={() => setParams({ new: "layout" })}>New signature</button>}
    >
      <ErrorNote error={templates.error ?? error} />
      {pending > 0 && filter !== "pending" && (
        <div className="note warn">{pending} signature change{pending > 1 ? "s are" : " is"} waiting for approval. <button className="link-button" onClick={() => setFilter("pending")}>Show</button></div>
      )}

      <div className="toolbar">
        <input className="search" placeholder="Search signatures" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search signatures" />
        <div className="seg" role="group" aria-label="Filter">
          {(["all", "live", "draft", "pending"] as Filter[]).map((f) => (
            <button key={f} className={filter === f ? "on" : ""} onClick={() => setFilter(f)}>
              {{ all: "All", live: "Live", draft: "Drafts", pending: "Awaiting approval" }[f]}
            </button>
          ))}
        </div>
        <span className="spacer" />
        <div className="seg" role="group" aria-label="View">
          <button className={view === "large" ? "on" : ""} onClick={() => setView("large")}>Large</button>
          <button className={view === "compact" ? "on" : ""} onClick={() => setView("compact")}>Compact</button>
        </div>
      </div>

      {view === "large" ? (
        <div className="sig-list">
          {rows.map((t) => {
            const rules = usedBy[t.id] ?? [];
            const sc = scoreOf(t.id);
            return (
              <article key={t.id} className="sig-row">
                <Link to={`/signatures/${t.id}`} className="sig-row-preview" aria-label={`Edit ${t.name}`}>
                  <SignatureThumb html={previews[t.id] ?? ""} height={150} />
                  {canEdit && <span className="sig-row-hover">Edit design</span>}
                </Link>
                <div className="sig-row-main">
                  <div className="sig-row-title">
                    <Link to={`/signatures/${t.id}`}><h2>{t.name}</h2></Link>
                    <Status t={t} />
                  </div>
                  {t.description && <p className="sub">{t.description}</p>}
                  <dl className="sig-meta">
                    <div><dt>Used by</dt><dd>
                      {rules.length ? rules.map((r) => (
                        <Link key={r.id} to={`/rules?edit=${r.id}`} className={`rule-chip ${r.enabled ? "" : "off"}`}>{r.name}</Link>
                      )) : <span className="sub">No rule sends this signature</span>}
                    </dd></div>
                    <div><dt>Editor</dt><dd>{t.latest?.design ? "Designer" : "HTML"}</dd></div>
                    <div><dt>Last change</dt><dd>{t.latest ? <>{t.latest.created_by} · {fmt(t.latest.created_at)}</> : "–"}</dd></div>
                    <div><dt>Checks</dt><dd>
                      {sc ? <ScoreBadge score={sc.score} grade={sc.grade} /> : <span className="sub">{t.live_version ? "–" : "Scored once live"}</span>}
                      {t.integrity === true && <Badge tone="good">Sealed</Badge>}
                      {t.integrity === false && <Badge tone="bad">Tampered: blocked</Badge>}
                    </dd></div>
                  </dl>
                </div>
                <div className="sig-row-actions">
                  <Link to={`/signatures/${t.id}`} className="btn secondary small">{canEdit ? "Edit" : "View"}</Link>
                  {canEdit && <button className="ghost small" onClick={() => duplicate(t)}>Duplicate</button>}
                  <Link to={`/rules?template=${t.id}`} className="btn ghost small">Rules</Link>
                </div>
              </article>
            );
          })}
          {rows.length === 0 && <div className="empty">No signatures match.</div>}
        </div>
      ) : (
        <table>
          <thead><tr><th>Signature</th><th>Status</th><th>Used by</th><th>Brand score</th><th>Last change</th><th /></tr></thead>
          <tbody>
            {rows.map((t) => {
              const sc = scoreOf(t.id);
              return (
                <tr key={t.id} className="clickable" onClick={() => navigate(`/signatures/${t.id}`)}>
                  <td><strong>{t.name}</strong><div className="sub">{t.latest?.design ? "Designer" : "HTML"}</div></td>
                  <td><Status t={t} /></td>
                  <td>{(usedBy[t.id] ?? []).length || <span className="sub">None</span>}</td>
                  <td>{sc ? <ScoreBadge score={sc.score} grade={sc.grade} /> : "–"}</td>
                  <td className="sub">{t.latest ? fmt(t.latest.created_at) : "–"}</td>
                  <td className="actions">{canEdit && <button className="ghost small" onClick={(e) => { e.stopPropagation(); duplicate(t); }}>Duplicate</button>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {creating && canEdit && (
        <NewSignature me={me} start={creating === "ai" ? "ai" : creating === "copy" ? "copy" : "layout"} templates={templates.data ?? []}
          onClose={() => setParams({})} onCreated={(id) => navigate(`/signatures/${id}`)} />
      )}
    </Page>
  );
}

function Status({ t }: { t: TemplateRow }) {
  const s = t.latest?.status;
  return (
    <span className="row tight">
      {t.live_version ? <Badge tone="good">Live · v{t.live_version}</Badge> : <Badge>Not live</Badge>}
      {s && s !== "live" && s !== "retired" && <StateBadge state={s === "pending" ? "pending" : s} />}
    </span>
  );
}

type Start = "layout" | "ai" | "copy" | "html";

function NewSignature({ me, start, templates, onClose, onCreated }: {
  me: Employee; start: Start; templates: TemplateRow[]; onClose: () => void; onCreated: (id: number) => void;
}) {
  const [mode, setMode] = useState<Start>(start);
  const [name, setName] = useState("");
  const [starters, setStarters] = useState<{ id: string; name: string; design: Design; html?: string; preview?: string }[]>([]);
  const [picked, setPicked] = useState<string>("corporate");
  const [prompt, setPrompt] = useState("");
  const [variants, setVariants] = useState<(AiVariant & { preview?: string })[]>([]);
  const [pickedAi, setPickedAi] = useState(0);
  const [engine, setEngine] = useState("");
  const [copyFrom, setCopyFrom] = useState<number>(templates[0]?.id ?? 0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const render = (html: string) =>
    api<{ html: string }>("/templates/preview", { body: { html, employee_email: me.email, with_extras: false } }).then((r) => r.html);

  useEffect(() => {
    (async () => {
      const list = await api<{ id: string; name: string; design: Design }[]>("/designer/starters");
      const full = await Promise.all(list.map(async (s) => {
        const c = await api<{ html: string }>("/designer/compile", { body: { design: s.design } });
        return { ...s, html: c.html, preview: await render(c.html) };
      }));
      setStarters(full);
    })().catch((e: Error) => setError(e.message));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const generate = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ engine: string; variants: AiVariant[] }>("/ai/signature", { body: { prompt } });
      setEngine(r.engine);
      setPickedAi(0);
      setVariants(await Promise.all(r.variants.map(async (v) => ({ ...v, preview: await render(v.html) }))));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      let body: { name: string; html: string; design?: Design; description?: string };
      if (mode === "layout") {
        const s = starters.find((x) => x.id === picked)!;
        body = { name, html: s.html!, design: s.design };
      } else if (mode === "ai") {
        const v = variants[pickedAi];
        body = { name, html: v.html, design: v.design, description: `Created from: ${prompt.slice(0, 200)}` };
      } else if (mode === "copy") {
        const t = templates.find((x) => x.id === copyFrom)!;
        body = { name, html: (t.latest?.html ?? t.live_html)!, design: t.latest?.design ?? undefined, description: t.description };
      } else {
        body = { name, html: '<table cellpadding="0" cellspacing="0" border="0" style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#1d2733;">\n<tr><td><b>{{name}}</b></td></tr>\n<tr><td>{{job_title}} | {{company}}</td></tr>\n<tr><td><a href="mailto:{{email}}">{{email}}</a></td></tr>\n</table>' };
      }
      const t = await api<TemplateRow>("/templates", { body });
      onCreated(t.id);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  const ready = name.trim() && (mode === "layout" ? starters.length > 0 : mode === "ai" ? variants.length > 0 : mode === "copy" ? !!copyFrom : true);

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <div className="modal" role="dialog" aria-modal="true" aria-label="New signature">
        <div className="drawer-head"><h2>New signature</h2><button className="icon" aria-label="Close" onClick={onClose}>✕</button></div>
        <div className="drawer-body">
          <label className="field">Name<input autoFocus value={name} placeholder="e.g. Sales external" onChange={(e) => setName(e.target.value)} /></label>
          <div className="tabs" style={{ marginTop: 16 }} role="tablist">
            {([["layout", "Start from a layout"], ["ai", "Describe it (AI)"], ["copy", "Copy a signature"], ["html", "Write HTML"]] as [Start, string][]).map(([k, label]) => (
              <button key={k} role="tab" aria-selected={mode === k} className={mode === k ? "on" : ""} onClick={() => setMode(k)}>{label}</button>
            ))}
          </div>
          <ErrorNote error={error} />
          {mode === "layout" && (
            <div className="pick-grid">
              {starters.map((s) => (
                <button key={s.id} className={`pick ${picked === s.id ? "on" : ""}`} onClick={() => setPicked(s.id)} aria-pressed={picked === s.id}>
                  <SignatureThumb html={s.preview ?? ""} height={120} />
                  <span>{s.name}</span>
                </button>
              ))}
              {starters.length === 0 && !error && <p className="sub">Loading layouts…</p>}
            </div>
          )}
          {mode === "ai" && (
            <>
              <label className="field">Describe the signature
                <textarea rows={3} value={prompt} placeholder="Modern two-column for Sales with photo, LinkedIn and a Book a demo button" onChange={(e) => setPrompt(e.target.value)} />
              </label>
              <div className="row"><button className="secondary" onClick={generate} disabled={busy || prompt.trim().length < 3}>{busy ? "Designing…" : variants.length ? "Generate again" : "Generate designs"}</button>
                {engine && <span className="sub">{engine === "claude" ? "Designed by Claude" : "Built-in design rules (set ANTHROPIC_API_KEY to use Claude)"}</span>}</div>
              <div className="pick-grid">
                {variants.map((v, i) => (
                  <button key={v.name} className={`pick ${pickedAi === i ? "on" : ""}`} onClick={() => setPickedAi(i)} aria-pressed={pickedAi === i}>
                    <SignatureThumb html={v.preview ?? ""} height={120} />
                    <span>{v.name} <ScoreBadge score={v.compliance.score} /></span>
                  </button>
                ))}
              </div>
            </>
          )}
          {mode === "copy" && (
            <label className="field">Signature to copy
              <select value={copyFrom} onChange={(e) => setCopyFrom(Number(e.target.value))}>
                {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </label>
          )}
          {mode === "html" && <p className="sub">Starts a minimal table-based template in the HTML editor. You can convert it to a designer layout later.</p>}
        </div>
        <div className="drawer-foot">
          <button className="secondary" onClick={onClose}>Cancel</button>
          <button onClick={create} disabled={busy || !ready}>Create and open</button>
        </div>
      </div>
    </>
  );
}
