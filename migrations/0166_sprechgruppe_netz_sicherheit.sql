-- LFH-1030: Netz und Sicherheit an der Sprechgruppe (BBK-Anhang J.5, Bedingungszeichen).
-- Optionaler Freitext, je höchstens `sprechgruppe::BEDINGUNG_MAX` Zeichen (geprüft im Handler).
-- Keine Übernahme aus `hinweis`: dort stehen beide nicht verlässlich trennbar.
ALTER TABLE sprechgruppe ADD COLUMN netz TEXT;
ALTER TABLE sprechgruppe ADD COLUMN sicherheit TEXT;
