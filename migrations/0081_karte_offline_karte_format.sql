-- LFH-185: Offline-Raster-Support. Explizites Kachel-Blob-Format je Offline-Karte, orthogonal zu
-- kachel_schema (das die VEKTOR-Layermenge benennt). Steuert Content-Type + gzip im Tile-Serving
-- und — gegröbert zu vektor/raster — die Style-Wahl im Frontend. Additiv (ADD COLUMN mit literalem
-- NOT-NULL-DEFAULT + CHECK ist in SQLite ohne Table-Rebuild erlaubt); DEFAULT 'pbf' hält das
-- Bestandsverhalten (Vektor/Shortbread) für alle vorhandenen Zeilen.
ALTER TABLE karte_offline_karte
    ADD COLUMN format TEXT NOT NULL DEFAULT 'pbf' CHECK (format IN ('pbf', 'png', 'jpg', 'webp'));
