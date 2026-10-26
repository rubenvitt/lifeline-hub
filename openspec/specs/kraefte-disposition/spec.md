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

### Requirement: Einheit aus Vorlage bilden
Das System SHALL aus einer aktiven Einheiten-Vorlage der eigenen Organisation in einer Anfrage
die Einheit samt allen aktiven Untereinheiten bilden. Die gewählten Fahrzeuge und Personen der
Vorlage MUST der Einheit ihrer Vorlage zugeordnet werden, eine Person auf dem Fahrzeug der
Vorlage, wenn es mitkommt. Die Anfrage MUST alles oder nichts anlegen. Kräfte, die nicht in der
Vorlage stehen, MUST NOT übernommen werden.

#### Scenario: Sanitätszug mit Rettungsstaffel
- **WHEN** die Führung aus „Sanitätszug Musterstadt“ mit allen Fahrzeugen und zwei Personen der Rettungsstaffel bildet
- **THEN** gibt es einen Zug mit unterstellter Rettungsstaffel
- **AND** ELW und beide RTW sind ihrer Einheit zugeordnet, und die zwei Personen sitzen auf ihrem RTW

#### Scenario: Fehler in der letzten Zeile
- **WHEN** von den gewählten Personen die letzte außer Dienst steht
- **THEN** antwortet das System mit 422, und weder Einheit noch Disposition noch Zuordnung ist angelegt

#### Scenario: Kraft außerhalb der Vorlage
- **WHEN** die Anfrage ein Fahrzeug nennt, das nicht in der Vorlage steht
- **THEN** antwortet das System mit 422 und nennt dieses Fahrzeug

### Requirement: Kopfdaten aus der Vorlage
Jede gebildete Einheit MUST Typ, Funkrufname und taktisches Zeichen ihrer Vorlage tragen, das
Soll nur, wenn die Vorlage ein eigenes hat. Nur die oberste Einheit MUST den gewählten Abschnitt
tragen und MAY einen abweichenden Namen tragen; Untereinheiten erben den Abschnitt.

#### Scenario: Zeichen und Soll
- **WHEN** die Rettungsstaffel der Vorlage ein Zeichen, aber kein eigenes Soll hat
- **THEN** trägt die gebildete Staffel dieses Zeichen, und als Soll wirkt das ihres Einheitstyps

### Requirement: Schon disponierte Kräfte zuordnen
Eine gewählte Kraft, die schon im Einsatz und frei ist, MUST zugeordnet statt neu disponiert
werden und ihre Stärke-Position behalten. Eine entlassene Kraft MUST erneut disponiert werden.

#### Scenario: Entlassene Person
- **WHEN** eine gewählte Person aus dem Einsatz entlassen war
- **THEN** ist sie erneut disponiert, der neuen Einheit zugeordnet und hat einen neuen Initialstatus in der Zeitachse

#### Scenario: Freies Fahrzeug
- **WHEN** der ELW schon disponiert ist und keiner Einheit angehört
- **THEN** wird er dem neuen Zug zugeordnet, ohne zweite Disposition

### Requirement: Umhängen nur auf Wunsch
Eine Kraft, die einer anderen Einheit angehört oder auf einem anderen Fahrzeug sitzt, MUST nur
mit ausdrücklichem Umhängen je Zeile übernommen werden; ohne es MUST das System mit 422 und einem
Grund an dieser Kraft ablehnen. Eine umgehängte Person, deren Fahrzeug der Vorlage nicht
mitkommt, MUST ohne Fahrzeug in der neuen Einheit stehen.

#### Scenario: Fahrzeug in einem anderen Zug
- **WHEN** RTW 2 dem „2. Zug“ angehört und ohne Umhängen gewählt ist
- **THEN** antwortet das System mit 422 und dem Grund „in «2. Zug»“ an RTW 2, und nichts ist angelegt

#### Scenario: Umhängen gewählt
- **WHEN** RTW 2 mit Umhängen gewählt ist
- **THEN** gehört RTW 2 der neuen Rettungsstaffel an, und der „2. Zug“ erhält ein Live-Ereignis

### Requirement: Zeitachse beim Bilden aus Vorlage
Neu und erneut disponierte Personen MUST ihren Initialstatus in der Kräfte-Zeitachse erhalten wie
beim Einzelweg. Zugeordnete Bestandskräfte, Fahrzeuge und die neuen Einheiten MUST NOT ein
Ereignis erhalten; die Einsatzdauer einer neuen Einheit beginnt mit ihrem ersten Fahrzeugstatus.

#### Scenario: Keine Einheitsereignisse
- **WHEN** ein Zug aus einer Vorlage gebildet wird
- **THEN** hat die Zeitachse Ereignisse nur für die neu disponierten Personen, keines für die Einheiten

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

### Requirement: Material beim Bilden aus Vorlage
Das Bilden aus einer Vorlage SHALL die gewählten Material-Positionen in derselben Transaktion
disponieren. Ein Gerät MUST je Stück einen Posten mit Menge 1 ergeben, höchstens 10 je Position,
ein Gerät mit Bestandsnummer genau einen; ein Verbrauchsgut MUST einen Posten mit der Menge der Position ergeben.
Art und Bestandsnummer MUST aus dem Stamm von jetzt stammen. Ort jedes Postens MUST das Fahrzeug
der Position sein, wenn es mitkommt, sonst die Einheit ihrer Vorlage. Eine Position, die nicht
(mehr) in der Vorlage steht, die außer Dienst steht oder deren Gerät mit Bestandsnummer schon aktiv
im Einsatz steht oder an einer früheren Position derselben Bildung vorkommt, MUST mit 422 und einem
Grund an dieser Position abgelehnt werden, ohne dass etwas angelegt ist.

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
