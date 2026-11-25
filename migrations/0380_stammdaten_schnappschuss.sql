-- LLH-1194 (Personal-Abruf): Schnappschüsse des Adapters „Stammdaten-Abruf“. Ein Abruf übernimmt nie
-- selbst (G1): er legt das abgeholte Paket als Schnappschuss ab, den ein Admin in der Vorschau des
-- Stammdaten-Eingangs (LLH-1633) prüft und übernimmt. Je Adapter höchstens ein offener; ein neuer
-- Abruf mit anderem Inhalt ersetzt ihn. Entwurf: `docs/superpowers/specs/2026-11-24-y3xpaeza-personal-abruf-design.md`.
--
-- Datensparsamkeit: nur ein offener Schnappschuss trägt Namen (`inhalt`, der Körper des Abrufs);
-- beim Übernehmen oder Ersetzen wird `inhalt` NULL. Es bleiben Fingerabdruck, Zählung und Zeiten.
-- Nicht verteilt an gekoppelte ELW. Abgesichert von db::tests::migration_0375_stammdaten_schnappschuss.
CREATE TABLE stammdaten_schnappschuss (
    id             TEXT    PRIMARY KEY,
    org_id         INTEGER NOT NULL REFERENCES organisation(id) ON DELETE CASCADE,
    adapter_id     TEXT    NOT NULL REFERENCES adapter(id) ON DELETE CASCADE,
    status         TEXT    NOT NULL CHECK (status IN ('offen', 'uebernommen', 'ersetzt')),
    fingerabdruck  TEXT    NOT NULL,
    inhalt         TEXT    CHECK (inhalt IS NULL OR json_valid(inhalt)),
    anzahl         TEXT    NOT NULL CHECK (json_valid(anzahl)),
    abgerufen_at   TEXT    NOT NULL,
    erledigt_at    TEXT,
    erledigt_von   INTEGER REFERENCES benutzer(id) ON DELETE SET NULL,
    CHECK ((status = 'offen') = (inhalt IS NOT NULL))
);

CREATE UNIQUE INDEX uq_stammdaten_schnappschuss_offen ON stammdaten_schnappschuss(adapter_id) WHERE status = 'offen';
CREATE INDEX ix_stammdaten_schnappschuss_adapter ON stammdaten_schnappschuss(adapter_id, abgerufen_at);

-- „Erneut vorlegen“: der nächste Lauf vergleicht nicht mit dem zuletzt übernommenen Stand.
ALTER TABLE adapter ADD COLUMN vorlegen_erzwingen INTEGER NOT NULL DEFAULT 0 CHECK (vorlegen_erzwingen IN (0, 1));
