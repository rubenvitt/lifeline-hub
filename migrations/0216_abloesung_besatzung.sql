-- LLH-1150 (Epic LLH-1016, Entscheidung LLH-1118 Punkt 4): Besatzungswechsel. Die Einheit und
-- ihr Fahrzeug bleiben, nur das Personal wechselt. Die Art steht seit dem gemeinsamen Neubau 0212
-- an der Schicht (`einsatz_abloesung.art` `einheit | besatzung`); hier kommt dazu, wer die alte
-- und wer die neue Besatzung bildet.
--
-- `einsatz_abloesung_besatzung` — je Zeile eine Person, die beim Vollzug einer Schicht als
-- Besatzungswechsel gegangen (`alt`) oder gekommen (`neu`) ist. Die alte Besatzung ist die
-- Personalzuordnung (`einsatz_personal.einheit_id`) an der Einheit und an jeder erbenden
-- Untereinheit zum Zeitpunkt des Vollzugs; die neue wählt die Führung. Die Spalten halten, was
-- die Rücknahme zum Wiederherstellen braucht:
--   - `einheit_vorher_id`: die Einheit der Person vor dem Wechsel (alt: die abgelöste oder eine
--     erbende; neu: ihre bisherige, NULL = keine);
--   - `fahrzeug_vorher_id`: nur alt, das Fahrzeug der Einheit, von dem der Wechsel sie genommen
--     hat (NULL = keins);
--   - `war_fuehrer`: nur alt, sie führte `einheit_vorher_id`;
--   - `zeitachse_id`: das Ereignis der Person aus dem Vollzug (alt `abloesung`, neu
--     `eintreffen`, je Quelle `abloesung`); NULL, wenn die Perioden-Regeln es ausließen.
-- Die Rücknahme streicht die Ereignisse, legt jede Person zurück, solange sie noch so steht, wie
-- der Vollzug sie hinterlassen hat, und löscht die Zeilen. Kein Freitext: der Name steht nur in
-- `einsatz_personal` und wird dort geschwärzt (Registry, LFH-23).
--
-- Fremdschlüssel: Schicht und Person CASCADE (eine Person ohne Zeitachse darf gelöscht werden,
-- eine mit Zeitachse verhindert das schon `einsatz_kraft_zeitachse`); die Vorher-Verweise und das
-- Ereignis SET NULL, damit das Löschen eines ganzen Einsatzes in jeder Reihenfolge gelingt.
-- Abgesichert von db::tests::migration_0216_besatzung_einer_schicht.
CREATE TABLE einsatz_abloesung_besatzung (
    abloesung_id       INTEGER NOT NULL REFERENCES einsatz_abloesung(id) ON DELETE CASCADE,
    personal_id        INTEGER NOT NULL REFERENCES einsatz_personal(id) ON DELETE CASCADE,
    rolle              TEXT    NOT NULL CHECK (rolle IN ('alt', 'neu')),
    einheit_vorher_id  INTEGER REFERENCES einsatz_einheit(id) ON DELETE SET NULL,
    fahrzeug_vorher_id INTEGER REFERENCES einsatz_fahrzeug(id) ON DELETE SET NULL,
    war_fuehrer        INTEGER NOT NULL DEFAULT 0 CHECK (war_fuehrer IN (0, 1)),
    zeitachse_id       INTEGER REFERENCES einsatz_kraft_zeitachse(id) ON DELETE SET NULL,
    angelegt_at        TEXT    NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (abloesung_id, personal_id)
);
CREATE INDEX idx_abloesung_besatzung_person ON einsatz_abloesung_besatzung(personal_id);
