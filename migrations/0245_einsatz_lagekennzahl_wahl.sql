-- LLH-1371: gewählte Lagekennzahlen eines Einsatzes. Heute nur „Nachforderungen offen“ auf
-- Lageplatz B des Kennzahlenbands (Regel LFH-640: Lageplätze nur per bewusster Entscheidung).
--
-- Die Wahl ist eine eigene Zeile je Kennzahl, nicht eine Spalte an `einsatz` und kein Feld in
-- `einsatz_einstellungen` (deren PUT ist Vollersatz, siehe 0104). Der Auslöser der Lagekennzahl
-- ist `EXISTS` über diese Tabelle (`einsatz::lagekennzahl`), nie die Zahl der offenen
-- Nachforderungen. Eine weitere wählbare Kennzahl erweitert den CHECK (Rebuild dieser kleinen
-- Tabelle) und das Rust-Enum `Lagekennzahl`.
CREATE TABLE einsatz_lagekennzahl_wahl (
    einsatz_id      INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    kennzahl        TEXT    NOT NULL CHECK (kennzahl IN ('nachforderungen')),
    gewaehlt_von_id INTEGER NOT NULL REFERENCES benutzer(id),
    gewaehlt_at     TEXT    NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (einsatz_id, kennzahl)
);
