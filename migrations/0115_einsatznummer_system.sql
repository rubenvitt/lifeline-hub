-- Systemgenerierte Einsatznummer <Präfix><JJJJ>-<NNNN> (LFH-617).
--
-- Die Zählung läuft ab jetzt über eigene Zahlenspalten statt über die Zerlegung des
-- Textes (`substr(einsatznummer_intern, 6)` hing an der Präfixlänge 5). Der Text in
-- `einsatznummer_intern` bleibt die angezeigte Nummer; das Präfix wird beim Anlegen
-- eingefroren, damit ein späterer Präfixwechsel alte Aktenzeichen nicht mitändert.
-- Beide Spalten nullable: Altbestand ohne Nummer bleibt ohne Nummer.
ALTER TABLE einsatz ADD COLUMN nummer_jahr INTEGER;
ALTER TABLE einsatz ADD COLUMN nummer_lfd INTEGER;

-- Bestandsnummern aus der Vergabe seit 9c79e43c (`JJJJ-NNN`) zählen mit, damit die
-- Zählung im laufenden Jahr lückenlos weitergeht. NUR das exakte 3-stellige Muster:
-- ein Handwert wie `2026-01` neben `2026-001` ergäbe dasselbe Zahlenpaar und spränge
-- den Unique-Index unten. Beim exakten Muster sichert der Text-Index aus 0005 die
-- Eindeutigkeit bereits ab. Der Text selbst wird NICHT umgeschrieben.
UPDATE einsatz
   SET nummer_jahr = CAST(substr(einsatznummer_intern, 1, 4) AS INTEGER),
       nummer_lfd  = CAST(substr(einsatznummer_intern, 6) AS INTEGER)
 WHERE einsatznummer_intern GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9][0-9]';

-- Mehrere NULL gelten in SQLite als verschieden → Altbestand kollidiert nicht.
CREATE UNIQUE INDEX idx_einsatz_nummer_lfd ON einsatz(org_id, nummer_jahr, nummer_lfd);

-- Org-Nummernkreis-Präfix der Einsatznummer; NULL = 'E-'. Anders als die übrigen
-- Präfixe (0070) nicht display-only: es wird beim Anlegen in die Nummer übernommen.
ALTER TABLE org_einstellungen ADD COLUMN einsatz_nummer_praefix TEXT;
