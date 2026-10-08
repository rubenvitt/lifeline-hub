-- LFH-1046: Bediener am Gerät. Ein gekoppeltes Gerät schreibt unter seinem Gerätekonto (0147);
-- Sichtung und Verbleib nennen darum das Gerät, nie die Person, die den Schritt verantwortet.
-- Am Gerät lässt sich optional eine Person aus dem Personal des Einsatzes als Bestätigende
-- angeben. Kennung und Namensschnappschuss stehen am Schritt; der Name bleibt lesbar, wenn die
-- Dispositionszeile später entfernt wird (ON DELETE SET NULL) oder sich ihr Name ändert.
-- Kein CHECK „beide oder keins“: die Schwärzung setzt den Namen allein auf NULL.
ALTER TABLE person_sichtung ADD COLUMN bestaetigt_personal_id INTEGER
    REFERENCES einsatz_personal(id) ON DELETE SET NULL;
ALTER TABLE person_sichtung ADD COLUMN bestaetigt_name TEXT;
ALTER TABLE person_verbleib ADD COLUMN bestaetigt_personal_id INTEGER
    REFERENCES einsatz_personal(id) ON DELETE SET NULL;
ALTER TABLE person_verbleib ADD COLUMN bestaetigt_name TEXT;
