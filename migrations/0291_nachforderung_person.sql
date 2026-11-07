-- LLH-1573 (Konzept LLH-1562, Abschnitt 5.5; Change `n12q80rt-rettungsmittel-anfordern`,
-- design.md D1): Rettungsmittel für einen Patienten anfordern.
--
-- `person_id`: die Person, für die angefordert wurde. Eine Person kann mehrere Nachforderungen
-- haben (RTW abgelehnt, dann neu), eine Nachforderung höchstens eine Person. Gesetzt nur beim
-- Anlegen (D2); mit Bezug gilt Anzahl 1 und kein Stellenbezug daneben (Handler, 422). Die Person
-- wird nie hart gelöscht (Storno); SET NULL trifft nur den Einsatz-Purge.
--
-- `leitstelle_einsatznummer`: Einsatznummer der Leitstelle aus der Zusage (D5), Freitext wie am
-- Verbleib (LLH-1568, Grenze im Handler). Belegt den Verbleib „Transport“ beim Eintreffen vor (D6).
--
-- Aufbewahrung: `person_id` ist ein Verweis (retain wie `betreuungsstelle_id`), die Einsatznummer
-- wird geschwärzt (`einsatz::schwaerzung_registry`). Rein additiv per ADD COLUMN, nullable, kein
-- Backfill. Abgesichert von db::tests::migration_0291_*.
ALTER TABLE nachforderung ADD COLUMN person_id INTEGER
    REFERENCES einsatz_person(id) ON DELETE SET NULL;
ALTER TABLE nachforderung ADD COLUMN leitstelle_einsatznummer TEXT;

CREATE INDEX idx_nachforderung_person ON nachforderung(person_id)
    WHERE person_id IS NOT NULL;
