-- LFH-688: Ausgaben der Verpflegung werden offline erfasst. Sie tragen denselben stabilen
-- Idempotenzschlüssel wie ETB (0088), Person und Meldung (0098) und die Betreuungsmeldungen
-- (0122): Ein Request kann nach dem Commit in ein Timeout laufen, und der spätere Flush mit
-- derselben client_id muss dann die bestehende Ausgabe zurückliefern, statt eine zweite Zeile
-- zu schreiben und die Deckung zu hoch auszuweisen.
--
-- Eindeutig je Einsatz, nicht je Zeitfenster: nur so fällt ein Schlüssel auf, der an einem
-- anderen Zeitfenster schon vergeben ist (design.md D1/D3). NULL bleibt für Aufrufe ohne
-- Schlüssel und alle Bestandszeilen erlaubt.
ALTER TABLE verpflegung_ausgabe ADD COLUMN client_id TEXT;
CREATE UNIQUE INDEX idx_verpflegung_ausgabe_client_id
    ON verpflegung_ausgabe(einsatz_id, client_id)
    WHERE client_id IS NOT NULL;
