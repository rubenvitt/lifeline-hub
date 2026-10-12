-- LLH-1172: Verteiler an Befehl und Lagebericht, an wen das Dokument geht. Eine Zeile je Empfänger
-- nach dem Muster von `auftrag_empfaenger` (0089): Ziel-FKs ON DELETE SET NULL, `snap_anzeige`
-- trägt den Anzeigenamen zum Zeitpunkt des Speicherns weiter. Ohne Person und Fahrzeug. Die
-- Pressemitteilung bekommt keinen Verteiler. Die Zeilen sind je Fassung eindeutig: das
-- Fortschreiben kopiert sie, damit eine spätere Quittung je Empfänger (LLH-1173) an genau einer
-- Fassung hängt. `einsatz_id` steht wie bei den Anlagen-Linkern (0157) direkt an der Zeile.
-- Herleitung: `openspec/changes/kz5udbog-verteiler-vorlagendokument/design.md` (D1, D5a).
CREATE TABLE befehl_verteiler (
    id                 INTEGER PRIMARY KEY,
    einsatz_id         INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    befehl_id          INTEGER NOT NULL REFERENCES befehl(id) ON DELETE CASCADE,
    reihenfolge        INTEGER NOT NULL,
    empfaenger_typ     TEXT    NOT NULL
                       CHECK (empfaenger_typ IN ('abschnitt','einheit','funktion','extern')),
    abschnitt_id       INTEGER REFERENCES einsatzabschnitt(id) ON DELETE SET NULL,
    einheit_id         INTEGER REFERENCES einsatz_einheit(id)  ON DELETE SET NULL,
    funktion           TEXT
                       CHECK (funktion IN ('el','s1','s2','s3','s4','s5','s6','s7',
                                           'fuehrungshilfspersonal','fachberater')),
    funktion_text      TEXT,
    extern_kategorie   TEXT
                       CHECK (extern_kategorie IN ('leitstelle','nachbar_ea','uebergeordnet','andere_bos')),
    extern_bezeichnung TEXT,
    snap_anzeige       TEXT    NOT NULL,
    UNIQUE (befehl_id, reihenfolge)
);
CREATE INDEX idx_befehl_verteiler_einsatz ON befehl_verteiler(einsatz_id);

CREATE TABLE lagebericht_verteiler (
    id                 INTEGER PRIMARY KEY,
    einsatz_id         INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    lagebericht_id     INTEGER NOT NULL REFERENCES lagebericht(id) ON DELETE CASCADE,
    reihenfolge        INTEGER NOT NULL,
    empfaenger_typ     TEXT    NOT NULL
                       CHECK (empfaenger_typ IN ('abschnitt','einheit','funktion','extern')),
    abschnitt_id       INTEGER REFERENCES einsatzabschnitt(id) ON DELETE SET NULL,
    einheit_id         INTEGER REFERENCES einsatz_einheit(id)  ON DELETE SET NULL,
    funktion           TEXT
                       CHECK (funktion IN ('el','s1','s2','s3','s4','s5','s6','s7',
                                           'fuehrungshilfspersonal','fachberater')),
    funktion_text      TEXT,
    extern_kategorie   TEXT
                       CHECK (extern_kategorie IN ('leitstelle','nachbar_ea','uebergeordnet','andere_bos')),
    extern_bezeichnung TEXT,
    snap_anzeige       TEXT    NOT NULL,
    UNIQUE (lagebericht_id, reihenfolge)
);
CREATE INDEX idx_lagebericht_verteiler_einsatz ON lagebericht_verteiler(einsatz_id);
