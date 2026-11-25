-- LLH-2093: Ausgangskorb (Ausgang per E-Mail, Spec
-- docs/superpowers/specs/2026-11-24-w1ymakq6-ausgang-email-design.md, Abschnitt 3).
--
-- Eine Zeile je Versand an genau eine Adresse. Betreff, Text, Adresse und Name der Stelle sind
-- Schnappschüsse beim Absenden; `externe_stelle_id` dient nur der Anzeige und wird bei
-- Löschung der Stelle leer. Die Zeilen gehören zum Einsatz (ON DELETE CASCADE, Aufbewahrung wie
-- die übrigen Einsatztabellen) und werden nicht gespiegelt (`instanz::spiegel::art::AUSGENOMMEN`).
--
-- Die Listen der CHECKs sind `QuelleArt::ALLE`, `KanalArt::ALLE`, `VersandZustand::ALLE` und
-- `AusgangFehler::ALLE` (Test `ausgang::tests::check_listen_entsprechen_den_enums`).
-- `versuch_begonnen_at` wird vor der Zustellung gesetzt und mit dem Ergebnis geleert; eine Zeile
-- mit gesetztem Merker nach einem Neustart war mitten in der Zustellung (`ungewiss`).

CREATE TABLE ausgang (
    id                    TEXT PRIMARY KEY,
    org_id                INTEGER NOT NULL REFERENCES organisation(id) ON DELETE CASCADE,
    einsatz_id            INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    client_id             TEXT NOT NULL,
    quelle_art            TEXT NOT NULL CHECK (quelle_art IN ('lagebericht', 'befehl', 'nachforderung')),
    quelle_id             INTEGER NOT NULL,
    kanal                 TEXT NOT NULL CHECK (kanal IN ('email', 'fax', 'matrix', 'threema')),
    externe_stelle_id     INTEGER REFERENCES org_externe_stelle(id) ON DELETE SET NULL,
    stelle_bezeichnung    TEXT NOT NULL,
    adresse               TEXT NOT NULL,
    betreff               TEXT NOT NULL,
    inhalt                TEXT NOT NULL,
    zustand               TEXT NOT NULL DEFAULT 'wartet'
        CHECK (zustand IN ('wartet', 'uebergeben', 'fehlgeschlagen')),
    versuche              INTEGER NOT NULL DEFAULT 0,
    naechster_versuch_at  TEXT,
    erster_versuch_at     TEXT,
    versuch_begonnen_at   TEXT,
    fehler_art            TEXT CHECK (fehler_art IS NULL OR fehler_art IN (
        'voruebergehend', 'abgelehnt', 'ungewiss', 'ueberholt', 'anbindung_fehlt',
        'anbindung_angehalten', 'anbindung_fehler', 'zu_gross', 'spiegel')),
    fehler_status         INTEGER,
    erstellt_von_id       INTEGER NOT NULL REFERENCES benutzer(id),
    erstellt_at           TEXT NOT NULL,
    uebergeben_at         TEXT,
    etb_eintrag_id        INTEGER REFERENCES etb_eintrag(id) ON DELETE SET NULL,
    UNIQUE (org_id, client_id)
);

CREATE INDEX idx_ausgang_faellig ON ausgang(zustand, naechster_versuch_at);
CREATE INDEX idx_ausgang_quelle ON ausgang(einsatz_id, quelle_art, quelle_id);
