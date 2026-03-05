#!/usr/bin/env python3
"""Builds a polished team-training PDF packet from TXT training docs."""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.pagesizes import LETTER
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import PageBreak, Paragraph, SimpleDocTemplate, Spacer


ROOT = Path(__file__).resolve().parents[2]
TRAINING_DIR = ROOT / "docs" / "training"
OUTPUT_DIR = ROOT / "output" / "pdf"
OUTPUT_FILE = OUTPUT_DIR / "trd-aiblitz-team-training-packet.pdf"
SOURCE_FILES = [
    TRAINING_DIR / "01-platform-overview.txt",
    TRAINING_DIR / "02-feature-benefits-reference.txt",
    TRAINING_DIR / "03-agency-operating-playbook.txt",
    TRAINING_DIR / "04-what-it-actually-does-today.txt",
    TRAINING_DIR / "05-end-to-end-run-flow-explained.txt",
    TRAINING_DIR / "06-system-prompt-to-product-mapping.txt",
    TRAINING_DIR / "07-quick-orientation-for-new-team-members.txt",
]


def _styles():
    base = getSampleStyleSheet()
    return {
        "title": ParagraphStyle(
            "TitleStyle",
            parent=base["Title"],
            fontName="Helvetica-Bold",
            fontSize=22,
            leading=26,
            textColor=colors.HexColor("#10283A"),
            spaceAfter=12,
        ),
        "meta": ParagraphStyle(
            "MetaStyle",
            parent=base["BodyText"],
            fontName="Helvetica",
            fontSize=9.5,
            leading=13,
            textColor=colors.HexColor("#355063"),
            spaceAfter=6,
        ),
        "h1": ParagraphStyle(
            "H1Style",
            parent=base["Heading2"],
            fontName="Helvetica-Bold",
            fontSize=13,
            leading=16,
            textColor=colors.HexColor("#16384E"),
            spaceBefore=10,
            spaceAfter=5,
        ),
        "h2": ParagraphStyle(
            "H2Style",
            parent=base["Heading3"],
            fontName="Helvetica-Bold",
            fontSize=11,
            leading=14,
            textColor=colors.HexColor("#224E66"),
            spaceBefore=8,
            spaceAfter=3,
        ),
        "body": ParagraphStyle(
            "BodyStyle",
            parent=base["BodyText"],
            fontName="Helvetica",
            fontSize=10,
            leading=14,
            textColor=colors.HexColor("#102028"),
            spaceAfter=3,
        ),
        "bullet": ParagraphStyle(
            "BulletStyle",
            parent=base["BodyText"],
            fontName="Helvetica",
            fontSize=10,
            leading=14,
            textColor=colors.HexColor("#102028"),
            leftIndent=16,
            bulletIndent=5,
            spaceAfter=1,
        ),
    }


def _escape(value: str) -> str:
    return (
        value.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
        .replace("'", "&#39;")
    )


def _is_all_caps_heading(line: str) -> bool:
    if len(line) < 4:
        return False
    letters = [ch for ch in line if ch.isalpha()]
    if not letters:
        return False
    return all(ch.isupper() for ch in letters)


def _render_txt(path: Path, styles: dict, first_doc: bool):
    story = []
    lines = path.read_text(encoding="utf-8").splitlines()

    if lines:
        story.append(Paragraph(_escape(lines[0]), styles["title"]))
        lines = lines[1:]

    for line in lines:
        stripped = line.strip()
        if not stripped:
            story.append(Spacer(1, 0.08 * inch))
            continue

        if set(stripped) == {"-"}:
            story.append(Spacer(1, 0.06 * inch))
            continue

        if stripped.startswith("Document:") or stripped.startswith("Version:") or stripped.startswith("Date:"):
            story.append(Paragraph(_escape(stripped), styles["meta"]))
            continue

        if stripped.startswith("FEATURE:"):
            story.append(Paragraph(_escape(stripped), styles["h2"]))
            continue

        if stripped[:2].isdigit() and stripped[2:3] == ")":
            story.append(Paragraph(_escape(stripped), styles["h1"]))
            continue

        if _is_all_caps_heading(stripped):
            story.append(Paragraph(_escape(stripped), styles["h1"]))
            continue

        if stripped.startswith("- "):
            story.append(Paragraph(_escape(stripped[2:]), styles["bullet"], bulletText="-"))
            continue

        story.append(Paragraph(_escape(stripped), styles["body"]))

    if not first_doc:
        story.insert(0, PageBreak())

    return story


def _draw_footer(canvas, doc):
    canvas.saveState()
    footer_left = "TRD AIBLITZ TEAM TRAINING"
    footer_right = f"Page {doc.page}"
    canvas.setFont("Helvetica", 8)
    canvas.setFillColor(colors.HexColor("#4A6578"))
    canvas.drawString(doc.leftMargin, 0.45 * inch, footer_left)
    canvas.drawRightString(LETTER[0] - doc.rightMargin, 0.45 * inch, footer_right)
    canvas.restoreState()


def main() -> None:
    missing = [path for path in SOURCE_FILES if not path.exists()]
    if missing:
        names = ", ".join(str(path) for path in missing)
        raise FileNotFoundError(f"Missing source training files: {names}")

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    styles = _styles()
    story = []
    for index, source in enumerate(SOURCE_FILES):
        story.extend(_render_txt(source, styles, first_doc=(index == 0)))

    # Build document metadata from current UTC timestamp for reproducibility in exports.
    generated_at = datetime.now(timezone.utc).isoformat()
    doc = SimpleDocTemplate(
        str(OUTPUT_FILE),
        pagesize=LETTER,
        leftMargin=0.72 * inch,
        rightMargin=0.72 * inch,
        topMargin=0.72 * inch,
        bottomMargin=0.72 * inch,
        title="TRD AIBLITZ Team Training Packet",
        author="True Rank Digital",
        subject=f"Generated {generated_at}",
    )
    doc.build(story, onFirstPage=_draw_footer, onLaterPages=_draw_footer)
    print(str(OUTPUT_FILE))


if __name__ == "__main__":
    main()
