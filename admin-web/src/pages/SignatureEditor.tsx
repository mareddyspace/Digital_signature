import "./SignatureEditor.css";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent, type ReactNode } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api, fmt, type Brand, type ComplianceReport, type Design, type DesignBlock, type BlockType, type Employee } from "../api";
import { Badge, ScoreBadge, SeverityBadge, StateBadge, useLoad } from "../ui";
import type { TemplateRow } from "./Signatures";

// ---------------------------------------------------------------- metadata

const FONTS = [
  "Arial, Helvetica, sans-serif", "Helvetica, Arial, sans-serif", "Verdana, Geneva, sans-serif",
  "Tahoma, Geneva, sans-serif", "'Segoe UI', Arial, sans-serif", "Georgia, 'Times New Roman', serif",
  "'Times New Roman', Times, serif", "'Trebuchet MS', Arial, sans-serif", "Calibri, Arial, sans-serif",
];
const TOOLBOX: { group: string; items: { type: BlockType; label: string; hint: string }[] }[] = [
  { group: "Personal fields", items: [
    { type: "name", label: "Name", hint: "Display name" },
    { type: "title", label: "Job title", hint: "Title and department" },
    { type: "contact", label: "Contact fields", hint: "Phone, mobile, email, web" },
    { type: "delegation", label: "On behalf of", hint: "Only on delegated email" },
  ] },
  { group: "Images", items: [
    { type: "logo", label: "Logo", hint: "From the brand kit" },
    { type: "photo", label: "Photo", hint: "From the directory" },
  ] },
  { group: "Company", items: [
    { type: "address", label: "Address", hint: "From the brand kit" },
    { type: "social", label: "Social links", hint: "From the brand kit" },
  ] },
  { group: "Content", items: [
    { type: "text", label: "Text", hint: "Tagline or note" },
    { type: "button", label: "Button", hint: "Call to action" },
    { type: "divider", label: "Divider", hint: "Horizontal line" },
    { type: "spacer", label: "Spacer", hint: "Vertical space" },
  ] },
  { group: "Placed by rules", items: [
    { type: "verification", label: "Verification code", hint: "External email only" },
    { type: "banner", label: "Campaign banner", hint: "Chosen per email" },
    { type: "disclaimer", label: "Disclaimers", hint: "Chosen per email" },
  ] },
];
const LABEL: Record<string, string> = Object.fromEntries(TOOLBOX.flatMap((g) => g.items.map((i) => [i.type, i.label])));
const NETWORKS: [string, string, keyof Brand][] = [
  ["linkedin", "LinkedIn", "linkedin_url"], ["twitter", "X", "twitter_url"], ["facebook", "Facebook", "facebook_url"],
  ["instagram", "Instagram", "instagram_url"], ["youtube", "YouTube", "youtube_url"],
];
const CONTACT = ["phone", "mobile", "email", "website"];
const NEW_KEY = "application/x-signguard-new";
const MOVE_KEY = "application/x-signguard-move";
const PLACEHOLDERS = ["name", "job_title", "department", "phone", "mobile", "email", "company", "logo_url", "website",
  "website_label", "address", "linkedin_url", "verification_code", "verify_url", "on_behalf_of", "on_behalf_title"];

let seq = 0;
const newId = () => `b${Date.now().toString(36)}${(seq++).toString(36)}`;

// ---------------------------------------------------------------- history (undo/redo)

function useHistory(initial: Design | null) {
  const [state, setState] = useState<{ past: Design[]; now: Design | null; future: Design[] }>({ past: [], now: initial, future: [] });
  const last = useRef<{ key: string; at: number }>({ key: "", at: 0 });
  /** Typing in one field within a second counts as one undo step. */
  const commit = useCallback((d: Design, key = "") => {
    setState((s) => {
      const t = Date.now();
      const coalesce = key && last.current.key === key && t - last.current.at < 1000;
      last.current = { key, at: t };
      if (!s.now) return { past: [], now: d, future: [] };
      return { past: coalesce ? s.past : [...s.past.slice(-49), s.now], now: d, future: [] };
    });
  }, []);
  const reset = useCallback((d: Design | null) => setState({ past: [], now: d, future: [] }), []);
  const undo = useCallback(() => setState((s) => s.past.length && s.now ? { past: s.past.slice(0, -1), now: s.past[s.past.length - 1], future: [s.now, ...s.future] } : s), []);
  const redo = useCallback(() => setState((s) => s.future.length && s.now ? { past: [...s.past, s.now], now: s.future[0], future: s.future.slice(1) } : s), []);
  return { design: state.now, commit, reset, undo, redo, canUndo: state.past.length > 0, canRedo: state.future.length > 0 };
}

// ---------------------------------------------------------------- page

type Mode = "design" | "html" | "history";
interface Version { id: number; number: number; status: string; created_by: string; created_at: string; decided_by: string | null; decided_at: string | null }

export default function SignatureEditor({ me }: { me: Employee }) {
  const { id } = useParams();
  const tid = Number(id);
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [tpl, setTpl] = useState<TemplateRow | null>(null);
  const people = useLoad(() => api<Employee[]>("/employees"));
  const brand = useLoad(() => api<Brand>("/brand"));
  const hist = useHistory(null);
  const design = hist.design;
  const [html, setHtml] = useState("");
  const [mode, setMode] = useState<Mode>(params.get("panel") === "history" ? "history" : "design");
  const [selected, setSelected] = useState<string | null>(null);
  const [previewAs, setPreviewAs] = useState(me.email);
  const [audience, setAudience] = useState<"external" | "internal">("external");
  const [onBehalf, setOnBehalf] = useState("");
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const [rendered, setRendered] = useState("");
  const [report, setReport] = useState<ComplianceReport | null>(null);
  const [showPreview, setShowPreview] = useState(true);
  const [sidePanel, setSidePanel] = useState<"props" | "checks">("props");
  const [versions, setVersions] = useState<Version[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const canEdit = me.role === "admin" || me.role === "dept_admin";
  const latest = tpl?.latest;
  const pending = latest?.status === "pending";
  const readOnly = !canEdit || pending;
  const person = people.data?.find((p) => p.email === previewAs) ?? people.data?.[0];

  const load = useCallback(async () => {
    const all = await api<TemplateRow[]>("/templates");
    const t = all.find((x) => x.id === tid) ?? null;
    setTpl(t);
    if (t) {
      setHtml(t.latest?.html ?? t.live_html ?? "");
      hist.reset(t.latest?.design ?? null);
      setMode((m) => (m === "history" ? m : t.latest?.design ? "design" : "html"));
      api<Version[]>(`/templates/${t.id}/versions`).then(setVersions).catch(() => setVersions([]));
    }
  }, [tid]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load().catch((e: Error) => setError(e.message)); }, [load]);

  // Compile the design (server is the single compiler), then render it for a real person.
  const renderSeq = useRef(0);
  useEffect(() => {
    if (!tpl) return;
    const mine = ++renderSeq.current;
    const t = setTimeout(async () => {
      try {
        let source = html;
        if (design) {
          const c = await api<{ html: string; compliance: ComplianceReport }>("/designer/compile", { body: { design } });
          if (mine !== renderSeq.current) return;
          source = c.html;
          setHtml(c.html);
        }
        const r = await api<{ html: string; compliance: ComplianceReport }>("/templates/preview", {
          body: { html: source, employee_email: previewAs, with_code: audience === "external", with_extras: audience === "external", on_behalf_of_email: onBehalf || null },
        });
        if (mine !== renderSeq.current) return;
        setRendered(r.html);
        setReport(r.compliance);
      } catch (e) {
        if (mine === renderSeq.current) setError((e as Error).message);
      }
    }, 280);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(design), design ? "" : html, previewAs, audience, onBehalf, tpl?.id]);

  const savedDesign = JSON.stringify(latest?.design ?? null);
  const dirty = !!latest && (JSON.stringify(design) !== savedDesign || (!design && html !== latest.html));

  // Warn before leaving with unsaved changes.
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);
  const leave = () => { if (!dirty || window.confirm("Leave without saving your changes?")) navigate("/signatures"); };

  const run = async (fn: () => Promise<unknown>, message: string) => {
    setBusy(true); setError(null); setNotice(null);
    try { await fn(); setNotice(message); await load(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };

  const save = () => run(async () => {
    let source = html;
    if (design) source = (await api<{ html: string }>("/designer/compile", { body: { design } })).html;
    await api(`/templates/${tid}`, { method: "PUT", body: { html: source, design } });
  }, "Draft saved.");
  const submit = () => run(() => api(`/templates/${tid}/submit`, { body: {} }), "Submitted. Another admin must approve it before it goes live.");
  const decide = (decision: "approve" | "reject") => run(() => api(`/templates/${tid}/decide`, { body: { decision } }), decision === "approve" ? "Approved: this version is now live." : "Rejected.");

  // ---- design mutations
  const update = (d: Design, key = "") => { if (!readOnly) hist.commit(d, key); };
  const setBlocks = (blocks: DesignBlock[]) => design && update({ settings: design.settings, blocks });
  const setSettings = (patch: Partial<Design["settings"]>, key = "") => design && update({ settings: { ...design.settings, ...patch }, blocks: design.blocks }, key);
  const setProps = (bid: string, patch: Record<string, unknown>, key = "") =>
    design && update({ settings: design.settings, blocks: design.blocks.map((b) => (b.id === bid ? { ...b, props: { ...b.props, ...patch } } : b)) }, key ? `${bid}:${key}` : "");
  const split = design?.settings.layout === "split";
  const inCol = (col: string) => (design ? (split ? design.blocks.filter((b) => b.col === col) : design.blocks) : []);

  const place = (block: DesignBlock, col: "left" | "right", index: number) => {
    if (!design) return;
    const rest = design.blocks.filter((b) => b.id !== block.id);
    const target = split ? rest.filter((b) => b.col === col) : rest;
    const anchor = target[index];
    const at = anchor ? rest.indexOf(anchor) : target.length ? rest.indexOf(target[target.length - 1]) + 1 : rest.length;
    rest.splice(at, 0, { ...block, col });
    setBlocks(rest);
    setSelected(block.id);
  };
  const addBlock = (type: BlockType, col?: "left" | "right", index?: number) => {
    const c = col ?? (split && (type === "logo" || type === "photo") ? "left" : "right");
    place({ id: newId(), type, col: c, props: {} }, c, index ?? inCol(c).length);
  };
  const removeBlock = (bid: string) => { if (design) { setBlocks(design.blocks.filter((b) => b.id !== bid)); setSelected(null); } };
  const moveBlock = (bid: string, dir: -1 | 1) => {
    if (!design) return;
    const b = design.blocks.find((x) => x.id === bid)!;
    const list = inCol(b.col);
    const i = list.indexOf(b);
    if (i + dir < 0 || i + dir >= list.length) return;
    const all = [...design.blocks];
    const a = all.indexOf(b), o = all.indexOf(list[i + dir]);
    [all[a], all[o]] = [all[o], all[a]];
    setBlocks(all);
  };
  const duplicateBlock = (bid: string) => {
    if (!design) return;
    const b = design.blocks.find((x) => x.id === bid)!;
    place({ ...b, id: newId(), props: { ...b.props } }, b.col, inCol(b.col).indexOf(b) + 1);
  };

  // Keyboard: Delete removes, Ctrl+Z / Ctrl+Y undo/redo, Alt+arrows move.
  useEffect(() => {
    if (mode !== "design") return;
    const h = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); if (e.shiftKey) hist.redo(); else hist.undo(); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") { e.preventDefault(); hist.redo(); }
      else if (selected && (e.key === "Delete" || e.key === "Backspace") && !readOnly) { e.preventDefault(); removeBlock(selected); }
      else if (selected && e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown") && !readOnly) { e.preventDefault(); moveBlock(selected, e.key === "ArrowUp" ? -1 : 1); }
      else if (e.key === "Escape") setSelected(null);
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  });

  const toHtml = () => {
    if (design && !window.confirm("Edit the HTML by hand? This version will no longer open in the designer.")) return;
    if (design) hist.reset(null);
    setMode("html");
  };
  const toDesigner = async () => {
    if (design) { setMode("design"); return; }
    if (readOnly) return;
    if (!window.confirm("Rebuild this signature in the designer? The current HTML is replaced by a starter layout in your brand colours.")) return;
    const starters = await api<{ id: string; design: Design }[]>("/designer/starters");
    hist.commit(starters[0].design);
    setMode("design");
  };

  if (error && !tpl) return <div className="editor-error"><div className="note bad">{error}</div><Link to="/signatures">Back to signatures</Link></div>;
  if (!tpl) return <div className="editor-error sub">Loading…</div>;

  const blk = design?.blocks.find((b) => b.id === selected) ?? null;

  return (
    <div className="se">
      <header className="se-bar">
        <button className="ghost" onClick={leave}>← Signatures</button>
        <div className="se-title">
          <strong>{tpl.name}</strong>
          <span className="row tight">
            {tpl.live_version ? <Badge tone="good">Live v{tpl.live_version}</Badge> : <Badge>Not live</Badge>}
            {latest && latest.status !== "live" && <><StateBadge state={latest.status} /><span className="sub">v{latest.number}</span></>}
            {dirty && <Badge tone="warn">Unsaved</Badge>}
          </span>
        </div>
        <div className="seg" role="tablist" aria-label="Editor view">
          <button role="tab" aria-selected={mode === "design"} className={mode === "design" ? "on" : ""} onClick={toDesigner} disabled={!design && readOnly}>Design</button>
          <button role="tab" aria-selected={mode === "html"} className={mode === "html" ? "on" : ""} onClick={() => (mode === "design" && !readOnly ? toHtml() : setMode("html"))}>HTML</button>
          <button role="tab" aria-selected={mode === "history"} className={mode === "history" ? "on" : ""} onClick={() => setMode("history")}>History</button>
        </div>
        <span className="header-spacer" />
        {mode === "design" && design && !readOnly && (
          <span className="row tight">
            <button className="icon" title="Undo (Ctrl+Z)" aria-label="Undo" disabled={!hist.canUndo} onClick={hist.undo}>↶</button>
            <button className="icon" title="Redo (Ctrl+Y)" aria-label="Redo" disabled={!hist.canRedo} onClick={hist.redo}>↷</button>
          </span>
        )}
        {canEdit && !pending && (
          <>
            <button className="secondary" disabled={!dirty || busy} onClick={save}>Save draft</button>
            <button disabled={dirty || busy || latest?.status !== "draft"} onClick={submit} title={latest?.status !== "draft" ? "Save a draft first" : ""}>Submit for approval</button>
          </>
        )}
        {pending && me.role === "admin" && latest?.created_by !== me.email && (
          <>
            <button className="danger" disabled={busy} onClick={() => decide("reject")}>Reject</button>
            <button disabled={busy} onClick={() => decide("approve")}>Approve and publish</button>
          </>
        )}
      </header>

      {(error || notice || pending || tpl.integrity === false) && (
        <div className="se-notes">
          {error && <div className="note bad">{error}</div>}
          {notice && <div className="note good">{notice}</div>}
          {pending && <div className="note warn">Version {latest!.number} by {latest!.created_by} is waiting for approval{latest!.created_by === me.email ? "; another admin must approve it." : "."} It can't be edited until it's approved or rejected.</div>}
          {tpl.integrity === false && <div className="note bad">The live version doesn't match what was approved, so SignGuard is not using it. Save and submit a new version.</div>}
        </div>
      )}

      {mode === "design" && design && (
        <div className="se-body">
          <aside className="se-toolbox" aria-label="Toolbox">
            {TOOLBOX.map((g) => (
              <div key={g.group} className="tb-group">
                <div className="tb-title">{g.group}</div>
                {g.items.map((i) => (
                  <button key={i.type} className="tb-item" draggable={!readOnly} disabled={readOnly}
                    onDragStart={(e) => { e.dataTransfer.setData(NEW_KEY, i.type); e.dataTransfer.effectAllowed = "copy"; }}
                    onClick={() => addBlock(i.type)} aria-label={`Add ${i.label}: ${i.hint}`}
                    title={`${i.hint}. Drag onto the canvas or click to add.`}>
                    <span>{i.label}</span><small>{i.hint}</small>
                  </button>
                ))}
              </div>
            ))}
          </aside>

          <section className="se-center">
            <Canvas design={design} brand={brand.data} person={person} selected={selected} readOnly={readOnly}
              onSelect={setSelected} onAdd={addBlock} onPlace={place} onRemove={removeBlock} onMove={moveBlock} onDuplicate={duplicateBlock} />
            <PreviewPane open={showPreview} onToggle={() => setShowPreview(!showPreview)} html={rendered} people={people.data ?? []}
              previewAs={previewAs} setPreviewAs={setPreviewAs} audience={audience} setAudience={setAudience}
              onBehalf={onBehalf} setOnBehalf={setOnBehalf} device={device} setDevice={setDevice} />
          </section>

          <aside className="se-props">
            <div className="tabs compact-tabs" role="tablist">
              <button role="tab" aria-selected={sidePanel === "props"} className={sidePanel === "props" ? "on" : ""} onClick={() => setSidePanel("props")}>Properties</button>
              <button role="tab" aria-selected={sidePanel === "checks"} className={sidePanel === "checks" ? "on" : ""} onClick={() => setSidePanel("checks")}>
                Checks {report && <ScoreBadge score={report.score} />}
              </button>
            </div>
            {sidePanel === "checks" ? <Checks report={report} /> : blk ? (
              <BlockProps block={blk} brand={brand.data} disabled={readOnly} onChange={(p, k) => setProps(blk.id, p, k)}
                onDelete={() => removeBlock(blk.id)} onDuplicate={() => duplicateBlock(blk.id)} onDone={() => setSelected(null)} />
            ) : (
              <SignatureProps design={design} disabled={readOnly} onChange={setSettings} />
            )}
          </aside>
        </div>
      )}

      {mode === "html" && (
        <HtmlEditor html={html} setHtml={setHtml} readOnly={readOnly || !!design} rendered={rendered} report={report} people={people.data ?? []}
          previewAs={previewAs} setPreviewAs={setPreviewAs} audience={audience} setAudience={setAudience}
          onBehalf={onBehalf} setOnBehalf={setOnBehalf} canConvert={!design && !readOnly} onConvert={toDesigner} fromDesigner={!!design} />
      )}

      {mode === "history" && (
        <div className="se-page">
          <table>
            <thead><tr><th>Version</th><th>Status</th><th>Written by</th><th>Decided by</th></tr></thead>
            <tbody>
              {versions.map((v) => (
                <tr key={v.id}>
                  <td>v{v.number}</td>
                  <td><StateBadge state={v.status} /></td>
                  <td>{v.created_by}<div className="sub">{fmt(v.created_at)}</div></td>
                  <td>{v.decided_by ?? "–"}<div className="sub">{v.decided_at ? fmt(v.decided_at) : ""}</div></td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="sub">Every approved version is kept and sealed. A new version replaces the live one only after a second admin approves it.</p>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- canvas (WYSIWYG)

interface CanvasProps {
  design: Design; brand: Brand | null; person?: Employee; selected: string | null; readOnly: boolean;
  onSelect: (id: string | null) => void; onAdd: (t: BlockType, col?: "left" | "right", index?: number) => void;
  onPlace: (b: DesignBlock, col: "left" | "right", index: number) => void; onRemove: (id: string) => void;
  onMove: (id: string, dir: -1 | 1) => void; onDuplicate: (id: string) => void;
}

function Canvas({ design, brand, person, selected, readOnly, onSelect, onAdd, onPlace, onRemove, onMove, onDuplicate }: CanvasProps) {
  const [drop, setDrop] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const s = design.settings;
  const split = s.layout === "split";
  const tail = split ? design.blocks.filter((b) => b.type === "banner" || b.type === "disclaimer") : [];
  const list = (col: "left" | "right") => {
    const base = split ? design.blocks.filter((b) => b.col === col && !(b.type === "banner" || b.type === "disclaimer")) : design.blocks;
    return base;
  };

  const handleDrop = (e: DragEvent, col: "left" | "right", index: number) => {
    e.preventDefault(); e.stopPropagation(); setDrop(null); setDragging(null);
    if (readOnly) return;
    const type = e.dataTransfer.getData(NEW_KEY) as BlockType;
    const mid = e.dataTransfer.getData(MOVE_KEY);
    if (type) onAdd(type, col, index);
    else if (mid) {
      const b = design.blocks.find((x) => x.id === mid);
      if (!b) return;
      const items = list(col);
      const from = items.indexOf(b);
      onPlace(b, col, from >= 0 && from < index ? index - 1 : index);
    }
  };
  const zone = (col: "left" | "right", index: number) => {
    const key = `${col}:${index}`;
    return (
      <div key={`z${key}`} className={`cv-drop ${drop === key ? "on" : ""}`}
        onDragOver={(e) => { if (!readOnly) { e.preventDefault(); e.stopPropagation(); setDrop(key); } }}
        onDragLeave={() => setDrop((d) => (d === key ? null : d))}
        onDrop={(e) => handleDrop(e, col, index)} />
    );
  };
  const column = (col: "left" | "right") => {
    const items = list(col);
    return (
      <div className={`cv-col ${col}`}>
        {zone(col, 0)}
        {items.map((b, i) => (
          <div key={b.id}>
            <div className={`cv-el ${selected === b.id ? "sel" : ""} ${dragging === b.id ? "dragging" : ""} ${["banner", "disclaimer", "verification", "delegation"].includes(b.type) ? "rule" : ""}`}
              draggable={!readOnly} tabIndex={0} role="button" aria-label={`${LABEL[b.type]} element`} aria-pressed={selected === b.id}
              onDragStart={(e) => { e.dataTransfer.setData(MOVE_KEY, b.id); e.dataTransfer.effectAllowed = "move"; setDragging(b.id); }}
              onDragEnd={() => setDragging(null)}
              onClick={(e) => { e.stopPropagation(); onSelect(b.id); }}
              onKeyDown={(e) => { if (e.key === "Enter") onSelect(b.id); }}>
              <span className="cv-tag">{LABEL[b.type]}</span>
              {selected === b.id && !readOnly && (
                <span className="cv-tools" onClick={(e) => e.stopPropagation()}>
                  <button className="icon" aria-label="Move up" title="Move up (Alt+↑)" onClick={() => onMove(b.id, -1)} disabled={i === 0}>↑</button>
                  <button className="icon" aria-label="Move down" title="Move down (Alt+↓)" onClick={() => onMove(b.id, 1)} disabled={i === items.length - 1}>↓</button>
                  <button className="icon" aria-label="Duplicate" title="Duplicate" onClick={() => onDuplicate(b.id)}>⧉</button>
                  <button className="icon" aria-label="Delete" title="Delete (Del)" onClick={() => onRemove(b.id)}>✕</button>
                </span>
              )}
              <BlockView block={b} s={s} brand={brand} person={person} />
            </div>
            {zone(col, i + 1)}
          </div>
        ))}
        {items.length === 0 && <div className="cv-empty">{split ? (col === "left" ? "Logo or photo" : "Details") : "Drag elements here"}</div>}
      </div>
    );
  };

  return (
    <div className="cv-wrap" onClick={() => onSelect(null)}
      onDragOver={(e) => { if (dragging) e.preventDefault(); }}
      onDrop={(e) => { const mid = e.dataTransfer.getData(MOVE_KEY); if (mid && !readOnly) { e.preventDefault(); onRemove(mid); } setDragging(null); setDrop(null); }}>
      <div className="cv-sheet" style={{ width: Math.min(s.width + 48, 760) }}
        onDragOver={(e) => { if (!readOnly) { e.preventDefault(); e.stopPropagation(); } }}
        onDrop={(e) => {
          // Dropped on the signature but not on a gap: new elements go to the end; moves are cancelled.
          e.preventDefault(); e.stopPropagation(); setDrop(null); setDragging(null);
          const type = e.dataTransfer.getData(NEW_KEY) as BlockType;
          if (type && !readOnly) onAdd(type);
        }}>
        <div className="cv-sig" style={{ fontFamily: s.font, fontSize: s.font_size, color: s.text_color, maxWidth: s.width }}>
          {split ? (
            <>
              <div className="cv-split">
                <div style={{ borderRight: s.divider !== false && list("left").length ? `2px solid ${s.accent}` : undefined, paddingRight: 16 }}>{column("left")}</div>
                <div style={{ paddingLeft: 16, flex: 1 }}>{column("right")}</div>
              </div>
              {tail.map((b) => (
                <div key={b.id} className={`cv-el rule ${selected === b.id ? "sel" : ""}`} onClick={(e) => { e.stopPropagation(); onSelect(b.id); }}
                  draggable={!readOnly} onDragStart={(e) => { e.dataTransfer.setData(MOVE_KEY, b.id); setDragging(b.id); }} onDragEnd={() => setDragging(null)}>
                  <span className="cv-tag">{LABEL[b.type]}</span>
                  <BlockView block={b} s={s} brand={brand} person={person} />
                </div>
              ))}
            </>
          ) : column("right")}
        </div>
      </div>
      {dragging && !readOnly && <div className="cv-trash">Drop outside the signature to remove</div>}
    </div>
  );
}

const hex = (v: unknown, d: string) => (typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v) ? v : d);
const num = (v: unknown, d: number) => (typeof v === "number" && !Number.isNaN(v) ? v : d);

/** Mirrors backend/app/designer.py closely enough to design by eye; the preview pane shows the exact output. */
function BlockView({ block, s, brand, person }: { block: DesignBlock; s: Design["settings"]; brand: Brand | null; person?: Employee }) {
  const p = block.props;
  const fs = s.font_size;
  const accent = hex(p.color, s.accent);
  const muted = s.muted ?? "#5b6b7c";
  const who = person ?? { name: "Priya Sharma", job_title: "Executive Assistant", department: "Finance", phone: "+91 80 4000 2002", mobile: "", email: "priya.sharma@contoso.com" } as Employee;
  const site = brand?.website ?? "";
  const row = (children: ReactNode, style: CSSProperties = {}) => <div style={{ padding: "2px 0", ...style }}>{children}</div>;
  switch (block.type) {
    case "logo": {
      const w = num(p.width, brand?.logo_width ?? 120);
      return brand?.logo_url ? row(<img src={brand.logo_url} width={w} alt={String(p.alt ?? brand.company_name)} style={{ display: "block", maxWidth: w }} />, { paddingBottom: 8 })
        : <div className="cv-ph" style={{ width: w, height: Math.round(w * 0.35) }}>Logo (set in Brand kit)</div>;
    }
    case "photo": {
      const size = num(p.size, 72);
      return row(<div className="cv-photo" style={{ width: size, height: size, borderRadius: p.shape === "square" ? 6 : "50%", background: accent }}>
        {who.name.split(" ").map((x) => x[0]).slice(0, 2).join("")}</div>, { paddingBottom: 8 });
    }
    case "name":
      return row(who.name, { fontSize: num(p.size, fs + 4), fontWeight: p.bold === false ? 400 : 700, color: hex(p.color, s.text_color), lineHeight: 1.3 });
    case "title": {
      const parts = [who.job_title];
      if (p.show_department !== false && who.department) parts.push(who.department);
      if (p.show_company) parts.push(brand?.company_name || "Company");
      return row(parts.filter(Boolean).join(" | "), { color: accent, paddingBottom: 6 });
    }
    case "contact": {
      const fields = (p.fields as string[] | undefined) ?? CONTACT;
      const vals: Record<string, [string, string]> = {
        phone: ["T", who.phone], mobile: ["M", who.mobile], email: ["E", who.email], website: ["W", site.replace(/^https?:\/\//, "").replace(/\/$/, "")],
      };
      const items = fields.filter((f) => vals[f]?.[1]).map((f) => (
        <span key={f} style={{ marginRight: p.inline ? 12 : 0, display: p.inline ? "inline" : "block", padding: p.inline ? 0 : "1px 0" }}>
          <b style={{ color: accent }}>{vals[f][0]}</b>&nbsp;{vals[f][1]}
        </span>
      ));
      return row(items.length ? items : <span className="cv-dim">No contact details for this person</span>, { fontSize: fs - 1 });
    }
    case "text":
      return row(String(p.text || "") || <span className="cv-dim">Type text in Properties</span>,
        { fontSize: num(p.size, fs - 1), color: hex(p.color, s.text_color), fontStyle: p.italic ? "italic" : undefined, whiteSpace: "pre-wrap", padding: "4px 0" });
    case "divider":
      return <div style={{ padding: "8px 0" }}><div style={{ borderTop: `${num(p.thickness, 1)}px solid ${hex(p.color, "#e1e6ec")}` }} /></div>;
    case "spacer":
      return <div style={{ height: num(p.height, 8) }} className="cv-spacer" />;
    case "social": {
      const nets = (p.networks as string[] | undefined) ?? ["linkedin", "twitter"];
      return row(nets.map((n) => {
        const meta = NETWORKS.find((x) => x[0] === n);
        if (!meta) return null;
        const has = !!brand?.[meta[2]];
        return <span key={n} className={has ? "" : "cv-missing"} title={has ? "" : "No link in the brand kit: hidden in email"}
          style={{ display: "inline-block", marginRight: 6, padding: "3px 8px", background: accent, color: "#fff", borderRadius: 3, fontSize: fs - 3, fontWeight: 700 }}>{meta[1]}</span>;
      }), { padding: "6px 0 2px" });
    }
    case "address":
      return row(brand?.address || <span className="cv-dim">Address (set in Brand kit)</span>, { fontSize: fs - 2, color: muted });
    case "button":
      return row(<span className={p.url ? "" : "cv-missing"} title={p.url ? "" : "Add a link: buttons without one are left out"}
        style={{ display: "inline-block", padding: "7px 14px", background: hex(p.color, accent), color: "#fff", borderRadius: 4, fontWeight: 700, fontSize: fs - 1 }}>
        {String(p.label || "Book a meeting")}</span>, { padding: "8px 0 2px" });
    case "delegation":
      return row(<>on behalf of <b>Arjun Rao</b>, Finance Director</>, { fontSize: fs - 1, color: muted, opacity: 0.7 });
    case "verification":
      return row(<><span style={{ color: muted }}>Verify this email at verify.contoso.com with code</span> <b style={{ letterSpacing: 1 }}>SG-7K4P-Q2MX</b></>, { fontSize: fs - 3, paddingTop: 8 });
    case "banner":
      return <div className="cv-ph wide">Campaign banner · chosen by audience on each email</div>;
    case "disclaimer":
      return <div className="cv-ph wide">Disclaimers · added by rule on each email</div>;
    default:
      return null;
  }
}

// ---------------------------------------------------------------- properties

function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return <label className="pp-field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>;
}

function ColorInput({ value, onChange, disabled, fallback }: { value: string; onChange: (v: string) => void; disabled?: boolean; fallback: string }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const valid = /^#[0-9a-f]{6}$/i.test(value);
  return (
    <span className="color-field">
      <input type="color" value={valid ? value : fallback} disabled={disabled} onChange={(e) => onChange(e.target.value)} />
      <input value={text} placeholder={fallback} disabled={disabled} maxLength={7}
        onChange={(e) => { setText(e.target.value); if (/^#[0-9a-f]{6}$/i.test(e.target.value) || e.target.value === "") onChange(e.target.value); }} />
    </span>
  );
}

function SignatureProps({ design, onChange, disabled }: { design: Design; onChange: (p: Partial<Design["settings"]>, key?: string) => void; disabled: boolean }) {
  const s = design.settings;
  return (
    <div className="pp">
      <div className="pp-head"><strong>Signature</strong><span className="sub">Select an element to edit it</span></div>
      <Field label="Layout">
        <div className="seg">
          <button className={s.layout !== "split" ? "on" : ""} disabled={disabled} onClick={() => onChange({ layout: "stack" })}>One column</button>
          <button className={s.layout === "split" ? "on" : ""} disabled={disabled} onClick={() => onChange({ layout: "split" })}>Two columns</button>
        </div>
      </Field>
      {s.layout === "split" && <label className="check"><input type="checkbox" checked={s.divider !== false} disabled={disabled} onChange={(e) => onChange({ divider: e.target.checked })} /> Line between columns</label>}
      <Field label="Font">
        <select value={s.font} disabled={disabled} onChange={(e) => onChange({ font: e.target.value })}>
          {FONTS.map((f) => <option key={f} value={f}>{f.split(",")[0].replace(/'/g, "")}</option>)}
        </select>
      </Field>
      <div className="pp-pair">
        <Field label="Text size"><input type="number" min={10} max={16} value={s.font_size} disabled={disabled} onChange={(e) => onChange({ font_size: Number(e.target.value) }, "fs")} /></Field>
        <Field label="Width (px)"><input type="number" min={280} max={700} step={10} value={s.width} disabled={disabled} onChange={(e) => onChange({ width: Number(e.target.value) }, "w")} /></Field>
      </div>
      <Field label="Text colour"><ColorInput value={s.text_color} fallback="#1f2933" disabled={disabled} onChange={(v) => onChange({ text_color: v || "#1f2933" }, "tc")} /></Field>
      <Field label="Accent colour"><ColorInput value={s.accent} fallback="#2878d0" disabled={disabled} onChange={(v) => onChange({ accent: v || "#2878d0" }, "ac")} /></Field>
    </div>
  );
}

function BlockProps({ block, brand, onChange, onDelete, onDuplicate, onDone, disabled }: {
  block: DesignBlock; brand: Brand | null; onChange: (p: Record<string, unknown>, key?: string) => void;
  onDelete: () => void; onDuplicate: () => void; onDone: () => void; disabled: boolean;
}) {
  const p = block.props;
  const n = (k: string, label: string, min: number, max: number, d: number) => (
    <Field label={label}><input type="number" min={min} max={max} value={num(p[k], d)} disabled={disabled} onChange={(e) => onChange({ [k]: Number(e.target.value) }, k)} /></Field>
  );
  const t = (k: string, label: string, placeholder = "", hint?: string) => (
    <Field label={label} hint={hint}><input value={String(p[k] ?? "")} placeholder={placeholder} disabled={disabled} onChange={(e) => onChange({ [k]: e.target.value }, k)} /></Field>
  );
  const c = (k: string, label: string, fallback: string) => (
    <Field label={label}><ColorInput value={String(p[k] ?? "")} fallback={fallback} disabled={disabled} onChange={(v) => onChange({ [k]: v || undefined }, k)} /></Field>
  );
  const b = (k: string, label: string, d = false) => (
    <label className="check"><input type="checkbox" checked={Boolean(p[k] ?? d)} disabled={disabled} onChange={(e) => onChange({ [k]: e.target.checked })} /> {label}</label>
  );
  const multi = (k: string, options: [string, string][], d: string[]) => {
    const cur = (p[k] as string[] | undefined) ?? d;
    return (
      <div className="pp-multi">
        {options.map(([v, label]) => (
          <label key={v} className="check"><input type="checkbox" checked={cur.includes(v)} disabled={disabled}
            onChange={(e) => onChange({ [k]: e.target.checked ? options.map((o) => o[0]).filter((x) => x === v || cur.includes(x)) : cur.filter((x) => x !== v) })} /> {label}</label>
        ))}
      </div>
    );
  };
  const info = (text: string) => <p className="pp-info">{text}</p>;
  return (
    <div className="pp">
      <div className="pp-head"><strong>{LABEL[block.type]}</strong><button className="link-button" onClick={onDone}>Done</button></div>
      {block.type === "logo" && <>{n("width", "Width (px)", 40, 300, brand?.logo_width ?? 120)}{t("alt", "Alt text", "{{company}}")}{t("link", "Link", "{{website}}")}{info("The image comes from the Brand kit, so one change updates every signature.")}</>}
      {block.type === "photo" && <>
        <Field label="Shape"><div className="seg">
          <button className={p.shape !== "square" ? "on" : ""} disabled={disabled} onClick={() => onChange({ shape: "circle" })}>Circle</button>
          <button className={p.shape === "square" ? "on" : ""} disabled={disabled} onClick={() => onChange({ shape: "square" })}>Square</button>
        </div></Field>
        {n("size", "Size (px)", 40, 140, 72)}{info("Left out for people without a directory photo.")}</>}
      {block.type === "name" && <>{n("size", "Size (px)", 12, 26, 17)}{b("bold", "Bold", true)}{c("color", "Colour", "#1f2933")}</>}
      {block.type === "title" && <>{b("show_department", "Department", true)}{b("show_company", "Company name")}{c("color", "Colour", "#2878d0")}</>}
      {block.type === "contact" && <>{multi("fields", [["phone", "Phone"], ["mobile", "Mobile"], ["email", "Email"], ["website", "Website"]], CONTACT)}{b("inline", "All on one line")}{info("Empty fields are left out for each person.")}</>}
      {block.type === "text" && <>
        <Field label="Text"><textarea rows={3} value={String(p.text ?? "")} disabled={disabled} onChange={(e) => onChange({ text: e.target.value }, "text")} /></Field>
        {n("size", "Size (px)", 9, 20, 12)}{b("italic", "Italic")}{c("color", "Colour", "#1f2933")}{info("Placeholders such as {{company}} work here.")}</>}
      {block.type === "divider" && <>{c("color", "Colour", "#e1e6ec")}{n("thickness", "Thickness", 1, 6, 1)}</>}
      {block.type === "spacer" && n("height", "Height (px)", 2, 40, 8)}
      {block.type === "social" && <>{multi("networks", NETWORKS.map(([v, l]) => [v, l]), ["linkedin", "twitter"])}{info("Links are set once in the Brand kit. Networks without a link are hidden in email (shown faded here).")}</>}
      {block.type === "button" && <>{t("label", "Label", "Book a meeting")}{t("url", "Link", "https://", "Must start with https://")}{c("color", "Colour", "#2878d0")}</>}
      {block.type === "address" && info("Shows the office address from the Brand kit.")}
      {block.type === "delegation" && info("Shown only when someone sends with an approved delegation, e.g. \"on behalf of Arjun Rao, Finance Director\".")}
      {block.type === "verification" && info("Shown only on external email. Recipients check the code on your public verify page.")}
      {block.type === "banner" && info("Where the campaign banner goes. Which banner appears depends on the sender's department and the recipients; manage them under Campaigns.")}
      {block.type === "disclaimer" && info("Where disclaimers go. Without this element they're added at the end. Manage them under Disclaimers.")}
      {!disabled && (
        <div className="pp-actions">
          <button className="secondary small" onClick={onDuplicate}>Duplicate</button>
          <button className="danger small" onClick={onDelete}>Delete element</button>
        </div>
      )}
    </div>
  );
}

function Checks({ report }: { report: ComplianceReport | null }) {
  if (!report) return <p className="sub pp">Checking…</p>;
  return (
    <div className="pp">
      <div className="pp-head"><strong>Brand and email checks</strong><ScoreBadge score={report.score} grade={report.grade} /></div>
      {report.issues.length === 0 && <p className="sub">No problems found.</p>}
      <ul className="pp-issues">
        {report.issues.map((i, k) => <li key={k}><SeverityBadge severity={i.severity} /><span>{i.message}</span></li>)}
      </ul>
      {report.passed.length > 0 && <ul className="pp-passed">{report.passed.map((x) => <li key={x}>✓ {x}</li>)}</ul>}
    </div>
  );
}

// ---------------------------------------------------------------- preview

interface PreviewControls {
  people: Employee[]; previewAs: string; setPreviewAs: (v: string) => void;
  audience: "external" | "internal"; setAudience: (v: "external" | "internal") => void;
  onBehalf: string; setOnBehalf: (v: string) => void;
}

function PreviewControlsBar({ people, previewAs, setPreviewAs, audience, setAudience, onBehalf, setOnBehalf, children }: PreviewControls & { children?: ReactNode }) {
  return (
    <div className="pv-controls">
      <select value={previewAs} onChange={(e) => setPreviewAs(e.target.value)} aria-label="Preview as">
        {people.map((p) => <option key={p.email} value={p.email}>{p.name}{p.department ? ` · ${p.department}` : ""}</option>)}
      </select>
      <div className="seg" aria-label="Recipients">
        <button className={audience === "external" ? "on" : ""} onClick={() => setAudience("external")}>External</button>
        <button className={audience === "internal" ? "on" : ""} onClick={() => setAudience("internal")}>Internal</button>
      </div>
      <select value={onBehalf} onChange={(e) => setOnBehalf(e.target.value)} aria-label="On behalf of">
        <option value="">Not on behalf of anyone</option>
        {people.filter((p) => p.email !== previewAs).map((p) => <option key={p.email} value={p.email}>On behalf of {p.name}</option>)}
      </select>
      {children}
    </div>
  );
}

function PreviewPane({ open, onToggle, html, device, setDevice, ...c }: PreviewControls & { open: boolean; onToggle: () => void; html: string; device: "desktop" | "mobile"; setDevice: (d: "desktop" | "mobile") => void }) {
  return (
    <div className={`pv ${open ? "open" : ""}`}>
      <div className="pv-head">
        <button className="ghost small" onClick={onToggle} aria-expanded={open}>{open ? "▾" : "▸"} Preview as sent</button>
        {open && (
          <PreviewControlsBar {...c}>
            <div className="seg" aria-label="Device">
              <button className={device === "desktop" ? "on" : ""} onClick={() => setDevice("desktop")}>Desktop</button>
              <button className={device === "mobile" ? "on" : ""} onClick={() => setDevice("mobile")}>Mobile</button>
            </div>
          </PreviewControlsBar>
        )}
      </div>
      {open && (
        <div className="pv-body">
          <div className={`pv-mail ${device}`}>
            <iframe sandbox="" title="Signature as sent"
              srcDoc={`<!doctype html><html><body style="margin:16px;background:#fff;font:14px/1.5 Arial,sans-serif;color:#1d2733"><p style="margin:0 0 14px">Hi Alex,<br>Thanks for your time today. The proposal is attached.<br>Best regards,</p>${html}</body></html>`} />
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- HTML mode

function HtmlEditor({ html, setHtml, readOnly, rendered, report, canConvert, onConvert, fromDesigner, ...c }: PreviewControls & {
  html: string; setHtml: (h: string) => void; readOnly: boolean; rendered: string; report: ComplianceReport | null;
  canConvert: boolean; onConvert: () => void; fromDesigner: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const insert = (token: string) => {
    const el = ref.current;
    if (!el || readOnly) return;
    const { selectionStart: a, selectionEnd: b } = el;
    setHtml(html.slice(0, a) + token + html.slice(b));
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(a + token.length, a + token.length); });
  };
  const chips = useMemo(() => PLACEHOLDERS.map((p) => `{{${p}}}`), []);
  return (
    <div className="se-html">
      <div className="se-html-src">
        {fromDesigner && <div className="note info">This signature is built in the designer; the HTML is generated and read-only here.</div>}
        {canConvert && <div className="note info">Written in HTML. <button className="link-button" onClick={onConvert}>Rebuild in the designer</button> to edit with drag and drop.</div>}
        <textarea id="html" ref={ref} value={html} onChange={(e) => setHtml(e.target.value)} readOnly={readOnly} spellCheck={false} aria-label="Signature HTML" />
        <div className="chips">
          {chips.map((p) => <button key={p} className="chip mono" disabled={readOnly} onClick={() => insert(p)}>{p}</button>)}
          <button className="chip mono" disabled={readOnly} onClick={() => insert("<!--sg:banner-->")}>banner slot</button>
          <button className="chip mono" disabled={readOnly} onClick={() => insert("<!--sg:disclaimer-->")}>disclaimer slot</button>
        </div>
        <p className="sub">Use tables and inline styles: Outlook ignores &lt;style&gt; blocks and classes. Wrap optional lines in {"{{#phone}}…{{/phone}}"} so they disappear when empty.</p>
      </div>
      <div className="se-html-preview">
        <PreviewControlsBar {...c} />
        <div className="pv-mail desktop">
          <iframe sandbox="" title="Signature as sent" srcDoc={`<!doctype html><html><body style="margin:16px;background:#fff">${rendered}</body></html>`} />
        </div>
        <Checks report={report} />
      </div>
    </div>
  );
}
