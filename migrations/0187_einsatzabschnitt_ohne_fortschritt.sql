-- LLH-1170: Der Fortschritt eines Einsatzabschnitts fällt ganz weg. Seit LFH-1208 zeigt und
-- schreibt ihn keine Oberfläche mehr; gespeicherte Altwerte gehen bewusst verloren
-- (openspec/changes/a6jttql1-abschnitt-fortschritt-entfernen/design.md, D1/D2).
-- Herkunft: 0109_einsatzabschnitt_lage.sql. Der CHECK hängt nur an dieser Spalte und fällt mit ihr.
ALTER TABLE einsatzabschnitt DROP COLUMN fortschritt;
