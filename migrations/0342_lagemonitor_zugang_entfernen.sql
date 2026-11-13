-- LLH-1638 (Change f658d8o6-lage-fuer-maschinenzugaenge, design.md D9): Der Lesezugang für externe
-- Lagemonitore per Bearer-Schlüssel `llh_lm_…` (LLH-1484, Migration 0270) entfällt ohne
-- Übergang. Ein Lagemonitor liest als Maschinenzugang `GET /api/v1/lage`; die Freigabe der
-- Einsatzleitung steht in `maschinenzugang_freigabe` (0341_maschinenzugang_freigabe.sql).
--
-- Die Tabellen tragen nur Schlüssel-Hashes und Freigaben; bestehende Schlüssel gelten danach
-- nicht mehr. Die Einträge der Admin-Spur (`lesezugang_angelegt`, `lesezugang_widerrufen`)
-- bleiben stehen. Kind zuerst, dann braucht es kein `PRAGMA foreign_keys = OFF`.

DROP TABLE lagemonitor_freigabe;
DROP TABLE lagemonitor_zugang;
