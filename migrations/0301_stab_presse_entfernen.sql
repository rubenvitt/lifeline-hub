-- i6k6mzed: Das Modul `stab` samt Presse und Medienarbeit (S5) entfällt (Herleitung
-- openspec/changes/i6k6mzed-stab-herausnehmen/design.md, D1 und D4). Gelöscht werden die
-- Besetzung S1–S6, die Checkliste Arbeitsaufnahme, das Presse-Log und die Pressemitteilungen.
-- Was davon im ETB steht, bleibt als Text: Besetzungswechsel, freigegebene Pressemitteilungen,
-- die Meldung an die Leitstelle. Die Freigaben von `stab` hat `infotelefon_modul` übernommen
-- und gelöscht.

-- 1. Ein Löschersuchen für einen Medienkontakt, das jetzt noch offen ist (24-Stunden-Fenster),
--    ist mit dieser Migration erledigt: sein Ziel wird unten gelöscht, und genau das wollte es.
--    Es bekommt den Vollzugsstand, damit es in der Archivakte als vollzogen steht und der
--    Purge-Lauf es nicht mehr aufgreift (den Personen-Scrub für Medienkontakte gibt es nicht
--    mehr). Grund des Vollzugs: Modul Presse und Medienarbeit entfernt. Ein Feld dafür hat
--    `schwaerzung_antrag` nicht (0140). Zurückgenommene und vollzogene Ersuchen bleiben, wie sie
--    sind; der Wert `medienkontakt` im CHECK von 0140 bleibt, damit sie lesbar bleiben.
UPDATE schwaerzung_antrag
SET vollzogen_at = strftime('%Y-%m-%d %H:%M:%S', 'now')
WHERE ziel_art = 'medienkontakt'
  AND zurueckgenommen_at IS NULL
  AND vollzogen_at IS NULL;

-- 2. Erst die Spalte, dann die Tabellen: bei stehender Spalte scheiterte jedes spätere
--    ETB-INSERT an der fehlenden Tabelle `pressemitteilung`. Das gebündelte SQLite löscht die
--    Spalte samt Fremdschlüssel (Aufgabe 1.1); kein Index und kein FTS-Trigger liest sie.
ALTER TABLE etb_eintrag DROP COLUMN pressemitteilung_id;

-- 3. Die Tabellen. Ihre Indizes fallen mit ihnen; keine andere Tabelle verweist mehr auf sie.
DROP TABLE medienkontakt;
DROP TABLE pressemitteilung;
DROP TABLE einsatz_stab_checkliste;
DROP TABLE einsatz_stabsfunktion;
