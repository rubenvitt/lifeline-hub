-- LLH-1612 (Change `hitr91ob-registrierstelle-betreuung`): Registrierstelle in der Betreuung.
--
-- - `haushalt`: Personen, die zusammen ankommen. `nummer` fortlaufend je Einsatz („H-1“), die
--   Bezugsperson ist die erste Person bei der Anlage (design.md D3). Der Haushalt kennt keine
--   Stelle und keine Adresse: beides steht an der Person.
-- - `einsatz_person.haushalt_id`, `kostform` (der Satz der Sonderkost der Verpflegung plus
--   `normal`, NULL = keine Angabe) und `unvertraeglichkeiten` (Gesundheitsangabe, Kategorie
--   „Behandlung“, design.md D4).
-- - `betreuungsstelle.belegungsart`: `gezaehlt` (Belegung wird gemeldet, wie bisher) oder
--   `namentlich` (der Server meldet sie aus den Registrierten, design.md D5).
-- - `betreuungsstelle_belegung.quelle`: `meldung` (von Hand) oder `registrierung` (vom Server
--   an einer namentlich geführten Stelle).
--
-- Alle Vorgaben lassen den Bestand unverändert. Abgesichert von
-- db::tests::migration_0310_registrierstelle.
CREATE TABLE haushalt (
    id              INTEGER PRIMARY KEY,
    einsatz_id      INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    nummer          INTEGER NOT NULL CHECK (nummer >= 1),
    bezugsperson_id INTEGER REFERENCES einsatz_person(id) ON DELETE SET NULL,
    angelegt_at     TEXT    NOT NULL DEFAULT (datetime('now')),
    angelegt_von_id INTEGER NOT NULL REFERENCES benutzer(id),
    UNIQUE (einsatz_id, nummer)
);

ALTER TABLE einsatz_person ADD COLUMN haushalt_id INTEGER
    REFERENCES haushalt(id) ON DELETE SET NULL;
ALTER TABLE einsatz_person ADD COLUMN kostform TEXT
    CHECK (kostform IS NULL OR kostform IN ('normal', 'vegetarisch', 'vegan', 'ohne_schwein',
                                            'diaet_allergenarm', 'saeugling_kleinkind'));
ALTER TABLE einsatz_person ADD COLUMN unvertraeglichkeiten TEXT;
CREATE INDEX idx_einsatz_person_haushalt ON einsatz_person(haushalt_id)
    WHERE haushalt_id IS NOT NULL;

ALTER TABLE betreuungsstelle ADD COLUMN belegungsart TEXT NOT NULL DEFAULT 'gezaehlt'
    CHECK (belegungsart IN ('gezaehlt', 'namentlich'));

ALTER TABLE betreuungsstelle_belegung ADD COLUMN quelle TEXT NOT NULL DEFAULT 'meldung'
    CHECK (quelle IN ('meldung', 'registrierung'));
