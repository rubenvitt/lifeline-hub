-- LLH-1098: ein erteilter Auftrag lässt sich mit Grund aufheben. Die Aufhebung steht am Auftrag
-- (Zeit, Person, Grund), der Bearbeitungsstatus `aufgehoben` wird wie `abgenommen` im SQL
-- abgeleitet (`auftrag/repo.rs`, `bearbeitungsstatus_sql!`). Additiv per ADD COLUMN, kein
-- CHECK und kein Neuaufbau; der Bestand bleibt NULL. Herleitung:
-- `openspec/changes/archive/2026-10-12-fzb4iogs-auftrag-aufheben-berichtigen/design.md` (D1).
ALTER TABLE auftrag ADD COLUMN aufgehoben_at TEXT;
ALTER TABLE auftrag ADD COLUMN aufgehoben_von_id INTEGER REFERENCES benutzer(id);
ALTER TABLE auftrag ADD COLUMN aufhebungsgrund TEXT;
