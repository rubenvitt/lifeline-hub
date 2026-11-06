# verbleib-angaben Specification

## Purpose
Ergänzt den Verbleib einer Person um die Einsatznummer der Leitstelle, an wen entlassen wurde
und ob der Patient gegen Rat Behandlung oder Transport abgelehnt hat (LLH-1568, Konzept
Sanitätsdienst LLH-1562, Abschnitt 5.4).

## Requirements

### Requirement: Einsatznummer der Leitstelle beim fremden Transport
Ein Verbleib `transport` ohne Eigentransport SHALL eine optionale Einsatznummer der Leitstelle
tragen (Freitext, getrimmt, höchstens 50 Zeichen). Bei jeder anderen Art, beim Eigentransport und
an einer Übergabe MUST der Server sie mit 422 ablehnen; über 50 Zeichen ist 400.

#### Scenario: Transport mit Einsatznummer
- **WHEN** für R-004 ein Verbleib Transport mit dem Rettungsmittel „RTW 3/83-2“ und der Einsatznummer „ 2611-0815 “ erfasst wird
- **THEN** trägt das Ereignis `leitstelle_einsatznummer: "2611-0815"`

#### Scenario: Einsatznummer beim Eigentransport
- **WHEN** ein Verbleib Transport mit `transport_durch: "eigen"` und einer Einsatznummer gesendet wird
- **THEN** antwortet der Server mit 422

### Requirement: Entlassung nennt, an wen
Ein Verbleib `entlassung` SHALL optional nennen, an wen entlassen wurde: `selbst`, `begleitung`,
`sorgeberechtigte` oder `polizei`. Ein unbekannter Wert MUST 400 ergeben, die Angabe bei einer
anderen Art 422.

#### Scenario: Übergabe an die Polizei
- **WHEN** für R-012 eine Entlassung mit `entlassen_an: "polizei"` erfasst wird
- **THEN** zeigt der Verlauf „entlassen an Polizei“, und das ETB nennt nur „Person R-012: entlassen“

#### Scenario: Entlassen an beim Transport
- **WHEN** ein Verbleib Transport mit `entlassen_an: "selbst"` gesendet wird
- **THEN** antwortet der Server mit 422

### Requirement: Gegen Rat abgelehnt
Ein Verbleib `entlassung` oder `transport` (außer einer Übergabe) SHALL optional festhalten, dass
der Patient gegen Rat die Behandlung (`behandlung`) oder den Transport (`transport`) abgelehnt hat,
und dazu optional, ob die Unterschrift auf Papier vorliegt (`liegt_vor`) oder verweigert wurde
(`verweigert`). Zeitpunkt ist die Erfassungszeit des Verbleibs. Eine Unterschrift ohne Ablehnung
und eine Ablehnung bei anderer Art MUST 422 ergeben.

#### Scenario: Transport abgelehnt
- **WHEN** für R-015 eine Entlassung mit `gegen_rat: "transport"` und `unterschrift: "liegt_vor"` erfasst wird
- **THEN** zeigt der Verlauf „entlassen · gegen Rat: Transport abgelehnt, Unterschrift liegt vor“

#### Scenario: Unterschrift ohne Ablehnung
- **WHEN** eine Entlassung mit `unterschrift: "verweigert"` ohne `gegen_rat` gesendet wird
- **THEN** antwortet der Server mit 422

### Requirement: Angaben in der einen Verbleib-Maske
Die Verbleib-Maske SHALL die Angaben je Art anbieten, im Patientenkopf, im Verbleib-Dialog von
Liste und Grundriss und am UHS-Gerät, und ohne Netz mit dem Verbleib vormerken. Der Body MUST nur
die Angaben tragen, die zur gewählten Art passen.

#### Scenario: Artwechsel nach Eingabe
- **WHEN** in der Maske erst Entlassung mit „Entlassen an: Polizei“ und danach Transport gewählt und erfasst wird
- **THEN** geht `entlassen_an` nicht mit

### Requirement: Anzeige in Verlauf und Druck
Verlauf und Patientenkopf SHALL die Angaben an der Kurzform des Verbleibs zeigen, die
Druckansicht der Person im Block „Lage“ als Zeile „Verbleib“.

#### Scenario: Druckansicht
- **WHEN** die Druckansicht von R-012 nach einer Entlassung an die Polizei geöffnet wird
- **THEN** steht im Block „Lage“ „Verbleib: entlassen an Polizei · <Zeit>“

### Requirement: Schwärzung der Verbleib-Angaben
Die Einsatznummer der Leitstelle SHALL mit der Kategorie „Behandlung“ geschwärzt werden; die
Katalogwerte `entlassen_an`, `gegen_rat` und `unterschrift` bleiben als anonymes
Statistik-Skelett. Das ETB MUST keine der Angaben enthalten.

#### Scenario: Behandlung geschwärzt
- **WHEN** die Kategorie „Behandlung“ eines Einsatzes geschwärzt wird
- **THEN** ist `leitstelle_einsatznummer` leer, `gegen_rat` bleibt stehen
