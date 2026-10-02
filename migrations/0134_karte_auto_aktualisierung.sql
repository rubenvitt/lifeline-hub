-- LFH-993: Einstellung der automatischen Aktualisierung der Offline-Karten, in der Verwaltung
-- gesetzt. Serverweit wie die Offline-Karten selbst (karte_offline_karte hat kein org_id),
-- höchstens eine Zeile (id = 1, das Repo schreibt per Upsert). Ohne Zeile gilt die Vorgabe aus
-- der Server-Konfiguration (LIFELINE_KARTEN_AUTO_AKTUALISIERUNG*). Validierung (1…168 Stunden)
-- in Rust, kein DB-CHECK — wie bei org_einstellungen.
CREATE TABLE karte_auto_aktualisierung (
    id                INTEGER PRIMARY KEY,
    automatisch       INTEGER NOT NULL,
    intervall_stunden INTEGER NOT NULL,
    geaendert_at      TEXT    NOT NULL,
    geaendert_von     INTEGER REFERENCES benutzer(id) ON DELETE SET NULL
);
