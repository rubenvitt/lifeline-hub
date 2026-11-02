-- LLH-1520: Richtwerte des Unterkunfts- und Zeltrechners in Ebenen (design.md D2).
--
-- Die Basis steht im Programm (`src/unterkunft/richtwerte_basis.json`), nicht in der Datenbank.
-- Gespeichert werden nur gesetzte Overrides, je Schlüssel eine Zeile; keine Zeile = erbt.
-- Wirksam ist je Schlüssel die höchste gesetzte Ebene: Einsatz vor Organisation vor Basis.
-- Schlüssel und Grenzen prüft Rust gegen die Basis-Datei (unbekannt oder außerhalb = 400), daher
-- kein CHECK auf den Schlüssel: ein neuer Richtwert braucht so keine Migration.

-- Stammdaten der Organisation, nicht einsatzbezogen: nicht in der Schwärzungs-Registry.
CREATE TABLE org_unterkunft_richtwert (
    org_id        INTEGER NOT NULL REFERENCES organisation(id) ON DELETE CASCADE,
    schluessel    TEXT    NOT NULL,
    wert          REAL    NOT NULL,
    geaendert_at  TEXT    NOT NULL,
    geaendert_von INTEGER REFERENCES benutzer(id),
    PRIMARY KEY (org_id, schluessel)
);

-- Einstellung des Einsatzes ohne Personenbezug (Registry: alles retain).
CREATE TABLE einsatz_unterkunft_richtwert (
    einsatz_id    INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    schluessel    TEXT    NOT NULL,
    wert          REAL    NOT NULL,
    geaendert_at  TEXT    NOT NULL,
    geaendert_von INTEGER REFERENCES benutzer(id),
    PRIMARY KEY (einsatz_id, schluessel)
);
