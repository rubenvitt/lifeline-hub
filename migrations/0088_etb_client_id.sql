-- F03/LFH-261: client_id trägt die client-generierte Offline-Idempotenz.
-- Ein Offline-Eintrag bekommt vor dem (evtl. wiederholten) Senden eine stabile UUID;
-- das Backend dedupliziert idempotent gegen (einsatz_id, client_id) und spielt bei
-- erneutem Senden die bestehende Antwort zurück, statt eine Dublette zu erzeugen.
--
-- Bewusst nullable + PARTIELLER Unique-Index (WHERE client_id IS NOT NULL):
--   - System-/abgeleitete Einträge (etb::repo::anlegen_tx) und die Online-Direkterfassung
--     ohne Id tragen NULL und dürfen nie miteinander kollidieren.
--   - Nur ADD COLUMN + partieller Index → kein Tabellen-Neuaufbau, die FTS5-Trigger
--     (etb_eintrag_fts_ai/_ad) bleiben unberührt. Ein Tabellen-Level-UNIQUE-Constraint
--     würde dagegen den sqlx-CHECK-Rebuild inkl. Trigger-Neuanlage erzwingen.
ALTER TABLE etb_eintrag ADD COLUMN client_id TEXT;

CREATE UNIQUE INDEX idx_etb_client_id
    ON etb_eintrag(einsatz_id, client_id)
    WHERE client_id IS NOT NULL;
