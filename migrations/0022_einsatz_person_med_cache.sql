-- E‑2: denormalisierte Cache-Spalten für Liste/Filter/Lagebild. Jeder Sichtungs-/
-- Verbleib-Insert aktualisiert das jeweilige Feld in DERSELBEN Transaktion. Da
-- Zeitstempel Server-Jetzt sind, ist „jüngster Eintrag = zuletzt eingefügt"
-- garantiert (kein „bin ich der jüngste?"-Check nötig).
ALTER TABLE einsatz_person ADD COLUMN aktuelle_sichtung    TEXT;  -- NULL = ungesichtet
ALTER TABLE einsatz_person ADD COLUMN aktuelle_sichtung_at TEXT;
ALTER TABLE einsatz_person ADD COLUMN aktueller_verbleib   TEXT;  -- Kurzform letzter Verbleib; NULL = vor Ort
