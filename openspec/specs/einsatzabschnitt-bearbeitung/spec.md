# einsatzabschnitt-bearbeitung Specification

## Purpose

Regelt, wie ein Einsatzabschnitt auf der Seite Einsatzabschnitte angelegt, an seinen einzelnen
Angaben geändert und aufgelöst wird, ohne dass eine Änderung die eines anderen Arbeitsplatzes
überschreibt.

## Requirements

### Requirement: Jede Angabe an ihrem Wert bearbeiten
Das Detailpaneel der Seite Einsatzabschnitte SHALL jede Angabe des gewählten Abschnitts an ihrem
Wert bearbeitbar machen: Name, Kurzbezeichnung, Abschnittsleiter, Lagezustand, Abschnittsauftrag,
Sprechgruppen, Kommunikationsmittel, Erreichbarkeit / Nummer und Bemerkung. Den Über-Abschnitt
ändert das Umhängen in der Gliederung (Ziehen oder „Verschieben unter …“). Einen Knopf
„Bearbeiten“ und ein Formular mit allen Angaben MUST es im Detail nicht geben.

#### Scenario: Abschnittsleiter ablösen
- **WHEN** eine Person mit Schreibrecht im Detail „Abschnittsleiter bearbeiten“ wählt, eine
  andere disponierte Person auswählt und speichert
- **THEN** zeigt die Zeile die neue Person, und das übrige Detail bleibt in der Ansicht

#### Scenario: Kein Langformular
- **WHEN** eine Person mit Schreibrecht einen Abschnitt wählt
- **THEN** gibt es im Detail keinen Knopf „Bearbeiten“ und kein Formular mit mehreren Feldern

### Requirement: Ein Speichern schickt genau die geänderte Angabe
Das Speichern einer Angabe SHALL genau dieses eine Feld an
`PATCH /api/einsaetze/{id}/abschnitte/{aid}` senden. Ist der Wert unverändert, MUST keine
Anfrage entstehen. Leert jemand eine optionale Angabe, MUST das Feld als `null` gesendet werden.

#### Scenario: Zwei Angaben nacheinander aus altem Stand
- **WHEN** der Detailstand einen Abschnitt mit Lagezustand „planmäßig“ zeigt, an einem anderen
  Arbeitsplatz der Lagezustand auf „kritisch“ gesetzt wird und hier danach nur die Bemerkung
  gespeichert wird
- **THEN** enthält die gesendete Änderung nur die Bemerkung, und der Lagezustand bleibt
  „kritisch“

#### Scenario: Unverändert gespeichert
- **WHEN** jemand eine Angabe öffnet und ohne Änderung speichert
- **THEN** wird keine Anfrage gesendet, und die Zeile kehrt in die Ansicht zurück

### Requirement: Name ist Pflicht
Der Name SHALL eine Pflichtangabe sein. Wird er in der Bearbeitung geleert und gespeichert, MUST
keine Anfrage entstehen. Die Zeile MUST dann den bisherigen Namen behalten und an der Zeile
sagen, dass ein Name nötig ist.

#### Scenario: Leeren Namen speichern
- **WHEN** jemand den Namen leert und speichert
- **THEN** wird nichts gesendet, und die Zeile zeigt den Hinweis an der Eingabe

### Requirement: Kurzbezeichnung eindeutig am Feld
Eine Kurzbezeichnung, die ein anderer Abschnitt desselben Einsatzes ohne Rücksicht auf Groß- und
Kleinschreibung schon trägt, MUST am Feld abgelehnt werden, mit dem Namen des Abschnitts, der sie
trägt. Das gilt für die Zeile im Detail und für das Anlegen. Lehnt der Server dennoch ab, MUST der
Grund an der Zeile stehen.

#### Scenario: Vergebene Kurzbezeichnung
- **WHEN** „EA 1“ schon zu „Abschnitt Nord“ gehört und jemand an einem anderen Abschnitt „ea 1“
  speichert
- **THEN** wird nichts gesendet, und das Feld zeigt „Schon vergeben (Abschnitt Nord)“

### Requirement: Lagezustand mit einem Klick
Der Lagezustand SHALL im Detail als Auswahl aus vier Stufen am Wert stehen: „nicht beurteilt“,
„planmäßig“, „angespannt“, „kritisch“. Die drei beurteilten Stufen tragen Wort und Farbe. Ein Klick
auf eine andere Stufe MUST sie ohne weiteren Schritt speichern, und „nicht beurteilt“ MUST das Feld
leeren. Ein Klick auf die schon gewählte Stufe MUST NOT senden.

#### Scenario: Lage verschärft sich
- **WHEN** eine Person mit Schreibrecht bei „angespannt“ auf „kritisch“ klickt
- **THEN** wird genau `lagezustand: "kritisch"` gesendet, und das ETB erhält wie bisher einen
  System-Eintrag zum Wechsel

#### Scenario: Speichern abgelehnt
- **WHEN** der Server den Wechsel ablehnt
- **THEN** steht wieder die vorige Stufe gewählt, und der Grund steht an der Zeile Lagezustand

#### Scenario: Tastatur
- **WHEN** der Fokus auf der gewählten Stufe steht und die Pfeiltaste nach rechts gedrückt wird
- **THEN** wird die nächste Stufe gewählt und gespeichert

### Requirement: Fehler an der Zeile
Scheitert das Speichern einer Angabe, MUST der Grund an dieser Zeile stehen, und die Eingabe MUST
mit dem eingegebenen Wert offen bleiben. Ein Toast MUST für die Ablehnung nicht erscheinen. Ein
Erfolg SHALL die Zeile mit dem gespeicherten Wert schließen.

#### Scenario: Ablehnung einer Sprechgruppen-Änderung
- **WHEN** das Speichern der Sprechgruppen scheitert
- **THEN** bleibt die Auswahl offen mit der gewählten Sprechgruppe, und der Grund steht darunter

### Requirement: Ohne Schreibrecht nur die Ansicht
Ohne Schreibrecht im Einsatz (Beobachter, abgeschlossener Einsatz) MUST keine Angabe eine
Bearbeiten- oder Eintragen-Aufforderung tragen. Der Lagezustand MUST dann als Wort mit Farbe
stehen und nicht als Auswahl. Leere Angaben zeigen „—“, ein fehlender Lagezustand „nicht
beurteilt“. Anlegen und Auflösen MUST fehlen.

#### Scenario: Beobachter
- **WHEN** eine beobachtende Person einen Abschnitt wählt
- **THEN** zeigt das Detail die Angaben ohne Stift, ohne Stufenauswahl, ohne „Abschnitt anlegen“
  und ohne „Auflösen“

### Requirement: Anlegen als kurze Erfassung
„Abschnitt anlegen“ SHALL eine Erfassung mit höchstens drei sichtbaren Feldern öffnen: Name
(Pflicht), Kurzbezeichnung, Über-Abschnitt. Beim Öffnen MUST der Fokus im Namen stehen, und Enter
MUST die Erfassung absenden. Den Abschnitt MUST es erst nach dem Absenden geben. Nach dem Erfolg
SHALL die Erfassung schließen und der neue Abschnitt im Detail gewählt sein. Kopfknopf,
Leerzustand und die Schnellaktion der Sprungpalette (`?neu=1`) MUST dieselbe Erfassung öffnen.

#### Scenario: Anlegen und ergänzen
- **WHEN** jemand „Abschnitt anlegen“ wählt, „Deichverteidigung“ eingibt und Enter drückt
- **THEN** schließt die Erfassung, „Deichverteidigung“ steht gewählt in der Gliederung und im
  Detail, und Lagezustand, Leiter und Funkangaben lassen sich dort eintragen

#### Scenario: Abbrechen hinterlässt nichts
- **WHEN** jemand die Erfassung öffnet, einen Namen eingibt und abbricht
- **THEN** wird nichts gesendet, und die Gliederung zeigt keinen neuen Eintrag

#### Scenario: Aus der Sprungpalette
- **WHEN** jemand mit Schreibrecht die Schnellaktion „Einsatzabschnitt anlegen“ ausführt
- **THEN** öffnet die Seite Einsatzabschnitte in der Gliederung mit derselben Erfassung

#### Scenario: Ablehnung beim Anlegen
- **WHEN** der Server das Anlegen ablehnt
- **THEN** bleibt die Erfassung mit den eingegebenen Werten offen, und der Grund steht in ihr

### Requirement: Ein Abschnitt trägt keinen Fortschritt
Ein Einsatzabschnitt MUST keinen Fortschritt tragen. Die Oberfläche MUST keinen Fortschritt
zeigen oder erfragen, weder beim Anlegen noch im Detail, in der Abschnittsvorschau der
Sprungpalette, in der Funktionsansicht Einsatzabschnitt oder im Führungsüberblick. Der Server
MUST keinen Fortschritt speichern oder ausliefern. Schickt ein Client noch ein Feld
`fortschritt`, MUST der Server den Wert verwerfen, ohne die übrigen Angaben abzulehnen.

#### Scenario: Abschnitt ohne Fortschritt
- **WHEN** ein Abschnitt geladen wird
- **THEN** enthält die Antwort kein Feld `fortschritt`
- **AND** zeigen weder Detail noch Führungsüberblick eine Prozentzahl oder einen
  Fortschrittsbalken

#### Scenario: Bearbeiten sendet keinen Fortschritt
- **WHEN** an einem Abschnitt die Bemerkung gespeichert wird
- **THEN** enthält die gesendete Änderung kein Feld `fortschritt`

#### Scenario: Veralteter Client schickt noch einen Fortschritt
- **WHEN** ein Client einen Abschnitt mit Name „Nord“ und `fortschritt` 72 anlegt
- **THEN** legt der Server den Abschnitt „Nord“ an
- **AND** enthält die Antwort kein Feld `fortschritt`

### Requirement: Auflösen bleibt abgesetzt und rückgefragt
Mit Schreibrecht SHALL das Detail „Auflösen“ abgesetzt von den Angaben anbieten, als rot
gekennzeichneten Eintrag im Menü „Weitere Aktionen“ neben „Verschieben unter …“. Es MUST erst
nach einer Rückfrage wirken, die den Abschnitt nennt und deren Bestätigung „Abschnitt auflösen“
heißt. Eine Ablehnung MUST im Detail stehen.

#### Scenario: Auflösen bestätigen
- **WHEN** jemand im Menü „Weitere Aktionen“ „Auflösen“ wählt und „Abschnitt auflösen“ bestätigt
- **THEN** verschwindet der Abschnitt aus der Gliederung, und das Detail zeigt den ersten
  verbliebenen Abschnitt
