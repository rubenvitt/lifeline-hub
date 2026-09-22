-- LFH-609: Zeitpunkt des letzten Statuswechsels („Seit“) für Fahrzeug und Einheit, dazu
-- der Handstatus einer Einheit ohne Fahrzeug (Rückfall; mit Fahrzeugen wird der Status
-- der Einheit aus ihnen abgeleitet). Bestandszeilen bleiben NULL: den Zeitpunkt früherer
-- Wechsel kennt niemand, und ein Nachfüllen aus disponiert_at wäre ein erfundener Wert.
ALTER TABLE einsatz_fahrzeug ADD COLUMN status_seit TEXT;
ALTER TABLE einsatz_einheit ADD COLUMN status_id INTEGER REFERENCES fahrzeug_status(id);
ALTER TABLE einsatz_einheit ADD COLUMN status_seit TEXT;
