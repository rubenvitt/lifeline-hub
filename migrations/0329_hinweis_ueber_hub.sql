-- LLH-1495: Hinweise eines geführten Einsatzes reisen als Anlass zum Hub (Change
-- `lc02103g-bruecke-web-push`, design.md D2, D4).
--
-- 1. Fähigkeiten des Gegenübers aus seiner Meldeantwort (D4): nimmt es Hinweise an, bietet es
--    Web Push an. Vorgabe 0: ein älteres Gegenüber nennt beides nicht, der ELW pusht dann selbst.
ALTER TABLE instanz_kopplung ADD COLUMN gegenueber_hinweise INTEGER NOT NULL DEFAULT 0;
ALTER TABLE instanz_kopplung ADD COLUMN gegenueber_web_push INTEGER NOT NULL DEFAULT 0;

-- 2. Ausgang an der meldenden Seite (D2): je Anlass und Kopplung einer Org eine Zeile, bis die
--    erreichte Seite sie quittiert oder sie älter als 12 Stunden ist. `daten` ist der Anlass mit
--    den Kennungen dieser Instanz (JSON); abgebildet wird erst beim Senden. Die Kennung kehrt nie
--    wieder (AUTOINCREMENT): die erreichte Seite erkennt an ihr eine zweite Zustellung.
CREATE TABLE hinweis_ausgang (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    kopplung_org_id INTEGER NOT NULL REFERENCES instanz_kopplung_org(id) ON DELETE CASCADE,
    einsatz_id      INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    daten           TEXT NOT NULL,
    erstellt_at     TEXT NOT NULL
);
CREATE INDEX idx_hinweis_ausgang_kopplung ON hinweis_ausgang (kopplung_org_id, id);

-- 3. Eingang an der erreichten Seite (D2): welche Anlässe schon zu Hinweisen geführt haben.
--    `fingerabdruck` (Art, Bezug, Zeit): eine aus der Sicherung zurückgekehrte meldende Seite, die
--    eine Kennung erneut vergibt, wird nicht als Wiederholung verworfen. Geräumt nach 48 Stunden.
CREATE TABLE hinweis_eingang (
    kopplung_id    INTEGER NOT NULL REFERENCES instanz_kopplung(id) ON DELETE CASCADE,
    fremde_id      INTEGER NOT NULL,
    fingerabdruck  TEXT NOT NULL,
    angenommen_at  TEXT NOT NULL,
    PRIMARY KEY (kopplung_id, fremde_id)
);
