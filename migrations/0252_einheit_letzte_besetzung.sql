-- LLH-1266 (Change oq1yp0k5-aufgeloeste-einheit-lesend, design.md D1): das Auflösen einer
-- Einheit löst ihre Kräfte (`einheit_id = NULL`) und den Führer; damit die lesende Ansicht der
-- aufgelösten Einheit zeigen kann, wer und was zuletzt dazugehörte, hält `einheit::repo::
-- aufloesen_tx` die letzte Besetzung hier fest, bevor es löst.
--
-- `einsatz_einheit_letzte_besetzung` — je Zeile eine Kraft, genau einer der drei Verweise auf
-- ihre Dispositionszeile (Art und CHECK). Kein Freitext: Name, Funktion, Funkrufname und
-- Bezeichnung stehen nur in den Dispositionszeilen und werden dort geschwärzt (Registry, LFH-23).
-- Festgehalten ist nur, was sich nach dem Auflösen ändern kann und zum Nachweis gehört:
--   - `ist_fuehrer`: die Person führte die Einheit;
--   - `auf_fahrzeug_id`: das Fahrzeug, auf dem die Person saß (NULL = keins);
--   - `menge`: die Menge des Materialpostens beim Auflösen.
--
-- `einsatz_einheit.besetzung_festgehalten` trennt „leer festgehalten“ (Einheit ohne Kräfte) von
-- „nicht festgehalten“ (vor dieser Migration aufgelöst). Kein Rückfüllen: die alte Besetzung ist
-- nicht rekonstruierbar.
--
-- Fremdschlüssel: Einheit und Kraft CASCADE, der Sitz SET NULL, damit das Löschen eines ganzen
-- Einsatzes in jeder Reihenfolge gelingt (Muster 0216).
CREATE TABLE einsatz_einheit_letzte_besetzung (
    id              INTEGER PRIMARY KEY,
    einheit_id      INTEGER NOT NULL REFERENCES einsatz_einheit(id) ON DELETE CASCADE,
    art             TEXT    NOT NULL CHECK (art IN ('personal', 'fahrzeug', 'material')),
    personal_id     INTEGER REFERENCES einsatz_personal(id) ON DELETE CASCADE,
    fahrzeug_id     INTEGER REFERENCES einsatz_fahrzeug(id) ON DELETE CASCADE,
    material_id     INTEGER REFERENCES einsatz_material(id) ON DELETE CASCADE,
    ist_fuehrer     INTEGER NOT NULL DEFAULT 0 CHECK (ist_fuehrer IN (0, 1)),
    auf_fahrzeug_id INTEGER REFERENCES einsatz_fahrzeug(id) ON DELETE SET NULL,
    menge           INTEGER,
    CHECK (
        (art = 'personal' AND personal_id IS NOT NULL AND fahrzeug_id IS NULL
            AND material_id IS NULL)
        OR (art = 'fahrzeug' AND fahrzeug_id IS NOT NULL AND personal_id IS NULL
            AND material_id IS NULL)
        OR (art = 'material' AND material_id IS NOT NULL AND personal_id IS NULL
            AND fahrzeug_id IS NULL)
    )
);
CREATE INDEX idx_einheit_letzte_besetzung_einheit
    ON einsatz_einheit_letzte_besetzung(einheit_id);

ALTER TABLE einsatz_einheit
    ADD COLUMN besetzung_festgehalten INTEGER NOT NULL DEFAULT 0
    CHECK (besetzung_festgehalten IN (0, 1));
