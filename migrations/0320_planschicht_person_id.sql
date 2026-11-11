-- LLH-1630: `einsatz_planschicht_person` bekommt einen Primärschlüssel `id`.
--
-- Die Tabelle war die einzige gespiegelte ohne Primärschlüssel (0277). Ihr Schlüssel im
-- Änderungslog und in `spiegel_herkunft` war deshalb die rowid, und die darf ein `VACUUM` neu
-- vergeben: danach zeigte die Herkunft am Spiegel auf eine andere Zeile. `id INTEGER PRIMARY KEY`
-- ist ein Alias der rowid, den `VACUUM` nicht anfasst.
--
-- Neubau: Die alten rowids werden zu `id`, Log und Herkunft passen also weiter, ohne dass eine
-- Zeile neu geliefert wird. Die Tabelle ist Blatt (keine Tabelle verweist auf sie), deshalb ohne
-- `PRAGMA foreign_keys`. Spalten, CHECK und Indizes wie 0277 und 0294; die Log- und
-- Schutz-Trigger aus 0314 kommen wieder dazu, jetzt mit `id` statt `rowid`
-- (`instanz::spiegel::art::trigger_sql`, Wächter `art::tests::trigger_passen_zur_beschreibung`).
-- Abgesichert von db::tests::migration_0318_planschicht_person_id.

CREATE TABLE einsatz_planschicht_person_neu (
    id                  INTEGER PRIMARY KEY,
    planschicht_id      INTEGER NOT NULL REFERENCES einsatz_planschicht(id) ON DELETE CASCADE,
    personal_id         INTEGER REFERENCES personal(id),
    einsatz_personal_id INTEGER REFERENCES einsatz_personal(id) ON DELETE CASCADE,
    helfer_id           INTEGER REFERENCES einsatz_plan_helfer(id) ON DELETE CASCADE,
    CHECK ((personal_id IS NOT NULL) + (einsatz_personal_id IS NOT NULL)
        + (helfer_id IS NOT NULL) = 1)
);

INSERT INTO einsatz_planschicht_person_neu
    (id, planschicht_id, personal_id, einsatz_personal_id, helfer_id)
    SELECT rowid, planschicht_id, personal_id, einsatz_personal_id, helfer_id
    FROM einsatz_planschicht_person;

DROP TABLE einsatz_planschicht_person;
ALTER TABLE einsatz_planschicht_person_neu RENAME TO einsatz_planschicht_person;

CREATE UNIQUE INDEX uq_planschicht_person_stamm
    ON einsatz_planschicht_person(planschicht_id, personal_id) WHERE personal_id IS NOT NULL;
CREATE UNIQUE INDEX uq_planschicht_person_einsatz
    ON einsatz_planschicht_person(planschicht_id, einsatz_personal_id)
    WHERE einsatz_personal_id IS NOT NULL;
CREATE UNIQUE INDEX uq_planschicht_person_helfer
    ON einsatz_planschicht_person(planschicht_id, helfer_id) WHERE helfer_id IS NOT NULL;
CREATE INDEX idx_planschicht_person_stamm ON einsatz_planschicht_person(personal_id);
CREATE INDEX idx_planschicht_person_einsatz ON einsatz_planschicht_person(einsatz_personal_id);
CREATE INDEX idx_planschicht_person_helfer ON einsatz_planschicht_person(helfer_id);
CREATE INDEX idx_planschicht_person_block ON einsatz_planschicht_person(planschicht_id);

CREATE TRIGGER einsatz_planschicht_person_spiegellog_i AFTER INSERT ON einsatz_planschicht_person WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = (SELECT einsatz_id FROM einsatz_planschicht WHERE id = NEW.planschicht_id)) BEGIN
    DELETE FROM einsatz_aenderung WHERE einsatz_id = (SELECT einsatz_id FROM einsatz_planschicht WHERE id = NEW.planschicht_id) AND art = 'einsatz_planschicht_person' AND schluessel = CAST(NEW.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES ((SELECT einsatz_id FROM einsatz_planschicht WHERE id = NEW.planschicht_id), 'einsatz_planschicht_person', CAST(NEW.id AS TEXT));
END;
CREATE TRIGGER einsatz_planschicht_person_spiegellog_u AFTER UPDATE ON einsatz_planschicht_person BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'einsatz_planschicht_person' AND ((einsatz_id = (SELECT einsatz_id FROM einsatz_planschicht WHERE id = OLD.planschicht_id) AND schluessel = CAST(OLD.id AS TEXT)) OR (einsatz_id = (SELECT einsatz_id FROM einsatz_planschicht WHERE id = NEW.planschicht_id) AND schluessel = CAST(NEW.id AS TEXT)));
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT (SELECT einsatz_id FROM einsatz_planschicht WHERE id = OLD.planschicht_id), 'einsatz_planschicht_person', CAST(OLD.id AS TEXT) WHERE (CAST(OLD.id AS TEXT) IS NOT CAST(NEW.id AS TEXT) OR (SELECT einsatz_id FROM einsatz_planschicht WHERE id = OLD.planschicht_id) IS NOT (SELECT einsatz_id FROM einsatz_planschicht WHERE id = NEW.planschicht_id)) AND EXISTS (SELECT 1 FROM einsatz WHERE id = (SELECT einsatz_id FROM einsatz_planschicht WHERE id = OLD.planschicht_id));
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT (SELECT einsatz_id FROM einsatz_planschicht WHERE id = NEW.planschicht_id), 'einsatz_planschicht_person', CAST(NEW.id AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = (SELECT einsatz_id FROM einsatz_planschicht WHERE id = NEW.planschicht_id));
END;
CREATE TRIGGER einsatz_planschicht_person_spiegellog_d AFTER DELETE ON einsatz_planschicht_person BEGIN
    DELETE FROM einsatz_aenderung WHERE einsatz_id = COALESCE((SELECT einsatz_id FROM einsatz_planschicht WHERE id = OLD.planschicht_id), (SELECT einsatz_id FROM einsatz_aenderung WHERE art = 'einsatz_planschicht' AND schluessel = CAST(OLD.planschicht_id AS TEXT) ORDER BY stand DESC LIMIT 1)) AND art = 'einsatz_planschicht_person' AND schluessel = CAST(OLD.id AS TEXT);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT COALESCE((SELECT einsatz_id FROM einsatz_planschicht WHERE id = OLD.planschicht_id), (SELECT einsatz_id FROM einsatz_aenderung WHERE art = 'einsatz_planschicht' AND schluessel = CAST(OLD.planschicht_id AS TEXT) ORDER BY stand DESC LIMIT 1)), 'einsatz_planschicht_person', CAST(OLD.id AS TEXT) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = COALESCE((SELECT einsatz_id FROM einsatz_planschicht WHERE id = OLD.planschicht_id), (SELECT einsatz_id FROM einsatz_aenderung WHERE art = 'einsatz_planschicht' AND schluessel = CAST(OLD.planschicht_id AS TEXT) ORDER BY stand DESC LIMIT 1)));
END;
CREATE TRIGGER einsatz_planschicht_person_spiegelschutz_i BEFORE INSERT ON einsatz_planschicht_person WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = (SELECT einsatz_id FROM einsatz_planschicht WHERE id = NEW.planschicht_id)) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER einsatz_planschicht_person_spiegelschutz_u BEFORE UPDATE ON einsatz_planschicht_person WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND (EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = (SELECT einsatz_id FROM einsatz_planschicht WHERE id = OLD.planschicht_id)) OR EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = (SELECT einsatz_id FROM einsatz_planschicht WHERE id = NEW.planschicht_id))) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER einsatz_planschicht_person_spiegelschutz_d BEFORE DELETE ON einsatz_planschicht_person WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = (SELECT einsatz_id FROM einsatz_planschicht WHERE id = OLD.planschicht_id)) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
