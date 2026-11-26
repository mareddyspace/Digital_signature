"""Brand kit values, marketing banners and legal disclaimers added to signatures."""
from __future__ import annotations

import html
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from .config import settings
from .designer import color
from .models import BrandKit, Campaign, Disclaimer, utcnow

BRAND_FIELDS = (
    "company_name", "primary_color", "secondary_color", "accent_color", "palette", "font_family",
    "logo_url", "logo_width", "website", "address", "linkedin_url", "twitter_url", "facebook_url",
    "instagram_url", "youtube_url", "max_width", "require_logo", "enforce_compliance", "min_compliance_score",
)


def get_brand(db: Session) -> BrandKit:
    brand = db.get(BrandKit, 1)
    if brand is None:
        brand = BrandKit(id=1, company_name=settings.company_name)
        db.add(brand)
        db.flush()
    return brand


def brand_dict(brand: BrandKit) -> dict:
    return {f: getattr(brand, f) for f in BRAND_FIELDS} | {"updated_by": brand.updated_by, "updated_at": brand.updated_at}


def brand_values(brand: BrandKit) -> dict[str, str]:
    """Placeholder values that come from the brand kit rather than the employee."""
    site = brand.website or ""
    return {
        "logo_url": brand.logo_url,
        "website": site,
        "website_label": site.split("://", 1)[-1].rstrip("/"),
        "address": brand.address,
        "brand_color": brand.primary_color,
        "linkedin_url": brand.linkedin_url,
        "twitter_url": brand.twitter_url,
        "facebook_url": brand.facebook_url,
        "instagram_url": brand.instagram_url,
        "youtube_url": brand.youtube_url,
        "company": brand.company_name or settings.company_name,
    }


def _matches(departments: str, recipient_type: str, department: str, rtype: str) -> bool:
    depts = [d.strip().lower() for d in departments.split(",") if d.strip()]
    if depts and department.lower() not in depts:
        return False
    return recipient_type in ("any", rtype)


def campaign_live(c: Campaign, now: datetime | None = None) -> bool:
    now = now or utcnow()
    return c.enabled and (c.starts_at is None or c.starts_at <= now) and (c.ends_at is None or c.ends_at > now)


def campaign_state(c: Campaign, now: datetime | None = None) -> str:
    now = now or utcnow()
    if not c.enabled:
        return "disabled"
    if c.starts_at and c.starts_at > now:
        return "scheduled"
    if c.ends_at and c.ends_at <= now:
        return "ended"
    return "live"


def pick_campaign(db: Session, department: str, rtype: str) -> Campaign | None:
    now = utcnow()
    for c in db.scalars(select(Campaign).order_by(Campaign.priority, Campaign.id)):
        if campaign_live(c, now) and _matches(c.departments, c.recipient_type, department, rtype):
            return c
    return None


def tracking_url(c: Campaign) -> str:
    return f"{settings.base_url}/r/c/{c.id}"


def campaign_html(c: Campaign, width: int = 560) -> str:
    e = lambda v: html.escape(v or "", quote=True)  # noqa: E731
    href = tracking_url(c) if c.link_url else ""
    if c.image_url:
        img = (f'<img src="{e(c.image_url)}" width="{width}" alt="{e(c.alt_text or c.headline or c.name)}" '
               f'style="display:block;border:0;width:100%;max-width:{width}px;height:auto;">')
        inner = f'<a href="{e(href)}" style="text-decoration:none;">{img}</a>' if href else img
        return f'<table cellpadding="0" cellspacing="0" border="0" style="margin-top:12px;"><tr><td>{inner}</td></tr></table>'
    bg = color(c.background, "#11263f")
    fg = color(c.text_color, "#ffffff")
    cta = (f'<td valign="middle" align="right" style="padding:0 14px 0 8px;">'
           f'<a href="{e(href)}" style="display:inline-block;padding:7px 12px;background:{fg};color:{bg};'
           f'border-radius:4px;font-weight:bold;font-size:12px;text-decoration:none;white-space:nowrap;">{e(c.cta_text or "Learn more")}</a></td>'
           ) if href else ""
    return (
        f'<table cellpadding="0" cellspacing="0" border="0" style="margin-top:12px;width:100%;max-width:{width}px;'
        f'background:{bg};border-radius:6px;font-family:Arial,Helvetica,sans-serif;"><tr>'
        f'<td valign="middle" style="padding:12px 14px;color:{fg};">'
        f'<div style="font-size:14px;font-weight:bold;color:{fg};">{e(c.headline or c.name)}</div>'
        + (f'<div style="font-size:12px;color:{fg};padding-top:2px;">{e(c.body)}</div>' if c.body else "")
        + f"</td>{cta}</tr></table>"
    )


def pick_disclaimers(db: Session, department: str, rtype: str) -> list[Disclaimer]:
    rows = db.scalars(select(Disclaimer).where(Disclaimer.enabled).order_by(Disclaimer.priority, Disclaimer.id))
    return [d for d in rows if _matches(d.departments, d.recipient_type, department, rtype)]


def disclaimer_html(items: list[Disclaimer], width: int = 560) -> str:
    if not items:
        return ""
    paras = "".join(
        f'<p style="margin:6px 0 0;">{html.escape(d.text).replace(chr(10), "<br>")}</p>' for d in items
    )
    return (f'<table cellpadding="0" cellspacing="0" border="0" style="margin-top:10px;max-width:{width}px;">'
            f'<tr><td style="padding-top:6px;border-top:1px solid #e1e6ec;font-family:Arial,Helvetica,sans-serif;'
            f'font-size:10px;line-height:1.4;color:#6b7785;">{paras}</td></tr></table>')
