-- LLH-1114: Ziel eines Auftrags („Ziel/Ort“) mit Koordinate (Ortsfeld mit Ortssuche).
--
-- Wie 0034 (UHS, Schaden), 0118 (Betreuungsstelle) und 0240 (Sammelstelle): beide NULL = nicht
-- verortet, beide gesetzt = verortet. Kein Mehrspalten-CHECK; das Paar, den Bereich und die Bindung
-- an den Text `ort` prüft die App (`auftrag::eingabe`, `auftrag::repo::berichtigen_tx`, 422). Die
-- Schwärzung leert die Koordinate wie den Text (`einsatz/schwaerzung_registry.rs`): das Ziel eines
-- Auftrags kann eine Privatadresse sein.
--
-- Reines ADD COLUMN ohne CHECK: kein Rebuild, Bestandszeilen bekommen NULL.

ALTER TABLE auftrag ADD COLUMN ort_lat REAL;
ALTER TABLE auftrag ADD COLUMN ort_lon REAL;
