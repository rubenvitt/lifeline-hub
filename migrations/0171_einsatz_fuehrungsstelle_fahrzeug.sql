-- LFH-1106: welche disponierten Fahrzeuge die eigene Führungsstelle tragen (etwa der ELW 2 der
-- Einsatzleitung). Null oder mehr je Einsatz, gepflegt über `PATCH …/fuehrungsstelle` mit
-- `fahrzeug_ids` wie die Sprechgruppen (0145). Entlassen löscht die Dispositionszeile und damit
-- über die Kaskade auch die Zuordnung.
CREATE TABLE einsatz_fuehrungsstelle_fahrzeug (
    einsatz_id          INTEGER NOT NULL REFERENCES einsatz(id)          ON DELETE CASCADE,
    einsatz_fahrzeug_id INTEGER NOT NULL REFERENCES einsatz_fahrzeug(id) ON DELETE CASCADE,
    PRIMARY KEY (einsatz_id, einsatz_fahrzeug_id)
);

CREATE INDEX idx_einsatz_fuehrungsstelle_fahrzeug_fz
    ON einsatz_fuehrungsstelle_fahrzeug(einsatz_fahrzeug_id);
