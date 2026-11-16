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
<Zustand>“, und unter „Gliederung“ die Sammelzeile der fehlenden Leitung, soweit sie am
Bildschirm stünde. Namen erscheinen als Text, nie als Markup. Solange eine Quelle lädt, MUST die
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
bleiben. Der Knoten MUST nur den eigenen Zustand zeigen, keinen aus Unterabschnitten. Eine
Änderung des Lagezustands MUST live erscheinen, auch während die Schleuse die Struktur hält.

#### Scenario: Kritischer Abschnitt

- **WHEN** der Abschnitt „UHS Turnhalle“ als kritisch beurteilt ist
- **THEN** trägt sein Knoten neben dem Namen das Etikett „kritisch“ in Alarmrolle

#### Scenario: Nicht beurteilter Abschnitt

- **WHEN** an einem Abschnitt kein Lagezustand gepflegt ist
- **THEN** trägt sein Knoten kein Lagezustandsetikett, auch kein neutrales

#### Scenario: Unterabschnitt schlechter als sein Abschnitt

- **WHEN** ein planmäßiger Abschnitt einen kritischen Unterabschnitt hat
- **THEN** trägt der Abschnitt „planmäßig“ und der Unterabschnitt darunter „kritisch“

#### Scenario: Zustand ändert sich, während der Zeiger über dem Organigramm liegt

- **WHEN** der Mauszeiger über dem Organigramm liegt und an einem anderen Arbeitsplatz ein
  gezeigter Abschnitt auf „kritisch“ gesetzt wird
- **THEN** zeigt sein Knoten an derselben Stelle sofort „kritisch“, ohne Sammelbanner

### Requirement: Sammelzeile der fehlenden Leitung

Oberhalb des Baums SHALL eine Sammelzeile in Achtungrolle die Knoten ohne Leitung zählen, getrennt
nach Abschnitten ohne Abschnittsleiter und Einheiten ohne Führer, mit dem Wort für jede Zahl in
Einzahl oder Mehrzahl. Ein Teil mit der Zahl 0 MUST entfallen; sind alle Knoten besetzt, MUST die
Zeile fehlen. Gezählt wird der Live-Stand der Gliederung, Einheiten ohne Abschnitt und
unterstellte Einheiten eingeschlossen. Die Zeile MUST auch im Druck stehen.

#### Scenario: Abschnitte und Einheiten ohne Leitung

- **WHEN** zwei Abschnitte keinen Abschnittsleiter und sieben Einheiten keinen Führer haben
- **THEN** steht über dem Baum „2 Abschnitte ohne Leitung · 7 Einheiten ohne Führer“

#### Scenario: Nur eine Einheit ohne Führer

- **WHEN** alle Abschnitte einen Abschnittsleiter haben und genau eine Einheit keinen Führer
- **THEN** steht über dem Baum „1 Einheit ohne Führer“ und kein Teil zu Abschnitten

#### Scenario: Alles besetzt

- **WHEN** jeder Abschnitt einen Abschnittsleiter und jede Einheit einen Führer hat
- **THEN** steht über dem Baum keine Sammelzeile

#### Scenario: Einheiten nicht geladen

- **WHEN** die Abschnitte geladen sind, die Einheiten aber nicht, und ein Abschnitt keinen
  Abschnittsleiter hat
- **THEN** nennt die Sammelzeile „1 Abschnitt ohne Leitung“ und keine Zahl zu Einheiten, auch
  nicht „0“

#### Scenario: Druck mit Lücken

- **WHEN** ein Abschnitt keinen Abschnittsleiter hat und die Person „Drucken / als PDF“ wählt
- **THEN** steht die Sammelzeile auch im Ausdruck über dem Baum
