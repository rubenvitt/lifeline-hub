-- LLH-1655 (Change umeqho2b-outbox-ereignis-abruf, design.md D5 bis D7): die Trigger, die die
-- Outbox `maschine_ereignis` füllen. Jede Zeile entsteht hier, in der Transaktion der Änderung
-- und je Zugang, für den der Einsatz freigegeben ist (`maschinenzugang_freigabe`, LLH-1638);
-- kein Schreibweg in Rust schreibt in die Tabelle.
--
-- `lage.changed` ist verdichtet: je Zugang und Einsatz höchstens eine Zeile, die neue ersetzt
-- die alte und trägt eine höhere Nummer. Ein Leser, der die alte schon hat, sieht die neue;
-- einer, der sie noch nicht hat, verliert nichts.
--
-- Zwei Listen stehen auch in Rust und werden gegen diese Datei geprüft
-- (`tests/public_api_ereignis_trigger.rs`): die Kopfspalten
-- (`public_api::einsaetze::KOPF_SPALTEN`) und die Lage-Tabellen
-- (`public_api::events::LAGE_ARTEN`). Wer eine Liste ändert, baut den Trigger in einer neuen
-- Migration neu.

-- Freigabe erteilt: der Einsatz wird für den Zugang lesbar.
CREATE TRIGGER maschinenzugang_freigabe_ereignis_i AFTER INSERT ON maschinenzugang_freigabe
WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id AND status = 'aktiv')
BEGIN
    INSERT INTO maschine_ereignis (zugang_id, type, einsatz_id)
        VALUES (NEW.zugang_id, 'einsatz.created', NEW.einsatz_id);
    DELETE FROM maschine_ereignis
        WHERE type = 'lage.changed' AND einsatz_id = NEW.einsatz_id AND zugang_id = NEW.zugang_id;
    INSERT INTO maschine_ereignis (zugang_id, type, einsatz_id)
        VALUES (NEW.zugang_id, 'lage.changed', NEW.einsatz_id);
END;

-- Freigabe beendet, solange der Einsatz läuft: zurückgenommen, umgestellt (Löschen und Einfügen
-- in `public_api::freigabe::freigeben_tx`), Zugang widerrufen oder Recht entzogen. Nach einem
-- Abschluss schreibt der Trigger nichts: das Ende hat `einsatz_ereignis_ende` schon gemeldet.
-- Fällt die Zeile mit ihrem Zugang (Kaskade), gibt es niemanden mehr, dem etwas zu melden wäre.
CREATE TRIGGER maschinenzugang_freigabe_ereignis_d AFTER DELETE ON maschinenzugang_freigabe
WHEN EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id AND status = 'aktiv')
 AND EXISTS (SELECT 1 FROM maschinenzugang WHERE id = OLD.zugang_id)
BEGIN
    INSERT INTO maschine_ereignis (zugang_id, type, einsatz_id)
        VALUES (OLD.zugang_id, 'einsatz.closed', OLD.einsatz_id);
    DELETE FROM maschine_ereignis
        WHERE type = 'lage.changed' AND einsatz_id = OLD.einsatz_id AND zugang_id = OLD.zugang_id;
    INSERT INTO maschine_ereignis (zugang_id, type, einsatz_id)
        VALUES (OLD.zugang_id, 'lage.changed', OLD.einsatz_id);
END;

-- Eine Freigabe-Zeile zeigt auf einen anderen Einsatz oder Zugang. Heute stellt kein Schreibweg
-- so um; der Trigger hält die Outbox richtig, falls einer es künftig per UPDATE oder Upsert tut.
-- (`INSERT OR REPLACE` bliebe falsch: es löscht ohne DELETE-Trigger.)
CREATE TRIGGER maschinenzugang_freigabe_ereignis_u
AFTER UPDATE OF einsatz_id, zugang_id ON maschinenzugang_freigabe
WHEN OLD.einsatz_id IS NOT NEW.einsatz_id OR OLD.zugang_id IS NOT NEW.zugang_id
BEGIN
    INSERT INTO maschine_ereignis (zugang_id, type, einsatz_id)
        SELECT OLD.zugang_id, 'einsatz.closed', OLD.einsatz_id
        WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id AND status = 'aktiv');
    DELETE FROM maschine_ereignis
        WHERE type = 'lage.changed' AND einsatz_id = OLD.einsatz_id AND zugang_id = OLD.zugang_id
          AND EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id AND status = 'aktiv');
    INSERT INTO maschine_ereignis (zugang_id, type, einsatz_id)
        SELECT OLD.zugang_id, 'lage.changed', OLD.einsatz_id
        WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = OLD.einsatz_id AND status = 'aktiv');
    INSERT INTO maschine_ereignis (zugang_id, type, einsatz_id)
        SELECT NEW.zugang_id, 'einsatz.created', NEW.einsatz_id
        WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id AND status = 'aktiv');
    DELETE FROM maschine_ereignis
        WHERE type = 'lage.changed' AND einsatz_id = NEW.einsatz_id AND zugang_id = NEW.zugang_id
          AND EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id AND status = 'aktiv');
    INSERT INTO maschine_ereignis (zugang_id, type, einsatz_id)
        SELECT NEW.zugang_id, 'lage.changed', NEW.einsatz_id
        WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id AND status = 'aktiv');
END;

-- Ein Feld des Einsatzkopfs hat sich geändert. `UPDATE OF` feuert schon, wenn die Spalte im SET
-- steht (die Spiegel-Übernahme setzt alle); deshalb der Vergleich je Spalte.
CREATE TRIGGER einsatz_ereignis_kopf
AFTER UPDATE OF einsatznummer_intern, bezeichnung, stichwort, einsatzart, leitstellen_nr,
    einsatzort, einsatzort_lat, einsatzort_lon, begonnen_at ON einsatz
WHEN NEW.status = 'aktiv' AND (
       OLD.einsatznummer_intern IS NOT NEW.einsatznummer_intern
    OR OLD.bezeichnung IS NOT NEW.bezeichnung
    OR OLD.stichwort IS NOT NEW.stichwort
    OR OLD.einsatzart IS NOT NEW.einsatzart
    OR OLD.leitstellen_nr IS NOT NEW.leitstellen_nr
    OR OLD.einsatzort IS NOT NEW.einsatzort
    OR OLD.einsatzort_lat IS NOT NEW.einsatzort_lat
    OR OLD.einsatzort_lon IS NOT NEW.einsatzort_lon
    OR OLD.begonnen_at IS NOT NEW.begonnen_at)
BEGIN
    INSERT INTO maschine_ereignis (zugang_id, type, einsatz_id)
        SELECT zugang_id, 'einsatz.updated', NEW.id
        FROM maschinenzugang_freigabe WHERE einsatz_id = NEW.id;
END;

-- Die Kopffelder, die in die Lage einfließen.
CREATE TRIGGER einsatz_ereignis_lage
AFTER UPDATE OF bezeichnung, stichwort, einsatzart, begonnen_at, einsatzort_lat, einsatzort_lon
    ON einsatz
WHEN NEW.status = 'aktiv' AND (
       OLD.bezeichnung IS NOT NEW.bezeichnung
    OR OLD.stichwort IS NOT NEW.stichwort
    OR OLD.einsatzart IS NOT NEW.einsatzart
    OR OLD.begonnen_at IS NOT NEW.begonnen_at
    OR OLD.einsatzort_lat IS NOT NEW.einsatzort_lat
    OR OLD.einsatzort_lon IS NOT NEW.einsatzort_lon)
BEGIN
    DELETE FROM maschine_ereignis
        WHERE type = 'lage.changed' AND einsatz_id = NEW.id
          AND zugang_id IN (SELECT zugang_id FROM maschinenzugang_freigabe WHERE einsatz_id = NEW.id);
    INSERT INTO maschine_ereignis (zugang_id, type, einsatz_id)
        SELECT zugang_id, 'lage.changed', NEW.id
        FROM maschinenzugang_freigabe WHERE einsatz_id = NEW.id;
END;

-- Der Einsatz läuft nicht mehr. Der Abschluss über die Oberfläche löscht die Freigaben danach in
-- derselben Transaktion; kommt er über den Spiegel, bleiben sie stehen und sind nur unwirksam.
CREATE TRIGGER einsatz_ereignis_ende AFTER UPDATE OF status ON einsatz
WHEN OLD.status = 'aktiv' AND NEW.status IS NOT 'aktiv'
BEGIN
    INSERT INTO maschine_ereignis (zugang_id, type, einsatz_id)
        SELECT zugang_id, 'einsatz.closed', NEW.id
        FROM maschinenzugang_freigabe WHERE einsatz_id = NEW.id;
    DELETE FROM maschine_ereignis
        WHERE type = 'lage.changed' AND einsatz_id = NEW.id
          AND zugang_id IN (SELECT zugang_id FROM maschinenzugang_freigabe WHERE einsatz_id = NEW.id);
    INSERT INTO maschine_ereignis (zugang_id, type, einsatz_id)
        SELECT zugang_id, 'lage.changed', NEW.id
        FROM maschinenzugang_freigabe WHERE einsatz_id = NEW.id;
END;

-- Der Einsatz wird gelöscht: seine Zeilen gehen mit. Lief er noch (Demo-Daten entfernen,
-- Abräumen), bleibt sein Ende als Ereignis. BEFORE, weil die Kaskade die Freigaben danach nimmt.
CREATE TRIGGER einsatz_ereignis_d BEFORE DELETE ON einsatz
BEGIN
    DELETE FROM maschine_ereignis WHERE einsatz_id = OLD.id;
    INSERT INTO maschine_ereignis (zugang_id, type, einsatz_id)
        SELECT zugang_id, 'einsatz.closed', OLD.id
        FROM maschinenzugang_freigabe WHERE einsatz_id = OLD.id AND OLD.status = 'aktiv';
    INSERT INTO maschine_ereignis (zugang_id, type, einsatz_id)
        SELECT zugang_id, 'lage.changed', OLD.id
        FROM maschinenzugang_freigabe WHERE einsatz_id = OLD.id AND OLD.status = 'aktiv';
END;

-- Eine Tabelle, aus der die Lage für Fremdsysteme entsteht, hat sich geändert. Das Änderungslog
-- `einsatz_aenderung` (0314) bekommt bei jeder Änderung einer gespiegelten Einsatztabelle eine
-- Zeile, in deren Transaktion; hier hängt die Outbox daran.
CREATE TRIGGER einsatz_aenderung_ereignis_i AFTER INSERT ON einsatz_aenderung
WHEN NEW.art IN ('einsatz_person', 'einsatz_lagekennzahl_wahl', 'einsatz_personal',
                 'einsatz_einheit', 'uhs', 'uhs_platz', 'lagebericht', 'lage_zone',
                 'einsatzabschnitt', 'freies_zeichen', 'meldung', 'kommunikation_status')
 AND EXISTS (SELECT 1 FROM einsatz WHERE id = NEW.einsatz_id AND status = 'aktiv')
BEGIN
    DELETE FROM maschine_ereignis
        WHERE type = 'lage.changed' AND einsatz_id = NEW.einsatz_id
          AND zugang_id IN (SELECT zugang_id FROM maschinenzugang_freigabe
                            WHERE einsatz_id = NEW.einsatz_id);
    INSERT INTO maschine_ereignis (zugang_id, type, einsatz_id)
        SELECT zugang_id, 'lage.changed', NEW.einsatz_id
        FROM maschinenzugang_freigabe WHERE einsatz_id = NEW.einsatz_id;
END;
