# SignGuard

Email signatures for Microsoft 365, built around one question: **did this email really come from this person, and were they allowed to send it?**

SignGuard does what signature tools do (templates, directory data, rules, an Outlook add-in) and adds:

- **Approved, time-limited delegation**: "Priya Sharma on behalf of Arjun Rao" only after Arjun approves, and only until the end date.
- **Mailbox permission audit**: every Full Access, Send As and Send on Behalf grant, flagged when it has no approval, is old, or is never used.
- **Sender verification codes**: external emails carry a code like `SG-7K4P-Q2MX` that recipients check on a public page.
- **Trust Center** home screen, **My Trust** page for every employee, and an append-only **audit trail**.

### Signature platform

- **Drag-and-drop designer** (Templates & Designer): build signatures from blocks (logo, photo, name, title, contact, social, button, banner and disclaimer slots…), one or two columns, with a live preview rendered for any employee on desktop or mobile. The output is table-based, inline-styled HTML that Outlook and Gmail render the same way. Hand-written HTML templates still work.
- **AI Studio**: describe a signature in plain English and get three on-brand designs, each compliance-scored. Uses Claude when `ANTHROPIC_API_KEY` is set; otherwise a built-in rules engine (works offline). The AI returns designer layouts, never raw HTML.
- **Brand kit and compliance checker**: logo, colours, font, links and rules in one place. Every template gets a 0–100 score (email safety, required fields, brand colours and font, logo, width, readability and contrast, image alt text, secure links, verification code). Optionally block submission below a minimum score.
- **Campaign banners** by department, recipient type and dates, with view and click tracking (`/r/c/<id>` redirects only to the stored link).
- **Legal disclaimers** added by rule (department, internal/external), positioned by a template marker or appended.
- **Department assignments**: a matrix of which template, banner and disclaimers each department gets for new/reply, internal/external email.
- **Signature integrity**: approved versions are sealed (HMAC-SHA256); a version changed outside approval is never used and raises an alert. Each external email's signature is recorded with its verification code, so recipients can paste a signature on the public verify page and see whether details such as a phone number were altered.
- **Automation**: findings with one-click fixes (policies that never apply, departments with no external signature, off-brand or tampered templates, ended banners) and scheduled jobs (end banners on their end date, starter policies for new departments, optional push to Gmail on approval).
- **Integrations and deployment**: Microsoft 365 (Graph directory + Outlook add-in, plus a static-signature export applied with `workers/deploy-outlook-signatures.ps1`) and Google Workspace (Admin SDK directory + Gmail signature push via a service account). Without credentials, Google deployments run in simulated mode.
- **Analytics**: signatures per day, coverage, usage by template and department, banner click-through, verification checks.

## Project layout

| Folder | What it is |
| --- | --- |
| `backend/` | FastAPI API, SQLite by default (PostgreSQL optional), sample directory data, tests |
| `admin-web/` | React admin app: Trust Center, delegations, permissions, templates, policies, people, audit, My Trust, and a "Try it" compose page |
| `outlook-addin/` | Outlook add-in: manifest, event handlers, task pane, HTTPS dev server |
| `workers/` | PowerShell scripts for Exchange Online: export permissions, apply delegations |

## Run it locally (no Microsoft 365 needed)

You need Python 3.12+ and Node.js 20+.

From the repository root, the quickest Windows setup is:

```powershell
.\run.ps1
```

This opens the backend on port 8000 and the admin web app on port 5173.
To use separate terminals instead:

```powershell
cd backend
python -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt
.venv\Scripts\python -m app.migrate
.venv\Scripts\python -m uvicorn app.main:app --port 8000
```

In a second terminal:

```powershell
cd admin-web
npm install
npm run dev
```

Open http://localhost:5173. On first start the backend creates `backend/signguard.db` with 8 sample people at contoso.com, three templates, three policies and five sample mailbox permissions. Use **Signed in as** at the bottom left to switch between people. Delete `signguard.db` to start fresh.

Run the tests with `backend\.venv\Scripts\python -m pytest backend/tests`.

### Database changes (migrations)

Schema changes are applied by an explicit step, never by the running app. Back up `backend/signguard.db`, then:

```powershell
cd backend
.venv\Scripts\python -m pip install -r requirements.txt
.venv\Scripts\python -m app.migrate            # upgrade to the newest schema
.venv\Scripts\python -m app.migrate --check    # exit code 1 if an upgrade is pending
```

At startup the backend only checks the schema and refuses to start, naming this command, if an upgrade is pending. A database created before migrations existed is recognised and marked as the baseline (`0001_baseline`) with no data changed. Use `python -m app.migrate` rather than plain `alembic upgrade head` for that first upgrade.

When you change `backend/app/models.py`, add a migration and review it before committing:

```powershell
.venv\Scripts\alembic revision --autogenerate -m "describe the change"
```

`tests/test_migrations.py` fails if the models and the migrations disagree. To try an upgrade safely on a copy of a database: `python scripts/migration_dry_run.py <copy of signguard.db>`.

## Demo script (5 minutes)

1. As **Meera Iyer (Admin)**, open the **Trust Center**: flagged permissions and people with missing details.
2. Switch to **Priya Sharma**. In **Try it: write an email**, write to `buyer@fabrikam.com`: full signature with a verification code. Change the recipient to `rahul.verma@contoso.com`: short internal signature, no code.
3. Change **From** to Arjun Rao's mailbox: SignGuard warns that Priya has no approved delegation and uses her own signature.
4. In **Delegations**, Priya requests to send for Arjun for a week. Switch to **Arjun Rao** and approve it.
5. Back as Priya, write from Arjun's mailbox again: the signature now says "on behalf of Arjun Rao, Finance Director". Send it.
6. Click **Check as the real recipient** (Verified), **Check as someone else who copied it** (warning), and **Check a fake email's code** (warning). The public page is at http://localhost:5173/verify.
7. As Meera, open **Templates & Designer → Modern brand** and drag a **Button** block onto the canvas; the preview and compliance score update as you go. Try **AI Studio** with "modern two-column for Sales with photo and a Book a demo button".
8. As Sara, write to an outside address in **Try it**: the Sales webinar banner and the confidentiality disclaimer appear. Copy the signature, change the phone number, and paste it into **Signature integrity** (or the public verify page) with the code: SignGuard reports the changed line.
9. Open **Automation**, **Department assignments**, **Integrations** (run a simulated Google Workspace deployment) and **Analytics**.
10. As Meera, open **Mailbox permissions** (Sara Khan's old, unused Send As on Arjun's mailbox is flagged) and **Audit trail** (every step above, exportable to CSV).

## Use it in Outlook (Microsoft 365 test tenant)

1. Install the add-in dev server and trust its certificate (once):
   ```powershell
   cd outlook-addin
   npm install
   npm run certs
   npm start
   ```
   It serves the add-in on https://localhost:3000 and forwards `/api` to the backend.
2. In Outlook on the web, open a new email, choose **Apps → Get Add-ins → My add-ins → Add a custom add-in → Add from file**, and pick `outlook-addin/manifest.xml`. (Menu names move around between Outlook versions; search "sideload Outlook add-in" on Microsoft Learn if yours differ.)
3. Make sure your Microsoft 365 address exists in SignGuard. With sample data it won't, so either add yourself to `backend/sample_data/employees.json` (and delete `signguard.db`), or switch to Graph sync below.
4. Open a new email: the signature appears by itself. Add an outside recipient: the full signature and a code appear. Click **SignGuard** in the ribbon to see why.

While `AUTH_MODE=dev`, the add-in identifies you by your mailbox address. That is fine for a test tenant only; switch to Entra sign-in before real use.

### Connect your tenant's directory

1. In Entra ID, register an app **SignGuard API**. Add the Microsoft Graph **application** permission `User.Read.All` and grant admin consent. Create a client secret.
2. Set these before starting the backend (see `backend/.env.example`):
   ```powershell
   $env:DIRECTORY_SOURCE = "graph"
   $env:ENTRA_TENANT_ID = "<tenant id>"
   $env:ENTRA_API_CLIENT_ID = "<app id>"
   $env:ENTRA_API_CLIENT_SECRET = "<secret>"
   $env:BOOTSTRAP_ADMINS = "you@yourtenant.onmicrosoft.com"
   $env:INTERNAL_DOMAINS = "yourtenant.onmicrosoft.com"
   ```
3. Delete `backend/signguard.db`, start the backend, and use **People → Sync directory now**.

### Connect Google Workspace

1. In Google Cloud, create a service account, enable the **Gmail API** and **Admin SDK API**, and download a JSON key.
2. In the Google Admin console, **Security → Access and data control → API controls → Domain-wide delegation**, add the service account's client ID with these scopes:
   `https://www.googleapis.com/auth/gmail.settings.basic,https://www.googleapis.com/auth/admin.directory.user.readonly`
3. Set before starting the backend:
   ```powershell
   $env:GOOGLE_SERVICE_ACCOUNT_FILE = "C:\secrets\signguard-sa.json"
   $env:GOOGLE_ADMIN_EMAIL = "admin@yourdomain.com"
   $env:DIRECTORY_SOURCE = "google"   # optional: use Google as the employee directory
   ```
4. **Integrations → Deploy signatures → Google Workspace**. Keep the key file out of the repository.

### AI signature creation with Claude (optional)

Set `ANTHROPIC_API_KEY` (and optionally `AI_MODEL`, default `claude-sonnet-5-5`). Without a key, AI Studio uses the built-in rules engine.

### Real mailbox permissions

Run `workers/export-mailbox-permissions.ps1` (needs the `ExchangeOnlineManagement` PowerShell module and an Exchange admin), then **Mailbox permissions → Import from Exchange** with the JSON file. Approved delegations and removals are applied with `workers/apply-delegation.ps1`.

## Not built yet

- Entra ID sign-in in the admin app and add-in (`AUTH_MODE=entra` is implemented in the backend; the front ends still send the dev header).
- Running the Exchange scripts automatically from a worker; today approvals are recorded and the scripts are run by hand.
- Last-used dates from the mailbox audit log, and grant dates (the export can't read them).
- Multiple companies in one deployment.
- Image uploads for logos and banners (use https URLs from your CDN or website for now).
- Analytics counts emails composed with the add-in or compose page; Gmail signatures pushed by deployment aren't counted per email.
- Testing on classic Outlook for Windows, Mac and mobile. Outlook for iOS and Android don't run the send-time event, so `sent_at` stays empty there (codes still verify).
