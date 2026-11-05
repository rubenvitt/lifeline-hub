-- LLH-1526: Nachforderungen tragen denselben stabilen Idempotenzschlüssel wie ETB (0088),
-- Person und Meldung (0098). `apiSend` meldet Zeitlimit und Leitungsabbruch als Netzfehler,
-- auch wenn der Server schon gespeichert hat; ein erneuter Versuch mit derselben client_id
-- liefert dann die bestehende Nachforderung zurück, statt eine zweite anzulegen.
--
-- NULL bleibt für ältere Clients, serverinterne Aufrufer (Abteilen einer Zusage) und alle
-- Bestandszeilen erlaubt; der partielle Index dedupliziert nur Zeilen mit Schlüssel.
ALTER TABLE nachforderung ADD COLUMN client_id TEXT;
CREATE UNIQUE INDEX idx_nachforderung_client_id
    ON nachforderung(einsatz_id, client_id)
    WHERE client_id IS NOT NULL;
