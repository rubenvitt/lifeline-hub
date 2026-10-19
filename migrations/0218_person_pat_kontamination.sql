-- LLH-1326: PAT-Nummer und Kontamination an der Person (Change y18v58dt-pat-kern, design.md
-- D3). Beide per PATCH, einzeln dreiwertig; NULL heißt „keine Angabe“, nicht „nein“.
--
-- `pat_nummer`: Nummer der Papier-Patientenanhängetasche zum Abgleich. Kurzer Freitext
-- (Grenze `person::PAT_NUMMER_MAX` im Handler), bewusst NICHT eindeutig je Einsatz: Felddaten
-- haben Tippfehler, und die App leitet aus der Nummer nichts ab.
-- `kontamination`: 1 = kontaminiert, 0 = nicht kontaminiert. `NULL IN (0, 1)` ist NULL, also
-- erfüllt der CHECK auch die leere Angabe (wie `geschlecht` in 0020).
--
-- Rein additiv per ADD COLUMN, beide nullable, kein Backfill.
ALTER TABLE einsatz_person ADD COLUMN pat_nummer TEXT;
ALTER TABLE einsatz_person ADD COLUMN kontamination INTEGER CHECK (kontamination IN (0, 1));
