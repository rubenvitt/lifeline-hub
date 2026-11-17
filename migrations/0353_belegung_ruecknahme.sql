-- LLH-1924 (Change `bq8dvx19-loesen-nachziehen`, design.md D2): „Austragen“ lässt sich
-- zurücknehmen, ohne die Reihe umzuschreiben. Eine Rücknahme ist ein Eintritt, der auf den
-- Austritt verweist, den er zurücknimmt; beide Reihen bleiben nur anhängend (0029, 0061). Lesestellen
-- für „seit“ übergehen das Paar. Der eindeutige Teilindex erlaubt je Austritt höchstens eine
-- Rücknahme und trägt die Suche „ist dieser Austritt zurückgenommen?“.
ALTER TABLE br_belegung ADD COLUMN ruecknahme_von INTEGER REFERENCES br_belegung(id);
CREATE UNIQUE INDEX idx_br_belegung_ruecknahme
    ON br_belegung (ruecknahme_von) WHERE ruecknahme_von IS NOT NULL;

ALTER TABLE person_uhs_belegung ADD COLUMN ruecknahme_von INTEGER REFERENCES person_uhs_belegung(id);
CREATE UNIQUE INDEX idx_person_uhs_belegung_ruecknahme
    ON person_uhs_belegung (ruecknahme_von) WHERE ruecknahme_von IS NOT NULL;
