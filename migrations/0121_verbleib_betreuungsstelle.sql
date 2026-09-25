-- LFH-674: Ein Verbleib „Notunterkunft“ kann auf eine Betreuungsstelle verweisen (design.md D1).
--
-- Rein additiv per ADD COLUMN, kein Rebuild: SQLite erlaubt ADD COLUMN … REFERENCES mit dem
-- Vorgabewert NULL. person_verbleib bleibt Leaf (sie verweist, auf sie wird nicht verwiesen).
--
-- ACHTUNG, betreuungsstelle ist damit KEIN Leaf mehr: person_verbleib und einsatz_person
-- verweisen auf sie. Ein künftiger Rebuild der Stellentabelle braucht den FK-Schalter
-- (PRAGMA foreign_keys = OFF, Muster 0082), sonst löst das DROP die SET-NULL-Kaskade aus und
-- die Verweise sind still weg.
--
-- ON DELETE SET NULL: Hart gelöscht wird eine Stelle heute nur über die Einsatz-Kaskade, die
-- beide Seiten ohnehin löscht. Ein blockierender FK würde einen späteren eigenen Löschweg
-- sperren (LFH-237). Stornieren ist Soft-Delete und berührt den Verweis nicht.
-- Kein Backfill: ein alter Freitext wird nicht auf eine Stelle geraten.

ALTER TABLE person_verbleib ADD COLUMN betreuungsstelle_id INTEGER
    REFERENCES betreuungsstelle(id) ON DELETE SET NULL;

-- Cache des jüngsten Verbleibs, gepflegt in derselben Transaktion wie das Ereignis
-- (verbleib_repo::erfassen), neben aktuelle_verbleib_art / aktuelles_verbleib_ziel (0111).
ALTER TABLE einsatz_person ADD COLUMN aktuelle_verbleib_betreuungsstelle_id INTEGER
    REFERENCES betreuungsstelle(id) ON DELETE SET NULL;

-- Für „davon namentlich n“ je Stelle (person::repo::namentlich_je_stelle).
CREATE INDEX idx_einsatz_person_verbleib_stelle
    ON einsatz_person(aktuelle_verbleib_betreuungsstelle_id)
    WHERE aktuelle_verbleib_betreuungsstelle_id IS NOT NULL;
