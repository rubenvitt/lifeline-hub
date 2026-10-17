-- LLH-1132 (Epic LLH-1016, Entscheidung LLH-1118 Punkte 3 und 6): Vollzug mit einer Liste von
-- Ablösern, Übernahme einer schon laufenden Schicht und Abschnittsübergabe.
--
-- 1. `uebernommen_bei_vollzug` — 1, wenn der Vollzug eine schon laufende Schicht des Ablösers
--    (ohne Vorgänger, etwa aus dem Autostart mit dem Eintreffen, LLH-1128) als Folgeschicht
--    übernommen hat, statt eine neue anzulegen. Die Rücknahme löst eine solche Schicht nur vom
--    Vorgänger (`vorgaenger_id` NULL, Marke 0), statt sie zu löschen. Nur der Code setzt den Wert;
--    der CHECK hält ihn bei 0/1 wie `abschnitt_uebergeben` (0212). Eine Spalte, kein Neubau: der
--    gemeinsame Neubau von 0212 sah weitere nullable/Default-Spalten per `ADD COLUMN` vor.
ALTER TABLE einsatz_abloesung ADD COLUMN uebernommen_bei_vollzug INTEGER NOT NULL DEFAULT 0
    CHECK (uebernommen_bei_vollzug IN (0, 1));

-- 2. Bestand in die Liste der Ablöser (0212, Abschnitt 4): ab LLH-1132 ist
--    `einsatz_abloesung_abloeser` die Wahrheit über die geplanten bzw. beim Vollzug genannten
--    Ablöser. `einsatz_abloesung.abloesende_einheit_id` bleibt als Spiegel des ersten Eintrags
--    stehen (Schreibweg nur `abloesung::repo::set_abloeser_tx`), damit bestehende Leser und der
--    Fremdschlüssel unverändert bleiben. Jede Schicht mit einem Verweis bekommt genau die eine
--    Zeile; OR IGNORE, falls eine Zeile schon von Hand angelegt wurde (Primärschlüssel).
INSERT OR IGNORE INTO einsatz_abloesung_abloeser (abloesung_id, einheit_id, angelegt_at)
    SELECT id, abloesende_einheit_id, angelegt_at
    FROM einsatz_abloesung
    WHERE abloesende_einheit_id IS NOT NULL
    ORDER BY id;
