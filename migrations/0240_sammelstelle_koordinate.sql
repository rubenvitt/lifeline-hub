-- LLH-1121: Sammelstelle eines Evakuierungsbezirks mit Koordinate (Ortsfeld mit Ortssuche).
--
-- Wie 0034 (UHS, Schaden) und 0118 (Betreuungsstelle): beide NULL = nicht verortet, beide gesetzt
-- = verortet. Kein Mehrspalten-CHECK; das Paar und den Bereich prüft die App
-- (`betreuung::repo::bezirk_anlegen_tx`/`bezirk_aendern_tx`, 422). Der Freitext `sammelstelle`
-- bleibt daneben stehen. Die Schwärzung leert den Text und behält die Koordinate als
-- Geo-Skelett wie `betreuungsstelle.lat/lon` (`einsatz/schwaerzung_registry.rs`).
--
-- Reines ADD COLUMN ohne CHECK: kein Rebuild, Bestandszeilen bekommen NULL.

ALTER TABLE evakuierungsbezirk ADD COLUMN sammelstelle_lat REAL;
ALTER TABLE evakuierungsbezirk ADD COLUMN sammelstelle_lon REAL;
