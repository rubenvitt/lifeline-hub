-- LLH-1654 (Change s1i56dpt-einwurf-zugang, design.md D3): Einwurf-Zugang für Absender ohne
-- Signatur (ADR-0023) und die Ablagen, in die er schreibt.

-- Ein Zugang je Absender. Der Schlüssel (`llh_ew_` + 32 Zufallsbytes) steht nie hier, nur sein
-- SHA-256; ein Wechsel ersetzt den Hash.
CREATE TABLE einwurf_zugang (
    id                       TEXT    PRIMARY KEY,
    org_id                   INTEGER NOT NULL REFERENCES organisation(id) ON DELETE CASCADE,
    name                     TEXT    NOT NULL,
    -- Wire-Wert von `public_api::Scope`; ein Einwurf-Zugang hat genau einen Zweck.
    scope                    TEXT    NOT NULL
                                     CHECK (scope IN ('alarmmeldungen:write', 'positionen:write')),
    schluessel_hash          TEXT    NOT NULL UNIQUE,
    gueltig_bis              TEXT,
    angelegt_at              TEXT    NOT NULL,
    angelegt_von             INTEGER REFERENCES benutzer(id) ON DELETE SET NULL,
    schluessel_gewechselt_at TEXT,
    widerrufen_at            TEXT,
    widerrufen_von           INTEGER REFERENCES benutzer(id) ON DELETE SET NULL,
    -- höchstens minütlich fortgeschrieben
    zuletzt_genutzt_at       TEXT
);
CREATE INDEX idx_einwurf_zugang_org ON einwurf_zugang (org_id);

-- Ablage der eingegangenen Alarmmeldungen: eine Zeile je Meldung, roh. `zugang_id` trägt keinen
-- Fremdschlüssel, weil später auch Maschinenzugänge hierher schreiben (LLH-1192); die Org hängt
-- über `org_id` daran. Gelöscht 7 Tage nach `empfangen_at` (`public_api::einwurf::purge`).
CREATE TABLE alarmmeldung (
    id                      INTEGER PRIMARY KEY AUTOINCREMENT,
    org_id                  INTEGER NOT NULL REFERENCES organisation(id) ON DELETE CASCADE,
    zugang_id               TEXT    NOT NULL,
    external_id             TEXT,
    message_id              TEXT,
    -- SHA-256-Hex über rohe Abfrage, Trennbyte und Body.
    inhalt_hash             TEXT    NOT NULL,
    -- JSON mit `abfrage` (Paare in Empfangsreihenfolge), `inhaltstyp` und `body`.
    rohdaten                TEXT    NOT NULL,
    empfangen_at            TEXT    NOT NULL,
    erneut_empfangen_anzahl INTEGER NOT NULL DEFAULT 0,
    erneut_empfangen_at     TEXT,
    -- Derselbe Inhalt desselben Zugangs kam früher schon einmal („möglicherweise derselbe Alarm“).
    frueher_id              INTEGER REFERENCES alarmmeldung(id) ON DELETE SET NULL
);
CREATE INDEX idx_alarmmeldung_kennung ON alarmmeldung (zugang_id, external_id, message_id);
CREATE INDEX idx_alarmmeldung_inhalt ON alarmmeldung (zugang_id, inhalt_hash, empfangen_at);
CREATE INDEX idx_alarmmeldung_empfangen ON alarmmeldung (empfangen_at);
CREATE INDEX idx_alarmmeldung_frueher ON alarmmeldung (frueher_id);

-- Ablage der letzten Position je Zugang und Kennung des Absenders, ohne Verlauf. Gelöscht 24
-- Stunden nach `empfangen_at`.
CREATE TABLE position_letzte (
    org_id       INTEGER NOT NULL REFERENCES organisation(id) ON DELETE CASCADE,
    zugang_id    TEXT    NOT NULL,
    kennung      TEXT    NOT NULL,
    lat          REAL    NOT NULL,
    lon          REAL    NOT NULL,
    -- Zeitstempel des Absenders (UTC, `zeit::FORMAT`); ohne ihn die Empfangszeit.
    gemessen_at  TEXT    NOT NULL,
    empfangen_at TEXT    NOT NULL,
    -- JSON der übrigen Felder des Absenders; mit der Position ersetzt.
    rohdaten     TEXT    NOT NULL,
    PRIMARY KEY (zugang_id, kennung)
);
CREATE INDEX idx_position_letzte_empfangen ON position_letzte (empfangen_at);
CREATE INDEX idx_position_letzte_org ON position_letzte (org_id);
