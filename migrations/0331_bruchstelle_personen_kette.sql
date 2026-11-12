-- LLH-1657: Personen samt Verlauf aus der Bruchstelle nachreichen (Entwurf K1–K6, von Ruben am
-- 12.11.2026 freigegeben). Eine Person wird als Antrag gestellt; ihre Einträge (Sichtung,
-- Verbleib, Notiz, Transport, Anlass, Maßnahme, Verletzung) hängen über `folge_von` an ihr und
-- stellt der Spiegel selbst, sobald die Person bei ihm angekommen ist
-- (`instanz::spiegel::bruchstelle::ketten_fortsetzen`).
--
-- 1. `grund`: Ein Eintrag der Kette, der sich nicht stellen lässt (ein anderer Bezug fehlt) oder
--    dessen Antrag abgelehnt ist, löst sich von seinem Ursprung (`folge_von` = NULL) und steht mit
--    diesem Grund als eigene Zeile in der Liste. `ordne_folgen` hängt ihn nicht wieder an.
-- 2. `notiz_at`: Wann die Nachreich-Notiz an die Person beim Führer gestellt wurde (K3: Nummer am
--    ELW, aufgehobene Maßnahmen, Bestätigungen, Status). NULL = noch nicht; genau einmal.
ALTER TABLE einsatz_bruchstelle ADD COLUMN grund TEXT;
ALTER TABLE einsatz_bruchstelle ADD COLUMN notiz_at TEXT;
