-- LLH-1629: Sprechgruppen aus dem Katalog der Org am Spiegel (Folge zu LLH-1492, design.md der
-- Change `polrv1lt-spiegel-antraege`, Nachtrag „Katalog-Sprechgruppen“). Rein additiv.
--
-- Ein Einsatz darf Sprechgruppen aus dem Katalog der Org nutzen (`sprechgruppe.einsatz_id IS
-- NULL`). Der Führer liefert jede genutzte Katalogzeile mit; der Spiegel nimmt ihr Gegenstück aus
-- dem eigenen Katalog oder legt eine Kopie als Sprechgruppe des Spiegels an
-- (`instanz::spiegel::katalog`).

-- Katalogzeilen, die ein Spiegel mitbenutzt: wie die Katalogzeile des Führers am Spiegel heißt.
-- Anders als `spiegel_herkunft` darf dieselbe lokale Zeile zu mehreren Spiegeln gehören (ein
-- Katalog, viele Einsätze); die Zeile selbst gehört keinem Spiegel und wird von ihm nie geändert
-- oder gelöscht. Eine Kopie steht dagegen in `spiegel_herkunft`.
CREATE TABLE spiegel_katalog (
    einsatz_id         INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    art                TEXT NOT NULL,
    fremder_schluessel TEXT NOT NULL,
    lokaler_schluessel TEXT NOT NULL,
    PRIMARY KEY (einsatz_id, art, fremder_schluessel)
);

-- Ein Absender vor LLH-1629 liefert die Katalogzeile nicht mit; der Spiegel rückt dann über die
-- Zuordnungen ohne Bezug hinweg und merkt sich hier den Stand der ersten. Liefert der Absender nach
-- seinem Update, setzt der Spiegel seinen Stand darauf zurück und bekommt sie erneut.
ALTER TABLE einsatz_spiegel ADD COLUMN katalog_ab INTEGER;

-- Ändert sich eine Katalog-Sprechgruppe, kommt sie ins Änderungslog jedes Einsatzes, der sie
-- nutzt, damit eine Kopie am Spiegel nachzieht. Die Liste der Verweise prüft der Wächter
-- `instanz::spiegel::katalog::tests::der_log_trigger_kennt_jeden_verweis_auf_sprechgruppen`.
-- Katalogzeilen werden nur deaktiviert (`aktiv = 0`), nie gelöscht.
CREATE TRIGGER sprechgruppe_spiegelkatalog_u AFTER UPDATE ON sprechgruppe
WHEN OLD.einsatz_id IS NULL AND NEW.einsatz_id IS NULL BEGIN
    DELETE FROM einsatz_aenderung WHERE art = 'sprechgruppe' AND schluessel = CAST(NEW.id AS TEXT)
        AND einsatz_id IN (
            SELECT einsatz_id FROM einsatz_fuehrungsstelle_sprechgruppe WHERE sprechgruppe_id = NEW.id
            UNION SELECT a.einsatz_id FROM einsatzabschnitt_sprechgruppe x
                JOIN einsatzabschnitt a ON a.id = x.abschnitt_id WHERE x.sprechgruppe_id = NEW.id
            UNION SELECT h.einsatz_id FROM einsatz_einheit_sprechgruppe x
                JOIN einsatz_einheit h ON h.id = x.einheit_id WHERE x.sprechgruppe_id = NEW.id
            UNION SELECT s.einsatz_id FROM einsatz_kommunikation_stelle_sprechgruppe x
                JOIN einsatz_kommunikation_stelle s ON s.id = x.stelle_id WHERE x.sprechgruppe_id = NEW.id
            UNION SELECT k.einsatz_id FROM fernmeldeskizze_komponente_sprechgruppe x
                JOIN fernmeldeskizze_komponente k ON k.id = x.komponente_id WHERE x.sprechgruppe_id = NEW.id
            UNION SELECT einsatz_id FROM fernmeldeskizze_lage WHERE element = 'sg-' || NEW.id
        );
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel)
        SELECT e.id, 'sprechgruppe', CAST(NEW.id AS TEXT) FROM einsatz e WHERE e.id IN (
            SELECT einsatz_id FROM einsatz_fuehrungsstelle_sprechgruppe WHERE sprechgruppe_id = NEW.id
            UNION SELECT a.einsatz_id FROM einsatzabschnitt_sprechgruppe x
                JOIN einsatzabschnitt a ON a.id = x.abschnitt_id WHERE x.sprechgruppe_id = NEW.id
            UNION SELECT h.einsatz_id FROM einsatz_einheit_sprechgruppe x
                JOIN einsatz_einheit h ON h.id = x.einheit_id WHERE x.sprechgruppe_id = NEW.id
            UNION SELECT s.einsatz_id FROM einsatz_kommunikation_stelle_sprechgruppe x
                JOIN einsatz_kommunikation_stelle s ON s.id = x.stelle_id WHERE x.sprechgruppe_id = NEW.id
            UNION SELECT k.einsatz_id FROM fernmeldeskizze_komponente_sprechgruppe x
                JOIN fernmeldeskizze_komponente k ON k.id = x.komponente_id WHERE x.sprechgruppe_id = NEW.id
            UNION SELECT einsatz_id FROM fernmeldeskizze_lage WHERE element = 'sg-' || NEW.id
        );
END;
