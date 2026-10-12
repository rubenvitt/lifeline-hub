-- LLH-1175: an welche Einheiten sich ein ETB-Eintrag beim Schreiben richtete. Der ETB-Filter
-- „Einheit“ fand Auftragseinträge bisher über die AKTUELLEN Empfänger (`auftrag_empfaenger`);
-- seit ein Auftrag vor der ersten Quittung berichtigt werden kann (LLH-1098), ersetzt die
-- Berichtigung diese Zeilen, und alte Einträge wanderten zum neuen Empfänger. Diese Tabelle hält
-- den Kreis je Eintrag fest: geschrieben beim Koppeln eines Eintrags an seinen Auftrag
-- (`auftrag::repo::link_etb_tx`), die Anordnung „… geändert: Empfänger …“ trägt alten und
-- neuen Kreis.
--
-- Beide FKs ON DELETE CASCADE wie bei `etb_eintrag_anhang` (0125): die Einsatz-Löschung räumt
-- über `etb_eintrag` ab (CASCADE-Hülle, über die der Schwärzungs-Guard die Tabelle findet), und
-- eine gelöschte Einheit lässt sich ohnehin nicht mehr filtern. Der Primärschlüssel deckt die
-- Abfrage des Filters (`eintrag_id`, `einheit_id`) ab; der Index auf `einheit_id` trägt die
-- CASCADE beim Löschen einer Einheit, die sonst die ganze Tabelle läse.
CREATE TABLE etb_eintrag_einheit (
    eintrag_id INTEGER NOT NULL REFERENCES etb_eintrag(id) ON DELETE CASCADE,
    einheit_id INTEGER NOT NULL REFERENCES einsatz_einheit(id) ON DELETE CASCADE,
    PRIMARY KEY (eintrag_id, einheit_id)
);
CREATE INDEX idx_etb_eintrag_einheit_einheit ON etb_eintrag_einheit(einheit_id);

-- Bestand: die heutigen Empfänger, also genau das, was der Filter bisher zeigte. Für einen schon
-- berichtigten Auftrag ist der alte Kreis nicht mehr rekonstruierbar.
INSERT INTO etb_eintrag_einheit (eintrag_id, einheit_id)
SELECT DISTINCT e.id, ae.einheit_id
  FROM etb_eintrag e
  JOIN auftrag_empfaenger ae ON ae.auftrag_id = e.auftrag_id
 WHERE ae.empfaenger_typ = 'einheit' AND ae.einheit_id IS NOT NULL;
