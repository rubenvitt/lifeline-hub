-- LLH-1224: Material-Modell A (Change mzldxwm7-material-modell-a, design.md D1, D4, D6, D12).
--
-- 1. Art am Stamm: ein einzeln verfolgtes Gerät oder ein Verbrauchsgut, Vorgabe Gerät. Die Art
--    des Bestands folgt aus der Bestandsnummer (0018: „nur für einzeln verfolgte Geräte“), sonst
--    aus den Mengen seiner Dispositionen; die Kategorie (Freitext) wird nicht gelesen.
ALTER TABLE material ADD COLUMN art TEXT NOT NULL DEFAULT 'geraet'
    CHECK (art IN ('geraet', 'verbrauchsgut'));

UPDATE material SET art = 'verbrauchsgut'
WHERE (bestandsnummer IS NULL OR trim(bestandsnummer) = '')
  AND EXISTS (SELECT 1 FROM einsatz_material em
              WHERE em.material_id = material.id AND em.menge > 1);

-- 2. Neubau der Disposition: SQLite kennt CHECKs über mehrere Spalten nur beim Anlegen. Die
--    Tabelle ist ein Blatt (kein `REFERENCES einsatz_material` unter migrations/), ohne Trigger
--    und Views; Muster 0193. Schema = 0019 + 0030 + 0193 + 0195 in derselben Spaltenfolge, dazu
--    am Ende `art` (ohne Vorgabe: jeder INSERT nennt sie), `ausgegeben` und die Ort-Spalten
--    `einsatz_fahrzeug_id` und `br_id`. Alle Orte ohne `ON DELETE` (NO ACTION): das Löschen des
--    Einsatzes nimmt Material und Orte in einer Anweisung mit. Höchstens EIN Ort je Posten.
--    Abgesichert von db::tests::migration_0197_*.
ALTER TABLE einsatz_material RENAME TO einsatz_material_alt;

CREATE TABLE einsatz_material (
    id              INTEGER PRIMARY KEY,
    einsatz_id      INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    material_id     INTEGER REFERENCES material(id),          -- NULL = Ad-hoc extern
    einheit_id      INTEGER REFERENCES einsatz_einheit(id),   -- Ort: Einheit
    menge           INTEGER NOT NULL DEFAULT 1 CHECK (menge >= 1),
    status          TEXT NOT NULL DEFAULT 'einsatzbereit'
                    CHECK (status IN ('einsatzbereit', 'im_einsatz', 'defekt', 'verbraucht', 'desinfektion_noetig')),
    snap_bezeichnung         TEXT NOT NULL,
    snap_kategorie           TEXT,
    snap_bestandsnummer      TEXT,
    snap_traegerorganisation TEXT,
    bemerkung       TEXT,
    disponiert_at   TEXT NOT NULL DEFAULT (datetime('now')),
    disponiert_von  INTEGER REFERENCES benutzer(id),
    uhs_id          INTEGER REFERENCES uhs(id),               -- Ort: Unfallhilfsstelle
    beendet_at      TEXT,
    beendet_von     INTEGER REFERENCES benutzer(id),
    beendet_als     TEXT CHECK (beendet_als IS NULL OR beendet_als IN ('entlassen', 'storniert')),
    zuletzt_entlassen_at TEXT,
    -- Art der Zeile, beim Disponieren aus dem Stamm kopiert; danach gilt sie für die Zeile.
    art             TEXT NOT NULL CHECK (art IN ('geraet', 'verbrauchsgut')),
    -- Ausgegebene Menge eines Verbrauchsguts; Rest = menge - ausgegeben (nicht gespeichert).
    ausgegeben      INTEGER NOT NULL DEFAULT 0 CHECK (ausgegeben >= 0 AND ausgegeben <= menge),
    einsatz_fahrzeug_id INTEGER REFERENCES einsatz_fahrzeug(id),  -- Ort: Fahrzeug (Beladung)
    br_id           INTEGER REFERENCES bereitstellungsraum(id),   -- Ort: Bereitstellungsraum
    -- Ein Gerät steht je Stück im Einsatz und kennt keine Ausgabe (D2).
    CHECK (art = 'verbrauchsgut' OR (menge = 1 AND ausgegeben = 0)),
    -- „verbraucht“ und „Desinfektion nötig“ gibt es nur für Geräte (D3).
    CHECK (art = 'geraet' OR status NOT IN ('verbraucht', 'desinfektion_noetig')),
    -- Höchstens ein Ort (D6); keiner heißt „ohne Ort“.
    CHECK ((einheit_id IS NOT NULL) + (einsatz_fahrzeug_id IS NOT NULL)
           + (uhs_id IS NOT NULL) + (br_id IS NOT NULL) <= 1)
);

-- 3. Übernahme (D12), ohne ETB; die Bemerkung trägt die Spur, angehängt mit Zeilenumbruch:
--    Zeilen-Art = Verbrauchsgut bei Menge > 1 oder Verbrauchsgut-Stamm; ein verbrauchtes
--    Verbrauchsgut ist danach ganz ausgegeben und einsatzbereit, eines zur Desinfektion defekt;
--    an Einheit UND UHS bleibt die UHS, die Einheit steht in der Bemerkung.
INSERT INTO einsatz_material
    (id, einsatz_id, material_id, einheit_id, menge, status, snap_bezeichnung, snap_kategorie,
     snap_bestandsnummer, snap_traegerorganisation, bemerkung, disponiert_at, disponiert_von,
     uhs_id, beendet_at, beendet_von, beendet_als, zuletzt_entlassen_at, art, ausgegeben,
     einsatz_fahrzeug_id, br_id)
SELECT
    id, einsatz_id, material_id,
    CASE WHEN uhs_id IS NOT NULL THEN NULL ELSE einheit_id END,
    menge,
    CASE
        WHEN neu_art = 'verbrauchsgut' AND status = 'verbraucht' THEN 'einsatzbereit'
        WHEN neu_art = 'verbrauchsgut' AND status = 'desinfektion_noetig' THEN 'defekt'
        ELSE status
    END,
    snap_bezeichnung, snap_kategorie, snap_bestandsnummer, snap_traegerorganisation,
    CASE
        WHEN zusatz IS NULL THEN bemerkung
        WHEN bemerkung IS NULL OR bemerkung = '' THEN zusatz
        ELSE bemerkung || char(10) || zusatz
    END,
    disponiert_at, disponiert_von, uhs_id, beendet_at, beendet_von, beendet_als,
    zuletzt_entlassen_at,
    neu_art,
    CASE WHEN neu_art = 'verbrauchsgut' AND status = 'verbraucht' THEN menge ELSE 0 END,
    NULL, NULL
FROM (
    SELECT z.*,
           CASE
               WHEN z.neu_art = 'verbrauchsgut' AND z.status = 'desinfektion_noetig'
                    AND z.einheit_name IS NOT NULL AND z.uhs_id IS NOT NULL
                   THEN 'Umstellung Material-Modell: Status vorher «Desinfektion nötig»'
                        || char(10)
                        || 'Umstellung Material-Modell: vorher zugleich Einheit «'
                        || z.einheit_name || '»'
               WHEN z.neu_art = 'verbrauchsgut' AND z.status = 'desinfektion_noetig'
                   THEN 'Umstellung Material-Modell: Status vorher «Desinfektion nötig»'
               WHEN z.einheit_name IS NOT NULL AND z.uhs_id IS NOT NULL
                   THEN 'Umstellung Material-Modell: vorher zugleich Einheit «'
                        || z.einheit_name || '»'
           END AS zusatz
    FROM (
        SELECT em.*,
               CASE WHEN em.menge > 1 OR m.art = 'verbrauchsgut'
                    THEN 'verbrauchsgut' ELSE 'geraet' END AS neu_art,
               ee.name AS einheit_name
        FROM einsatz_material_alt em
        LEFT JOIN material m ON m.id = em.material_id
        LEFT JOIN einsatz_einheit ee ON ee.id = em.einheit_id
    ) z
)
ORDER BY id;

DROP TABLE einsatz_material_alt;

CREATE INDEX idx_einsatz_material_einsatz ON einsatz_material(einsatz_id);
CREATE INDEX idx_einsatz_material_uhs ON einsatz_material(uhs_id);
CREATE INDEX idx_einsatz_material_einheit ON einsatz_material(einheit_id);
CREATE INDEX idx_einsatz_material_fahrzeug ON einsatz_material(einsatz_fahrzeug_id);
CREATE INDEX idx_einsatz_material_br ON einsatz_material(br_id);
