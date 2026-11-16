# Spec Delta

## MODIFIED Requirements

### Requirement: Knoteninhalt ohne erfundene Angaben

Jeder Abschnitts- und Einheitsknoten SHALL seine Bezeichnung, seinen Rufnamen, seine Leitung und
seine Stärke in der Schreibweise `F/UF/M//Σ` zeigen. Rufname ist beim Abschnitt die
Kurzbezeichnung und bei der Einheit der Funkrufname. Leitung ist beim Abschnitt der
Abschnittsleiter und bei der Einheit der Führer. Eine fehlende Angabe MUST als benannte Abwesenheit
erscheinen, also „kein Rufname“, „Leitung nicht besetzt“ oder „—“ bei der Stärke, und MUST NOT
geraten werden. „Leitung nicht besetzt“ MUST am Knoten gedämpft stehen und MUST NOT in einer
Warn- oder Alarmrolle erscheinen; die Warnung trägt die Sammelzeile der fehlenden Leitung.

#### Scenario: Abschnitt ohne Leitung

- **WHEN** ein Abschnitt keinen Abschnittsleiter hat
- **THEN** zeigt sein Knoten „Leitung nicht besetzt“, und zwar als Wort, nicht nur als Farbe

#### Scenario: Leitung nicht besetzt ist am Knoten leise

- **WHEN** eine Einheit keinen Führer hat
- **THEN** steht an ihrem Knoten „Leitung nicht besetzt“ in derselben gedämpften Farbe wie der
  Rufname und nicht in Achtungrolle

#### Scenario: Einheit ohne Funkrufname

- **WHEN** eine Einheit keinen Funkrufnamen trägt
- **THEN** zeigt ihr Knoten „kein Rufname“, und kein Wert wird aus dem Namen abgeleitet

### Requirement: In Lagebericht übernehmen

Das Organigramm SHALL „In Lagebericht übernehmen“ anbieten, wenn die Person im Einsatz schreiben
darf und das Modul Lageberichte freigegeben ist. Die Übernahme MUST in genau einem Aufruf einen
Freitext-Lagebericht „Führungsorganisation <DTG>“ anlegen. Er enthält die Gliederung als
verschachtelte Liste mit Rufname, Leitung und Stärke, an einem beurteilten Abschnitt dazu „Lage
<Zustand>“, und unter „Gliederung“ die Teile der Sammelzeile, wenn eine Leitung fehlt. Namen
erscheinen als Text, nie als Markup. Solange eine Quelle lädt, MUST die
Aktion gesperrt sein. Ein Fehler MUST an der Seite stehen.

#### Scenario: Erfolgreiche Übernahme

- **WHEN** eine berechtigte Person „In Lagebericht übernehmen“ wählt
- **THEN** wird genau ein `POST …/lageberichte` mit Startinhalt gesendet und kein PATCH, und die
  Person landet im neuen Bericht

#### Scenario: Übernahme mit Lagezustand und Lücken

- **WHEN** der Abschnitt „UHS Turnhalle“ als kritisch beurteilt ist, zwei Abschnitte keinen
  Abschnittsleiter haben und die Person „In Lagebericht übernehmen“ wählt
- **THEN** trägt die Zeile von „UHS Turnhalle“ im Bericht „Lage kritisch“, und unter
  „Gliederung“ steht „2 Abschnitte ohne Leitung“

#### Scenario: Name mit Markdown-Zeichen

- **WHEN** ein Abschnitt „*Nord* [alt]“ heißt
- **THEN** steht der Name im Bericht wörtlich, ohne Hervorhebung und ohne Link

#### Scenario: Ohne Schreibrecht

- **WHEN** der Einsatz abgeschlossen ist oder die Person nur lesen darf
- **THEN** fehlt die Aktion

## ADDED Requirements

### Requirement: Lagezustand am Abschnittsknoten

Ein Abschnittsknoten SHALL den gepflegten Lagezustand seines Abschnitts als Etikett neben dem Namen
zeigen, in derselben Form wie der Gliederungsbaum: Rand in der Rolle der Stufe und das Wort
„planmäßig“, „angespannt“ oder „kritisch“. Ein nicht beurteilter Abschnitt MUST ohne Etikett
bleiben. Der Knoten MUST nur den eigenen Zustand zeigen, keinen aus Unterabschnitten.

#### Scenario: Kritischer Abschnitt

- **WHEN** der Abschnitt „UHS Turnhalle“ als kritisch beurteilt ist
- **THEN** trägt sein Knoten neben dem Namen das Etikett „kritisch“ in Alarmrolle

#### Scenario: Nicht beurteilter Abschnitt

- **WHEN** an einem Abschnitt kein Lagezustand gepflegt ist
- **THEN** trägt sein Knoten kein Lagezustandsetikett, auch kein neutrales

#### Scenario: Unterabschnitt schlechter als sein Abschnitt

- **WHEN** ein planmäßiger Abschnitt einen kritischen Unterabschnitt hat
- **THEN** trägt der Abschnitt „planmäßig“ und der Unterabschnitt darunter „kritisch“

### Requirement: Lagezustand fließt live

Eine Änderung des Lagezustands SHALL am gezeigten Knoten live erscheinen, auch während die Schleuse
die Struktur hält. Ausgenommen MUST ein umgehängter Knoten am alten Ort sein: er zeigt seinen
gehaltenen Inhalt bis „anzeigen“ oder bis die Schleuse öffnet.

#### Scenario: Zustand ändert sich, während der Zeiger über dem Organigramm liegt

- **WHEN** der Mauszeiger über dem Organigramm liegt und an einem anderen Arbeitsplatz ein
  gezeigter Abschnitt auf „kritisch“ gesetzt wird
- **THEN** zeigt sein Knoten an derselben Stelle sofort „kritisch“, ohne Sammelbanner

### Requirement: Sammelzeile der fehlenden Leitung

Über dem Organigramm SHALL eine Sammelzeile die Knoten ohne Leitung zählen, je Art ein Etikett in
Achtungrolle: Abschnitte ohne Abschnittsleiter, Einheiten ohne Führer, Wort in Einzahl oder
Mehrzahl. Ein Teil mit 0 MUST entfallen. Gezählt werden alle Knoten im Live-Stand, Einheiten ohne
Abschnitt und unterstellte eingeschlossen. Die Zeile MUST auch im Druck stehen.

#### Scenario: Abschnitte und Einheiten ohne Leitung

- **WHEN** zwei Abschnitte keinen Abschnittsleiter und sieben Einheiten keinen Führer haben
- **THEN** stehen über dem Organigramm die Etiketten „2 Abschnitte ohne Leitung“ und „7 Einheiten
  ohne Führer“

#### Scenario: Nur eine Einheit ohne Führer

- **WHEN** alle Abschnitte einen Abschnittsleiter haben und genau eine Einheit keinen Führer
- **THEN** steht über dem Organigramm nur das Etikett „1 Einheit ohne Führer“

#### Scenario: Einheiten nicht geladen

- **WHEN** die Abschnitte geladen sind, die Einheiten aber nicht, und ein Abschnitt keinen
  Abschnittsleiter hat
- **THEN** nennt die Sammelzeile „1 Abschnitt ohne Leitung“ und keine Zahl zu Einheiten, auch
  nicht „0“

#### Scenario: Druck mit Lücken

- **WHEN** ein Abschnitt keinen Abschnittsleiter hat und die Person „Drucken / als PDF“ wählt
- **THEN** steht die Sammelzeile auch im Ausdruck über dem Organigramm

### Requirement: Sammelzeile ohne Lücke und ohne Sprung

Die Sammelzeile SHALL immer gleich hoch dastehen, auch während die Schleuse die Struktur hält.
Fehlt keine Leitung, MUST sie leise „Leitung überall besetzt“ nennen, bei nicht geladenen Einheiten
„Alle Abschnitte mit Leitung“, ohne Etikett in Achtungrolle; ohne jeden Knoten bleibt sie leer.
Ihr Wechsel MUST den Baum nicht verschieben.

#### Scenario: Alles besetzt

- **WHEN** jeder Abschnitt einen Abschnittsleiter und jede Einheit einen Führer hat
- **THEN** steht über dem Organigramm leise „Leitung überall besetzt“ und kein Etikett in
  Achtungrolle

#### Scenario: Leitung fällt weg, während jemand im Organigramm arbeitet

- **WHEN** alle Knoten besetzt sind, der Mauszeiger über dem Organigramm liegt und live an einer
  gezeigten Einheit der Führer gelöscht wird
- **THEN** zeigen der Knoten „Leitung nicht besetzt“ und die Sammelzeile „1 Einheit ohne Führer“
  sofort, und die erste Ebene des Organigramms bleibt auf derselben Höhe

#### Scenario: Neue Lücke wartet hinter dem Sammelbanner

- **WHEN** der Mauszeiger über dem Organigramm liegt und live eine Einheit ohne Führer hinzukommt
- **THEN** zählt die Sammelzeile sie sofort, während der Knoten hinter dem Sammelbanner wartet, und
  weder „anzeigen“ noch das Verlassen verschiebt die erste Ebene
