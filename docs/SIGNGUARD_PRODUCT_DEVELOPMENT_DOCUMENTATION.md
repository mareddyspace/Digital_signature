# SignGuard — product development documentation

Living record of what SignGuard does, what was added or changed, how each part was tested and what is still open.
Update it with every change: add the feature, the tests you actually ran and their real results.

- Last updated: 28 Nov 2026
- Repository: `mareddyspace/Digital_signature`
- Last pushed commit: `f51d62a` (Phase 1: Microsoft Entra ID sign-in). Everything under "Changes since f51d62a" is on the development PC but not yet committed.

**Status words used in this document**

| Word | Meaning |
|---|---|
| Verified (live) | Tested against the real Microsoft 365 tenant `vknowtech.ai` |
| Verified (app) | Tested by clicking through the running app (backend + admin web on the development PC) and checking the backend's answer |
| Verified (automated) | Covered by an automated test that was run and passed |
| Not run | Not tested yet. Never read "not run" as working |

---

## 1. What SignGuard is

An email signature management platform for Microsoft 365 (and Google Workspace), modelled on Exclaimer and CodeTwo, with a security focus: every approved signature is sealed, external email carries a verification code anyone can check, and send-as access is reviewed.

| Part | Technology | Folder |
|---|---|---|
| API | FastAPI, SQLAlchemy 2, pydantic v2, Alembic | `backend/` |
| Admin web | React, Vite, TypeScript, MSAL browser | `admin-web/` |
| Outlook add-in | Office.js, XML manifest, event-based activation | `outlook-addin/` |
| Database | SQLite locally, PostgreSQL in production | — |

## 2. Configuration

| Variable | Purpose | Default |
|---|---|---|
| `AUTH_MODE` | `dev` (pick a sample person, local only) or `entra` (Microsoft sign-in) | `dev` |
| `DATABASE_URL` | Database connection | `sqlite:///./signguard.db` |
| `DIRECTORY_SOURCE` | `sample`, `graph` (Microsoft 365) or `google` | `sample` |
| `ENTRA_TENANT_ID`, `ENTRA_API_CLIENT_ID`, `ENTRA_API_AUDIENCE`, `ENTRA_SPA_CLIENT_ID` | Microsoft sign-in (IDs only, not secrets) | — |
| `ENTRA_API_CLIENT_SECRET` | Graph directory sync. Typed at run time with `Read-Host`; never stored in files | — |
| `BOOTSTRAP_ADMINS` | Emails that become admin on first sign-in | — |
| `INTERNAL_DOMAINS` | Domains treated as internal recipients | `contoso.com` |
| `CODE_SECRET` | Key for integrity seals and verification codes. Must be set in production | development value |

Database changes are applied with an explicit step before the server starts: `python -m app.migrate` (`--check` reports without changing anything). The server refuses to start if a migration is pending.

## 3. Feature list

### Completed and verified

| Area | Feature | How it was verified |
|---|---|---|
| Foundation | Alembic migrations as an explicit deployment step; startup refuses if a migration is pending | Automated (`test_migrations.py`, run with Alembic 1.20.1) |
| Foundation | Directory sync safety: refuses an empty directory (502); holds back a sync that would remove more than 20% and more than 5 people (409, can be forced) | Automated (`test_directory.py`) |
| Sign-in | Microsoft Entra ID sign-in for admin web and API: tenant keys, audience, issuer, tenant ID, scope; identity by object ID; app roles Admin, DepartmentAdmin, Auditor | Automated (22 backend + 17 frontend tests); **live**: sign-in to tenant `vknowtech.ai` reached SignGuard on 27 Nov 2026 |
| Sign-in | Stay signed in across tabs and browser restarts (MSAL cache moved to localStorage; sign-out clears it) | Type check only. Browser retest in Microsoft mode: not run |
| Directory | Microsoft Graph sync (application permission `User.Read.All`) | **Live**: imported `admin@vknowtech.ai` with its object ID on 27 Nov 2026 |
| Signatures | Template library, visual designer, HTML editor, version history, checks (brand, accessibility, Outlook-safe HTML) | Automated + app |
| Signatures | Emoji element limited to sun, night and cloud | Automated (`test_emoji_element_offers_only_sun_night_cloud`) |
| Signatures | **Duplicate on the server** (new) — copies the live version (or the draft if never live), picks a free name, records `template.duplicated` | Automated + app (28 Nov: duplicated "Short internal" → "Short internal (copy)", draft v1) |
| Approvals | **Approval setting** (new) — two admins (default), one admin, or off; audited | Automated + app (see 6.3) |
| Rules | **Named people, exceptions, recipient domains, start/end dates** (new) | Automated + app (see 6.2) |
| Rules | Rules tester that explains each condition, including the new ones | App (28 Nov) |
| Outlook | "Copy to Outlook" on My signature: copies HTML and plain text, step tabs for Outlook on the web, new Outlook, classic Outlook | App (copy button). **Paste into real Outlook and send: not run** |
| UI | "Seal" design system: navy app bar, grouped navigation, settings gear, Ctrl+K "Go to" palette, sentence-case tables, phone and tablet layouts | App at 1440, ~1100 and 375 px wide |
| UI | In-app confirm dialog instead of the browser's `confirm()` (rules, banners, disclaimers, editor) | App (deleted a rule through it) |
| UI | Loading placeholders (`Skeleton`) and empty states (`EmptyState`) | Approval card uses Skeleton; others not yet adopted |

### Pending

| Priority | Feature | Blocked by |
|---|---|---|
| High | Real Outlook test: paste the copied signature in Outlook on the web and send to an outside address | The user's mailbox session (MFA code goes to the manager's phone) |
| High | Outlook add-in (event-based, Nested App Authentication) for one test user | Manager approval for a tenant change; HTTPS hosting |
| High | Production hosting (Render + PostgreSQL) | Hosting decision; until then links in signatures point to localhost |
| Medium | Per-person details editor (CodeTwo "User Details Editor"): admins fill in missing phone or title without changing Entra ID | Not built |
| Medium | Groups as rule senders (Entra ID groups), profile photos, delta sync | Needs `GroupMember.Read.All`; not requested yet |
| Medium | Server-side signatures (transport rule / connector) for mobile and every client | Hosting + tenant change |
| Low | Use `Skeleton`/`EmptyState` on every list page | — |
| Low | Signature designer on phones (works, but cramped; Exclaimer and CodeTwo are desktop-only too) | — |

## 4. Changes since f51d62a (not committed yet)

### 4.1 Rule conditions: named people, exceptions, recipient domains, dates

**Why.** Exclaimer and CodeTwo let a rule target specific people, skip specific people, apply only to certain recipient domains and run between dates. SignGuard only had departments, recipient type and email type, so "a VIP signature for Fabrikam" or "a December holiday signature" was impossible.

**How it works.** A rule matches when all of these hold, checked top to bottom (first match wins):
1. The rule is on, and today is inside its dates (if any).
2. The sender is not in *Except these people*.
3. Senders: no departments and no people means everyone; otherwise the sender's department **or** their email is listed. Delegated email follows the mailbox owner.
4. Recipient type and email type match as before.
5. If *Only to these domains* is set, at least one recipient is in a listed domain; subdomains count (`eu.fabrikam.com` matches `fabrikam.com`; `notfabrikam.com` does not).

Input is cleaned on the server: emails and domains are lower-cased and de-duplicated, a leading `@` is removed, and a bad email, bad domain or end-before-start is refused with 422. Times are stored in UTC.

The automatic "shadowed rule" check treats a rule narrowed by people, domains, exceptions or dates as not covering others, so it does not wrongly report a later rule as unreachable.

**Files.** `backend/app/models.py`, `backend/app/signature.py` (`policy_matches_sender`, `match_policy`), `backend/app/automation.py` (`_covers`), `backend/app/routers/admin.py` (`PolicyIn` validators, `policy_out`), `admin-web/src/pages/Rules.tsx` (editor steps, `PeoplePicker`, list columns, tester), `admin-web/src/styles.css`.

**API.** `GET/POST/PUT /api/policies` gain `people`, `exclude_people`, `recipient_domains` (comma-separated strings), and `starts_at`, `ends_at` (ISO dates, or null). Existing clients that leave them out keep the old behaviour.

**Database.** Migration `0003_rule_conditions` adds five columns to `signature_policies`. Every new column is empty or null by default, so existing rules match exactly as before. The downgrade removes them.

### 4.2 Approval setting

**Why.** Two-admin approval was fixed. A tenant with one admin (like the test tenant) could never publish a change. Exclaimer and CodeTwo make approval optional.

**How it works.** Settings → Automation & approvals → Signature approvals:
- **Two admins** (default, recommended): nobody approves their own change.
- **One admin**: any admin approves, including their own change.
- **No approval**: submitting publishes immediately. The version is still sealed and checked, and recorded as `template.approved` with the note "approval switched off".

Switching away from two admins asks for confirmation on the page. Every change is recorded as `approval.mode_changed` (before → after), and the audit log has an "Approval setting" filter. The editor's buttons and messages follow the setting ("Publish" when approval is off).

**Files.** `backend/app/automation.py` (`APPROVAL_MODES`, `approval_mode`, `set_approval_mode`), `backend/app/routers/admin.py` (`/settings/approval`, `_make_live`, `submit`, `decide`), `admin-web/src/pages/Automation.tsx`, `SignatureEditor.tsx`, `AuditLog.tsx`, `App.tsx`.

**API.** `GET /api/settings/approval` (any reader), `PUT /api/settings/approval` `{ "mode": "two_admins" | "one_admin" | "off" }` (admins only).

**Database.** None: stored as the `approval.mode` row in the existing `settings` table. Missing means two admins.

### 4.3 Duplicate on the server

**Why.** The old Duplicate ran in the browser, failed with "name already exists" the second time, copied the draft rather than the live version, and left no "duplicated" audit entry.

**How it works.** `POST /api/templates/{id}/duplicate` with optional `{ "name": "…" }`. It copies the live version (or the latest version if never live) together with its designer layout into a new draft. Without a name it picks "X (copy)", then "X (copy 2)". Admins and department admins only.

**Files.** `backend/app/routers/admin.py`, `admin-web/src/pages/Signatures.tsx`.

### 4.4 Design system and UI fixes

- New app frame (navy app bar, settings gear, Ctrl+K "Go to" palette, grouped navigation, collapsing navigation at 1024–1279 px, drawer menu below 1024 px); Seal colour, type and spacing tokens; three overlapping style layers merged into one. Files: `App.tsx`, `styles.css`.
- `useConfirm` dialog replaces six `window.confirm` calls. File: `ui.tsx` and the pages that used it.
- `Skeleton` and `EmptyState` components (`ui.tsx`).
- Problems found and fixed in QA on 28 Nov 2026:

| Problem | Fix |
|---|---|
| Analytics: "External"/"Internal" labels drawn on top of each other; last two dates overlapping | Labels kept 14 px apart and above the axis; date next to the last one skipped |
| Status badges in lower case ("live", "sealed", "on") | Capitalised everywhere |
| "1 people have incomplete directory details" | "1 person has …" |
| Navigation links had no accessible name in the icon-only layout | `aria-label` and tooltip on every link; account button labelled |
| Four identical "Duplicate" buttons for screen readers | `aria-label="Duplicate <name>"` |
| Rules page crashed if the API returned a rule without the new fields (seen while the old backend was still running) | Rule fields read safely |
| People search list in the rule editor cut off at the bottom of the drawer | List flows in the page instead of floating |
| Phone: "Dev sign-in" pill wrapped onto two lines; tabs cut off; an odd number of stat tiles left an empty cell; a shadow strip at the left edge from the closed menu | Fixed in `styles.css` |
| Integrations page title didn't match its menu name | Both say "Integrations" |
| Texts said a second admin always approves | Now refer to the approval setting |
| Rules page broke in Vite after an edit (missing quote mark) | Fixed in minutes. Since then every change is type-checked before it is copied |

## 5. How to run the checks

In VS Code terminals on the development PC:

```
cd C:\Users\Gayathri\OneDrive\Desktop\signature\backend
.venv\Scripts\python -m pytest -q
.venv\Scripts\python -m app.migrate --check

cd C:\Users\Gayathri\OneDrive\Desktop\signature\admin-web
npx tsc --noEmit -p .
npm test
npm run build
```

## 6. Testing history

### 6.1 Automated tests

| Date | Suite | Where | Result |
|---|---|---|---|
| 26 Nov | Backend pytest | Development PC (Windows, Python 3.14) | 70 passed |
| 26 Nov | Frontend vitest | Development PC | 17 passed |
| 26 Nov | Production build (`npm run build`) | Development PC | Succeeded |
| 28 Nov | Backend pytest, including the new `test_rules_and_approvals.py` (5 tests) and the duplicate test | Claude's Linux test copy (Python 3.13, the PC's Alembic 1.20.1 and Mako); every source file checked identical to the PC by MD5 first | **78 passed** |
| 28 Nov | TypeScript check (`tsc --noEmit`) | Development PC folder | Passed (after the quote-mark fix) |
| 28 Nov | Backend pytest on the PC | Development PC | **Not run yet** |
| 28 Nov | Frontend vitest and production build | Development PC | **Not run yet** (they can't run in Claude's environment: the PC's `node_modules` only has the Windows build of esbuild) |

### 6.2 App tests: rule conditions (28 Nov 2026, dev mode, PC backend after migration 0003)

Rule "QA Fabrikam VIP": Finance plus Sara Khan, except David Chen, external recipients in `fabrikam.com`, 28 Nov – 31 Dec 2026. It was created entirely through the editor and moved to the top. Results from `POST /api/policies/test` on the PC backend:

| Sender | Recipient | Expected | Actual |
|---|---|---|---|
| Sara Khan (Sales, named) | a@fabrikam.com | QA Fabrikam VIP | QA Fabrikam VIP ✔ |
| Sara Khan | a@northwind.com | Everyone to outside | Everyone to outside ✔ |
| David Chen (Finance, exception) | a@fabrikam.com | Finance to outside | Finance to outside ✔ |
| Arjun Rao (Finance) | a@eu.fabrikam.com | QA Fabrikam VIP | QA Fabrikam VIP ✔ |
| Arjun Rao | a@notfabrikam.com | Finance to outside | Finance to outside ✔ |
| Rahul Verma (Sales, not named) | a@fabrikam.com | Everyone to outside | Everyone to outside ✔ |

The rules tester showed "Senders ✕ Sender is in the exceptions" for David, then applied the next rule. The rule was then deleted through the new confirm dialog ("Rule deleted.", 4 rules left).

Screenshots: `screenshots/rule-editor-named-people.jpg`, `screenshots/rule-editor-recipient-domains.jpg`, `screenshots/rules-list-with-conditions.jpg`, `screenshots/confirm-dialog.jpg`.

### 6.3 App tests: approvals and duplicate (28 Nov 2026)

1. Switched to "One admin" through the on-page confirmation. The API returned `one_admin`, and the audit log has `approval.mode_changed` from `two_admins` to `one_admin` by meera.iyer@contoso.com.
2. Duplicated "Short internal" → "Short internal (copy)" (draft v1, `/signatures/5`).
3. Submitted. The page said "Submitted. An admin can now approve it.", and "Approve and publish" appeared for the same admin.
4. Approved. The API showed live v1, integrity sealed, status live. Audit: `template.duplicated`, `template.submitted`, `template.approved`.
5. Switched back to "Two admins". The API returned `two_admins`.

Screenshots: `screenshots/approval-setting.jpg`, `screenshots/editor-one-admin-approve.jpg`.

### 6.4 Page and layout review (28 Nov 2026)

Every page was opened at desktop (1440 px), mid width (~1100 px, icon navigation) and phone (375 px): Home, My signature, Signatures, signature editor, Rules (list, tester, coverage), Campaigns, Disclaimers, People, Delegations, Mailbox access, Analytics, Integrity, Audit log, Brand kit, Integrations, Automation & approvals. Problems found are in the table in 4.4. After the fixes, Home and the list pages were rechecked at 375 px. Screenshots: `screenshots/home-phone.jpg`, `screenshots/analytics-chart-labels.jpg`.

Not checked yet: the Outlook simulator (`/compose`) at phone size, and keyboard-only use of the signature designer.

### 6.5 Microsoft 365 live integration

| Test | Status | Result / reason |
|---|---|---|
| Microsoft sign-in to SignGuard (tenant `vknowtech.ai`) | Verified (live), 27 Nov | Sign-in reached SignGuard as admin@vknowtech.ai |
| Graph directory sync | Verified (live), 27 Nov | 1 user imported with object ID |
| Re-test sign-in after the localStorage change | Not run | Each sign-in needs an MFA code that goes to the manager's phone |
| Profile update → sync → signature shows new value | Not run | Needs a change in Entra ID and a second sync |
| Template publish → signature in a real Outlook mailbox | Not run | Needs the Outlook copy test or the add-in |
| New email, reply, forward in real Outlook | Not run | Rules for new/reply/forward are only tested in the rules tester and automated tests |
| Shared mailbox / send-as | Not run | Only tested with sample data (Delegations, Mailbox access); the test tenant has one mailbox |
| Outlook add-in | Not run | Tenant change on hold until the manager approves |

## 7. Known limitations

- Signature links (verification page, banner click counting) point to `localhost` until SignGuard is hosted on a public HTTPS address.
- The copy-to-Outlook signature has no per-email verification code. That needs the add-in.
- Dev sign-in lets anyone act as anyone. It is refused on a public URL unless explicitly allowed.
- Approval mode "off" removes the human check. Seals and automatic checks still run, but nobody reviews the content.
- Rule dates are compared in UTC. The editor shows and accepts local time and converts.
