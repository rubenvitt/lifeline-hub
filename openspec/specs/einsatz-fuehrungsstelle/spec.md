# einsatz-fuehrungsstelle Specification

## Purpose
Hält je Einsatz die eigene Führungsstelle (ELW, Einsatzleitung) als Gegenstelle für Funkplan und
Fernmeldeskizze fest: Rufname, Sprechgruppen, Kommunikationsmittel, Erreichbarkeit, die
Fahrzeuge, die sie tragen, und den Einsatzleiter mit seiner Übergabe im ETB, samt Rechten,
Live-Verhalten und Schwärzung.

## Requirements

### Requirement: Angaben der eigenen Führungsstelle
Ein Einsatz SHALL genau eine eigene Führungsstelle tragen. Sie hat eine Art (`mobil` oder
`ortsfest`) und acht optionale Angaben: Einsatzleiter, Bezeichnung, Standort (Adresse und
Koordinate), Rufname, Sprechgruppen (TMO und DMO), Kommunikationsmittel, Erreichbarkeit und
Führungsfahrzeuge (null oder mehr disponierte Fahrzeuge dieses Einsatzes, die die Führungsstelle
tragen). Ist keine der acht Angaben gesetzt, gilt die Führungsstelle als nicht erfasst; die Art
allein macht sie nicht erfasst. Die Führungsstelle je Person (Einsatzmitgliedschaft) MUST davon
unberührt bleiben.

#### Scenario: Neuer Einsatz
- **WHEN** ein Einsatz angelegt wird
- **THEN** liefert der Abruf der Führungsstelle die Art `mobil` und alle acht Angaben leer, und sie gilt als nicht erfasst

#### Scenario: Nur Rufname
- **WHEN** nur der Rufname „Florian Musterstadt 10/1“ gespeichert ist
- **THEN** gilt die Führungsstelle als erfasst, und Sprechgruppen, Kommunikationsmittel, Erreichbarkeit und Einsatzleiter bleiben leer

#### Scenario: Nur ein Fahrzeug
- **WHEN** der Führungsstelle nur der disponierte ELW 2 „Florian Musterstadt 10/1“ zugeordnet ist
- **THEN** gilt sie als erfasst, und Rufname, Sprechgruppen, Kommunikationsmittel, Erreichbarkeit und Einsatzleiter bleiben leer

#### Scenario: Nur ein Einsatzleiter
- **WHEN** an der Führungsstelle nur der Einsatzleiter „KBM Weber“ erfasst ist
- **THEN** gilt sie als erfasst, und die übrigen fünf Angaben bleiben leer

#### Scenario: Nur Bezeichnung
- **WHEN** nur die Bezeichnung „TEL Rathaus“ gespeichert ist
- **THEN** gilt die Führungsstelle als erfasst, und Standort, Rufname und Führungsfahrzeuge bleiben leer

#### Scenario: Nur die Art geändert
- **WHEN** an einem neuen Einsatz nur die Art auf `ortsfest` gesetzt wird
- **THEN** liefert der Abruf die Art `ortsfest`, und die Führungsstelle gilt weiter als nicht erfasst

#### Scenario: Fahrzeug wird entlassen
- **WHEN** ein der Führungsstelle zugeordnetes Fahrzeug aus dem Einsatz entlassen wird
- **THEN** ist es der Führungsstelle nicht mehr zugeordnet

### Requirement: Lesen mit dem Einsatz
Jede Person, die den Einsatz lesen darf, SHALL die Führungsstelle lesen können, unabhängig von
ihren Modulfreigaben. Wer den Einsatz nicht lesen darf, MUST eine Ablehnung erhalten wie beim
Einsatzkopf.

#### Scenario: Beobachter liest
- **WHEN** eine Person mit der Rolle Beobachter die Führungsstelle abruft
- **THEN** erhält sie die gespeicherten Angaben

#### Scenario: Fremde Person
- **WHEN** eine Person ohne Lesezugriff auf den Einsatz die Führungsstelle abruft
- **THEN** wird der Abruf abgelehnt, ohne Angaben preiszugeben

### Requirement: Ändern als Teil-Patch mit den Rechten der Kopfdaten
Die Führungsstelle SHALL sich mit denselben Rechten ändern lassen wie die Kopfdaten des Einsatzes.
Jede Angabe MUST einzeln änderbar sein: eine fehlende Angabe bleibt unverändert, `null` oder leerer
Text leert sie. Gesendete Sprechgruppen MUST die Zuordnung vollständig ersetzen. An einem nicht
aktiven Einsatz MUST jede Änderung abgelehnt werden.

#### Scenario: Zwei Angaben nacheinander
- **WHEN** Person A den Rufname und Person B danach aus einem älteren Stand die Erreichbarkeit speichert
- **THEN** trägt die Führungsstelle beide Angaben

#### Scenario: Beobachter ändert
- **WHEN** eine Person mit der Rolle Beobachter die Führungsstelle ändern will
- **THEN** wird die Änderung mit 403 abgelehnt

#### Scenario: Abgeschlossener Einsatz
- **WHEN** an einem abgeschlossenen Einsatz eine Angabe der Führungsstelle gesendet wird
- **THEN** wird die Änderung mit 409 abgelehnt

### Requirement: Prüfung der Angaben
Das Kommunikationsmittel MUST einer der Werte sein, die auch Abschnitt und Einheit annehmen; ein
unbekannter Wert ergibt 400. Eine Sprechgruppe MUST dem Katalog der Organisation oder den
einsatzlokalen Sprechgruppen dieses Einsatzes angehören; jede andere ergibt 422. Eine abgelehnte
Änderung MUST keine Angabe teilweise speichern.

#### Scenario: Fremde Sprechgruppe
- **WHEN** die Sprechgruppen einer anderen Organisation oder eines anderen Einsatzes zugeordnet werden sollen
- **THEN** antwortet der Server mit 422, und weder Sprechgruppen noch eine im selben Aufruf gesendete andere Angabe sind gespeichert

#### Scenario: Unbekanntes Kommunikationsmittel
- **WHEN** als Kommunikationsmittel ein unbekannter Wert gesendet wird
- **THEN** antwortet der Server mit 400

### Requirement: Fahrzeuge der Führungsstelle
Der Abruf SHALL die zugeordneten Fahrzeuge nur als IDs der Disposition liefern, nie mit
Funkrufname, Typ oder anderen Fahrzeugdaten. Gesendete Fahrzeuge MUST die Zuordnung vollständig
ersetzen. Ein Fahrzeug, das diesem Einsatz nicht disponiert ist, MUST mit 422 abgelehnt werden,
ohne eine Angabe teilweise zu speichern.

#### Scenario: Fremdes Fahrzeug
- **WHEN** zusammen mit einem Rufname ein Fahrzeug eines anderen Einsatzes gesendet wird
- **THEN** wird die Änderung mit 422 abgelehnt, und auch der Rufname bleibt unverändert

#### Scenario: Ohne Fahrzeug-Freigabe lesen
- **WHEN** eine Person ohne Freigabe für Fahrzeuge die Führungsstelle abruft
- **THEN** erhält sie die Fahrzeug-IDs, aber keine Fahrzeugdaten

### Requirement: Bearbeitung auf der Seite Einsatzdaten
Die Seite Einsatzdaten SHALL ein Paneel „Eigene Führungsstelle“ mit Einsatzleiter, Art,
Bezeichnung, Standort, Rufname, Sprechgruppen, Kommunikationsmittel, Erreichbarkeit und
Führungsfahrzeugen zeigen. Jede
Angabe MUST einzeln in der Leseansicht bearbeitbar sein und beim Speichern genau ihr eigenes Feld
senden; der Standort sendet Adresse und Koordinate zusammen. Ein unveränderter Wert sendet nichts.
Ohne Schreibrecht MUST keine Angabe eine Aufforderung tragen, leere Angaben zeigen „—“. Ein
Speicherfehler MUST an der Zeile stehen.

#### Scenario: Sprechgruppen zuordnen
- **WHEN** eine schreibberechtigte Person an der Zeile „Sprechgruppen“ die Sprechgruppen „TMO 311“ und „DMO 505“ wählt und speichert
- **THEN** zeigt die Zeile beide nach Betriebsart, und die Anfrage trug nur die Sprechgruppen

#### Scenario: ELW 2 zuordnen
- **WHEN** eine schreibberechtigte Person an der Zeile „Führungsfahrzeuge“ den ELW 2 „Florian Musterstadt 10/1“ wählt und speichert
- **THEN** zeigt die Zeile „Florian Musterstadt 10/1 (ELW 2)“, und die Anfrage trug nur die Fahrzeuge

#### Scenario: Einsatzleiter aus dem Personal wählen
- **WHEN** eine schreibberechtigte Person an der Zeile „Einsatzleiter“ die disponierte Person „Anna Schulz“ wählt, „seit“ leer lässt und speichert
- **THEN** zeigt die Zeile „Anna Schulz“ mit der Zeit des Speicherns als „seit“, und die Anfrage trug nur den Einsatzleiter

#### Scenario: Externer Einsatzleiter als Freitext
- **WHEN** eine schreibberechtigte Person an der Zeile „Einsatzleiter“ „KBM Weber“ eintippt, das als Freitext übernimmt und speichert
- **THEN** zeigt die Zeile „KBM Weber (extern)“

#### Scenario: Personal nicht freigegeben
- **WHEN** eine schreibberechtigte Person ohne Freigabe für Personal die Zeile „Einsatzleiter“ bearbeitet
- **THEN** bietet die Zeile nur den Freitext an und nennt, dass Personal nicht freigegeben ist

#### Scenario: Fahrzeuge nicht freigegeben
- **WHEN** eine Person ohne Freigabe für Fahrzeuge das Paneel öffnet
- **THEN** zeigt die Zeile „Führungsfahrzeuge“ „nicht freigegeben“ ohne Aufforderung, und die übrigen Angaben bleiben bedienbar

#### Scenario: Beobachter sieht die Angaben
- **WHEN** eine Person mit der Rolle Beobachter die Seite öffnet
- **THEN** zeigt das Paneel die Angaben ohne Bearbeiten- oder Eintragen-Aufforderung

#### Scenario: Art wählen
- **WHEN** eine schreibberechtigte Person an der Zeile „Art“ „ortsfest“ wählt und speichert
- **THEN** zeigt die Zeile „ortsfest“, und die Anfrage trug nur die Art

### Requirement: Änderung erreicht jeden Schirm
Eine erfolgreiche Änderung der Führungsstelle SHALL nach dem Commit das Ereignis `einsatz`
verteilen. Jede Ansicht, die die Führungsstelle zeigt, MUST sie daraufhin ohne Neuladen der Seite
neu abrufen. Eine abgelehnte Änderung MUST kein Ereignis verteilen.

#### Scenario: Funkplan offen
- **WHEN** auf Schirm A der Rufname der Führungsstelle gespeichert wird und Schirm B den Funkplan offen hat
- **THEN** zeigt Schirm B die Zeile der Führungsstelle mit dem neuen Rufnamen ohne Neuladen

### Requirement: Erreichbarkeit wird geschwärzt
Die Erreichbarkeit der Führungsstelle und der Name des Einsatzleiters (eingefrorener Name einer
Person wie Freitext) sind personenbezogen und MUST bei der Schwärzung des Einsatzes entfernt werden.
Adresse und Koordinate ihres Standorts können eine Privatadresse verraten und MUST ebenfalls
entfernt werden. Art, Bezeichnung, Rufname, Kommunikationsmittel, Sprechgruppen-Zuordnung, die Art
des Einsatzleiters und sein „seit“ SHALL als Führungsstruktur erhalten bleiben.

#### Scenario: Schwärzung nach Fristablauf
- **WHEN** ein Einsatz mit erfasster Führungsstelle und dem Einsatzleiter „Anna Schulz“ geschwärzt wird
- **THEN** sind ihre Erreichbarkeit und der Name des Einsatzleiters leer, und Rufname, Kommunikationsmittel, Sprechgruppen und „seit“ sind unverändert

### Requirement: Einsatzleiter als Person oder Freitext
Der Einsatzleiter SHALL entweder eine Person aus dem disponierten Personal dieses Einsatzes oder ein
Freitext für einen externen Einsatzleiter sein, stets mit einem Zeitpunkt „seit“. Fehlt „seit“
beim Setzen, MUST der Server die Zeit des Speicherns nehmen. Der Server MUST den Namen der Person
beim Setzen einfrieren und ihn jeder Person liefern, die den Einsatz lesen darf. Die Angabe MUST
sich mit `null` leeren lassen, und sie gehorcht den Rechten und Regeln der übrigen Angaben (Teil-Patch,
nicht aktiver Einsatz 409, keine Teilspeicherung).

Der Server MUST ablehnen:
- eine unbekannte Art, einen leeren oder zu langen Freitext und einen unlesbaren Zeitpunkt mit 400,
- eine Person, die diesem Einsatz nicht disponiert ist, Person und Freitext zugleich und ein „seit“
  mehr als zwei Minuten in der Zukunft mit 422.

#### Scenario: Person eines anderen Einsatzes
- **WHEN** als Einsatzleiter eine Person gesendet wird, die nur in einem anderen Einsatz disponiert ist
- **THEN** antwortet der Server mit 422, und der Einsatzleiter bleibt unverändert

#### Scenario: Leerer Freitext
- **WHEN** als externer Einsatzleiter ein Freitext aus Leerzeichen gesendet wird
- **THEN** antwortet der Server mit 400

#### Scenario: Seit in der Zukunft
- **WHEN** ein Einsatzleiter mit „seit“ eine Stunde nach der Serverzeit gesendet wird
- **THEN** antwortet der Server mit 422, und es entsteht kein ETB-Eintrag

#### Scenario: Person wird entlassen
- **WHEN** die Person, die Einsatzleiter ist, aus dem Einsatz entlassen wird
- **THEN** bleibt ihr Name als Einsatzleiter erhalten und ist als „nicht mehr disponiert“ gekennzeichnet

#### Scenario: Beobachter liest den Einsatzleiter
- **WHEN** eine Person mit der Rolle Beobachter und ohne Freigabe für Personal die Führungsstelle abruft
- **THEN** erhält sie den Namen des Einsatzleiters und sein „seit“

### Requirement: Übergabe der Einsatzleitung im ETB
Jede Änderung, die den Einsatzleiter setzt, wechselt oder leert, SHALL in derselben Transaktion
genau einen ETB-Eintrag vom Typ System schreiben. Seine Ereigniszeit ist das „seit“ des neuen
Einsatzleiters, beim Leeren die Zeit des Speicherns. Der Wortlaut ist:

- erstes Setzen: „Einsatzleitung übernommen: B“,
- Wechsel: „Übergabe der Einsatzleitung von A an B“,
- Leeren: „Einsatzleitung nicht mehr erfasst (vorher: A)“.

Bleiben Art und Person bzw. Freitext gleich, MUST kein Eintrag entstehen, auch wenn sich nur
„seit“ ändert. Scheitert der ETB-Eintrag, MUST die ganze Änderung scheitern. Nach dem Commit MUST
der Eintrag wie jeder andere ETB-Eintrag live erscheinen.

#### Scenario: Wechsel erzeugt genau einen Eintrag
- **WHEN** der Einsatzleiter „Anna Schulz“ ist und eine Person „KBM Weber“ als externen Einsatzleiter mit „seit“ 14:30 speichert
- **THEN** steht genau ein neuer ETB-Eintrag „Übergabe der Einsatzleitung von Anna Schulz an KBM Weber (extern)“ mit Ereigniszeit 14:30 im ETB

#### Scenario: Gleiche Wahl erzeugt keinen Eintrag
- **WHEN** der Einsatzleiter „Anna Schulz“ ist und dieselbe Person mit anderem „seit“ erneut gespeichert wird
- **THEN** ist „seit“ geändert, und es entsteht kein ETB-Eintrag

#### Scenario: Leeren
- **WHEN** der Einsatzleiter „Anna Schulz“ geleert wird
- **THEN** steht genau ein neuer ETB-Eintrag „Einsatzleitung nicht mehr erfasst (vorher: Anna Schulz)“ im ETB

#### Scenario: Andere Angabe ändern
- **WHEN** nur der Rufname der Führungsstelle geändert wird
- **THEN** entsteht kein ETB-Eintrag

### Requirement: Einsatzleiter in der Kopfleiste
Die Kopfleiste der Seite Einsatzdaten SHALL unter „Einsatzleitung“ den erfassten Einsatzleiter
zeigen, in derselben Darstellung wie Organigramm, Funkplan, Lagebericht und Einsatzbericht. Ist kein
Einsatzleiter erfasst, SHALL dort gedämpft „nicht erfasst“ stehen. Die Kopfleiste MUST NOT die
Mitglieder mit der App-Rolle Einsatzleitung als Leitung zeigen, und die Angabe MUST NOT in der
Kopfleiste bearbeitbar sein.

#### Scenario: App-Rolle ohne Einsatzleiter
- **WHEN** ein Mitglied „Administrator“ die Einsatzrolle Einsatzleitung trägt und kein Einsatzleiter erfasst ist
- **THEN** zeigt die Kopfleiste unter „Einsatzleitung“ „nicht erfasst“, und „Administrator“ steht dort nicht

#### Scenario: Wechsel auf einem anderen Schirm
- **WHEN** auf Schirm A der Einsatzleiter gewechselt wird und Schirm B die Einsatzdaten offen hat
- **THEN** zeigt die Kopfleiste auf Schirm B den neuen Einsatzleiter ohne Neuladen

#### Scenario: Standort wird mitgeschwärzt
- **WHEN** ein Einsatz geschwärzt wird, dessen Führungsstelle „ELW 2 Musterstadt“ mit Adresse und Koordinate trägt
- **THEN** sind Adresse und Koordinate leer, und Art und Bezeichnung „ELW 2 Musterstadt“ sind unverändert

### Requirement: Art der Führungsstelle
Die Art SHALL `mobil` oder `ortsfest` sein und ohne gespeicherte Angabe `mobil` lauten (Vorgabe).
Sie MUST sich wie jede Angabe einzeln ändern lassen, aber nicht leeren: `null`, leerer Text oder
ein unbekannter Wert ergeben 400, ohne eine Angabe des Aufrufs zu speichern.

#### Scenario: Unbekannte Art
- **WHEN** als Art „stationaer“ gesendet wird
- **THEN** antwortet der Server mit 400, und keine Angabe des Aufrufs ist gespeichert

#### Scenario: Art leeren
- **WHEN** als Art `null` gesendet wird
- **THEN** antwortet der Server mit 400, und die gespeicherte Art bleibt

### Requirement: Standort der Führungsstelle
Der Standort SHALL aus einer Adresse (Freitext) und einer Koordinate (Breite und Länge) bestehen;
beide Teile sind einzeln optional. Die Koordinate MUST als Paar gesetzt oder geleert werden und
Breite −90 bis 90 sowie Länge −180 bis 180 einhalten; jede Verletzung ergibt 422, geprüft am Stand
nach der Änderung, ohne eine Angabe des Aufrufs zu speichern.

#### Scenario: Adresse und Koordinate
- **WHEN** Adresse „Hauptstraße 1, Musterstadt“, Breite 52,1 und Länge 9,9 gespeichert werden
- **THEN** liefert der Abruf alle drei Werte, und die Führungsstelle gilt als erfasst

#### Scenario: Halbe Koordinate
- **WHEN** nur die Breite gesendet wird und keine Länge gespeichert ist
- **THEN** antwortet der Server mit 422, und keine Angabe des Aufrufs ist gespeichert

#### Scenario: Breite außerhalb
- **WHEN** als Breite 95 und als Länge 9,9 gesendet werden
- **THEN** antwortet der Server mit 422

### Requirement: Längengrenzen von Bezeichnung und Adresse
Die Bezeichnung MUST höchstens 200 Zeichen und die Adresse höchstens 500 Zeichen lang sein; ein
längerer Wert ergibt 400, ohne eine Angabe des Aufrufs zu speichern. Führende und folgende
Leerzeichen MUST vor dem Speichern entfernt werden.

#### Scenario: Bezeichnung zu lang
- **WHEN** eine Bezeichnung mit 201 Zeichen gesendet wird
- **THEN** antwortet der Server mit 400

### Requirement: Standort im Paneel erfassen
Die Zeile „Standort“ SHALL eine Adresse als Text und eine Koordinate über die Koordinateneingabe
annehmen. Trägt der Einsatz einen Einsatzort, SHALL sie „wie Einsatzort“ anbieten: das übernimmt
Adresse und Koordinate des Einsatzorts einmalig in die Eingabe. Eine spätere Änderung des
Einsatzorts MUST NOT den Standort der Führungsstelle ändern.

#### Scenario: Wie Einsatzort übernehmen
- **WHEN** der Einsatzort „Industriestraße 4“ mit Koordinate trägt und eine schreibberechtigte Person an der Zeile „Standort“ „wie Einsatzort“ wählt und speichert
- **THEN** zeigt die Zeile „Industriestraße 4“ mit der Koordinate, und die Anfrage trug nur Adresse und Koordinate

#### Scenario: Einsatzort ändert sich danach
- **WHEN** nach der Übernahme der Einsatzort auf „Industriestraße 8“ geändert wird
- **THEN** zeigt der Standort der Führungsstelle weiter „Industriestraße 4“

### Requirement: Führungsfahrzeuge bei ortsfester Führungsstelle
Bei der Art `ortsfest` SHALL die Zeile „Führungsfahrzeuge“ eingeklappt stehen und sich aufklappen
lassen; zugeordnete Fahrzeuge MUST dabei erhalten bleiben und eingeklappt als Anzahl genannt
werden. Keine Art MUST ein Führungsfahrzeug verlangen.

#### Scenario: Ortsfest ohne Fahrzeug
- **WHEN** die Führungsstelle `ortsfest` ist und kein Fahrzeug trägt
- **THEN** steht die Zeile „Führungsfahrzeuge“ eingeklappt, und das Paneel verlangt keine Angabe

#### Scenario: Ortsfest mit Fahrzeug
- **WHEN** eine ortsfeste Führungsstelle ein Fernmeldefahrzeug trägt
- **THEN** nennt die eingeklappte Zeile „1 Führungsfahrzeug“, und das Fahrzeug bleibt zugeordnet

### Requirement: Einsatzleiter in der Einsatzanzeige
Die Einsatzanzeige SHALL den Einsatzleiter der eigenen Führungsstelle mitliefern, in der Liste der
Einsätze wie im Detail eines Einsatzes, mit Art, Name, „seit“ und dem Vermerk „nicht mehr
disponiert“ wie an der Führungsstelle. Ohne erfassten Einsatzleiter MUST das Feld fehlen. Ein
geschwärzter Name MUST ohne Namen geliefert werden. Der Lage-Snapshot MUST den Einsatzleiter nicht
einfrieren, und eine Gerätesitzung MUST ihn nicht erhalten.

#### Scenario: Liste nennt den Einsatzleiter
- **WHEN** im Einsatz „Hochwasser“ die Person „Anna Schulz“ als Einsatzleiter erfasst ist und eine Person mit Leserecht die Liste der Einsätze abruft
- **THEN** trägt der Eintrag „Hochwasser“ den Einsatzleiter „Anna Schulz“ mit seinem „seit“

#### Scenario: Ohne Einsatzleiter
- **WHEN** im Einsatz kein Einsatzleiter erfasst ist, aber Mitglieder die App-Rolle Einsatzleitung tragen
- **THEN** fehlt das Feld des Einsatzleiters in Liste und Detail

#### Scenario: Geschwärzter Name
- **WHEN** der Name des Einsatzleiters „Anna Schulz“ in einem noch lesbaren Einsatz geschwärzt wurde (Schwärzung auf Antrag)
- **THEN** liefert die Liste den Einsatzleiter ohne Namen, und „Anna Schulz“ steht nirgends in der Antwort

#### Scenario: Gekoppeltes Gerät
- **WHEN** ein gekoppelter Lagemonitor oder ein UHS-Tablet den Einsatzkopf eines Einsatzes mit erfasstem Einsatzleiter „KBM Weber“ abruft
- **THEN** fehlt das Feld des Einsatzleiters, und „KBM Weber“ steht nicht in der Antwort

#### Scenario: Snapshot ohne Einsatzleiter
- **WHEN** ein Lage-Snapshot eines Einsatzes mit erfasstem Einsatzleiter angelegt wird
- **THEN** enthält der eingefrorene Einsatz des Snapshots keinen Einsatzleiter

### Requirement: Einsatzleiter in der Einsatzliste
Jede Kachel der Einsatzliste, aktiv wie abgeschlossen, SHALL eine Zeile mit dem Kürzel „EL“ und dem
Einsatzleiter tragen, in derselben Darstellung wie Kopfleiste und Funkplan, samt Vermerk „nicht mehr
disponiert“. Ist keiner erfasst, SHALL dort „EL nicht erfasst“ stehen, ein geschwärzter Name als
„Name geschwärzt“. Die Kachel MUST NOT Mitglieder mit der App-Rolle Einsatzleitung als Einsatzleiter
zeigen.

#### Scenario: Erfasster Einsatzleiter
- **WHEN** im Einsatz „Hochwasser“ der externe Einsatzleiter „KBM Weber“ erfasst ist
- **THEN** zeigt die Kachel „Hochwasser“ die Zeile „EL KBM Weber (extern)“

#### Scenario: App-Rolle ohne Einsatzleiter
- **WHEN** ein Mitglied „Administrator“ die Einsatzrolle Einsatzleitung trägt und kein Einsatzleiter erfasst ist
- **THEN** zeigt die Kachel „EL nicht erfasst“, und „Administrator“ steht dort nicht

#### Scenario: Wechsel auf einem anderen Schirm
- **WHEN** auf Schirm A der Einsatzleiter gewechselt wird und Schirm B die Einsatzliste offen hat
- **THEN** zeigt die Kachel auf Schirm B den neuen Einsatzleiter ohne Neuladen
