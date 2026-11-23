-- LLH-2064: Eine Führungsfunktion tragen nur Einsatzleitung und Führungspersonal.
--
-- Entwurf: docs/superpowers/specs/2026-11-22-u195f4et-funktion-nur-mit-schreibrecht-design.md (D1, D3).
-- Neubau wie 0358: einsatz_mitgliedschaft ist ein Blatt (keine Tabelle verweist darauf), also
-- ohne `-- no-transaction`, in der Transaktion der Migration. Schema = 0358 plus der Tabellen-
-- CHECK „Funktion nur in der Führung“. Index und die sechs Spiegel-Trigger fallen mit dem DROP
-- und werden wortgleich aus 0358 neu angelegt.
--
-- Bereinigung im INSERT … SELECT: Mitarbeit und Beobachter verlieren den Code; die Angabe bleibt
-- als Freitext, genau wie `fuehrung::Funktionsangabe::as_freitext` (EL/S1–S7 → Kürzel, FHP/FB →
-- „<Standardlabel>: <Bezeichnung>“, ohne Bezeichnung nur das Label, auf 200 Zeichen gekürzt). In
-- einem geschwärzten Einsatz fällt nur der Code weg; Text kommt nie in eine geschwärzte Spalte.
-- Der Neubau schreibt nichts ins Änderungsprotokoll (die Trigger hängen an der alten Tabelle).
-- Abgesichert von db::tests::migration_0363_*.

CREATE TABLE einsatz_mitgliedschaft_neu (
    einsatz_id        INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    benutzer_id       INTEGER NOT NULL REFERENCES benutzer(id) ON DELETE CASCADE,
    einsatz_rolle     TEXT NOT NULL
                      CHECK (einsatz_rolle IN ('einsatzleitung', 'fuehrungspersonal', 'mitarbeit',
                                               'beobachter')),
    zugewiesen_at     TEXT NOT NULL DEFAULT (datetime('now')),
    fuehrungsstelle   TEXT,
    fuehrungsfunktion TEXT
                      CHECK (fuehrungsfunktion IN ('el','s1','s2','s3','s4','s5','s6','s7',
                                                   'fuehrungshilfspersonal','fachberater')),
    PRIMARY KEY (einsatz_id, benutzer_id),
    CHECK (fuehrungsfunktion IS NULL OR einsatz_rolle IN ('einsatzleitung', 'fuehrungspersonal'))
);

INSERT INTO einsatz_mitgliedschaft_neu
    (einsatz_id, benutzer_id, einsatz_rolle, zugewiesen_at, fuehrungsstelle, fuehrungsfunktion)
    SELECT m.einsatz_id, m.benutzer_id, m.einsatz_rolle, m.zugewiesen_at,
           CASE
               WHEN m.fuehrungsfunktion IS NULL
                    OR m.einsatz_rolle IN ('einsatzleitung', 'fuehrungspersonal')
                   THEN m.fuehrungsstelle
               WHEN e.geschwaerzt_at IS NOT NULL THEN NULL
               WHEN m.fuehrungsfunktion IN ('fuehrungshilfspersonal', 'fachberater') THEN
                   substr(
                       CASE m.fuehrungsfunktion
                           WHEN 'fachberater' THEN 'Fachberater'
                           ELSE 'Führungshilfspersonal'
                       END || COALESCE(': ' || m.fuehrungsstelle, ''),
                       1, 200)
               ELSE upper(m.fuehrungsfunktion)
           END,
           CASE
               WHEN m.einsatz_rolle IN ('einsatzleitung', 'fuehrungspersonal')
                   THEN m.fuehrungsfunktion
           END
    FROM einsatz_mitgliedschaft m JOIN einsatz e ON e.id = m.einsatz_id;

DROP TABLE einsatz_mitgliedschaft;

ALTER TABLE einsatz_mitgliedschaft_neu RENAME TO einsatz_mitgliedschaft;

CREATE INDEX idx_mitgliedschaft_benutzer ON einsatz_mitgliedschaft(benutzer_id);

CREATE TRIGGER einsatz_mitgliedschaft_spiegellog_i AFTER INSERT ON einsatz_mitgliedschaft WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id) BEGIN
    DELETE FROM einsatz_aenderung WHERE einsatz_id = NEW.einsatz_id AND art = 'einsatz_mitgliedschaft' AND schluessel = json_array(NEW.einsatz_id, NEW.benutzer_id);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES (NEW.einsatz_id, 'einsatz_mitgliedschaft', json_array(NEW.einsatz_id, NEW.benutzer_id));
END;
CREATE TRIGGER einsatz_mitgliedschaft_spiegellog_u AFTER UPDATE ON einsatz_mitgliedschaft BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'einsatz_mitgliedschaft' AND ((einsatz_id = OLD.einsatz_id AND schluessel = json_array(OLD.einsatz_id, OLD.benutzer_id)) OR (einsatz_id = NEW.einsatz_id AND schluessel = json_array(NEW.einsatz_id, NEW.benutzer_id)));
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'einsatz_mitgliedschaft', json_array(OLD.einsatz_id, OLD.benutzer_id) WHERE (json_array(OLD.einsatz_id, OLD.benutzer_id) IS NOT json_array(NEW.einsatz_id, NEW.benutzer_id) OR OLD.einsatz_id IS NOT NEW.einsatz_id) AND EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT NEW.einsatz_id, 'einsatz_mitgliedschaft', json_array(NEW.einsatz_id, NEW.benutzer_id) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id);
END;
CREATE TRIGGER einsatz_mitgliedschaft_spiegellog_d AFTER DELETE ON einsatz_mitgliedschaft BEGIN
    DELETE FROM einsatz_aenderung WHERE einsatz_id = OLD.einsatz_id AND art = 'einsatz_mitgliedschaft' AND schluessel = json_array(OLD.einsatz_id, OLD.benutzer_id);
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT OLD.einsatz_id, 'einsatz_mitgliedschaft', json_array(OLD.einsatz_id, OLD.benutzer_id) WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id);
END;
CREATE TRIGGER einsatz_mitgliedschaft_spiegelschutz_i BEFORE INSERT ON einsatz_mitgliedschaft WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER einsatz_mitgliedschaft_spiegelschutz_u BEFORE UPDATE ON einsatz_mitgliedschaft WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND (EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) OR EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = NEW.einsatz_id)) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
CREATE TRIGGER einsatz_mitgliedschaft_spiegelschutz_d BEFORE DELETE ON einsatz_mitgliedschaft WHEN NOT EXISTS (SELECT 1 FROM spiegel_uebernahme) AND EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = OLD.einsatz_id) BEGIN SELECT RAISE(ABORT, 'einsatz_ist_spiegel'); END;
