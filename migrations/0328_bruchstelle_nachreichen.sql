-- LLH-1646: Nicht übernommene Änderungen nach einer Notübernahme ansehen und nachreichen (Entwurf
-- N1–N6, mit Ruben am 11.11.2026 abgestimmt). Die Bruchstelle (`einsatz_bruchstelle`, LLH-1641 E6)
-- sichert Tabellenzeilen; nachgereicht wird je Erfassung.
--
-- 1. `folge_von`: die gesicherte Zeile, zu deren Erfassung diese Zeile gehört (der ETB-Eintrag
--    einer Meldung hängt an der Meldung). NULL = eigene Erfassung. Gesetzt von
--    `instanz::spiegel::bruchstelle::ordne_folgen`, sobald Zeilen entfernt sind.
-- 2. `erledigt`: `nachgereicht` (als Antrag gestellt) oder `verworfen`; NULL = offen. Das Band
--    zählt offene Erfassungen. Ein abgelehnter Antrag macht seine Erfassung wieder offen.
-- 3. `antrag_id`: der Antrag, mit dem die Erfassung nachgereicht ist.
-- 4. `client_id`: der Idempotenzschlüssel des Antrags, wenn die Zeile keinen eigenen hat; so
--    bleibt er über eine Ablehnung und ein erneutes Stellen gleich (genau einmal beim Führer).
-- 5. `nachgereicht_als`: der Schlüssel der Zeile beim Führer aus seiner Quittung. Damit findet
--    eine spätere Erfassung, die auf diese Zeile verweist (etwa ihre Berichtigung), die neue
--    lokale Zeile, auch wenn der Antrag schon aufgeräumt ist.
ALTER TABLE einsatz_bruchstelle ADD COLUMN folge_von INTEGER
    REFERENCES einsatz_bruchstelle(id) ON DELETE SET NULL;
ALTER TABLE einsatz_bruchstelle ADD COLUMN erledigt TEXT
    CHECK (erledigt IN ('nachgereicht', 'verworfen'));
ALTER TABLE einsatz_bruchstelle ADD COLUMN erledigt_at TEXT;
ALTER TABLE einsatz_bruchstelle ADD COLUMN erledigt_von_id INTEGER
    REFERENCES benutzer(id) ON DELETE SET NULL;
ALTER TABLE einsatz_bruchstelle ADD COLUMN antrag_id INTEGER
    REFERENCES spiegel_antrag(id) ON DELETE SET NULL;
ALTER TABLE einsatz_bruchstelle ADD COLUMN client_id TEXT;
ALTER TABLE einsatz_bruchstelle ADD COLUMN nachgereicht_als TEXT;
