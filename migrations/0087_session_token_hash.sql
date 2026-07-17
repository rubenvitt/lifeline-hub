-- F20 (LFH-236): Session-Tokens nur noch als SHA-256-Hash speichern.
-- Bestandssessions werden invalidiert (Klartext ist nicht rückrechenbar -> kein
-- Backfill möglich, einmaliger Zwangs-Re-Login), danach die Spalte umbenennen.
-- RENAME COLUMN ist transaktionssicher: session hat keinen CHECK, keinen eingehenden
-- FK auf die Token-Spalte und keine Trigger/Views; PRIMARY KEY und idx_session_benutzer
-- bleiben erhalten. Greift auch beim Serverstart nach Restore eines Vor-Fix-Backups
-- (Klartext-Sessions werden dabei geleert).
DELETE FROM session;
ALTER TABLE session RENAME COLUMN token TO token_hash;
