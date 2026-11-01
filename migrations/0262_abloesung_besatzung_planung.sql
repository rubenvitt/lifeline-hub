-- LLH-1319 (Folge aus LLH-1150, Change `zjwlwwv7-besatzungswechsel-planen`): den
-- Besatzungswechsel vorab planen, die neue Besatzung beim Vollzug verteilen, und die Planung
-- übersteht die Rücknahme eines Vollzugs.
--
-- 1. `einsatz_abloesung_besatzung_plan` — der geplante Besatzungswechsel einer laufenden Schicht:
--    je Zeile eine Person der neuen Besatzung, Reihenfolge über `rowid` (wie die Ablöser-Liste).
--    `einheit_id` ist die Ziel-Einheit (die Einheit der Schicht oder eine erbende Untereinheit,
--    NULL = die Einheit der Schicht), `fahrzeug_id` das Ziel-Fahrzeug (NULL = die Person behält
--    ihr Fahrzeug). Eine Schicht plant entweder Ablöser oder einen Besatzungswechsel (der Server
--    prüft das). Der Vollzug lässt
--    die Zeilen stehen, damit die Rücknahme die Planung wieder vorfindet.
--
-- 2. `einsatz_abloesung_planung_vorher` — die geplante Ablöser-Liste, wie sie VOR dem Vollzug
--    galt; der Vollzug ersetzt die Liste durch die beim Vollzug genannte, die Rücknahme schreibt
--    diese hier zurück und löscht die Zeilen. `einsatz_abloesung.planung_gesichert` = 1 sagt, dass
--    der Vollzug gesichert hat (auch eine leere Planung); 0 (Bestand, Vollzug vor 0262) lässt die
--    Liste des Vollzugs als Planung stehen, wie bisher.
--
-- 3. `einsatz_abloesung_besatzung.einheit_nachher_id` / `fahrzeug_nachher_id` — nur bei der neuen
--    Besatzung: wohin der Vollzug die Person verteilt hat. Die Rücknahme legt sie zurück, solange
--    sie noch dort steht bzw. sitzt; `fahrzeug_vorher_id` ist bei der neuen Besatzung das Fahrzeug
--    vor dem Wechsel (nur gesetzt, wenn der Vollzug ihr eines gab). Bestand: beide NULL, die
--    Rücknahme behandelt ihn wie vor 0262 (Ziel = Einheit der Schicht, Fahrzeug unberührt).
--
-- Fremdschlüssel wie 0216: Schicht und Person CASCADE, Einheit/Fahrzeug als Ziel SET NULL; in der
-- Sicherung der Ablöser fällt eine gelöschte Einheit weg (CASCADE). Kein Freitext: Namen stehen
-- nur in `einsatz_personal` bzw. `einsatz_einheit`. Abgesichert von
-- db::tests::migration_0262_besatzung_planung.
CREATE TABLE einsatz_abloesung_besatzung_plan (
    abloesung_id INTEGER NOT NULL REFERENCES einsatz_abloesung(id) ON DELETE CASCADE,
    personal_id  INTEGER NOT NULL REFERENCES einsatz_personal(id) ON DELETE CASCADE,
    einheit_id   INTEGER REFERENCES einsatz_einheit(id) ON DELETE SET NULL,
    fahrzeug_id  INTEGER REFERENCES einsatz_fahrzeug(id) ON DELETE SET NULL,
    angelegt_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (abloesung_id, personal_id)
);
CREATE INDEX idx_abloesung_besatzung_plan_person ON einsatz_abloesung_besatzung_plan(personal_id);

CREATE TABLE einsatz_abloesung_planung_vorher (
    abloesung_id INTEGER NOT NULL REFERENCES einsatz_abloesung(id) ON DELETE CASCADE,
    einheit_id   INTEGER NOT NULL REFERENCES einsatz_einheit(id) ON DELETE CASCADE,
    angelegt_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (abloesung_id, einheit_id)
);
CREATE INDEX idx_abloesung_planung_vorher_einheit ON einsatz_abloesung_planung_vorher(einheit_id);

ALTER TABLE einsatz_abloesung ADD COLUMN planung_gesichert INTEGER NOT NULL DEFAULT 0
    CHECK (planung_gesichert IN (0, 1));

ALTER TABLE einsatz_abloesung_besatzung ADD COLUMN einheit_nachher_id INTEGER
    REFERENCES einsatz_einheit(id) ON DELETE SET NULL;
ALTER TABLE einsatz_abloesung_besatzung ADD COLUMN fahrzeug_nachher_id INTEGER
    REFERENCES einsatz_fahrzeug(id) ON DELETE SET NULL;
