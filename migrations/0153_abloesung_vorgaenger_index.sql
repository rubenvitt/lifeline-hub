-- Folgeschicht einer Ablösung (LFH-933): die Anzeige sucht je Schicht die jüngste Schicht,
-- deren `vorgaenger_id` (0114) auf sie zeigt (`MAX(id) … WHERE vorgaenger_id = a.id`). Ohne
-- Index ist das je Zeile ein Scan über die Ablösungen ALLER Einsätze der Instanz — bei jedem
-- Laden der Liste, die der Modulzähler in jedem offenen Einsatz-Tab abfragt. Derselbe Scan lief
-- beim Löschen einer Schicht für `ON DELETE SET NULL`.
--
-- Partiell: nur Folgeschichten tragen den Verweis, alle ersten Schichten tragen NULL und
-- gehören nicht in den Index.
CREATE INDEX idx_abloesung_vorgaenger
    ON einsatz_abloesung (vorgaenger_id)
    WHERE vorgaenger_id IS NOT NULL;
