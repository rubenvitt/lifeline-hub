-- LLH-1482: „Stumm auf diesem Gerät“ auch für Web Push bei geschlossener App (Spec `web-push`,
-- „Push an jedes Abo der Empfänger“; Spec `benachrichtigungen`, „Stumm auf diesem Gerät“).
--
-- `stumm`: JSON-Liste der Eingangsarten (Wire-Werte von `BenachrichtigungArt`), die auf dem
-- Gerät dieses Abos stumm sind. Der Server schickt diesem Abo für eine solche Art keinen Push,
-- einen Alarm immer. Die Seite meldet die Liste mit jeder Anmeldung des Abos und nach jedem
-- Umschalten. Vorgabe '[]': Bestandsabos bleiben laut.
ALTER TABLE web_push_abo ADD COLUMN stumm TEXT NOT NULL DEFAULT '[]'
    CHECK (json_valid(stumm) AND json_type(stumm) = 'array');
