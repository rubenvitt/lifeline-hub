-- LLH-1058: Verpflegungsplan der Organisation. Eine flache Liste von Mahlzeiten mit Beginn und
-- Ende als Wanduhrzeit ohne Datum und ohne Zone („Frühstück 06:30–08:00“). Aus ihr legt die
-- Verpflegung eines Einsatzes für einen Tag einzelne, danach unabhängige Zeitfenster an; ein
-- Zeitfenster kennt seine Vorlage nicht, es gibt keine Serie (design.md D1, D14).
--
-- Org-Stammdatum, nicht einsatzbezogen: kein Fremdschlüssel aus oder zu einer Einsatztabelle,
-- deshalb nicht in der Schwärzungs-Registry (Guard `stammdaten_teilbaum_nie_einsatz_scoped`).
--
-- `beginn`/`ende` als Text `HH:MM` (Rust: `uhrzeit::Uhrzeit`); als Text sortiert das richtig.
-- Ende vor Beginn heißt: die Mahlzeit endet am Folgetag (Nachtverpflegung 23:00–01:00). Ende
-- gleich Beginn ist kein Zeitraum. Löschen heißt deaktivieren (`aktiv`), wie bei den
-- Einheiten-Vorlagen (0190). Die Verpflegungsart wie am Zeitfenster (0206), NULL = ohne Angabe.
-- Der Plan trägt keinen Bedarf: der wird je Tag erfasst.

CREATE TABLE verpflegung_vorlage (
    id              INTEGER PRIMARY KEY,
    org_id          INTEGER NOT NULL REFERENCES organisation(id),
    bezeichnung     TEXT NOT NULL,
    beginn          TEXT NOT NULL
        CHECK (beginn GLOB '[0-2][0-9]:[0-5][0-9]' AND beginn <= '23:59'),
    ende            TEXT NOT NULL
        CHECK (ende GLOB '[0-2][0-9]:[0-5][0-9]' AND ende <= '23:59'),
    verpflegungsart TEXT CHECK (verpflegungsart IN ('warm','kalt','getraenke')),
    aktiv           INTEGER NOT NULL DEFAULT 1 CHECK (aktiv IN (0, 1)),
    angelegt_at     TEXT NOT NULL DEFAULT (datetime('now')),
    CHECK (ende <> beginn)
);

-- Name eindeutig nur unter den aktiven Mahlzeiten: eine deaktivierte gibt ihn frei. Das Netz
-- unter der Rust-Prüfung, die zusätzlich ohne Groß- und Kleinschreibung vergleicht (`lower()`
-- faltet in SQLite nur ASCII).
CREATE UNIQUE INDEX idx_verpflegung_vorlage_name
    ON verpflegung_vorlage(org_id, bezeichnung) WHERE aktiv = 1;
