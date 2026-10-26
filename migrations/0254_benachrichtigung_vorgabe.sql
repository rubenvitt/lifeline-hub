-- LLH-1421: Vorgabe je Funktion am Einsatz (Entwurf /mnt/project-files/llh-1421/design.md, D2;
-- Entscheidung Ruben zu LLH-1142 E2 = B). Die Einsatzleitung legt je Einsatz fest, für welche
-- Führungsfunktion (und für Mitglieder ohne Funktion) eine Benachrichtigungsart der Stufe Eingang
-- still ist. Dünn besetzt: eine Zeile gibt es nur für eine Art, die die Einsatzleitung gesetzt hat,
-- dann je Funktion eine. Fehlt sie, gilt die Vorgabe des Katalogs im Code
-- (`BenachrichtigungArt::vorgabe_still`, heute nur `lagebericht`).
--
-- `art` und `funktion` prüft nur Rust (`BenachrichtigungArt::vorgabe_einstellbar`,
-- `benachrichtigung::vorgabe::VorgabeFunktion`), wie `bezug_typ` in `benachrichtigung`: eine neue
-- Art braucht so keinen Tabellenumbau. `stufe` kennt nur Eingang (`hinweis`) und `still`; ein Alarm
-- ist nie einstellbar. Die Zeilen fallen mit dem Einsatz (CASCADE); wer zuletzt geändert hat,
-- bleibt nur, solange es das Konto gibt.
CREATE TABLE benachrichtigung_vorgabe (
    einsatz_id    INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    art           TEXT    NOT NULL,
    funktion      TEXT    NOT NULL,
    stufe         TEXT    NOT NULL CHECK (stufe IN ('hinweis', 'still')),
    geaendert_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    geaendert_von INTEGER REFERENCES benutzer(id) ON DELETE SET NULL,
    PRIMARY KEY (einsatz_id, art, funktion)
);
