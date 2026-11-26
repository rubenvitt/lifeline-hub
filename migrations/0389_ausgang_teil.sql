-- LLH-2094: gesendete Teile eines Versands (Ausgang per Matrix, Spec
-- docs/superpowers/specs/2026-11-25-ntaizave-ausgang-matrix-design.md, Abschnitt 6,
-- „Doppelte Nachrichten vermeiden“).
--
-- Eine Zeile je gelungen gesendetem Teil eines Versands (Text = 0, Anlage n = n) mit der
-- Event-ID des Homeservers. Ein späterer Versuch oder „Erneut senden“ überspringt gemerkte
-- Teile. Der Lauf schreibt die Teile in derselben Transaktion wie das Ergebnis des Versuchs.
-- Die Zeilen hängen am Versand (ON DELETE CASCADE) und gehen mit ihm; sie werden wie `ausgang`
-- nicht gespiegelt (`instanz::spiegel::art::AUSGENOMMEN`). Bei SMTP entstehen keine Zeilen.

CREATE TABLE ausgang_teil (
    versand_id   TEXT NOT NULL REFERENCES ausgang(id) ON DELETE CASCADE,
    teil         INTEGER NOT NULL,
    event_id     TEXT NOT NULL,
    gesendet_at  TEXT NOT NULL,
    PRIMARY KEY (versand_id, teil)
);
