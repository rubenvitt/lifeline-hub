-- LLH-1079 Teil II: Fahrzeug und Material entlassen statt löschen (Change
-- k0s07wsn-kraefte-entlassen, design.md D3/D7). `beendet_*` trägt 0193 schon.
--
-- Die letzte Entlassung bleibt über das erneute Disponieren hinaus stehen, wie beim Personal
-- (0193): ein Fahrzeug oder Material, das einmal entlassen war, war im Einsatz und lässt sich
-- nicht mehr stornieren, auch wenn das erneute Disponieren die Storno-Frist neu beginnen ließe.
-- Ohne die Spalte verschwände es nach Entlassen, erneutem Disponieren und Storno aus dem
-- Nachweis. Das ist ein Zustand der Zeile, kein Zeitpunkt der Zeitachse
-- (`frontend/src/kraefte/AGENTS.md`).
ALTER TABLE einsatz_fahrzeug ADD COLUMN zuletzt_entlassen_at TEXT;
ALTER TABLE einsatz_material ADD COLUMN zuletzt_entlassen_at TEXT;
