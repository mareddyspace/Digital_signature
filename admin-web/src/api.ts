// Small API client. In dev mode the backend trusts the X-Dev-User header; the user switcher sets it.
// In entra mode every call carries a Microsoft access token instead (see auth.ts).
import { accessToken, authMode, identityHeaders } from "./auth";

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

async function authHeaders(): Promise<Record<string, string>> {
  const mode = authMode();
  return identityHeaders(mode, getDevUser(), mode === "entra" ? await accessToken() : null);
}

export async function api<T = unknown>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: options.method ?? (options.body === undefined ? "GET" : "POST"),
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
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
  const res = await fetch(`/api${path}`, { headers: await authHeaders() });
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

/** GET /api/me: the signed-in person, plus where their role came from. */
export interface Me extends Employee {
  role_source: "local" | "entra";
  auth_mode: "dev" | "entra";
  identity: { object_id: string; tenant_id: string; sign_in_name: string | null; app_roles: string[] } | null;
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

// ---------- signature platform ----------

export interface ComplianceIssue {
  severity: "critical" | "error" | "warning" | "info";
  rule: string;
  message: string;
}

export interface ComplianceReport {
  score: number;
  grade: string;
  issues: ComplianceIssue[];
  passed: string[];
  blocking: boolean;
}

export type BlockType =
  | "logo" | "photo" | "name" | "title" | "contact" | "text" | "divider" | "spacer"
  | "social" | "address" | "button" | "delegation" | "verification" | "banner" | "disclaimer";

export interface DesignBlock {
  id: string;
  type: BlockType;
  col: "left" | "right";
  props: Record<string, unknown>;
}

export interface DesignSettings {
  layout: "stack" | "split";
  font: string;
  text_color: string;
  accent: string;
  muted?: string;
  width: number;
  font_size: number;
  divider?: boolean;
}

export interface Design {
  settings: DesignSettings;
  blocks: DesignBlock[];
}

export interface Brand {
  company_name: string;
  primary_color: string;
  secondary_color: string;
  accent_color: string;
  palette: string;
  font_family: string;
  logo_url: string;
  logo_width: number;
  website: string;
  address: string;
  linkedin_url: string;
  twitter_url: string;
  facebook_url: string;
  instagram_url: string;
  youtube_url: string;
  max_width: number;
  require_logo: boolean;
  enforce_compliance: boolean;
  min_compliance_score: number;
  fonts: string[];
  updated_by: string;
  updated_at: string;
}

export interface Campaign {
  id: number;
  name: string;
  headline: string;
  body: string;
  cta_text: string;
  link_url: string;
  image_url: string;
  alt_text: string;
  background: string;
  text_color: string;
  departments: string;
  recipient_type: string;
  starts_at: string | null;
  ends_at: string | null;
  priority: number;
  enabled: boolean;
  impressions: number;
  clicks: number;
  ctr: number;
  state: string;
  preview_html: string;
}

export interface Disclaimer {
  id: number;
  name: string;
  text: string;
  departments: string;
  recipient_type: string;
  priority: number;
  enabled: boolean;
}

export interface AiVariant {
  name: string;
  rationale: string;
  design: Design;
  html: string;
  compliance: ComplianceReport;
}
