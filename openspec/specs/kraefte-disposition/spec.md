# kraefte-disposition Specification

## Purpose
Kräfte melden sich in Gruppen an. Mehrere Stamm-Personen oder Stamm-Fahrzeuge werden deshalb in
einem Schritt disponiert und gleich der Einheit und dem Fahrzeug zugeordnet, alles oder nichts,
mit einem Grund je Kraft, wenn eine nicht disponiert werden kann.

## Requirements

### Requirement: Mehrere Kräfte in einem Schritt disponieren
Das System SHALL mehrere Stamm-Personen eines Einsatzes in einer Anfrage disponieren und sie
optional einer Einheit und einem Fahrzeug des Einsatzes zuordnen. Ebenso SHALL es mehrere
Stamm-Fahrzeuge in einer Anfrage disponieren und optional einer Einheit zuordnen. Die Anfrage
MUST alles oder nichts anlegen. Für jede Person MUST der Initialstatus in der Kräfte-Zeitachse
stehen wie beim Einzelweg.

#### Scenario: Gruppe in Einheit und Fahrzeug
- **WHEN** neun Stamm-Personen mit Einheit „Rettungsstaffel“ und Fahrzeug „83-1“ disponiert werden
- **THEN** sind alle neun disponiert, der Rettungsstaffel zugeordnet und sitzen auf 83-1
- **AND** jede hat ihren Initialstatus in der Zeitachse

#### Scenario: Fahrzeuge in eine Einheit
- **WHEN** zwei Stamm-Fahrzeuge mit Ziel-Einheit „Sanitätszug“ disponiert werden
- **THEN** sind beide disponiert und dem Sanitätszug zugeordnet

### Requirement: Gründe je Kraft bei Ablehnung
Kann eine der Kräfte nicht disponiert werden (unbekannt oder fremd, außer Dienst, schon
disponiert, entlassen), MUST das System mit 422 antworten, nichts anlegen und je betroffener Kraft
einen Grund nennen. Die Prüfung MUST vor dem ersten Schreiben über die ganze Menge laufen.

#### Scenario: Eine Person außer Dienst
- **WHEN** von neun Personen eine außer Dienst steht
- **THEN** antwortet das System mit 422, nennt genau diese Person mit dem Grund „außer Dienst“
- **AND** keine der neun ist disponiert

#### Scenario: Eine Person entlassen
- **WHEN** von mehreren Stamm-Personen eine aus diesem Einsatz entlassen ist
- **THEN** antwortet das System mit 422 und nennt sie mit dem Grund „entlassen“
- **AND** sie wird nicht still wieder disponiert; ihr Weg zurück ist „Erneut disponieren“

### Requirement: Fahrzeug passt zur Einheit
Sind Einheit und Fahrzeug angegeben, MUST das Fahrzeug der Einheit zugeordnet sein; sonst MUST
das System mit 422 ablehnen. Ohne Einheit MAY jedes Fahrzeug des Einsatzes Ziel sein.

#### Scenario: Fremdes Fahrzeug
- **WHEN** Personen mit Einheit „Rettungsstaffel“ und einem Fahrzeug einer anderen Einheit disponiert werden
- **THEN** antwortet das System mit 422 und legt nichts an

### Requirement: Rechte der Zielmodule
Mit Ziel-Einheit MUST die Anfrage auch das Recht am Modul Einheiten, mit Ziel-Fahrzeug das Recht
am Modul Fahrzeuge verlangen und sonst mit 403 ablehnen, bevor etwas geschrieben wird. Die
Oberfläche MUST ein Zielfeld nur zeigen, wenn das Modul freigegeben ist.

#### Scenario: Einheiten gesperrt
- **WHEN** eine Rolle ohne Recht am Modul Einheiten Personal mit Ziel-Einheit disponiert
- **THEN** antwortet das System mit 403, und nichts ist angelegt

### Requirement: Ein ETB-Eintrag je Absenden
Eine erfolgreiche Sammel-Disposition SHALL genau einen ETB-Systemeintrag schreiben, der Zahl,
Ziel und die Namen der Kräfte nennt. Bei genau einer Kraft MUST der Wortlaut dem Einzelweg
entsprechen. Live-Ereignisse für Personal, Einheiten und Fahrzeuge MUST nach dem Commit folgen.

#### Scenario: Neun Kräfte
- **WHEN** neun Personen in einem Absenden disponiert werden
- **THEN** steht im ETB genau ein neuer Systemeintrag mit „9 Kräfte disponiert“ und allen neun Namen

### Requirement: Sammel-Dialog nach der Erfassungs-Norm
Der Dialog SHALL höchstens drei Felder sichtbar zeigen (Auswahl, Einheit, Fahrzeug), die Auswahl
über Name, Personalnummer, Träger und Qualifikation durchsuchbar machen und Demo-Einträge hinten
führen. Im Serienmodus MUST „Werte behalten“ die Einheit erhalten und die Auswahl leeren. Ein
Grund je Kraft MUST im Dialog an der Kraft stehen, nicht als Toast.

#### Scenario: Werte behalten
- **WHEN** der Nutzer im Serienmodus mit „Werte behalten“ eine Gruppe absendet
- **THEN** ist die Auswahl leer und die Einheit noch gewählt
