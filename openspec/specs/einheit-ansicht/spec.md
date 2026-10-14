# einheit-ansicht Specification

## Purpose
Die Ansicht einer Einheit im Einsatz (`/einsaetze/:id/einheiten/:einheitId`) zeigt ihre Angaben
als Werte und lässt jede an ihrer Zeile bearbeiten, ohne Formular und Speichern-Leiste; ein
Speichern schickt genau die geänderte Angabe. Dazu gehören Kopf mit Stärke, Urteil und Status,
das taktische Zeichen und das abgesetzte Auflösen (LLH-1036).

## Requirements

### Requirement: Jede Angabe an ihrem Wert bearbeiten
Die Ansicht einer Einheit SHALL jede Angabe der Einheit, auch Funkangaben und taktisches
Zeichen, als Wert zeigen und an diesem Wert bearbeitbar machen. Einen Knopf „Bearbeiten“, ein
Formular mit mehreren Angaben und eine Speichern-Leiste MUST es nicht geben. Ohne Klick MUST kein
Eingabefeld einer Angabe im Dokument stehen; ein Klick MUST genau eine Angabe öffnen.

#### Scenario: Ansicht ohne Formular
- **WHEN** eine Person mit Schreibrecht eine Einheit öffnet
- **THEN** zeigt die Ansicht die Angaben als Werte, und es gibt weder einen Knopf „Bearbeiten“
  noch ein Eingabefeld einer Angabe noch eine Speichern-Leiste

#### Scenario: Abschnitt an der Zeile ändern
- **WHEN** eine Person mit Schreibrecht die Zeile „Abschnitt“ öffnet, einen anderen Abschnitt
  wählt und speichert
- **THEN** zeigt die Zeile den neuen Abschnitt, die übrigen Angaben bleiben in der Ansicht, und
  ein Hinweis nennt „Abschnitt gespeichert“

### Requirement: Ein Speichern schickt genau die geänderte Angabe
Das Speichern einer Angabe SHALL genau dieses eine Feld an
`PATCH /api/einsaetze/{id}/einheiten/{eid}` senden; die Soll-Stärke MUST als ihre drei Felder in
einer Anfrage gehen. Ist der Wert unverändert, MUST keine Anfrage entstehen. Leert jemand eine
optionale Angabe, MUST das Feld als `null` gesendet werden, die Sprechgruppen als leere Liste.
Eine Änderung, die ein anderer Arbeitsplatz an einer anderen Angabe gemacht hat, MUST dabei
erhalten bleiben.

#### Scenario: Zwei Arbeitsplätze, zwei Angaben
- **WHEN** die Ansicht eine Einheit mit Abschnitt „Nord“ zeigt, an einem anderen Arbeitsplatz der
  Abschnitt auf „Süd“ gesetzt wird und hier danach nur der Funkrufname gespeichert wird
- **THEN** enthält die gesendete Änderung nur den Funkrufnamen, und der Abschnitt bleibt „Süd“

#### Scenario: Einheitsführer wechseln
- **WHEN** eine Person mit Schreibrecht eine andere Person der Einheit als Einheitsführer setzt
- **THEN** enthält die gesendete Änderung nur `fuehrer_id`, und das ETB erhält wie bisher einen
  System-Eintrag zum Wechsel

#### Scenario: Unverändert gespeichert
- **WHEN** jemand eine Angabe öffnet und ohne Änderung speichert
- **THEN** wird keine Anfrage gesendet, und die Zeile kehrt in die Ansicht zurück

### Requirement: Name ist Pflicht
Der Name SHALL eine Pflichtangabe sein. Wird er geleert und gespeichert, MUST keine Anfrage
entstehen, und die Zeile MUST den bisherigen Namen behalten und an der Eingabe sagen, dass ein
Name nötig ist.

#### Scenario: Leeren Namen speichern
- **WHEN** jemand den Namen leert und speichert
- **THEN** wird nichts gesendet, und die Zeile zeigt den Hinweis an der Eingabe

### Requirement: Fehler am Ort der Handlung
Scheitert eine Handlung der Ansicht, MUST ihr Grund an ihrem Ort stehen: an der Zeile der Angabe
(die Eingabe bleibt mit dem eingegebenen Wert offen), an der Zeile der Person oder des
Fahrzeugs, unter der Zuordnen-Auswahl bzw. im Abschnitt „Einheit auflösen“. Ein Toast MUST für
eine Ablehnung nicht erscheinen. Ein Wechsel zu einer anderen Einheit MUST alle Gründe räumen.

#### Scenario: Abgelehnte Soll-Stärke
- **WHEN** das Speichern der Soll-Stärke abgelehnt wird
- **THEN** bleibt die Eingabe mit den eingegebenen Zahlen offen, und der Grund steht darunter

#### Scenario: Wechsel der Einheit
- **WHEN** an der Zeile einer Person ein Grund steht und jemand zu einer anderen Einheit wechselt
- **THEN** zeigt die andere Einheit keinen Grund

### Requirement: Kopf zeigt Stärke, Urteil und Status
Der Kopf der Ansicht SHALL das taktische Zeichen der Einheit groß zeigen, dazu die Ist-Stärke
des Servers, bei Untereinheiten auch kumuliert, und ein Urteil der kumulierten Ist-Stärke gegen
die Soll-Stärke mit Wort („unterbesetzt“, „erfüllt“). Ohne Soll-Stärke MUST kein Urteil
erscheinen. Der Status MUST mit „seit“ stehen. Hat die Einheit kein Fahrzeug, MUST eine Person
mit Schreibrecht den Status dort setzen und leeren können; mit Fahrzeugen MUST der Status nur
angezeigt werden.

#### Scenario: Unterbesetzte Einheit
- **WHEN** eine Einheit mit Soll 1/2/6 kumuliert die Ist-Stärke 1/1/4 hat
- **THEN** zeigt der Kopf beide Stärken und das Wort „unterbesetzt“

#### Scenario: Einheit ohne Fahrzeug
- **WHEN** eine Person mit Schreibrecht bei einer Einheit ohne Fahrzeug am Status „kein Status“
  wählt
- **THEN** wird der Handstatus der Einheit geleert

### Requirement: Taktisches Zeichen in der Ansicht pflegen
Die Ansicht SHALL Fachaufgabe und Organisation des taktischen Zeichens an je einer Zeile pflegen
lassen, mit denselben Auswahlwerten wie der Inspector der Lagekarte. Ein Speichern MUST genau
das eine Zeichenfeld über `PATCH /api/einsaetze/{id}/einheiten/{eid}/position` senden, ohne
Koordinate, und MUST NOT einen ETB-Eintrag erzeugen. Beim Ändern MUST das Eingabefeld eine
Vorschau des Zeichens mit dem gewählten Wert zeigen.

#### Scenario: Organisation setzen
- **WHEN** eine Person mit Schreibrecht an einer verorteten Einheit die Organisation „THW“ wählt
  und speichert
- **THEN** enthält die Anfrage nur `tz_organisation`, die Verortung bleibt, das ETB erhält keinen
  Eintrag, und das Zeichen der Einheit im Meldebild trägt danach die Organisation THW

### Requirement: Vorgabe der Organisation am Zeichen
Ist die Organisation des Zeichens leer und hat die Organisation des Mandanten eine Vorgabe, MUST
die Zeile „Vorgabe der Organisation: <Wert>“ zeigen, und das Zeichen im Kopf MUST diese Vorgabe
tragen.

#### Scenario: Vorgabe der Organisation
- **WHEN** die Organisation der Einheit leer ist und die Vorgabe der Organisation „Feuerwehr“ lautet
- **THEN** zeigt die Zeile „Vorgabe der Organisation: Feuerwehr“, und das Zeichen im Kopf trägt
  die Organisation Feuerwehr

### Requirement: Auflösen abgesetzt und rückgefragt
Mit Schreibrecht SHALL die Ansicht „Einheit auflösen“ als letzten Abschnitt der Seite anbieten,
mit rotem Knopf, abgesetzt von den Angaben. Es MUST erst nach einer Rückfrage wirken, die die
Folge in einem Satz nennt und deren Bestätigung „Einheit auflösen“ heißt. Nach dem Auflösen MUST
die Gliederung der Einheiten erscheinen. Eine Ablehnung MUST im Abschnitt stehen.

#### Scenario: Auflösen bestätigen
- **WHEN** jemand „Einheit auflösen“ wählt und die Rückfrage mit „Einheit auflösen“ bestätigt
- **THEN** zeigt die App die Gliederung, und die Einheit steht dort nicht mehr unter den aktiven

#### Scenario: Auflösen abgelehnt
- **WHEN** der Server das Auflösen ablehnt
- **THEN** bleibt die Ansicht stehen, und der Grund steht im Abschnitt „Einheit auflösen“
