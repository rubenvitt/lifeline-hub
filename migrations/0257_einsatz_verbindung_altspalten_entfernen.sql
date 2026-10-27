-- LLH-1418 (Entscheidung Ruben 24.10.2026): Die Altspalten `kommunikationsmittel` und
-- `erreichbarkeit` an Abschnitt, Einheit und eigener Führungsstelle (0047, 0086, 0145) fallen weg.
-- 0248 hat ihre Werte nach `einsatz_verbindung` überführt; seitdem liest und schreibt sie niemand.
-- Der Rückweg entfällt bewusst. Keine der Spalten trägt einen Index, CHECK, Fremdschlüssel,
-- Trigger oder View; DROP COLUMN genügt. Getestet in `einsatz::verbindungen::tests`
-- (Überführung).
ALTER TABLE einsatzabschnitt DROP COLUMN kommunikationsmittel;
ALTER TABLE einsatzabschnitt DROP COLUMN erreichbarkeit;
ALTER TABLE einsatz_einheit DROP COLUMN kommunikationsmittel;
ALTER TABLE einsatz_einheit DROP COLUMN erreichbarkeit;
ALTER TABLE einsatz_fuehrungsstelle DROP COLUMN kommunikationsmittel;
ALTER TABLE einsatz_fuehrungsstelle DROP COLUMN erreichbarkeit;
