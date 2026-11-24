// Small API client. In dev mode the backend trusts the X-Dev-User header; the user switcher sets it.

const USER_KEY = "signguard.devUser";

export function getDevUser(): string {
  try {
    return localStorage.getItem(USER_KEY) ?? "meera.iyer@contoso.com";
  } catch {
    return "meera.iyer@contoso.com";
  }
}

export function setDevUser(email: string) {
  try {
    localStorage.setItem(USER_KEY, email);
  } catch {
    /* private window: the choice just won't be remembered */
  }
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function detailText(detail: unknown): string {
  if (typeof detail === "string") return detail;
  if (detail && typeof detail === "object" && "problems" in detail) {
    return (detail as { problems: string[] }).problems.join("; ");
  }
  if (Array.isArray(detail)) return detail.map((d) => d.msg ?? String(d)).join("; ");
  return "Something went wrong";
}

export async function api<T = unknown>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: options.method ?? (options.body === undefined ? "GET" : "POST"),
    headers: { "Content-Type": "application/json", "X-Dev-User": getDevUser() },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  if (!res.ok) {
    let message = res.statusText;
    try {
      message = detailText((await res.json()).detail);
    } catch {
      /* not JSON */
    }
    throw new ApiError(res.status, message);
  }
  return res.json() as Promise<T>;
}

export async function download(path: string, filename: string) {
  const res = await fetch(`/api${path}`, { headers: { "X-Dev-User": getDevUser() } });
  if (!res.ok) throw new ApiError(res.status, res.statusText);
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function fmt(date?: string | null): string {
  if (!date) return "–";
  // The API returns naive UTC timestamps.
  const d = new Date(date.endsWith("Z") ? date : `${date}Z`);
  return d.toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export interface Employee {
  id: number;
  name: string;
  email: string;
  job_title: string;
  department: string;
  phone: string;
  mobile: string;
  manager_email: string;
  role: string;
  data_issues: string[];
  synced_at: string;
}

export interface Delegation {
  id: number;
  delegate_email: string;
  delegate_name: string;
  owner_email: string;
  owner_name: string;
  reason: string;
  starts_at: string;
  ends_at: string;
  status: string;
  state: string;
  requested_by: string;
  decided_by: string | null;
  exchange_state: string;
}

export interface Permission {
  id: number;
  mailbox: string;
  mailbox_name: string;
  trustee: string;
  trustee_name: string;
  type: string;
  granted_at: string | null;
  last_used: string | null;
  source: string;
  review_state: string;
  flags: string[];
}

export interface SignatureResult {
  html: string;
  template_name: string | null;
  policy_name: string | null;
  recipient_type: string;
  reason: string;
  verification_code?: string | null;
  on_behalf_of: string | null;
  warnings: string[];
}

export interface AuditEvent {
  id: number;
  actor: string;
  action: string;
  target_type: string;
  target_id: string;
  details: Record<string, unknown>;
  created_at: string;
}
