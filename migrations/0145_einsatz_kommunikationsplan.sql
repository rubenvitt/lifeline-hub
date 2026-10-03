-- LFH-848: Kommunikationsplan des S6 (FwDV 100 Anlage 2, S. 60). Verbindungen außerhalb des
-- Funks (Festnetz, Mobil, Fax, E-Mail, Messenger, Melder) je Stelle. Gepflegt werden nur
-- Stellen ohne eigenes Heim: Führungsfunktionen aus dem Katalog (LFH-549) und externe Stellen.
-- Abschnitte und Einheiten tragen ihre Angaben schon selbst (0047, 0086) und werden im Client
-- abgeleitet, nicht hierher kopiert. Die Verbindung gehört der STELLE, nicht einer Person.
--
-- Invarianten im Code (`stab::kommunikation`), kein Mehrspalten-CHECK (Muster
-- `auftrag_empfaenger`): stellenart='funktion' ⇒ funktion gesetzt, Bezeichnung nur bei
-- Führungshilfspersonal/Fachberater (Pflicht); sonst funktion NULL und bezeichnung nicht leer.
-- Herleitung: openspec/changes/lfh-848-kommunikationsplan/design.md (D2).
CREATE TABLE einsatz_kommunikation_stelle (
    id               INTEGER PRIMARY KEY,
    einsatz_id       INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    stellenart       TEXT    NOT NULL CHECK (stellenart IN ('funktion','leitstelle','behoerde',
                                                         'verbindungsperson','sonstige')),
    funktion         TEXT CHECK (funktion IN ('el','s1','s2','s3','s4','s5','s6','s7','fuehrungshilfspersonal','fachberater')),
    bezeichnung      TEXT,             -- ≤ 200 Zeichen; PII möglich (Name einer Verbindungsperson)
    sortier          INTEGER NOT NULL DEFAULT 0,
    geaendert_von_id INTEGER NOT NULL REFERENCES benutzer(id),
    geaendert_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_kommunikation_stelle_einsatz ON einsatz_kommunikation_stelle(einsatz_id);
-- Eine Führungsfunktion je Einsatz höchstens einmal; FHP/FB je Bezeichnung einmal.
CREATE UNIQUE INDEX idx_kommunikation_stelle_funktion
    ON einsatz_kommunikation_stelle(einsatz_id, funktion, COALESCE(bezeichnung, ''))
    WHERE stellenart = 'funktion';

-- einsatz_id ist Redundanz für das Scoping der Schwärzung und das Laden ohne Join; der Handler
-- setzt sie aus der Stelle, nie aus dem Body. sortier ist server-autoritativ (MAX+1 je Stelle).
CREATE TABLE einsatz_kommunikation_verbindung (
    id               INTEGER PRIMARY KEY,
    stelle_id        INTEGER NOT NULL REFERENCES einsatz_kommunikation_stelle(id) ON DELETE CASCADE,
    einsatz_id       INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    mittel           TEXT    NOT NULL CHECK (mittel IN ('festnetz','mobil','fax','email',
                                                     'messenger','melder','sonstiges')),
    wert             TEXT    NOT NULL, -- ≤ 200 Zeichen; Rufnummer/Adresse, PII
    hinweis          TEXT,             -- ≤ 200 Zeichen
    sortier          INTEGER NOT NULL,
    geaendert_von_id INTEGER NOT NULL REFERENCES benutzer(id),
    geaendert_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_kommunikation_verbindung_stelle ON einsatz_kommunikation_verbindung(stelle_id);
CREATE INDEX idx_kommunikation_verbindung_einsatz ON einsatz_kommunikation_verbindung(einsatz_id);
