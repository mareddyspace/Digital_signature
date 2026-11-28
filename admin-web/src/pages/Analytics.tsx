import { useState, type MouseEvent } from "react";
import { api } from "../api";
import { Badge, ErrorNote, Page, StatTile, useLoad } from "../ui";

interface Data {
  days: number;
  totals: Record<string, number>;
  series: { date: string; external: number; internal: number; verified: number; failed: number }[];
  by_template: { name: string; count: number }[];
  by_department: { department: string; external: number; internal: number }[];
  campaigns: { id: number; name: string; state: string; impressions: number; clicks: number; ctr: number }[];
}

// Validated categorical pair (CVD-safe on white): identity, not status.
const SERIES = [
  { key: "external" as const, label: "External", color: "#2878d0" },
  { key: "internal" as const, label: "Internal", color: "#d97a1e" },
];

export default function Analytics() {
  const [days, setDays] = useState(30);
  const { data, error } = useLoad(() => api<Data>(`/analytics?days=${days}`), [days]);
  const [table, setTable] = useState(false);
  const t = data?.totals;

  return (
    <Page
      title="Analytics"
      intro="How signatures are used across the company: email volume, coverage, campaign performance and sender verification."
      actions={
        <div className="seg-control" role="group" aria-label="Time range">
          {[7, 30, 90].map((d) => <button key={d} className={days === d ? "on" : ""} onClick={() => setDays(d)}>{d} days</button>)}
        </div>
      }
    >
      <ErrorNote error={error} />
      {data && t && (
        <>
          {(t.not_from_outlook ?? 0) > 0 && (
            <p className="note info">Counts below are real Outlook email only. {t.not_from_outlook} {t.not_from_outlook === 1 ? "signature" : "signatures"} from the Outlook simulator or from before 28 Nov 2026 are left out.</p>
          )}
          <div className="stats">
            <StatTile label="Signatures served" value={t.signatures.toLocaleString()} note={`${t.external} external · ${t.internal} internal`} />
            <StatTile label="Add-in coverage" value={`${t.coverage_pct}%`} note={`${t.active_senders} of ${t.employees} people, real Outlook only`} tone={t.coverage_pct >= 80 ? "good" : t.coverage_pct >= 40 ? undefined : "warn"} />
            <StatTile label="Banner click-through" value={`${t.banner_ctr}%`} note={`${t.banner_clicks} clicks from ${t.banner_impressions} views`} />
            <StatTile label="Verification checks" value={t.verifications_passed + t.verifications_failed} note={`${t.verifications_failed} failed`} tone={t.verifications_failed ? "bad" : undefined} />
          </div>

          <div className="card section">
            <div className="row between">
              <h2>Signatures per day</h2>
              <button className="link-button" onClick={() => setTable(!table)}>{table ? "Show chart" : "Show table"}</button>
            </div>
            {table ? (
              <div className="matrix-wrap">
                <table>
                  <thead><tr><th>Date</th><th>External</th><th>Internal</th><th>Verified</th><th>Failed checks</th></tr></thead>
                  <tbody>{data.series.map((r) => <tr key={r.date}><td>{r.date}</td><td>{r.external}</td><td>{r.internal}</td><td>{r.verified}</td><td>{r.failed}</td></tr>)}</tbody>
                </table>
              </div>
            ) : <LineChart rows={data.series} />}
          </div>

          <div className="two section">
            <div className="card">
              <h2>By template</h2>
              <Bars rows={data.by_template.map((r) => ({ label: r.name, value: r.count }))} />
            </div>
            <div className="card">
              <h2>By department</h2>
              <table>
                <thead><tr><th>Department</th><th>External</th><th>Internal</th></tr></thead>
                <tbody>
                  {data.by_department.map((r) => <tr key={r.department}><td>{r.department}</td><td>{r.external}</td><td>{r.internal}</td></tr>)}
                  {data.by_department.length === 0 && <tr><td colSpan={3} className="sub">No email yet in this period.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card section">
            <h2>Campaigns</h2>
            <table>
              <thead><tr><th>Banner</th><th>Status</th><th>Views</th><th>Clicks</th><th>CTR</th></tr></thead>
              <tbody>
                {data.campaigns.map((c) => (
                  <tr key={c.id}><td>{c.name}</td><td><Badge tone={c.state === "live" ? "good" : "neutral"}>{c.state}</Badge></td><td>{c.impressions}</td><td>{c.clicks}</td><td>{c.ctr}%</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Page>
  );
}

function LineChart({ rows }: { rows: Data["series"] }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 760, H = 240, L = 40, R = 76, T = 14, B = 28;
  const max = Math.max(4, ...rows.flatMap((r) => [r.external, r.internal]));
  const nice = Math.ceil(max / 4) * 4;
  const x = (i: number) => L + (rows.length <= 1 ? 0 : (i * (W - L - R)) / (rows.length - 1));
  const y = (v: number) => T + (H - T - B) * (1 - v / nice);
  const ticks = [0, nice / 4, nice / 2, (3 * nice) / 4, nice];
  const every = Math.max(1, Math.ceil(rows.length / 8));
  const last = rows.length - 1;
  // End-of-line labels: keep them at least 14px apart when the two lines finish close together.
  const endY = { external: y(rows[last]?.external ?? 0), internal: y(rows[last]?.internal ?? 0) };
  const gap = 14 - Math.abs(endY.external - endY.internal);
  const labelY = gap > 0
    ? (endY.external <= endY.internal
      ? { external: endY.external - gap / 2, internal: endY.internal + gap / 2 }
      : { external: endY.external + gap / 2, internal: endY.internal - gap / 2 })
    : endY;
  const over = Math.max(labelY.external, labelY.internal) - y(0);
  if (over > 0) { labelY.external -= over; labelY.internal -= over; }
  const short = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short" });

  const onMove = (e: MouseEvent<SVGRectElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - box.left) / box.width) * (W - L - R);
    setHover(Math.max(0, Math.min(last, Math.round((px / (W - L - R)) * last))));
  };

  return (
    <div className="chart">
      <div className="legend">
        {SERIES.map((s) => <span key={s.key}><i style={{ background: s.color }} />{s.label}</span>)}
      </div>
      <div className="chart-box">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Signatures per day, external and internal">
          {ticks.map((v) => (
            <g key={v}>
              <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} className="grid" />
              <text x={L - 8} y={y(v) + 4} className="axis" textAnchor="end">{v}</text>
            </g>
          ))}
          {rows.map((r, i) => ((i % every === 0 && last - i >= Math.ceil(every / 2) + 1) || i === last) && (
            <text key={r.date} x={x(i)} y={H - 8} className="axis" textAnchor="middle">{short(r.date)}</text>
          ))}
          {SERIES.map((s) => (
            <g key={s.key}>
              <polyline fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round"
                points={rows.map((r, i) => `${x(i)},${y(r[s.key])}`).join(" ")} />
              <text x={x(last) + 8} y={labelY[s.key] + 4} className="direct-label">{s.label}</text>
            </g>
          ))}
          {hover !== null && (
            <g>
              <line x1={x(hover)} x2={x(hover)} y1={T} y2={H - B} className="crosshair" />
              {SERIES.map((s) => <circle key={s.key} cx={x(hover)} cy={y(rows[hover][s.key])} r={4.5} fill={s.color} stroke="var(--surface)" strokeWidth={2} />)}
            </g>
          )}
          <rect x={L} y={T} width={W - L - R} height={H - T - B} fill="transparent" onMouseMove={onMove} onMouseLeave={() => setHover(null)} />
        </svg>
        {hover !== null && (
          <div className="tooltip" style={{ left: `${(x(hover) / W) * 100}%` }}>
            <strong>{short(rows[hover].date)}</strong>
            {SERIES.map((s) => <div key={s.key}><i style={{ background: s.color }} />{s.label}: {rows[hover][s.key]}</div>)}
            <div className="sub">{rows[hover].verified} verified · {rows[hover].failed} failed checks</div>
          </div>
        )}
      </div>
    </div>
  );
}

function Bars({ rows }: { rows: { label: string; value: number }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  if (rows.length === 0) return <div className="empty">No email yet in this period.</div>;
  return (
    <div className="bars">
      {rows.map((r) => (
        <div key={r.label} className="bar-row" title={`${r.label}: ${r.value}`}>
          <span className="bar-label">{r.label}</span>
          <span className="bar-track"><span className="bar" style={{ width: `${(100 * r.value) / max}%` }} /></span>
          <span className="bar-value">{r.value}</span>
        </div>
      ))}
    </div>
  );
}
