# druck-dokumente Specification

## Purpose
Legt fest, wie ein Druckstück der App (Lagebericht, Befehl, Meldebild, ETB-Druck, Einsatzbericht) über den
Druckdialog des Browsers vollständig, zuordenbar und lesbar auf Papier oder in ein PDF kommt.

## Requirements

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
Druckkopf MUST in der Zeitzone der Organisation stehen. Lagebericht, Befehl, Meldebild,
ETB-Druck und Einsatzbericht MUST denselben Druckkopf verwenden. Am Bildschirm SHALL der
Druckkopf nur auf den Druckansichten (ETB-Druck, Einsatzbericht) sichtbar sein.

#### Scenario: Meldebild mit Auswahl

- **WHEN** ein gefiltertes Meldebild gedruckt wird
- **THEN** nennt der Druckkopf Organisation, „Meldebild“, Einsatz, Stand, Auswahl, die
  druckende Person („Gedruckt von“) und den Druckzeitpunkt („Gedruckt am“)

#### Scenario: Organisation ohne Logo

- **WHEN** die Organisation kein Logo hinterlegt hat
- **THEN** zeigt der Druckkopf nur den Namen, ohne Platzhalter und ohne leeren Bildrahmen

#### Scenario: Druck erst mit geladenem Kopf

- **WHEN** eine Person „Drucken / als PDF“ wählt, bevor Organisationsdaten oder Logo geladen
  sind
- **THEN** öffnet sich der Druckdialog erst, wenn Name und (falls vorhanden) Logo bereitstehen
- **AND** scheitert das Laden des Logos, wird ohne Logo gedruckt statt gar nicht

#### Scenario: Einsatzbericht trägt den gemeinsamen Kopf

- **WHEN** ein Einsatzbericht gedruckt wird
- **THEN** nennt der Druckkopf Organisation, „Einsatzbericht“, Einsatz mit Einsatznummer,
  Stand, die druckende Person und den Druckzeitpunkt
- **AND** am Bildschirm steht derselbe Kopf über dem Bericht

### Requirement: Seitenzählung, wo der Browser sie trägt

Wo der Browser Randfelder der Druckseite unterstützt, SHALL jede Seite eine Seitenzählung
„Seite n von m“ tragen. In Browsern ohne diese Unterstützung MUST der Ausdruck trotzdem
vollständig und über den Druckkopf zuordenbar sein.

#### Scenario: Seitenzählung in Chromium

- **WHEN** ein mehrseitiges Druckstück in Chromium gedruckt wird
- **THEN** trägt jede Seite die Seitenzählung

### Requirement: Druckmechanik in drei Browser-Engines automatisch belegt

Das Qualitäts-Gate SHALL die Druckmechanik der Druckstücke Lagebericht, Befehl,
Pressemitteilung und ETB-Druck unter Druckmedium automatisch in den Engines von Chromium,
Firefox und WebKit prüfen: Druckwurzel im Fluss und oben, Rahmen ohne Platz, letzter Abschnitt
jenseits der ersten Seitenhöhe. Scheitert eine Aussage in einer Engine, MUST das Gate rot sein.

#### Scenario: Engine ohne Unterstützung für die Ausblende-Regel

- **WHEN** eine Engine die Ausblende-Regel des Drucks nicht anwendet und die Kopfleiste unter
  Druckmedium Platz belegt
- **THEN** scheitert der Druckfall in genau dieser Engine
- **AND** das Gate meldet den Browser und das Druckstück

#### Scenario: Druckwurzel absolut positioniert

- **WHEN** die Druckwurzel unter Druckmedium nicht im Fluss steht
- **THEN** scheitert der Druckfall in Chromium, Firefox und WebKit

#### Scenario: PDF-Schritte nur, wo es ein PDF gibt

- **WHEN** ein Druckfall in Firefox oder WebKit läuft
- **THEN** prüft er die Mechanik unter Druckmedium ohne PDF-Erzeugung
- **AND** der Bericht nennt den PDF-Schritt als nur in Chromium geprüft, nicht als bestanden

### Requirement: Seitenzählung am erzeugten PDF belegt

Das Qualitäts-Gate SHALL für ein mehrseitiges Druckstück in Chromium den Text des erzeugten
PDF auslesen und belegen, dass jede Seite n von m die Zählung „Seite n von m“ trägt, mit
fortlaufendem n und m gleich der Seitenzahl des PDF. Fehlt die Zählung auf einer Seite oder
stimmt eine Zahl nicht, MUST das Gate rot sein.

#### Scenario: Randfeld entfernt

- **WHEN** die Seitenzählung im Randfeld der Druckseite fehlt
- **THEN** scheitert der Druckfall mit der Seite, auf der die Zählung fehlt

#### Scenario: Endmarke auf der letzten Inhaltsseite

- **WHEN** ein Lagebericht mit Endmarke im letzten Abschnitt als PDF erzeugt wird
- **THEN** steht die Endmarke im Text einer Seite nach Seite 1
- **AND** keine Seite nach der Seite mit der Endmarke trägt Inhalt außer der Seitenzählung

### Requirement: Logo im Druckkopf belegt

Hat die Organisation ein Logo hinterlegt, SHALL das Qualitäts-Gate belegen, dass der Druckkopf
unter Druckmedium dieses Logo als geladenes Bild zeigt, in Chromium, Firefox und WebKit. In
Chromium SHALL es zusätzlich belegen, dass das erzeugte PDF auf Seite 1 ein Bild mit den
Abmessungen des hochgeladenen Logos zeichnet.

#### Scenario: Logo hochgeladen

- **WHEN** eine Organisation ein PNG-Logo hochgeladen hat und ein Lagebericht gedruckt wird
- **THEN** steht im Druckkopf ein geladenes Bild mit den Abmessungen des Logos
- **AND** in Chromium zeichnet Seite 1 des PDF dieses Bild

#### Scenario: Logo nur im Kopf

- **WHEN** ein mehrseitiger Lagebericht ohne eigene Bilder mit Logo als PDF erzeugt wird
- **THEN** zeichnet keine Folgeseite ein Bild

#### Scenario: Logo fällt im Druck weg

- **WHEN** das Logo im Druckkopf unter Druckmedium ausgeblendet oder nicht geladen ist
- **THEN** scheitert der Logo-Fall
