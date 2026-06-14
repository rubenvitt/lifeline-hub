-- Generische Anhang-Infrastruktur (LFH-102). Einsatz-skopiert und bewusst
-- modulübergreifend geschnitten: Chat dockt jetzt an, ETB/Lageobjekte können
-- dieselbe Tabelle später nutzen (Task-Hinweis LFH-102).
--
-- Datei-Bytes liegen als BLOB in der SQLite-DB — Single-Binary-Betrieb mit
-- gebündeltem SQLite, und nur so erfasst das vorhandene file-copy-/VACUUM-INTO-
-- Backup (src/backup) die Anhänge automatisch vollständig mit. sha256 dient als
-- Integritäts-/Dedup-Schlüssel und als künftiger Cache-Key des AV-Scan-Ergebnisses
-- (ClamAV-Anbindung folgt separat, LFH-114).
CREATE TABLE anhang (
    id              INTEGER PRIMARY KEY,
    einsatz_id      INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    dateiname       TEXT    NOT NULL,
    mime            TEXT    NOT NULL,
    groesse         INTEGER NOT NULL,
    sha256          TEXT    NOT NULL,
    daten           BLOB    NOT NULL,
    hochgeladen_von INTEGER NOT NULL REFERENCES benutzer(id),
    erstellt_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_anhang_einsatz ON anhang(einsatz_id);

-- Verknüpfung Chat-Nachricht ↔ Anhang. n:m über die generische Tabelle: eine
-- Nachricht kann mehrere Anhänge tragen, ein Anhang könnte (perspektivisch)
-- mehrfach referenziert werden. Reverse-FK-Muster wie chat_auftrag (0051),
-- statt eine 1:1-Spalte an chat_nachricht zu hängen.
CREATE TABLE chat_nachricht_anhang (
    nachricht_id INTEGER NOT NULL REFERENCES chat_nachricht(id) ON DELETE CASCADE,
    anhang_id    INTEGER NOT NULL REFERENCES anhang(id) ON DELETE CASCADE,
    PRIMARY KEY (nachricht_id, anhang_id)
);
