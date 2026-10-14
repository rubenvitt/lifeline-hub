-- LLH-1067: Einsatzfunktion einer Kraft im Einsatz (Change u0l120e7-einsatzfunktion, design.md
-- D1/D2). Was jemand gerade tut (Sprechfunker, Melder, Maschinist), getrennt von dem, was er
-- kann: `snap_funktion` bleibt der Qualifikationstext. Freitext, optional, höchstens 200 Zeichen
-- (`personal::EINSATZFUNKTION_MAX`, geprüft in der Route). Bestand bleibt leer.
ALTER TABLE einsatz_personal ADD COLUMN einsatzfunktion TEXT;
