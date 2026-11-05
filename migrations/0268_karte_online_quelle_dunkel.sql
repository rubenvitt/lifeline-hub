-- LLH-1486: Helligkeit einer Online-Grundlage. Die Lagekarte rastert ihre taktischen Zeichen auf
-- dunkler Grundlage mit dem Render-Theme `dark` (LLH-1141). Eine Online-Karte bringt ihren eigenen
-- Stil mit und folgt dem App-Thema nicht; sie gilt als hell, solange sie nicht als dunkel markiert
-- ist. Leaf-Spalte mit Default, kein Tabellen-Neubau.
ALTER TABLE karte_online_quelle ADD COLUMN dunkel INTEGER NOT NULL DEFAULT 0 CHECK (dunkel IN (0, 1));

-- Der einzige dunkle Eintrag des eingebauten Katalogs (`default_online_styles`), falls schon
-- übernommen: sonst stünden seine Zeichen nachts ab jetzt ohne helle Hinterlegung auf Schwarz.
UPDATE karte_online_quelle
   SET dunkel = 1
 WHERE rtrim(url, '/') = 'https://tiles.openfreemap.org/styles/dark';
