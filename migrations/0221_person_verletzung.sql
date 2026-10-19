-- LLH-1113: Verletzungen einer Person am Körperschema als auswertbarer Datensatz (Change
-- y18v58dt-pat-kern, Spec `personen-verletzungen`, design.md D1/D4/D5).
--
-- Nur anhängend und genau einmal aufhebbar wie `person_massnahme` (0220): `aufgehoben_at`/
-- `aufgehoben_von_id` setzt ein bedingtes UPDATE (`… AND aufgehoben_at IS NULL`), ein zweites
-- Aufheben trifft keine Zeile mehr (409).
--
-- Wo: `ansicht` (vorn/hinten) und `region` aus dem festen Katalog, Seiten aus Sicht des
-- Patienten; Rücken, Wirbelsäule und Gesäß gibt es nur hinten, Gesicht, Thorax, Abdomen und
-- Becken nur vorn (der Handler prüft das zuerst mit 422, der CHECK ist das Netz). Optional die
-- Lage `x`/`y`, je 0 bis 1 normiert auf die Ansicht und nur als Paar. Was: `art`, optional
-- `schwere`. Dazu eine kurze `notiz` (Grenze `person::VERLETZUNG_NOTIZ_MAX` im Handler).
--
-- `zeitpunkt_at` ist die Erfassungszeit (gekappt über `support::erfassungszeitpunkt`),
-- `erfasst_at` die Ankunft; beide setzt der INSERT. „Bestätigt von“ wie 0165, `client_id` je
-- Einsatz eindeutig wie 0217.
CREATE TABLE person_verletzung (
    id                      INTEGER PRIMARY KEY AUTOINCREMENT,
    einsatz_id              INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    person_id               INTEGER NOT NULL REFERENCES einsatz_person(id),
    ansicht                 TEXT    NOT NULL CHECK (ansicht IN ('vorn', 'hinten')),
    region                  TEXT    NOT NULL CHECK (region IN ('kopf', 'gesicht', 'hals',
                                'thorax', 'abdomen', 'becken', 'ruecken', 'wirbelsaeule',
                                'gesaess', 'oberarm_l', 'oberarm_r', 'unterarm_l', 'unterarm_r',
                                'hand_l', 'hand_r', 'oberschenkel_l', 'oberschenkel_r',
                                'unterschenkel_l', 'unterschenkel_r', 'fuss_l', 'fuss_r')),
    art                     TEXT    NOT NULL CHECK (art IN ('wunde_blutung', 'fraktur_verdacht',
                                'verbrennung', 'prellung_schwellung', 'amputation', 'schmerz',
                                'sonstige')),
    schwere                 TEXT CHECK (schwere IN ('leicht', 'mittel', 'schwer')),
    x                       REAL CHECK (x >= 0 AND x <= 1),
    y                       REAL CHECK (y >= 0 AND y <= 1),
    notiz                   TEXT,
    zeitpunkt_at            TEXT    NOT NULL,
    erfasst_at              TEXT    NOT NULL,
    erfasst_von             INTEGER NOT NULL REFERENCES benutzer(id),
    bestaetigt_personal_id  INTEGER REFERENCES einsatz_personal(id) ON DELETE SET NULL,
    bestaetigt_name         TEXT,
    aufgehoben_at           TEXT,
    aufgehoben_von_id       INTEGER REFERENCES benutzer(id),
    client_id               TEXT,
    -- Die Schwärzung setzt `x` und `y` in einem UPDATE zugleich auf NULL.
    CHECK ((x IS NULL) = (y IS NULL)),
    CHECK (NOT (ansicht = 'vorn' AND region IN ('ruecken', 'wirbelsaeule', 'gesaess'))),
    CHECK (NOT (ansicht = 'hinten' AND region IN ('gesicht', 'thorax', 'abdomen', 'becken')))
);
CREATE INDEX idx_person_verletzung_person ON person_verletzung (person_id, zeitpunkt_at);
CREATE UNIQUE INDEX idx_person_verletzung_client_id
    ON person_verletzung(einsatz_id, client_id)
    WHERE client_id IS NOT NULL;
