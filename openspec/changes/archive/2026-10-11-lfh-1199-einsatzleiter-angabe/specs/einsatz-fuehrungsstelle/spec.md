# Spec Delta

## MODIFIED Requirements

### Requirement: Angaben der eigenen Führungsstelle
Ein Einsatz SHALL genau eine eigene Führungsstelle mit sechs optionalen Angaben tragen: Rufname,
Sprechgruppen (TMO und DMO), Kommunikationsmittel, Erreichbarkeit, Fahrzeuge (null oder mehr
disponierte Fahrzeuge dieses Einsatzes, die die Führungsstelle tragen) und Einsatzleiter. Ist keine
Angabe gesetzt, gilt die Führungsstelle als nicht erfasst. Die Führungsstelle je Person
(Einsatzmitgliedschaft) MUST davon unberührt bleiben.

#### Scenario: Neuer Einsatz
- **WHEN** ein Einsatz angelegt wird
- **THEN** liefert der Abruf der Führungsstelle alle sechs Angaben leer, und sie gilt als nicht erfasst

#### Scenario: Nur Rufname
- **WHEN** nur der Rufname „Florian Musterstadt 10/1“ gespeichert ist
- **THEN** gilt die Führungsstelle als erfasst, und Sprechgruppen, Kommunikationsmittel, Erreichbarkeit und Einsatzleiter bleiben leer

#### Scenario: Nur ein Fahrzeug
- **WHEN** der Führungsstelle nur der disponierte ELW 2 „Florian Musterstadt 10/1“ zugeordnet ist
- **THEN** gilt sie als erfasst, und Rufname, Sprechgruppen, Kommunikationsmittel, Erreichbarkeit und Einsatzleiter bleiben leer

#### Scenario: Nur ein Einsatzleiter
- **WHEN** an der Führungsstelle nur der Einsatzleiter „KBM Weber“ erfasst ist
- **THEN** gilt sie als erfasst, und die übrigen fünf Angaben bleiben leer

#### Scenario: Fahrzeug wird entlassen
- **WHEN** ein der Führungsstelle zugeordnetes Fahrzeug aus dem Einsatz entlassen wird
- **THEN** ist es der Führungsstelle nicht mehr zugeordnet

### Requirement: Bearbeitung auf der Seite Einsatzdaten
Die Seite Einsatzdaten SHALL ein Paneel „Eigene Führungsstelle“ mit den sechs Angaben zeigen. Jede
Angabe MUST einzeln in der Leseansicht bearbeitbar sein und beim Speichern genau ihr eigenes Feld
senden; ein unveränderter Wert sendet nichts. Ohne Schreibrecht MUST keine Angabe eine Aufforderung
tragen, leere Angaben zeigen „—“. Ein Speicherfehler MUST an der Zeile stehen.

#### Scenario: Sprechgruppen zuordnen
- **WHEN** eine schreibberechtigte Person an der Zeile „Sprechgruppen“ die Sprechgruppen „TMO 311“ und „DMO 505“ wählt und speichert
- **THEN** zeigt die Zeile beide nach Betriebsart, und die Anfrage trug nur die Sprechgruppen

#### Scenario: ELW 2 zuordnen
- **WHEN** eine schreibberechtigte Person an der Zeile „Fahrzeuge“ den ELW 2 „Florian Musterstadt 10/1“ wählt und speichert
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
- **THEN** zeigt die Zeile „Fahrzeuge“ „nicht freigegeben“ ohne Aufforderung, und die übrigen Angaben bleiben bedienbar

#### Scenario: Beobachter sieht die Angaben
- **WHEN** eine Person mit der Rolle Beobachter die Seite öffnet
- **THEN** zeigt das Paneel die Angaben ohne Bearbeiten- oder Eintragen-Aufforderung

### Requirement: Erreichbarkeit wird geschwärzt
Die Erreichbarkeit der Führungsstelle und der Name des Einsatzleiters (eingefrorener Name einer
Person wie Freitext) sind personenbezogen und MUST bei der Schwärzung des Einsatzes entfernt werden.
Rufname, Kommunikationsmittel, Sprechgruppen-Zuordnung, die Art des Einsatzleiters und sein „seit“
SHALL als Führungsstruktur erhalten bleiben.

#### Scenario: Schwärzung nach Fristablauf
- **WHEN** ein Einsatz mit erfasster Führungsstelle und dem Einsatzleiter „Anna Schulz“ geschwärzt wird
- **THEN** sind ihre Erreichbarkeit und der Name des Einsatzleiters leer, und Rufname, Kommunikationsmittel, Sprechgruppen und „seit“ sind unverändert

## ADDED Requirements

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
