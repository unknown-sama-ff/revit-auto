"""Decode local native PNG evidence and record the observed layout findings."""
import hashlib
import json
import sys
import time
import uuid
from pathlib import Path
from PIL import Image

root = Path(__file__).resolve().parent.parent
source = Path(sys.argv[1]).resolve()
assert source.parent == root / "runtime"
evidence = json.loads(source.read_text(encoding="utf-8"))
assert evidence["status"] == "BATCH_PNG_EXPORTED_READ_SCOPES_AND_SAVED_FILE_VERIFIED_VISUAL_PENDING"
assert evidence["readScopesUnchanged"] and evidence["savedFileUnchanged"]
assert evidence["confirmationCalls"] == 0 and not evidence["modelWritesRequested"]
assert len(evidence["pngFiles"]) == 2
folder = Path(evidence["exportResult"]["outputDirectory"]) / ("review-" + uuid.uuid4().hex)
assert folder.parent.parent == root / "exports"
folder.mkdir(exist_ok=False)
rows = []
for row in evidence["pngFiles"]:
    file = Path(row["file"])
    assert hashlib.sha256(file.read_bytes()).hexdigest() == row["sha256"]
    with Image.open(file) as image:
        image.load()
        assert image.size == (row["widthPixels"], row["heightPixels"])
        histogram = image.convert("L").histogram()
        pixels = sum(histogram[:250])
        assert pixels > 10000
        crops = [("al1-signature-clearance", (30, 35, 520, 700)),
                 ("al1-notes-overlap", (3640, 330, 4056, 720))] if row["viewId"] == 2296031 else [
                     ("e101-grid-titleblock-overlap", (3120, 1500, 4050, 2200))]
        outputs = []
        for name, bounds in crops:
            target = folder / (name + ".png")
            with target.open("xb") as stream:
                image.crop(bounds).save(stream, format="PNG")
            outputs.append({"file": str(target), "sourceBoundsPixels": bounds,
                            "sha256": hashlib.sha256(target.read_bytes()).hexdigest()})
        rows.append({**row, "fullyDecoded": True, "nonblankContentVerified": True,
                     "pixelsDarkerThan250": pixels,
                     "contentPixelFraction": pixels / (image.width * image.height),
                     "layoutAccepted": False, "detailCrops": outputs})

report = {"status": "BATCH_PNG_NATIVE_EXPORT_ACCEPTED_LAYOUT_FINDINGS_RECORDED",
          "sourceEvidence": str(source), "sourceSha256": hashlib.sha256(source.read_bytes()).hexdigest(),
          "modelWritesRequested": False, "automaticSave": False,
          "nativeExportAccepted": True, "wholeSheetLayoutAccepted": False,
          "acceptanceScope": "Two specified sheets, 4096 horizontal pixels, requested 300 DPI, complete 134/29 read scopes and saved RVT hash unchanged.",
          "findings": [
              {"sheetNumber": "AI-E102-REUSE", "movementLayoutVerified": True,
               "observation": "AL1 table is clear of the left signature strip after its saved 30 mm move. Existing right notes and legend labels overlap; complete sheet layout is unaccepted."},
              {"sheetNumber": "E101", "movementLayoutVerified": None,
               "observation": "Native export contains the lighting plan and titleblock. Existing AI-ARCH grid labels reach the right titleblock; complete sheet layout is unaccepted."}],
          "pngFiles": rows}
target = root / "runtime" / f"parity-batch-export-visual-{int(time.time()*1000)}.json"
with target.open("x", encoding="utf-8") as stream:
    json.dump(report, stream, ensure_ascii=False, indent=2)
print(json.dumps({"status": report["status"], "evidenceFile": str(target),
                  "pngFiles": rows}, ensure_ascii=True, indent=2))
