-- LLH-1555 Welle 2 (Change `qo0amhd5-wechsel-aus-schichtplan`, design.md D6/D7): Wechsel aus dem
-- Schichtplan an einer UHS und in der Zeile „Pause“.
--
-- 1. `einsatz_plan_wechsel` — ein vollzogener Wechsel zu einem Block des Plans:
--    - `uhs`: an einem UHS-Block kommen Kräfte an die UHS (`einsatz_personal.uhs_id`) und gehen;
--    - `pause_beginn`: an einem Pausenblock bekommen die Kräfte des Blocks den Pausenstatus;
--    - `pause_ende`: wer dann noch den Pausenstatus trägt, bekommt seinen Status zurück.
--    `zeitpunkt` ist der Zeitpunkt laut Plan (Beginn, beim Pausenende das Ende des Blocks),
--    `vollzogen_at` der des Vollzugs. Je Block und Art höchstens ein Wechsel, der nicht
--    zurückgenommen ist (Teilindex); die Rücknahme setzt `zurueckgenommen_at`, die Zeile bleibt.
--    Der Block SET NULL: ein gelöschter Block lässt den Wechsel als Geschichte stehen.
--
-- 2. `einsatz_plan_wechsel_person` — je Kraft, was der Wechsel an ihr geändert hat, mit dem
--    Stand davor und danach für die Rücknahme (sie legt nur zurück, was noch den Stand des
--    Wechsels trägt, wie LLH-1319):
--    - UHS: `alt` = ging von der UHS, `neu` = kam an sie; `uhs_vorher_id` die UHS davor
--      (NULL = keine); `zeitachse_id` das Ereignis der Kraft (Quelle `abloesung`), NULL, wenn sie
--      einer Einheit folgt oder die Perioden-Regeln es ausließen; `uebernommen` = kam erst mit
--      diesem Wechsel aus dem Plan in den Einsatz.
--    - Pause: `neu` je Kraft, deren Status der Wechsel gesetzt hat; `status_vorher_id` und
--      `status_nachher_id` (beim Beginn vorher der gemerkte Status, nachher die Pause).
--    Kein Freitext: der Name steht nur in `einsatz_personal` (Schwärzung über die Registry).
--
-- 3. `personal_status.pause` — dieser Status ist „Pause“ für den Schichtplan. Höchstens ein
--    aktiver je Organisation (Teilindex). Der Bestand bekommt das Kennzeichen am Status „Pause“
--    der Startliste (0012), gefunden über das Label ohne Groß-/Kleinschreibung; danach entscheidet
--    nur noch das Kennzeichen, ein Umbenennen bricht nichts mehr.
--
-- Fremdschlüssel: Einsatz, Wechsel und Kraft CASCADE; Block, UHS, ETB und Ereignis SET NULL,
-- damit das Löschen eines ganzen Einsatzes in jeder Reihenfolge gelingt; die Status-Verweise
-- NO ACTION wie `einsatz_personal.status_id` (ein Status wird nur deaktiviert).
-- Abgesichert von db::tests::migration_0297_plan_wechsel_uhs_pause.
CREATE TABLE einsatz_plan_wechsel (
    id                  INTEGER PRIMARY KEY,
    einsatz_id          INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    planschicht_id      INTEGER REFERENCES einsatz_planschicht(id) ON DELETE SET NULL,
    art                 TEXT    NOT NULL CHECK (art IN ('uhs', 'pause_beginn', 'pause_ende')),
    uhs_id              INTEGER REFERENCES uhs(id) ON DELETE SET NULL,
    zeitpunkt           TEXT    NOT NULL,
    vollzogen_at        TEXT    NOT NULL,
    vollzogen_von       INTEGER REFERENCES benutzer(id),
    zurueckgenommen_at  TEXT,
    zurueckgenommen_von INTEGER REFERENCES benutzer(id),
    etb_id              INTEGER REFERENCES etb_eintrag(id) ON DELETE SET NULL,
    CHECK (art = 'uhs' OR uhs_id IS NULL)
);
CREATE INDEX idx_plan_wechsel_einsatz ON einsatz_plan_wechsel(einsatz_id);
CREATE UNIQUE INDEX uq_plan_wechsel_offen ON einsatz_plan_wechsel(planschicht_id, art)
    WHERE planschicht_id IS NOT NULL AND zurueckgenommen_at IS NULL;

CREATE TABLE einsatz_plan_wechsel_person (
    wechsel_id          INTEGER NOT NULL REFERENCES einsatz_plan_wechsel(id) ON DELETE CASCADE,
    einsatz_personal_id INTEGER NOT NULL REFERENCES einsatz_personal(id) ON DELETE CASCADE,
    rolle               TEXT    NOT NULL CHECK (rolle IN ('alt', 'neu')),
    uhs_vorher_id       INTEGER REFERENCES uhs(id) ON DELETE SET NULL,
    status_vorher_id    INTEGER REFERENCES personal_status(id),
    status_nachher_id   INTEGER REFERENCES personal_status(id),
    zeitachse_id        INTEGER REFERENCES einsatz_kraft_zeitachse(id) ON DELETE SET NULL,
    uebernommen         INTEGER NOT NULL DEFAULT 0 CHECK (uebernommen IN (0, 1)),
    PRIMARY KEY (wechsel_id, einsatz_personal_id)
);
CREATE INDEX idx_plan_wechsel_person_kraft ON einsatz_plan_wechsel_person(einsatz_personal_id);

ALTER TABLE personal_status ADD COLUMN pause INTEGER NOT NULL DEFAULT 0
    CHECK (pause IN (0, 1));
UPDATE personal_status SET pause = 1
WHERE id IN (SELECT MIN(id) FROM personal_status
             WHERE aktiv = 1 AND lower(trim(label)) = 'pause'
             GROUP BY org_id);
CREATE UNIQUE INDEX uq_personal_status_pause ON personal_status(org_id)
    WHERE pause = 1 AND aktiv = 1;
