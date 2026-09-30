-- LFH-554: Presse- und Medienarbeit (S5) im Stabsraum. Drei einsatzgebundene Tabellen:
-- Medienkontakte (Presse-Log), Pressemitteilungen (dritte Vorlagendokument-Art neben
-- lagebericht/befehl) und Anrufe am Informationstelefon. Herleitung:
-- openspec/changes/archive/2026-09-30-lfh-554-presse-medienarbeit-s5/design.md (D3).
--
-- Die Kopplung von Art und Status steht als CHECK hier UND im Repo: das Repo antwortet mit einer
-- lesbaren 422, der CHECK ist das Netz (AppError::status bildet CHECK auf 422 ab).

-- Spaltensatz exakt wie `lagebericht` (0038): `vorlagendokument::repo::select<T>` setzt ihn in
-- jeder Dokumenttabelle voraus.
CREATE TABLE pressemitteilung (
    id                 INTEGER PRIMARY KEY,
    einsatz_id         INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    vorlage            TEXT NOT NULL
                       CHECK (vorlage IN ('erstinformation','folgeinformation',
                                          'bevoelkerungshinweis','freitext')),
    titel              TEXT NOT NULL,
    zeitstand          TEXT NOT NULL,
    status             TEXT NOT NULL DEFAULT 'entwurf'
                       CHECK (status IN ('entwurf','freigegeben')),
    abschnitte         TEXT NOT NULL,
    version            INTEGER NOT NULL DEFAULT 1,
    vorgaenger_id      INTEGER REFERENCES pressemitteilung(id),
    ersteller_id       INTEGER NOT NULL REFERENCES benutzer(id),
    erstellt_at        TEXT NOT NULL DEFAULT (datetime('now')),
    aktualisiert_at    TEXT NOT NULL DEFAULT (datetime('now')),
    freigegeben_von_id INTEGER REFERENCES benutzer(id),
    freigegeben_at     TEXT,
    etb_eintrag_id     INTEGER REFERENCES etb_eintrag(id)
);

CREATE INDEX idx_pressemitteilung_einsatz ON pressemitteilung(einsatz_id, status, zeitstand);

-- Rückverweis des Freigabe-Snapshots, wie `lagebericht_id`/`befehl_id`. Nullable ADD COLUMN
-- berührt die FTS-Trigger nicht.
ALTER TABLE etb_eintrag ADD COLUMN pressemitteilung_id INTEGER REFERENCES pressemitteilung(id);

CREATE TABLE medienkontakt (
    id                     INTEGER PRIMARY KEY,
    einsatz_id             INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    art                    TEXT NOT NULL CHECK (art IN ('anfrage','abstimmung','termin')),
    medium                 TEXT NOT NULL CHECK (length(trim(medium)) > 0),
    thema                  TEXT NOT NULL CHECK (length(trim(thema)) > 0),
    kontakt_name           TEXT,
    kontakt_erreichbarkeit TEXT,
    eingang_at             TEXT NOT NULL,
    status                 TEXT NOT NULL DEFAULT 'offen'
                           CHECK (status IN ('offen','beantwortet','abgelehnt','erledigt')),
    antwort                TEXT,
    freigabe_durch         TEXT,
    -- Bezug auf die Pressemitteilung, auf die eine Antwort verweist. Einsatzgleichheit und
    -- Freigabestand prüft das Repo; der FK sichert sie nicht.
    pressemitteilung_id    INTEGER REFERENCES pressemitteilung(id),
    bearbeitet_von_id      INTEGER REFERENCES benutzer(id),
    bearbeitet_at          TEXT,
    angelegt_von_id        INTEGER NOT NULL REFERENCES benutzer(id),
    angelegt_at            TEXT NOT NULL DEFAULT (datetime('now')),
    geaendert_at           TEXT,
    -- Eine Anfrage wird beantwortet oder abgelehnt, Abstimmung und Termin werden erledigt.
    CHECK (
        (art = 'anfrage' AND status IN ('offen','beantwortet','abgelehnt'))
        OR (art IN ('abstimmung','termin') AND status IN ('offen','erledigt'))
    ),
    CHECK (status <> 'beantwortet' OR length(trim(coalesce(antwort, ''))) > 0)
);

CREATE INDEX idx_medienkontakt_einsatz ON medienkontakt(einsatz_id, eingang_at);

CREATE TABLE infotelefon_anruf (
    id              INTEGER PRIMARY KEY,
    einsatz_id      INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    anliegen        TEXT NOT NULL
                    CHECK (anliegen IN ('vermisstensuche','auskunft_lage','hinweis',
                                        'hilfeangebot','beschwerde','presse','sonstiges')),
    notiz           TEXT,
    anrufer_name    TEXT,
    rueckruf        TEXT,
    status          TEXT NOT NULL CHECK (status IN ('offen','erledigt')),
    eingang_at      TEXT NOT NULL,
    erledigt_von_id INTEGER REFERENCES benutzer(id),
    erledigt_at     TEXT,
    angelegt_von_id INTEGER NOT NULL REFERENCES benutzer(id),
    angelegt_at     TEXT NOT NULL DEFAULT (datetime('now')),
    -- Ein offener Rückruf braucht eine Nummer. Die Schwärzung ersetzt `rueckruf` deshalb durch
    -- den Platzhalter (PlatzhalterWennGesetzt) statt ihn zu nullen.
    CHECK (status <> 'offen' OR length(trim(coalesce(rueckruf, ''))) > 0)
);

CREATE INDEX idx_infotelefon_anruf_einsatz ON infotelefon_anruf(einsatz_id, eingang_at);

-- Neuer Abschnitt „Medienlage“ in der Lagebericht-Vorlage „lagebericht“ (Punkt III des
-- Lagevortrags). Die Freigabe verlangt jeden Abschnitt der Vorlage; offene Entwürfe bekommen ihn
-- deshalb leer nachgetragen, sonst ließen sie sich nicht mehr freigeben. Freigegebene Berichte
-- bleiben unberührt (ihr Rechtsstand ist der ETB-Snapshot). Die Reihenfolge im JSON ist ohne
-- Belang: Editor und Snapshot ordnen nach der Vorlage.
UPDATE lagebericht
SET abschnitte = json_insert(abschnitte, '$[#]', json_object('schluessel', 'medienlage', 'text', ''))
WHERE vorlage = 'lagebericht'
  AND status = 'entwurf'
  AND NOT EXISTS (
      SELECT 1 FROM json_each(lagebericht.abschnitte)
      WHERE json_extract(json_each.value, '$.schluessel') = 'medienlage'
  );
