-- LFH-690: Demo-Daten zur Laufzeit. Ein Kopf je Import plus eine Herkunftsmarke an den
-- Stammdaten, die der Import neu angelegt hat (design.md D4).
--
-- Nur Stammdaten tragen eine Zeilenmarke. Alles im Demo-Einsatz fällt beim Entfernen über
-- die Kaskade von `einsatz`; eine Marke je ETB- oder Personenzeile wäre eine zweite Wahrheit.
--
-- `demo_import.einsatz_id` trägt bewusst KEINEN Fremdschlüssel: die Zeile bleibt nach dem
-- Entfernen als Historie stehen und sperrt die ID des entfernten Demo-Einsatzes gegen jede
-- spätere Einsatzanlage (D6, `einsatz::repo::anlegen_tx`).
--
-- Der partielle UNIQUE-Index ist die Regel „höchstens ein aktiver Import je Organisation“.
-- Der Precheck im Import liefert die präzise 409-Meldung, der Index hält das Rennen zweier
-- gleichzeitiger Importe.
--
-- `demo_herkunft` ist polymorph ohne FK auf die Stammdatentabelle. `tabelle` ist per CHECK
-- auf drei Werte beschränkt, das Löschen nutzt je Wert ein festes SQL-Literal.

CREATE TABLE demo_import (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    org_id         INTEGER NOT NULL REFERENCES organisation(id),
    einsatz_id     INTEGER NOT NULL,
    importiert_von INTEGER REFERENCES benutzer(id) ON DELETE SET NULL,
    importiert_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    entfernt_at    TEXT,
    bericht        TEXT    NOT NULL
);

CREATE UNIQUE INDEX idx_demo_import_aktiv ON demo_import(org_id) WHERE entfernt_at IS NULL;

CREATE TABLE demo_herkunft (
    import_id    INTEGER NOT NULL REFERENCES demo_import(id) ON DELETE CASCADE,
    tabelle      TEXT    NOT NULL CHECK (tabelle IN ('fahrzeug', 'personal', 'material')),
    datensatz_id INTEGER NOT NULL,
    PRIMARY KEY (tabelle, datensatz_id)
);
