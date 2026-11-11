-- LLH-1496: Lagebild für Externe als geschwärzte Ansicht (Spec `lagebild-extern`).
-- Herleitung: /mnt/project-files/llh-1496/openspec/k11guwns-lagebild-extern/design.md (D1, D6, D8).
--
-- Eine Freigabe ist ein Link je Empfänger, ohne Konto. In der DB steht nur der SHA-256 des
-- Schlüssels (wie beim Lesezugang `llh_lm_`, LLH-1484). Beide Tabellen gelten nur an dieser
-- Instanz und werden nicht gespiegelt (`instanz::spiegel::art::AUSGENOMMEN`).
CREATE TABLE lagebild_freigabe (
    id              INTEGER PRIMARY KEY,
    einsatz_id      INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    empfaenger      TEXT    NOT NULL,             -- „Krisenstab Kreis“, ≤ 80 Zeichen
    stufe           TEXT    NOT NULL CHECK (stufe IN ('lagebild', 'oeffentlich')),
    schluessel_hash TEXT    NOT NULL UNIQUE,
    gueltig_bis     TEXT,                         -- NULL: bis zum Abschluss des Einsatzes
    angelegt_von    INTEGER REFERENCES benutzer(id) ON DELETE SET NULL,
    angelegt_at     TEXT    NOT NULL DEFAULT (datetime('now')),
    widerrufen_at   TEXT,
    widerrufen_von  INTEGER REFERENCES benutzer(id) ON DELETE SET NULL
);
CREATE INDEX idx_lagebild_freigabe_einsatz ON lagebild_freigabe (einsatz_id);

-- Protokoll der Abrufe (D6): je Öffnung der Seite eine Zeile; jeder weitere Abruf derselben
-- Öffnung schiebt `zuletzt_at` und zählt `abrufe`. Keine IP, kein Browserkennzeichen.
CREATE TABLE lagebild_abruf (
    id          INTEGER PRIMARY KEY,
    freigabe_id INTEGER NOT NULL REFERENCES lagebild_freigabe(id) ON DELETE CASCADE,
    oeffnung    TEXT    NOT NULL,                 -- Zufallskennung, die die Seite je Öffnung zieht
    begonnen_at TEXT    NOT NULL DEFAULT (datetime('now')),
    zuletzt_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    abrufe      INTEGER NOT NULL DEFAULT 1,
    UNIQUE (freigabe_id, oeffnung)
);
