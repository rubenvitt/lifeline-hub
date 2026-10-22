-- LLH-1380: Eine Meldung lässt sich nachträglich zur Sofortmeldung heraufstufen und alarmiert dann
-- wie beim Erfassen, aber höchstens einmal je Meldung. Merker: der Sofortalarm dieser Meldung ist
-- ausgelöst. Invariante (gesetzt in `meldung::korrektur`): eine Meldung, die jetzt sofort ist oder
-- den Merker trägt, hat ihren Alarm gehabt. Herleitung: llh-1021/llh-1380/design.md, D1.
ALTER TABLE meldung ADD COLUMN sofortalarm_at TEXT;

-- Bestand: jetzt sofort, mit Sofort-Benachrichtigung oder laut Korrektur-Systemeintrag (LLH-1066)
-- von Sofort herabgestuft. Sie alarmierten beim Erfassen.
UPDATE meldung SET sofortalarm_at = eingang_at
WHERE meldungsart = 'sofortmeldung' OR prioritaet = 'sofort'
   OR id IN (SELECT bezug_id FROM benachrichtigung
             WHERE art = 'sofortmeldung' AND bezug_typ = 'meldung')
   OR id IN (SELECT meldung_id FROM etb_eintrag
             WHERE typ = 'system' AND meldung_id IS NOT NULL
               AND (inhalt LIKE '%Priorität Sofort →%' OR inhalt LIKE '%Art Sofortmeldung →%'));
