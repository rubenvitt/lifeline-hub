# aufbewahrung-loeschersuchen Specification

## Purpose
Der Org-Admin kommt einem Löschersuchen nach Art. 17 DSGVO nach, ohne auf Frist und Karenz der
fristbasierten Aufbewahrung zu warten: für den ganzen Einsatz oder für genau eine Person, mit
24 Stunden Rücknahmefrist, pseudonymem Audit und einem Nachweis des Antrags.

## Requirements

### Requirement: Antrag nur durch den Org-Admin

Einen Schwärzungsantrag stellen, zurücknehmen und die Anträge eines Einsatzes lesen SHALL nur
ein System-Admin, und nur für Einsätze seiner eigenen Organisation. Alle anderen Personen MUST
403 erhalten, auch Einsatzleitung und org-weite Führungskraft. Ein Einsatz einer fremden
Organisation MUST 403 liefern, ein unbekannter Einsatz 404.

#### Scenario: Admin der eigenen Organisation
- **WHEN** ein System-Admin für einen abgeschlossenen Einsatz seiner Organisation einen gültigen Antrag stellt
- **THEN** antwortet das System mit 201 und liefert den Antrag samt Fälligkeit

#### Scenario: Einsatzleitung
- **WHEN** die Einsatzleitung des Einsatzes einen Antrag stellen will
- **THEN** antwortet das System mit 403 und legt nichts an

#### Scenario: Fremde Organisation
- **WHEN** ein System-Admin einen Antrag für einen Einsatz einer anderen Organisation stellen will
- **THEN** antwortet das System mit 403

### Requirement: Antrag nur an abgeschlossenen, nicht geschwärzten Einsätzen

Das System SHALL einen Antrag nur für einen abgeschlossenen Einsatz annehmen, gleich in welchem
Aufbewahrungszustand er steht, solange er nicht geschwärzt ist. Für einen aktiven Einsatz MUST
es mit 409 antworten, für einen geschwärzten ebenfalls mit 409. Keine Ablehnung legt etwas an.

#### Scenario: Aktiver Einsatz
- **WHEN** der Admin einen Antrag für einen aktiven Einsatz stellt
- **THEN** antwortet das System mit 409 und legt keinen Antrag an

#### Scenario: Gesperrter Einsatz
- **WHEN** der Admin einen Antrag für einen zur Löschung vorgemerkten Einsatz stellt
- **THEN** nimmt das System den Antrag an

#### Scenario: Geschwärzter Einsatz
- **WHEN** der Admin einen Antrag für einen geschwärzten Einsatz stellt
- **THEN** antwortet das System mit 409

### Requirement: Ziel eines Antrags

Ein Antrag SHALL genau ein Ziel haben: den ganzen Einsatz oder genau eine Person dieses
Einsatzes. Personenarten sind Betroffene im Personenregister, ad hoc erfasste externe Kräfte,
Anrufende am Informationstelefon und Ansprechpersonen im Presse-Log. Eine unbekannte Zielart
MUST 400 liefern, eine Person aus einem anderen Einsatz 404, eine aus den Stammdaten disponierte
Kraft 422.

#### Scenario: Person aus anderem Einsatz
- **WHEN** der Admin einen Antrag für eine Person stellt, die zu einem anderen Einsatz gehört
- **THEN** antwortet das System mit 404

#### Scenario: Stammkraft
- **WHEN** der Admin einen Antrag für eine Personal-Disposition stellt, die auf eine Stammkraft verweist
- **THEN** antwortet das System mit 422

#### Scenario: Unbekannte Zielart
- **WHEN** die Anfrage eine Zielart nennt, die es nicht gibt
- **THEN** antwortet das System mit 400

### Requirement: Aktenzeichen und Bestätigung

Jeder Antrag SHALL ein Aktenzeichen des Löschersuchens tragen, nach dem Trimmen 1 bis 64
Zeichen lang, und eine Bestätigung: beim Einsatz die Einsatznummer, bei einer Person ihre
Kennung, wie die Personensuche sie liefert. Fehlt das Aktenzeichen, ist es leer oder zu lang,
MUST das System mit 400 antworten. Stimmt die Bestätigung nicht mit dem Ziel überein, MUST es
mit 422 antworten.

#### Scenario: Leeres Aktenzeichen
- **WHEN** die Anfrage ein Aktenzeichen aus Leerzeichen enthält
- **THEN** antwortet das System mit 400

#### Scenario: Falsche Bestätigung
- **WHEN** der Admin für die Person `R-042` die Bestätigung `R-024` sendet
- **THEN** antwortet das System mit 422 und legt keinen Antrag an

### Requirement: Höchstens ein offener Antrag je Ziel

Das System SHALL je Ziel höchstens einen offenen Antrag führen. Ein zweiter Antrag für dasselbe
Ziel MUST 409 liefern, solange der erste offen ist. Ist die Person bereits auf Antrag
geschwärzt, MUST ein weiterer Antrag für sie ebenfalls 409 liefern.

#### Scenario: Doppelter Antrag
- **WHEN** für die Person `R-042` ein offener Antrag besteht und der Admin einen zweiten stellt
- **THEN** antwortet das System mit 409

#### Scenario: Nach Rücknahme
- **WHEN** der Antrag für `R-042` zurückgenommen ist und der Admin einen neuen stellt
- **THEN** nimmt das System den neuen Antrag an

### Requirement: Rücknahme innerhalb von 24 Stunden

Der Org-Admin SHALL einen offenen Antrag innerhalb von 24 Stunden nach dem Antrag zurücknehmen
können. Die Rücknahme MUST den Antrag mit Zeitpunkt und zurücknehmender Person als
zurückgenommen kennzeichnen, nicht löschen, und einen System-Eintrag im ETB schreiben. Ist der
Antrag vollzogen, zurückgenommen oder älter als 24 Stunden, MUST das System mit 409 antworten
und nichts ändern.

#### Scenario: Rücknahme nach 3 Stunden
- **WHEN** der Admin einen vor 3 Stunden gestellten Antrag zurücknimmt
- **THEN** ist der Antrag zurückgenommen, und der nächste Purge-Lauf schwärzt nichts

#### Scenario: Rücknahme nach Ablauf
- **WHEN** der Admin einen vor 25 Stunden gestellten, noch nicht vollzogenen Antrag zurücknehmen will
- **THEN** antwortet das System mit 409, und der nächste Purge-Lauf vollzieht ihn

### Requirement: Vollzug nach 24 Stunden

Das System SHALL einen offenen Antrag frühestens 24 Stunden nach dem Antrag vollziehen,
spätestens im ersten Purge-Lauf danach. Der Vollzug MUST mit dem Scrub, dem Kennzeichen
„vollzogen“ am Antrag und einem System-Eintrag im ETB in einem einzigen atomaren Vorgang
geschehen. Scheitert ein Teil, MUST nichts geschwärzt sein; der nächste Lauf versucht es erneut.
Eine Rücknahme nach dem Vollzug MUST es nicht geben.

#### Scenario: Innerhalb der 24 Stunden
- **WHEN** der Purge-Lauf 23 Stunden nach dem Antrag läuft
- **THEN** ist nichts geschwärzt, und der Antrag ist weiter offen

#### Scenario: Nach 24 Stunden
- **WHEN** der Purge-Lauf 24 Stunden nach dem Antrag läuft
- **THEN** ist das Ziel geschwärzt und der Antrag vollzogen

#### Scenario: Zweiter Lauf
- **WHEN** der Purge-Lauf danach erneut läuft
- **THEN** ändert er nichts und schreibt keinen weiteren Eintrag

### Requirement: Vollzug für den ganzen Einsatz

Der Vollzug eines Einsatz-Antrags SHALL den Einsatz so schwärzen wie die fristbasierte
Schwärzung nach Ablauf der Karenz (Capability `aufbewahrung`), unabhängig von Frist und
Vormerkung. Danach MUST der Einsatz als geschwärzt gelten und gesperrt sein, und jeder andere
offene Antrag dieses Einsatzes MUST als vollzogen gelten. Die physische Entfernung der
geschwärzten Werte MUST wie bei der fristbasierten Schwärzung erfolgen.

#### Scenario: Einsatz mit laufender Frist
- **WHEN** ein Einsatz-Antrag für einen Einsatz mit einer Frist in 5 Jahren vollzogen wird
- **THEN** trägt der Einsatz denselben Scrub wie nach einer fristbasierten Schwärzung und den Zustand `geschwaerzt`
- **AND** liefern die regulären Einsatz-Routen für ihn 403

#### Scenario: Offener Personen-Antrag
- **WHEN** für den Einsatz zusätzlich ein offener Antrag für `R-042` besteht und der Einsatz-Antrag vollzogen wird
- **THEN** gilt auch der Personen-Antrag als vollzogen

### Requirement: Vollzug für eine Person

Der Vollzug eines Personen-Antrags SHALL genau die Werte entfernen, die die Klassifikation für
die Personenart dieser Person als personengebunden führt, und nur in den Zeilen, die über ihren
Bezug zu dieser Person gehören. Die Werte anderer Personen MUST unverändert bleiben. Erhalten
bleiben MUST Registriernummer, Status, Kategorien, Zeitpunkte und Verweise. Die physische
Entfernung MUST wie bei der Einsatz-Schwärzung erfolgen. Fotos und Dateien, die an der Person
abgelegt sind, MUST samt gespeicherter Datei gelöscht werden, auch bereits entfernte.

#### Scenario: Betroffene Person
- **WHEN** der Antrag für die Betroffene `R-042` mit Sichtung, Verlaufsnotiz, Verbleib, einem Tier als Halterin und einem Schaden als Geschädigte vollzogen wird
- **THEN** tragen ihre Personenzeile, ihre Sichtungs-, Verlaufs- und Verbleibzeilen keine Namen, Kontakte, Adressen, Ziele oder Notizen mehr
- **AND** sind Halterkontakt und Kennzeichnung des Tiers sowie Kontakt, Ort und Beschreibung des Schadens geschwärzt
- **AND** trägt sie weiter Registriernummer, Status und Sichtungskategorie

#### Scenario: Fotos und Dateien der Person
- **WHEN** an `R-042` zwei Dateien abgelegt sind, eine davon schon entfernt, und an `R-043` eine, und der Antrag für `R-042` vollzogen wird
- **THEN** gibt es für `R-042` keine gespeicherte Datei und keine Verknüpfung mehr
- **AND** liegt die Datei von `R-043` unverändert vor
- **AND** stehen die Einträge „Person R-042: Foto abgelegt/entfernt“ weiter im Einsatztagebuch

#### Scenario: Andere Personen bleiben
- **WHEN** derselbe Einsatz die Person `R-043` mit Name und Kontakt führt
- **THEN** trägt `R-043` nach dem Vollzug für `R-042` weiter Name und Kontakt

#### Scenario: Externe Kraft
- **WHEN** der Antrag für eine ad hoc erfasste externe Kraft vollzogen wird, die Empfängerin eines Auftrags und in einer Stabsfunktion eingetragen ist
- **THEN** sind Name, Funktion, Trägerorganisation und Bemerkung der Disposition geschwärzt
- **AND** tragen Auftragsempfänger, Stabsfunktion und Kräfte-Zeitachse für diese Kraft keinen Namen oder Freitext mehr

#### Scenario: Anrufende Person und Ansprechperson
- **WHEN** je ein Antrag für einen Anruf am Informationstelefon und für einen Medienkontakt vollzogen wird
- **THEN** fehlen Name, Rückrufnummer und Notiz des Anrufs sowie Name und Erreichbarkeit der Ansprechperson
- **AND** fehlen Medium, Thema, Antwort und Freigabeangabe des Medienkontakts
- **AND** bleiben Anliegen, Art, Status und Zeitpunkte erhalten

### Requirement: Erwähnungen in Freitexten bleiben

Ein Personen-Antrag SHALL Freitexte, die die Person nur erwähnen, nicht verändern: den Wortlaut
des ETB, Chat-Nachrichten, die Freitexte der Führungsmodule und System-Einträge laut
Ausnahmeliste. Diese Werte MUST bis zur Schwärzung des Einsatzes stehen bleiben, das ETB auch
danach. Die Rückfrage vor dem Antrag MUST darauf hinweisen und den Einsatz-Antrag als Weg für
eine vollständige Entfernung nennen.

#### Scenario: Name im ETB-Wortlaut
- **WHEN** ein ETB-Eintrag „Herr Yilmaz an RTW übergeben“ lautet und der Antrag für die Person Yilmaz vollzogen wird
- **THEN** steht der Eintrag unverändert im ETB

### Requirement: Personengebundene Werte vollständig klassifiziert

Für jede Personenart SHALL die Klassifikation jede Tabelle führen, die per Fremdschlüssel auf
die Zeile dieser Personenart verweist. Jede Scrub-Spalte einer solchen Tabelle MUST entweder als
personengebunden oder mit Begründung als nicht personengebunden markiert sein. Eine Retain-Spalte
MUST nie personengebunden sein. Eine Verknüpfung zu Dateien, die beim Einsatz ganz gelöscht wird,
MUST stattdessen als Dateien der Person geführt sein, mit `ON DELETE CASCADE` auf die Datei. Eine
neue Tabelle oder Spalte ohne diese Markierung MUST einen Test rot machen.

#### Scenario: Neuer Verweis auf eine Person
- **WHEN** eine Migration eine Tabelle mit einem Fremdschlüssel auf das Personenregister und einer Scrub-Spalte anlegt und die Klassifikation sie nicht als personengebunden oder nicht personengebunden führt
- **THEN** schlägt der Test der Klassifikation fehl

#### Scenario: Neue Datei-Verknüpfung an einer Person
- **WHEN** eine Migration eine Verknüpfung zwischen Personenregister und Dateien anlegt und die Klassifikation sie weder als Dateien der Person noch als Bezug führt
- **THEN** schlägt der Test der Klassifikation fehl

### Requirement: Pseudonyme Personensuche

Der Org-Admin SHALL in einem abgeschlossenen Einsatz nach Name oder Kontakt suchen können. Die
Antwort MUST je Treffer nur Personenart, Kennung, Erfassungszeitpunkt, Status und den Stand
eines Antrags tragen, nie Name, Kontakt oder Freitext. Der Suchtext MUST im Anfrage-Body
stehen, nicht in der Adresse. Ein Suchtext unter 3 Zeichen MUST 400 liefern. Die Suche MUST
nichts schreiben.

#### Scenario: Treffer über den Namen
- **WHEN** der Admin in einem Einsatz mit der Betroffenen „Erika Mustermann“ nach „mustermann erika“ sucht
- **THEN** enthält die Antwort einen Treffer der Art Betroffene mit der Kennung `R-001`
- **AND** enthält sie weder „Erika“ noch „Mustermann“

#### Scenario: Treffer über die Rufnummer
- **WHEN** ein Anruf am Informationstelefon die Rückrufnummer „0171 2345678“ trägt und der Admin nach „01712345678“ sucht
- **THEN** enthält die Antwort diesen Anruf mit seiner Kennung

#### Scenario: Geschwärzte Person
- **WHEN** die gesuchte Person bereits geschwärzt ist
- **THEN** liefert die Suche sie nicht mehr

### Requirement: Audit mit Antragsbezug

Antrag, Rücknahme und Vollzug SHALL je einen System-Eintrag im ETB des Einsatzes schreiben, der
das Aktenzeichen und das Ziel nennt: beim Einsatz die Einsatznummer, bei einer Person Personenart
und Kennung. Name, Kontakt oder ein anderer personengebundener Wert MUST in keinem dieser
Einträge stehen. Bei Antrag und Rücknahme MUST der Admin als Erfasser stehen, beim Vollzug die
Person, die den Antrag gestellt hat, ersatzweise die Akteurskette des Purge-Laufs.

#### Scenario: Spur eines Personen-Antrags
- **WHEN** ein Antrag mit Aktenzeichen „DS-2026-014“ für `R-042` gestellt und nach 24 Stunden vollzogen wird
- **THEN** enthält das ETB zwei System-Einträge mit „DS-2026-014“ und „R-042“
- **AND** enthält keiner davon Name oder Kontakt der Person

### Requirement: Anträge in der Archivakte

Die Archivakte SHALL die Anträge des Einsatzes führen, mit Ziel, Aktenzeichen, Antragszeitpunkt,
Fälligkeit, Stand (offen, zurückgenommen, vollzogen) und den beteiligten Personen. Ein offener
Antrag innerhalb der 24 Stunden MUST die Aktion „Zurücknehmen“ tragen. Das Register MUST eine
auf Antrag geschwärzte Person als solche kennzeichnen. Ohne offenen Antrag und an einem nicht
geschwärzten Einsatz MUST die Akte „Einsatz sofort schwärzen“ und „Person suchen und schwärzen“
anbieten.

#### Scenario: Offener Antrag
- **WHEN** der Admin die Akte eines Einsatzes mit einem vor 2 Stunden gestellten Antrag öffnet
- **THEN** sieht er den Antrag mit Fälligkeit und der Aktion „Zurücknehmen“

#### Scenario: Geschwärzter Einsatz
- **WHEN** der Admin die Akte eines geschwärzten Einsatzes öffnet
- **THEN** fehlen beide Antragsaktionen

### Requirement: Rückfrage vor dem Antrag

Vor dem Absenden SHALL eine Rückfrage stehen, die das Ziel pseudonym nennt, die
Unwiderruflichkeit nach 24 Stunden und die Fälligkeit benennt und Aktenzeichen sowie das
Eintippen der Kennung verlangt. Erst wenn beides ausgefüllt ist und die Kennung übereinstimmt,
MUST sich der Antrag absenden lassen.

#### Scenario: Kennung stimmt nicht
- **WHEN** der Admin in der Rückfrage für `R-042` die Kennung `R-04` eintippt
- **THEN** bleibt die Aktion zum Absenden gesperrt
