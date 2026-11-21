-- LLH-2017 (Adapter-Rahmen Teil A, docs/superpowers/specs/2026-11-21-r19tuh60-adapter-rahmen-design.md):
-- Adapter einer Org mit Einstellung und Zustand, ihre Geheimnisse (age-verschlüsselt mit dem
-- Schlüssel aus der Umgebung, ADR-0077) und die letzten Versuche.

-- `art` ist der Code einer Adapterart im Verzeichnis des Codes, bewusst ohne CHECK: eine neue Art
-- käme sonst nur mit Tabellenumbau. Eine unbekannte Art zeigt der Zustand, der Lauf lässt sie aus.
-- `einstellungen` ist ein JSON-Objekt ohne Geheimes. „Gestört“ ist kein eigener Zustand, sondern
-- `aktiv` mit `fehler_seit`; `angehalten_grund` ist leer, wenn ein Admin angehalten hat, sonst der
-- Fehlercode (`AdapterFehler`), der einen Menschen braucht. Fehler stehen als Code, nie als Text
-- des Ziels. `stand` zählt jede Änderung durch einen Admin (Einstellungen, Geheimnisse, Anhalten,
-- Fortsetzen); ein Abruf, der mit einem älteren Stand begann, schreibt weder Übernahme noch
-- Zustand, nur seinen Versuch.
CREATE TABLE adapter (
    id                    TEXT    PRIMARY KEY,
    org_id                INTEGER NOT NULL REFERENCES organisation(id) ON DELETE CASCADE,
    art                   TEXT    NOT NULL,
    name                  TEXT    NOT NULL,
    einstellungen         TEXT    NOT NULL DEFAULT '{}',
    intervall_s           INTEGER NOT NULL CHECK (intervall_s > 0),
    lan_erlaubt           INTEGER NOT NULL DEFAULT 0 CHECK (lan_erlaubt IN (0, 1)),
    zustand               TEXT    NOT NULL DEFAULT 'aktiv' CHECK (zustand IN ('aktiv', 'angehalten')),
    angehalten_grund      TEXT,
    angehalten_at         TEXT,
    fehler_seit           TEXT,
    fehlversuche          INTEGER NOT NULL DEFAULT 0,
    naechster_abruf_at    TEXT,
    letzter_fehler_at     TEXT,
    letzter_fehler_status INTEGER,
    letzter_fehler_art    TEXT,
    letzter_erfolg_at     TEXT,
    letzte_anzahl         INTEGER,
    stand                 INTEGER NOT NULL DEFAULT 0,
    angelegt_at           TEXT    NOT NULL DEFAULT (datetime('now')),
    angelegt_von          INTEGER REFERENCES benutzer(id) ON DELETE SET NULL,
    geaendert_at          TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_adapter_org ON adapter (org_id);

-- Ein Geheimnis je Platz der Art. `chiffrat` ist age-verschlüsselt an den Empfänger des
-- Schlüssels aus `LIFELINE_GEHEIMNIS_SCHLUESSEL`; `schluessel_fp` sind die ersten 16 Hex-Zeichen
-- von SHA-256 über diesen Empfänger. Klartext steht nirgends.
CREATE TABLE adapter_geheimnis (
    adapter_id    TEXT    NOT NULL REFERENCES adapter(id) ON DELETE CASCADE,
    name          TEXT    NOT NULL,
    chiffrat      BLOB    NOT NULL,
    schluessel_fp TEXT    NOT NULL,
    gesetzt_at    TEXT    NOT NULL DEFAULT (datetime('now')),
    gesetzt_von   INTEGER REFERENCES benutzer(id) ON DELETE SET NULL,
    PRIMARY KEY (adapter_id, name)
);

-- Die letzten Versuche je Adapter (höchstens 50; wer einfügt, löscht die älteren). `probe` ist
-- „Verbindung prüfen“. Kein Rumpf der Antwort.
CREATE TABLE adapter_versuch (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    adapter_id TEXT    NOT NULL REFERENCES adapter(id) ON DELETE CASCADE,
    at         TEXT    NOT NULL,
    probe      INTEGER NOT NULL DEFAULT 0 CHECK (probe IN (0, 1)),
    status     INTEGER,
    fehler_art TEXT,
    dauer_ms   INTEGER NOT NULL,
    anzahl     INTEGER
);
CREATE INDEX idx_adapter_versuch ON adapter_versuch (adapter_id, id);
