-- Meldungen (eingehend) (LFH-54): Bottom-up-Strang — digitaler Meldekopf.
-- Nachrichtenvordruck-Felder + linearer Triage-Workflow (neu→gesichtet→in_bearbeitung→erledigt).
-- Status ist code-validiert (kein DB-CHECK), wie auftrag.prioritaet. Single Adressat
-- (empfaenger TEXT), kein 1:n Fan-out. ETB-Kopplung (Pattern B): bei der Erfassung
-- entsteht ein etb_eintrag typ='meldung' mit beidseitigem Backlink (meldung.etb_meldung_id
-- ↔ etb_eintrag.meldung_id).
CREATE TABLE meldung (
    id              INTEGER PRIMARY KEY,
    einsatz_id      INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    -- Laufende Nr. pro Einsatz (atomar via COALESCE(MAX)+1, wie ETB).
    lfd_nr          INTEGER NOT NULL,
    -- Nachrichtenvordruck:
    absender        TEXT    NOT NULL,                 -- Funkrufname/Stelle (Pflicht)
    empfaenger      TEXT,                             -- Adressat (optional, Freitext)
    -- Meldeweg: 'funk'|'telefon'|'persoenlich'|'sonstige' (Vokabular = ETB/MeldeWeg).
    meldeweg        TEXT    NOT NULL,
    inhalt          TEXT    NOT NULL,                 -- Wortlaut (Pflicht)
    -- Meldungsart: 'lagemeldung'|'sofortmeldung'|'rueckmeldung'|'vollzugsmeldung'|'anfrage'|'sonstige'.
    meldungsart     TEXT    NOT NULL DEFAULT 'sonstige',
    -- 'sofort'|'dringend'|'normal' (code-validiert).
    prioritaet      TEXT    NOT NULL DEFAULT 'normal',
    -- Triage-Status: 'neu'|'gesichtet'|'in_bearbeitung'|'erledigt' (code-validiert).
    status          TEXT    NOT NULL DEFAULT 'neu',
    bearbeiter_id   INTEGER REFERENCES benutzer(id),
    -- Lagerelevanz (LFH-95): Flag; Übergabe erzeugt lage_meldung (0050).
    lagerelevant    INTEGER NOT NULL DEFAULT 0,
    -- Ereigniszeit (wann der Vorgang war) ≠ eingang_at (Erfassungs-/Empfangszeit).
    ereigniszeit    TEXT    NOT NULL,
    eingang_at      TEXT    NOT NULL,
    -- Kopplungen:
    etb_meldung_id  INTEGER REFERENCES etb_eintrag(id),   -- erzeugte ETB-Meldung
    auftrag_id      INTEGER REFERENCES auftrag(id),        -- ausgelöster Auftrag (Spalte offen, UI deferred)
    erfasst_von_id  INTEGER NOT NULL REFERENCES benutzer(id),
    erstellt_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_meldung_einsatz ON meldung(einsatz_id, status);

-- ETB-Kopplung: ETB-Eintrag verweist zurück auf die Quell-Meldung (Vorlage 0048_auftrag.sql;
-- berührt die FTS-Trigger nicht).
ALTER TABLE etb_eintrag ADD COLUMN meldung_id INTEGER REFERENCES meldung(id);
