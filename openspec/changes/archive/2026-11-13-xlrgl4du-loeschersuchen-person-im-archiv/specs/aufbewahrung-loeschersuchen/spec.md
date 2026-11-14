# Spec Delta

## MODIFIED Requirements

### Requirement: Antrag nur an abgeschlossenen, nicht geschwärzten Einsätzen

Das System SHALL einen Antrag nur für einen abgeschlossenen Einsatz annehmen, gleich in welchem
Aufbewahrungszustand er steht, solange er nicht geschwärzt ist. Für einen aktiven Einsatz MUST
es mit 409 antworten, für einen geschwärzten ebenfalls mit 409. Ausgenommen ist ein archivierter
Einsatz, also ein geschwärzter Einsatz, der noch mindestens einen Block im Archiv hat: Dort MUST
das System einen Antrag für den ganzen Einsatz und einen für eine Person annehmen. Keine
Ablehnung legt etwas an.

#### Scenario: Aktiver Einsatz
- **WHEN** der Admin einen Antrag für einen aktiven Einsatz stellt
- **THEN** antwortet das System mit 409 und legt keinen Antrag an

#### Scenario: Gesperrter Einsatz
- **WHEN** der Admin einen Antrag für einen zur Löschung vorgemerkten Einsatz stellt
- **THEN** nimmt das System den Antrag an

#### Scenario: Geschwärzter Einsatz
- **WHEN** der Admin einen Antrag für einen geschwärzten Einsatz ohne Archiv stellt
- **THEN** antwortet das System mit 409

#### Scenario: Archivierter Einsatz, Person
- **WHEN** der Admin für einen archivierten Einsatz einen Antrag für die Betroffene `R-042` stellt
- **THEN** nimmt das System den Antrag an

#### Scenario: Archiv abgelaufen
- **WHEN** alle Blöcke eines archivierten Einsatzes nach ihrer Frist gelöscht sind und der Admin einen Personen-Antrag stellt
- **THEN** antwortet das System mit 409

### Requirement: Ziel eines Antrags

Ein Antrag SHALL genau ein Ziel haben: den ganzen Einsatz oder genau eine Person dieses
Einsatzes. Personenarten sind Betroffene im Personenregister, ad hoc erfasste externe Kräfte und
Anrufende am Informationstelefon. Eine Person MUST sich als Ziel per ID oder per Kennung
(`R-042`, `EK-17`, `IT-5`) angeben lassen, aber nicht auf beide Arten zugleich. Eine unbekannte
Zielart oder eine Kennung, die nicht zur Zielart passt, MUST 400 liefern. Eine Person aus einem
anderen Einsatz oder eine Kennung ohne Person in diesem Einsatz MUST 404 liefern, eine aus den
Stammdaten disponierte Kraft 422. Die Zielart `medienkontakt` MUST für einen neuen Antrag 422
liefern; ein bestehender Antrag mit diesem Ziel MUST in der Archivakte mit Zielart, Kennung,
Aktenzeichen und Stand lesbar bleiben.

#### Scenario: Person aus anderem Einsatz
- **WHEN** der Admin einen Antrag für eine Person stellt, die zu einem anderen Einsatz gehört
- **THEN** antwortet das System mit 404

#### Scenario: Stammkraft
- **WHEN** der Admin einen Antrag für eine Personal-Disposition stellt, die auf eine Stammkraft verweist
- **THEN** antwortet das System mit 422

#### Scenario: Unbekannte Zielart
- **WHEN** die Anfrage eine Zielart nennt, die es nicht gibt
- **THEN** antwortet das System mit 400

#### Scenario: Medienkontakt als Ziel
- **WHEN** der Admin einen Antrag mit der Zielart `medienkontakt` stellt
- **THEN** antwortet das System mit 422 und legt keinen Antrag an

#### Scenario: Alter Antrag für einen Medienkontakt
- **WHEN** ein Einsatz vor dem Update einen vollzogenen Antrag für einen Medienkontakt trug und der Admin die Archivakte öffnet
- **THEN** steht der Antrag mit Zielart Medienkontakt, Kennung, Aktenzeichen und Stand in der Liste der Anträge

#### Scenario: Ziel per Kennung
- **WHEN** der Admin einen Antrag mit der Zielart Betroffene und der Kennung `R-042` stellt und der Einsatz die Betroffene mit der Registriernummer 42 führt
- **THEN** richtet sich der Antrag an diese Person

#### Scenario: Kennung ohne Person
- **WHEN** der Admin einen Antrag mit der Kennung `EK-999` stellt und es im Einsatz keine externe Kraft mit dieser Kennung gibt
- **THEN** antwortet das System mit 404

#### Scenario: Kennung passt nicht zur Zielart
- **WHEN** der Admin einen Antrag mit der Zielart Betroffene und der Kennung `IT-5` stellt
- **THEN** antwortet das System mit 400

### Requirement: Vollzug nach 24 Stunden

Das System SHALL einen offenen Antrag frühestens 24 Stunden nach dem Antrag vollziehen,
spätestens im ersten Purge-Lauf danach. Der Vollzug MUST mit dem Scrub, dem Kennzeichen
„vollzogen“ am Antrag und einem System-Eintrag im ETB in einem einzigen atomaren Vorgang
geschehen. Scheitert ein Teil, MUST nichts geschwärzt sein; der nächste Lauf versucht es erneut.
Eine Rücknahme nach dem Vollzug MUST es nicht geben. Ausgenommen ist ein Personen-Antrag an einem
archivierten Einsatz: Ihn MUST der Purge-Lauf offen lassen, er vollzieht sich nur über den Befehl
mit dem Archiv-Schlüssel.

#### Scenario: Innerhalb der 24 Stunden
- **WHEN** der Purge-Lauf 23 Stunden nach dem Antrag läuft
- **THEN** ist nichts geschwärzt, und der Antrag ist weiter offen

#### Scenario: Nach 24 Stunden
- **WHEN** der Purge-Lauf 24 Stunden nach dem Antrag läuft
- **THEN** ist das Ziel geschwärzt und der Antrag vollzogen

#### Scenario: Zweiter Lauf
- **WHEN** der Purge-Lauf danach erneut läuft
- **THEN** ändert er nichts und schreibt keinen weiteren Eintrag

#### Scenario: Personen-Antrag am archivierten Einsatz
- **WHEN** der Purge-Lauf 25 Stunden nach einem Antrag für `R-042` an einem archivierten Einsatz läuft
- **THEN** ist der Antrag weiter offen, und die Blöcke des Archivs sind unverändert

#### Scenario: Archiv inzwischen abgelaufen
- **WHEN** der letzte Block eines archivierten Einsatzes nach seiner Frist gelöscht ist und der Purge-Lauf danach einen offenen, fälligen Antrag für `R-042` dieses Einsatzes findet
- **THEN** gilt der Antrag als vollzogen, und das ETB nennt, dass der Einsatz bereits geschwärzt war

### Requirement: Anträge in der Archivakte

Die Archivakte SHALL die Anträge des Einsatzes führen, mit Ziel, Aktenzeichen, Antragszeitpunkt,
Fälligkeit, Stand (offen, zurückgenommen, vollzogen) und den beteiligten Personen. Ein offener
Antrag innerhalb der 24 Stunden MUST die Aktion „Zurücknehmen“ tragen. Das Register MUST eine
auf Antrag geschwärzte Person als solche kennzeichnen. Ohne offenen Antrag und an einem nicht
geschwärzten Einsatz MUST die Akte „Einsatz sofort schwärzen“ und „Person suchen und schwärzen“
anbieten. An einem archivierten Einsatz MUST sie stattdessen „Einsatz und Archiv löschen“ (ohne
offenen Einsatz-Antrag) und „Person per Kennung schwärzen“ anbieten, und ein offener
Personen-Antrag MUST dort den Hinweis tragen, dass er nach Ablauf der 24 Stunden auf den Befehl
mit dem Archiv-Schlüssel wartet.

#### Scenario: Offener Antrag
- **WHEN** der Admin die Akte eines Einsatzes mit einem vor 2 Stunden gestellten Antrag öffnet
- **THEN** sieht er den Antrag mit Fälligkeit und der Aktion „Zurücknehmen“

#### Scenario: Geschwärzter Einsatz
- **WHEN** der Admin die Akte eines geschwärzten Einsatzes ohne Archiv öffnet
- **THEN** fehlen alle Antragsaktionen

#### Scenario: Archivierter Einsatz
- **WHEN** der Admin die Akte eines archivierten Einsatzes ohne offenen Antrag öffnet
- **THEN** bietet sie „Einsatz und Archiv löschen“ und „Person per Kennung schwärzen“ an
- **AND** fehlt „Person suchen und schwärzen“

#### Scenario: Offener Personen-Antrag am Archiv
- **WHEN** der Admin die Akte eines archivierten Einsatzes mit einem vor 30 Stunden gestellten, offenen Antrag für `R-042` öffnet
- **THEN** trägt der Antrag den Hinweis, dass er auf den Befehl mit dem Archiv-Schlüssel wartet

### Requirement: Rückfrage vor dem Antrag

Vor dem Absenden SHALL eine Rückfrage stehen, die das Ziel pseudonym nennt, die
Unwiderruflichkeit nach 24 Stunden und die Fälligkeit benennt und Aktenzeichen sowie das
Eintippen der Kennung verlangt. Erst wenn beides ausgefüllt ist und die Kennung übereinstimmt,
MUST sich der Antrag absenden lassen. Für eine Person an einem archivierten Einsatz gibt es keine
angezeigte Kennung: Dort MUST das Eintippen einer gültigen Kennung (`R-…`, `EK-…`, `IT-…`)
zugleich das Ziel bestimmen und die Bestätigung sein; die Rückfrage MUST dann die Art der Person
zur eingetippten Kennung nennen.

#### Scenario: Kennung stimmt nicht
- **WHEN** der Admin in der Rückfrage für `R-042` die Kennung `R-04` eintippt
- **THEN** bleibt die Aktion zum Absenden gesperrt

#### Scenario: Person im Archiv
- **WHEN** der Admin am archivierten Einsatz in der Rückfrage „Person per Kennung schwärzen“ die Kennung `r-42` und ein Aktenzeichen eintippt
- **THEN** nennt die Rückfrage „Betroffene Person R-042“ und die Fälligkeit, und der Antrag lässt sich absenden

#### Scenario: Keine Kennung
- **WHEN** der Admin dort `X-1` eintippt
- **THEN** bleibt die Aktion zum Absenden gesperrt

## ADDED Requirements

### Requirement: Vollzug eines Personen-Antrags im Archiv

Ein Befehl mit einem privaten Archiv-Schlüssel der Organisation SHALL die fälligen
Personen-Anträge an archivierten Einsätzen vollziehen. Er MUST die Person in jedem Block des
Archivs schwärzen, wie der Vollzug eines Personen-Antrags es am Einsatz tut, und jeden Block an
die geprüften Archiv-Schlüssel der Organisation neu verschlüsseln. Nummer und Frist jedes Blocks
und alle übrigen Inhalte MUST gleich bleiben.

#### Scenario: Person in allen Blöcken
- **WHEN** ein Einsatz in zwei Blöcken archiviert ist, für `R-042` ein seit 25 Stunden offener Antrag besteht und der Befehl läuft
- **THEN** trägt `R-042` in keinem der beiden Blöcke mehr Name, Kontakt oder Notiz
- **AND** trägt `R-043` in beiden Blöcken unverändert Name und Kontakt
- **AND** haben beide Blöcke ihre Nummer und Frist behalten
- **AND** ist der Antrag vollzogen

#### Scenario: Noch nicht fällig
- **WHEN** der Befehl 23 Stunden nach dem Antrag läuft
- **THEN** ändert er nichts, und der Antrag ist weiter offen

#### Scenario: Falscher Schlüssel
- **WHEN** der Befehl mit einem Schlüssel läuft, der die Blöcke nicht öffnet
- **THEN** bricht er mit einer Meldung ab, und Blöcke und Antrag sind unverändert

#### Scenario: Keine geprüften Schlüssel mehr
- **WHEN** die Organisation keinen geprüften Archiv-Schlüssel mehr hat
- **THEN** bricht der Befehl für diesen Einsatz mit einer Meldung ab, und Blöcke und Antrag sind unverändert

#### Scenario: Zweiter Lauf zur selben Zeit
- **WHEN** ein zweiter Aufruf des Befehls den Antrag vollzieht, während der erste die Blöcke neu baut
- **THEN** ändert der erste nichts mehr, und es bleiben die Blöcke und die Spur des zweiten

### Requirement: Alte Blöcke nach dem Vollzug im Archiv

Nach dem Vollzug eines Personen-Antrags im Archiv SHALL kein Block mit dem früheren Inhalt mehr an
dieser Installation einspielbar sein. Eine hier eingespielte Kopie eines früheren Blocks MUST zum
Abräumen vorgemerkt werden. Heruntergeladene Blöcke und Kopien an anderen Installationen erreicht
der Vollzug nicht.

#### Scenario: Vorher heruntergeladener Block
- **WHEN** der Admin einen Block vor dem Vollzug heruntergeladen hat und ihn danach an dieser Installation einspielen will
- **THEN** lehnt der Befehl zum Einspielen ab, weil der Block hier nicht mehr im Archiv steht

#### Scenario: Eingespielte Kopie
- **WHEN** ein Block vor dem Vollzug hier eingespielt wurde
- **THEN** räumt der nächste Purge-Lauf die eingespielte Kopie ab

### Requirement: Spur des Vollzugs im Archiv

Der Vollzug eines Personen-Antrags im Archiv SHALL einen System-Eintrag im ETB des Einsatzes
schreiben, der Aktenzeichen, Personenart, Kennung und die Zahl der Blöcke nennt, und einen
Eintrag in der Admin-Spur unter „Person im Archiv geschwärzt“. Antrag, Blöcke, ETB-Eintrag und
Admin-Spur MUST in einem atomaren Vorgang entstehen. Name, Kontakt oder ein anderer
personengebundener Wert MUST in keinem der Einträge stehen.

#### Scenario: Spur ohne Namen
- **WHEN** der Antrag mit Aktenzeichen „DS-2026-014“ für `R-042` „Erika Mustermann“ im Archiv vollzogen wird
- **THEN** enthält das ETB einen System-Eintrag mit „DS-2026-014“, „R-042“ und der Zahl der Blöcke
- **AND** enthält die Admin-Spur einen Eintrag „Person im Archiv geschwärzt“ zum Einsatz
- **AND** enthält keiner der Einträge „Erika“ oder „Mustermann“

### Requirement: Personensuche im Archivblock

Ein Befehl mit einem privaten Archiv-Schlüssel der Organisation SHALL im gültigen Block eines
archivierten Einsatzes nach Name oder Kontakt suchen, wie die pseudonyme Personensuche es am
Einsatz tut. Er MUST je Treffer Personenart, Kennung und Namen im Terminal ausgeben und nichts am
Archiv ändern. Ein Suchtext unter 3 Zeichen MUST abgelehnt werden. Jede Suche MUST einen Eintrag
in der Admin-Spur unter „Archiv durchsucht“ schreiben, ohne den Suchtext.

#### Scenario: Treffer im Block
- **WHEN** der Admin im Archiv eines Einsatzes mit der Betroffenen „Erika Mustermann“ nach „mustermann“ sucht
- **THEN** nennt die Ausgabe die Art Betroffene, die Kennung `R-001` und den Namen

#### Scenario: Spur der Suche
- **WHEN** der Admin im Archiv nach „mustermann“ sucht
- **THEN** enthält die Admin-Spur einen Eintrag „Archiv durchsucht“ zum Einsatz ohne „mustermann“
