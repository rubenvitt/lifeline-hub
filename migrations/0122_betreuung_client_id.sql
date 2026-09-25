-- LFH-675: Stand- und Belegungsmeldungen der Betreuung werden offline erfasst. Sie tragen
-- denselben stabilen Idempotenzschlüssel wie ETB (0088), Person und Meldung (0098): Ein
-- Request kann nach dem Commit in ein Timeout laufen, und der spätere Flush mit derselben
-- client_id muss dann die bestehende Meldung zurückliefern, statt eine zweite Zeile samt
-- zweitem ETB-Eintrag zu schreiben.
--
-- Eindeutig je Einsatz und Meldereihe, nicht je Bezirk/Stelle: nur so fällt ein Schlüssel
-- auf, der an einem anderen Objekt schon vergeben ist (design.md D1/D3).
-- NULL bleibt für Aufrufe ohne Schlüssel erlaubt (Leermeldung vor dem Schließen, ältere
-- Clients); der partielle Index dedupliziert nur tatsächlich client-identifizierte Meldungen.
ALTER TABLE evakuierung_stand ADD COLUMN client_id TEXT;
CREATE UNIQUE INDEX idx_evakuierung_stand_client_id
    ON evakuierung_stand(einsatz_id, client_id)
    WHERE client_id IS NOT NULL;

ALTER TABLE betreuungsstelle_belegung ADD COLUMN client_id TEXT;
CREATE UNIQUE INDEX idx_betreuungsstelle_belegung_client_id
    ON betreuungsstelle_belegung(einsatz_id, client_id)
    WHERE client_id IS NOT NULL;
