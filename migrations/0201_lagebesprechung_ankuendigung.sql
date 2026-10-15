-- LLH-1215: Merker der Ankündigung am Termin der Lagebesprechung (Change
-- kcjecn9e-benachrichtigungskonzept, design.md D10). Der Erinnerungs-Scheduler kündigt den
-- Termin `naechste_lagebesprechung_at` 10 Minuten vorher und bei Erreichen an
-- (`lagebesprechung::ankuendigung`) und setzt dabei den jeweiligen Merker auf den Zeitpunkt der
-- Ankündigung; ein gesetzter Merker verhindert eine zweite. Jeder Schreibweg, der den Termin
-- tatsächlich ändert (Termin setzen, Abschluss mit Termin), leert beide in derselben Anweisung,
-- damit die Ankündigung für den neuen Termin gilt, nicht für den alten.
--
-- Aufbewahrung: reine Zeitstempel ohne Personenbezug, retain wie der Termin selbst
-- (`einsatz::schwaerzung_registry`, Tabelle `einsatz`).
ALTER TABLE einsatz ADD COLUMN lagebesprechung_angekuendigt_vorher_at TEXT;
ALTER TABLE einsatz ADD COLUMN lagebesprechung_angekuendigt_faellig_at TEXT;
