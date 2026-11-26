import { useEffect, useRef, useState } from "react";
import { NavLink, Navigate, Route, Routes, useLocation, useMatch } from "react-router-dom";

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

// Simple 24px line icons (stroke uses currentColor via CSS).
const ICONS: Record<string, string> = {
  home: "M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z",
  signatures: "M4 5h16v14H4zM8 9h8M8 13h5",
  rules: "M4 6h10M4 12h16M4 18h7M17 4v4M14 16l3 3 4-5",
  campaigns: "M3 10v4l11 5V5zM14 8h3a4 4 0 0 1 0 8h-3M6 15l1 5h3l-1-4",
  disclaimers: "M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6",
  analytics: "M4 20V10M10 20V4M16 20v-7M22 20H2",
  people: "M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21a7 7 0 0 1 14 0M17 11a3 3 0 1 0 0-6M22 21a6 6 0 0 0-4-5.7",
  delegations: "M7 7h13l-3-3M17 17H4l3 3",
  permissions: "M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4",
  integrity: "M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6zM9 12l2 2 4-4",
  audit: "M12 7v5l3 2M21 12a9 9 0 1 1-9-9 9 9 0 0 1 9 9z",
  brand: "M12 3a9 9 0 1 0 0 18c1 0 1.5-.7 1.5-1.5 0-1-.8-1.4-.8-2.3 0-.9.7-1.2 1.6-1.2H17a4 4 0 0 0 4-4c0-5-4-9-9-9zM7.5 11h.01M10 7h.01M15 7h.01",
  integrations: "M8 7V3M16 7V3M6 7h12v4a6 6 0 0 1-12 0zM12 17v4",
  automation: "M20 12a8 8 0 0 1-14.3 4.9M4 12A8 8 0 0 1 18.3 7.1M18 3v4h-4M6 21v-4h4",
  mysig: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0",
  compose: "M4 20h4L19 9l-4-4L4 16zM14 6l4 4",
};

function Icon({ name }: { name: string }) {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d={ICONS[name]} /></svg>;
}

type Item = { to: string; label: string; icon: string; roles?: string[]; count?: keyof Counts };
const NAV: { title?: string; items: Item[]; foot?: boolean }[] = [
  {
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
      { to: "/analytics", label: "Analytics", icon: "analytics", roles: READ },
    ],
  },
  {
    title: "Directory & security",
    items: [
      { to: "/people", label: "People", icon: "people", roles: READ },
      { to: "/delegations", label: "Delegations", icon: "delegations", count: "pending_delegations" },
      { to: "/permissions", label: "Mailbox access", icon: "permissions", roles: AUDIT, count: "flagged_permissions" },
      { to: "/integrity", label: "Integrity", icon: "integrity", roles: READ },
      { to: "/audit", label: "Audit log", icon: "audit", roles: AUDIT },
    ],
  },
  {
    title: "Settings",
    foot: true,
    items: [
      { to: "/settings/brand", label: "Brand kit", icon: "brand", roles: READ },
      { to: "/settings/integrations", label: "Integrations", icon: "integrations", roles: READ },
      { to: "/settings/automation", label: "Automation", icon: "automation", roles: READ },
    ],
  },
];

const TITLES: [string, string][] = [
  ["/home", "Home"], ["/signatures", "Signatures"], ["/rules", "Rules"], ["/campaigns", "Campaigns"],
  ["/disclaimers", "Disclaimers"], ["/analytics", "Analytics"], ["/people", "People"], ["/delegations", "Delegations"],
  ["/permissions", "Mailbox access"], ["/integrity", "Integrity"], ["/audit", "Audit log"], ["/settings/brand", "Brand kit"],
  ["/settings/integrations", "Integrations"], ["/settings/automation", "Automation"], ["/my-trust", "My signature"],
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
  const menuRef = useRef<HTMLDivElement>(null);
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

  useEffect(() => { setNavOpen(false); setMenuOpen(false); }, [location.pathname]);

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
          <button className="icon menu-toggle" aria-label="Open navigation" onClick={() => setNavOpen(!navOpen)}>☰</button>
          <NavLink to={home} className="header-brand">
            <svg viewBox="0 0 40 40" width="22" height="22" aria-hidden="true">
              <path d="M20 3L34 8V19C34 28 28 34 20 38C12 34 6 28 6 19V8L20 3Z" fill="currentColor" />
              <path d="M13 20L18 25L28 14" stroke="#fff" strokeWidth="3.2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            SignGuard
          </NavLink>
          <span className="header-title">{title}</span>
          <span className="header-spacer" />
          {demo
            ? <span className="env-pill" title="Sample data. Switch accounts to see each role; nothing you change is saved.">Read-only demo</span>
            : !entra && users.length > 0 && <span className="env-pill" title="AUTH_MODE=dev: anyone can act as any user. Use Entra sign-in in production.">Dev sign-in</span>}
          <div className="account" ref={menuRef}>
            <button className="account-button" aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}>
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

      {!editing && (
        <aside className={`sidebar ${navOpen ? "open" : ""}`}>
          <nav aria-label="Main">
            {NAV.filter((g) => !g.foot).map((g, gi) => {
              const items = g.items.filter(visible);
              if (!items.length) return null;
              return (
                <div className="nav-group" key={gi}>
                  {g.title && <div className="nav-title">{g.title}</div>}
                  {items.map((i) => (
                    <NavLink key={i.to} to={i.to} className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}>
                      <Icon name={i.icon} />
                      <span>{i.label}</span>
                      {i.count && counts && counts[i.count] > 0 && <span className="nav-count" aria-label={`${counts[i.count]} need attention`}>{counts[i.count]}</span>}
                    </NavLink>
                  ))}
                </div>
              );
            })}
          </nav>
          {NAV.filter((g) => g.foot).map((g) => {
            const items = g.items.filter(visible);
            if (!items.length) return null;
            return (
              <div className="sidebar-foot" key="foot">
                <div className="nav-title">{g.title}</div>
                {items.map((i) => (
                  <NavLink key={i.to} to={i.to} className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}>
                    <Icon name={i.icon} /><span>{i.label}</span>
                  </NavLink>
                ))}
              </div>
            );
          })}
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
