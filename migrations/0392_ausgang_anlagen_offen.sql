-- LLH-2146: Teilzustellung eines Matrix-Versands (Spec
-- docs/superpowers/specs/2026-11-28-c4tmpqw1-matrix-teilzustellung-design.md).
--
-- `anlagen_offen`: der Versand ist endgültig `fehlgeschlagen`, der Text (Teil 0 in
-- `ausgang_teil`) ging aber hinaus, so viele Anlagen nicht. NULL heißt keine Teilzustellung.
-- Der Lauf schreibt die Zahl mit dem Ergebnis; „übergeben“ und „Erneut senden“ leeren sie.

ALTER TABLE ausgang ADD COLUMN anlagen_offen INTEGER
    CHECK (anlagen_offen IS NULL OR anlagen_offen > 0);
