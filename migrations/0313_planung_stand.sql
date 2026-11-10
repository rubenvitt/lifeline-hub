-- LLH-1610: Stand einer Planung für die Übernahme. `stand` zählt jede Änderung der Planung
-- (Kopf, Posten, Reihenfolge, Blöcke mit Personen, Helfer, Programmpunkte); Rust erhöht ihn in
-- jeder schreibenden Transaktion (`planung::repo::schreibbar_tx`). Die Vorschau der Übernahme
-- liefert ihn, die Übernahme schickt ihn zurück und ist 409, wenn er nicht mehr passt.
--
-- Bewusst nicht `version`: die zählt nur den Kopf und ist die CAS-Basis seines Editors, der sonst
-- bei jeder Änderung eines Blocks einen Konflikt meldete.
--
-- Abgesichert von db::tests::migration_0313_planung_stand.
ALTER TABLE planung ADD COLUMN stand INTEGER NOT NULL DEFAULT 0 CHECK (stand >= 0);
