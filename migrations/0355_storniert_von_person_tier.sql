-- LLH-1832 (Change `qm3orral-storno-sperrt-offene-seiten`, design.md D1): Person und Tier
-- halten wie der Schaden fest, wer storniert hat. Die offene Detailseite nennt den Namen im
-- Banner „Storniert von … um …“. Altbestand bleibt NULL (kein Nachtrag aus `geaendert_von`,
-- das wäre eine Vermutung) und zeigt nur „Storniert um …“.
ALTER TABLE einsatz_person ADD COLUMN storniert_von INTEGER REFERENCES benutzer(id);
ALTER TABLE einsatz_tier ADD COLUMN storniert_von INTEGER REFERENCES benutzer(id);
