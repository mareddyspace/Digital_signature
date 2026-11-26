// Sign-in logic that doesn't need a browser or a Microsoft tenant: run with `npm test`.
import { describe, expect, it } from "vitest";
import type { AccountInfo } from "@azure/msal-browser";
import { identityHeaders, initAuth, msalConfiguration, parseAuthConfig, pickAccount } from "./auth";

const TENANT = "11111111-1111-1111-1111-111111111111";
const SPA = "33333333-3333-3333-3333-333333333333";
const entraCfg = { mode: "entra", tenant_id: TENANT, client_id: SPA, scopes: ["api://x/access_as_user"] };

const account = (tenantId: string, id = "a"): AccountInfo =>
  ({ homeAccountId: id, tenantId, username: `${id}@contoso.com`, environment: "login.microsoftonline.com", localAccountId: id } as AccountInfo);

describe("parseAuthConfig", () => {
  it("accepts dev mode", () => {
    expect(parseAuthConfig({ mode: "dev" })).toEqual({ mode: "dev" });
  });
  it("accepts a complete entra config", () => {
    expect(parseAuthConfig(entraCfg)).toEqual({ mode: "entra", tenantId: TENANT, clientId: SPA, scopes: ["api://x/access_as_user"] });
  });
  it.each([
    [{ ...entraCfg, tenant_id: "" }, "ENTRA_TENANT_ID"],
    [{ ...entraCfg, tenant_id: "common" }, "ENTRA_TENANT_ID"],
    [{ ...entraCfg, client_id: "" }, "ENTRA_SPA_CLIENT_ID"],
    [{ ...entraCfg, scopes: [] }, "scope"],
    [{ mode: "magic" }, "Unknown sign-in mode"],
    [null, "Unknown sign-in mode"],
  ])("refuses an incomplete config %#", (raw, message) => {
    expect(() => parseAuthConfig(raw)).toThrow(message);
  });
});

describe("identityHeaders", () => {
  it("sends X-Dev-User only in dev mode", () => {
    expect(identityHeaders("dev", "sara.khan@contoso.com", null)).toEqual({ "X-Dev-User": "sara.khan@contoso.com" });
  });
  it("sends only the bearer token in entra mode, never X-Dev-User", () => {
    const h = identityHeaders("entra", "sara.khan@contoso.com", "tok");
    expect(h).toEqual({ Authorization: "Bearer tok" });
    expect(Object.keys(h)).not.toContain("X-Dev-User");
  });
  it("sends nothing in entra mode without a token", () => {
    expect(identityHeaders("entra", "sara.khan@contoso.com", null)).toEqual({});
  });
});

describe("pickAccount", () => {
  it("keeps the active account from our tenant", () => {
    const a = account(TENANT);
    expect(pickAccount([a, account(TENANT, "b")], a, TENANT)).toBe(a);
  });
  it("ignores accounts from other tenants", () => {
    expect(pickAccount([account("other")], account("other"), TENANT)).toBeNull();
  });
  it("uses the only account from our tenant, and asks when there are several", () => {
    const a = account(TENANT);
    expect(pickAccount([a, account("other", "x")], null, TENANT)).toBe(a);
    expect(pickAccount([a, account(TENANT, "b")], null, TENANT)).toBeNull();
  });
});

describe("msalConfiguration", () => {
  it("is single-tenant and redirects through the bridge page", () => {
    const c = msalConfiguration(parseAuthConfig(entraCfg) as Extract<ReturnType<typeof parseAuthConfig>, { mode: "entra" }>, "https://signguard.example.com");
    expect(c.auth.authority).toBe(`https://login.microsoftonline.com/${TENANT}`);
    expect(c.auth.clientId).toBe(SPA);
    expect(c.auth.redirectUri).toBe("https://signguard.example.com/redirect.html");
    expect(JSON.stringify(c)).not.toMatch(/secret/i);
  });
});

describe("initAuth", () => {
  it("in dev mode starts without contacting Microsoft", async () => {
    expect(await initAuth(async () => ({ mode: "dev" }))).toEqual({ mode: "dev" });
  });
  it("fails clearly when the server's entra settings are incomplete", async () => {
    await expect(initAuth(async () => ({ mode: "entra" }))).rejects.toThrow("ENTRA_TENANT_ID");
  });
});
