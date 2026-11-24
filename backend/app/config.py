"""Settings read from environment variables (see backend/.env.example)."""
import os
from dataclasses import dataclass, field
from pathlib import Path

_BACKEND_DIR = Path(__file__).resolve().parent.parent


def _list(value: str) -> list[str]:
    return [v.strip().lower() for v in value.split(",") if v.strip()]


@dataclass(frozen=True)
class Settings:
    database_url: str = os.getenv("DATABASE_URL", f"sqlite:///{_BACKEND_DIR.as_posix()}/signguard.db")
    # "dev": callers identify themselves with the X-Dev-User header (no Microsoft 365 needed).
    # "entra": callers must send a valid Entra ID access token.
    auth_mode: str = os.getenv("AUTH_MODE", "dev")
    # "sample": employees come from sample_data/employees.json.
    # "graph": employees come from Microsoft Graph (needs the Entra app settings below).
    directory_source: str = os.getenv("DIRECTORY_SOURCE", "sample")
    entra_tenant_id: str = os.getenv("ENTRA_TENANT_ID", "")
    entra_api_client_id: str = os.getenv("ENTRA_API_CLIENT_ID", "")
    entra_api_client_secret: str = os.getenv("ENTRA_API_CLIENT_SECRET", "")
    entra_api_audience: str = os.getenv("ENTRA_API_AUDIENCE", "")
    # Email domains that count as "internal" for signature policies.
    internal_domains: list[str] = field(
        default_factory=lambda: _list(os.getenv("INTERNAL_DOMAINS", "contoso.com"))
    )
    company_name: str = os.getenv("COMPANY_NAME", "Contoso")
    verify_url: str = os.getenv("VERIFY_URL", "http://localhost:8000/verify")
    # Secret used to hash recipients and subjects for verification codes. Change it in production.
    code_secret: str = os.getenv("CODE_SECRET", "dev-only-secret-change-me")
    cors_origins: list[str] = field(
        default_factory=lambda: _list(
            os.getenv("CORS_ORIGINS", "http://localhost:5173,https://localhost:3000")
        )
    )
    stale_grant_days: int = int(os.getenv("STALE_GRANT_DAYS", "90"))
    # Users made admin on directory sync (needed the first time you sync from Microsoft Graph).
    bootstrap_admins: list[str] = field(
        default_factory=lambda: _list(os.getenv("BOOTSTRAP_ADMINS", ""))
    )


settings = Settings()
