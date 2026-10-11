-- LFH-1152: die Sitzung merkt sich, auf welchem Weg sie entstand, damit Abmeldung und
-- „Sitzung beendet“ im Zugangsprotokoll den tatsächlichen Anmeldeweg nennen statt fest
-- „Passwort“.
--
-- anmeldeweg: Wire-Wert von `auth::provider::Anmeldeweg`, derselbe wie im `login_ok`-Eintrag der
--   Anmeldung. Kein CHECK: die Werte prüft das Enum beim Schreiben. NULL = Sitzung von vor dieser
--   Migration; die Spur schreibt dann `unbekannt`. Bestand wird nicht nachgetragen, der Weg ist
--   nicht mehr feststellbar (Sitzungen leben höchstens `session::SITZUNG_TAGE`).

ALTER TABLE session ADD COLUMN anmeldeweg TEXT;
