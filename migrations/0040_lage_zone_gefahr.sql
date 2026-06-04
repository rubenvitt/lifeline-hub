-- LFH-53: optionale Verknüpfung einer gefahrengebiet-Zone auf eine Matrix-Zelle.
-- Beide Spalten nullable; gültig nur GEMEINSAM und nur für typ='gefahrengebiet'.
-- Validierung (beide-oder-keine, gültige Enums/Kombination, nur gefahrengebiet) und
-- Lazy-Create der Zelle erzwingt die App, nicht die DB (Hauskonvention, kein Composite-FK).
ALTER TABLE lage_zone ADD COLUMN gefahrentyp  TEXT;
ALTER TABLE lage_zone ADD COLUMN schutzobjekt TEXT;
