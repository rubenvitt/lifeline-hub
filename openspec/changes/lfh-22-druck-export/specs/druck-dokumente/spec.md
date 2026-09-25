# Spec Delta

## Purpose

Legt fest, wie ein Druckstück der App (Lagebericht, Befehl, Meldebild, ETB-Druck) über den
Druckdialog des Browsers vollständig, zuordenbar und lesbar auf Papier oder in ein PDF kommt.

## ADDED Requirements

### Requirement: Druck über den Browser, kein Server-PDF

Das System SHALL jedes Druckstück ausschließlich über den Druckdialog des Browsers
(„Drucken“ bzw. „als PDF speichern“) ausgeben. Das System MUST kein PDF auf dem Server
erzeugen und MUST dafür keine zusätzliche Laufzeitkomponente voraussetzen.

#### Scenario: Drucken öffnet den Druckdialog

- **WHEN** eine Person auf einer Seite mit Druckstück „Drucken / als PDF“ wählt
- **THEN** öffnet sich der Druckdialog des Browsers mit dem Druckstück
- **AND** der Server bekommt dafür keine eigene Anfrage zur PDF-Erzeugung

### Requirement: Mehrseitiger Druck in allen drei Browsern

Ein Druckstück SHALL im Ausdruck im normalen Dokumentfluss stehen, sodass es in Chromium
(Chrome, Edge), Firefox und Safari auf beliebig viele Seiten umbricht. Das System MUST NOT einen Teil des
Druckstücks nach der ersten Seite abschneiden.

#### Scenario: Langer Lagebericht über mehrere Seiten

- **WHEN** ein Lagebericht mit mehr Text als eine Seite fasst gedruckt wird
- **THEN** erscheint der letzte Abschnitt vollständig im Ausdruck
- **AND** das gilt im Lesezweig (freigegeben) und im Entwurfszweig

#### Scenario: Langer Befehl und großes Meldebild

- **WHEN** ein Befehl oder ein Meldebild gedruckt wird, das mehr als eine Seite füllt
- **THEN** stehen alle Abschnitte bzw. alle Zeilen im Ausdruck

#### Scenario: Seitenanfang ohne Leerraum

- **WHEN** ein Druckstück gedruckt wird
- **THEN** beginnt es oben auf der ersten Seite, ohne Leerraum an der Stelle von
  ausgeblendeten Rahmenteilen, und es entsteht keine Leerseite

### Requirement: Rahmen und schwebende Ebenen erscheinen nicht im Ausdruck

Beim Druck eines Druckstücks SHALL das System den App-Rahmen (Kopfleiste, Kategorieleiste,
Modulpanel, Hinweisbanner, Seitenkopf mit Aktionen) und alle schwebenden Ebenen (Dialoge,
Meldungen, aufgeklappte Menüs, Drawer) weglassen. Weggelassene Teile MUST keinen Platz im
Ausdruck belegen. Bedienelemente innerhalb des Druckstücks (Knöpfe, Umschalter,
Beschriftungen des Editors, „Nicht gespeichert“-Hinweise) MUST ebenfalls fehlen.

#### Scenario: Offener Dialog beim Drucken

- **WHEN** beim Drucken ein Dialog oder eine Meldung geöffnet ist
- **THEN** erscheint davon nichts im Ausdruck

#### Scenario: Rahmen belegt keinen Platz

- **WHEN** ein Druckstück gedruckt wird
- **THEN** stehen Kopfleiste, Kategorieleiste und Modulpanel nicht im Ausdruck
- **AND** der Druckbereich nutzt die volle Seitenbreite

### Requirement: Umbruchregeln im Lese- und Entwurfszweig

Im Ausdruck SHALL ein Abschnittstitel nicht allein am Seitenende stehen; er MUST mit dem
Anfang seines Textes auf derselben Seite beginnen. Absätze, Listen, Zitate, Tabellenzeilen und
Codeblöcke SHALL nicht über einen Seitenumbruch zerrissen werden, solange sie auf eine Seite
passen. Der Kopf einer Tabelle SHALL sich auf jeder Folgeseite wiederholen. Diese Regeln MUST
im Lesezweig und im Entwurfszweig eines Lageberichts oder Befehls gleich gelten.

#### Scenario: Abschnittstitel am Seitenende

- **WHEN** ein Abschnittstitel eines Lageberichts ans Seitenende fallen würde
- **THEN** wandert er mit seinem Text auf die nächste Seite

#### Scenario: Tabelle im Markdown über zwei Seiten

- **WHEN** ein Abschnitt eine Tabelle enthält, die über eine Seite hinausgeht
- **THEN** steht ihr Kopf auch auf der Folgeseite
- **AND** keine Zeile ist durch den Seitenrand geteilt

#### Scenario: Entwurf mit Tabelle und Codeblock

- **WHEN** ein Entwurf gedruckt wird, dessen Abschnitte eine Tabelle und einen Codeblock
  enthalten
- **THEN** gelten dieselben Umbruchregeln wie im freigegebenen Dokument

### Requirement: Entwurf druckt jeden Abschnitt genau einmal

Der Ausdruck eines Entwurfs SHALL jeden Abschnitt genau einmal zeigen: die gerenderte
Fassung, wenn eine Vorschau vorhanden ist, sonst den eingegebenen Text. Zugeklappte Abschnitte
MUST mitgedruckt werden. Ein Abschnitt MUST NOT leer gedruckt werden, weil seine Eingabe
ausgeblendet ist.

#### Scenario: Entwurf mit zugeklappten Abschnitten

- **WHEN** ein Lagebericht-Entwurf mit acht Abschnitten gedruckt wird, von denen sieben
  zugeklappt sind
- **THEN** stehen alle acht Abschnitte im Ausdruck, jeder genau einmal

### Requirement: Papier ist hell

Ein Druckstück SHALL unabhängig vom gewählten Anzeigemodus mit dunkler Schrift auf hellem
Grund gedruckt werden.

#### Scenario: Druck im Nachtbetrieb

- **WHEN** eine Person im Nachtbetrieb druckt
- **THEN** steht der Text schwarz auf weißem Grund

### Requirement: Gemeinsamer Druckkopf

Jedes Druckstück SHALL auf der ersten Seite einen Druckkopf tragen, der das Dokument ohne
Bildschirm zuordenbar macht: Name der Organisation, Logo der Organisation (falls hinterlegt),
Dokumentart und -titel, Einsatzbezeichnung mit Einsatznummer (falls vergeben), Stand der Daten
bzw. die gedruckte Auswahl, Name der druckenden Person und Druckzeitpunkt. Zeitangaben im
Druckkopf MUST in der Zeitzone der Organisation stehen. Lagebericht, Befehl, Meldebild und
ETB-Druck MUST denselben Druckkopf verwenden. Am Bildschirm SHALL der Druckkopf nur auf der
ETB-Druckansicht sichtbar sein.

#### Scenario: Meldebild mit Auswahl

- **WHEN** ein gefiltertes Meldebild gedruckt wird
- **THEN** nennt der Druckkopf Organisation, „Meldebild“, Einsatz, Stand, Auswahl, Ersteller
  und Druckzeitpunkt

#### Scenario: Organisation ohne Logo

- **WHEN** die Organisation kein Logo hinterlegt hat
- **THEN** zeigt der Druckkopf nur den Namen, ohne Platzhalter und ohne leeren Bildrahmen

#### Scenario: Druck erst mit geladenem Kopf

- **WHEN** eine Person „Drucken / als PDF“ wählt, bevor Organisationsdaten oder Logo geladen
  sind
- **THEN** öffnet sich der Druckdialog erst, wenn Name und (falls vorhanden) Logo bereitstehen
- **AND** scheitert das Laden des Logos, wird ohne Logo gedruckt statt gar nicht

### Requirement: Seitenzählung, wo der Browser sie trägt

Wo der Browser Randfelder der Druckseite unterstützt, SHALL jede Seite eine Seitenzählung
„Seite n von m“ tragen. In Browsern ohne diese Unterstützung MUST der Ausdruck trotzdem
vollständig und über den Druckkopf zuordenbar sein.

#### Scenario: Seitenzählung in Chromium

- **WHEN** ein mehrseitiges Druckstück in Chromium gedruckt wird
- **THEN** trägt jede Seite die Seitenzählung
