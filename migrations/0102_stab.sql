-- LFH-46: Führungsorganisation (Besetzung S1–S6) und Lagebesprechungen einer Einsatzleitung
-- der Führungsstufe B/C. Sachgebiete sind Aufgabenzuordnungen (FwDV 100 Anlage 2), keine
-- Rechte- und keine Arbeitsplatzachse. Keine Zeile = „nicht vergeben"; Wechsel werden
-- nicht historisiert, sondern als System-ETB-Eintrag nachgewiesen (Anlage 5).
CREATE TABLE einsatz_stabsfunktion (
    id             INTEGER PRIMARY KEY,
    einsatz_id     INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    sachgebiet     TEXT    NOT NULL CHECK (sachgebiet IN ('s1','s2','s3','s4','s5','s6')),
    -- einsatzleitung = bewusst bei der EL (Zusammenlegung, Anlage 2 S. 54)
    -- personal       = disponierte Person (personal_id + snap_name)
    -- extern         = Person ohne Disposition (bezeichnung = Name)
    -- rueckwaertig   = rückwärtige Stelle, z. B. Leitstelle/FEZ (3.2.2.2 S. 16; bezeichnung = Stelle)
    besetzung_art  TEXT    NOT NULL CHECK (besetzung_art IN ('einsatzleitung','personal','extern','rueckwaertig')),
    personal_id    INTEGER REFERENCES einsatz_personal(id) ON DELETE SET NULL,
    snap_name      TEXT,           -- Name der Person zum Zeitpunkt des Setzens (Führungsnachweis)
    bezeichnung    TEXT,           -- extern/rueckwaertig: Name bzw. Stelle (≤ 200 Zeichen)
    gesetzt_von_id INTEGER NOT NULL REFERENCES benutzer(id),
    gesetzt_at     TEXT    NOT NULL DEFAULT (datetime('now')),
    UNIQUE (einsatz_id, sachgebiet)
);
CREATE INDEX idx_stabsfunktion_einsatz ON einsatz_stabsfunktion(einsatz_id);

-- Eine abgeschlossene Lagebesprechung. Der Entschluss steht im ETB (typ='entscheidung'); die
-- Zeile trägt Nummer, Zeitpunkt und den Termin-Snapshot. Die lebende Terminwahrheit bleibt
-- einsatz.naechste_lagebesprechung_at (LFH-463).
CREATE TABLE einsatz_lagebesprechung (
    id             INTEGER PRIMARY KEY,
    einsatz_id     INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    lfd_nr         INTEGER NOT NULL,
    abgehalten_at  TEXT    NOT NULL,
    entschluss     TEXT    NOT NULL,
    naechste_at    TEXT,           -- Snapshot des beim Abschluss gesetzten Termins
    etb_eintrag_id INTEGER NOT NULL REFERENCES etb_eintrag(id),
    erfasst_von_id INTEGER NOT NULL REFERENCES benutzer(id),
    erfasst_at     TEXT    NOT NULL DEFAULT (datetime('now')),
    UNIQUE (einsatz_id, lfd_nr)
);
CREATE INDEX idx_lagebesprechung_einsatz ON einsatz_lagebesprechung(einsatz_id, abgehalten_at);
