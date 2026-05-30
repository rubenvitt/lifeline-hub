-- L‑1 Karten-Fundament: Geo-Koordinaten direkt am Objekt (entity-gekoppelt).
-- Beide NULL = nicht verortet, beide gesetzt = verortet. Kein Mehrspalten-CHECK
-- (folgt dem Einsatzort-Vorbild aus 0005); die App behandelt lat/lon als Paar.
-- Freitext standort/ort bleibt unverändert erhalten.
ALTER TABLE uhs             ADD COLUMN lat REAL;
ALTER TABLE uhs             ADD COLUMN lon REAL;
ALTER TABLE einsatz_schaden ADD COLUMN lat REAL;
ALTER TABLE einsatz_schaden ADD COLUMN lon REAL;
