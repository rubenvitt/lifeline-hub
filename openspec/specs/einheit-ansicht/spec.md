# einheit-ansicht Specification

## Purpose
Die Ansicht einer Einheit im Einsatz (`/einsaetze/:id/einheiten/:einheitId`) zeigt ihre Angaben
als Werte und lässt jede an ihrer Zeile bearbeiten, ohne Formular und Speichern-Leiste; ein
Speichern schickt genau die geänderte Angabe. Dazu gehören Kopf mit Stärke, Urteil und Status,
das taktische Zeichen und das abgesetzte Auflösen (LLH-1036 Teil I), die Fahrzeuge mit ihrer
Besatzung, die Aktionen je Person über ein Menü und das Zuordnen aus Einsatz oder Stamm
(LLH-1036 Teil II).

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

### Requirement: Fahrzeuge mit ihrer Besatzung
Die Ansicht SHALL die Fahrzeuge der Einheit mit taktischem Zeichen, Funkrufname, Typ, FMS-Status
und Besatzung Ist/Soll mit Wort zeigen und unter jedem Fahrzeug die Personen der Einheit, die
darauf sitzen, mit den Marken EF, F, UF und M in dieser Reihenfolge. Die Rechnung MUST dieselbe
sein wie im Meldebild.

#### Scenario: Besatzung je Fahrzeug
- **WHEN** eine Einheit die Fahrzeuge „83-1“ mit drei Personen und „83-2“ ohne Besatzung hat und
  eine weitere Person ohne Fahrzeug
- **THEN** stehen die drei Personen unter 83-1, 83-2 ohne Personen und die weitere Person unter
  „Ohne Fahrzeug“

### Requirement: Personal ohne Fahrzeug
Hat die Einheit Fahrzeuge, MUST ihr Personal ohne Fahrzeug unter „Ohne Fahrzeug“ stehen; sitzt
eine Person auf dem Fahrzeug einer anderen Einheit, MUST sie dort mit „fährt auf <Funkrufname>“
stehen. Hat die Einheit kein Fahrzeug, MUST ihr Personal ohne Zwischenebene stehen.

#### Scenario: Einheit ohne Fahrzeug
- **WHEN** eine Einheit ohne Fahrzeug drei Personen hat
- **THEN** stehen die drei Personen direkt in der Einheit, ohne Gruppe „Ohne Fahrzeug“

#### Scenario: Person auf fremdem Fahrzeug
- **WHEN** eine Person der Einheit auf einem Fahrzeug einer anderen Einheit sitzt
- **THEN** steht sie unter „Ohne Fahrzeug“ mit „fährt auf“ und dem Funkrufnamen dieses Fahrzeugs

### Requirement: Besatzung nur mit Freigabe Personal und Fahrzeuge
Fehlt der Person die Freigabe des Moduls Personal oder des Moduls Fahrzeuge, MUST die Ansicht die
Besatzung nicht zeigen. Sie MUST dann die Fahrzeuge der Einheit und ihre Mitglieder ohne
Zuordnung zu Fahrzeugen zeigen und das gesperrte Modul in wenigen Wörtern nennen. Die Ansicht
MUST für ein gesperrtes Modul keine Liste abfragen und keinen Link in dieses Modul zeigen.

#### Scenario: Personal gesperrt
- **WHEN** eine Person ohne Freigabe Personal eine Einheit mit zwei Fahrzeugen und fünf
  Mitgliedern öffnet
- **THEN** stehen die zwei Fahrzeuge und die fünf Mitglieder ohne Besatzungszuordnung da, mit dem
  Hinweis „Ohne Besatzung · Modul Personal gesperrt“, und kein Name verlinkt ins Modul Personal

### Requirement: Aktionen je Person über ein Menü
Jede Person der Einheit SHALL ihre Aktionen über genau einen Menü-Auslöser anbieten, der ihren
Namen trägt: „Als Einheitsführer“ (nicht beim Einheitsführer selbst), je anderem Fahrzeug der
Einheit „Auf <Funkrufname>“, dann
nach einem Trenner rot „Vom Fahrzeug lösen“ (nur wer auf einem Fahrzeug sitzt) und rot „Aus
Einheit lösen“. Lösen MUST ohne Rückfrage wirken, und „Aus Einheit lösen“ MUST die Person im
Einsatz lassen.

#### Scenario: Person auf ein Fahrzeug setzen
- **WHEN** eine Person mit Schreibrecht im Menü einer Person ohne Fahrzeug „Auf 83-1“ wählt
- **THEN** steht die Person danach unter 83-1, und das ETB erhält wie bisher einen
  Besatzungs-Eintrag

### Requirement: Menüeinträge nach Modulrecht
Die Einträge „Auf <Funkrufname>“ und „Vom Fahrzeug lösen“ MUST nur mit Schreibrecht im Modul
Fahrzeuge und sichtbarer Besatzung erscheinen, „Als Einheitsführer“ und „Aus Einheit lösen“ nur mit Schreibrecht im Modul
Einheiten. Bleibt kein Eintrag, MUST der Auslöser fehlen.

#### Scenario: Ohne Recht auf Fahrzeuge
- **WHEN** eine Rolle ohne Zugriff auf das Modul Fahrzeuge das Menü einer Person öffnet
- **THEN** fehlen „Auf …“ und „Vom Fahrzeug lösen“, und „Als Einheitsführer“ und „Aus Einheit
  lösen“ stehen da

### Requirement: Person und Fahrzeug aus Einsatz oder Stamm zuordnen
Die Auswahl „Person zuordnen …“ SHALL disponierte Personen ohne Einheit unter „Im Einsatz frei“
und Stamm-Personen im Dienst, die weder aktiv disponiert noch aus dem Einsatz entlassen sind,
unter „Aus dem Stamm“ anbieten,
Demo-Stammdaten als eigene Gruppe dahinter. „Fahrzeug zuordnen …“ SHALL dasselbe für Fahrzeuge
tun. Die Gruppe „Aus dem Stamm“ MUST nur mit Schreibrecht im Modul der Kraft erscheinen.

#### Scenario: Stamm ohne Recht auf Personal
- **WHEN** eine Rolle mit Schreibrecht im Modul Einheiten, aber ohne Zugriff auf das Modul
  Personal „Person zuordnen …“ öffnen will
- **THEN** bietet die Ansicht keine Gruppe „Aus dem Stamm“ an

### Requirement: Stamm-Eintrag in einem Schritt
Ein Stamm-Eintrag MUST die Kraft in einer Anfrage über die Sammel-Disposition disponieren und
der Einheit zuordnen, alles oder nichts. Lehnt der Server ab, MUST der Grund der Kraft unter der
Auswahl stehen, und nichts ist angelegt.

#### Scenario: Person aus dem Stamm
- **WHEN** eine Person mit Schreibrecht in „Person zuordnen …“ unter „Aus dem Stamm“ „Erika
  Muster“ wählt
- **THEN** ist Erika Muster disponiert, mit Initialstatus in der Zeitachse, und steht in der
  Einheit

#### Scenario: Stamm-Person außer Dienst
- **WHEN** die gewählte Stamm-Person inzwischen außer Dienst steht
- **THEN** steht unter der Auswahl „Nicht zugeordnet“ mit dem Grund „außer Dienst“, kein Toast
  erscheint, und die Person ist nicht disponiert

#### Scenario: Fahrzeug aus dem Stamm
- **WHEN** eine Person mit Schreibrecht in „Fahrzeug zuordnen …“ unter „Aus dem Stamm“ ein
  Fahrzeug wählt
- **THEN** ist das Fahrzeug disponiert und steht in der Einheit

### Requirement: Ohne Schreibrecht nur die Ansicht
Ohne Schreibrecht im Einsatz (Beobachter, abgeschlossener Einsatz) MUST keine Angabe eine
Bearbeiten- oder Eintragen-Aufforderung tragen, und es MUST weder Menüs noch Lösen-Knöpfe noch
Zuordnen-Auswahl noch den Abschnitt „Einheit auflösen“ geben. Status und FMS-Status MUST als Wort
stehen, leere Angaben als „—“.

#### Scenario: Beobachter
- **WHEN** eine beobachtende Person eine Einheit öffnet
- **THEN** zeigt die Ansicht Angaben, Besatzung und Zeitachse ohne jedes Bedienelement außer
  Links

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

### Requirement: Nicht übernommene Einheit übernehmen
Die Ansicht einer nicht übernommenen Einheit SHALL im Paneel „Kopfdaten“ „nicht übernommen“
zeigen und, mit Schreibrecht und Freigabe Einheiten, unter dem Kopf das Paneel „Übernahme“ mit
„Übernehmen“ und „Abweisen“. „Übernehmen“ MUST Abschnitt und Über-Einheit optional abfragen
(keine eigene Untereinheit, keine aufgelöste) und genau eine Übernahme senden. Ablehnungen MUST
am Ort stehen, ohne Toast.

#### Scenario: Übernehmen mit Abschnitt
- **WHEN** eine Person mit Schreibrecht an einer nicht übernommenen Einheit „Übernehmen“ wählt, Abschnitt Nord setzt und bestätigt
- **THEN** sendet die Ansicht genau eine Übernahme mit Abschnitt Nord, und danach zeigt die Ansicht weder das Wort noch die beiden Knöpfe

#### Scenario: Über-Einheit ohne eigene Untereinheiten
- **WHEN** jemand eine nicht übernommene Einheit mit einer Untereinheit übernimmt
- **THEN** bietet „Über-Einheit“ weder die Einheit selbst noch ihre Untereinheit an

#### Scenario: Ohne Schreibrecht
- **WHEN** eine Person ohne Schreibrecht eine nicht übernommene Einheit öffnet
- **THEN** zeigt die Ansicht „nicht übernommen“ ohne „Übernehmen“ und „Abweisen“

### Requirement: Nicht übernommene Einheit abweisen
„Abweisen“ an einer nicht übernommenen Einheit SHALL rot stehen, nur mit Freigabe Fahrzeuge, und
MUST vor dem Senden mit „Einheit abweisen?“, einem Satz zur Folge und „Abweisen“ fragen; danach
MUST die Gliederung erscheinen wie nach dem Auflösen.

#### Scenario: Abweisen abgebrochen
- **WHEN** jemand „Abweisen“ wählt und die Rückfrage abbricht
- **THEN** wird nichts gesendet

#### Scenario: Abgewiesen
- **WHEN** jemand „Abweisen“ wählt und die Rückfrage mit „Abweisen“ bestätigt
- **THEN** sendet die Ansicht genau eine Abweisung, und danach erscheint die Gliederung

### Requirement: Übernahme an der Meldung
Die Meldung des Eintreffens einer nicht übernommenen Einheit SHALL in der Meldungsliste
„Übernehmen“ und „Abweisen“ tragen wie die Ansicht der Einheit; ohne Recht an Einheiten MUST dort
nur ein Verweis auf die Einheit stehen.

#### Scenario: Meldung mit Knöpfen
- **WHEN** die Einsatzleitung die Meldung „FL-MUS 1-44-1 unangemeldet im BR Sportplatz eingetroffen …“ sieht
- **THEN** trägt die Meldung „Übernehmen“ und „Abweisen“

#### Scenario: Ohne Recht an Einheiten
- **WHEN** eine Person ohne Recht an Einheiten dieselbe Meldung sieht
- **THEN** trägt die Meldung nur den Verweis „↗ FL-MUS 1-44-1“
