-- Versionsstand der Instanz (Spec `versionsstand`, Change neuigkeiten-versionshinweise).
--
-- EINE Zeile je Server-Instanz, fest auf `id = 1`. Beim Start schreibt Rust die laufende Version
-- hinein und erkennt daraus einen Versionswechsel; `gelesen_bis` ist die Version, bis zu der die
-- Neuigkeiten als gelesen gelten. Der Lesestand gilt für alle Personen derselben Instanz.
--
-- Keine CHECK-Constraints (Validierung in Rust), wie bei den übrigen Einstellungstabellen.
-- `id = 1` setzt ausschließlich `src/versionsstand/repo.rs`.
CREATE TABLE instanz_versionsstand (
    id                 INTEGER PRIMARY KEY,
    laufend            TEXT    NOT NULL,
    zuletzt_gestartet  TEXT,
    gelesen_bis        TEXT
);
