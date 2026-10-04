-- LFH-849: die eigene Führungsstelle (ELW, Einsatzleitung) als Gegenstelle des Funkplans.
--
-- Eine Zeile je Einsatz, lazy beim ersten PATCH angelegt; fehlt sie, gilt die Führungsstelle als
-- nicht erfasst. Nicht zu verwechseln mit `einsatz_mitgliedschaft.fuehrungsstelle` (0100), dem
-- Freitext je Person. Die Sprechgruppen hängen wie an Abschnitt und Einheit (0073) über eine
-- M:N-Zuordnung; `erreichbarkeit` ist personenbezogen und wird geschwärzt
-- (`einsatz::schwaerzung_registry`).
--
-- Herleitung: openspec/changes/archive/2026-10-04-lfh-849-eigene-fuehrungsstelle/design.md (D2).
CREATE TABLE einsatz_fuehrungsstelle (
    einsatz_id           INTEGER PRIMARY KEY REFERENCES einsatz(id) ON DELETE CASCADE,
    rufname              TEXT,
    kommunikationsmittel TEXT,
    erreichbarkeit       TEXT
);

CREATE TABLE einsatz_fuehrungsstelle_sprechgruppe (
    einsatz_id      INTEGER NOT NULL REFERENCES einsatz(id)      ON DELETE CASCADE,
    sprechgruppe_id INTEGER NOT NULL REFERENCES sprechgruppe(id) ON DELETE CASCADE,
    PRIMARY KEY (einsatz_id, sprechgruppe_id)
);
