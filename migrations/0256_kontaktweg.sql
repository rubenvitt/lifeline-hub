-- LLH-1419: Presse-Log und Betreuungsstelle trugen je ein Feld „erreichbarkeit“, das mit den
-- typisierten Verbindungen (LLH-1134, 0248) nichts zu tun hat. Beide heißen jetzt `kontaktweg`:
-- der Weg, auf dem man die Ansprechperson bzw. die Leitung erreicht (Rufnummer, E-Mail,
-- Funkkanal). Herkunft: 0129 (`medienkontakt.kontakt_erreichbarkeit`), 0226
-- (`betreuungsstelle.erreichbarkeit`). Werte bleiben; kein Index, Trigger oder View hängt daran.
ALTER TABLE medienkontakt RENAME COLUMN kontakt_erreichbarkeit TO kontaktweg;
ALTER TABLE betreuungsstelle RENAME COLUMN erreichbarkeit TO kontaktweg;
