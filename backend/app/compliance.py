"""Brand compliance: score a signature template against the brand kit and email-client rules.

Pure functions (no database) so they can run on every keystroke in the designer.
Severity: critical (breaks or is unsafe), error (breaks a brand rule), warning, info.
"""
from __future__ import annotations

import re
from typing import Any

from .rendering import check_template

HEX_IN_STYLE = re.compile(r"#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b")
FONT_FAMILY = re.compile(r"font-family\s*:\s*([^;\"]+)", re.I)
FONT_SIZE = re.compile(r"font-size\s*:\s*(\d+)px", re.I)
WIDTH = re.compile(r"(?:max-width|width)\s*:\s*(\d+)px", re.I)
IMG = re.compile(r"<img\b[^>]*>", re.I)
HREF = re.compile(r"href\s*=\s*\"([^\"]*)\"", re.I)
TEXT_COLOR = re.compile(r"(?<![-\w])color\s*:\s*(#[0-9a-fA-F]{6})", re.I)
BACKGROUND = re.compile(r"background(?:-color)?\s*:\s*(#[0-9a-fA-F]{6})", re.I)
STYLE_ATTR = re.compile(r"style\s*=\s*\"([^\"]*)\"", re.I)
PENALTY = {"critical": 30, "error": 12, "warning": 5, "info": 0}


def _expand(hexcode: str) -> str:
    h = hexcode.lstrip("#").lower()
    return "#" + ("".join(c * 2 for c in h) if len(h) == 3 else h)


def _rgb(hexcode: str) -> tuple[int, int, int]:
    h = _expand(hexcode)[1:]
    return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)


def is_neutral(hexcode: str, max_saturation: float = 0.22) -> bool:
    """Greys (including slate greys), black and white are always allowed: body text and dividers use them."""
    r, g, b = _rgb(hexcode)
    hi, lo = max(r, g, b), min(r, g, b)
    if hi - lo <= 20:
        return True
    return (hi - lo) / (255 - abs(hi + lo - 255)) <= max_saturation


def _lum(hexcode: str) -> float:
    def ch(c: int) -> float:
        c = c / 255
        return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4
    r, g, b = _rgb(hexcode)
    return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b)


def contrast(a: str, b: str) -> float:
    la, lb = sorted((_lum(a), _lum(b)), reverse=True)
    return (la + 0.05) / (lb + 0.05)


def _close(a: str, b: str, tolerance: int = 12) -> bool:
    return all(abs(x - y) <= tolerance for x, y in zip(_rgb(a), _rgb(b)))


def brand_palette(brand: dict) -> list[str]:
    colors = [brand.get("primary_color"), brand.get("secondary_color"), brand.get("accent_color")]
    colors += [c.strip() for c in (brand.get("palette") or "").split(",")]
    return [_expand(c) for c in colors if c and re.fullmatch(r"#[0-9a-fA-F]{3,6}", c.strip())]


def _family_root(value: str) -> str:
    return value.split(",")[0].strip().strip("'\"").lower()


def check(template_html: str, brand: dict | None = None, *, external: bool | None = None) -> dict[str, Any]:
    """Return {"score", "grade", "issues": [{severity, rule, message}], "passed": [rule names]}."""
    brand = brand or {}
    issues: list[dict[str, str]] = []
    passed: list[str] = []

    def add(sev: str, rule: str, msg: str) -> None:
        issues.append({"severity": sev, "rule": rule, "message": msg})

    lowered = template_html.lower()

    # 1. Email-client safety (the same rules that block submission today)
    blocking = check_template(template_html)
    for p in blocking:
        add("critical", "email_safety", p)
    if "javascript:" in lowered or "data:text/html" in lowered:
        add("critical", "email_safety", "Links must not use javascript: or data: URLs")
    if not blocking:
        passed.append("Outlook and Gmail safe HTML")

    # 2. Required identity fields
    missing = [f for f in ("name", "email") if "{{" + f + "}}" not in template_html]
    if missing:
        add("error", "required_fields", "Missing required field(s): " + ", ".join("{{%s}}" % m for m in missing))
    else:
        passed.append("Name and email address present")

    # 3. Brand colours
    palette = brand_palette(brand)
    if palette:
        off_brand = sorted({
            _expand(c) for c in HEX_IN_STYLE.findall(template_html)
            for c in ["#" + c]
            if not is_neutral(c) and not any(_close(c, p) for p in palette)
        })
        if off_brand:
            add("warning", "brand_colors", "Colours outside the brand palette: " + ", ".join(off_brand))
        else:
            passed.append("Only brand colours used")

    # 4. Brand font
    brand_font = brand.get("font_family")
    if brand_font:
        fonts = {_family_root(f) for f in FONT_FAMILY.findall(template_html)}
        allowed = _family_root(brand_font)
        wrong = sorted(f for f in fonts if f and f != allowed)
        if wrong:
            add("warning", "brand_font", f"Fonts other than the brand font ({allowed}): {', '.join(wrong)}")
        elif fonts:
            passed.append("Brand font used")
        else:
            add("info", "brand_font", "No font is set; email clients will pick their default")

    # 5. Logo
    if brand.get("require_logo"):
        if "{{logo_url}}" in template_html or (brand.get("logo_url") and brand["logo_url"] in template_html):
            passed.append("Company logo included")
        else:
            add("error", "logo", "The brand kit requires the company logo ({{logo_url}})")

    # 6. Width and mobile friendliness
    max_width = int(brand.get("max_width") or 600)
    widths = [int(w) for w in WIDTH.findall(template_html)]
    if widths and max(widths) > max_width:
        add("warning", "width", f"Wider than the {max_width}px brand limit ({max(widths)}px); it will scroll on phones")
    else:
        passed.append(f"Fits within {max_width}px")

    # 7. Readability
    # 1-2px sizes are spacer/divider tricks, not text.
    sizes = [int(s) for s in FONT_SIZE.findall(template_html) if int(s) > 2]
    if sizes and min(sizes) < 9:
        add("warning", "readability", f"Text as small as {min(sizes)}px is hard to read; use 9px or more")
    low: set[str] = set()
    for style in STYLE_ATTR.findall(template_html):
        bg = BACKGROUND.search(style)
        for c in TEXT_COLOR.findall(style):
            if contrast(c, bg.group(1) if bg else "#ffffff") < 3.0:
                low.add(c.lower())
    low = sorted(low)
    if low:
        add("warning", "accessibility", "Low-contrast text on white: " + ", ".join(low))
    if not low and not (sizes and min(sizes) < 9):
        passed.append("Readable text size and contrast")

    # 8. Images
    imgs = IMG.findall(template_html)
    no_alt = [i for i in imgs if " alt=" not in i.lower()]
    if no_alt:
        add("warning", "images", f"{len(no_alt)} image(s) without alt text; shown as blank when images are blocked")
    insecure = [i for i in imgs if 'src="http://' in i.lower()]
    if insecure:
        add("warning", "images", "Images must use https://, or Outlook may block them")
    no_size = [i for i in imgs if " width=" not in i.lower()]
    if no_size:
        add("info", "images", "Give every image a width attribute so Outlook doesn't show it full size")
    if imgs and not (no_alt or insecure):
        passed.append("Images have alt text and use https")

    # 9. Links
    hrefs = HREF.findall(template_html)
    plain_http = [h for h in hrefs if h.lower().startswith("http://")]
    if plain_http:
        add("warning", "links", f"{len(plain_http)} link(s) use http:// instead of https://")
    elif hrefs:
        passed.append("Links are secure")

    # 10. Sender verification on external signatures
    if external is not False and "{{verification_code}}" not in template_html:
        add("info" if external is None else "warning", "verification",
            "No {{verification_code}}: recipients can't check this email really came from you")
    elif "{{verification_code}}" in template_html:
        passed.append("Sender verification code included")

    score = max(0, 100 - sum(PENALTY[i["severity"]] for i in issues))
    grade = "A" if score >= 90 else "B" if score >= 75 else "C" if score >= 60 else "D" if score >= 40 else "F"
    order = list(PENALTY)
    issues.sort(key=lambda i: order.index(i["severity"]))
    return {"score": score, "grade": grade, "issues": issues, "passed": passed,
            "blocking": any(i["severity"] == "critical" for i in issues)}
