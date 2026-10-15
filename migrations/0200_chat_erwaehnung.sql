-- LLH-1220: Erwähnungen einer Chat-Nachricht (Change kcjecn9e-benachrichtigungskonzept, design.md
-- D9). Der Client schickt mit der Nachricht die Liste der Erwähnten (ein Nutzer oder ein Code aus
-- dem Funktionskatalog), der Text trägt nur `@Anzeige`. Der Server parst den Text nicht: gleiche
-- Namen wären mehrdeutig.
--
-- Je Erwähnung eine Zeile; genau eines von `benutzer_id` und `funktion` ist gesetzt. Die Zeile
-- hängt an der Nachricht und fällt mit ihr (ON DELETE CASCADE), die Nachricht mit dem Einsatz.
-- Keine Freitextspalte: die Schwärzung braucht hier nichts zu scrubben.
--
-- `funktion` spiegelt `fuehrung::Fuehrungsfunktion::ALLE` (Guard
-- `fuehrung::tests::check_listen_entsprechen_dem_katalog`).
CREATE TABLE chat_erwaehnung (
    id           INTEGER PRIMARY KEY,
    nachricht_id INTEGER NOT NULL REFERENCES chat_nachricht(id) ON DELETE CASCADE,
    benutzer_id  INTEGER REFERENCES benutzer(id),
    funktion     TEXT CHECK (funktion IN ('el','s1','s2','s3','s4','s5','s6','s7','fuehrungshilfspersonal','fachberater')),
    CHECK ((benutzer_id IS NULL) <> (funktion IS NULL))
);

CREATE UNIQUE INDEX idx_chat_erwaehnung_nutzer
    ON chat_erwaehnung(nachricht_id, benutzer_id) WHERE benutzer_id IS NOT NULL;
CREATE UNIQUE INDEX idx_chat_erwaehnung_funktion
    ON chat_erwaehnung(nachricht_id, funktion) WHERE funktion IS NOT NULL;
