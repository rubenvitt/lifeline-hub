-- LLH-1091: der Einzelauftrag nach FwDV 100 (Einheit – Auftrag – Mittel – Ziel – Weg) bekommt den
-- Weg, die Wegführung oder Anmarschroute der Einheit. Ein Feld des Befehlsschemas wie die übrigen
-- aus 0048 (Freitext, höchstens 2 000 Zeichen, `auftrag::BEFEHLSFELD_MAX`); leer bleibt NULL.
-- Herleitung: `openspec/changes/archive/2026-10-12-o5gsxa7g-auftragsschema-fwdv100/design.md` (D3).
ALTER TABLE auftrag ADD COLUMN weg TEXT;
