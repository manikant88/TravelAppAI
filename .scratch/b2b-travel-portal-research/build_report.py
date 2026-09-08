from __future__ import annotations

import html
import re
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfbase import pdfmetrics
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    KeepTogether,
    ListFlowable,
    ListItem,
    PageBreak,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)


ROOT = Path(__file__).resolve().parents[2]
SOURCE = Path(__file__).with_name("report-source.md")
OUTPUT = ROOT / "output" / "pdf" / "b2b-travel-portal-deep-research.pdf"

NAVY = colors.HexColor("#14263D")
TEAL = colors.HexColor("#087F8C")
TEAL_DARK = colors.HexColor("#075C63")
BLUE_PALE = colors.HexColor("#EAF5F7")
INK = colors.HexColor("#1F2937")
MUTED = colors.HexColor("#5F6B7A")
LINE = colors.HexColor("#D7E0E7")
WARM = colors.HexColor("#FFF6E6")


def register_fonts() -> tuple[str, str, str]:
    candidates = [
        (
            Path("/System/Library/Fonts/Supplemental/Arial.ttf"),
            Path("/System/Library/Fonts/Supplemental/Arial Bold.ttf"),
            Path("/System/Library/Fonts/Supplemental/Arial Italic.ttf"),
        ),
        (
            Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"),
            Path("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"),
            Path("/usr/share/fonts/truetype/dejavu/DejaVuSans-Oblique.ttf"),
        ),
    ]
    for regular, bold, italic in candidates:
        if regular.exists() and bold.exists() and italic.exists():
            pdfmetrics.registerFont(TTFont("ReportSans", str(regular)))
            pdfmetrics.registerFont(TTFont("ReportSans-Bold", str(bold)))
            pdfmetrics.registerFont(TTFont("ReportSans-Italic", str(italic)))
            pdfmetrics.registerFontFamily(
                "ReportSans",
                normal="ReportSans",
                bold="ReportSans-Bold",
                italic="ReportSans-Italic",
                boldItalic="ReportSans-Bold",
            )
            return "ReportSans", "ReportSans-Bold", "ReportSans-Italic"
    return "Helvetica", "Helvetica-Bold", "Helvetica-Oblique"


FONT, FONT_BOLD, FONT_ITALIC = register_fonts()


def inline_markup(value: str) -> str:
    escaped = html.escape(value, quote=True)
    escaped = re.sub(
        r"\[([^\]]+)\]\((https?://[^)]+)\)",
        lambda m: f'<link href="{m.group(2)}" color="#087F8C"><u>{m.group(1)}</u></link>',
        escaped,
    )
    escaped = re.sub(r"\*\*([^*]+)\*\*", r"<b>\1</b>", escaped)
    escaped = re.sub(r"`([^`]+)`", r'<font name="Courier">\1</font>', escaped)
    return escaped


styles = getSampleStyleSheet()
styles.add(ParagraphStyle(
    name="ReportTitle", parent=styles["Title"], fontName=FONT_BOLD,
    fontSize=27, leading=32, textColor=colors.white, alignment=TA_LEFT,
    spaceAfter=12,
))
styles.add(ParagraphStyle(
    name="ReportSubtitle", parent=styles["BodyText"], fontName=FONT,
    fontSize=11, leading=16, textColor=colors.HexColor("#D7EFF1"),
))
styles.add(ParagraphStyle(
    name="H1Report", parent=styles["Heading1"], fontName=FONT_BOLD,
    fontSize=20, leading=24, textColor=NAVY, spaceBefore=14, spaceAfter=9,
))
styles.add(ParagraphStyle(
    name="H2Report", parent=styles["Heading2"], fontName=FONT_BOLD,
    fontSize=14.5, leading=18, textColor=TEAL_DARK, spaceBefore=14, spaceAfter=7,
    keepWithNext=True,
))
styles.add(ParagraphStyle(
    name="H3Report", parent=styles["Heading3"], fontName=FONT_BOLD,
    fontSize=11.5, leading=14, textColor=NAVY, spaceBefore=10, spaceAfter=5,
    keepWithNext=True,
))
styles.add(ParagraphStyle(
    name="BodyReport", parent=styles["BodyText"], fontName=FONT,
    fontSize=9.2, leading=13.4, textColor=INK, spaceAfter=6,
))
styles.add(ParagraphStyle(
    name="SmallReport", parent=styles["BodyText"], fontName=FONT,
    fontSize=7.2, leading=9.6, textColor=INK,
))
styles.add(ParagraphStyle(
    name="TableHead", parent=styles["BodyText"], fontName=FONT_BOLD,
    fontSize=7.2, leading=9, textColor=colors.white,
))
styles.add(ParagraphStyle(
    name="BulletReport", parent=styles["BodyText"], fontName=FONT,
    fontSize=9, leading=13, textColor=INK, leftIndent=0,
))
styles.add(ParagraphStyle(
    name="Callout", parent=styles["BodyText"], fontName=FONT_BOLD,
    fontSize=10, leading=14, textColor=TEAL_DARK,
))


class ReportDoc(BaseDocTemplate):
    def __init__(self, filename: str):
        super().__init__(
            filename,
            pagesize=A4,
            rightMargin=15 * mm,
            leftMargin=15 * mm,
            topMargin=18 * mm,
            bottomMargin=17 * mm,
            title="B2B travel portals and supplier APIs",
            author="Travel App AI research",
            subject="Provider strategy, operating model, and India-first implementation guidance",
        )
        frame = Frame(self.leftMargin, self.bottomMargin, self.width, self.height, id="main")
        self.addPageTemplates(PageTemplate(id="content", frames=frame, onPage=self.decorate))

    def decorate(self, canvas, doc):
        canvas.saveState()
        page = canvas.getPageNumber()
        if page > 1:
            canvas.setStrokeColor(LINE)
            canvas.setLineWidth(0.5)
            canvas.line(doc.leftMargin, A4[1] - 13 * mm, A4[0] - doc.rightMargin, A4[1] - 13 * mm)
            canvas.setFont(FONT, 7.5)
            canvas.setFillColor(MUTED)
            canvas.drawString(doc.leftMargin, A4[1] - 10 * mm, "TRAVEL APP AI  /  DECISION RESEARCH")
            canvas.drawRightString(A4[0] - doc.rightMargin, 9 * mm, f"{page}")
        canvas.restoreState()


def build_table(rows: list[list[str]], width: float) -> Table:
    col_count = len(rows[0])
    if col_count == 6:
        ratios = [1.00, 0.95, 1.15, 1.15, 1.00, 0.95]
    elif col_count == 5:
        ratios = [1.0, 1.1, 1.25, 1.25, 1.0]
    elif col_count == 4:
        ratios = [0.9, 1.35, 1.35, 1.1]
    else:
        ratios = [1.0] * col_count
    total = sum(ratios)
    widths = [width * ratio / total for ratio in ratios]
    data = []
    for row_index, row in enumerate(rows):
        style = styles["TableHead"] if row_index == 0 else styles["SmallReport"]
        data.append([Paragraph(inline_markup(cell), style) for cell in row])
    table = Table(data, colWidths=widths, repeatRows=1, hAlign="LEFT")
    commands = [
        ("BACKGROUND", (0, 0), (-1, 0), NAVY),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("GRID", (0, 0), (-1, -1), 0.35, LINE),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]
    for idx in range(1, len(data)):
        if idx % 2 == 0:
            commands.append(("BACKGROUND", (0, idx), (-1, idx), colors.HexColor("#F4F7F9")))
    table.setStyle(TableStyle(commands))
    return table


def parse_markdown(markdown: str, width: float):
    lines = markdown.splitlines()
    story = []
    i = 0
    first_title = True
    while i < len(lines):
        line = lines[i].rstrip()
        if not line:
            i += 1
            continue

        if line.startswith("# ") and first_title:
            title = line[2:]
            subtitle = lines[i + 2].strip("* ") if i + 2 < len(lines) else ""
            date_line = lines[i + 3].strip("* ") if i + 3 < len(lines) else ""
            cover = Table(
                [[Paragraph(inline_markup(title), styles["ReportTitle"])],
                 [Paragraph(inline_markup(subtitle), styles["ReportSubtitle"])],
                 [Spacer(1, 5 * mm)],
                 [Paragraph(inline_markup(date_line), styles["ReportSubtitle"])],
                 [Spacer(1, 74 * mm)],
                 [Paragraph("Evidence-backed provider strategy, operational boundaries, and a staged implementation path for an India-first customer product.", styles["ReportSubtitle"])]],
                colWidths=[width],
                rowHeights=[None, None, None, None, None, None],
                style=TableStyle([
                    ("BACKGROUND", (0, 0), (-1, -1), NAVY),
                    ("BOX", (0, 0), (-1, -1), 0, NAVY),
                    ("LEFTPADDING", (0, 0), (-1, -1), 18),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 18),
                    ("TOPPADDING", (0, 0), (-1, 0), 24),
                    ("BOTTOMPADDING", (0, -1), (-1, -1), 20),
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ]),
            )
            story.extend([Spacer(1, 8 * mm), cover, PageBreak()])
            first_title = False
            i += 4
            continue

        if line.startswith("## "):
            story.append(Paragraph(inline_markup(line[3:]), styles["H1Report"]))
            i += 1
            continue
        if line.startswith("### "):
            story.append(Paragraph(inline_markup(line[4:]), styles["H2Report"]))
            i += 1
            continue
        if line.startswith("#### "):
            story.append(Paragraph(inline_markup(line[5:]), styles["H3Report"]))
            i += 1
            continue

        if line.startswith("|"):
            table_lines = []
            while i < len(lines) and lines[i].strip().startswith("|"):
                table_lines.append(lines[i].strip())
                i += 1
            parsed = []
            for idx, table_line in enumerate(table_lines):
                cells = [cell.strip() for cell in table_line.strip("|").split("|")]
                if idx == 1 and all(set(cell) <= {"-", ":", " "} for cell in cells):
                    continue
                parsed.append(cells)
            story.extend([Spacer(1, 2 * mm), build_table(parsed, width), Spacer(1, 3 * mm)])
            continue

        if re.match(r"^[-*] ", line):
            items = []
            while i < len(lines) and re.match(r"^[-*] ", lines[i].strip()):
                value = re.sub(r"^[-*] ", "", lines[i].strip())
                items.append(ListItem(Paragraph(inline_markup(value), styles["BulletReport"]), leftIndent=10))
                i += 1
            story.append(ListFlowable(items, bulletType="bullet", bulletFontName=FONT, bulletFontSize=7, leftIndent=15, bulletColor=TEAL))
            story.append(Spacer(1, 2 * mm))
            continue

        if re.match(r"^\d+\. ", line):
            items = []
            while i < len(lines) and re.match(r"^\d+\. ", lines[i].strip()):
                value = re.sub(r"^\d+\. ", "", lines[i].strip())
                items.append(ListItem(Paragraph(inline_markup(value), styles["BulletReport"]), leftIndent=12))
                i += 1
            story.append(ListFlowable(items, bulletType="1", start="1", leftIndent=18, bulletFontName=FONT_BOLD, bulletFontSize=8, bulletColor=TEAL_DARK))
            story.append(Spacer(1, 2 * mm))
            continue

        paragraph_parts = [line]
        i += 1
        while i < len(lines):
            nxt = lines[i].rstrip()
            if not nxt or nxt.startswith("#") or nxt.startswith("|") or re.match(r"^[-*] ", nxt.strip()) or re.match(r"^\d+\. ", nxt.strip()):
                break
            paragraph_parts.append(nxt)
            i += 1
        paragraph = " ".join(part.rstrip("  ") for part in paragraph_parts)
        if paragraph.startswith("**Decision research") or paragraph.startswith("**Current through"):
            continue
        if paragraph.startswith("**Fit:**"):
            story.append(Table([[Paragraph(inline_markup(paragraph), styles["Callout"])]], colWidths=[width], style=TableStyle([
                ("BACKGROUND", (0, 0), (-1, -1), BLUE_PALE),
                ("BOX", (0, 0), (-1, -1), 0.5, colors.HexColor("#B7DDE1")),
                ("LEFTPADDING", (0, 0), (-1, -1), 8),
                ("RIGHTPADDING", (0, 0), (-1, -1), 8),
                ("TOPPADDING", (0, 0), (-1, -1), 7),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
            ])))
            story.append(Spacer(1, 2 * mm))
        else:
            story.append(Paragraph(inline_markup(paragraph), styles["BodyReport"]))
    return story


def main():
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    markdown = SOURCE.read_text(encoding="utf-8")
    doc = ReportDoc(str(OUTPUT))
    story = parse_markdown(markdown, doc.width)
    doc.build(story)
    print(OUTPUT)


if __name__ == "__main__":
    main()
