-- Org-weite Einstellungen (admin-einstellungen) — 1:1 per Organisation. Spiegelt
-- einsatz_einstellungen ohne einsatzspezifische Felder (kein standard_modul,
-- basemap_modus, karten_zoom_start, fachebenen_sichtbar, keine Nummern-Startwerte —
-- Startwerte bleiben Einsatz-only). Effektivwert = Einsatz ?? Org ?? hartkodierter
-- Default (Task 3). Validierung in Rust, kein DB-CHECK (sqlx-sqlite 0.8.6 Rebuild-Limit).
CREATE TABLE org_einstellungen (
    org_id                          INTEGER PRIMARY KEY REFERENCES organisation(id) ON DELETE CASCADE,
    -- Anzeige-Konventionen; NULL = hartkodierter Default.
    zeitzone                        TEXT,
    zeitformat                      TEXT,
    einheiten                       TEXT,
    koordinatenformat               TEXT,
    -- Aufbewahrung; NULL = keine Auto-Frist.
    retention_dauer_tage            INTEGER,
    -- Nummernkreis-Präfixe (display-only); Startwerte bleiben Einsatz-only.
    etb_nummer_praefix              TEXT,
    meldung_nummer_praefix          TEXT,
    auftrag_nummer_praefix          TEXT,
    -- Default-Fristen (Minuten); NULL = kein org-weiter Default.
    meldung_bestaetigung_frist_min  INTEGER,
    auftrag_quittierung_frist_min   INTEGER,
    -- Auto-ETB-Schalter: 0 = aus; NULL/1 = an (hartkodierter Default).
    auto_etb_eintraege              INTEGER,
    geaendert_at                    TEXT,
    geaendert_von                   INTEGER REFERENCES benutzer(id)
);

-- Org-weite Modul-Rollen-Defaults — je (org, modul_key) eine Zeile.
-- Repo-Funktionen folgen in Task 2; hier nur Tabellenanlage.
-- Kein sichtbar-Feld: Rollen-Default ≠ Modul-Sichtbarkeit (vgl. Plan-Spec).
CREATE TABLE org_modul_einstellung (
    org_id           INTEGER NOT NULL REFERENCES organisation(id) ON DELETE CASCADE,
    modul_key        TEXT    NOT NULL,
    benoetigte_rolle TEXT,           -- 'admin' | 'fuehrungskraft'; NULL = frei
    geaendert_at     TEXT,
    geaendert_von    INTEGER REFERENCES benutzer(id),
    PRIMARY KEY (org_id, modul_key)
);
