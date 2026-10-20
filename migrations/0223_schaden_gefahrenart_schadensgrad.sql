-- LLH-1115: Gefahrenart und Schadensgrad am Schaden (Change icj0hup1-schaden-gefahrenzeichen,
-- design.md D1). Beide optional; NULL heißt „keine Angabe“.
--
-- `gefahrenart`: dasselbe Vokabular wie `gefahr_bewertung.gefahrentyp` der Gefahrengebiete
-- (`gefahr::Gefahrentyp`, Gefahrenmatrix AAAA-C-EEEE), damit Schaden und Gefahrengebiet dieselben
-- Werte und Wörter tragen. `schadensgrad`: die drei Schadensgrade nach DV 102, Kap. 5.8.4.
--
-- Keine Zeichenkennungen in der Datenbank (LFH-835 D1): das Kartenzeichen bildet der Client beim
-- Lesen (`frontend/src/zeichen/fachobjektZeichen.ts`). Der Handler prüft die Werte zuerst und
-- antwortet mit 400; der CHECK ist nur das Netz. SQLite nimmt einen CHECK an `ADD COLUMN` ohne
-- Rebuild an (wie 0218). `NULL IN (…)` ist NULL, also erfüllt die leere Angabe den CHECK.
--
-- Rein additiv per ADD COLUMN, beide nullable, kein Backfill.
ALTER TABLE einsatz_schaden ADD COLUMN gefahrenart TEXT CHECK (gefahrenart IN (
    'atemgifte', 'angstreaktion', 'ausbreitung', 'atomare_strahlung', 'chemische_stoffe',
    'erkrankung_verletzung', 'explosion', 'elektrizitaet', 'einsturz', 'absturz', 'brand',
    'durchbruch', 'ertrinken'));
ALTER TABLE einsatz_schaden ADD COLUMN schadensgrad TEXT CHECK (schadensgrad IN (
    'angeschlagen', 'teilzerstoert', 'zerstoert'));
