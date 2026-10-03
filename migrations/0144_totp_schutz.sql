-- LFH-791: Zweitfaktor gegen Durchprobieren und Wiederverwendung.
--
-- totp_letzter_schritt: der zuletzt angenommene TOTP-Zeitschritt (Unix-Zeit / 30). Ein Code
-- aus diesem oder einem früheren Schritt gilt nicht mehr (RFC 6238 §5.2): ohne diese Spalte
-- galt ein mitgelesener Code im ganzen ±1-Skew-Fenster beliebig oft. NULL = noch keiner.
--
-- totp_fehlversuche / totp_gesperrt_bis: aufeinanderfolgende Fehlversuche am zweiten Faktor
-- und das Ende der Sperre (Unix-Sekunden). In der Datenbank statt im Prozess wie die Sperre je
-- Quelle (`auth::rate_limit`): sie gilt je Benutzer, also auch über wechselnde Adressen, und
-- übersteht einen Neustart. Erreichbar ist sie nur mit dem richtigen Passwort.
ALTER TABLE benutzer ADD COLUMN totp_letzter_schritt INTEGER;
ALTER TABLE benutzer ADD COLUMN totp_fehlversuche INTEGER NOT NULL DEFAULT 0;
ALTER TABLE benutzer ADD COLUMN totp_gesperrt_bis INTEGER;
