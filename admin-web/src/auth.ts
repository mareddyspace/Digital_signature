// Sign-in for the admin web.
//
// AUTH_MODE=dev:   the account switcher picks a sample person, sent as X-Dev-User (local only).
// AUTH_MODE=entra: Microsoft Entra ID sign-in with MSAL (auth code + PKCE, no secret in the browser).
//                  Every API call carries an access token for the SignGuard API; no X-Dev-User.
//
// The backend says which mode it runs in, and the public IDs to use, at GET /api/auth/config,
// so nothing about a tenant is built into this code.

import {
  InteractionRequiredAuthError,
  PublicClientApplication,
  type AccountInfo,
  type Configuration,
} from "@azure/msal-browser";

export type AuthConfig =
  | { mode: "dev" }
  | { mode: "entra"; tenantId: string; clientId: string; scopes: string[] };

export type AuthState =
  | { mode: "dev" }
  | { mode: "entra"; account: AccountInfo | null; error: string | null };

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Checks what /api/auth/config returned, so a misconfigured server fails clearly here. */
export function parseAuthConfig(raw: unknown): AuthConfig {
  const r = (raw ?? {}) as Record<string, unknown>;
  if (r.mode === "dev") return { mode: "dev" };
  if (r.mode !== "entra") throw new Error(`Unknown sign-in mode "${String(r.mode)}"`);
  const tenantId = String(r.tenant_id ?? "");
  const clientId = String(r.client_id ?? "");
  const scopes = Array.isArray(r.scopes) ? r.scopes.map(String).filter(Boolean) : [];
  if (!GUID.test(tenantId)) throw new Error("The server's ENTRA_TENANT_ID is missing or not a tenant ID");
  if (!GUID.test(clientId)) throw new Error("The server's ENTRA_SPA_CLIENT_ID is missing or not a client ID");
  if (!scopes.length) throw new Error("The server gave no API scope to request");
  return { mode: "entra", tenantId, clientId, scopes };
}

/** MSAL settings: single tenant, redirect flow through the v5 redirect bridge page. */
export function msalConfiguration(cfg: Extract<AuthConfig, { mode: "entra" }>, origin: string): Configuration {
  return {
    auth: {
      clientId: cfg.clientId,
      authority: `https://login.microsoftonline.com/${cfg.tenantId}`,
      redirectUri: `${origin}/redirect.html`,
      postLogoutRedirectUri: `${origin}/`,
    },
    // localStorage: stay signed in across tabs and browser restarts (sign-out clears it).
    cache: { cacheLocation: "localStorage" },
  };
}

/** The account to use: the active one, else the only one from our tenant. Several: let the person choose. */
export function pickAccount(accounts: AccountInfo[], active: AccountInfo | null, tenantId: string): AccountInfo | null {
  if (active && active.tenantId === tenantId) return active;
  const ours = accounts.filter((a) => a.tenantId === tenantId);
  return ours.length === 1 ? ours[0] : null;
}

/** Headers that identify the caller. Never both: the API refuses X-Dev-User in entra mode. */
export function identityHeaders(mode: AuthConfig["mode"], devUser: string, accessToken: string | null): Record<string, string> {
  if (mode === "entra") return accessToken ? { Authorization: `Bearer ${accessToken}` } : {};
  return { "X-Dev-User": devUser };
}

let config: AuthConfig = { mode: "dev" };
let pca: PublicClientApplication | null = null;

export function authMode(): AuthConfig["mode"] {
  return config.mode;
}

/** Runs once before the app renders: learns the mode and finishes any sign-in redirect. */
async function loadConfig(): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch("/api/auth/config");
  } catch {
    throw new Error("Can't reach the SignGuard backend. Is it running on port 8000?");
  }
  if (!res.ok) {
    throw new Error(res.status === 404
      ? "The backend running on port 8000 is an older version. Stop it (Ctrl + C) and start it again."
      : `The backend answered ${res.status} for its sign-in settings.`);
  }
  return res.json();
}

export async function initAuth(fetchConfig: () => Promise<unknown> = loadConfig): Promise<AuthState> {
  config = parseAuthConfig(await fetchConfig());
  if (config.mode === "dev") return { mode: "dev" };

  pca = new PublicClientApplication(msalConfiguration(config, window.location.origin));
  await pca.initialize();
  let error: string | null = null;
  try {
    const result = await pca.handleRedirectPromise();
    if (result?.account) pca.setActiveAccount(result.account);
  } catch (e) {
    error = describe(e);
  }
  const account = pickAccount(pca.getAllAccounts(), pca.getActiveAccount(), config.tenantId);
  if (account) pca.setActiveAccount(account);
  return { mode: "entra", account, error };
}

export async function signIn(): Promise<void> {
  if (!pca || config.mode !== "entra") return;
  await pca.loginRedirect({ scopes: config.scopes, prompt: "select_account" });
}

export async function signOut(): Promise<void> {
  if (!pca) return;
  await pca.logoutRedirect({ account: pca.getActiveAccount() ?? undefined });
}

/** An access token for the SignGuard API: from the cache, refreshed silently, or by a new sign-in. */
export async function accessToken(): Promise<string | null> {
  if (!pca || config.mode !== "entra") return null;
  const account = pca.getActiveAccount();
  if (!account) return null;
  try {
    return (await pca.acquireTokenSilent({ scopes: config.scopes, account })).accessToken;
  } catch (e) {
    if (e instanceof InteractionRequiredAuthError) {
      await pca.acquireTokenRedirect({ scopes: config.scopes, account });
      return null; // the page navigates away
    }
    throw e;
  }
}

function describe(e: unknown): string {
  const code = (e as { errorCode?: string })?.errorCode;
  return code ? `Microsoft sign-in failed (${code})` : String((e as Error)?.message ?? e);
}
