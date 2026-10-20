-- LLH-1090: Beurteilung der Gefahrenmatrix je Gefahrengebiet.
--
-- Jede gültige Zelle der Matrix gilt bis zu einer anderen Wahl als Warnstufe „keine“; ob jemand
-- die Matrix angesehen hat, steht nicht mehr an den Zellen, sondern hier: wann und von wem die
-- Beurteilung zuletzt bestätigt oder (nach einer Bestätigung) durch eine Zelländerung
-- aufgefrischt wurde. NULL heißt „nicht beurteilt“, auch für den Bestand.
ALTER TABLE gefahrengebiet ADD COLUMN beurteilt_at TEXT;
ALTER TABLE gefahrengebiet ADD COLUMN beurteilt_von INTEGER REFERENCES benutzer(id);
