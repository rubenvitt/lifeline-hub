-- LLH-1043: Absperr- und Gefahrenbereich als Kreis um einen Punkt (Speicherform a).
--
-- Die Zone bleibt ein Polygon (geodätische Näherung mit 64 Ecken, die der Server aus Mitte und
-- Radius rechnet); jeder Leser von Polygonen bleibt unverändert. Dazu die Kreisangaben, aus denen
-- Inspector und Beschriftung den Radius lesen und der Server das Polygon neu rechnet. Alle drei
-- gesetzt = Kreis, alle drei NULL = freie Fläche. Eine punktweise Bearbeitung der Geometrie nullt
-- sie (dann ist es kein Kreis mehr).
--
-- Reines ADD COLUMN, kein Rebuild: es fällt kein CHECK und kein Verweis an. Die Werte prüft die
-- App (Radius > 0 und ≤ `lage_zone::KREIS_RADIUS_M_MAX`, Mitte in WGS84), wie Typ × Geometrie
-- seit 0036 — ein DB-CHECK machte einen App-Fehler zur 500.
ALTER TABLE lage_zone ADD COLUMN kreis_mitte_lat REAL;
ALTER TABLE lage_zone ADD COLUMN kreis_mitte_lon REAL;
ALTER TABLE lage_zone ADD COLUMN kreis_radius_m REAL;
