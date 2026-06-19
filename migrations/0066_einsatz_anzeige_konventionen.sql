-- Anzeige-Konventionen pro Einsatz (LFH-136) — additive Skalarfelder auf der
-- bestehenden 1:1-Tabelle einsatz_einstellungen. Wie in 0064 vorgesehen per
-- ADD COLUMN (kein Rebuild, kein CHECK). Validierung in Rust (Whitelist), NULL =
-- projektweiter Default (heutiges Verhalten). Vier separate ADD-COLUMN-Statements.
ALTER TABLE einsatz_einstellungen ADD COLUMN zeitzone TEXT;          -- IANA-Name, z. B. 'Europe/Berlin'; NULL = lokal
ALTER TABLE einsatz_einstellungen ADD COLUMN zeitformat TEXT;        -- '24h' | '12h'
ALTER TABLE einsatz_einstellungen ADD COLUMN einheiten TEXT;         -- 'metrisch' | 'imperial'
ALTER TABLE einsatz_einstellungen ADD COLUMN koordinatenformat TEXT; -- 'wgs84' | 'mgrs' | 'utm'
