"""A tiny, safe template language for signatures.

{{field}}              -> the value, HTML-escaped
{{#field}}...{{/field}} -> the block is kept only when the field has a value
Unknown fields render as empty text.
"""
import html
import re

SECTION = re.compile(r"\{\{#(\w+)\}\}(.*?)\{\{/\1\}\}", re.DOTALL)
VARIABLE = re.compile(r"\{\{(\w+)\}\}")
MAX_SIGNATURE_CHARS = 30_000  # Outlook's setSignatureAsync limit

FIELDS = (
    "name", "job_title", "department", "phone", "mobile", "email", "company",
    "photo_url", "on_behalf_of", "on_behalf_title", "on_behalf_email",
    "verification_code", "verify_url",
)


def render(template_html: str, values: dict[str, str]) -> str:
    def section(m: re.Match) -> str:
        return m.group(2) if values.get(m.group(1)) else ""

    # Sections may contain sections, so expand until nothing changes.
    previous = None
    out = template_html
    while previous != out:
        previous, out = out, SECTION.sub(section, out)
    return VARIABLE.sub(lambda m: html.escape(str(values.get(m.group(1), "") or "")), out)


def check_template(template_html: str) -> list[str]:
    """Problems that would break the signature in Outlook."""
    problems = []
    if len(template_html) > MAX_SIGNATURE_CHARS:
        problems.append(f"Longer than Outlook's {MAX_SIGNATURE_CHARS} character limit")
    lowered = template_html.lower()
    if "<svg" in lowered:
        problems.append("SVG images are not supported by Outlook signatures")
    if "<style" in lowered or "class=" in lowered:
        problems.append("Use inline style attributes; Outlook ignores <style> blocks and classes")
    if "<script" in lowered:
        problems.append("Scripts are not allowed")
    names = set(VARIABLE.findall(template_html)) | set(SECTION_TAG.findall(template_html))
    for name in sorted(names):
        if name not in FIELDS:
            problems.append(f"Unknown placeholder {{{{{name}}}}}")
    return problems


SECTION_TAG = re.compile(r"\{\{[#/](\w+)\}\}")
