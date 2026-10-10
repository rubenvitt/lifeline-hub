-- LFH-1121: Änderungszwang nach einem Einmalpasswort. 1 = der nächste Passwort-Login führt in den
-- Schritt „Neues Passwort festlegen“ statt in eine Sitzung (`routes::auth::login`). Gesetzt von
-- „Benutzer anlegen“ und „Einmalpasswort vergeben“ (`routes::benutzer`), aufgehoben vom Festlegen
-- und vom Self-Service-Wechsel. Default 0: Bestandskonten, der Bootstrap-Admin, Seeds, Demo-Daten
-- und SSO-Erstanlagen melden sich unverändert an.
-- Abgesichert von db::tests::migration_0172_* (include_str!).
ALTER TABLE benutzer ADD COLUMN passwort_wechsel_pflicht INTEGER NOT NULL DEFAULT 0
    CHECK (passwort_wechsel_pflicht IN (0, 1));
