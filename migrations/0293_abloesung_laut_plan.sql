-- LLH-1555 (Folge aus LLH-1523 E3, Change `qo0amhd5-wechsel-aus-schichtplan`, design.md D1/D2):
-- der Schichtplan gibt einer laufenden Schicht die Fälligkeit.
--
-- `faellig_laut_plan`: die gespeicherte `faellig_at` kommt aus dem Plan (nächster Wechselpunkt
-- der Blöcke der Einheit, `abloesung::schichtplan::kopplung`), nicht aus der Rangfolge. Geschrieben
-- nur über `abloesung::repo::faellig_mit_plan_tx`. `rhythmus_quelle` bleibt die Rückfallquelle:
-- fällt der Block weg, gilt sie wieder. Bewusst keine neue `rhythmus_quelle` 'plan': deren CHECK
-- (0212) ließe sich nur per Neubau von `einsatz_abloesung` ändern.
--
-- `plan_block_id`: der Block, in den ein Vollzug aus dem Plan gewechselt hat (Anker der
-- Fälligkeit, auch bei einem vorgezogenen Wechsel). SET NULL beim Löschen des Blocks; der
-- Schreibweg des Plans zieht die Fälligkeit in derselben Transaktion nach.
--
-- `einsatz_plan_helfer.einsatz_personal_id`: die Kraft, als die ein Helfer des Plans beim Vollzug
-- in den Einsatz übernommen wurde (design.md D5). Der Helfer bleibt im Plan stehen, damit seine
-- Qualifikationen für die übrigen Blöcke gelten; ein weiterer Vollzug nimmt dieselbe Kraft statt
-- einer zweiten. SET NULL, wenn die Kraft gelöscht wird (Storno einer Ad-hoc-Kraft).
--
-- `einsatz_abloesung_besatzung.uebernommen`: die neue Kraft kam erst mit diesem Vollzug aus dem
-- Plan in den Einsatz (Stamm-Personal oder Helfer). Die Rücknahme legt die Zuordnung zurück, die
-- Übernahme nicht; das ETB der Rücknahme nennt sie.
--
-- `idx_planschicht_person_block`: die Personen eines Blocks ohne Scan; die Liste der Ablösung
-- zählt sie für den Folgeblock jeder Schicht laut Plan (die Teilindizes aus 0277 greifen dafür
-- nicht).
--
-- Rein additiv per ADD COLUMN, kein Backfill. Abgesichert von
-- db::tests::migration_0293_abloesung_laut_plan.
ALTER TABLE einsatz_abloesung ADD COLUMN faellig_laut_plan INTEGER NOT NULL DEFAULT 0
    CHECK (faellig_laut_plan IN (0, 1));
ALTER TABLE einsatz_abloesung ADD COLUMN plan_block_id INTEGER
    REFERENCES einsatz_planschicht(id) ON DELETE SET NULL;

CREATE INDEX idx_abloesung_plan_block ON einsatz_abloesung(plan_block_id)
    WHERE plan_block_id IS NOT NULL;

ALTER TABLE einsatz_plan_helfer ADD COLUMN einsatz_personal_id INTEGER
    REFERENCES einsatz_personal(id) ON DELETE SET NULL;
ALTER TABLE einsatz_abloesung_besatzung ADD COLUMN uebernommen INTEGER NOT NULL DEFAULT 0
    CHECK (uebernommen IN (0, 1));

CREATE INDEX idx_planschicht_person_block ON einsatz_planschicht_person(planschicht_id);
