-- Verhalten & Automatik pro Einsatz (LFH-133) — additive Skalarfelder auf der
-- bestehenden 1:1-Tabelle einsatz_einstellungen. Wie 0064/0066 per ADD COLUMN
-- (kein Rebuild, kein CHECK). Validierung in Rust, NULL = projektweiter Default
-- (heutiges Verhalten). Drei Belange:
--   1. Nummernkreise: Präfix (display-only, NIE pro Zeile gespeichert) + Startwert
--      der laufenden Nummer je Modul (ETB, Meldung, Auftrag).
--   2. Default-Fristen (Minuten): Meldungs-Bestätigung, Auftrags-Quittierung.
--   3. Auto-ETB-Schalter: 0 = Pattern-B-Dual-Publish unterdrücken; NULL/1 = an.
ALTER TABLE einsatz_einstellungen ADD COLUMN etb_nummer_praefix TEXT;          -- z. B. 'EB-'; display-only
ALTER TABLE einsatz_einstellungen ADD COLUMN etb_nummer_start INTEGER;         -- Startwert der ersten lfd_nr
ALTER TABLE einsatz_einstellungen ADD COLUMN meldung_nummer_praefix TEXT;
ALTER TABLE einsatz_einstellungen ADD COLUMN meldung_nummer_start INTEGER;
ALTER TABLE einsatz_einstellungen ADD COLUMN auftrag_nummer_praefix TEXT;
ALTER TABLE einsatz_einstellungen ADD COLUMN auftrag_nummer_start INTEGER;
ALTER TABLE einsatz_einstellungen ADD COLUMN meldung_bestaetigung_frist_min INTEGER;  -- Default-Bestätigungsfrist
ALTER TABLE einsatz_einstellungen ADD COLUMN auftrag_quittierung_frist_min INTEGER;   -- Default-Quittierfrist
ALTER TABLE einsatz_einstellungen ADD COLUMN auto_etb_eintraege INTEGER;       -- 0 = aus; NULL/1 = an (Default)
