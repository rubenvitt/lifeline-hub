-- Einheiten-Baum (einsatzbezogen). Zwei unabhängige optionale Referenzen:
-- abschnitt_id (wo die Einheit wirkt) und ueber_einheit_id (wem sie untersteht;
-- Selbstreferenz, Zyklen-Schutz app-seitig). typ_id verweist auf den Katalog.
-- fuehrer_id muss eine Person sein, deren einsatz_personal.einheit_id auf DIESE
-- Einheit zeigt (App-Validierung). Soll-Override (alle drei oder keiner); bei NULL
-- greift die Soll-Stärke des Typs.
CREATE TABLE einsatz_einheit (
    id                INTEGER PRIMARY KEY,
    einsatz_id        INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    abschnitt_id      INTEGER REFERENCES einsatzabschnitt(id),
    ueber_einheit_id  INTEGER REFERENCES einsatz_einheit(id),
    typ_id            INTEGER REFERENCES einheit_typ(id),
    name              TEXT NOT NULL,
    fuehrer_id        INTEGER REFERENCES einsatz_personal(id),
    soll_fuehrer      INTEGER,
    soll_unterfuehrer INTEGER,
    soll_mannschaft   INTEGER,
    bemerkung         TEXT,
    sortier           INTEGER NOT NULL DEFAULT 0,
    angelegt_at       TEXT NOT NULL DEFAULT (datetime('now')),
    angelegt_von      INTEGER REFERENCES benutzer(id)
);

CREATE INDEX idx_einsatz_einheit_einsatz ON einsatz_einheit(einsatz_id);
