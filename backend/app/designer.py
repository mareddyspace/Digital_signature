"""Turn a designer layout (JSON blocks) into email-safe signature HTML.

The output uses only nested tables and inline styles, which is what Outlook (Word renderer),
Outlook on the web, Gmail and Apple Mail all display the same way. Text typed in the designer
is HTML-escaped; {{placeholders}} pass through and are filled per employee by rendering.render.

A design looks like:
    {"settings": {"layout": "stack" | "split", "font": "...", "text_color": "#..",
                  "accent": "#..", "width": 560, "font_size": 13},
     "blocks": [{"id": "b1", "type": "name", "col": "right", "props": {...}}, ...]}
"""
from __future__ import annotations

import html
import re
from typing import Any

HEX = re.compile(r"^#[0-9a-fA-F]{6}$")
PLACEHOLDER_URL = re.compile(r"^\{\{\w+\}\}$")
SAFE_FONTS = (
    "Arial, Helvetica, sans-serif",
    "Helvetica, Arial, sans-serif",
    "Verdana, Geneva, sans-serif",
    "Tahoma, Geneva, sans-serif",
    "'Segoe UI', Arial, sans-serif",
    "Georgia, 'Times New Roman', serif",
    "'Times New Roman', Times, serif",
    "'Trebuchet MS', Arial, sans-serif",
    "Calibri, Arial, sans-serif",
)
BLOCK_TYPES = (
    "logo", "photo", "name", "title", "contact", "text", "divider", "spacer",
    "social", "address", "button", "delegation", "verification", "banner", "disclaimer",
)
SOCIAL_NETWORKS = {
    "linkedin": ("LinkedIn", "{{linkedin_url}}"),
    "twitter": ("X", "{{twitter_url}}"),
    "facebook": ("Facebook", "{{facebook_url}}"),
    "instagram": ("Instagram", "{{instagram_url}}"),
    "youtube": ("YouTube", "{{youtube_url}}"),
}
CONTACT_FIELDS = {
    "phone": ("T", "{{phone}}", "tel:{{phone}}"),
    "mobile": ("M", "{{mobile}}", "tel:{{mobile}}"),
    "email": ("E", "{{email}}", "mailto:{{email}}"),
    "website": ("W", "{{website_label}}", "{{website}}"),
}
MAX_BLOCKS = 40


class DesignError(ValueError):
    pass


def esc(value: Any) -> str:
    return html.escape(str(value or ""), quote=True)


def color(value: Any, default: str) -> str:
    return value if isinstance(value, str) and HEX.match(value) else default


def number(value: Any, default: int, lo: int, hi: int) -> int:
    try:
        return max(lo, min(hi, int(value)))
    except (TypeError, ValueError):
        return default


def safe_url(value: Any, allow_mailto: bool = False) -> str:
    """Only http(s) URLs or a single {{placeholder}}; anything else (javascript:, data:) is dropped."""
    v = str(value or "").strip()
    if not v:
        return ""
    if PLACEHOLDER_URL.match(v):
        return v
    lowered = v.lower()
    if lowered.startswith(("https://", "http://")) or (allow_mailto and lowered.startswith(("mailto:", "tel:"))):
        return esc(v)
    return ""


def normalize(design: Any) -> dict:
    """Validate and fill defaults. Raises DesignError on structural problems."""
    if not isinstance(design, dict):
        raise DesignError("Design must be an object")
    s = design.get("settings") or {}
    blocks = design.get("blocks") or []
    if not isinstance(blocks, list):
        raise DesignError("blocks must be a list")
    if len(blocks) > MAX_BLOCKS:
        raise DesignError(f"A signature can have at most {MAX_BLOCKS} blocks")
    font = s.get("font") if s.get("font") in SAFE_FONTS else SAFE_FONTS[0]
    settings = {
        "layout": "split" if s.get("layout") == "split" else "stack",
        "font": font,
        "text_color": color(s.get("text_color"), "#1f2933"),
        "accent": color(s.get("accent"), "#2878d0"),
        "muted": color(s.get("muted"), "#5b6b7c"),
        "width": number(s.get("width"), 560, 280, 700),
        "font_size": number(s.get("font_size"), 13, 10, 16),
        "divider": bool(s.get("divider", True)),
    }
    out = []
    for i, b in enumerate(blocks):
        if not isinstance(b, dict) or b.get("type") not in BLOCK_TYPES:
            raise DesignError(f"Block {i + 1} has an unknown type")
        out.append({
            "id": str(b.get("id") or f"b{i + 1}")[:40],
            "type": b["type"],
            "col": "left" if b.get("col") == "left" else "right",
            "props": b.get("props") if isinstance(b.get("props"), dict) else {},
        })
    return {"settings": settings, "blocks": out}


def _cell(content: str, style: str = "", pad: str = "2px 0") -> str:
    return f'<tr><td style="padding:{pad};{style}">{content}</td></tr>'


def render_block(b: dict, s: dict) -> str:
    p = b["props"]
    t = b["type"]
    fs = s["font_size"]
    accent = color(p.get("color"), s["accent"])
    muted = s["muted"]
    if t == "logo":
        src = safe_url(p.get("src") or "{{logo_url}}")
        width = number(p.get("width"), 120, 40, 300)
        if not src:
            return ""
        img = (f'<img src="{src}" width="{width}" alt="{esc(p.get("alt") or "{{company}}")}" '
               f'style="display:block;border:0;width:{width}px;max-width:{width}px;height:auto;">')
        link = safe_url(p.get("link") or "{{website}}")
        if link:
            img = f'<a href="{link}" style="text-decoration:none;">{img}</a>'
        body = _cell(img, pad="0 0 8px")
        return f"{{{{#logo_url}}}}{body}{{{{/logo_url}}}}" if src == "{{logo_url}}" else body
    if t == "photo":
        size = number(p.get("size"), 72, 40, 140)
        radius = "50%" if p.get("shape", "circle") == "circle" else "6px"
        img = (f'<img src="{{{{photo_url}}}}" width="{size}" height="{size}" alt="{{{{name}}}}" '
               f'style="display:block;border:0;width:{size}px;height:{size}px;border-radius:{radius};">')
        return "{{#photo_url}}" + _cell(img, pad="0 0 8px") + "{{/photo_url}}"
    if t == "name":
        size = number(p.get("size"), fs + 4, 12, 26)
        weight = "bold" if p.get("bold", True) else "normal"
        c = color(p.get("color"), s["text_color"])
        return _cell("{{name}}", f"font-size:{size}px;font-weight:{weight};color:{c};line-height:1.3;", "0 0 2px")
    if t == "title":
        show_dept = p.get("show_department", True)
        show_company = p.get("show_company", False)
        parts = ["{{job_title}}"]
        if show_dept:
            parts.append("{{#department}} | {{department}}{{/department}}")
        if show_company:
            parts.append(" | {{company}}")
        return _cell("".join(parts), f"font-size:{fs}px;color:{accent};", "0 0 6px")
    if t == "contact":
        fields = p.get("fields") or ["phone", "mobile", "email", "website"]
        inline = p.get("inline", False)
        items = []
        for f in fields:
            if f not in CONTACT_FIELDS:
                continue
            label, value, href = CONTACT_FIELDS[f]
            a = f'<a href="{href}" style="color:{s["text_color"]};text-decoration:none;">{value}</a>'
            item = f'<span style="color:{accent};font-weight:bold;">{label}</span>&nbsp;{a}'
            items.append((f, item))
        if inline:
            joined = "".join(
                f"{{{{#{f}}}}}{'&nbsp;&nbsp;' if n else ''}{item}{{{{/{f}}}}}" for n, (f, item) in enumerate(items)
            )
            return _cell(joined, f"font-size:{fs - 1}px;color:{s['text_color']};")
        return "".join(
            f"{{{{#{f}}}}}" + _cell(item, f"font-size:{fs - 1}px;color:{s['text_color']};", "1px 0") + f"{{{{/{f}}}}}"
            for f, item in items
        )
    if t == "text":
        text = esc(p.get("text", "")).replace("\n", "<br>")
        size = number(p.get("size"), fs - 1, 9, 20)
        c = color(p.get("color"), s["text_color"])
        style = f"font-size:{size}px;color:{c};" + ("font-style:italic;" if p.get("italic") else "")
        return _cell(text, style, "4px 0") if text else ""
    if t == "divider":
        c = color(p.get("color"), "#e1e6ec")
        thick = number(p.get("thickness"), 1, 1, 6)
        return (f'<tr><td style="padding:8px 0;"><table cellpadding="0" cellspacing="0" border="0" width="100%">'
                f'<tr><td style="border-top:{thick}px solid {c};font-size:1px;line-height:1px;">&nbsp;</td></tr>'
                f"</table></td></tr>")
    if t == "spacer":
        h = number(p.get("height"), 8, 2, 40)
        return f'<tr><td style="height:{h}px;font-size:1px;line-height:1px;">&nbsp;</td></tr>'
    if t == "social":
        nets = [n for n in (p.get("networks") or ["linkedin", "twitter"]) if n in SOCIAL_NETWORKS]
        links = []
        for n in nets:
            label, url = SOCIAL_NETWORKS[n]
            field = url.strip("{}")
            links.append(
                f"{{{{#{field}}}}}<a href=\"{url}\" style=\"display:inline-block;margin-right:6px;padding:3px 8px;"
                f"background:{accent};color:#ffffff;border-radius:3px;font-size:{fs - 3}px;text-decoration:none;"
                f"font-weight:bold;\">{label}</a>{{{{/{field}}}}}"
            )
        return _cell("".join(links), "", "6px 0 2px") if links else ""
    if t == "address":
        return "{{#address}}" + _cell("{{address}}", f"font-size:{fs - 2}px;color:{muted};", "2px 0") + "{{/address}}"
    if t == "button":
        url = safe_url(p.get("url"))
        label = esc(p.get("label") or "Book a meeting")
        if not url:
            return ""
        bg = color(p.get("color"), accent)
        return _cell(
            f'<a href="{url}" style="display:inline-block;padding:7px 14px;background:{bg};color:#ffffff;'
            f'border-radius:4px;font-size:{fs - 1}px;font-weight:bold;text-decoration:none;">{label}</a>',
            "", "8px 0 2px",
        )
    if t == "delegation":
        return ("{{#on_behalf_of}}" + _cell(
            "on behalf of <b>{{on_behalf_of}}</b>{{#on_behalf_title}}, {{on_behalf_title}}{{/on_behalf_title}}",
            f"font-size:{fs - 1}px;color:{muted};", "0 0 4px") + "{{/on_behalf_of}}")
    if t == "verification":
        return ("{{#verification_code}}" + _cell(
            f'<span style="color:{muted};">Verify this email at {{{{verify_url}}}} with code</span> '
            f'<b style="color:{s["text_color"]};letter-spacing:1px;">{{{{verification_code}}}}</b>',
            f"font-size:{fs - 3}px;", "8px 0 0") + "{{/verification_code}}")
    if t == "banner":
        return "<!--sg:banner-->"
    if t == "disclaimer":
        return "<!--sg:disclaimer-->"
    return ""


def _rows(blocks: list[dict], s: dict) -> str:
    out = []
    for b in blocks:
        r = render_block(b, s)
        if r.startswith("<!--sg:"):
            # Markers sit in their own row so the inserted banner/disclaimer gets full width.
            out.append(f"<tr><td>{r}</td></tr>")
        elif r:
            out.append(r)
    return "\n".join(out)


def compile_design(design: Any) -> str:
    d = normalize(design)
    s, blocks = d["settings"], d["blocks"]
    base = (f'font-family:{s["font"]};font-size:{s["font_size"]}px;line-height:1.45;'
            f'color:{s["text_color"]};max-width:{s["width"]}px;')
    table = f'<table cellpadding="0" cellspacing="0" border="0" style="{base}">'
    if s["layout"] == "split":
        left = [b for b in blocks if b["col"] == "left" and b["type"] not in ("banner", "disclaimer")]
        right = [b for b in blocks if b["col"] == "right" and b["type"] not in ("banner", "disclaimer")]
        tail = [b for b in blocks if b["type"] in ("banner", "disclaimer")]
        border = f'border-right:2px solid {s["accent"]};' if s["divider"] and left else ""
        left_html = (f'<td valign="top" style="padding:0 16px 0 0;{border}">'
                     f'<table cellpadding="0" cellspacing="0" border="0">{_rows(left, s)}</table></td>') if left else ""
        right_html = (f'<td valign="top" style="padding:0 0 0 {16 if left else 0}px;">'
                      f'<table cellpadding="0" cellspacing="0" border="0">{_rows(right, s)}</table></td>')
        body = f"<tr><td><table cellpadding=\"0\" cellspacing=\"0\" border=\"0\"><tr>{left_html}{right_html}</tr></table></td></tr>"
        tail_html = _rows(tail, s)
        return f"{table}\n{body}\n{tail_html}\n</table>" if tail_html else f"{table}\n{body}\n</table>"
    return f"{table}\n{_rows(blocks, s)}\n</table>"


# ---------- starter layouts used by the designer and the AI generator ----------

def starter(kind: str, brand: dict | None = None) -> dict:
    brand = brand or {}
    accent = brand.get("primary_color") or "#2878d0"
    text = brand.get("secondary_color") or "#1f2933"
    font = brand.get("font_family") if brand.get("font_family") in SAFE_FONTS else SAFE_FONTS[0]
    base = {"font": font, "text_color": text, "accent": accent, "width": 560, "font_size": 13}

    def blk(n: int, t: str, col: str = "right", **props) -> dict:
        return {"id": f"b{n}", "type": t, "col": col, "props": props}

    if kind == "split":
        return {"settings": {**base, "layout": "split"}, "blocks": [
            blk(1, "logo", "left"), blk(2, "photo", "left"),
            blk(3, "name"), blk(4, "title"), blk(5, "delegation"), blk(6, "contact"),
            blk(7, "social", networks=["linkedin", "twitter"]), blk(8, "verification"),
            blk(9, "banner"), blk(10, "disclaimer"),
        ]}
    if kind == "minimal":
        return {"settings": {**base, "layout": "stack", "font_size": 12}, "blocks": [
            blk(1, "name", size=14), blk(2, "title", show_department=False),
            blk(3, "delegation"), blk(4, "contact", fields=["phone", "email"], inline=True),
            blk(5, "verification"), blk(6, "disclaimer"),
        ]}
    # corporate
    return {"settings": {**base, "layout": "stack"}, "blocks": [
        blk(1, "logo"), blk(2, "name"), blk(3, "title", show_company=True), blk(4, "delegation"),
        blk(5, "divider"), blk(6, "contact"), blk(7, "address"),
        blk(8, "social", networks=["linkedin", "twitter", "youtube"]), blk(9, "verification"),
        blk(10, "banner"), blk(11, "disclaimer"),
    ]}
