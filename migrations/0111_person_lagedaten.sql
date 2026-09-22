-- LFH-613: Lagedaten einer Person im Einsatz — Zustand, Fundort-Koordinate,
-- strukturierter Verbleib-Cache und „vermisst seit“.
--
-- einsatz_person ist Nicht-Leaf (Sichtung, Verbleib, Notizen, Abgleich, UHS-Belegung,
-- Audit, Schaden-Geschädigt verweisen darauf) → rein additiv per ADD COLUMN, kein Rebuild.
-- Alle Spalten sind nullable. Die Paarregel für antreff_lat/antreff_lon prüft der Handler
-- (422) gegen den effektiven Zustand, nicht ein DB-CHECK: ein CHECK hieße hier Rebuild
-- (design.md D1, Muster uhs.lat/lon).
ALTER TABLE einsatz_person ADD COLUMN zustand TEXT;                   -- Freitext, Gesundheitsdatum
ALTER TABLE einsatz_person ADD COLUMN antreff_lat REAL;               -- WGS84, Paar mit antreff_lon
ALTER TABLE einsatz_person ADD COLUMN antreff_lon REAL;
ALTER TABLE einsatz_person ADD COLUMN vermisst_seit TEXT;             -- 'YYYY-MM-DD HH:MM:SS' UTC
-- Denormalisierter Cache des jüngsten person_verbleib-Ereignisses, gepflegt in derselben
-- Transaktion wie aktueller_verbleib (verbleib_repo::erfassen).
ALTER TABLE einsatz_person ADD COLUMN aktuelle_verbleib_art TEXT;
ALTER TABLE einsatz_person ADD COLUMN aktuelles_verbleib_ziel TEXT;
ALTER TABLE einsatz_person ADD COLUMN aktueller_verbleib_status TEXT;

-- Backfill: Art, Ziel und Status des jüngsten Ereignisses je Person. Ordnung wie
-- verbleib_repo::liste_je_person (zeitpunkt_at DESC, id DESC) — der id-Tiebreak entscheidet
-- bei zwei Ereignissen in derselben Sekunde. Personen ohne Ereignis bleiben unberührt.
UPDATE einsatz_person SET
    aktuelle_verbleib_art = (
        SELECT v.art FROM person_verbleib v
        WHERE v.person_id = einsatz_person.id
        ORDER BY v.zeitpunkt_at DESC, v.id DESC LIMIT 1),
    aktuelles_verbleib_ziel = (
        SELECT v.ziel FROM person_verbleib v
        WHERE v.person_id = einsatz_person.id
        ORDER BY v.zeitpunkt_at DESC, v.id DESC LIMIT 1),
    aktueller_verbleib_status = (
        SELECT v.status FROM person_verbleib v
        WHERE v.person_id = einsatz_person.id
        ORDER BY v.zeitpunkt_at DESC, v.id DESC LIMIT 1)
WHERE EXISTS (SELECT 1 FROM person_verbleib v WHERE v.person_id = einsatz_person.id);

-- „vermisst seit“ für bereits vermisste Personen: geaendert_at ist die beste verfügbare
-- Näherung (der Zeitpunkt des Übergangs nach vermisst ist nicht gespeichert; eine spätere
-- Bearbeitung der Identitätsfelder hat geaendert_at seitdem womöglich verschoben).
UPDATE einsatz_person SET vermisst_seit = geaendert_at WHERE status = 'vermisst';
