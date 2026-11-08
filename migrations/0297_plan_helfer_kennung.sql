-- LLH-1556 (Change `kwyb1rwb-schichtplan-datei-einlesen`): Kennung und Herkunft eines Helfers des
-- Plans. Das Einlesen einer Schichtplan-Datei legt neue Personen als Helfer an und vermerkt, woher
-- sie kommen (eine externe Kennung mit dem freien Namen ihrer Quelle, die Vorplanung LLH-1561 mit `vorplanung` und der
-- Kennung ihres Helfers). Ein zweites Einlesen findet den Helfer über dieses Paar wieder und legt
-- ihn nicht noch einmal an.
--
-- Je Einsatz ist das Paar (Herkunft, Kennung) eindeutig; eine fehlende Herkunft zählt als leer.
-- Ohne Kennung gibt es keine Eindeutigkeit (Helfer von Hand, LLH-1552). Längen (je 100 Zeichen)
-- prüft Rust. Abgesichert von db::tests::migration_0297_plan_helfer_kennung.
ALTER TABLE einsatz_plan_helfer ADD COLUMN kennung TEXT;
ALTER TABLE einsatz_plan_helfer ADD COLUMN herkunft TEXT;
CREATE UNIQUE INDEX uq_plan_helfer_kennung
    ON einsatz_plan_helfer(einsatz_id, COALESCE(herkunft, ''), kennung)
    WHERE kennung IS NOT NULL;
