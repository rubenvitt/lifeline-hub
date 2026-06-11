-- Terminierte Erinnerungen / Wiedervorlage / Fristen (LFH-51): Rhythmen und
-- Fristen der Stabsarbeit (z. B. Lagemeldung alle 30 Min). Fälligkeit wird aus
-- faellig_at abgeleitet (nicht vom Scheduler erzeugt); der Scheduler liefert nur
-- den Live-Nudge und schreibt wiederkehrende Erinnerungen per skip-forward fort.
CREATE TABLE erinnerung (
    id                  INTEGER PRIMARY KEY,
    einsatz_id          INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    titel               TEXT    NOT NULL,
    beschreibung        TEXT,
    -- Nächster Fälligkeitszeitpunkt (UTC, 'YYYY-MM-DD HH:MM:SS').
    faellig_at          TEXT    NOT NULL,
    -- NULL = einmalig; > 0 = Wiederholungsintervall in Minuten.
    intervall_minuten   INTEGER,
    -- Freitext-Empfänger/Funktion (noch kein FK; Stab-Modell folgt später).
    empfaenger_funktion TEXT,
    -- Generischer Bezug/Quelle für Auto-Erzeugung (z. B. 'auftrag' + Auftrags-ID).
    -- Kein harter FK, da auf wechselnde Tabellen zeigend.
    bezug_typ           TEXT,
    bezug_id            INTEGER,
    -- Herkunft: 'manuell' | 'auto_frist'.
    quelle              TEXT    NOT NULL DEFAULT 'manuell',
    -- Lebenszyklus: 'offen' | 'erledigt' | 'quittiert'.
    status              TEXT    NOT NULL DEFAULT 'offen',
    erledigt_at         TEXT,
    -- Letzter Live-Nudge des Schedulers (verhindert Doppel-Benachrichtigung).
    zuletzt_ausgeloest_at TEXT,
    erstellt_von_id     INTEGER NOT NULL REFERENCES benutzer(id),
    erstellt_at         TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_erinnerung_einsatz_status ON erinnerung(einsatz_id, status, faellig_at);
-- Idempotenz der Auto-Quelle: je Bezug höchstens eine offene Auto-Erinnerung.
CREATE UNIQUE INDEX idx_erinnerung_auto_bezug
    ON erinnerung(bezug_typ, bezug_id)
    WHERE quelle = 'auto_frist' AND status = 'offen';
