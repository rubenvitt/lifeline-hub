-- LLH-1817 (design.md D7 der Einsatzrolle „Mitarbeit“): Kennt das Gegenüber die Einsatzrolle
-- `mitarbeit`? Beide Seiten nennen es beim Melden (die meldende in ihrer Anfrage, die erreichte
-- in ihrer Antwort); jede Seite hält hier fest, was das Gegenüber gemeldet hat. Vorgabe 0: ein
-- älteres Gegenüber nennt es nicht, und sein CHECK lehnt `mitarbeit` ab. Dann geht eine
-- Mitgliedschaft `mitarbeit` als `beobachter` hinaus, und ein zurückkommendes `beobachter`
-- überschreibt eine hiesige `mitarbeit` nicht (`instanz::spiegel::liefern`, `uebernehmen`).
ALTER TABLE instanz_kopplung ADD COLUMN gegenueber_rolle_mitarbeit INTEGER NOT NULL DEFAULT 0;
