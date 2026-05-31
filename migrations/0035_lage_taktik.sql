-- L‑2 Taktische Gliederung: Geo-/Symbol-Spalten direkt am jeweiligen Objekt
-- (entity-gekoppelt, analog L‑1/0034). Alle neuen Spalten nullable, kein
-- Default, kein Mehrspalten-CHECK; lat/lon werden von der App als Paar behandelt
-- (beide NULL = nicht verortet). tz_fachaufgabe/tz_organisation sind Lib-Schlüssel
-- (taktische-zeichen-core); tz_organisation am Objekt überschreibt den Org-Default.
ALTER TABLE einsatz_einheit  ADD COLUMN lat REAL;
ALTER TABLE einsatz_einheit  ADD COLUMN lon REAL;
ALTER TABLE einsatz_einheit  ADD COLUMN tz_fachaufgabe TEXT;
ALTER TABLE einsatz_einheit  ADD COLUMN tz_organisation TEXT;

ALTER TABLE einsatz_fahrzeug ADD COLUMN lat REAL;
ALTER TABLE einsatz_fahrzeug ADD COLUMN lon REAL;
ALTER TABLE einsatz_fahrzeug ADD COLUMN tz_fachaufgabe TEXT;
ALTER TABLE einsatz_fahrzeug ADD COLUMN tz_organisation TEXT;

ALTER TABLE einsatz_personal ADD COLUMN lat REAL;
ALTER TABLE einsatz_personal ADD COLUMN lon REAL;
ALTER TABLE einsatz_personal ADD COLUMN tz_fachaufgabe TEXT;
ALTER TABLE einsatz_personal ADD COLUMN tz_organisation TEXT;

ALTER TABLE einsatzabschnitt ADD COLUMN flaeche_geojson TEXT;  -- ein GeoJSON-Polygon
ALTER TABLE einsatzabschnitt ADD COLUMN tz_fachaufgabe TEXT;
ALTER TABLE einsatzabschnitt ADD COLUMN tz_organisation TEXT;

-- Org-Default für die DV-102-Organisation (z. B. DRK/ASB/JUH/MHD → hilfsorganisation).
ALTER TABLE organisation    ADD COLUMN tz_organisation TEXT;
UPDATE organisation SET tz_organisation = 'hilfsorganisation' WHERE tz_organisation IS NULL;
