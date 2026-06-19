-- Aufbewahrung & Archiv (LFH-135) — Frist-Politik + Schwärzungs-Tombstone.
--
-- retention_dauer_tage: Aufbewahrungs-DAUER (in Tagen) als Politik pro Einsatz,
--   abgelegt auf einsatz_einstellungen (1:1 pro Einsatz). NULL = keine Auto-Frist
--   (sicherer Default, Verhalten wie bisher). Der ZEITPUNKT (einsatz.retention_bis)
--   wird daraus erst beim Einsatz-Abschluss berechnet (Auto-Befüllung). Validierung
--   in Rust (1..=3650), kein DB-CHECK (sqlx-sqlite 0.8.6 kann CHECK nicht per
--   Rebuild ändern). ADD COLUMN → kein Tabellen-Rebuild.
ALTER TABLE einsatz_einstellungen ADD COLUMN retention_dauer_tage INTEGER;

-- geschwaerzt_at: PII-Schwärzungs-Tombstone (TEXT, '%Y-%m-%d %H:%M:%S' UTC). Wird
--   vom Purge-Scheduler (Phase B) gesetzt, sobald die Personendaten eines Einsatzes
--   nach Ablauf der Karenz gescrubbt wurden. NULL = nicht geschwärzt. Getrennt vom
--   Karenz-Tombstone geloescht_at (Phase A, reversibel): geschwaerzt_at markiert die
--   IRREVERSIBLE Schwärzung und dient als Idempotenz-Guard (bereits geschwärzt →
--   kein erneutes Scrubben).
ALTER TABLE einsatz ADD COLUMN geschwaerzt_at TEXT;
