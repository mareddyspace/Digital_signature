"""Settings read from environment variables (see backend/.env.example)."""
import os
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import urlparse

BACKEND_DIR = Path(__file__).resolve().parent.parent
REPO_DIR = BACKEND_DIR.parent
DEV_CODE_SECRET = "dev-only-secret-change-me"


def _list(value: str) -> list[str]:
    return [v.strip().lower() for v in value.split(",") if v.strip()]


def normalize_database_url(url: str) -> str:
    """Render and Heroku give postgres:// URLs; SQLAlchemy with psycopg 3 needs postgresql+psycopg://."""
    for prefix in ("postgres://", "postgresql://"):
        if url.startswith(prefix):
            return "postgresql+psycopg://" + url[len(prefix):]
    return url


@dataclass(frozen=True)
class Settings:
    database_url: str = normalize_database_url(
        os.getenv("DATABASE_URL", f"sqlite:///{BACKEND_DIR.as_posix()}/signguard.db")
    )
    # Where people reach SignGuard, e.g. https://signguard.onrender.com (Render sets RENDER_EXTERNAL_URL).
    public_url: str = (os.getenv("PUBLIC_URL") or os.getenv("RENDER_EXTERNAL_URL") or "").rstrip("/")
    # "dev": callers identify themselves with the X-Dev-User header (local only).
    # "entra": callers must send a valid Entra ID access token.
    auth_mode: str = os.getenv("AUTH_MODE", "dev")
    # Escape hatch for a private test deployment; never set this for real users.
    allow_dev_auth_online: bool = os.getenv("ALLOW_DEV_AUTH_ONLINE", "").lower() == "true"
    # Public read-only demo: every request that would change data is refused server-side,
    # so dev sign-in (pick any sample account) is safe on a public URL. Sample directory only.
    demo_read_only: bool = os.getenv("DEMO_READ_ONLY", "").lower() == "true"
    # "sample": employees come from sample_data/employees.json.
    # "graph": employees come from Microsoft Graph (needs the Entra app settings below).
    directory_source: str = os.getenv("DIRECTORY_SOURCE", "sample")
    entra_tenant_id: str = os.getenv("ENTRA_TENANT_ID", "")
    entra_api_client_id: str = os.getenv("ENTRA_API_CLIENT_ID", "")
    entra_api_client_secret: str = os.getenv("ENTRA_API_CLIENT_SECRET", "")
    # The app registration's Application ID URI. Default: api://<public host>/<client id>,
    # the form Outlook add-in single sign-on requires.
    entra_api_audience_setting: str = os.getenv("ENTRA_API_AUDIENCE", "")
    entra_scope_name: str = os.getenv("ENTRA_SCOPE_NAME", "access_as_user")
    # The admin web app's own app registration (a single-page application, no secret). Public value.
    entra_spa_client_id: str = os.getenv("ENTRA_SPA_CLIENT_ID", "")
    # Off by default: Microsoft says never to authorize by email or preferred_username. Turn on only
    # to link SignGuard records that have no Entra object ID yet (sample or older records) to the
    # Microsoft account signing in with the same address in your own tenant, once each.
    entra_link_by_email: bool = os.getenv("ENTRA_LINK_BY_EMAIL", "").lower() == "true"
    # Email domains that count as "internal" for signature policies.
    internal_domains: list[str] = field(
        default_factory=lambda: _list(os.getenv("INTERNAL_DOMAINS", "contoso.com"))
    )
    company_name: str = os.getenv("COMPANY_NAME", "Contoso")
    verify_url_setting: str = os.getenv("VERIFY_URL", "")
    # Secret used to hash recipients and subjects for verification codes.
    code_secret: str = os.getenv("CODE_SECRET", DEV_CODE_SECRET)
    cors_origins: list[str] = field(
        default_factory=lambda: _list(
            os.getenv("CORS_ORIGINS", "http://localhost:5173,https://localhost:3000")
        )
    )
    stale_grant_days: int = int(os.getenv("STALE_GRANT_DAYS", "90"))
    directory_sync_hours: int = int(os.getenv("DIRECTORY_SYNC_HOURS", "24"))
    # Users made admin on directory sync (needed the first time you sync from Microsoft Graph).
    bootstrap_admins: list[str] = field(
        default_factory=lambda: _list(os.getenv("BOOTSTRAP_ADMINS", ""))
    )
    # Google Workspace: a service account with domain-wide delegation (see README).
    google_service_account_file: str = os.getenv("GOOGLE_SERVICE_ACCOUNT_FILE", "")
    # A Workspace admin the service account acts as when reading the directory.
    google_admin_email: str = os.getenv("GOOGLE_ADMIN_EMAIL", "")
    google_customer_id: str = os.getenv("GOOGLE_CUSTOMER_ID", "my_customer")
    # Optional: AI signature creation uses Claude when a key is set; otherwise the built-in designer rules.
    anthropic_api_key: str = os.getenv("ANTHROPIC_API_KEY", "")
    ai_model: str = os.getenv("AI_MODEL", "claude-sonnet-5-5")
    admin_static_dir: Path = Path(os.getenv("ADMIN_STATIC_DIR", str(BACKEND_DIR / "static" / "admin")))
    addin_dir: Path = Path(os.getenv("ADDIN_DIR", str(REPO_DIR / "outlook-addin")))

    @property
    def is_local(self) -> bool:
        host = urlparse(self.public_url).hostname if self.public_url else "localhost"
        return host in ("localhost", "127.0.0.1", "::1")

    @property
    def verify_url(self) -> str:
        if self.verify_url_setting:
            return self.verify_url_setting
        return f"{self.public_url}/verify" if self.public_url else "http://localhost:8000/verify"

    @property
    def base_url(self) -> str:
        """Where links inside signatures (banner click tracking) point."""
        return self.public_url or "http://localhost:8000"

    @property
    def google_configured(self) -> bool:
        return bool(self.google_service_account_file)

    @property
    def m365_configured(self) -> bool:
        return bool(self.entra_tenant_id and self.entra_api_client_id and self.entra_api_client_secret)

    @property
    def entra_api_audience(self) -> str:
        if self.entra_api_audience_setting:
            return self.entra_api_audience_setting
        host = urlparse(self.public_url).netloc if self.public_url else "localhost:3000"
        return f"api://{host}/{self.entra_api_client_id}"

    @property
    def entra_api_scope(self) -> str:
        return f"{self.entra_api_audience}/{self.entra_scope_name}"


def problems(s: Settings) -> list[str]:
    """Settings that would make a deployment unsafe or broken. Startup refuses to continue."""
    found = []
    if s.auth_mode not in ("dev", "entra"):
        found.append("AUTH_MODE must be 'dev' or 'entra'")
    if s.auth_mode == "dev" and not s.is_local and not s.allow_dev_auth_online and not s.demo_read_only:
        found.append(
            "AUTH_MODE=dev lets anyone act as any user. Use AUTH_MODE=entra for a public URL "
            "(or set ALLOW_DEV_AUTH_ONLINE=true for a private test only)."
        )
    if s.auth_mode == "entra":
        for name, value in (("ENTRA_TENANT_ID", s.entra_tenant_id), ("ENTRA_API_CLIENT_ID", s.entra_api_client_id),
                            ("ENTRA_SPA_CLIENT_ID", s.entra_spa_client_id)):
            if not value:
                found.append(f"{name} is required when AUTH_MODE=entra")
    if not s.is_local and s.code_secret == DEV_CODE_SECRET:
        found.append("Set CODE_SECRET to a long random value")
    if s.directory_source == "graph" and not (s.entra_tenant_id and s.entra_api_client_id and s.entra_api_client_secret):
        found.append("DIRECTORY_SOURCE=graph needs ENTRA_TENANT_ID, ENTRA_API_CLIENT_ID and ENTRA_API_CLIENT_SECRET")
    if s.demo_read_only and s.directory_source != "sample":
        found.append("DEMO_READ_ONLY=true only runs on the sample directory (DIRECTORY_SOURCE=sample)")
    if s.directory_source not in ("sample", "graph", "google"):
        found.append("DIRECTORY_SOURCE must be 'sample', 'graph' or 'google'")
    if s.directory_source == "google" and not (s.google_service_account_file and s.google_admin_email):
        found.append("DIRECTORY_SOURCE=google needs GOOGLE_SERVICE_ACCOUNT_FILE and GOOGLE_ADMIN_EMAIL")
    return found


settings = Settings()
