-- LFH-1181: die eigene Führungsstelle ist ein Ort mit Ausstattung. Art (mobil wie ELW 1/2, ortsfest
-- wie TEL im Rathaus), Bezeichnung und Standort (Adresse, Koordinate) neben den Funkangaben aus 0145.
-- Die Art ist nie leer: bestehende und lazy angelegte Zeilen sind `mobil` (Vorgabe). Die Koordinate
-- prüft die App als Paar und im Wertebereich (`routes::support::pruefe_koordinate`), wie beim
-- Einsatzort (0005) ohne CHECK. Herleitung:
-- `openspec/changes/lfh-1181-fuehrungsstelle-ort/design.md` (D1, D2).
ALTER TABLE einsatz_fuehrungsstelle
    ADD COLUMN art TEXT NOT NULL DEFAULT 'mobil' CHECK (art IN ('mobil', 'ortsfest'));
ALTER TABLE einsatz_fuehrungsstelle ADD COLUMN bezeichnung TEXT;
ALTER TABLE einsatz_fuehrungsstelle ADD COLUMN standort_adresse TEXT;
ALTER TABLE einsatz_fuehrungsstelle ADD COLUMN standort_lat REAL;
ALTER TABLE einsatz_fuehrungsstelle ADD COLUMN standort_lon REAL;
