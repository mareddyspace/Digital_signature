import { useEffect, useMemo, useState, type DragEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, type Employee } from "../api";
import { Badge, Drawer, ErrorNote, Page, SignatureThumb, Toggle, fromLocalInput, toLocalInput, useConfirm, useLoad } from "../ui";
import type { TemplateRow } from "./Signatures";

interface Policy {
  id: number; name: string; priority: number; departments: string; recipient_type: string;
  message_type: string; template_id: number; template_name: string | null; enabled: boolean;
  people: string; exclude_people: string; recipient_domains: string; starts_at: string | null; ends_at: string | null;
}
type Form = Omit<Policy, "id" | "template_name"> & { id?: number };

const RECIPIENTS: [string, string, string][] = [
  ["any", "Any recipients", "Every email, inside or outside the company"],
  ["external", "When any recipient is external", "At least one address is outside your domains"],
  ["internal", "When all recipients are internal", "Every address is in one of your domains"],
];
const TYPES: [string, string][] = [["any", "New emails, replies and forwards"], ["new", "New emails only"], ["reply", "Replies and forwards only"]];
const R_SHORT: Record<string, string> = { any: "Anyone", external: "External", internal: "Internal only" };
const T_SHORT: Record<string, string> = { any: "All email", new: "New email", reply: "Replies & forwards" };

const depts = (s: string | null | undefined) => (s ?? "").split(",").map((d) => d.trim()).filter(Boolean);
const lower = (s: string) => depts(s).map((x) => x.toLowerCase());
const domainOf = (email: string) => email.split("@")[1]?.toLowerCase() ?? "";
const inDomains = (d: string, wanted: string[]) => wanted.some((w) => d === w || d.endsWith(`.${w}`));
const asUtc = (v: string) => new Date(v.endsWith("Z") || v.includes("+") ? v : `${v}Z`);

/** Senders column text: departments and/or named people, minus exceptions. */
function sendersText(p: { departments: string; people: string; exclude_people: string }) {
  const parts = [...depts(p.departments), ...(depts(p.people).length ? [`${depts(p.people).length} named ${depts(p.people).length === 1 ? "person" : "people"}`] : [])];
  return { main: parts.length ? parts.join(", ") : "Everyone", except: depts(p.exclude_people).length };
}

function scheduleText(p: { starts_at: string | null; ends_at: string | null }) {
  const d = (v: string) => asUtc(v).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  if (p.starts_at && p.ends_at) return `${d(p.starts_at)} – ${d(p.ends_at)}`;
  if (p.starts_at) return `From ${d(p.starts_at)}`;
  if (p.ends_at) return `Until ${d(p.ends_at)}`;
  return "";
}

function scheduleState(p: { starts_at: string | null; ends_at: string | null }, now = new Date()): "upcoming" | "ended" | null {
  if (p.starts_at && now < asUtc(p.starts_at)) return "upcoming";
  if (p.ends_at && now >= asUtc(p.ends_at)) return "ended";
  return null;
}

export default function Rules({ me }: { me: Employee }) {
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") ?? "rules";
  const setTab = (t: string) => setParams(t === "rules" ? {} : { tab: t });
  return (
    <Page
      title="Rules"
      intro="Rules decide which signature each email gets. SignGuard checks them from the top and uses the first rule whose senders, recipients and email type all match."
    >
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === "rules"} className={tab === "rules" ? "on" : ""} onClick={() => setTab("rules")}>Rules</button>
        <button role="tab" aria-selected={tab === "tester"} className={tab === "tester" ? "on" : ""} onClick={() => setTab("tester")}>Rules tester</button>
        <button role="tab" aria-selected={tab === "coverage"} className={tab === "coverage" ? "on" : ""} onClick={() => setTab("coverage")}>Coverage by department</button>
      </div>
      {tab === "rules" && <RuleList me={me} />}
      {tab === "tester" && <Tester me={me} />}
      {tab === "coverage" && <Coverage />}
    </Page>
  );
}

// ---------------------------------------------------------------- list

function RuleList({ me }: { me: Employee }) {
  const [ask, confirmDialog] = useConfirm();
  const policies = useLoad(() => api<Policy[]>("/policies"));
  const templates = useLoad(() => api<TemplateRow[]>("/templates"));
  const people = useLoad(() => api<Employee[]>("/employees"));
  const [params, setParams] = useSearchParams();
  const [editing, setEditing] = useState<Form | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dragId, setDragId] = useState<number | null>(null);
  const [overId, setOverId] = useState<number | null>(null);
  const isAdmin = me.role === "admin";
  const list = policies.data ?? [];
  const onlyTemplate = params.get("template") ? Number(params.get("template")) : null;
  const shown = onlyTemplate ? list.filter((p) => p.template_id === onlyTemplate) : list;
  const tName = (id: number) => templates.data?.find((t) => t.id === id)?.name;

  // Deep link from a signature: /rules?edit=<id>
  useEffect(() => {
    const id = Number(params.get("edit"));
    const p = id && list.find((x) => x.id === id);
    if (p) { setEditing({ ...p }); params.delete("edit"); setParams(params, { replace: true }); }
  }, [list]); // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (fn: () => Promise<unknown>, message?: string) => {
    setError(null); setNotice(null);
    try { await fn(); if (message) setNotice(message); policies.reload(); return true; } catch (e) { setError((e as Error).message); return false; }
  };
  const bodyOf = (p: Policy | Form) => ({
    name: p.name, priority: p.priority, departments: p.departments, recipient_type: p.recipient_type,
    message_type: p.message_type, template_id: p.template_id, enabled: p.enabled,
    people: p.people, exclude_people: p.exclude_people, recipient_domains: p.recipient_domains,
    starts_at: p.starts_at, ends_at: p.ends_at,
  });
  const reorder = (ids: number[]) => act(() => api("/policies/reorder", { body: { ids } }), "Order saved.");
  const move = (id: number, dir: -1 | 1) => {
    const ids = list.map((p) => p.id);
    const i = ids.indexOf(id);
    if (i + dir < 0 || i + dir >= ids.length) return;
    [ids[i], ids[i + dir]] = [ids[i + dir], ids[i]];
    reorder(ids);
  };
  const onDrop = (e: DragEvent, targetId: number) => {
    e.preventDefault();
    setOverId(null);
    if (dragId === null || dragId === targetId) return;
    const ids = list.map((p) => p.id).filter((x) => x !== dragId);
    ids.splice(ids.indexOf(targetId), 0, dragId);
    setDragId(null);
    reorder(ids);
  };
  const toggle = (p: Policy) => act(() => api(`/policies/${p.id}`, { method: "PUT", body: { ...bodyOf(p), enabled: !p.enabled } }),
    p.enabled ? `"${p.name}" is off.` : `"${p.name}" is on.`);
  const remove = async (p: Policy) => (await ask({ title: `Delete the rule "${p.name}"?`, detail: "Emails it matched will fall through to the next rule.", confirm: "Delete rule", danger: true })) &&
    act(() => api(`/policies/${p.id}`, { method: "DELETE" }), "Rule deleted.");
  const duplicate = (p: Policy) => setEditing({ ...bodyOf(p), name: `${p.name} (copy)`, enabled: false, priority: p.priority + 1 });
  const startNew = () => setEditing({
    name: "", priority: (list.length ? Math.max(...list.map((p) => p.priority)) : 0) + 10, departments: "",
    recipient_type: "external", message_type: "any", template_id: templates.data?.find((t) => t.live_version)?.id ?? 0, enabled: true,
    people: "", exclude_people: "", recipient_domains: "", starts_at: null, ends_at: null,
  });

  return (
    <>
      <ErrorNote error={policies.error ?? error} />
      {notice && <div className="note good" role="status">{notice}</div>}
      <div className="toolbar">
        {onlyTemplate ? (
          <span className="note info" style={{ margin: 0 }}>Rules that send <b>{tName(onlyTemplate) ?? "this signature"}</b> · <button className="link-button" onClick={() => setParams({})}>Show all rules</button></span>
        ) : <span className="sub">{list.filter((p) => p.enabled).length} of {list.length} rules on · drag rows or use the arrows to change the order</span>}
        <span className="spacer" />
        {isAdmin && <button onClick={startNew}>New rule</button>}
      </div>

      <div className="card flush table-wrap">
        <table className="rules">
          <thead><tr><th style={{ width: 92 }}>Order</th><th>Rule</th><th>Senders</th><th>Recipients</th><th>Signature</th><th style={{ width: 60 }}>On</th><th /></tr></thead>
          <tbody>
            {shown.map((p) => {
              const i = list.indexOf(p);
              const t = templates.data?.find((x) => x.id === p.template_id);
              return (
                <tr key={p.id} className={`${p.enabled ? "" : "off"} ${overId === p.id ? "drop-over" : ""}`}
                  draggable={isAdmin && !onlyTemplate} onDragStart={() => setDragId(p.id)} onDragEnd={() => { setDragId(null); setOverId(null); }}
                  onDragOver={(e) => { if (dragId !== null) { e.preventDefault(); setOverId(p.id); } }} onDrop={(e) => onDrop(e, p.id)}>
                  <td>
                    <div className="order-cell">
                      <span className="order-num">{i + 1}</span>
                      {isAdmin && !onlyTemplate && (
                        <span className="order-move">
                          <button className="icon" title="Move up" aria-label={`Move ${p.name} up`} disabled={i === 0} onClick={() => move(p.id, -1)}>
                            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M4 10l4-4 4 4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
                          </button>
                          <button className="icon" title="Move down" aria-label={`Move ${p.name} down`} disabled={i === list.length - 1} onClick={() => move(p.id, 1)}>
                            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
                          </button>
                        </span>
                      )}
                    </div>
                  </td>
                  <td>
                    <button className="link-button rule-name" onClick={() => setEditing({ ...p })}>{p.name}</button>
                    {scheduleText(p) && <div className="sub">{scheduleText(p)} {scheduleState(p) === "upcoming" && <Badge tone="info">Not started</Badge>}{scheduleState(p) === "ended" && <Badge>Ended</Badge>}</div>}
                  </td>
                  <td>{(() => { const t = sendersText(p); return <>{t.main === "Everyone" ? <span className="sub">Everyone</span> : t.main}{t.except > 0 && <div className="sub">except {t.except}</div>}</>; })()}</td>
                  <td className="nowrap">{R_SHORT[p.recipient_type] ?? p.recipient_type}<div className="sub">{depts(p.recipient_domains).length ? `To ${depts(p.recipient_domains).join(", ")}` : T_SHORT[p.message_type] ?? p.message_type}</div></td>
                  <td>
                    <Link to={`/signatures/${p.template_id}`}>{p.template_name ?? "Missing"}</Link>
                    {t && !t.live_version && <div><Badge tone="bad">Not live: skipped</Badge></div>}
                  </td>
                  <td><Toggle ariaLabel={`Rule ${p.name} on`} label="" checked={p.enabled} disabled={!isAdmin} onChange={() => toggle(p)} /></td>
                  <td className="actions">
                    {isAdmin && <>
                      <button className="ghost small" aria-label={`Duplicate ${p.name}`} onClick={() => duplicate(p)}>Duplicate</button>
                      <button className="ghost small" onClick={() => remove(p)} aria-label={`Delete ${p.name}`}>Delete</button>
                    </>}
                  </td>
                </tr>
              );
            })}
            {shown.length === 0 && <tr><td colSpan={7} className="sub">No rules{onlyTemplate ? " send this signature" : " yet"}.</td></tr>}
          </tbody>
        </table>
        <div className="rules-foot">If no rule matches, the email is sent without a signature. <Link to="/rules?tab=coverage">Check coverage</Link></div>
      </div>

      {editing && (
        <RuleEditor form={editing} templates={templates.data ?? []} people={people.data ?? []} readOnly={!isAdmin}
          onClose={() => setEditing(null)}
          onSave={async (f) => {
            const ok = await act(() => api(f.id ? `/policies/${f.id}` : "/policies", { method: f.id ? "PUT" : "POST", body: bodyOf(f) }),
              f.id ? "Rule saved." : "Rule created.");
            if (ok) setEditing(null);
          }} />
      )}
      {confirmDialog}
    </>
  );
}

// ---------------------------------------------------------------- stepped editor

const STEPS = ["Name and dates", "Senders", "Recipients", "Email type", "Signature"] as const;

function RuleEditor({ form, templates, people, readOnly, onClose, onSave }: {
  form: Form; templates: TemplateRow[]; people: Employee[]; readOnly: boolean; onClose: () => void; onSave: (f: Form) => void;
}) {
  const [f, setF] = useState<Form>(form);
  const [step, setStep] = useState(0);
  const [extra, setExtra] = useState("");
  const [previews, setPreviews] = useState<Record<number, string>>({});
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF({ ...f, [k]: v });
  const chosen = depts(f.departments);
  const scoped = chosen.length > 0;
  const allDepts = useMemo(() => {
    const counts = new Map<string, number>();
    people.forEach((p) => p.department && counts.set(p.department, (counts.get(p.department) ?? 0) + 1));
    chosen.forEach((d) => counts.has(d) || counts.set(d, 0));
    return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [people, f.departments]); // eslint-disable-line react-hooks/exhaustive-deps
  const named = lower(f.people);
  const excluded = lower(f.exclude_people);
  const scopedAny = scoped || named.length > 0;
  const matching = people.filter((p) => !excluded.includes(p.email.toLowerCase()) && (!scopedAny
    || chosen.some((d) => d.toLowerCase() === p.department.toLowerCase()) || named.includes(p.email.toLowerCase()))).length;
  const addTo = (k: "people" | "exclude_people", email: string) => set(k, [...depts(f[k]), email].filter((x, i, a) => a.indexOf(x) === i).join(", "));
  const dropFrom = (k: "people" | "exclude_people", email: string) => set(k, depts(f[k]).filter((x) => x.toLowerCase() !== email.toLowerCase()).join(", "));
  const [domainDraft, setDomainDraft] = useState("");
  const toggleDept = (d: string, on: boolean) => set("departments", (on ? [...chosen, d] : chosen.filter((x) => x !== d)).join(", "));

  useEffect(() => {
    if (step !== 4) return;
    templates.forEach((t) => {
      const html = t.live_html ?? t.latest?.html;
      if (!html || previews[t.id]) return;
      api<{ html: string }>("/templates/preview", { body: { html, employee_email: people[0]?.email ?? "", with_extras: false } })
        .then((r) => setPreviews((m) => ({ ...m, [t.id]: r.html }))).catch(() => undefined);
    });
  }, [step, templates, people]); // eslint-disable-line react-hooks/exhaustive-deps

  const summary = [
    [f.name || "Untitled", scheduleText(f)].filter(Boolean).join(" · "),
    `${scopedAny ? sendersText(f).main : "Everyone"} (${matching} ${matching === 1 ? "person" : "people"})`,
    [RECIPIENTS.find((r) => r[0] === f.recipient_type)?.[1], depts(f.recipient_domains).length ? `to ${depts(f.recipient_domains).join(", ")}` : ""].filter(Boolean).join(", "),
    TYPES.find((t) => t[0] === f.message_type)?.[1],
    templates.find((t) => t.id === f.template_id)?.name ?? "Not chosen",
  ];
  const badDates = !!(f.starts_at && f.ends_at && asUtc(f.ends_at) <= asUtc(f.starts_at));
  const valid = f.name.trim() && f.template_id && !badDates;

  return (
    <Drawer title={f.id ? `Edit rule: ${form.name}` : "New rule"} onClose={onClose} width={820}
      footer={<>
        <button className="secondary" onClick={onClose}>Cancel</button>
        {step > 0 && <button className="secondary" onClick={() => setStep(step - 1)}>Back</button>}
        {step < STEPS.length - 1 && <button className="secondary" onClick={() => setStep(step + 1)}>Next</button>}
        {!readOnly && <button disabled={!valid} onClick={() => onSave(f)}>{f.id ? "Save rule" : "Create rule"}</button>}
      </>}>
      <div className="steps-layout">
        <ol className="step-nav">
          {STEPS.map((s, i) => (
            <li key={s}>
              <button className={step === i ? "on" : ""} onClick={() => setStep(i)} aria-current={step === i ? "step" : undefined}>
                <span className="step-num">{i + 1}</span>
                <span className="step-text"><strong>{s}</strong><small>{summary[i]}</small></span>
              </button>
            </li>
          ))}
        </ol>
        <fieldset className="step-body" disabled={readOnly}>
          {step === 0 && (
            <>
              <h3>Name</h3>
              <label className="field">Rule name<input autoFocus value={f.name} placeholder="e.g. Sales to customers" onChange={(e) => set("name", e.target.value)} /></label>
              <div style={{ marginTop: 16 }}><Toggle label="Rule is on" checked={f.enabled} onChange={(v) => set("enabled", v)} /></div>
              <p className="hint">New rules are added at the bottom of the list. Change the order from the rules list.</p>
              <h3 style={{ marginTop: 24 }}>Dates (optional)</h3>
              <p className="hint" style={{ marginTop: 0 }}>Outside these dates the rule is skipped and the next rule applies. Leave empty to run all the time.</p>
              <div className="two">
                <label className="field">Starts<input type="datetime-local" value={toLocalInput(f.starts_at)} onChange={(e) => set("starts_at", fromLocalInput(e.target.value))} /></label>
                <label className="field">Ends<input type="datetime-local" value={toLocalInput(f.ends_at)} onChange={(e) => set("ends_at", fromLocalInput(e.target.value))} /></label>
              </div>
              {badDates && <p className="note bad" role="alert">The end must be after the start.</p>}
            </>
          )}
          {step === 1 && (
            <>
              <h3>Who sends the email</h3>
              <label className="radio-card"><input type="radio" name="senders" checked={!scopedAny} onChange={() => setF({ ...f, departments: "", people: "" })} />
                <span><strong>Everyone in the organisation</strong><small>{people.length} people</small></span></label>
              <label className="radio-card"><input type="radio" name="senders" checked={scopedAny} onChange={() => !scopedAny && set("departments", allDepts[0]?.[0] ?? "")} />
                <span><strong>Only some people</strong><small>Pick departments, named people, or both</small></span></label>
              {scoped && (
                <div className="dept-list">
                  {allDepts.map(([d, n]) => (
                    <label key={d} className="check"><input type="checkbox" checked={chosen.includes(d)} onChange={(e) => toggleDept(d, e.target.checked)} /> {d} <span className="sub">{n}</span></label>
                  ))}
                  <div className="row tight" style={{ marginTop: 8 }}>
                    <input value={extra} placeholder="Another department" onChange={(e) => setExtra(e.target.value)} aria-label="Add department" />
                    <button className="secondary small" disabled={!extra.trim()} onClick={() => { toggleDept(extra.trim(), true); setExtra(""); }}>Add</button>
                  </div>
                </div>
              )}
              {scopedAny && (
                <PeoplePicker label="Also these people" people={people} chosen={named} onAdd={(e) => addTo("people", e)} onRemove={(e) => dropFrom("people", e)} />
              )}
              <PeoplePicker label="Except these people" hint="They never get this rule, even if their department matches." people={people} chosen={excluded}
                onAdd={(e) => addTo("exclude_people", e)} onRemove={(e) => dropFrom("exclude_people", e)} />
              <p className="hint">Applies to {matching} {matching === 1 ? "person" : "people"}. Delegated email follows the mailbox owner.</p>
            </>
          )}
          {step === 2 && (
            <>
              <h3>Who receives it</h3>
              {RECIPIENTS.map(([v, label, hint]) => (
                <label key={v} className="radio-card"><input type="radio" name="rcpt" checked={f.recipient_type === v} onChange={() => set("recipient_type", v)} />
                  <span><strong>{label}</strong><small>{hint}</small></span></label>
              ))}
              <h3 style={{ marginTop: 24 }}>Only to these domains (optional)</h3>
              <p className="hint" style={{ marginTop: 0 }}>For a key customer or partner. At least one recipient must be in a listed domain; subdomains count.</p>
              <div className="chips">
                {depts(f.recipient_domains).map((d) => (
                  <span key={d} className="chip">{d}<button type="button" className="chip-x" aria-label={`Remove ${d}`} onClick={() => set("recipient_domains", depts(f.recipient_domains).filter((x) => x !== d).join(", "))}>×</button></span>
                ))}
              </div>
              <form className="row tight" style={{ marginTop: 8 }} onSubmit={(e) => {
                e.preventDefault();
                const d = domainDraft.trim().toLowerCase().replace(/^@/, "");
                if (!d.includes(".") || d.includes(" ") || d.includes("@")) return;
                set("recipient_domains", [...depts(f.recipient_domains), d].filter((x, i, a) => a.indexOf(x) === i).join(", "));
                setDomainDraft("");
              }}>
                <input value={domainDraft} placeholder="fabrikam.com" aria-label="Recipient domain" onChange={(e) => setDomainDraft(e.target.value)} />
                <button type="submit" className="secondary small" disabled={!domainDraft.trim().includes(".")}>Add domain</button>
              </form>
              <p className="hint">External email also gets a verification code where the signature has one.</p>
            </>
          )}
          {step === 3 && (
            <>
              <h3>Which emails</h3>
              {TYPES.map(([v, label]) => (
                <label key={v} className="radio-card"><input type="radio" name="type" checked={f.message_type === v} onChange={() => set("message_type", v)} />
                  <span><strong>{label}</strong></span></label>
              ))}
            </>
          )}
          {step === 4 && (
            <>
              <h3>Signature to add</h3>
              <div className="pick-grid">
                {templates.map((t) => (
                  <button key={t.id} type="button" className={`pick ${f.template_id === t.id ? "on" : ""}`} aria-pressed={f.template_id === t.id} onClick={() => set("template_id", t.id)}>
                    <SignatureThumb html={previews[t.id] ?? ""} height={110} />
                    <span>{t.name}{t.live_version ? <Badge tone="good">Live</Badge> : <Badge tone="warn">Not live</Badge>}</span>
                  </button>
                ))}
              </div>
              {templates.find((t) => t.id === f.template_id && !t.live_version) && <p className="note warn" style={{ marginTop: 12 }}>This signature isn't live yet, so the rule is skipped until a version is approved.</p>}
            </>
          )}
        </fieldset>
      </div>
    </Drawer>
  );
}

function PeoplePicker({ label, hint, people, chosen, onAdd, onRemove }: {
  label: string; hint?: string; people: Employee[]; chosen: string[]; onAdd: (email: string) => void; onRemove: (email: string) => void;
}) {
  const [q, setQ] = useState("");
  const query = q.trim().toLowerCase();
  const hits = query.length < 1 ? [] : people.filter((p) => !chosen.includes(p.email.toLowerCase())
    && `${p.name} ${p.email} ${p.department}`.toLowerCase().includes(query)).slice(0, 6);
  const byEmail = (e: string) => people.find((p) => p.email.toLowerCase() === e);
  return (
    <div className="people-picker">
      <h4>{label}</h4>
      {hint && <p className="hint" style={{ marginTop: 0 }}>{hint}</p>}
      {chosen.length > 0 && (
        <div className="chips">
          {chosen.map((e) => (
            <span key={e} className="chip" title={e}>{byEmail(e)?.name ?? e}
              <button type="button" className="chip-x" aria-label={`Remove ${byEmail(e)?.name ?? e}`} onClick={() => onRemove(e)}>×</button></span>
          ))}
        </div>
      )}
      <div className="combo">
        <input value={q} placeholder="Search by name, email or department" aria-label={label} onChange={(e) => setQ(e.target.value)} />
        {hits.length > 0 && (
          <ul className="combo-list" role="listbox" aria-label={`${label}: matches`}>
            {hits.map((p) => (
              <li key={p.email}><button type="button" onClick={() => { onAdd(p.email.toLowerCase()); setQ(""); }}>
                <strong>{p.name}</strong><span className="sub">{p.email} · {p.department || "No department"}</span></button></li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- tester (Exclaimer-style)

interface TestResult {
  html: string; template_name: string | null; policy_name: string | null; recipient_type: string; reason: string;
  on_behalf_of: string | null; warnings: string[]; campaign?: string | null; disclaimers?: string[];
}

function Tester({ me }: { me: Employee }) {
  const people = useLoad(() => api<Employee[]>("/employees"));
  const policies = useLoad(() => api<Policy[]>("/policies"));
  const templates = useLoad(() => api<TemplateRow[]>("/templates"));
  const [sender, setSender] = useState(me.email);
  const [from, setFrom] = useState("");
  const [recipients, setRecipients] = useState("buyer@fabrikam.com");
  const [type, setType] = useState("new");
  const [result, setResult] = useState<TestResult | null>(null);
  const [ran, setRan] = useState<{ dept: string; email: string; recipients: string[]; at: Date } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true); setError(null);
    try {
      const list = recipients.split(/[,;\s]+/).filter(Boolean);
      const r = await api<TestResult>("/policies/test", {
        body: { sender_email: sender, recipients: list, message_type: type, from_email: from || null },
      });
      const s = people.data?.find((p) => p.email === sender);
      const owner = r.on_behalf_of ? people.data?.find((p) => p.email === from) : null;
      const who = owner ?? s;
      setRan({ dept: who?.department ?? "", email: (who?.email ?? sender).toLowerCase(), recipients: list, at: new Date() });
      setResult(r);
      policies.reload(); templates.reload();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };

  const evaluated = useMemo(() => {
    if (!result || !ran) return [];
    let matched = false;
    const mtype = type === "forward" ? "reply" : type;
    return (policies.data ?? []).map((p) => {
      const ds = lower(p.departments);
      const named = lower(p.people);
      const excluded = lower(p.exclude_people);
      const wanted = lower(p.recipient_domains);
      const t = templates.data?.find((x) => x.id === p.template_id);
      const senderOk = !excluded.includes(ran.email) && ((!ds.length && !named.length) || ds.includes(ran.dept.toLowerCase()) || named.includes(ran.email));
      const sched = scheduleState(p, ran.at);
      const domainsOk = !wanted.length || ran.recipients.some((r) => inDomains(domainOf(r), wanted));
      const checks: [string, boolean, string][] = [
        ["Rule is on", p.enabled, p.enabled ? "On" : "Off"],
        ...(scheduleText(p) ? [["Dates", !sched, `${scheduleText(p)}${sched === "upcoming" ? " · not started" : sched === "ended" ? " · ended" : ""}`] as [string, boolean, string]] : []),
        ["Senders", senderOk, excluded.includes(ran.email) ? "Sender is in the exceptions" : (ds.length || named.length) ? `${sendersText(p).main} · sender is in ${ran.dept || "no department"}` : "Everyone"],
        ["Recipients", p.recipient_type === "any" || p.recipient_type === result.recipient_type, `${R_SHORT[p.recipient_type]} · email is ${result.recipient_type}`],
        ...(wanted.length ? [["Recipient domains", domainsOk, `${wanted.join(", ")}${domainsOk ? "" : " · no recipient there"}`] as [string, boolean, string]] : []),
        ["Email type", p.message_type === "any" || p.message_type === mtype, `${T_SHORT[p.message_type]} · this is a ${mtype === "new" ? "new email" : "reply"}`],
        ["Signature live", !!t?.live_version, t?.live_version ? `${t.name} v${t.live_version}` : "No live version"],
      ];
      const ok = checks.every((c) => c[1]);
      const state = matched ? "not_reached" : ok ? "applied" : "skipped";
      if (ok && !matched) matched = true;
      return { p, checks, state };
    });
  }, [result, ran, policies.data, templates.data, type]);
  const clientWinner = evaluated.find((e) => e.state === "applied")?.p.name ?? null;

  return (
    <div className="tester">
      <div className="card tester-form">
        <h2>Test email</h2>
        <div className="form-grid">
          <label>Sender
            <select value={sender} onChange={(e) => setSender(e.target.value)}>
              {people.data?.map((p) => <option key={p.email} value={p.email}>{p.name} · {p.department || "no department"}</option>)}
            </select>
          </label>
          <label>Send from
            <select value={from} onChange={(e) => setFrom(e.target.value)}>
              <option value="">Their own mailbox</option>
              {people.data?.filter((p) => p.email !== sender).map((p) => <option key={p.email} value={p.email}>{p.name}'s mailbox</option>)}
            </select>
          </label>
          <label className="span">Recipients<input value={recipients} onChange={(e) => setRecipients(e.target.value)} placeholder="name@company.com, separated by commas" /></label>
          <label>Email type
            <span className="seg">
              {[["new", "New"], ["reply", "Reply"], ["forward", "Forward"]].map(([v, l]) => <button key={v} type="button" className={type === v ? "on" : ""} onClick={() => setType(v)}>{l}</button>)}
            </span>
          </label>
        </div>
        <div className="row"><button onClick={run} disabled={busy}>{busy ? "Testing…" : "Run test"}</button><span className="sub">Nothing is sent and no verification code is issued.</span></div>
      </div>
      <ErrorNote error={error} />

      {result && (
        <div className="two-wide">
          <div>
            <h2>How the rules were applied</h2>
            <ol className="eval-list">
              {evaluated.map(({ p, checks, state }) => (
                <li key={p.id} className={`eval ${state}`}>
                  <div className="eval-head">
                    <span className={`dot ${state === "applied" ? "good" : state === "skipped" ? "warn" : ""}`} />
                    <strong>{p.name}</strong>
                    <span className="eval-state">{state === "applied" ? "Signature applied" : state === "skipped" ? "Conditions not met" : "Not checked: an earlier rule matched"}</span>
                  </div>
                  {state !== "not_reached" && (
                    <ul className="eval-checks">
                      {checks.map(([label, ok, detail]) => (
                        <li key={label} className={ok ? "ok" : "fail"}><span aria-label={ok ? "met" : "not met"}>{ok ? "✓" : "✕"}</span><b>{label}</b><span className="sub">{detail}</span></li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ol>
            {clientWinner !== result.policy_name && (
              <p className="note warn">SignGuard used {result.policy_name ? `"${result.policy_name}"` : "no rule"}: {result.warnings.join(" ") || "a template failed its integrity check or the sender's department changed."}</p>
            )}
          </div>
          <div className="card">
            <h2>Result</h2>
            {result.template_name ? (
              <>
                <div className="result-line"><Badge tone="good">Signature applied</Badge> <strong>{result.template_name}</strong> <span className="sub">via {result.policy_name}</span></div>
                <dl className="facts">
                  <div><dt>Recipients</dt><dd>{result.recipient_type === "external" ? "External" : "All internal"}</dd></div>
                  <div><dt>Banner</dt><dd>{result.campaign ?? "None"}</dd></div>
                  <div><dt>Disclaimers</dt><dd>{result.disclaimers?.length ? result.disclaimers.join(", ") : "None"}</dd></div>
                  {result.on_behalf_of && <div><dt>On behalf of</dt><dd>{result.on_behalf_of}</dd></div>}
                </dl>
              </>
            ) : <div className="result-line"><Badge tone="bad">No signature</Badge> <span className="sub">{result.reason}</span></div>}
            {result.warnings.map((w) => <div key={w} className="note warn">{w}</div>)}
            <iframe className="sig-preview" sandbox="" title="Signature result" style={{ height: 320 }}
              srcDoc={`<!doctype html><html><body style="margin:12px;background:#fff">${result.html}</body></html>`} />
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- coverage

interface Cell { policy: string | null; template: string | null; banner: string | null; disclaimers: number }
interface Matrix { cases: string[]; rows: { department: string; people: number; cells: Record<string, Cell> }[] }
const CASE_TEXT: Record<string, string> = { external_new: "External · new", external_reply: "External · reply", internal_new: "Internal · new", internal_reply: "Internal · reply" };

function Coverage() {
  const { data, error } = useLoad(() => api<Matrix>("/assignments"));
  const gaps = data?.rows.filter((r) => Object.values(r.cells).some((c) => !c.template)).length ?? 0;
  return (
    <>
      <ErrorNote error={error} />
      <p className="sub">The signature each department gets for each kind of email, worked out from the live rules, banners and disclaimers.</p>
      {gaps > 0 && <div className="note warn">{gaps} department{gaps > 1 ? "s" : ""} send some email without a signature. <Link to="/settings/automation">See suggested fixes</Link></div>}
      {data && (
        <div className="card flush table-wrap">
          <table className="matrix">
            <thead><tr><th>Department</th>{data.cases.map((c) => <th key={c}>{CASE_TEXT[c] ?? c}</th>)}</tr></thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.department}>
                  <td><strong>{r.department}</strong><div className="sub">{r.people} {r.people === 1 ? "person" : "people"}</div></td>
                  {data.cases.map((c) => {
                    const cell = r.cells[c];
                    return (
                      <td key={c} className={cell.template ? "" : "gap"}>
                        {cell.template ? (
                          <>
                            <div className="cell-template">{cell.template}</div>
                            <div className="sub">{cell.policy}</div>
                            {(cell.banner || cell.disclaimers > 0) && (
                              <div className="sub">{[cell.banner && `Banner: ${cell.banner}`, cell.disclaimers > 0 && `${cell.disclaimers} disclaimer${cell.disclaimers > 1 ? "s" : ""}`].filter(Boolean).join(" · ")}</div>
                            )}
                          </>
                        ) : <Badge tone="bad">No signature</Badge>}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
