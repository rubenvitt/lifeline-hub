-- LFH-673: Betreuungsstelle auf der Lagekarte. Koordinate direkt am Objekt, wie 0034 an der
-- UHS: beide NULL = nicht verortet, beide gesetzt = verortet. Kein Mehrspalten-CHECK — das
-- Paar sichert die App (Paar- und Bereichsprüfung in `betreuung::repo::stelle_aendern_tx`).
-- Der Freitext `standort` bleibt daneben stehen.
ALTER TABLE betreuungsstelle ADD COLUMN lat REAL;
ALTER TABLE betreuungsstelle ADD COLUMN lon REAL;
