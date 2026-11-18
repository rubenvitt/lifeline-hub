## ADDED Requirements

### Requirement: Eine offene Detailseite sperrt sich beim Stornieren

Wird eine Person, ein Tier, ein Schaden oder eine Betreuungsstelle storniert, SHALL jede offene
Detailseite dieses Datensatzes das ohne Zutun anzeigen, sobald das Live-Ereignis eintrifft. Sie MUST
dabei alle Schreibaktionen ausblenden: Kopfaktionen, Paneele, Inline-Angaben, Notiz, Anhänge und
Bezüge. Die übrigen Inhalte MUST sie im zuletzt bekannten Stand weiter zeigen. Die Seite MUST
NOT auf eine Fehlerseite wechseln.

#### Scenario: Person wird an einem anderen Platz storniert
- **WHEN** A eine Person storniert, während B ihre Detailseite offen hat
- **THEN** zeigt die Seite bei B ohne Neuladen das Storno-Banner, und keine Schreibaktion ist mehr
  zu sehen

#### Scenario: Tier und Schaden
- **WHEN** ein Tier oder ein Schaden storniert wird, während ein anderer Platz die Detailseite offen
  hat
- **THEN** sperrt sich auch diese Seite mit dem Banner

#### Scenario: Betreuungsstelle verschwindet aus der Übersicht
- **WHEN** eine Betreuungsstelle storniert wird, während ihre Detailseite offen ist
- **THEN** bleibt die Seite mit ihrem letzten Stand und dem Banner stehen, statt „Diese
  Betreuungsstelle gibt es nicht (mehr)“ zu zeigen

#### Scenario: Aufruf eines schon stornierten Datensatzes
- **WHEN** jemand die Detailseite einer bereits stornierten Person, eines Tiers oder eines Schadens
  öffnet
- **THEN** zeigt sie dasselbe Banner und keine Schreibaktion

### Requirement: Das Banner nennt, wer storniert hat und wann

Das Storno-Banner SHALL „Storniert von {Anzeigename} um {Zeit}“ lauten. Ist nicht bekannt, wer
storniert hat (Storno vor dieser Änderung), MUST es „Storniert um {Zeit}“ lauten. Das Banner MUST
oben auf der Seite stehen und für Hilfstechnik als Statusmeldung angesagt werden.

#### Scenario: Name bekannt
- **WHEN** Anna Beispiel eine Person um 14:32 storniert
- **THEN** steht auf der offenen Detailseite „Storniert von Anna Beispiel um 14:32“

#### Scenario: Altbestand ohne Nachweis
- **WHEN** eine Person vor dieser Änderung storniert wurde
- **THEN** steht auf ihrer Detailseite „Storniert um {Zeit}“ ohne Namen

### Requirement: Wer storniert, wird gespeichert

Beim Stornieren einer Person oder eines Tiers SHALL der Server festhalten, wer storniert hat, so wie
schon beim Schaden. Die Detailantworten von Person, Tier und Schaden MUST den Anzeigenamen dieses
Benutzers liefern, solange er nicht geschwärzt ist.

#### Scenario: Storno einer Person
- **WHEN** ein Benutzer eine Person storniert
- **THEN** liefert das Detail der Person `storniert_at` und den Anzeigenamen dieses Benutzers

### Requirement: Eine offene Eingabe bleibt beim Sperren lesbar

Ist beim Sperren ein Feld, ein Paneel oder ein Notizentwurf geöffnet, SHALL sein Text
schreibgeschützt stehen bleiben, sodass er sich markieren und kopieren lässt. Speichern MUST NOT
mehr möglich sein. Schließen MUST den Entwurf verwerfen, ohne nachzufragen.

#### Scenario: Notiz in Arbeit
- **WHEN** B gerade eine Notiz an der Person schreibt und A die Person storniert
- **THEN** bleibt Bs Text sichtbar und kopierbar, und der Knopf „Notiz anlegen“ ist verschwunden

### Requirement: Die Personen-Detailseite erkennt den Storno ohne Zugriffsprotokoll

Die Personen-Detailseite SHALL bei jedem Live-Ereignis zu ihrer Person den Stand der Person über
eine eigene Abfrage abgleichen, die nur `storniert_at` und den Namen liefert. Diese Abfrage MUST
NOT ins Zugriffsprotokoll schreiben und MUST dieselben Rechte wie das Detail verlangen. Das Detail
selbst MUST weiterhin nicht live nachgeladen werden. Es MUST NOT beim Fokuswechsel neu geladen
werden.

#### Scenario: Live-Abgleich schreibt kein Protokoll
- **WHEN** zehn Tabs das Detail einer Person offen haben und die Person geändert oder storniert
  wird
- **THEN** steht im Zugriffsprotokoll dieser Person kein neuer Eintrag

#### Scenario: Fensterwechsel
- **WHEN** jemand von der offenen Personen-Detailseite in ein anderes Fenster und zurück wechselt
- **THEN** wird das Detail nicht neu abgerufen, und das Zugriffsprotokoll bekommt keinen Eintrag
