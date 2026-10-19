-- LLH-1138: Sichtung, Verbleib und Verlaufsnotiz lassen sich ohne Netz vormerken (Change
-- y18v58dt-pat-kern, design.md D5). Ein Eintrag trägt seine Erfassungszeit in der vorhandenen
-- Zeitspalte (`gesichtet_at`, `zeitpunkt_at`, `erfasst_at`); neu ist, wann er beim Server
-- ankam, und der Idempotenzschlüssel der Offline-Queue.
--
-- Rein additiv per ADD COLUMN, alle Spalten nullable, kein Backfill. SQLite lehnt
-- `ADD COLUMN … DEFAULT (strftime…)` ab (kein konstanter Vorgabewert), deshalb setzt der INSERT
-- `eingegangen_at`; Bestandszeilen bleiben NULL („Ankunft unbekannt“, damals = Erfassung).
--
-- Eindeutig je Einsatz, nicht je Person (Muster 0098/0122): nur so fällt ein Schlüssel auf, der
-- an einer anderen Person schon vergeben ist. NULL bleibt für Online-Aufrufe ohne Schlüssel
-- erlaubt; der partielle Index dedupliziert nur tatsächlich client-identifizierte Einträge.
ALTER TABLE person_sichtung ADD COLUMN client_id TEXT;
ALTER TABLE person_sichtung ADD COLUMN eingegangen_at TEXT;
CREATE UNIQUE INDEX idx_person_sichtung_client_id
    ON person_sichtung(einsatz_id, client_id)
    WHERE client_id IS NOT NULL;

ALTER TABLE person_verbleib ADD COLUMN client_id TEXT;
ALTER TABLE person_verbleib ADD COLUMN eingegangen_at TEXT;
CREATE UNIQUE INDEX idx_person_verbleib_client_id
    ON person_verbleib(einsatz_id, client_id)
    WHERE client_id IS NOT NULL;

ALTER TABLE person_verlaufsnotiz ADD COLUMN client_id TEXT;
ALTER TABLE person_verlaufsnotiz ADD COLUMN eingegangen_at TEXT;
CREATE UNIQUE INDEX idx_person_verlaufsnotiz_client_id
    ON person_verlaufsnotiz(einsatz_id, client_id)
    WHERE client_id IS NOT NULL;
