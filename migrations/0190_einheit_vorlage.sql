-- LLH-1042: Einheiten-Vorlagen in den Stammdaten. Stehende Einheiten (Löschzug, SEG,
-- Sanitätszug) je Organisation mit Untereinheiten, Stamm-Fahrzeugen und optionaler
-- Stammbesetzung. Gebildet wird daraus erst im Einsatz (LLH-1049).
--
-- Org-Stammdatum, nicht einsatzbezogen: kein Fremdschlüssel aus oder zu einer Einsatztabelle,
-- deshalb nicht in der Schwärzungs-Registry (wie `org_externe_stelle`, 0178).
--
-- Untereinheiten über die Elternspalte `ueber_vorlage_id` (NO ACTION): eine stehende Gruppe
-- gehört zu genau einem Zug. Zyklen verhindert Rust in der schreibenden Transaktion
-- (`einheit_vorlage::repo`). Soll-Override wie `einsatz_einheit`: alle drei oder keiner; ohne
-- eigenes Soll gilt das des Einheitstyps.
--
-- Fremdschlüssel: die beiden Kindtabellen hängen mit ON DELETE CASCADE an der Vorlage; jeder
-- Verweis auf `fahrzeug`, `personal` und auf `einheit_vorlage` von außen bleibt NO ACTION, damit
-- der Demo-Löschweg „noch verwiesen“ über den Fremdschlüsselfehler erkennt
-- (`demo::schema_tests::kein_fk_kaskadiert_in_stammdaten`).

CREATE TABLE einheit_vorlage (
    id                INTEGER PRIMARY KEY,
    org_id            INTEGER NOT NULL REFERENCES organisation(id),
    name              TEXT NOT NULL,
    typ_id            INTEGER NOT NULL REFERENCES einheit_typ(id),
    ueber_vorlage_id  INTEGER REFERENCES einheit_vorlage(id),
    funkrufname       TEXT,
    tz_fachaufgabe    TEXT,
    tz_organisation   TEXT,
    soll_fuehrer      INTEGER,
    soll_unterfuehrer INTEGER,
    soll_mannschaft   INTEGER,
    bemerkung         TEXT,
    sortier           INTEGER NOT NULL DEFAULT 0,
    aktiv             INTEGER NOT NULL DEFAULT 1 CHECK (aktiv IN (0, 1)),
    angelegt_at       TEXT NOT NULL DEFAULT (datetime('now')),
    CHECK ((soll_fuehrer IS NULL) = (soll_unterfuehrer IS NULL)
       AND (soll_unterfuehrer IS NULL) = (soll_mannschaft IS NULL))
);

-- Name eindeutig nur unter den aktiven Vorlagen: eine deaktivierte gibt ihn frei.
CREATE UNIQUE INDEX idx_einheit_vorlage_name ON einheit_vorlage(org_id, name) WHERE aktiv = 1;
CREATE INDEX idx_einheit_vorlage_ueber ON einheit_vorlage(ueber_vorlage_id);

-- Stamm-Fahrzeuge einer Vorlage. Im selben Vorlagen-Baum höchstens einmal (prüft Rust, 422),
-- über Bäume hinweg erlaubt.
CREATE TABLE einheit_vorlage_fahrzeug (
    vorlage_id  INTEGER NOT NULL REFERENCES einheit_vorlage(id) ON DELETE CASCADE,
    fahrzeug_id INTEGER NOT NULL REFERENCES fahrzeug(id),
    sortier     INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (vorlage_id, fahrzeug_id)
);

CREATE INDEX idx_einheit_vorlage_fahrzeug_fahrzeug ON einheit_vorlage_fahrzeug(fahrzeug_id);

-- Stammbesetzung (Vorschlag, disponiert wird erst im Einsatz). `fahrzeug_id` ist ein Fahrzeug
-- derselben Vorlage (prüft Rust, 422); `staerke_position` NULL heißt Stamm-Vorgabe der Person.
CREATE TABLE einheit_vorlage_personal (
    vorlage_id       INTEGER NOT NULL REFERENCES einheit_vorlage(id) ON DELETE CASCADE,
    personal_id      INTEGER NOT NULL REFERENCES personal(id),
    fahrzeug_id      INTEGER REFERENCES fahrzeug(id),
    staerke_position TEXT CHECK (staerke_position IN ('fuehrer', 'unterfuehrer', 'mannschaft')),
    PRIMARY KEY (vorlage_id, personal_id)
);

CREATE INDEX idx_einheit_vorlage_personal_personal ON einheit_vorlage_personal(personal_id);
CREATE INDEX idx_einheit_vorlage_personal_fahrzeug ON einheit_vorlage_personal(fahrzeug_id);

-- Demo-Marke für Vorlagen: `demo_herkunft.tabelle` kennt per CHECK nur drei Arten, SQLite ändert
-- einen CHECK nur per Neubau. `demo_herkunft` ist Blatt (keine Tabelle verweist darauf), das DROP
-- löst also keine Kaskade aus. Schema = 0123 1:1, einzige Änderung ist der CHECK (Wire-Werte von
-- `demo::DemoStammdatenArt`). Abgesichert von db::tests::migration_0190_*.
CREATE TABLE demo_herkunft_neu (
    import_id    INTEGER NOT NULL REFERENCES demo_import(id) ON DELETE CASCADE,
    tabelle      TEXT    NOT NULL CHECK (tabelle IN ('fahrzeug', 'personal', 'material', 'einheit_vorlage')),
    datensatz_id INTEGER NOT NULL,
    PRIMARY KEY (tabelle, datensatz_id)
);

INSERT INTO demo_herkunft_neu (import_id, tabelle, datensatz_id)
    SELECT import_id, tabelle, datensatz_id FROM demo_herkunft;

DROP TABLE demo_herkunft;

ALTER TABLE demo_herkunft_neu RENAME TO demo_herkunft;
