-- LFH-334/B6: Personen- und Meldungs-Erfassung nutzen denselben stabilen
-- Idempotenzschlüssel wie die ETB-Offline-Queue. Ein Request kann clientseitig
-- nach dem Commit in ein Timeout laufen; der spätere Flush mit derselben
-- client_id muss dann den bestehenden Datensatz zurückliefern statt eine
-- zweite Registrier- bzw. laufende Nummer zu vergeben.
--
-- NULL bleibt für ältere Clients und serverinterne Aufrufer erlaubt. Der
-- partielle Index lässt beliebig viele NULL-Werte zu und dedupliziert nur
-- tatsächlich client-identifizierte Schreibvorgänge.
ALTER TABLE einsatz_person ADD COLUMN client_id TEXT;
CREATE UNIQUE INDEX idx_einsatz_person_client_id
    ON einsatz_person(einsatz_id, client_id)
    WHERE client_id IS NOT NULL;

ALTER TABLE meldung ADD COLUMN client_id TEXT;
-- Persistenter At-least-once-Marker fuer das Live-/Sofortalarm-Buendel. NULL bedeutet:
-- ein Replay muss die Publikation nachholen. Der Marker wird erst NACH dem Publish gesetzt;
-- ein Crash kann daher hoechstens eine Dublette, aber keinen dauerhaft verlorenen Alarm erzeugen.
ALTER TABLE meldung ADD COLUMN live_published_at TEXT;
CREATE UNIQUE INDEX idx_meldung_client_id
    ON meldung(einsatz_id, client_id)
    WHERE client_id IS NOT NULL;
