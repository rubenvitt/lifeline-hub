-- LLH-1261: Material-Positionen einer Einheiten-Vorlage. Stamm-Material mit Menge und Ort: die
-- Einheit der Vorlage (`fahrzeug_id` NULL) oder ein Fahrzeug derselben Vorlage (prüft Rust,
-- 422). Disponiert wird erst beim Bilden im Einsatz (`einheit::aus_vorlage`).
--
-- Ersatzschlüssel statt (vorlage_id, material_id): dasselbe Material darf in einer Vorlage
-- mehrfach stehen, etwa ein Rucksack auf jedem RTW. Ein Gerät mit Bestandsnummer steht höchstens
-- einmal im Vorlagen-Baum (prüft Rust, 422).
--
-- Fremdschlüssel wie 0190: CASCADE nur an der Vorlage, `material` und `fahrzeug` NO ACTION, damit
-- der Demo-Löschweg „noch verwiesen“ über den Fremdschlüsselfehler erkennt.

CREATE TABLE einheit_vorlage_material (
    id          INTEGER PRIMARY KEY,
    vorlage_id  INTEGER NOT NULL REFERENCES einheit_vorlage(id) ON DELETE CASCADE,
    material_id INTEGER NOT NULL REFERENCES material(id),
    menge       INTEGER NOT NULL CHECK (menge >= 1),
    fahrzeug_id INTEGER REFERENCES fahrzeug(id),
    sortier     INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_einheit_vorlage_material_vorlage ON einheit_vorlage_material(vorlage_id);
CREATE INDEX idx_einheit_vorlage_material_material ON einheit_vorlage_material(material_id);
CREATE INDEX idx_einheit_vorlage_material_fahrzeug ON einheit_vorlage_material(fahrzeug_id);
