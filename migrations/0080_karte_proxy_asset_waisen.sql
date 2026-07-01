-- LFH-196 Nachzug: verwaiste karte_proxy_asset-Slots entfernen.
--
-- Migration 0079 löscht die protomaps-Online-Quellen im `PRAGMA foreign_keys = OFF`-Fenster
-- (nötig fürs FK-sichere CHECK-Rebuild der karte_online_quelle). In diesem Fenster feuert das
-- `ON DELETE CASCADE` auf karte_proxy_asset NICHT — es bleiben Slot-Zeilen mit einer quelle_id,
-- die auf keine Quelle mehr zeigt. Diese hier bereinigen (allgemein: jeder verwaiste Slot).
--
-- Bewusst als EIGENE Migration statt als Edit an 0079: eine bereits angewendete Migration darf
-- nicht mehr geändert werden (sqlx prüft die Checksum → „migration was previously applied but
-- has been modified"). quelle_id ist NOT NULL (0077) → kein NULL-Sonderfall im NOT IN.
DELETE FROM karte_proxy_asset
WHERE quelle_id NOT IN (SELECT id FROM karte_online_quelle);
