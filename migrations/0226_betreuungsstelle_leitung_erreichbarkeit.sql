-- LLH-1044: Leitung und Erreichbarkeit einer Betreuungsstelle (Detailseite der Stelle).
--
-- Beides Freitext, optional, höchstens 200 Zeichen (`betreuung::LEITUNG_MAX`,
-- `betreuung::ERREICHBARKEIT_MAX`, geprüft in der Route). Personenbezogen (ein Name, eine
-- Rufnummer): die Schwärzung leert beide mit dem Einsatz (`einsatz/schwaerzung_registry.rs`),
-- kein Wert gelangt ins ETB, und der gesicherte Lagestand friert sie nicht ein.
--
-- Reines ADD COLUMN ohne CHECK: kein Rebuild, Bestandszeilen bekommen NULL.

ALTER TABLE betreuungsstelle ADD COLUMN leitung TEXT;
ALTER TABLE betreuungsstelle ADD COLUMN erreichbarkeit TEXT;
