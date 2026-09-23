-- Rückmeldung je Einheit/Abschnitt (LFH-610).
--
-- Eine Meldung hat EINEN Absender. Bisher stand er nur als Freitext in `absender`; jetzt
-- kann er zusätzlich strukturiert an eine Einheit ODER einen Einsatzabschnitt gebunden
-- werden. `absender` bleibt Pflicht und trägt den Namen zum Eingangszeitpunkt weiter
-- (dieselbe Rolle wie `auftrag_empfaenger.snap_anzeige`): löst sich die Einheit auf, wird
-- der Bezug NULL (ON DELETE SET NULL, Präzedenz 0089), die Meldung bleibt lesbar.
--
-- Höchstens einer der beiden Bezüge: sonst hätte „letzte Rückmeldung je Abschnitt“ zwei
-- Antworten (direkt am Abschnitt vs. über die Einheit) und keine Regel, eine zu wählen.
-- Der Abschnitt einer Einheit wird zur Abfragezeit über `einsatz_einheit.abschnitt_id`
-- aufgelöst, nicht als Snapshot gespeichert.
ALTER TABLE meldung ADD COLUMN einheit_id INTEGER
    REFERENCES einsatz_einheit(id) ON DELETE SET NULL;
ALTER TABLE meldung ADD COLUMN abschnitt_id INTEGER
    REFERENCES einsatzabschnitt(id) ON DELETE SET NULL
    CHECK (abschnitt_id IS NULL OR einheit_id IS NULL);

CREATE INDEX idx_meldung_einheit ON meldung(einheit_id, ereigniszeit)
    WHERE einheit_id IS NOT NULL;
CREATE INDEX idx_meldung_abschnitt ON meldung(abschnitt_id, ereigniszeit)
    WHERE abschnitt_id IS NOT NULL;

-- Rückmeldefrist in Minuten: ab der letzten Rückmeldung gilt eine Einheit nach Ablauf als
-- überfällig. Auflösung Einsatz ?? Org ?? 60 (RUECKMELDUNG_FRIST_DEFAULT_MIN).
ALTER TABLE einsatz_einstellungen ADD COLUMN rueckmeldung_frist_min INTEGER;
ALTER TABLE org_einstellungen ADD COLUMN rueckmeldung_frist_min INTEGER;
