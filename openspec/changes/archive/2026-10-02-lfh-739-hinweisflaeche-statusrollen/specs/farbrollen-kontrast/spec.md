## ADDED Requirements

### Requirement: Rand eines Steuerelements auf einer Hinweisfläche

Der Rand eines Steuerelements, das auf einer Hinweisfläche steht (Info, Warnung, Fehler,
Erfolg), SHALL im Tag- und im Nachtmodus gegen diese Hinweisfläche mindestens 3 : 1 halten
(WCAG 1.4.11). Gegen die eigene Fläche des Steuerelements gilt derselbe Boden. Kein
Kontrastnachweis MUST diesen Rand unter einer Ausnahme mit niedrigerer Schranke führen.

#### Scenario: Knopf auf einem Info-Hinweis am Tag
- **WHEN** im Tagmodus die Einsatzliste den Hinweis „Demo-Daten sind freigeschaltet und noch
  nicht importiert.“ mit dem Knopf „Zu den Demo-Daten“ zeigt
- **THEN** misst der Knopfrand gegen die Hinweisfläche mindestens 3 : 1
- **AND** gegen die Knopffläche mindestens 3 : 1

#### Scenario: Knopf auf einem Info-Hinweis in der Nacht
- **WHEN** im Nachtmodus derselbe Hinweis angezeigt wird
- **THEN** misst der Knopfrand gegen die Hinweisfläche und gegen die Knopffläche jeweils
  mindestens 3 : 1

#### Scenario: Knopf auf einem Fehlerhinweis
- **WHEN** eine Seite nach einem Ladefehler einen Fehlerhinweis mit dem Knopf „Erneut abrufen“
  oder „Erneut laden“ zeigt
- **THEN** misst der Knopfrand gegen die Hinweisfläche im Tag- und im Nachtmodus mindestens 3 : 1

#### Scenario: Warn- und Erfolgshinweis
- **WHEN** ein Steuerelement auf einem Warn- oder Erfolgshinweis steht
- **THEN** misst sein Rand gegen die Hinweisfläche im Tag- und im Nachtmodus mindestens 3 : 1

### Requirement: Hinweisflächen kommen aus den Statusflächen

Die Fläche eines Hinweises SHALL in beiden Modi die Statusfläche seiner Bedeutung tragen: Info
die Bedienfläche, Warnung die Achtungsfläche, Fehler die Alarmfläche, Erfolg die Normalfläche.
Die Zuordnung MUST app-weit aus einer Stelle kommen; kein Hinweis MUST dafür eine eigene Farbe
setzen. Text auf der Hinweisfläche hält dabei den Textboden (Tag ≥ 7 : 1, Nacht ≥ 5 : 1).

#### Scenario: Info-Hinweis trägt die Bedienfläche
- **WHEN** ein Info-Hinweis im Tag- oder im Nachtmodus angezeigt wird
- **THEN** ist seine Fläche dieselbe Farbe wie die Bedienfläche des Modus

#### Scenario: Text auf dem Hinweis
- **WHEN** ein Hinweis Titel und Beschreibung zeigt
- **THEN** misst der Text gegen die Hinweisfläche im Tag mindestens 7 : 1 und in der Nacht
  mindestens 5 : 1
