-- LLH-1568: Verbleib ergänzen (Change tfmoqftl-verbleib-ergaenzen, design.md D1, Spec
-- verbleib-angaben). Vier optionale Angaben am Verbleib-Ereignis:
--   leitstelle_einsatznummer  Einsatznummer der Leitstelle bei Transport durch ein fremdes
--                             Rettungsmittel (Freitext, Grenze im Handler)
--   entlassen_an              an wen entlassen wurde, nur bei art = 'entlassung'
--   gegen_rat                 was gegen Rat abgelehnt wurde, bei Entlassung und Transport
--   unterschrift              ob die Unterschrift dazu auf Papier vorliegt, nur mit gegen_rat
-- Die Paarung mit der Art prüft der Handler (422). ADD COLUMN mit CHECK braucht keinen Rebuild;
-- Bestand bleibt NULL (keine Angabe). Kein Cache an einsatz_person (design.md D1).
-- Abgesichert von db::tests::migration_0277_*.

ALTER TABLE person_verbleib ADD COLUMN leitstelle_einsatznummer TEXT;
ALTER TABLE person_verbleib ADD COLUMN entlassen_an TEXT
    CHECK (entlassen_an IS NULL
           OR entlassen_an IN ('selbst','begleitung','sorgeberechtigte','polizei'));
ALTER TABLE person_verbleib ADD COLUMN gegen_rat TEXT
    CHECK (gegen_rat IS NULL OR gegen_rat IN ('behandlung','transport'));
ALTER TABLE person_verbleib ADD COLUMN unterschrift TEXT
    CHECK (unterschrift IS NULL OR unterschrift IN ('liegt_vor','verweigert'));
