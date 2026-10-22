-- LLH-1053: das tote „Zeitformat" (24h/12h) wird die „Zeitdarstellung" (taktisch/datum_uhrzeit).
-- Kein Formatierer hat 24h/12h je ausgewertet; die Altwerte gehen deshalb auf NULL (= Vorgabe,
-- taktisch), nichts Sichtbares geht verloren. Validierung in Rust
-- (`einsatz::einstellungen::Zeitdarstellung`), nicht per CHECK.
ALTER TABLE einsatz_einstellungen RENAME COLUMN zeitformat TO zeitdarstellung;
UPDATE einsatz_einstellungen SET zeitdarstellung = NULL WHERE zeitdarstellung IS NOT NULL;

ALTER TABLE org_einstellungen RENAME COLUMN zeitformat TO zeitdarstellung;
UPDATE org_einstellungen SET zeitdarstellung = NULL WHERE zeitdarstellung IS NOT NULL;
