-- LLH-1494, Teil 2 (Change tkky2noy-archiv-nachbereitung, design.md D9): Archiv am Ende der
-- Nachbereitung. Die Org hinterlegt öffentliche age-Schlüssel; die verwahrende Instanz legt den
-- Einsatz verschlüsselt als gestaffelte Blöcke ab und schwärzt ihren Klartext.

-- Archiv-Empfänger der Org (K6). Nur der öffentliche Schlüssel liegt hier. Ein Empfänger gilt erst
-- mit `geprueft_at`: der Admin hat den an ihn verschlüsselten Code richtig eingegeben. Bis dahin
-- hält die Zeile den Hash des Codes und zählt Fehlversuche. Nicht verteilt: Archive entstehen nur
-- an der verwahrenden Instanz, und dort trägt die Org ihre Schlüssel ein.
CREATE TABLE org_archiv_empfaenger (
    id             INTEGER PRIMARY KEY,
    org_id         INTEGER NOT NULL REFERENCES organisation(id) ON DELETE CASCADE,
    empfaenger     TEXT    NOT NULL,
    bezeichnung    TEXT    NOT NULL,
    fingerabdruck  TEXT    NOT NULL,
    probe_hash     TEXT,
    probe_versuche INTEGER NOT NULL DEFAULT 0,
    geprueft_at    TEXT,
    angelegt_at    TEXT    NOT NULL DEFAULT (datetime('now')),
    angelegt_von   INTEGER REFERENCES benutzer(id) ON DELETE SET NULL,
    UNIQUE (org_id, fingerabdruck)
);

-- Ein Block des Archivs (K3, gestaffelt): der Einsatz, wie er bis `gueltig_bis` aussehen darf;
-- in Block i sind alle Kategorien geschwärzt, deren Frist vor Block i endet. `gueltig_bis` NULL:
-- die Aufbewahrung ist unbegrenzt. Der Inhalt ist age-verschlüsselt an die Empfänger, deren
-- Fingerabdrücke daneben stehen (JSON-Liste). Fällt mit dem Skelett, das aber auf ihn wartet.
CREATE TABLE einsatz_archiv (
    id                         INTEGER PRIMARY KEY,
    einsatz_id                 INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    block                      INTEGER NOT NULL CHECK (block >= 1),
    gueltig_bis                TEXT,
    empfaenger_fingerabdruecke TEXT    NOT NULL,
    groesse                    INTEGER NOT NULL,
    sha256                     TEXT    NOT NULL,
    inhalt                     BLOB    NOT NULL,
    angelegt_at                TEXT    NOT NULL DEFAULT (datetime('now')),
    UNIQUE (einsatz_id, block)
);
