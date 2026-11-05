-- LLH-1553 (Folge aus LLH-1523, Change `z14dre9r-qualifikationsstufen-soll`): Qualifikationen
-- schließen andere ein, und Einheitentyp, Einheiten-Vorlage, Einheit und UHS tragen ein
-- Qualifikationssoll.
--
-- 1. `qualifikation.schliesst_ein_id` — die nächstniedrigere Qualifikation derselben
--    Organisation, die diese einschließt (Notfallsanitäter → Rettungssanitäter → Sanitäter).
--    Der Einschluss gilt transitiv. Dieselbe Organisation, kein Selbstverweis und kein Kreis
--    prüft Rust in der schreibenden Abfrage (`personal::qualifikation_repo`, 422). NO ACTION wie
--    jeder Verweis auf den Katalog: Qualifikationen werden nie hart gelöscht (0011, aktiv = 0).
--
-- 2. `quali_soll` an `einheit_typ`, `einheit_vorlage`, `einsatz_einheit` und `uhs` — eine
--    JSON-Liste `[{"q": <qualifikation.id>, "n": <anzahl>}]`. Grenzen (höchstens 10 Einträge,
--    Anzahl 1 bis 50, jede Qualifikation einmal, nur der eigenen Organisation) prüft Rust
--    (`personal::quali_soll`). Eine leere Liste speichert Rust als NULL („kein Soll“). Kein
--    Freitext, keine Namen: nur Katalog-Kennungen und Zahlen.
--
-- 3. `uhs.soll_anzahl` — wie viele Kräfte die UHS braucht (1 bis 200, NULL = kein Soll).
--    Einheiten haben ihre Soll-Anzahl schon als Summe von F/UF/M.
--
-- 4. Bestand: die Ketten der Startliste (Notfallsanitäter → Rettungssanitäter → Sanitäter,
--    Zugführer → Gruppenführer → Truppführer) nur, wo beide Labels der Organisation exakt der
--    Startliste gleichen und noch kein Einschluss gesetzt ist. Notarzt schließt nichts ein.
--    Gleich mit `personal::QUALIFIKATION_EINSCHLUSS_STARTLISTE` halten.
--
-- Abgesichert von db::tests::migration_0276_qualifikation_einschluss_soll.
ALTER TABLE qualifikation ADD COLUMN schliesst_ein_id INTEGER REFERENCES qualifikation(id);
CREATE INDEX idx_qualifikation_schliesst_ein ON qualifikation(schliesst_ein_id);

ALTER TABLE einheit_typ ADD COLUMN quali_soll TEXT
    CHECK (quali_soll IS NULL OR json_valid(quali_soll));
ALTER TABLE einheit_vorlage ADD COLUMN quali_soll TEXT
    CHECK (quali_soll IS NULL OR json_valid(quali_soll));
ALTER TABLE einsatz_einheit ADD COLUMN quali_soll TEXT
    CHECK (quali_soll IS NULL OR json_valid(quali_soll));
ALTER TABLE uhs ADD COLUMN quali_soll TEXT
    CHECK (quali_soll IS NULL OR json_valid(quali_soll));
ALTER TABLE uhs ADD COLUMN soll_anzahl INTEGER
    CHECK (soll_anzahl IS NULL OR soll_anzahl BETWEEN 1 AND 200);

UPDATE qualifikation AS q
SET schliesst_ein_id = (
    SELECT z.id FROM qualifikation z
    WHERE z.org_id = q.org_id
      AND z.label = CASE q.label
          WHEN 'Notfallsanitäter'  THEN 'Rettungssanitäter'
          WHEN 'Rettungssanitäter' THEN 'Sanitäter'
          WHEN 'Zugführer'         THEN 'Gruppenführer'
          WHEN 'Gruppenführer'     THEN 'Truppführer'
      END
)
WHERE q.schliesst_ein_id IS NULL
  AND q.label IN ('Notfallsanitäter', 'Rettungssanitäter', 'Zugführer', 'Gruppenführer');
