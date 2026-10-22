-- LLH-1134 (Entscheidung LLH-1126, Option B): Funk und Telefon getrennt. Abschnitt, Einheit und
-- eigene Führungsstelle tragen statt `kommunikationsmittel` + `erreichbarkeit` (0047, 0086, 0145)
-- typisierte Verbindungen wie die Stellen des Kommunikationsplans (0146): Mittel, Wert, Hinweis.
-- Funk zeigt sich an Rufname und Sprechgruppen; der Abschnitt bekommt dafür einen Rufnamen.
--
-- Eine Tabelle mit typisiertem Bezug und echten Fremdschlüsseln: die Kaskade räumt beim Löschen
-- eines Abschnitts oder einer Einheit mit, ohne dass jeder Löschpfad daran denken muss. Die
-- Führungsstelle ist eine Zeile je Einsatz; ihr Bezug ist `einsatz_id` selbst.
-- `einsatz_id` ist zugleich das Scoping der Schwärzung (`einsatz::schwaerzung_registry`).
-- Herleitung: LLH-1134 (Entwurf D1–D3); Regeln in Spec `stab-kommunikationsplan`,
-- „Verbindungen an Abschnitt, Einheit und Führungsstelle“.
CREATE TABLE einsatz_verbindung (
    id           INTEGER PRIMARY KEY,
    einsatz_id   INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    bezug        TEXT    NOT NULL CHECK (bezug IN ('abschnitt','einheit','fuehrungsstelle')),
    abschnitt_id INTEGER REFERENCES einsatzabschnitt(id) ON DELETE CASCADE,
    einheit_id   INTEGER REFERENCES einsatz_einheit(id) ON DELETE CASCADE,
    mittel       TEXT    NOT NULL CHECK (mittel IN ('festnetz','mobil','fax','email',
                                                 'messenger','melder','sonstiges')),
    wert         TEXT    NOT NULL, -- ≤ 200 Zeichen; Rufnummer/Adresse, PII
    hinweis      TEXT,             -- ≤ 200 Zeichen
    sortier      INTEGER NOT NULL,
    CHECK (
        (bezug = 'abschnitt' AND abschnitt_id IS NOT NULL AND einheit_id IS NULL) OR
        (bezug = 'einheit' AND einheit_id IS NOT NULL AND abschnitt_id IS NULL) OR
        (bezug = 'fuehrungsstelle' AND abschnitt_id IS NULL AND einheit_id IS NULL)
    )
);
CREATE INDEX idx_einsatz_verbindung_einsatz ON einsatz_verbindung(einsatz_id);
CREATE INDEX idx_einsatz_verbindung_abschnitt ON einsatz_verbindung(abschnitt_id)
    WHERE abschnitt_id IS NOT NULL;
CREATE INDEX idx_einsatz_verbindung_einheit ON einsatz_verbindung(einheit_id)
    WHERE einheit_id IS NOT NULL;

-- Funkrufname der Abschnittsleitung, z. B. „Florian Musterstadt 1/10-1“. Der Funkplan nimmt ihn
-- vor der Kurzbezeichnung.
ALTER TABLE einsatzabschnitt ADD COLUMN rufname TEXT;

-- Überführung (LLH-1126): `erreichbarkeit` wird eine Verbindung `mobil` bzw. `festnetz` nach
-- `kommunikationsmittel`, sonst `sonstiges` (auch `digitalfunk` und ein leeres Mittel).
-- Digitalfunk ohne Nummer entfällt. Die alten Spalten bleiben stehen und werden nicht mehr
-- geschrieben. Getestet in `einsatz::verbindungen::tests` (Überführung).
INSERT INTO einsatz_verbindung (einsatz_id, bezug, abschnitt_id, mittel, wert, sortier)
SELECT einsatz_id, 'abschnitt', id,
       CASE WHEN kommunikationsmittel IN ('mobil','festnetz') THEN kommunikationsmittel
            ELSE 'sonstiges' END,
       trim(erreichbarkeit), 1
FROM einsatzabschnitt
WHERE erreichbarkeit IS NOT NULL AND trim(erreichbarkeit) <> '';

INSERT INTO einsatz_verbindung (einsatz_id, bezug, einheit_id, mittel, wert, sortier)
SELECT einsatz_id, 'einheit', id,
       CASE WHEN kommunikationsmittel IN ('mobil','festnetz') THEN kommunikationsmittel
            ELSE 'sonstiges' END,
       trim(erreichbarkeit), 1
FROM einsatz_einheit
WHERE erreichbarkeit IS NOT NULL AND trim(erreichbarkeit) <> '';

INSERT INTO einsatz_verbindung (einsatz_id, bezug, mittel, wert, sortier)
SELECT einsatz_id, 'fuehrungsstelle',
       CASE WHEN kommunikationsmittel IN ('mobil','festnetz') THEN kommunikationsmittel
            ELSE 'sonstiges' END,
       trim(erreichbarkeit), 1
FROM einsatz_fuehrungsstelle
WHERE erreichbarkeit IS NOT NULL AND trim(erreichbarkeit) <> '';
