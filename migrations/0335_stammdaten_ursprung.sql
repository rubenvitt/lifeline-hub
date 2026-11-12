-- LLH-1497 (Change t10a7luh-elw-lan-direktkopplung, design.md D5): Ursprungskennung je
-- übernommener Stammdatenzeile, `<instanzkennung>/<schlüssel>` der Instanz, die sie angelegt hat.
-- Zwei Instanzen, die dieselbe Zeile aus derselben Quelle haben, erkennen sie daran als dieselbe,
-- auch über eine Kopplung ohne Stammdatenfluss (Direktkopplung vor Ort). Lokal angelegte Zeilen
-- speichern nichts: ihre Ursprungskennung ist die eigene Instanz mit dem lokalen Schlüssel.
ALTER TABLE stammdaten_herkunft ADD COLUMN ursprung TEXT;

-- Bestand: die Quelle hat die Zeile selbst angelegt (bis LLH-1497 liefert keine Instanz
-- übernommene Zeilen weiter). Die nächste Lieferung mit Protokoll 3 berichtigt jede Zeile.
UPDATE stammdaten_herkunft
   SET ursprung = (SELECT k.gegenueber_kennung FROM instanz_kopplung_org o
                     JOIN instanz_kopplung k ON k.id = o.kopplung_id
                    WHERE o.id = stammdaten_herkunft.kopplung_org_id)
                  || '/' || fremder_schluessel;

CREATE INDEX idx_stammdaten_herkunft_ursprung ON stammdaten_herkunft (org_id, art, ursprung);
