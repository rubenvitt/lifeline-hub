# Spec Delta

## MODIFIED Requirements

### Requirement: Meine Funktion

Eine Benachrichtigung an eine Führungsfunktion SHALL die Nutzer erreichen, die diese Funktion im
Einsatz führen. Maßgeblich MUST die Führungsfunktion der Einsatz-Mitgliedschaft sein; tragen
mehrere Mitglieder dieselbe Funktion, MUST die Benachrichtigung jedes von ihnen erreichen. Für EL
MUST zuerst der an der eigenen Führungsstelle erfasste Einsatzleiter gelten (Einsatzpersonal →
verknüpfter Nutzer); nur wenn keiner erfasst ist oder er keinen Nutzer verknüpft hat, MUST die
Funktion EL aus der Mitgliedschaft gelten.

#### Scenario: Stab-Besetzung geht vor
- **WHEN** an der eigenen Führungsstelle Person A als Einsatzleiter erfasst ist und Person B in ihrer Mitgliedschaft die Funktion EL trägt
- **THEN** erreicht eine Benachrichtigung an EL nur Person A

#### Scenario: Ersatz über die Mitgliedschaft
- **WHEN** Person C in ihrer Mitgliedschaft die Funktion S6 trägt
- **THEN** erreicht eine Benachrichtigung an S6 Person C

#### Scenario: Zwei Mitglieder mit derselben Funktion
- **WHEN** Person A und Person B in ihrer Mitgliedschaft die Funktion S3 tragen
- **THEN** erreicht eine Benachrichtigung an S3 Person A und Person B

#### Scenario: Niemand besetzt die Funktion
- **WHEN** eine Benachrichtigung an S5 geht und kein Mitglied in seiner Mitgliedschaft S5 trägt
- **THEN** erhält niemand eine Benachrichtigung, und das Ereignis bleibt in Zählern und Listen sichtbar

### Requirement: Lagebesprechung steht an

Für den nächsten Termin der Lagebesprechung SHALL jeder Nutzer der Funktionen EL und S1 bis S7
(Anforderung „Meine Funktion“) 10 Minuten vorher einen Hinweis „Lagebesprechung in 10 Minuten“ und
bei Erreichen des Termins einen Hinweis „Lagebesprechung jetzt fällig“ erhalten. Wird der Termin
verschoben, MUST die Ankündigung für den neuen Termin gelten, nicht für den alten.

#### Scenario: Termin 14:00
- **WHEN** die nächste Lagebesprechung für 14:00 angesetzt ist
- **THEN** erhalten die Nutzer der Funktionen EL und S1 bis S7 um 13:50 und um 14:00 je einen Hinweis

#### Scenario: Termin verschoben
- **WHEN** der Termin um 13:45 von 14:00 auf 14:30 verschoben wird
- **THEN** kommt um 13:50 kein Hinweis, sondern um 14:20 und 14:30

### Requirement: Vorgabe je Funktion am Einsatz

Wer den Einsatz verwalten darf (Einsatzleitung, Führungspersonal, Admin der Organisation des
Einsatzes), SHALL je Einsatz für jede Benachrichtigungsart der Stufe Hinweis festlegen können, für
welche Führungsfunktionen (EL, S1–S7, Führungshilfspersonal, Fachberater) und für Mitglieder ohne
Funktion sie still ist; Org-Arten und die Unwetterwarnung sind ausgenommen. Ohne Festlegung gilt
die Vorgabe des Katalogs: „Neuer Lagebericht“ still, alle übrigen Eingang. Die Funktionen eines
Empfängers sind die Funktion seiner Mitgliedschaft und EL, wenn er als Einsatzleiter an der eigenen
Führungsstelle erfasst ist; hat er keine, gilt „ohne Funktion“. Ein Empfänger MUST eine Art still
erhalten, wenn die Vorgabe sie für jede seiner Funktionen still stellt; hat er eine Funktion, für
die sie Eingang ist, MUST er sie als Eingang erhalten (lauter gewinnt; die eigene Abschaltung
bleibt davon unberührt). Arten der Stufe Alarm MUST NOT per Vorgabe einstellbar sein (422). Eine
Änderung MUST live bei allen erscheinen, die die Einstellungen offen haben; ein abgeschlossener
Einsatz MUST sie ablehnen (409).

#### Scenario: Still für S2
- **WHEN** die Vorgabe „Neuer Auftrag“ für S2 still stellt und ein Auftrag an S2 erteilt wird
- **THEN** steht er im Verlauf der S2 als gelesen und erhöht ihre Zahl ungelesener Eingänge nicht

#### Scenario: Zwei Funktionen
- **WHEN** Person A ist als Einsatzleiter an der Führungsstelle erfasst und trägt in ihrer Mitgliedschaft S2, die Vorgabe stellt „Neuer Auftrag“ nur für S2 still, und ein Auftrag geht an EL und S2
- **THEN** erhält A den Auftrag als Eingang

#### Scenario: Lagebericht ohne Festlegung
- **WHEN** an einem Einsatz ohne Festlegung ein Lagebericht freigegeben wird
- **THEN** steht er bei allen Empfängern still im Verlauf

#### Scenario: Alarm nicht einstellbar
- **WHEN** jemand die Vorgabe für „Sofortmeldung“ setzen will
- **THEN** lehnt der Server mit 422 ab, und die Sektion „Benachrichtigungen“ bietet die Art nicht an
