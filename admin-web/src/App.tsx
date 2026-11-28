import { useEffect, useRef, useState } from "react";
import { NavLink, Navigate, Route, Routes, useLocation, useMatch, useNavigate } from "react-router-dom";

import { api, getDevUser, setDevUser, type Me } from "./api";
import { signIn, signOut, type AuthState } from "./auth";

import Home from "./pages/Home";
import Signatures from "./pages/Signatures";
import SignatureEditor from "./pages/SignatureEditor";
import Rules from "./pages/Rules";
import Campaigns from "./pages/Campaigns";
import Disclaimers from "./pages/Disclaimers";
import Analytics from "./pages/Analytics";
import People from "./pages/People";
import Delegations from "./pages/Delegations";
import Permissions from "./pages/Permissions";
import Integrity from "./pages/Integrity";
import AuditLog from "./pages/AuditLog";
import BrandKit from "./pages/BrandKit";
import Integrations from "./pages/Integrations";
import Automation from "./pages/Automation";
import MyTrust from "./pages/MyTrust";
import Compose from "./pages/Compose";

type DevUser = { email: string; name: string; role: string };
type Counts = { pending_template_approvals: number; pending_delegations: number; flagged_permissions: number };

const READ = ["admin", "dept_admin", "auditor"];
const AUDIT = ["admin", "auditor"];

// One line-icon set (24px grid, 1.75 stroke, currentColor). Paths drawn in the Lucide style.
const ICONS: Record<string, string> = {
  home: "M3 10.5 12 3l9 7.5M5 9.5V20a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V9.5",
  signatures: "M4 4h16v16H4zM8 9h8M8 13h8M8 17h5",
  rules: "M3 6h11M3 12h18M3 18h8M17 3v6M14 6h6M15 16l2 2 4-4",
  campaigns: "M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1zM15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13",
  disclaimers: "M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5M9 13h6M9 17h6",
  analytics: "M3 3v18h18M7 15l4-4 3 3 6-6",
  people: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8",
  delegations: "M17 3l4 4-4 4M21 7H9M7 21l-4-4 4-4M3 17h12",
  permissions: "M5 11h14a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1zM8 11V7a4 4 0 0 1 8 0v4",
  integrity: "M12 22s8-3.5 8-10V5l-8-3-8 3v7c0 6.5 8 10 8 10zM9 12l2 2 4-4",
  audit: "M12 8v4l3 2M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5",
  brand: "M12 21a9 9 0 1 1 9-9c0 2.2-1.8 3-3.5 3H15a2 2 0 0 0-1.4 3.4c.5.5.4 1.6-.4 2.2-.4.3-.8.4-1.2.4zM7.5 11.5h.01M10.5 7.5h.01M15.5 8.5h.01",
  integrations: "M9 7V2M15 7V2M6 7h12v4a6 6 0 0 1-12 0zM12 17v5",
  automation: "M21 12a9 9 0 0 1-15.4 6.4M3 12A9 9 0 0 1 18.4 5.6M18 2v4h-4M6 22v-4h4",
  mysig: "M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8",
  compose: "M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z",
  settings: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z",
  search: "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3",
  menu: "M4 6h16M4 12h16M4 18h16",
  external: "M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6",
};

function Icon({ name }: { name: string }) {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d={ICONS[name]} /></svg>;
}

type Item = { to: string; label: string; icon: string; roles?: string[]; count?: keyof Counts };
const NAV: { title?: string; items: Item[] }[] = [
  {
    title: "Overview",
    items: [
      { to: "/home", label: "Home", icon: "home", roles: READ },
      { to: "/my-trust", label: "My signature", icon: "mysig" },
    ],
  },
  {
    title: "Signatures",
    items: [
      { to: "/signatures", label: "Signatures", icon: "signatures", roles: READ, count: "pending_template_approvals" },
      { to: "/rules", label: "Rules", icon: "rules", roles: READ },
      { to: "/campaigns", label: "Campaigns", icon: "campaigns", roles: READ },
      { to: "/disclaimers", label: "Disclaimers", icon: "disclaimers", roles: READ },
    ],
  },
  {
    title: "People & access",
    items: [
      { to: "/people", label: "People", icon: "people", roles: READ },
      { to: "/delegations", label: "Delegations", icon: "delegations", count: "pending_delegations" },
      { to: "/permissions", label: "Mailbox access", icon: "permissions", roles: AUDIT, count: "flagged_permissions" },
    ],
  },
  {
    title: "Insights",
    items: [
      { to: "/analytics", label: "Analytics", icon: "analytics", roles: READ },
      { to: "/integrity", label: "Integrity", icon: "integrity", roles: READ },
      { to: "/audit", label: "Audit log", icon: "audit", roles: AUDIT },
    ],
  },
];

// Settings live behind the gear in the app bar.
const SETTINGS: Item[] = [
  { to: "/settings/brand", label: "Brand kit", icon: "brand", roles: READ },
  { to: "/settings/integrations", label: "Integrations", icon: "integrations", roles: READ },
  { to: "/settings/automation", label: "Automation & approvals", icon: "automation", roles: READ },
];

const TITLES: [string, string][] = [
  ["/home", "Home"], ["/signatures", "Signatures"], ["/rules", "Rules"], ["/campaigns", "Campaigns"],
  ["/disclaimers", "Disclaimers"], ["/analytics", "Analytics"], ["/people", "People"], ["/delegations", "Delegations"],
  ["/permissions", "Mailbox access"], ["/integrity", "Integrity"], ["/audit", "Audit log"], ["/settings/brand", "Brand kit"],
  ["/settings/integrations", "Integrations"], ["/settings/automation", "Automation & approvals"], ["/my-trust", "My signature"],
  ["/compose", "Outlook simulator"],
];

const ROLE_TEXT: Record<string, string> = { admin: "Administrator", dept_admin: "Department admin", auditor: "Auditor", employee: "Employee" };

function initials(name: string) {
  return name.split(/[\s._-]+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join("") || "U";
}

export default function App({ auth }: { auth: AuthState }) {
  if (auth.mode === "entra" && !auth.account) return <SignIn error={auth.error} />;
  return <SignedIn auth={auth} />;
}

/** Shown in AUTH_MODE=entra until the person has signed in with Microsoft. */
function SignIn({ error }: { error: string | null }) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="signin">
      <div className="signin-card">
        <div className="header-brand">
          <svg viewBox="0 0 40 40" width="26" height="26" aria-hidden="true">
            <path d="M20 3L34 8V19C34 28 28 34 20 38C12 34 6 28 6 19V8L20 3Z" fill="currentColor" />
            <path d="M13 20L18 25L28 14" stroke="#fff" strokeWidth="3.2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          SignGuard
        </div>
        <h1>Sign in</h1>
        <p className="sub">Use your work Microsoft account. What you can do in SignGuard comes from the roles your administrator assigns in Microsoft Entra ID.</p>
        {error && <div className="note bad" role="alert">{error}</div>}
        <button disabled={busy} onClick={() => { setBusy(true); signIn().catch(() => setBusy(false)); }}>
          {busy ? "Opening Microsoft sign-in…" : "Sign in with Microsoft"}
        </button>
      </div>
    </div>
  );
}

function SignedIn({ auth }: { auth: AuthState }) {
  const entra = auth.mode === "entra";
  const [user, setUser] = useState(entra ? auth.account?.homeAccountId ?? "" : getDevUser());
  const [me, setMe] = useState<Me | null>(null);
  const [users, setUsers] = useState<DevUser[]>([]);
  const [counts, setCounts] = useState<Counts | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const settingsRef = useRef<HTMLDivElement>(null);
  const location = useLocation();
  const editing = useMatch("/signatures/:id");

  const [demo, setDemo] = useState(false);
  useEffect(() => { if (!entra) api<DevUser[]>("/dev/users").then(setUsers).catch(() => setUsers([])); }, [entra]);
  useEffect(() => { api<{ demo_read_only?: boolean }>("/health").then((h) => setDemo(!!h.demo_read_only)).catch(() => setDemo(false)); }, []);

  useEffect(() => {
    setMe(null);
    setError(null);
    api<Me>("/me").then(setMe).catch((e: Error) => setError(e.message));
  }, [user]);

  // Counts in the sidebar: things waiting for a decision. Refreshed on navigation.
  useEffect(() => {
    if (!me || !READ.includes(me.role)) { setCounts(null); return; }
    api<Counts>("/trust-center").then(setCounts).catch(() => setCounts(null));
  }, [me, location.pathname]);

  useEffect(() => { setNavOpen(false); setMenuOpen(false); setSettingsOpen(false); setPaletteOpen(false); }, [location.pathname]);

  // Ctrl+K (Cmd+K) opens "Go to", a keyboard way to reach any page.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setPaletteOpen(true); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!settingsOpen) return;
    const close = (e: MouseEvent) => { if (!settingsRef.current?.contains(e.target as Node)) setSettingsOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setSettingsOpen(false); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
  }, [settingsOpen]);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent) => { if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setMenuOpen(false); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
  }, [menuOpen]);

  const switchUser = (email: string) => { if (entra) return; setDevUser(email); setUser(email); setMenuOpen(false); };
  const visible = (i: Item) => !i.roles || (me && i.roles.includes(me.role));
  const isStaff = !!me && READ.includes(me.role);
  const home = isStaff ? "/home" : "/my-trust";
  const title = TITLES.find(([p]) => location.pathname.startsWith(p))?.[1] ?? "";
  const displayName = me?.name ?? users.find((u) => u.email === user)?.name ?? user;

  return (
    <div className={`app ${editing ? "full" : ""}`}>
      {!editing && (
        <header className="header">
          <button className="icon menu-toggle" aria-label="Open navigation" onClick={() => setNavOpen(!navOpen)}><Icon name="menu" /></button>
          <NavLink to={home} className="header-brand">
            <svg viewBox="0 0 40 40" width="22" height="22" aria-hidden="true">
              <path d="M20 3L34 8V19C34 28 28 34 20 38C12 34 6 28 6 19V8L20 3Z" fill="currentColor" />
              <path d="M13 20L18 25L28 14" stroke="#fff" strokeWidth="3.2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            SignGuard
          </NavLink>
          <span className="header-title">{title}</span>
          <span className="header-spacer" />
          <button className="header-search" onClick={() => setPaletteOpen(true)} aria-label="Go to a page (Ctrl+K)">
            <Icon name="search" /><span>Go to…</span><kbd>Ctrl K</kbd>
          </button>
          {demo
            ? <span className="env-pill" title="Sample data. Switch accounts to see each role; nothing you change is saved.">Read-only demo</span>
            : !entra && users.length > 0 && <span className="env-pill" title="AUTH_MODE=dev: anyone can act as any user. Use Entra sign-in in production.">Dev sign-in</span>}
          {SETTINGS.some(visible) && (
            <div className="account" ref={settingsRef}>
              <button className="icon header-icon" aria-label="Settings" aria-haspopup="menu" aria-expanded={settingsOpen} onClick={() => setSettingsOpen(!settingsOpen)}><Icon name="settings" /></button>
              {settingsOpen && (
                <div className="menu" role="menu">
                  <div className="menu-section">Settings</div>
                  {SETTINGS.filter(visible).map((i) => (
                    <NavLink key={i.to} to={i.to} className="menu-item with-icon" role="menuitem"><Icon name={i.icon} />{i.label}</NavLink>
                  ))}
                </div>
              )}
            </div>
          )}
          <div className="account" ref={menuRef}>
            <button className="account-button" aria-label={`Account: ${me?.name ?? ""}`} aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}>
              <span className="avatar">{initials(displayName)}</span>
              <span className="account-text">{displayName}<small>{me ? ROLE_TEXT[me.role] ?? me.role : "…"}</small></span>
            </button>
            {menuOpen && (
              <div className="menu" role="menu">
                <NavLink to="/my-trust" className="menu-item" role="menuitem">My signature and access</NavLink>
                <NavLink to="/compose" className="menu-item" role="menuitem">Outlook simulator</NavLink>
                <a href="/verify" target="_blank" rel="noreferrer" className="menu-item" role="menuitem">Public verify page ↗</a>
                {entra && (
                  <>
                    <hr />
                    <div className="menu-section">
                      {me?.identity?.sign_in_name ?? auth.account?.username}
                      {me && <small>{me.role_source === "entra" ? "Role from Microsoft Entra ID" : "Role set in SignGuard"}</small>}
                    </div>
                    <button className="menu-item" role="menuitem" onClick={() => { signOut().catch(() => undefined); }}>Sign out</button>
                  </>
                )}
                {!entra && users.length > 0 && (
                  <>
                    <hr />
                    <div className="menu-section">Switch demo account</div>
                    {users.map((u) => (
                      <button key={u.email} role="menuitemradio" aria-checked={u.email === user} className={`menu-item ${u.email === user ? "on" : ""}`} onClick={() => switchUser(u.email)}>
                        {u.name}<small>{ROLE_TEXT[u.role] ?? u.role}</small>
                      </button>
                    ))}
                  </>
                )}
              </div>
            )}
          </div>
        </header>
      )}

      {paletteOpen && <GoTo items={[...NAV.flatMap((g) => g.items), ...SETTINGS].filter(visible)} onClose={() => setPaletteOpen(false)} />}

      {!editing && (
        <aside className={`sidebar ${navOpen ? "open" : ""}`}>
          <nav aria-label="Main">
            {NAV.map((g, gi) => {
              const items = g.items.filter(visible);
              if (!items.length) return null;
              return (
                <div className="nav-group" key={gi}>
                  {g.title && <div className="nav-title">{g.title}</div>}
                  {items.map((i) => (
                    <NavLink key={i.to} to={i.to} aria-label={i.label} title={i.label} className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}>
                      <Icon name={i.icon} />
                      <span>{i.label}</span>
                      {i.count && counts && counts[i.count] > 0 && <span className="nav-count" aria-label={`${counts[i.count]} need attention`}>{counts[i.count]}</span>}
                    </NavLink>
                  ))}
                </div>
              );
            })}
          </nav>
        </aside>
      )}

      <main className="main" key={user}>
        {error && (
          entra
            ? <div className="note bad row between" role="alert"><span>Signed in with Microsoft, but SignGuard refused it: {error}</span>
                <button className="secondary" onClick={() => { signOut().catch(() => undefined); }}>Sign out</button></div>
            : <div className="note bad" role="alert">Can't reach SignGuard as {user}: {error}. Is the backend running on port 8000?</div>
        )}
        {me && (
          <Routes>
            <Route path="/" element={<Navigate to={home} replace />} />
            <Route path="/home" element={isStaff ? <Home me={me} /> : <Navigate to="/my-trust" replace />} />
            <Route path="/signatures" element={<Signatures me={me} />} />
            <Route path="/signatures/:id" element={<SignatureEditor me={me} />} />
            <Route path="/rules" element={<Rules me={me} />} />
            <Route path="/campaigns" element={<Campaigns me={me} />} />
            <Route path="/disclaimers" element={<Disclaimers me={me} />} />
            <Route path="/analytics" element={<Analytics />} />
            <Route path="/people" element={<People me={me} />} />
            <Route path="/delegations" element={<Delegations me={me} />} />
            <Route path="/permissions" element={<Permissions me={me} />} />
            <Route path="/integrity" element={<Integrity />} />
            <Route path="/audit" element={<AuditLog />} />
            <Route path="/settings/brand" element={<BrandKit me={me} />} />
            <Route path="/settings/integrations" element={<Integrations me={me} />} />
            <Route path="/settings/automation" element={<Automation me={me} />} />
            <Route path="/my-trust" element={<MyTrust />} />
            <Route path="/compose" element={<Compose me={me} />} />
            {/* Earlier addresses keep working */}
            <Route path="/trust-center" element={<Navigate to="/home" replace />} />
            <Route path="/templates" element={<Navigate to="/signatures" replace />} />
            <Route path="/ai-studio" element={<Navigate to="/signatures?new=ai" replace />} />
            <Route path="/policies" element={<Navigate to="/rules" replace />} />
            <Route path="/assignments" element={<Navigate to="/rules?tab=coverage" replace />} />
            <Route path="/brand" element={<Navigate to="/settings/brand" replace />} />
            <Route path="/integrations" element={<Navigate to="/settings/integrations" replace />} />
            <Route path="/automation" element={<Navigate to="/settings/automation" replace />} />
            <Route path="*" element={<Navigate to={home} replace />} />
          </Routes>
        )}
      </main>
    </div>
  );
}

/** "Go to" palette: type part of a page name, arrow keys to choose, Enter to open. */
function GoTo({ items, onClose }: { items: Item[]; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const navigate = useNavigate();
  const extra: Item[] = [{ to: "/compose", label: "Outlook simulator", icon: "compose" }];
  const all = [...items, ...extra];
  const hits = all.filter((i) => i.label.toLowerCase().includes(q.trim().toLowerCase()));
  const go = (i?: Item) => { if (i) { navigate(i.to); onClose(); } };
  return (
    <div className="palette-backdrop" onMouseDown={onClose}>
      <div className="palette" role="dialog" aria-modal="true" aria-label="Go to a page" onMouseDown={(e) => e.stopPropagation()}>
        <div className="palette-input"><Icon name="search" />
          <input autoFocus placeholder="Go to a page…" value={q} aria-label="Page name"
            onChange={(e) => { setQ(e.target.value); setSel(0); }}
            onKeyDown={(e) => {
              if (e.key === "Escape") onClose();
              else if (e.key === "ArrowDown") { e.preventDefault(); setSel((n) => Math.min(n + 1, hits.length - 1)); }
              else if (e.key === "ArrowUp") { e.preventDefault(); setSel((n) => Math.max(n - 1, 0)); }
              else if (e.key === "Enter") go(hits[sel]);
            }} />
        </div>
        <ul className="palette-list" role="listbox" aria-label="Pages">
          {hits.map((i, n) => (
            <li key={i.to} role="option" aria-selected={n === sel}>
              <button className={n === sel ? "on" : ""} onMouseEnter={() => setSel(n)} onClick={() => go(i)}><Icon name={i.icon} />{i.label}</button>
            </li>
          ))}
          {!hits.length && <li className="palette-empty">No page called “{q}”.</li>}
        </ul>
      </div>
    </div>
  );
}
