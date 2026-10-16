-- LLH-1107: Bereitstellungsraum auf der Lagekarte. Koordinate direkt am Objekt wie 0118 an der
-- Betreuungsstelle: beide NULL = nicht verortet, beide gesetzt = verortet. Kein Mehrspalten-CHECK;
-- das Paar sichert die App (bereitstellungsraum::repo::update_tx, support::pruefe_koordinate).
-- Der Freitext `standort` bleibt daneben stehen.
ALTER TABLE bereitstellungsraum ADD COLUMN lat REAL;
ALTER TABLE bereitstellungsraum ADD COLUMN lon REAL;
