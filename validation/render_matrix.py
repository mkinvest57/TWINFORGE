#!/usr/bin/env python3
"""Render the human-readable matrix from its authoritative JSON requirements."""
import json
from pathlib import Path


def render(root):
    doc = json.loads((root / "validation/requirements.json").read_text())
    rows = doc["requirements"]
    lines = ["# Matrice de conformité aux neuf prompts", "",
             "État au 4 novembre 2026. Une présence de fichier ne valide pas une expérience. La matrice décrit les exigences du PDF, y compris celles impossibles à rattraper rétroactivement. Les preuves du 29 octobre sont conservées; les changements actuels déclarent L3, sans prétendre atteindre L1 réel.", "",
             f"Source structurée : `validation/requirements.json` ({len(rows)} exigences). Vérification : `python3 validation/preflight.py`. Un résultat non nul est attendu tant que les exigences ci-dessous restent ouvertes. Régénération : `python3 validation/render_matrix.py`.", "",
             "| ID | Exigence | État | Preuve / blocage |", "|---|---|---|---|"]
    def escape(value):
        return str(value).replace("|", "\\|").replace("\n", " ")
    for row in rows:
        evidence = ", ".join("`" + p + "`" for p in row["evidence"])
        detail = evidence + ". " + (row.get("blocker") or row["verification"])
        cells = [row["id"], row["requirement"], row["status"], detail]
        lines.append("| " + " | ".join(escape(cell) for cell in cells) + " |")
    return "\n".join(lines) + "\n"


if __name__ == "__main__":
    root = Path(__file__).resolve().parents[1]
    (root / "docs/PROMPT_COMPLIANCE.md").write_text(render(root))
