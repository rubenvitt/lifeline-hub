## ADDED Requirements

### Requirement: Material beim Bilden aus Vorlage
Das Bilden aus einer Vorlage SHALL die gewählten Material-Positionen in derselben Transaktion
disponieren. Ein Gerät MUST je Stück einen Posten mit Menge 1 ergeben, ein Gerät mit
Bestandsnummer genau einen; ein Verbrauchsgut MUST einen Posten mit der Menge der Position ergeben.
Art und Bestandsnummer MUST aus dem Stamm von jetzt stammen. Ort jedes Postens MUST das Fahrzeug
der Position sein, wenn es mitkommt, sonst die Einheit ihrer Vorlage. Eine Position, die nicht
(mehr) in der Vorlage steht, die außer Dienst steht oder deren Gerät mit Bestandsnummer schon aktiv
im Einsatz steht, MUST mit 422 und einem Grund an dieser Position abgelehnt werden, ohne dass etwas
angelegt ist.

#### Scenario: Rucksack auf dem RTW, Decken an der Staffel
- **WHEN** die Führung die Rettungsstaffel mit RTW 1, dem Rucksack auf RTW 1 und 50 Wolldecken bildet
- **THEN** liegt ein Posten Rucksack auf RTW 1 und ein Posten Wolldecke mit Menge 50 an der Rettungsstaffel

#### Scenario: Gerät mit Menge 3
- **WHEN** eine gewählte Position drei Sanitätsrucksäcke ohne Bestandsnummer nennt
- **THEN** entstehen drei Posten mit je Menge 1 am Ort der Position

#### Scenario: Fahrzeug kommt nicht mit
- **WHEN** die Führung RTW 1 abwählt, den Rucksack auf RTW 1 aber gewählt lässt
- **THEN** liegt der Rucksack an der Rettungsstaffel

#### Scenario: Gerät schon im Einsatz
- **WHEN** der gewählte Stromerzeuger „SE-1“ inzwischen aktiv im Einsatz steht
- **THEN** antwortet das System mit 422 und dem Grund „schon im Einsatz“ an dieser Position, und nichts ist angelegt

## MODIFIED Requirements

### Requirement: Ein ETB-Eintrag beim Bilden aus Vorlage
Ein erfolgreiches Bilden aus einer Vorlage SHALL in derselben Transaktion genau einen
ETB-Systemeintrag schreiben, der Einheit, Vorlage, Untereinheiten, Fahrzeuge, Kräfte, Material und
Umgehängtes nennt. Das Material MUST mit Menge und Bezeichnung je Position genannt werden; passt
die Liste nicht in die Grenze des Eintrags, MUST der Rest als Zahl erscheinen. Live-Ereignisse für
Einheiten, Fahrzeuge, Personal und Material MUST nach dem Commit folgen, auch für eine Einheit,
aus der umgehängt wurde.

#### Scenario: Ein Eintrag
- **WHEN** ein Zug mit Staffel, drei Fahrzeugen und zwei Kräften gebildet wird
- **THEN** steht im ETB genau ein neuer Systemeintrag „Einheit «…» aus Vorlage «…» gebildet“ mit allen Namen

#### Scenario: Material im Eintrag
- **WHEN** eine Staffel mit 50 Wolldecken und einem Rucksack gebildet wird
- **THEN** nennt derselbe Eintrag „Material: 50× Wolldecke, 1× Sanitätsrucksack“, und kein weiterer ETB-Eintrag entsteht

### Requirement: Bilden aus Vorlage ist gedeckelt
Die Anfrage MUST höchstens 50 Personen, 50 Fahrzeuge und 50 Material-Positionen annehmen, gezählt
vor dem Entdoppeln, und eine längere Liste mit 400 ablehnen, bevor etwas gelesen oder geschrieben
wird. Eine Vorlage mit mehr als 20 aktiven Einheiten im Baum MUST mit 422 abgelehnt werden. Die
Prüfung der Kräfte und des Materials MUST eine von ihrer Zahl unabhängige Zahl von Anweisungen
brauchen; geschrieben MAY je Kraft und je Posten werden.

#### Scenario: 51 Personen
- **WHEN** die Anfrage 51 Personen nennt
- **THEN** antwortet das System mit 400, und nichts ist angelegt

#### Scenario: 51 Material-Positionen
- **WHEN** die Anfrage 51 Material-Positionen nennt
- **THEN** antwortet das System mit 400, und nichts ist angelegt

#### Scenario: Zu große Vorlage
- **WHEN** der Baum der Vorlage 21 aktive Einheiten hat
- **THEN** antworten Vorschau und Bilden mit 422

### Requirement: Rechte beim Bilden aus Vorlage
Bilden aus einer Vorlage MUST Schreibrecht am Modul Einheiten verlangen, mit Fahrzeugen zusätzlich
das Modul Fahrzeuge, mit Personen das Modul Personal, mit Material das Modul Material, und sonst
mit 403 ablehnen, bevor etwas geschrieben wird. Eine fremde oder unbekannte Vorlage MUST 404, eine
deaktivierte 422 ergeben.

#### Scenario: Fahrzeuge gesperrt
- **WHEN** eine Rolle ohne Freigabe des Moduls Fahrzeuge mit Fahrzeugen aus einer Vorlage bildet
- **THEN** antwortet das System mit 403, und nichts ist angelegt

#### Scenario: Material gesperrt
- **WHEN** eine Rolle ohne Freigabe des Moduls Material mit Material aus einer Vorlage bildet
- **THEN** antwortet das System mit 403, und nichts ist angelegt
