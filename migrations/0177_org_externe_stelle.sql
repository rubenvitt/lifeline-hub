-- LFH-1194: Stammdaten-Katalog „Externe Stellen“ je Organisation (Leitstellen, Behörden, Polizei,
-- Hilfsorganisationen). Herleitung: openspec/changes/archive/2026-10-11-lfh-1194-externe-stellen-katalog/design.md
-- (D2, D3).
--
-- Vorschlagsquelle für die meldende Stelle eines Einsatzes und den Adressaten einer
-- Nachforderung. Beide speichern weiter nur Text (Speicherform A, D1): kein Fremdschlüssel aus
-- einer Einsatztabelle hierher, also keine Löschfolgen.
--
-- Schwärzung: Org-Stammdatum, nicht einsatzbezogen — deshalb nicht in der Schwärzungs-Registry
-- (wie `org_fuehrungsfunktion`, 0128). Rufnummer und Funkrufname sind Dienstkontakte einer
-- Stelle, keine Personendaten.
--
-- Zuständige Leitstelle: höchstens eine je Organisation (partieller UNIQUE-Index), nur an einer
-- aktiven Stelle der Art `leitstelle` (CHECK). Den Wechsel der Markierung macht Rust in einer
-- Transaktion (`externe_stelle::repo::update`); Index und CHECK sind das Netz.
--
-- Die Art-Liste im CHECK ist `externe_stelle::ExterneStelleArt::ALLE`
-- (Test `externe_stelle::tests::check_liste_entspricht_der_art`).

CREATE TABLE org_externe_stelle (
    id              INTEGER PRIMARY KEY,
    org_id          INTEGER NOT NULL REFERENCES organisation(id),
    bezeichnung     TEXT NOT NULL,
    art             TEXT NOT NULL
                    CHECK (art IN ('leitstelle', 'behoerde', 'polizei', 'hilfsorganisation', 'sonstige')),
    rufnummer       TEXT,
    funkrufname     TEXT,
    aktiv           INTEGER NOT NULL DEFAULT 1 CHECK (aktiv IN (0, 1)),
    zustaendig      INTEGER NOT NULL DEFAULT 0 CHECK (zustaendig IN (0, 1)),
    erstellt_at     TEXT NOT NULL DEFAULT (datetime('now')),
    aktualisiert_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (org_id, bezeichnung),
    CHECK (zustaendig = 0 OR (art = 'leitstelle' AND aktiv = 1))
);

CREATE UNIQUE INDEX idx_org_externe_stelle_zustaendig
    ON org_externe_stelle(org_id) WHERE zustaendig = 1;
