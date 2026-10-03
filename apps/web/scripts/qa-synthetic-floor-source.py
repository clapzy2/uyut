"""Small, explicitly synthetic PDF for the full source-floor editor check."""

import sys
from pathlib import Path

from reportlab.pdfgen import canvas

target = Path(sys.argv[1]).resolve()
target.parent.mkdir(parents=True, exist_ok=True)
document = canvas.Canvas(str(target), pagesize=(600, 500), invariant=1)
document.setTitle("Synthetic floor editor QA - not a survey")
document.setFont("Helvetica", 12)
document.drawString(100, 478, "SYNTHETIC QA - NOT A SURVEY")
document.setFont("Helvetica", 9)
document.drawString(100, 463, "Outer wall / independent floor / room 01. Dimensions in mm.")

# Three distinct source rectangles; no automatic wall-thickness offset.
document.setLineWidth(1)
document.setStrokeColorRGB(0.1, 0.1, 0.1)
document.rect(100, 100, 400, 300)
document.setStrokeColorRGB(0, 0.45, 0.65)
document.rect(110, 110, 380, 280)
document.setStrokeColorRGB(0.4, 0.1, 0.3)
document.rect(140, 140, 320, 220)
document.setFillColorRGB(0, 0, 0)
document.drawString(290, 250, "01")
document.setStrokeColorRGB(0, 0, 0)
document.setLineWidth(0.5)

# Horizontal dimension, diagonal ticks and extension lines.
document.line(140, 375, 460, 375)
for x in (140, 460):
    document.line(x - 2, 373, x + 2, 377)
    document.line(x, 360, x, 382)
document.drawString(287, 377, "3200")

# Vertical dimension; label follows its axis.
document.line(125, 140, 125, 360)
for y in (140, 360):
    document.line(123, y - 2, 127, y + 2)
    document.line(118, y, 140, y)
document.saveState()
document.translate(123, 235)
document.rotate(90)
document.drawString(0, 0, "2200")
document.restoreState()
document.showPage()
document.save()
