-- LLH-1313 (Folge aus LLH-1122, Change ktc297tx-schichtmodell-je-vorlage, design.md D2/D3):
-- Eine Einsatz-Vorlage kann ein Schichtmodell der Organisation vorgeben. Beim Anlegen eines
-- Einsatzes mit dieser Vorlage kopiert `einsatz::repo::anlegen_tx` dieses Modell statt der
-- Org-Vorgabe an den Einsatz (`schichtmodell::repo::copy_vorgabe_tx`). NULL = die Vorlage gibt
-- keines vor.
--
-- Fremdschlüssel bewusst ohne ON-DELETE-Aktion: Das Entfernen der Demo-Daten wertet einen
-- Fremdschlüsselfehler als „behalten“ (`demo::entfernen`). Ein Demo-Modell, auf das eine echte
-- Vorlage zeigt, bleibt so stehen, statt die Vorlage still zu leeren (Guard
-- `kein_fk_kaskadiert_in_stammdaten`). Das Löschen durch den Admin löst die Verweise vorher
-- selbst (`schichtmodell::repo::delete`). Gleiche Organisation prüft das Repo beim Schreiben.
ALTER TABLE einsatz_vorlage
    ADD COLUMN schichtmodell_id INTEGER REFERENCES schichtmodell(id);

CREATE INDEX idx_einsatz_vorlage_schichtmodell
    ON einsatz_vorlage(schichtmodell_id) WHERE schichtmodell_id IS NOT NULL;
