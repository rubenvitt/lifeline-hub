-- LLH-1587 (Change `vu7jnr2x-vorplanung-ohne-einsatz`, Teil C): Übernahme einer Planung in einen
-- Einsatz. Eine übernommene Planung ist danach schreibgeschützt (409, prüft Rust in jeder
-- schreibenden Transaktion) und bleibt bis zu ihrer Löschfrist lesbar und löschbar.
--
-- - `uebernommen_at`/`uebernommen_von`: wann und von wem; gesetzt = schreibgeschützt.
-- - `uebernahme_einsatz`: der Einsatz, in den sie ging. Bewusst OHNE Fremdschlüssel und nicht
--   `einsatz_id` genannt: die Planung liegt außerhalb der einsatz-scoped Menge der Schwärzung
--   (Entdeckung über `einsatz_id`, GUARD 5 über deklarierte FK-Kanten). Wird der Einsatz endgültig
--   gelöscht, zeigt die Zahl ins Leere; die Planung geht mit ihrer eigenen Frist.
-- - `uebernahme_einsatznummer`: die Einsatznummer zum Zeitpunkt der Übernahme, zum Anzeigen.
-- - `uebernahme_kennzahlen`: Soll, Ist, Offen und Konflikte zum Zeitpunkt der Übernahme als
--   JSON-Objekt; Kopf und Liste zeigen danach diese Werte.
--
-- Abgesichert von db::tests::migration_0302_planung_uebernahme.
ALTER TABLE planung ADD COLUMN uebernommen_at TEXT;
ALTER TABLE planung ADD COLUMN uebernommen_von INTEGER REFERENCES benutzer(id);
ALTER TABLE planung ADD COLUMN uebernahme_einsatz INTEGER;
ALTER TABLE planung ADD COLUMN uebernahme_einsatznummer TEXT;
ALTER TABLE planung ADD COLUMN uebernahme_kennzahlen TEXT
    CHECK (uebernahme_kennzahlen IS NULL
        OR (json_valid(uebernahme_kennzahlen) AND json_type(uebernahme_kennzahlen) = 'object'));
