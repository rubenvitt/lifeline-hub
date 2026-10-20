# Spec Delta

## Purpose

Hält fest, wer einen Patienten transportiert (fremdes Rettungsmittel oder Fahrzeug aus dem
Einsatz), wann ein Eigentransport am Ziel übergeben ist, und leitet daraus ab, ob ein Patient
noch offen, unterwegs oder abgeschlossen ist.

## ADDED Requirements

### Requirement: Transport nennt, wer fährt
Ein Verbleib `transport` SHALL angeben, ob ein fremdes Rettungsmittel fährt (`fremd`, mit dem
Rettungsmittel als Text) oder ein Fahrzeug aus dem Einsatz (`eigen`, mit der Disposition dieses
Fahrzeugs). Die Oberfläche MUST einen Transport ohne Rettungsmittel ablehnen. Andere
Verbleib-Arten MUST keine Fahrer-Angabe tragen.

#### Scenario: Fremdes Rettungsmittel
- **WHEN** für R-004 ein Verbleib Transport mit dem Rettungsmittel „RTW 3/83-2“ ohne Einsatzfahrzeug erfasst wird
- **THEN** trägt das Ereignis `transport_durch: "fremd"` und `transportmittel: "RTW 3/83-2"`

#### Scenario: Eigentransport
- **WHEN** für R-008 ein Verbleib Transport mit dem im Einsatz disponierten Fahrzeug „1/83-1“ erfasst wird
- **THEN** trägt das Ereignis `transport_durch: "eigen"`, die Disposition des Fahrzeugs und `transportmittel: "1/83-1"`

#### Scenario: Fahrer-Angabe bei anderer Art
- **WHEN** ein Verbleib `entlassung` mit `transport_durch: "eigen"` gesendet wird
- **THEN** antwortet der Server mit 422

#### Scenario: Transport ohne Rettungsmittel in der Maske
- **WHEN** in der Verbleib-Maske die Art Transport gewählt und das Rettungsmittel leer gelassen wird
- **THEN** wird nicht gespeichert, und das Feld nennt „Rettungsmittel angeben“

### Requirement: Eigentransport nur mit Fahrzeug aus dem Einsatz
Ein Eigentransport MUST auf eine Fahrzeug-Disposition desselben Einsatzes verweisen, die zur
Erfassungszeit bestand (disponiert davor, nicht vorher entlassen, nicht storniert). Fehlt der
Verweis, SHALL der Server mit 422 antworten; ein fremder oder unbekannter Verweis ergibt 404,
eine zur Erfassungszeit nicht bestehende Disposition 422.

#### Scenario: Ohne Fahrzeug
- **WHEN** ein Verbleib Transport mit `transport_durch: "eigen"` ohne `einsatz_fahrzeug_id` gesendet wird
- **THEN** antwortet der Server mit 422

#### Scenario: Fahrzeug eines anderen Einsatzes
- **WHEN** `einsatz_fahrzeug_id` auf eine Disposition eines anderen Einsatzes zeigt
- **THEN** antwortet der Server mit 404

#### Scenario: Entlassenes Fahrzeug bei vorgemerkter Erfassung
- **WHEN** ein offline vorgemerkter Eigentransport mit Erfassungszeit 10:00 ankommt und das Fahrzeug um 10:30 entlassen wurde
- **THEN** wird der Verbleib gespeichert

#### Scenario: Fahrzeug nach Entlassung gewählt
- **WHEN** ein Eigentransport mit Erfassungszeit 11:00 auf ein Fahrzeug zeigt, das um 10:30 entlassen wurde
- **THEN** antwortet der Server mit 422

### Requirement: Übergabe quittieren
Für einen Patienten im Eigentransport SHALL „Übergabe quittieren“ ein neues Verbleib-Ereignis
mit Status `uebergeben`, demselben Fahrzeug, dem Ziel und der Erfassungszeit anlegen (Vorgabe
jetzt, nachtragbar). Der Status `uebergeben` MUST nur mit `transport_durch: "eigen"` gelten,
sonst 422. Die Übergabe MUST ohne Netz vormerkbar sein wie jeder Verbleib.

#### Scenario: Übergabe am Krankenhaus
- **WHEN** R-008 im Eigentransport mit „1/83-1“ ist und jemand „Übergabe quittieren“ mit Ziel „KH Mitte“ und 10:42 speichert
- **THEN** trägt der Verlauf ein Ereignis Transport, eigen, „1/83-1“, `uebergeben`, „KH Mitte“ zu 10:42, und R-008 ist abgeschlossen

#### Scenario: Übergabe bei fremdem Rettungsmittel
- **WHEN** ein Verbleib mit `status: "uebergeben"` und `transport_durch: "fremd"` gesendet wird
- **THEN** antwortet der Server mit 422

#### Scenario: Ohne Netz
- **WHEN** die Übergabe ohne Verbindung gespeichert wird
- **THEN** steht am Ort „Offline vorgemerkt“, und der Abgleich legt das Ereignis mit der Erfassungszeit am Gerät an

### Requirement: Übergabe schließt den laufenden Eigentransport ab
Der aktuelle Verbleib der Person SHALL bei einer Übergabe ein nicht übergebener Eigentransport
mit demselben Fahrzeug sein, und die Übergabe MUST NOT vor ihm liegen, sonst 422. Ob das
Fahrzeug bei der Übergabe noch disponiert ist, MUST NOT zählen.

#### Scenario: Fahrzeug vor der Übergabe entlassen
- **WHEN** R-008 um 10:00 mit „1/83-1“ im Eigentransport ist, das Fahrzeug um 10:30 entlassen wird und die Übergabe um 10:45 quittiert wird
- **THEN** wird die Übergabe gespeichert, und R-008 ist abgeschlossen

#### Scenario: Übergabe ohne laufenden Eigentransport
- **WHEN** eine Übergabe für eine Person ohne Eigentransport, mit einem anderen Fahrzeug oder mit einer Zeit vor dem Beginn des Eigentransports gesendet wird
- **THEN** antwortet der Server mit 422, und die Person bleibt, wie sie war

### Requirement: Übergabe im ETB und in der Kurzform
Das ETB SHALL einen Eigentransport als „Person R-…: im Eigentransport“ und die Übergabe als
„Person R-…: übergeben“ führen, ohne Ziel und ohne Fahrzeug. Die Kurzform `aktueller_verbleib`
MUST bei fremdem Transport „Transport → Ziel“, bei Eigentransport „Eigentransport <Fahrzeug> →
Ziel“ und nach der Übergabe „übergeben → Ziel“ lauten (ohne Ziel jeweils ohne Pfeil).

#### Scenario: ETB eines Eigentransports
- **WHEN** für R-008 ein Eigentransport mit „1/83-1“ nach „KH Mitte“ erfasst wird
- **THEN** steht im ETB „Person R-008: im Eigentransport“, und die Kurzform lautet „Eigentransport 1/83-1 → KH Mitte“

#### Scenario: ETB der Übergabe
- **WHEN** die Übergabe von R-008 quittiert wird
- **THEN** steht im ETB „Person R-008: übergeben“, und die Kurzform lautet „übergeben → KH Mitte“

### Requirement: Versorgungszustand der Person
Jede Person SHALL den abgeleiteten Zustand `versorgung` mit `offen`, `unterwegs` oder
`abgeschlossen` tragen, berechnet aus ihrem jüngsten Verbleib. Abgeschlossen MUST sein: Transport
mit fremdem Rettungsmittel oder ohne Fahrer-Angabe, quittierte Übergabe, Entlassung,
Notunterkunft, Verbleib des Leichnams. Unterwegs MUST ein nicht übergebener Eigentransport sein.
Alles andere (kein Verbleib, „verbleibt vor Ort“, Transport `angemeldet`) MUST offen sein.

#### Scenario: Ableitung je Verbleib
- **WHEN** Personen mit Verbleib fremder Transport, Eigentransport, Eigentransport übergeben, Notunterkunft, vor Ort und ohne Verbleib geladen werden
- **THEN** tragen sie `abgeschlossen`, `unterwegs`, `abgeschlossen`, `abgeschlossen`, `offen` und `offen`

#### Scenario: Bestand vor der Änderung
- **WHEN** eine Datenbank mit einem Transport ohne Fahrer-Angabe migriert wird
- **THEN** trägt die Person `versorgung: "abgeschlossen"`, wie sie bisher als transportiert galt

#### Scenario: Gleiche Ableitung im Lagemonitor
- **WHEN** der Lagemonitor und das Lage-Dashboard dieselben Personen zählen
- **THEN** ergeben beide dieselbe Zahl je Versorgungszustand

### Requirement: Vermisste Personen bleiben offen
Eine Person im Status `vermisst` SHALL immer `versorgung: "offen"` tragen, auch mit einem älteren
Verbleib, damit sie nicht aus den Standardansichten fällt.

#### Scenario: Entlassene Person wird vermisst
- **WHEN** eine Person mit Verbleib „Entlassung vor Ort“ auf vermisst gesetzt wird
- **THEN** trägt sie `versorgung: "offen"` und steht wieder in der Liste

### Requirement: Vorschläge für das Rettungsmittel
Die Verbleib-Maske SHALL zum Rettungsmittel Vorschläge in drei Gruppen anbieten: „Im Einsatz“
(aktive Fahrzeug-Dispositionen; Wahl heißt Eigentransport), „Bisher verwendet“ (fremde
Rettungsmittel aus Verbleiben dieses Einsatzes) und „Fahrzeugstamm“ (Fahrzeuge der Organisation
im Dienst, die nicht im Einsatz disponiert sind). Freier Text MUST als fremdes Rettungsmittel
gelten. Die Vorschläge MUST mit Lesezugriff auf das Modul Personen abrufbar sein, auch am
UHS-Gerät.

#### Scenario: Einsatzfahrzeug wählen
- **WHEN** jemand im Feld „Rettungsmittel“ „1/83“ tippt und aus „Im Einsatz“ „1/83-1“ wählt
- **THEN** zeigt das Feld die Marke „Eigentransport“, und gespeichert wird ein Eigentransport mit diesem Fahrzeug

#### Scenario: Früher verwendetes Rettungsmittel
- **WHEN** im Einsatz schon zweimal „RTW 3/83-2“ als fremdes Rettungsmittel eingetragen wurde
- **THEN** steht „RTW 3/83-2“ einmal unter „Bisher verwendet“

#### Scenario: Text nach Wahl geändert
- **WHEN** jemand „1/83-1“ aus „Im Einsatz“ gewählt und danach den Text in „1/83-1 RD“ geändert hat
- **THEN** zeigt das Feld die Marke „fremdes Rettungsmittel“, und gespeichert wird ein fremder Transport

#### Scenario: UHS-Gerät ohne Modul Fahrzeuge
- **WHEN** ein gekoppeltes UHS-Tablet die Verbleib-Maske öffnet
- **THEN** zeigt sie die Fahrzeuge „Im Einsatz“, ohne dass das Gerät die Fahrzeugliste lesen darf

### Requirement: Vorschläge unter der Stellenbindung
Ein an eine Stelle gebundenes Gerät (UHS, Betreuungsstelle) SHALL „Bisher verwendet“ nur aus
Verbleiben seiner eigenen Personen bekommen, wie die Personenliste.

#### Scenario: Freitexte nur der eigenen Stelle
- **WHEN** in UHS Nord „KTW Nord“ und in UHS Süd „KTW Süd“ als fremdes Rettungsmittel eingetragen wurde und das Tablet von UHS Nord die Vorschläge lädt
- **THEN** steht unter „Bisher verwendet“ nur „KTW Nord“

### Requirement: Schwärzung von Fahrer-Angabe und Fahrzeug
Die Schwärzung einer Person SHALL den Rettungsmittel-Text eines Verbleib-Ereignisses leeren, auch
den als Momentaufnahme übernommenen Funkrufnamen. Fahrer-Angabe (`fremd`/`eigen`), Status und der
Verweis auf die Fahrzeug-Disposition MUST erhalten bleiben: sie tragen keinen Personenbezug, und
der Versorgungszustand bleibt nach der Schwärzung unverändert.

#### Scenario: Geschwärzter Eigentransport
- **WHEN** eine Person mit quittierter Übergabe geschwärzt wird
- **THEN** ist der Rettungsmittel-Text leer, und die Person trägt weiter `versorgung: "abgeschlossen"`
