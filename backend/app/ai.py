"""AI-assisted signature creation.

generate(prompt, brand) returns up to three designer layouts for a plain-English request such as
"modern two-column signature for the sales team with photo, LinkedIn and a booking button".

With ANTHROPIC_API_KEY set, Claude writes the layouts (as designer JSON, never raw HTML, so the
output is always validated and email-safe). Without a key, or if the call fails, a built-in rules
engine reads the request instead, so the feature works offline and in tests.
"""
from __future__ import annotations

import json
import logging
import re
from typing import Any

import httpx

from . import designer
from .config import settings

log = logging.getLogger("signguard.ai")

COLOR_WORDS = {
    "blue": "#2563eb", "navy": "#1e3a5f", "teal": "#0f766e", "green": "#15803d", "red": "#b91c1c",
    "orange": "#c2410c", "purple": "#6d28d9", "pink": "#be185d", "black": "#111827", "grey": "#4b5563",
    "gray": "#4b5563", "gold": "#a16207", "maroon": "#7f1d1d",
}
FONT_WORDS = {
    "serif": "Georgia, 'Times New Roman', serif", "georgia": "Georgia, 'Times New Roman', serif",
    "verdana": "Verdana, Geneva, sans-serif", "tahoma": "Tahoma, Geneva, sans-serif",
    "segoe": "'Segoe UI', Arial, sans-serif", "calibri": "Calibri, Arial, sans-serif",
    "trebuchet": "'Trebuchet MS', Arial, sans-serif",
}
NETWORKS = ("linkedin", "twitter", "facebook", "instagram", "youtube")


def _has(text: str, *words: str) -> bool:
    return any(re.search(rf"\b{re.escape(w)}", text) for w in words)


def rules_engine(prompt: str, brand: dict) -> list[dict]:
    """Deterministic interpretation of the request. Returns three variants."""
    t = prompt.lower()
    accent = next((c for w, c in COLOR_WORDS.items() if _has(t, w)), brand.get("primary_color") or "#2878d0")
    font = next((f for w, f in FONT_WORDS.items() if _has(t, w)), None)
    if not font:
        font = brand.get("font_family") if brand.get("font_family") in designer.SAFE_FONTS else designer.SAFE_FONTS[0]
    minimal = _has(t, "minimal", "simple", "clean", "short", "compact", "one line", "internal")
    split = _has(t, "two-column", "two column", "split", "side by side", "columns", "modern")
    photo = _has(t, "photo", "headshot", "picture", "avatar")
    logo = not _has(t, "no logo", "without logo") and (bool(brand.get("logo_url")) or _has(t, "logo", "brand"))
    nets = [n for n in NETWORKS if _has(t, n)] or ([] if minimal else ["linkedin"])
    if _has(t, "x.com", " x ", "tweet"):
        nets = list(dict.fromkeys([*nets, "twitter"]))
    if _has(t, "social") and len(nets) < 2:
        nets = ["linkedin", "twitter", "instagram"]
    button = None
    m = re.search(r"(https?://\S+)", prompt)
    if _has(t, "book", "meeting", "calendar", "schedule", "demo", "button", "cta"):
        label = "Book a demo" if _has(t, "demo") else "Book a meeting"
        button = {"label": label, "url": m.group(1).rstrip(".,)") if m else "{{website}}"}
    banner = _has(t, "banner", "campaign", "promo", "event", "webinar", "marketing")
    legal = not _has(t, "no disclaimer", "without disclaimer")
    address = _has(t, "address", "office", "location")
    bold = _has(t, "bold", "strong", "executive", "leadership", "ceo")
    tagline = None
    q = re.search(r"[\"“']([^\"”']{3,120})[\"”']", prompt)
    if q:
        tagline = q.group(1)

    def blocks(layout: str) -> list[dict]:
        n = iter(range(1, 100))
        out: list[dict] = []

        def add(t_: str, col: str = "right", **props: Any) -> None:
            out.append({"id": f"ai{next(n)}", "type": t_, "col": col, "props": props})

        side = "left" if layout == "split" else "right"
        if logo:
            add("logo", side)
        if photo:
            add("photo", side, shape="circle", size=80 if bold else 68)
        add("name", size=19 if bold else (14 if layout == "minimal" else 16))
        add("title", show_department=layout != "minimal", show_company=layout == "stack")
        add("delegation")
        if layout == "stack":
            add("divider", color="#e1e6ec")
        if layout == "minimal":
            add("contact", fields=["phone", "email"], inline=True)
        else:
            add("contact", fields=["phone", "mobile", "email", "website"])
        if address and layout != "minimal":
            add("address")
        if tagline:
            add("text", text=tagline, italic=True)
        if nets and layout != "minimal":
            add("social", networks=nets)
        if button and layout != "minimal":
            add("button", **button)
        add("verification")
        if banner and layout != "minimal":
            add("banner")
        if legal:
            add("disclaimer")
        return out

    order = ["minimal", "split", "stack"] if minimal else (["split", "stack", "minimal"] if split else ["stack", "split", "minimal"])
    names = {"stack": "Corporate stack", "split": "Modern two-column", "minimal": "Minimal"}
    variants = []
    for layout in order:
        settings_ = {
            "layout": "split" if layout == "split" else "stack",
            "font": font, "accent": accent,
            "text_color": brand.get("secondary_color") or "#1f2933",
            "width": 520 if layout == "minimal" else 580,
            "font_size": 12 if layout == "minimal" else 13,
        }
        variants.append({
            "name": names[layout],
            "rationale": _rationale(layout, photo, logo, nets, button, banner),
            "design": designer.normalize({"settings": settings_, "blocks": blocks(layout)}),
        })
    return variants


def _rationale(layout: str, photo: bool, logo: bool, nets: list[str], button: Any, banner: bool) -> str:
    bits = {
        "stack": "Single column that reads well on phones and in Outlook's reading pane",
        "split": "Logo and photo on the left, contact details on the right",
        "minimal": "Compact, for internal mail and replies",
    }[layout]
    extras = [x for x, on in (("photo", photo), ("logo", logo), ("social links", bool(nets) and layout != "minimal"),
                              ("call-to-action button", bool(button) and layout != "minimal"),
                              ("campaign banner slot", banner and layout != "minimal")) if on]
    return bits + (f"; includes {', '.join(extras)}" if extras else "") + "."


SYSTEM = """You design corporate email signatures. Reply with JSON only: {"variants": [ ... up to 3 ... ]}.
Each variant: {"name": str, "rationale": str (one sentence), "design": {"settings": {...}, "blocks": [...]}}.
settings: layout ("stack"|"split"), font (one of: %s), text_color, accent (#rrggbb), width (280-700), font_size (10-16).
blocks: [{"id": str, "type": one of %s, "col": "left"|"right" (split only), "props": {...}}].
props by type: name{size,bold,color} title{show_department,show_company} contact{fields:[phone,mobile,email,website],inline}
text{text,italic,size} divider{color} social{networks:[linkedin,twitter,facebook,instagram,youtube]} button{label,url}
logo{width} photo{shape:"circle"|"square",size}. Always include name, title, delegation, contact(with email), verification, disclaimer.
Use the brand colours given. Never output HTML."""


def _claude(prompt: str, brand: dict) -> list[dict]:
    brand_summary = {k: brand.get(k) for k in ("company_name", "primary_color", "secondary_color", "accent_color", "font_family", "logo_url")}
    resp = httpx.post(
        "https://api.anthropic.com/v1/messages",
        headers={"x-api-key": settings.anthropic_api_key, "anthropic-version": "2023-06-01", "content-type": "application/json"},
        json={
            "model": settings.ai_model,
            "max_tokens": 3000,
            "system": SYSTEM % (", ".join(designer.SAFE_FONTS), ", ".join(designer.BLOCK_TYPES)),
            "messages": [{"role": "user", "content": f"Brand: {json.dumps(brand_summary)}\nRequest: {prompt}"}],
        },
        timeout=45,
    )
    resp.raise_for_status()
    text = "".join(part.get("text", "") for part in resp.json().get("content", []))
    start, end = text.find("{"), text.rfind("}")
    data = json.loads(text[start:end + 1])
    out = []
    for v in data.get("variants", [])[:3]:
        out.append({
            "name": str(v.get("name") or "Suggestion")[:80],
            "rationale": str(v.get("rationale") or "")[:300],
            "design": designer.normalize(v.get("design")),  # validates; raises on bad output
        })
    if not out:
        raise ValueError("No variants in reply")
    return out


def generate(prompt: str, brand: dict) -> dict:
    prompt = (prompt or "").strip()[:1000] or "professional signature"
    if settings.anthropic_api_key:
        try:
            return {"engine": "claude", "variants": _claude(prompt, brand)}
        except Exception as exc:  # fall back rather than fail the designer
            log.warning("AI generation failed, using rules engine: %s", exc)
    return {"engine": "rules", "variants": rules_engine(prompt, brand)}
