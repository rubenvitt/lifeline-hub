-- LLH-1498 (Nachzug aus LLH-1288): Altbestand verwaister Fahrzeuge im Bereitstellungsraum.
-- Seit LLH-1288 tritt ein Fahrzeug beim Zuordnen zu einer Einheit aus seinem Raum aus
-- (`belegung_repo::austritt_fahrzeuge_bei_zuordnung_tx`, Notiz „Einheit zugeordnet“). Wer vorher
-- so zugeordnet wurde, trägt weiter `einheit_id` UND `aktueller_br_id`: doppelt im Detail, „noch
-- n belegt“ zählt ihn, der Raum lässt sich nicht auflösen, Austragen scheitert mit 409.
--
-- Die Migration holt den Austritt nach, wie ihn das Zuordnen heute schreibt: je Fahrzeug eine
-- Zeile `austritt` im Raum des Caches, Notiz „Einheit zugeordnet“, Zeitpunkt = Einspielen; danach
-- den Cache leeren. Ohne betroffene Zeilen ein No-op.
--
-- `erfasst_von` ist Pflicht und lässt sich nicht mehr ermitteln (die Zuordnung schrieb kein
-- Ereignis). Angerechnet wird, wer das Fahrzeug zuletzt im Raum gebucht hat, sonst wer es
-- disponiert hat, sonst das erste Mitglied des Einsatzes, sonst der erste Benutzer der Org.
-- Findet sich niemand, entfällt nur die Verlaufszeile; der Cache wird trotzdem geleert.
-- Abgesichert von db::tests::migration_0272_*.

INSERT INTO br_belegung (einsatz_id, br_id, objekt_typ, objekt_id, art, notiz, erfasst_von)
SELECT einsatz_id, br_id, 'fahrzeug', ef_id, 'austritt', 'Einheit zugeordnet', von
  FROM (SELECT ef.id AS ef_id, ef.einsatz_id, ef.aktueller_br_id AS br_id,
               COALESCE(
                   (SELECT b.erfasst_von FROM br_belegung b
                     WHERE b.einsatz_id = ef.einsatz_id AND b.objekt_typ = 'fahrzeug'
                       AND b.objekt_id = ef.id
                     ORDER BY b.id DESC LIMIT 1),
                   ef.disponiert_von,
                   (SELECT MIN(m.benutzer_id) FROM einsatz_mitgliedschaft m
                     WHERE m.einsatz_id = ef.einsatz_id),
                   (SELECT MIN(u.id) FROM benutzer u
                     WHERE u.org_id = (SELECT e.org_id FROM einsatz e
                                        WHERE e.id = ef.einsatz_id))) AS von
          FROM einsatz_fahrzeug ef
         WHERE ef.einheit_id IS NOT NULL AND ef.aktueller_br_id IS NOT NULL)
 WHERE von IS NOT NULL
 ORDER BY ef_id;

UPDATE einsatz_fahrzeug
   SET aktueller_br_id = NULL
 WHERE einheit_id IS NOT NULL AND aktueller_br_id IS NOT NULL;
