-- LLH-1369: Inhalt der Meldung in Web Push nur auf Wunsch je Gerät (Spec `web-push`, „Inhalt der
-- Meldung nur auf Wunsch“).
--
-- `inhalt` = 1: die Person hat auf diesem Browser „Mit Absender und Wortlaut“ eingeschaltet.
-- Der Server legt dann `"inhalt": true` in die Nutzlast an dieses Abo; der Service Worker holt
-- Absender und Wortlaut selbst mit der Sitzung nach. Der Inhalt reist nie in der Nutzlast.
-- Vorgabe 0: Bestandsabos bleiben ohne Inhalt.
ALTER TABLE web_push_abo ADD COLUMN inhalt INTEGER NOT NULL DEFAULT 0 CHECK (inhalt IN (0, 1));
