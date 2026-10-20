-- LLH-1123: Tiere auf der Lagekarte. Koordinate des Fundorts direkt am Tier, wie
-- `einsatz_person.antreff_lat/antreff_lon`: beide NULL = nicht verortet, beide gesetzt = verortet.
-- Kein Mehrspalten-CHECK; das Paar sichert die App (routes::einsatz_tier, support::pruefe_koordinate).
-- Der Freitext `antreff_ort` bleibt daneben stehen.
ALTER TABLE einsatz_tier ADD COLUMN antreff_lat REAL;
ALTER TABLE einsatz_tier ADD COLUMN antreff_lon REAL;
