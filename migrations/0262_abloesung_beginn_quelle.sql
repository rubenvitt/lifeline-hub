-- LLH-1312 (Folge aus LLH-1128, Epic LLH-1016): wie eine Schicht begann.
--
-- `einsatz_abloesung.beginn_quelle`: `hand` („Schicht beginnen“, auch mit dem übernommenen
-- Eintreffen als Zeitpunkt), `eintreffen` (Autostart mit dem Eintreffen, `abloesung::kopplung`)
-- oder `vollzug` (vom Vollzug neu angelegte Folgeschicht). Geschrieben nur beim Anlegen
-- (`abloesung::repo::create_schicht_tx`); ein geänderter Beginn macht aus `eintreffen` ein `hand`.
-- Eine beim Vollzug übernommene Schicht behält ihren Wert.
--
-- Bestand: sicher erkennbar ist nur die Folgeschicht (Vorgänger, nicht übernommen). Alles andere
-- bleibt `hand`; die Karte zeigt dafür den Text von vorher. Abgesichert von
-- db::tests::migration_0262_beginn_quelle.
ALTER TABLE einsatz_abloesung ADD COLUMN beginn_quelle TEXT NOT NULL DEFAULT 'hand'
    CHECK (beginn_quelle IN ('hand', 'eintreffen', 'vollzug'));

UPDATE einsatz_abloesung SET beginn_quelle = 'vollzug'
 WHERE vorgaenger_id IS NOT NULL AND uebernommen_bei_vollzug = 0;
