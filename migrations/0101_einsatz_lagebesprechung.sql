-- LFH-463: Ein explizit gepflegter Termin; kein berechneter oder vorbelegter Rhythmus.
ALTER TABLE einsatz ADD COLUMN naechste_lagebesprechung_at TEXT;
