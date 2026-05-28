-- E‑3: Plätze einer UHS (benannte 1:1-Slots; Inbox bleibt implizit über
-- platz_id=NULL in der Belegung). Layout-Koordinaten optional (NULL = noch
-- nicht platziert). Verfügbarkeit ist getrennt von Belegung: ein Platz kann
-- belegt UND defekt sein (informativ). Reservierung erfordert eine Ziel-Person.
CREATE TABLE uhs_platz (
    id                        INTEGER PRIMARY KEY AUTOINCREMENT,
    uhs_id                    INTEGER NOT NULL REFERENCES uhs(id) ON DELETE CASCADE,
    typ                       TEXT    NOT NULL
                              CHECK (typ IN ('wartebereich','behandlungsplatz',
                                             'bett','intensivplatz','trage',
                                             'transport_bereitstellung','sonstige')),
    bezeichnung               TEXT    NOT NULL,
    pos_x                     REAL,                  -- NULL = noch nicht platziert
    pos_y                     REAL,
    verfuegbarkeit            TEXT    NOT NULL DEFAULT 'frei'
                              CHECK (verfuegbarkeit IN ('frei','defekt','aufbereitung',
                                                        'gesperrt','reserviert')),
    reserviert_fuer_person_id INTEGER REFERENCES einsatz_person(id),
    storniert_at              TEXT,
    UNIQUE (uhs_id, bezeichnung),
    -- Reservierung erfordert eine Ziel-Person:
    CHECK (verfuegbarkeit <> 'reserviert' OR reserviert_fuer_person_id IS NOT NULL),
    -- Nicht-Reservierung hat keine Person:
    CHECK (verfuegbarkeit = 'reserviert' OR reserviert_fuer_person_id IS NULL)
);
CREATE INDEX idx_uhs_platz_uhs ON uhs_platz (uhs_id);
CREATE INDEX idx_uhs_platz_reserviert ON uhs_platz (reserviert_fuer_person_id);
