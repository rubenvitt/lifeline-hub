-- LFH-1045: Einsatzort einer Einsatzkraft an einer UHS (Spec `uhs-staerke`). NULL = an keiner
-- UHS (Default). Unabhängig von `einheit_id` (Mitgliedschaft) und `fahrzeug_id` (Besatzung):
-- ein Sanitäter der SEG 1 kann an der UHS Nord arbeiten, die SEG bleibt seine Einheit.
-- Die Stärke der UHS wird aus diesen Zeilen berechnet, nie gespeichert (keine zweite Wahrheit).
-- Auflösen und Stornieren der UHS lösen die Zuordnungen in derselben Transaktion; kein CASCADE
-- (wie `einsatz_material.uhs_id`, 0030).
ALTER TABLE einsatz_personal ADD COLUMN uhs_id INTEGER REFERENCES uhs(id);
CREATE INDEX idx_einsatz_personal_uhs ON einsatz_personal (uhs_id);
