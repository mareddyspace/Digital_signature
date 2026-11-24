import { useEffect, useState } from "react";
import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import { api, getDevUser, setDevUser, type Employee } from "./api";
import TrustCenter from "./pages/TrustCenter";
import People from "./pages/People";
import Templates from "./pages/Templates";
import Policies from "./pages/Policies";
import Delegations from "./pages/Delegations";
import Permissions from "./pages/Permissions";
import AuditLog from "./pages/AuditLog";
import MyTrust from "./pages/MyTrust";
import Compose from "./pages/Compose";

type DevUser = { email: string; name: string; role: string };

const NAV: { to: string; label: string; roles?: string[] }[] = [
  { to: "/trust-center", label: "Trust Center", roles: ["admin", "dept_admin", "auditor"] },
  { to: "/delegations", label: "Delegations" },
  { to: "/permissions", label: "Mailbox permissions", roles: ["admin", "auditor"] },
  { to: "/templates", label: "Signature templates", roles: ["admin", "dept_admin", "auditor"] },
  { to: "/policies", label: "Signature policies", roles: ["admin", "dept_admin", "auditor"] },
  { to: "/people", label: "People", roles: ["admin", "dept_admin", "auditor"] },
  { to: "/audit", label: "Audit trail", roles: ["admin", "auditor"] },
  { to: "/my-trust", label: "My Trust" },
  { to: "/compose", label: "Try it: write an email" },
];

const ROLE_TEXT: Record<string, string> = { admin: "Admin", dept_admin: "Department admin", auditor: "Auditor", employee: "Employee" };

export default function App() {
  const [user, setUser] = useState(getDevUser());
  const [me, setMe] = useState<Employee | null>(null);
  const [users, setUsers] = useState<DevUser[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<DevUser[]>("/dev/users").then(setUsers).catch(() => setUsers([]));
  }, []);

  useEffect(() => {
    setMe(null);
    setError(null);
    api<Employee>("/me").then(setMe).catch((e: Error) => setError(e.message));
  }, [user]);

  const switchUser = (email: string) => {
    setDevUser(email);
    setUser(email);
  };

  const nav = NAV.filter((n) => !n.roles || (me && n.roles.includes(me.role)));
  const home = me && ["admin", "dept_admin", "auditor"].includes(me.role) ? "/trust-center" : "/my-trust";

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <svg viewBox="0 0 16 16" width="22" height="22" aria-hidden="true"><path d="M2 1h12v8l-6 6-6-6z" fill="currentColor" /></svg>
          <span>SignGuard</span>
        </div>
        <nav>
          {nav.map((n) => (
            <NavLink key={n.to} to={n.to} className={({ isActive }) => (isActive ? "active" : "")}>
              {n.label}
            </NavLink>
          ))}
        </nav>
        {users.length > 0 && (
          <div className="switcher">
            <label htmlFor="dev-user">Signed in as (dev mode)</label>
            <select id="dev-user" value={user} onChange={(e) => switchUser(e.target.value)}>
              {users.map((u) => (
                <option key={u.email} value={u.email}>
                  {u.name} · {ROLE_TEXT[u.role] ?? u.role}
                </option>
              ))}
            </select>
          </div>
        )}
      </aside>
      <main className="content" key={user}>
        {error && <div className="note bad">Can't reach SignGuard as {user}: {error}. Is the backend running on port 8000?</div>}
        {me && (
          <Routes>
            <Route path="/" element={<Navigate to={home} replace />} />
            <Route path="/trust-center" element={<TrustCenter />} />
            <Route path="/people" element={<People />} />
            <Route path="/templates" element={<Templates me={me} />} />
            <Route path="/policies" element={<Policies me={me} />} />
            <Route path="/delegations" element={<Delegations me={me} />} />
            <Route path="/permissions" element={<Permissions me={me} />} />
            <Route path="/audit" element={<AuditLog />} />
            <Route path="/my-trust" element={<MyTrust />} />
            <Route path="/compose" element={<Compose me={me} />} />
            <Route path="*" element={<Navigate to={home} replace />} />
          </Routes>
        )}
      </main>
    </div>
  );
}
