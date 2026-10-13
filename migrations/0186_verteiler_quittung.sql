-- LLH-1173: Quittung je Verteiler-Empfänger am Einsatzbefehl. Zeitpunkt und quittierende Person
-- stehen an der Verteiler-Zeile wie bei `auftrag_empfaenger` (0048); NULL heißt offen. Beide
-- Tabellen bekommen die Spalten, damit der gemeinsame Kern (`vorlagendokument::verteiler`) sein
-- SQL weiter aus der Tabellenkonstante baut; am Lagebericht schreibt sie keine Route. Das
-- Fortschreiben kopiert sie nicht: eine neue Fassung beginnt offen.
-- Herleitung: `openspec/changes/koiqi51u-befehl-quittung/design.md` (D1).
ALTER TABLE befehl_verteiler ADD COLUMN quittiert_at TEXT;
ALTER TABLE befehl_verteiler ADD COLUMN quittiert_von_id INTEGER REFERENCES benutzer(id);
ALTER TABLE lagebericht_verteiler ADD COLUMN quittiert_at TEXT;
ALTER TABLE lagebericht_verteiler ADD COLUMN quittiert_von_id INTEGER REFERENCES benutzer(id);
